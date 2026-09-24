#!/usr/bin/env python3
"""Upgrade an existing Agents Talk folder in place from a verified release package, or roll it back.

Only program files named in the release's SOURCE-MANIFEST.json are written. Conversations,
attachments, work results, local configuration, installed skills and earlier backups are never
touched. Every replaced or retired file is copied to .backups/ first. Preview is the default.

  python scripts/upgrade.py OLD_FOLDER                     # run from the extracted new release
  python scripts/upgrade.py OLD_FOLDER --source new.zip    # or point at a downloaded ZIP
  python scripts/upgrade.py OLD_FOLDER --rollback OLD_FOLDER/.backups/upgrade-...
"""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_release import FORBIDDEN, version_key  # noqa: E402

RECORD = 'SOURCE-MANIFEST.json'


def say(text=''):
    print(text, flush=True)


def safe_name(name):
    path = PurePosixPath(name)
    if not isinstance(name, str) or path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name or str(path) != name:
        raise ValueError('Unsafe path in release manifest: ' + str(name))
    if any(p.casefold() in FORBIDDEN or p.casefold().startswith('.env.') for p in path.parts):
        raise ValueError('Release manifest names private data: ' + name)
    return name


def inside(target, name):
    path = target / name
    if not path.resolve().is_relative_to(target) or path.is_symlink():
        raise ValueError('Refusing to write through a link: ' + name)
    if path.exists() and not path.is_file():
        raise ValueError('Refusing to replace a folder: ' + name)
    return path


def load_package(source, temp):
    """Files of a release folder or ZIP, each checked against the package's own SHA-256 manifest."""
    if source.is_file():
        with zipfile.ZipFile(source) as z:
            tops = {n.split('/')[0] for n in z.namelist()}
            if len(tops) != 1: raise ValueError('A release ZIP contains exactly one top-level folder')
            for name in z.namelist():
                if not (temp / name).resolve().is_relative_to(temp): raise ValueError('Unsafe path in ZIP: ' + name)
            z.extractall(temp)
        source = temp / tops.pop()
    record = source / RECORD
    if not record.is_file():
        raise ValueError(f'{source} is not a release package (no {RECORD}); download the release ZIP instead of copying a working folder')
    data = json.loads(record.read_text(encoding='utf-8'))
    version_key(data['version'])
    files = {}
    for row in data['files']:
        content = (source / safe_name(row['path'])).read_bytes()
        if hashlib.sha256(content).hexdigest() != row['sha256']: raise ValueError('Package file differs from its manifest: ' + row['path'])
        files[row['path']] = content
    files[RECORD] = record.read_bytes()
    return source, data['version'], files


def installed(target):
    if not (target / 'hub.py').is_file() or not (target / 'VERSION').is_file():
        raise ValueError(f'{target} does not look like an Agents Talk folder (hub.py and VERSION are missing)')
    names = set()
    if (target / RECORD).is_file():
        names |= {row['path'] for row in json.loads((target / RECORD).read_text(encoding='utf-8'))['files']}
    if (target / 'release-files.json').is_file():
        names |= set(json.loads((target / 'release-files.json').read_text(encoding='utf-8')))
    return (target / 'VERSION').read_text(encoding='utf-8').strip(), names


def running_server(target, ports):
    """Port of a board served from this folder, found through the same health probe the launcher uses."""
    candidates = {8765, *ports}
    for pid in (target / '.runtime').glob('server-*.pid') if (target / '.runtime').is_dir() else ():
        if pid.stem[7:].isdigit(): candidates.add(int(pid.stem[7:]))
    for port in sorted(candidates):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=1) as response:
                health = json.load(response)
        except (OSError, ValueError):
            continue
        if health.get('app') == 'agents-talk' and Path(str(health.get('root', ''))).resolve() == target:
            return port
    return None


def write_file(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f'.{path.name}.upgrade-tmp')
    temp.write_bytes(content)
    if path.exists(): shutil.copymode(path, temp)
    os.replace(temp, path)


def remove_file(target, name):
    path = target / name
    path.unlink()
    parent = path.parent
    while parent != target and parent.is_dir() and not any(parent.iterdir()):
        parent.rmdir()
        parent = parent.parent


def show(label, names):
    say(f'  {label}: {len(names)}')
    for name in names: say('    ' + name)


