"""Desktop icons, shortcut scripts and first-run skill checks, using temporary desktops and homes only."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_builder', ROOT / 'scripts/build_release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agents-talk-desktop-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.project = self.base / 'agentstalk 部署'
        for name, content in release.inventory(ROOT).items():
            (self.project / name).parent.mkdir(parents=True, exist_ok=True)
            (self.project / name).write_bytes(content)
        # A fake home keeps every client folder and desktop inside the temporary directory.
        self.home = self.base / 'home'
        self.home.mkdir()
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(('AGENTS_TALK_', 'CODEX_HOME'))}
        self.env.update(PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1', HOME=str(self.home), USERPROFILE=str(self.home),
                        APPDATA=str(self.home / 'AppData' / 'Roaming'))

    def installer(self, *args, expected=0, stdin=None):
        result = subprocess.run([sys.executable, str(self.project / 'scripts/install_skills.py'), *map(str, args)],
                                cwd=self.base, env=self.env, capture_output=True, encoding='utf-8', timeout=60, input=stdin)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def test_icons_are_reproducible_and_well_formed(self):
        check = subprocess.run([sys.executable, str(self.project / 'scripts/make_icons.py'), '--check'], capture_output=True, encoding='utf-8')
        self.assertEqual(check.returncode, 0, check.stdout + check.stderr)
        data = (self.project / 'scripts/agentstalk.ico').read_bytes()
        reserved, kind, count = struct.unpack_from('<HHH', data)
        self.assertEqual((reserved, kind, count), (0, 1, 7))
        sizes = []
        for i in range(count):
            width, _, _, _, _, bits, length, offset = struct.unpack_from('<BBBBHHII', data, 6 + 16 * i)
            image = data[offset:offset + length]
            self.assertEqual(image[:8], b'\x89PNG\r\n\x1a\n')
            size = struct.unpack_from('>I', image, 16)[0]
            self.assertEqual(width or 256, size)
            self.assertEqual(bits, 32)
            sizes.append(size)
        self.assertEqual(sizes, [16, 24, 32, 48, 64, 128, 256])
        self.assertEqual((self.project / 'scripts/agentstalk.png').read_bytes(), data[struct.unpack_from('<I', data, 6 + 16 * 6 + 12)[0]:])

    @unittest.skipUnless(os.name == 'nt', 'Windows shortcut')
    def test_windows_shortcut_points_to_this_folder_and_protects_others(self):
        desktop = self.base / 'Desktop'
        def ps(*args, expected=0):
            result = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                                     str(self.project / 'scripts/desktop.ps1'), '-Desktop', str(desktop), *args],
                                    capture_output=True, timeout=60)
            output = result.stdout.decode('utf-8', 'replace') + result.stderr.decode('utf-8', 'replace')
            self.assertEqual(result.returncode, expected, output)
            return output
        def read(link):
            script = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK);"
                      "[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
                      "@{target=$s.TargetPath;arguments=$s.Arguments;icon=$s.IconLocation;folder=$s.WorkingDirectory}|ConvertTo-Json")
            result = subprocess.run(['powershell', '-NoProfile', '-Command', script], env={**os.environ, 'LINK': str(link)},
                                    capture_output=True, timeout=60)
            return json.loads(result.stdout.decode('utf-8'))
        ps()
        link = desktop / 'agentstalk.lnk'
        info = read(link)
        self.assertTrue(info['target'].lower().endswith('wscript.exe'))
        self.assertEqual(info['arguments'], '"' + str(self.project / 'scripts' / 'launch.vbs') + '"')
        self.assertEqual(info['icon'], str(self.project / 'scripts' / 'agentstalk.ico') + ',0')
        self.assertEqual(Path(info['folder']), self.project)
        # A shortcut that belongs to another copy is backed up before it is replaced, and never removed.
        other = self.base / 'other copy'
        shutil.copytree(self.project / 'scripts', other / 'scripts')
        subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(other / 'scripts/desktop.ps1'),
                        '-Desktop', str(desktop)], capture_output=True, timeout=60, check=True)
        ps('-Remove', expected=1)
        self.assertTrue(link.exists())
        ps()
        backups = list((self.project / '.backups' / 'shortcuts').rglob('agentstalk.lnk'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(read(backups[0])['arguments'], '"' + str(other / 'scripts' / 'launch.vbs') + '"')
        ps('-Remove')
        self.assertFalse(link.exists())

    @unittest.skipUnless(shutil.which('sh'), 'POSIX shell')
    def test_posix_launcher_is_created_and_removed(self):
        for script in ('desktop.sh', 'launch.sh'):
            syntax = subprocess.run(['sh', '-n', (self.project / 'scripts' / script).as_posix()], capture_output=True)
            self.assertEqual(syntax.returncode, 0, syntax.stderr)
        run = lambda *args: subprocess.run(['sh', (self.project / 'scripts/desktop.sh').as_posix(), *args], env=self.env,
                                           capture_output=True, timeout=60)
        created = run()
        output = created.stdout.decode('utf-8')
        self.assertEqual(created.returncode, 0, output + created.stderr.decode('utf-8', 'replace'))
        launcher = next(line.split('：', 1)[1] for line in output.splitlines() if line.startswith('已创建桌面启动器'))
        text = subprocess.run(['sh', '-c', 'cat "$1"', 'sh', launcher], capture_output=True).stdout.decode('utf-8')
        self.assertIn('/scripts/launch.sh"', text)
        if launcher.endswith('.desktop'):
            self.assertIn('Terminal=true', text)
            self.assertIn('/scripts/agentstalk.png', text)
        removed = run('--remove')
        self.assertIn('已删除', removed.stdout.decode('utf-8'))
        exists = subprocess.run(['sh', '-c', 'test -e "$1"', 'sh', launcher])
        self.assertNotEqual(exists.returncode, 0)

    def test_status_and_first_run_setup_never_take_over_other_folders(self):
        (self.home / '.codex').mkdir()
        (self.home / '.claude').mkdir()
        # An older install for another folder: no ownership manifest, only its location.md.
        legacy = self.home / '.claude' / 'skills' / 'agents-talk'
        legacy.mkdir(parents=True)
        (legacy / 'location.md').write_text('# Local Agents Talk location\n\nProject: ' + str(self.base / 'private board') + '\n', encoding='utf-8')
        (legacy / 'SKILL.md').write_text('private copy\n', encoding='utf-8')
        states = json.loads(self.installer('--clients', 'codex', 'claude', 'zcode', '--status').stdout)['clients']
        self.assertEqual((states['codex']['detected'], states['codex']['state']), (True, 'missing'))
        self.assertEqual((states['claude']['state'], Path(states['claude']['project'])), ('other', self.base / 'private board'))
        self.assertFalse(states['zcode']['detected'])

        out = self.installer('--clients', 'codex', 'claude', 'zcode', '--setup', stdin='').stdout
        self.assertIn('未安装', out)
        self.assertIn('--replace-project', out)
        self.assertFalse((self.home / '.codex' / 'skills').exists())

        failed = self.installer('--clients', 'claude', '--apply', expected=2)
        self.assertIn('was installed for', failed.stderr)
        self.assertEqual((legacy / 'SKILL.md').read_text(encoding='utf-8'), 'private copy\n')
        self.installer('--clients', 'codex', '--apply')
        self.assertEqual(json.loads(self.installer('--clients', 'codex', '--status').stdout)['clients']['codex']['state'], 'current')
        self.installer('--clients', 'claude', '--replace-project', '--apply')
        self.assertIn(str(self.project), (legacy / 'location.md').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
