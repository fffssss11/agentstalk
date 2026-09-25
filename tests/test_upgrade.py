"""In-place upgrades from a release package keep private data, back up program files and roll back."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_builder', ROOT / 'scripts/build_release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def snapshot(folder):
    skip = {'.backups', '__pycache__'}
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob('*')
            if p.is_file() and not skip.intersection(p.relative_to(folder).parts)}


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agents-talk-upgrade-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('AGENTS_TALK_')}
        self.env.update(PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1')
        source, sources = self.base / 'source', release.inventory(ROOT)
        for folder in (source, self.base / 'old install 空格'):
            for name, content in sources.items():
                (folder / name).parent.mkdir(parents=True, exist_ok=True)
                (folder / name).write_bytes(content)
        self.archive = self.base / 'agents-talk-new.zip'
        self.version = release.build(source, self.archive)['version']
        with zipfile.ZipFile(self.archive) as z: z.extractall(self.base / 'extracted')
        self.package = self.base / 'extracted' / (release.ARCHIVE_NAME + '-' + self.version)
        self.source = source
        # An older installation: different program files plus private data that must survive.
        self.old = self.base / 'old install 空格'
        (self.old / 'VERSION').write_text('0.0.1\n', encoding='utf-8')
        with (self.old / 'hub.py').open('a', encoding='utf-8') as f: f.write('# older build\n')
        (self.old / 'web/js/util.js').unlink()
        (self.old / 'web/legacy.js').write_text('// retired\n', encoding='utf-8')
        listing = json.loads((self.old / 'release-files.json').read_text(encoding='utf-8'))
        (self.old / 'release-files.json').write_text(json.dumps(sorted(listing + ['web/legacy.js'])), encoding='utf-8')
        (self.old / 'config.json').write_bytes((self.old / 'config.example.json').read_bytes())
        for name, text in {'.library.json': '{"version":1,"projects":{"p-demo":{"name":"演示"}},"sessions":{},"requests":{}}',
                           'uploads/demo.bin': 'attachment', 'workspace/result.md': '成果', 'notes.txt': 'mine',
                           'scripts/python-path.txt': 'python'}.items():
            (self.old / name).parent.mkdir(parents=True, exist_ok=True)
            (self.old / name).write_text(text, encoding='utf-8')
        self.run_cli(self.old / 'hub.py', 'post', '--session', 'main', '--from', 'claude', '--type', 'say', '--body', '升级前的消息')
        self.private = {n: b for n, b in snapshot(self.old).items() if n not in sources and n != 'web/legacy.js'}

    def run_cli(self, script, *args, expected=0):
        result = subprocess.run([sys.executable, str(script), *map(str, args)], cwd=self.base, env=self.env,
                                capture_output=True, encoding='utf-8', timeout=90)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def upgrade(self, *args, expected=0):
        return self.run_cli(self.package / 'scripts/upgrade.py', self.old, *args, expected=expected)

    def test_preview_writes_nothing(self):
        before = snapshot(self.old)
        out = self.upgrade().stdout
        self.assertIn('Preview only', out)
        self.assertIn('hub.py', out)
        self.assertIn('web/legacy.js', out)
        self.assertEqual(snapshot(self.old), before)
        self.assertFalse((self.old / '.backups').exists())

    def test_apply_replaces_program_files_keeps_private_data_and_rolls_back(self):
        before = snapshot(self.old)
        out = self.upgrade('--apply').stdout
        self.assertIn('doctor: ok', out)
        for row in json.loads((self.package / 'SOURCE-MANIFEST.json').read_text(encoding='utf-8'))['files']:
            self.assertEqual((self.old / row['path']).read_bytes(), (self.package / row['path']).read_bytes(), row['path'])
        self.assertTrue((self.old / 'SOURCE-MANIFEST.json').is_file())
        self.assertFalse((self.old / 'web/legacy.js').exists())
        for name, content in self.private.items(): self.assertEqual((self.old / name).read_bytes(), content, name)
        backup, = (self.old / '.backups').iterdir()
        record = json.loads((backup / 'upgrade.json').read_text(encoding='utf-8'))
        self.assertEqual((record['from'], record['to']), ('0.0.1', self.version))
        self.assertIn('web/js/util.js', record['added'])
        self.assertIn('hub.py', record['replaced'])
        self.assertEqual(record['removed'], ['web/legacy.js'])
        self.assertEqual((backup / 'files/hub.py').read_bytes(), before['hub.py'])
        self.assertIn('Already up to date', self.upgrade().stdout)

        self.assertIn('Preview only', self.upgrade('--rollback', backup).stdout)
        self.upgrade('--rollback', backup, '--apply')
        self.assertEqual(snapshot(self.old), before)

    def test_zip_source_and_refusals(self):
        self.run_cli(self.package / 'scripts/upgrade.py', self.old, '--source', self.archive)
        tampered = self.base / 'tampered'
        with zipfile.ZipFile(self.archive) as z: z.extractall(tampered)
        package = tampered / (release.ARCHIVE_NAME + '-' + self.version)
        with (package / 'hub.py').open('a', encoding='utf-8') as f: f.write('# changed after release\n')
        result = self.run_cli(package / 'scripts/upgrade.py', self.old, expected=2)
        self.assertIn('differs from its manifest', result.stderr)
        result = self.run_cli(self.package / 'scripts/upgrade.py', self.package, expected=2)
        self.assertIn('not the new package', result.stderr)
        (self.old / 'VERSION').write_text('99.0.0\n', encoding='utf-8')
        self.assertIn('--allow-downgrade', self.upgrade(expected=2).stderr)
        (self.old / 'VERSION').write_text('0.0.1\n', encoding='utf-8')
        (self.old / '.git').mkdir()
        self.assertIn('git pull', self.upgrade(expected=2).stderr)
        (self.old / '.git').rmdir()

    def test_portable_packages_bring_their_python_and_source_packages_keep_it(self):
        sys.path.insert(0, str(ROOT / 'scripts'))
        import portable
        from test_portable import stand_in_runtime
        bundle = self.base / 'portable.zip'
        portable.build(self.source, bundle, stand_in_runtime())
        with zipfile.ZipFile(bundle) as z: z.extractall(self.base / 'portable')
        package = self.base / 'portable' / f'{release.ARCHIVE_NAME}-{self.version}-{portable.PLATFORM}'
        self.run_cli(package / 'scripts/upgrade.py', self.old, '--apply')
        runtime = self.old / 'runtime' / 'python' / 'python.exe'
        self.assertEqual(runtime.read_bytes(), b'MZ stand-in interpreter')
        # Going back to the plain source package must not delete the bundled interpreter.
        out = self.upgrade('--apply').stdout
        self.assertNotIn('runtime/python', out)
        self.assertEqual(runtime.read_bytes(), b'MZ stand-in interpreter')
        for name, content in self.private.items(): self.assertEqual((self.old / name).read_bytes(), content, name)

    def test_refuses_while_the_board_from_that_folder_runs(self):
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
        server = subprocess.Popen([sys.executable, str(self.old / 'hub.py'), 'serve', '--port', str(port), '--no-open'],
                                  cwd=self.old, env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(lambda: (server.terminate(), server.wait(timeout=10)))
        for _ in range(100):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=1).close()
                break
            except OSError: time.sleep(.1)
        else: self.fail('Board did not start')
        before = snapshot(self.old)
        self.assertIn(f'running on port {port}', self.upgrade('--apply', '--port', port, expected=2).stderr)
        self.assertEqual(snapshot(self.old), before)


if __name__ == '__main__':
    unittest.main()
