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


def read_link(path):
    """Strings stored in a .lnk file (MS-SHLLINK), read from the bytes so no Windows API can hide lost characters."""
    data = Path(path).read_bytes()
    flags = struct.unpack_from('<I', data, 20)[0]
    pos, fields = 76, {'unicode': bool(flags & 0x80)}
    if flags & 0x1:
        pos += 2 + struct.unpack_from('<H', data, pos)[0]
    if flags & 0x2:
        size, _, info_flags, _, base = struct.unpack_from('<IIIII', data, pos)
        if info_flags & 1: fields['target'] = data[pos + base:data.index(b'\0', pos + base)].decode('mbcs')
        pos += size
    for bit, key in ((0x4, 'description'), (0x8, 'relative'), (0x10, 'folder'), (0x20, 'arguments'), (0x40, 'icon')):
        if flags & bit:
            count = struct.unpack_from('<H', data, pos)[0]
            size = count * 2 if flags & 0x80 else count
            fields[key] = data[pos + 2:pos + 2 + size].decode('utf-16-le' if flags & 0x80 else 'mbcs')
            pos += 2 + size
    return fields


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
        # The launcher's icon question writes to AGENTS_TALK_DESKTOP, never to the real desktop, in these tests.
        self.desktop = self.base / 'Desktop'
        self.env.update(PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1', HOME=str(self.home), USERPROFILE=str(self.home),
                        APPDATA=str(self.home / 'AppData' / 'Roaming'), AGENTS_TALK_DESKTOP=str(self.desktop))

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

    def test_launcher_scripts_keep_the_text_format_their_interpreters_need(self):
        # Windows PowerShell 5.1 reads BOM-less files in the ANSI code page and mangles Chinese strings;
        # cmd/vbs expect CRLF and sh fails on CR characters.
        for name, content in release.inventory(ROOT).items():
            suffix = Path(name).suffix.lower()
            with self.subTest(name=name):
                if suffix == '.ps1':
                    self.assertTrue(content.startswith(b'\xef\xbb\xbf'))
                    # PowerShell treats curly quotes as quote characters, so one inside a string ends it.
                    self.assertFalse(set(content.decode('utf-8-sig')) & set('“”‘’'))
                if suffix in ('.ps1', '.cmd', '.vbs'): self.assertEqual(content.count(b'\n'), content.count(b'\r\n'))
                if suffix == '.sh': self.assertNotIn(b'\r', content)

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
        ps()
        link = desktop / 'agentstalk.lnk'
        info = read_link(link)
        # The folder name is Chinese: every character must survive, whatever the system code page.
        self.assertTrue(info['unicode'])
        self.assertTrue(info['target'].lower().endswith('wscript.exe'))
        self.assertEqual(info['arguments'], '"' + str(self.project / 'scripts' / 'launch.vbs') + '"')
        self.assertEqual(info['icon'], str(self.project / 'scripts' / 'agentstalk.ico'))
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
        self.assertEqual(read_link(backups[0])['arguments'], '"' + str(other / 'scripts' / 'launch.vbs') + '"')
        ps('-Remove')
        self.assertFalse(link.exists())

    @unittest.skipUnless(os.name == 'nt', 'Windows interpreter discovery')
    def test_windows_finds_python_in_a_non_ascii_folder_whatever_the_console_encoding(self):
        venv = self.base / '中文 python'
        subprocess.run([sys.executable, '-m', 'venv', '--without-pip', str(venv)], check=True, capture_output=True, timeout=180)
        expected = venv / 'Scripts' / 'python.exe'
        found = self.base / 'found.txt'
        script = self.base / 'find.ps1'
        # The launcher reads child output as UTF-8 while Python writes piped output in the ANSI code page.
        script.write_text("try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }\n"
                          ". (Join-Path $env:PROJECT_UNDER_TEST 'scripts\\python.ps1')\n"
                          "Find-AgentsTalkPython | Set-Content -LiteralPath $env:FOUND_PATH -Encoding UTF8\n", encoding='utf-8-sig')
        env = {k: v for k, v in os.environ.items() if k not in ('PYTHONIOENCODING', 'PYTHONUTF8')}
        env.update(AGENTS_TALK_PYTHON=str(expected), PROJECT_UNDER_TEST=str(self.project), FOUND_PATH=str(found))
        result = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script)],
                                env=env, capture_output=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', 'replace'))
        self.assertEqual(Path(found.read_text(encoding='utf-8-sig').strip()), expected)

    def launcher_dialogs(self, call, answer, env=None):
        """Run launch.ps1's own functions with a stub message box that records each dialog and answers it."""
        harness = self.project / 'scripts' / 'dialog-harness.ps1'
        harness.write_text(r'''
$ErrorActionPreference = 'Stop'
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'launch.ps1'), [ref]$null, [ref]$null)
# Only the function definitions, dot-sourced from scripts/ so $PSScriptRoot and parameters stay intact.
$definitions = $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false) | ForEach-Object { $_.Extent.Text }
$functions = Join-Path $PSScriptRoot 'launch-functions.ps1'
[IO.File]::WriteAllText($functions, ($definitions -join "`r`n"), [Text.UTF8Encoding]::new($true))
. $functions
$script:dialogs = @()
function Show-Message([string]$Text, [string]$Buttons = 'OK', [string]$Icon = 'Information') {
    $script:dialogs += $Text
    if ($Buttons -eq 'OK') { return 'OK' }
    return $env:TEST_ANSWER
}
$interactive = $true
$runtimePath = Join-Path (Split-Path -Parent $PSScriptRoot) '.runtime'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$value = & ([scriptblock]::Create($env:TEST_CALL))
@{ dialogs = @($script:dialogs); value = [string]$value } | ConvertTo-Json | Set-Content -LiteralPath $env:TEST_RESULT -Encoding UTF8
''', encoding='utf-8-sig')
        result_path = self.base / 'dialogs.json'
        run_env = {**self.env, **(env or {}), 'TEST_CALL': call, 'TEST_ANSWER': answer, 'TEST_RESULT': str(result_path)}
        run = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(harness)],
                             env=run_env, capture_output=True, timeout=120)
        self.assertEqual(run.returncode, 0, run.stderr.decode('utf-8', 'replace'))
        return json.loads(result_path.read_text(encoding='utf-8-sig'))

    @unittest.skipUnless(os.name == 'nt', 'Windows launcher dialogs')
    def test_windows_first_run_offers_detected_clients_once_and_respects_the_answer(self):
        (self.home / '.codex').mkdir()
        legacy = self.home / '.claude' / 'skills' / 'agents-talk'
        legacy.mkdir(parents=True)
        (legacy / 'location.md').write_text('# Local Agents Talk location\n\nProject: ' + str(self.base / 'private board') + '\n', encoding='utf-8')
        marker = self.project / '.runtime' / 'setup.json'
        call = "Invoke-FirstRunSetup '" + sys.executable + "'"
        declined = self.launcher_dialogs(call, 'No')
        self.assertEqual(len(declined['dialogs']), 2)
        self.assertIn('是否在桌面创建 agentstalk 图标', declined['dialogs'][0])
        self.assertIn('Codex → ' + str(self.home / '.codex' / 'skills'), declined['dialogs'][1])
        self.assertIn('Claude Code：协作技能指向另一个目录 ' + str(self.base / 'private board'), declined['dialogs'][1])
        state = json.loads(marker.read_text(encoding='utf-8-sig'))
        self.assertEqual((state['shortcut'], state['skills']), ('declined', 'declined'))
        self.assertFalse((self.home / '.codex' / 'skills').exists())
        self.assertFalse((self.desktop / 'agentstalk.lnk').exists())
        # Asked once per folder: with the marker in place nothing is shown again.
        self.assertEqual(self.launcher_dialogs(call, 'Yes')['dialogs'], [])
        marker.unlink()
        accepted = self.launcher_dialogs(call, 'Yes')
        self.assertEqual(accepted['dialogs'][1], '已在桌面创建 agentstalk 图标。')
        self.assertEqual(accepted['dialogs'][-1], '已安装：Codex')
        self.assertEqual(read_link(self.desktop / 'agentstalk.lnk')['arguments'], '"' + str(self.project / 'scripts' / 'launch.vbs') + '"')
        self.assertTrue((self.home / '.codex' / 'skills' / 'agents-talk' / 'location.md').is_file())
        self.assertEqual((legacy / 'location.md').read_text(encoding='utf-8').count('private board'), 1)
        # Nothing left to install: the hint names the Python in use, which may be the portable package's.
        marker.unlink()
        note = self.launcher_dialogs(call, 'Yes')['dialogs']
        self.assertEqual(len(note), 1)
        python = '& "' + sys.executable + '"' if ' ' in sys.executable else sys.executable
        self.assertIn(python + r' scripts\install_skills.py --clients <客户端> --replace-project --apply', note[0])

    @unittest.skipUnless(os.name == 'nt', 'Windows launcher dialogs')
    def test_windows_icon_question_after_upgrade_with_existing_or_foreign_icons(self):
        marker = self.project / '.runtime' / 'setup.json'
        marker.parent.mkdir(parents=True, exist_ok=True)
        call = "Invoke-FirstRunSetup '" + sys.executable + "'"
        make_icon = lambda folder: subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                                                   str(folder / 'scripts' / 'desktop.ps1')], env=self.env, capture_output=True, timeout=60, check=True)
        # A folder set up by 0.2.0 answered the skill question but was never asked about the icon.
        marker.write_text('{"skills": "declined"}', encoding='utf-8')
        first = self.launcher_dialogs(call, 'No')
        self.assertEqual(len(first['dialogs']), 1)
        self.assertIn('是否在桌面创建 agentstalk 图标', first['dialogs'][0])
        state = json.loads(marker.read_text(encoding='utf-8-sig'))
        self.assertEqual((state['shortcut'], state['skills']), ('declined', 'declined'))
        self.assertEqual(self.launcher_dialogs(call, 'Yes')['dialogs'], [])
        # An icon that already opens this folder needs no question.
        make_icon(self.project)
        marker.write_text('{"skills": "declined"}', encoding='utf-8')
        self.assertEqual(self.launcher_dialogs(call, 'Yes')['dialogs'], [])
        self.assertEqual(json.loads(marker.read_text(encoding='utf-8-sig'))['shortcut'], 'present')
        # An icon that opens another copy is explained and only replaced after a yes.
        other = self.base / 'other copy'
        shutil.copytree(self.project / 'scripts', other / 'scripts')
        make_icon(other)
        marker.write_text('{"skills": "declined"}', encoding='utf-8')
        kept = self.launcher_dialogs(call, 'No')
        self.assertIn('另一个目录', kept['dialogs'][0])
        self.assertIn(str(other), kept['dialogs'][0])
        self.assertIn(str(other), read_link(self.desktop / 'agentstalk.lnk')['arguments'])

    @unittest.skipUnless(os.name == 'nt', 'Windows launcher dialogs')
    def test_windows_missing_python_is_explained_and_nothing_is_installed_on_cancel(self):
        empty = self.base / 'no python'
        empty.mkdir()
        system = os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'System32')
        env = {'PATH': system + os.pathsep + os.path.join(system, 'WindowsPowerShell', 'v1.0'), 'AGENTS_TALK_PYTHON': str(empty / 'python.exe'),
               'LOCALAPPDATA': str(empty), 'ProgramFiles': str(empty), 'ProgramFiles(x86)': str(empty)}
        result = self.launcher_dialogs('Get-Python', 'No', env)
        self.assertEqual(result['value'], '')
        self.assertEqual(len(result['dialogs']), 1)
        self.assertIn('没有找到 Python 3.10 或更高版本', result['dialogs'][0])

    @unittest.skipUnless(shutil.which('sh'), 'POSIX shell')
    def test_posix_launcher_is_created_and_removed(self):
        for script in ('desktop.sh', 'launch.sh'):
            syntax = subprocess.run(['sh', '-n', (self.project / 'scripts' / script).as_posix()], capture_output=True)
            self.assertEqual(syntax.returncode, 0, syntax.stderr)
        run = lambda *args: subprocess.run(['sh', (self.project / 'scripts/desktop.sh').as_posix(), *args], env=self.env,
                                           capture_output=True, timeout=60)
        status = lambda: run('--status').stdout.decode('utf-8').strip()
        self.assertEqual(status(), 'missing')
        created = run()
        self.assertEqual(status(), 'ours')
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
        self.assertEqual(status(), 'missing')
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
        self.assertIn(sys.executable, out)
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
