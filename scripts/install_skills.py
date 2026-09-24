#!/usr/bin/env python3
"""Explicit, reversible skill installation. Standard library; preview unless --apply."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
CLIENTS = ('codex', 'claude', 'reasonix', 'zcode')
SKILLS = {'agents-talk': ('SKILL.md',), 'agents-talk-plan': ('SKILL.md', 'prompt-format.md')}
MARKER = '.agents-talk-install.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def command_text(parts):
    return subprocess.list2cmdline(parts) if os.name == 'nt' else shlex.join(parts)


def client_homes():
    """Folders whose presence shows a client is set up on this computer."""
    home = Path.home()
    homes = {'codex': Path(os.environ.get('CODEX_HOME', str(home / '.codex'))),
             'claude': home / '.claude', 'zcode': home / '.zcode'}
    # Reasonix location is configurable. Only Windows has a verified local convention here.
    if os.name == 'nt' and os.environ.get('APPDATA'):
        homes['reasonix'] = Path(os.environ['APPDATA']) / 'reasonix'
    return homes


def default_targets():
    return {client: home / 'skills' for client, home in client_homes().items()}


def same_path(a, b):
    return os.path.normcase(str(Path(a).resolve())) == os.path.normcase(str(Path(b).resolve()))


def owner(folder):
    """(project, managed): the installer's manifest, else the Project line older installs wrote."""
    marker = folder / MARKER
    if marker.is_file() and not marker.is_symlink():
        data = json.loads(marker.read_text(encoding='utf-8'))
        return (data.get('project') if isinstance(data, dict) else None), True
    location = folder / 'location.md'
    if location.is_file() and not location.is_symlink():
        for line in location.read_text(encoding='utf-8', errors='replace').splitlines():
            if line.startswith('Project: '): return line[len('Project: '):].strip(), False
    return None, False


def status(project, client, target, data_dir, config_path):
    """missing / current / outdated / other (belongs to another folder) / unmanaged, without writing."""
    home = client_homes().get(client)
    row = {'detected': bool(home and home.is_dir()), 'target': str(target) if target else None, 'state': 'unknown', 'project': None}
    if not target: return row
    folders = [target / name for name in SKILLS if (target / name).exists()]
    if not folders:
        row['state'] = 'missing'
        return row
    desired = resources(project, client, data_dir, config_path)
    state = 'current'
    for folder in folders:
        folder_project, managed = owner(folder)
        if folder_project and not same_path(folder_project, project):
            return {**row, 'state': 'other', 'project': folder_project}
        if not folder_project and not managed:
            state = 'unmanaged'
            continue
        if any(not (folder / f).is_file() or (folder / f).read_bytes() != data for f, data in desired[folder.name].items()) and state == 'current':
            state = 'outdated'
    if len(folders) < len(SKILLS) and state == 'current': state = 'outdated'
    return {**row, 'state': state, 'project': str(project) if state != 'unmanaged' else None}


def resources(project, client, data_dir, config_path):
    command = [sys.executable, str(project / 'hub.py'), '--data-dir', str(data_dir), '--config', str(config_path)]
    location = ('# Local Agents Talk location\n\n'
                f'Project: {project}\nPython: {sys.executable}\nData: {data_dir}\n'
                f'Config: {config_path}\nProtocol: {project / "PROTOCOL.md"}\n\n'
                'Append the subcommand and its arguments to this exact command prefix:\n\n'
                f'```text\n{command_text(command)}\n```\n'
                'Keep data/config arguments in every read, post, listen and bind call.\n')
    result = {}
    for name, files in SKILLS.items():
        texts = {f: (project / 'skills' / name / f).read_text(encoding='utf-8-sig') for f in files}
        if client == 'claude' and name == 'agents-talk':
            text = texts['SKILL.md']
            end = text.index('\n---', 3)
            hook = command_text([*command, 'stop-hook'])
            text = text[:end] + ('\nhooks:\n  Stop:\n    - hooks:\n        - type: command\n'
                                '          command: ' + json.dumps(hook, ensure_ascii=False) +
                                '\n          timeout: 10') + text[end:]
            text += ('\n## Claude 原生窗口绑定\n\n'
                     '当前原生会话 ID：`${CLAUDE_SESSION_ID}`。报到后使用 location 中的命令前缀，'
                     '执行 `bind --agent <本窗口Claude实例ID> --session <看板会话> --client-session <此原生ID>`。'
                     '只绑定当前窗口；变量未展开时报告无法绑定，不填写猜测值。退出按协议 leave，解除绑定加 --detach。\n')
            texts['SKILL.md'] = text
        texts['location.md'] = location
        result[name] = {f: t.encode('utf-8') for f, t in texts.items()}
    return result