def upgrade(args, target):
    with tempfile.TemporaryDirectory(prefix='agents-talk-upgrade-') as temp:
        source, new, files = load_package(Path(args.source).resolve() if args.source else HERE, Path(temp).resolve())
        if source == target: raise ValueError('Run this against the existing folder, not the new package itself')
        old, old_names = installed(target)
        if version_key(new) < version_key(old) and not args.allow_downgrade:
            raise ValueError(f'{target} has {old}, newer than this package ({new}); pass --allow-downgrade to go back')
        added, replaced = [], []
        for name, content in sorted(files.items()):
            path = inside(target, name)
            if not path.exists(): added.append(name)
            elif path.read_bytes() != content: replaced.append(name)
        retired = []
        for name in sorted(old_names - set(files)):
            try:
                if inside(target, safe_name(name)).is_file(): retired.append(name)
            except ValueError:
                continue
        say(f'Agents Talk {old} → {new} in {target}')
        if old == new: say('  Same version: files that differ from the release are restored (local edits are backed up).')
        if not (target / RECORD).is_file(): say('  This folder was not installed from a release ZIP; replaced files may contain your own edits.')
        show('new files', added)
        show('replaced files', replaced)
        show('retired program files', retired)
        say('  Untouched: config.json, board.jsonl, uploads/, workspace/, .library.json, cursors, installed skills, backups.')
        if not (added or replaced or retired):
            say('Already up to date.')
            return
        if not args.apply:
            say('Preview only. Stop the board, then re-run with --apply.')
            return
        port = running_server(target, args.port)
        if port: raise ValueError(f'The board from this folder is running on port {port}; stop it first, then upgrade')
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        backup = target / '.backups' / f'upgrade-{old}-to-{new}-{stamp}'
        backup.mkdir(parents=True)
        for name in replaced + retired:
            (backup / 'files' / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target / name, backup / 'files' / name)
        (backup / 'upgrade.json').write_text(json.dumps({'schema': 1, 'from': old, 'to': new, 'created': stamp, 'added': added,
                                                         'replaced': replaced, 'removed': retired}, ensure_ascii=False, indent=2) + '\n',
                                             encoding='utf-8')
        try:
            for name in added + replaced: write_file(target / name, files[name])
            for name in retired: remove_file(target, name)
        except OSError:
            say('Write failed; restoring the previous files from ' + str(backup))
            restore(target, backup)
            raise
        say(f'Upgraded. Backup: {backup}')
        doctor = subprocess.run([sys.executable, 'hub.py', 'doctor'], cwd=target, capture_output=True, encoding='utf-8',
                                env={**os.environ, 'PYTHONUTF8': '1'})
        say('doctor: ok' if doctor.returncode == 0 else 'doctor reported problems; see "python hub.py doctor" or roll back:\n'
            f'  python scripts/upgrade.py "{target}" --rollback "{backup}" --apply')
        say('Next: start the board again and reload the panel (window captures need to be bound again).')
        if any(n.startswith('skills/') for n in added + replaced):
            say('Skills changed: re-run "python scripts/install_skills.py --clients <your clients> --apply" so clients get the new instructions.')
        if 'config.example.json' in replaced:
            say('config.example.json changed; your config.json was kept. Compare them if you want the new defaults.')


def restore(target, backup):
    record = json.loads((backup / 'upgrade.json').read_text(encoding='utf-8'))
    for name in record['replaced'] + record['removed']:
        write_file(inside(target, safe_name(name)), (backup / 'files' / name).read_bytes())
    for name in record['added']:
        if inside(target, safe_name(name)).is_file(): remove_file(target, name)
    return record


def rollback(args, target):
    backup = Path(args.rollback).resolve()
    record = json.loads((backup / 'upgrade.json').read_text(encoding='utf-8'))
    if record.get('schema') != 1: raise ValueError('Unknown backup format')
    missing = [n for n in record['replaced'] + record['removed'] if not (backup / 'files' / safe_name(n)).is_file()]
    if missing: raise ValueError('Backup is incomplete: ' + ', '.join(missing))
    say(f'Roll back {record["to"]} → {record["from"]} in {target}')
    show('restore', record['replaced'] + record['removed'])
    show('remove files added by the upgrade', [n for n in record['added'] if (target / n).is_file()])
    if not args.apply:
        say('Preview only. Stop the board, then re-run with --apply.')
        return
    port = running_server(target, args.port)
    if port: raise ValueError(f'The board from this folder is running on port {port}; stop it first')
    restore(target, backup)
    say(f'Rolled back to {record["from"]}. The backup folder is kept: {backup}')


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'): stream.reconfigure(encoding='utf-8', errors='backslashreplace')
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('target', type=Path, help='The existing Agents Talk folder to upgrade')
    parser.add_argument('--source', help='Release ZIP or extracted release folder (default: the package holding this script)')
    parser.add_argument('--rollback', help='Backup folder written by an earlier upgrade')
    parser.add_argument('--apply', action='store_true', help='Actually write; omitted means preview only')
    parser.add_argument('--allow-downgrade', action='store_true')
    parser.add_argument('--port', type=int, action='append', default=[], help='Extra board port to check before writing')
    args = parser.parse_args()
    try:
        target = args.target.resolve()
        if (target / '.git').exists(): raise ValueError(f'{target} is a Git clone; update it with "git pull" instead')
        rollback(args, target) if args.rollback else upgrade(args, target)
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as e:
        print('Upgrade rejected: ' + str(e), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
