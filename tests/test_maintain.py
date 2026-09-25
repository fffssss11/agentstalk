"""Maintainer workflow on an isolated copy: status, version bump, build, clean-copy verify and clone sync."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_builder', ROOT / 'scripts/build_release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class MaintainTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agents-talk-maintain-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.project = self.base / 'project'
        for name, content in release.inventory(ROOT).items():
            (self.project / name).parent.mkdir(parents=True, exist_ok=True)
            (self.project / name).write_bytes(content)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('AGENTS_TALK_')}
        self.env.update(PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1')
        self.version = (self.project / 'VERSION').read_text(encoding='utf-8').strip()

    def maintain(self, *args, expected=0):
        result = subprocess.run([sys.executable, str(self.project / 'scripts/maintain.py'), *map(str, args)], cwd=self.project,
                                env=self.env, capture_output=True, encoding='utf-8', timeout=120)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def test_status_compares_with_the_source_package_not_the_newer_portable_one(self):
        out = self.project / 'dist' / 'release-x'
        out.mkdir(parents=True)
        source = out / f'{release.ARCHIVE_NAME}-{self.version}.zip'
        release.build(self.project, source)
        platform = out / f'{release.ARCHIVE_NAME}-{self.version}-windows-x64.zip'
        shutil.copyfile(source, platform)
        os.utime(platform, (source.stat().st_mtime + 60,) * 2)
        self.assertIn(f'Since {source.name}:', self.maintain('status').stdout)

    def test_version_order_follows_semver(self):
        ordered = ['0.1.0-rc.2', '0.1.0-rc.10', '0.1.0-rc.beta', '0.1.0', '0.1.1', '1.0.0']
        self.assertEqual(sorted(reversed(ordered), key=release.version_key), ordered)
        for bad in ['1.0', 'v1.0.0', '1.0.0-', '1.0.0-rc..1', '1.0.0-RC.1']:
            with self.subTest(bad=bad), self.assertRaises(ValueError): release.version_key(bad)

    def test_status_flags_unlisted_sources_but_not_private_files(self):
        for name in ['board.jsonl', 'config.json', 'scripts/python-path.txt', 'uploads/a.png', 'web/__pycache__/x.py']:
            (self.project / name).parent.mkdir(parents=True, exist_ok=True)
            (self.project / name).write_text('private', encoding='utf-8')
        self.assertIn('agree', self.maintain('status', '--strict').stdout)
        (self.project / 'scripts/new_tool.py').write_text('print(1)\n', encoding='utf-8')
        out = self.maintain('status', '--strict', expected=2).stdout
        self.assertIn('unlisted  scripts/new_tool.py', out)
        self.assertNotIn('python-path', out)
        self.assertNotIn('board.jsonl', out)

    def test_bump_updates_versions_links_and_changelog(self):
        self.assertIn('must be later', self.maintain('bump', '0.0.1', expected=2).stderr)
        self.assertIn('must be later', self.maintain('bump', self.version, expected=2).stderr)
        # Right after a release "Unreleased" is empty; give this copy something to release.
        log = self.project / 'CHANGELOG.md'
        log.write_text(log.read_text(encoding='utf-8').replace('## Unreleased\n', '## Unreleased\n\n- 待发布的测试条目。\n', 1),
                       encoding='utf-8', newline='\n')
        before = {n: (self.project / n).read_bytes() for n in ('VERSION', 'README.md', 'CHANGELOG.md')}
        media = re.findall(r'releases/download/[^/]+/Agents-Talk-[^)\s]+', before['README.md'].decode('utf-8'))
        self.assertIn('Preview only', self.maintain('bump', '99.0.0').stdout)
        self.assertEqual({n: (self.project / n).read_bytes() for n in before}, before)
        unreleased = self.maintain('notes', 'Unreleased').stdout.split('---')[0].strip()

        self.maintain('bump', '99.0.0', '--apply')
        self.assertEqual((self.project / 'VERSION').read_text(encoding='utf-8'), '99.0.0\n')
        self.assertEqual(json.loads((self.project / 'package.json').read_text(encoding='utf-8'))['version'], '99.0.0')
        lock = json.loads((self.project / 'package-lock.json').read_text(encoding='utf-8'))
        self.assertEqual((lock['version'], lock['packages']['']['version']), ('99.0.0', '99.0.0'))
        for name in ('README.md', 'README.en.md'):
            readme = (self.project / name).read_text(encoding='utf-8')
            self.assertIn('`99.0.0`', readme)
            # Both the link text and the address name the new archive.
            self.assertIn('[agentstalk-99.0.0.zip](https://github.com/fffssss11/agentstalk/releases/download/v99.0.0/agentstalk-99.0.0.zip)', readme)
            self.assertNotIn(f'{release.ARCHIVE_NAME}-{self.version}.zip', readme)
        # Video and slides stay linked to the release that hosts them.
        for link in media: self.assertIn(link, (self.project / 'README.md').read_text(encoding='utf-8'))
        self.assertIn('## Unreleased\n\n## 99.0.0\n', (self.project / 'CHANGELOG.md').read_text(encoding='utf-8'))
        self.assertIn(unreleased, self.maintain('notes').stdout)
        self.assertIn('docs/release.md does not name', self.maintain('status', '--strict', expected=2).stdout)
        release.build(self.project, self.base / 'bumped.zip')

    def test_build_writes_sums_and_notes_then_verifies_a_clean_copy(self):
        out_dir = self.base / 'out'
        self.maintain('build', '--output-dir', out_dir)
        archive = out_dir / f'{release.ARCHIVE_NAME}-{self.version}.zip'
        sums = (out_dir / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines()
        self.assertEqual(sums, [f'{hashlib.sha256((out_dir / n).read_bytes()).hexdigest()}  {n}'
                                for n in sorted([archive.name, archive.name + '.sha256'])])
        notes = (out_dir / 'RELEASE-NOTES.md').read_text(encoding='utf-8')
        self.assertIn('SOURCE-MANIFEST.json', notes)
        # Release pages resolve relative links under /releases/; notes must link to the tagged source.
        repo = json.loads((self.project / 'package.json').read_text(encoding='utf-8'))['repository']['url'].removesuffix('.git')
        self.assertNotIn('](docs/', notes)
        self.assertIn(f'{repo}/blob/v{self.version}/docs/release.md', notes)
        self.assertIn('Archive verified', self.maintain('verify', archive).stdout)
        self.assertIn('overwrite', self.maintain('build', '--output-dir', out_dir, expected=2).stderr)

        tampered = self.base / 'tampered.zip'
        shutil.copy(archive, tampered)
        with zipfile.ZipFile(tampered, 'a') as z: z.writestr(f'{release.ARCHIVE_NAME}-{self.version}/extra.py', 'print(1)\n')
        self.assertIn('differs from its manifest', self.maintain('verify', tampered, expected=1).stderr)

    @unittest.skipUnless(shutil.which('git'), 'git is required for clone sync')
    def test_sync_stages_exact_manifest_without_committing(self):
        repo = self.base / 'public clone'
        repo.mkdir()
        def git(*args):
            return subprocess.run(['git', *args], cwd=repo, capture_output=True, encoding='utf-8', check=True).stdout
        git('init', '--quiet')
        for key, value in [('user.name', 'Maintainer'), ('user.email', 'maintainer@users.noreply.github.com'),
                           ('core.autocrlf', 'false'), ('commit.gpgsign', 'false')]:
            git('config', key, value)
        (repo / 'stale.txt').write_text('removed from the manifest\n', encoding='utf-8')
        (repo / 'README.md').write_text('old\n', encoding='utf-8')
        git('add', '.'); git('commit', '--quiet', '-m', 'Initial')
        self.assertIn('Preview only', self.maintain('sync', repo).stdout)
        self.assertEqual(git('status', '--porcelain'), '')

        self.assertIn('"ok": true', self.maintain('sync', repo, '--apply').stdout)
        self.assertEqual(set(git('ls-files', '-z').strip('\0').split('\0')), set(release.inventory(self.project)))
        staged = git('diff', '--cached', '--name-status')
        self.assertIn('D\tstale.txt', staged)
        self.assertIn('M\tREADME.md', staged)
        self.assertEqual(git('rev-list', '--count', 'HEAD').strip(), '1')
        self.assertIn('uncommitted changes', self.maintain('sync', repo, '--apply', expected=1).stderr)


if __name__ == '__main__':
    unittest.main()