def install(project, client, target, data_dir, config_path, apply=False, uninstall=False, replace_project=False):
    project, target = project.resolve(), target.resolve()
    # Never install into or remove the maintained source folders.
    if target == project / 'skills' or target.is_relative_to(project / 'skills'):
        raise ValueError('Target must not be the maintained project skills directory')
    desired = {} if uninstall else resources(project, client, data_dir, config_path)
    report = []
    for name in SKILLS:
        folder = target / name
        if folder.is_symlink() or (folder.exists() and folder.resolve() != folder):
            raise ValueError(f'Refusing linked skill folder: {folder}')
        marker = folder / MARKER
        if marker.is_symlink(): raise ValueError(f'Refusing linked installation manifest: {marker}')
        has_marker = marker.exists()
        previous = json.loads(marker.read_text(encoding='utf-8')) if has_marker else None
        if has_marker and (not isinstance(previous, dict) or previous.get('schema') != 1 or not isinstance(previous.get('files'), dict)):
            raise ValueError(f'Invalid installation manifest: {marker}')
        if previous and (previous.get('project') != str(project) or previous.get('client') != client):
            if uninstall or not replace_project: raise ValueError(f'{folder} belongs to another project/client; inspect it before --replace-project')
        # Older installs have no manifest but name their project in location.md; never retarget them silently.
        legacy, _ = (None, True) if has_marker else owner(folder)
        if legacy and not same_path(legacy, project) and not uninstall and not replace_project:
            raise ValueError(f'{folder} was installed for {legacy}; inspect it before --replace-project')
        if uninstall:
            if not previous:
                report.append({'skill': name, 'action': 'skip_unmanaged', 'path': str(folder)})
                continue
            remaining = {}
            for filename, expected in previous['files'].items():
                if filename not in (*SKILLS[name], 'location.md'): raise ValueError('Invalid installation manifest file')
                path = folder / filename
                if not path.exists(): continue
                if path.is_symlink() or digest(path.read_bytes()) != expected:
                    remaining[filename] = expected
                    report.append({'path': str(path), 'action': 'keep_modified'})
                else:
                    report.append({'path': str(path), 'action': 'remove_owned'})
                    if apply: path.unlink()
            if apply:
                if remaining:
                    previous['files'] = remaining
                    marker.write_text(json.dumps(previous, ensure_ascii=False, indent=2), encoding='utf-8')
                else:
                    marker.unlink()
                    if not any(folder.iterdir()): folder.rmdir()
            continue
        hashes = {}
        backup = project / '.backups' / 'skills' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8]) / client / name
        for filename, content in desired[name].items():
            path = folder / filename
            if path.is_symlink(): raise ValueError(f'Refusing linked skill resource: {path}')
            hashes[filename] = digest(content)
            old = path.read_bytes() if path.exists() else None
            action = 'unchanged' if old == content else 'backup_and_update' if old is not None else 'create'
            report.append({'path': str(path), 'action': action})
            if apply and old != content:
                if old is not None:
                    backup.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(path, backup / filename)
                folder.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
        if apply:
            manifest = {'schema': 1, 'project': str(project), 'client': client, 'files': hashes}
            marker.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return report


CLIENT_NAMES = {'codex': 'Codex', 'claude': 'Claude Code', 'reasonix': 'Reasonix', 'zcode': 'ZCode'}


def setup(states, data_dir, config_path, targets):
    """Terminal first run for the macOS/Linux launcher; the Windows launcher asks the same in dialogs."""
    ready = [c for c, s in states.items() if s['detected'] and s['state'] in ('missing', 'outdated')]
    for client, row in states.items():
        if not row['detected']: continue
        if row['state'] == 'other':
            print(f'{CLIENT_NAMES[client]}：协作技能指向另一个目录 {row["project"]}，未改动。改用本目录请运行 '
                  f'python scripts/install_skills.py --clients {client} --replace-project --apply')
        elif row['state'] == 'unmanaged':
            print(f'{CLIENT_NAMES[client]}：{row["target"]} 已有不由安装器管理的同名技能，未改动。')
        elif row['state'] == 'current':
            print(f'{CLIENT_NAMES[client]}：协作技能已是最新。')
    if not ready: return 0
    print('可以为这些客户端安装 agentstalk 协作技能：')
    for client in ready: print(f'  {CLIENT_NAMES[client]} → {states[client]["target"]}')
    if not sys.stdin.isatty() or input('现在安装吗？[y/N] ').strip().lower() not in ('y', 'yes'):
        print('未安装。之后可运行 python scripts/install_skills.py --clients ' + ' '.join(ready) + ' --apply')
        return 0
    failed = 0
    for client in ready:
        try:
            install(ROOT, client, targets[client], data_dir, config_path, True)
            print(f'{CLIENT_NAMES[client]}：已安装，在该客户端的新对话中调用 agents-talk 即可接入。')
        except (OSError, ValueError) as e:
            failed += 1
            print(f'{CLIENT_NAMES[client]}：安装失败：{e}')
    return 2 if failed else 0


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'): stream.reconfigure(encoding='utf-8', errors='backslashreplace')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clients', nargs='+', choices=CLIENTS, required=True)
    parser.add_argument('--target', action='append', default=[], metavar='CLIENT=SKILL_ROOT')
    parser.add_argument('--data-dir', type=Path, default=Path(os.environ.get('AGENTS_TALK_DATA', str(ROOT))))
    parser.add_argument('--config', type=Path, default=Path(os.environ.get('AGENTS_TALK_CONFIG', str(ROOT / 'config.json'))))
    parser.add_argument('--apply', action='store_true', help='Actually write; omitted means preview only')
    parser.add_argument('--uninstall', action='store_true', help='Only remove unmodified files owned by this installation')
    parser.add_argument('--replace-project', action='store_true', help='Rebind these skill names to this project after inspecting the old installation')
    parser.add_argument('--status', action='store_true', help='Report whether each client is set up and what is installed, as JSON; writes nothing')
    parser.add_argument('--setup', action='store_true', help='First-run helper: show the status and, after a yes in the terminal, install for detected clients')
    args = parser.parse_args()
    try:
        targets = default_targets()
        for value in args.target:
            client, sep, path = value.partition('=')
            if not sep or client not in args.clients or not path: raise ValueError('Use --target CLIENT=SKILL_ROOT for a selected client')
            targets[client] = Path(path)
        selected = list(dict.fromkeys(args.clients))
        cfg = args.config.resolve()
        if cfg == ROOT / 'config.json' and not cfg.exists(): cfg = ROOT / 'config.example.json'
        if args.status or args.setup:
            states = {c: status(ROOT, c, targets.get(c), args.data_dir.resolve(), cfg) for c in selected}
            if args.status:
                # ASCII JSON survives any console code page used by the Windows launcher.
                print(json.dumps({'project': str(ROOT), 'clients': states}, indent=2))
                return 0
            return setup(states, args.data_dir.resolve(), cfg, targets)
        for client in selected:
            if client not in targets: raise ValueError(f'Provide --target {client}=<your skill root> on this platform')
        if len({os.path.normcase(str(targets[c].resolve())) for c in selected}) != len(selected):
            raise ValueError('Each client needs its own skill root')
        if not args.uninstall and not cfg.is_file(): raise ValueError('Custom config file does not exist')
        # Complete validation/preview of every selected target before any write.
        reports = {c: install(ROOT, c, targets[c], args.data_dir.resolve(), cfg, False,
                              args.uninstall, args.replace_project) for c in selected}
        if args.apply:
            reports = {c: install(ROOT, c, targets[c], args.data_dir.resolve(), cfg, True,
                                  args.uninstall, args.replace_project) for c in selected}
        print(json.dumps({'applied': args.apply, 'clients': reports,
                          'note': 'File installation does not verify discovery or execution inside native clients.'}, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as e:
        print('Skill installation failed: ' + str(e), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
