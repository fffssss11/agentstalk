#!/usr/bin/env python3
"""Maintainer workflow: status, release gates, version bump, notes, build, clean-copy verification
and exact-manifest sync into a public Git clone.

Nothing here commits, tags, pushes or uploads. Commands that change files preview first and need
--apply. Release contents always come from release-files.json through build_release.py.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import audit_public  # noqa: E402
import build_release  # noqa: E402
import portable  # noqa: E402

# New files in these folders must be released or kept out of them; private runtime names are exempt.
SOURCE_DIRS = ('web', 'scripts', 'tests', 'skills', 'prompts', 'docs', '.github')
SOURCE_SUFFIXES = {'.py', '.js', '.cjs', '.mjs', '.html', '.css', '.md', '.json', '.yml', '.yaml',
                   '.ps1', '.vbs', '.cmd', '.sh', '.png', '.jpg', '.ico', '.svg', '.txt'}
ROOT_SUFFIXES = {'.py', '.md', '.json', '.cmd', '.ps1', '.txt'}
SKIP_PARTS = {'__pycache__', 'node_modules', '.git'}
VERSIONED_DOCS = ('README.md', 'README.en.md', 'docs/release.md')
NOTES_FOOTER = ('---\n\n源码包内 `SOURCE-MANIFEST.json` 记录每个源码文件的 SHA-256，`SHA256SUMS.txt` 覆盖本页附件。'
                '校验值只证明文件一致，不代表作者签名。已有目录的升级、备份与回滚见 [使用说明](docs/user-guide.md#停止备份和升级)，'
                '实际验证范围与已知限制见 [发布说明](docs/release.md)。')


def say(text=''):
    print(text, flush=True)


def run(command, cwd=ROOT, env=None):
    say('$ ' + ' '.join(str(c) for c in command))
    code = subprocess.run([str(c) for c in command], cwd=cwd, env=env).returncode
    if code: raise SystemExit(f'Command failed with exit code {code}')


def read_text(root, name):
    return (root / name).read_text(encoding='utf-8')


def version(root=ROOT):
    return read_text(root, 'VERSION').strip()


def manifest(root=ROOT):
    return json.loads(read_text(root, 'release-files.json'))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def private(parts):
    return any(p.casefold() in build_release.FORBIDDEN or p.casefold().startswith('.env.') for p in parts)


def unlisted_sources(root=ROOT):
    """Source-looking files that are neither in the release manifest nor private runtime data."""
    listed, found = set(manifest(root)), []
    for directory in SOURCE_DIRS:
        base = root / directory
        for path in base.rglob('*') if base.is_dir() else ():
            relative = path.relative_to(root).as_posix()
            parts = PurePosixPath(relative).parts
            if path.is_file() and path.suffix.lower() in SOURCE_SUFFIXES and relative not in listed \
                    and not SKIP_PARTS.intersection(parts) and not private(parts):
                found.append(relative)
    for path in root.iterdir():
        if path.is_file() and path.suffix.lower() in ROOT_SUFFIXES and path.name not in listed \
                and not path.name.startswith('.') and not private([path.name]):
            found.append(path.name)
    return sorted(found)


def consistency(root=ROOT):
    """Version metadata and the user-facing release pages must name the same version."""
    ver, problems = version(root), []
    try: build_release.version_key(ver)
    except ValueError: problems.append('VERSION is not a release version: ' + ver)
    package = json.loads(read_text(root, 'package.json'))
    lock = json.loads(read_text(root, 'package-lock.json'))
    if package.get('version') != ver: problems.append('package.json version differs from VERSION')
    if lock.get('version') != ver or lock.get('packages', {}).get('', {}).get('version') != ver:
        problems.append('package-lock.json version differs from VERSION')
    for name in VERSIONED_DOCS:
        if f'`{ver}`' not in read_text(root, name): problems.append(f'{name} does not name the current version `{ver}`')
    return problems


def changelog_body(target, root=ROOT):
    """Text under '## Unreleased' or '## <version>' (a heading may continue after a space)."""
    body, inside = [], False
    for line in read_text(root, 'CHANGELOG.md').splitlines():
        if line.startswith('## '):
            if inside: break
            inside = line[3:].split(' ')[0] == target
        elif inside:
            body.append(line)
    return '\n'.join(body).strip()


def archive_manifest(path):
    path = Path(path)
    if path.suffix.lower() != '.zip': return json.loads(path.read_text(encoding='utf-8'))
    with zipfile.ZipFile(path) as z:
        name = next((n for n in z.namelist() if n.count('/') == 1 and n.endswith('/SOURCE-MANIFEST.json')), None)
        if not name: raise ValueError(path.name + ' has no SOURCE-MANIFEST.json')
        return json.loads(z.read(name))


def latest_archive(root=ROOT):
    # Releases before the rename were called agents-talk-VERSION.zip.
    found = [p for pattern in (f'{build_release.ARCHIVE_NAME}-*.zip', 'agents-talk-*.zip')
             for p in (root / 'dist').rglob(pattern)] if (root / 'dist').is_dir() else []
    return max(found, key=lambda p: p.stat().st_mtime) if found else None


def changes_since(reference, root=ROOT):
    old = {f['path']: f['sha256'] for f in archive_manifest(reference)['files']}
    new = {n: sha256(root / n) for n in manifest(root) if (root / n).is_file()}
    return (sorted(set(new) - set(old)), sorted(n for n in new if n in old and new[n] != old[n]),
            sorted(set(old) - set(new)))


def problems_report(root=ROOT):
    missing = [n for n in manifest(root) if not (root / n).is_file()]
    return missing, unlisted_sources(root), consistency(root)


def cmd_status(args):
    missing, unlisted, problems = problems_report()
    say(f'Agents Talk {version()} · release-files.json lists {len(manifest())} files')
    for n in missing: say('  missing   ' + n)
    for n in unlisted: say('  unlisted  ' + n + '  (add it to release-files.json or keep it out of the source folders)')
    for p in problems: say('  version   ' + p)
    if not (missing or unlisted or problems): say('  manifest, version metadata and release pages agree')
    reference = Path(args.since) if args.since else latest_archive()
    if reference:
        added, changed, removed = changes_since(reference)
        say(f'Since {reference.name}: {len(added)} added, {len(changed)} changed, {len(removed)} removed')
        for mark, rows in (('+', added), ('~', changed), ('-', removed)):
            for n in rows: say(f'  {mark} {n}')
    entries = [l for l in changelog_body('Unreleased').splitlines() if l.startswith('- ')]
    say(f'CHANGELOG "Unreleased": {len(entries)} entries')
    if args.strict and (missing or unlisted or problems): raise SystemExit(2)


def cmd_check(args):
    """Every gate a release needs. Browser suites are opt-in because they need Node and Playwright."""
    missing, unlisted, problems = problems_report()
    if missing or unlisted or problems:
        for row in missing + unlisted + problems: say('  ' + row)
        raise SystemExit('Run "python scripts/maintain.py status" and fix the manifest or version pages first')
    py = sys.executable
    with tempfile.TemporaryDirectory(prefix='agents-talk-doctor-') as data:
        run([py, 'hub.py', '--data-dir', data, '--config', 'config.example.json', 'doctor'])
    run([py, '-m', 'unittest', 'discover', '-s', 'tests'])
    run([py, 'scripts/build_release.py', '--check'])
    run([py, 'scripts/audit_public.py', '--source', '.'])
    npm = shutil.which('npm')
    if npm:
        run([npm, 'run', 'check'])
        if args.browser: run([npm, 'test'])
    elif args.browser:
        raise SystemExit('npm was not found; browser suites need Node 20+ and Playwright')
    else:
        say('npm was not found: JavaScript syntax check skipped')
    say('All requested checks passed.')


def canonical_json(root, name, update):
    text = read_text(root, name)
    data = json.loads(text)
    if json.dumps(data, ensure_ascii=False, indent=2) + '\n' != text:
        raise ValueError(f'{name} is not in npm formatting; update its version by hand')
    update(data)
    return json.dumps(data, ensure_ascii=False, indent=2) + '\n'


def bump_plan(new, root=ROOT):
    old = version(root)
    if build_release.version_key(new) <= build_release.version_key(old):
        raise ValueError(f'New version {new} must be later than {old}')
    if not changelog_body('Unreleased', root):
        raise ValueError('CHANGELOG.md "## Unreleased" has no entries to release')

    def set_lock(lock):
        lock['version'] = new
        lock['packages']['']['version'] = new
    changes = {'VERSION': new + '\n',
               'package.json': canonical_json(root, 'package.json', lambda p: p.__setitem__('version', new)),
               'package-lock.json': canonical_json(root, 'package-lock.json', set_lock)}
    # The source ZIP and release page follow the new tag; media links stay on the release that hosts them.
    for name in ('README.md', 'README.en.md'):
        text = read_text(root, name)
        for prefix in (build_release.ARCHIVE_NAME, 'agents-talk'):
            text = text.replace(f'releases/download/v{old}/{prefix}-{old}.zip', f'releases/download/v{new}/{build_release.ARCHIVE_NAME}-{new}.zip')
        changes[name] = (text.replace(f'`{old}`', f'`{new}`')
                         .replace(f'releases/tag/v{old}', f'releases/tag/v{new}'))
    changes['CHANGELOG.md'] = read_text(root, 'CHANGELOG.md').replace('## Unreleased', f'## Unreleased\n\n## {new}', 1)
    return old, changes


def cmd_bump(args):
    old, changes = bump_plan(args.version)
    say(f'Version {old} → {args.version}')
    for name, text in changes.items():
        say(f'  {"update" if read_text(ROOT, name) != text else "same  "} {name}')
    say('  by hand: docs/release.md "当前版本" and "实际验证" must describe this release before "check" passes')
    if not args.apply:
        say('Preview only. Re-run with --apply to write these files.')
        return
    for name, text in changes.items():
        (ROOT / name).write_text(text, encoding='utf-8', newline='\n')
    say('Updated. Next: edit docs/release.md, then python scripts/maintain.py check --browser')


def absolute_links(text, ref, root=ROOT):
    """A release page resolves relative links under /releases/, so point them at the source of that ref."""
    url = json.loads(read_text(root, 'package.json')).get('repository', {}).get('url', '')
    base = url.removesuffix('.git').rstrip('/')
    if not base.startswith('https://github.com/'): return text
    return re.sub(r'\]\((?!https?://|mailto:|#)([^)\s]+)\)', lambda m: f']({base}/blob/{ref}/{m.group(1)})', text)


def release_notes(ver, root=ROOT, portable_package=False):
    footer = NOTES_FOOTER
    if portable_package:
        footer = (f'**Windows 便携包**：`{build_release.ARCHIVE_NAME}-{ver}-{portable.PLATFORM}.zip` 自带 python.org 官方嵌入式 '
                  f'Python {portable.PYTHON_VERSION}，解压到可写目录后双击 `启动看板.cmd` 即可使用，不需要另外安装 Python。'
                  '源码包适合已经安装 Python 3.10+ 的用户和开发者。\n\n' + NOTES_FOOTER)
    body = changelog_body(ver, root)
    if body:
        if ver != 'Unreleased' and changelog_body('Unreleased', root):
            print(f'warning: CHANGELOG "Unreleased" still has entries that are not part of {ver}; run "bump" to release them',
                  file=sys.stderr)
        return absolute_links(f'{body}\n\n{footer}\n', 'main' if ver == 'Unreleased' else 'v' + ver, root)
    body = changelog_body('Unreleased', root)
    if not body: raise ValueError(f'CHANGELOG.md has no entries for {ver} or "Unreleased"')
    return absolute_links(f'> 开发构建：`{ver}` 尚未在 CHANGELOG 中定版，以下为未发布内容。\n\n{body}\n\n{footer}\n', 'main', root)


def cmd_notes(args):
    say(release_notes(args.version or version()).rstrip())


def write_sums(directory):
    directory = Path(directory)
    files = sorted(p for p in directory.iterdir() if p.is_file() and p.name not in ('SHA256SUMS.txt', 'RELEASE-NOTES.md'))
    (directory / 'SHA256SUMS.txt').write_text(''.join(f'{sha256(p)}  {p.name}\n' for p in files), encoding='utf-8', newline='\n')
    return files


def cmd_build(args):
    ver = version()
    out = Path(args.output_dir).resolve() if args.output_dir else ROOT / 'dist' / f'release-{ver}'
    notes = release_notes(ver, portable_package=args.portable)
    result = build_release.build(ROOT, out / f'{build_release.ARCHIVE_NAME}-{ver}.zip')
    say(f'Built {result["archive"]} ({result["bytes"]} bytes, {len(result["files"])} source files)')
    archives = [result['archive']]
    if args.portable:
        bundle = portable.build(ROOT, out / f'{build_release.ARCHIVE_NAME}-{ver}-{portable.PLATFORM}.zip', portable.runtime_archive())
        say(f'Built {bundle["archive"]} ({bundle["bytes"]} bytes, python.org Python {portable.PYTHON_VERSION} included)')
        archives.append(bundle['archive'])
    (out / 'RELEASE-NOTES.md').write_text(notes, encoding='utf-8', newline='\n')
    files = write_sums(out)
    say(f'SHA256SUMS.txt covers {", ".join(p.name for p in files)}; release body: RELEASE-NOTES.md')
    for archive in archives: say(f'Next: python scripts/maintain.py verify "{archive}"')


def cmd_sums(args):
    files = write_sums(args.directory)
    say(f'Wrote SHA256SUMS.txt for {len(files)} files in {Path(args.directory).resolve()}')


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def fetch(url):
    with urllib.request.urlopen(url, timeout=5) as response:
        return response.read()


def cmd_verify(args):
    """Clean-room check of a built archive: exact contents, hashes, privacy scan and a real startup."""
    archive = Path(args.archive).resolve()
    checksum = archive.with_name(archive.name + '.sha256')
    if checksum.is_file() and checksum.read_text(encoding='utf-8').split()[0] != sha256(archive):
        raise SystemExit(f'{checksum.name} does not match the archive')
    audit = audit_public.inspect_artifact(archive)
    if not audit['ok']: raise SystemExit('Privacy scan findings: ' + json.dumps(audit['findings'], ensure_ascii=False))
    with tempfile.TemporaryDirectory(prefix='agents-talk-verify-') as temp:
        temp = Path(temp).resolve()
        with zipfile.ZipFile(archive) as z:
            tops = {n.split('/')[0] for n in z.namelist()}
            if len(tops) != 1: raise SystemExit('The archive must contain exactly one top-level folder')
            for name in z.namelist():
                if not (temp / name).resolve().is_relative_to(temp): raise SystemExit('Unsafe archive path: ' + name)
            z.extractall(temp)
        project = temp / tops.pop()
        data = json.loads((project / 'SOURCE-MANIFEST.json').read_text(encoding='utf-8'))
        listed = {f['path'] for f in data['files']}
        present = {p.relative_to(project).as_posix() for p in project.rglob('*') if p.is_file()} - {'SOURCE-MANIFEST.json'}
        if listed != present:
            raise SystemExit(f'Archive differs from its manifest: extra {sorted(present - listed)}, missing {sorted(listed - present)}')
        for f in data['files']:
            if sha256(project / f['path']) != f['sha256']: raise SystemExit('Hash mismatch: ' + f['path'])
        say(f'{len(listed)} files match SOURCE-MANIFEST.json; privacy scan clean')
        runtime = data.get('runtime')
        python = sys.executable
        if runtime:
            official = portable.CACHE / runtime['source'].rsplit('/', 1)[1]
            if official.is_file() and sha256(official) == runtime['sha256']:
                bundled = {p: (project / p).read_bytes() for p in listed if p.startswith(portable.RUNTIME_DIR + '/')}
                if bundled != portable.runtime_files(official.read_bytes()):
                    raise SystemExit('The bundled runtime differs from the python.org archive it names')
                say(f'Bundled runtime matches python.org Python {runtime["python"]} byte for byte')
            else:
                say('python.org archive not in the cache: bundled runtime checked against SOURCE-MANIFEST.json only')
            # On Windows the package is started exactly as users start it, with its own Python.
            if os.name == 'nt': python = str(project / portable.RUNTIME_DIR / 'python.exe')
        env = {k: v for k, v in os.environ.items() if not k.startswith('AGENTS_TALK_')}
        env.update(PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1', AGENTS_TALK_DATA=str(temp / 'runtime'),
                   AGENTS_TALK_CONFIG=str(project / 'config.example.json'))
        doctor = subprocess.run([python, 'hub.py', 'doctor'], cwd=project, env=env, capture_output=True, encoding='utf-8')
        if doctor.returncode: raise SystemExit('doctor failed in the clean copy:\n' + doctor.stdout + doctor.stderr)
        if python != sys.executable:
            status = subprocess.run([python, 'scripts/install_skills.py', '--clients', 'codex', '--status'], cwd=project, env=env,
                                    capture_output=True, encoding='utf-8')
            if status.returncode: raise SystemExit('The bundled Python cannot run the skill installer:\n' + status.stderr)
            say(f'Bundled Python runs doctor and the skill installer ({runtime["python"]})')
        port = free_port()
        base = f'http://127.0.0.1:{port}'
        child = subprocess.Popen([python, 'hub.py', 'serve', '--port', str(port), '--no-open'], cwd=project, env=env,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(150):
                if child.poll() is not None: raise SystemExit('The clean copy exited during startup')
                try:
                    health = json.loads(fetch(base + '/api/health'))
                    break
                except OSError:
                    time.sleep(.1)
            else:
                raise SystemExit('The clean copy did not start')
            # Identify the server by its project folder: a port can belong to anything.
            if Path(health.get('root', '')).resolve() != project or health.get('app_version') != data['version']:
                raise SystemExit('The health endpoint on that port belongs to another program')
            page = fetch(base + '/').decode('utf-8')
            assets = [a for a in re.findall(r'(?:src|href)="/([^"#?]*)"', page) if a and a != 'guide']
            for asset in assets: fetch(f'{base}/{asset}')
            state = json.loads(fetch(base + '/api/state'))
            if state['total'] or state['tasks']: raise SystemExit('A fresh copy must start with an empty board')
            say(f'Clean copy serves the panel, {len(assets)} assets and an empty board' + (' with the bundled Python' if python != sys.executable else ''))
        finally:
            child.terminate()
            child.wait(timeout=10)
        # The tests are development tools (they create venvs and call sh), so they use the maintainer's Python.
        if args.tests: run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests'], cwd=project, env=env)
    say('Archive verified.')


def git(repo, *args):
    result = subprocess.run(['git', *args], cwd=repo, capture_output=True, encoding='utf-8')
    if result.returncode: raise SystemExit(f'git {" ".join(args[:2])} failed: {result.stderr.strip()}')
    return result.stdout


def cmd_sync(args):
    """Mirror exactly the release manifest into a public Git working tree and stage it. Never commits."""
    repo = Path(args.repo).resolve()
    if not (repo / '.git').exists(): raise SystemExit('Target must be a Git working tree; clone the public repository first')
    if repo == ROOT or ROOT.is_relative_to(repo): raise SystemExit('Sync into a separate clone, never into this working folder')
    if git(repo, 'status', '--porcelain').strip() and not args.allow_dirty:
        raise SystemExit('The clone has uncommitted changes; commit or clean them first (or pass --allow-dirty)')
    entries = build_release.inventory(ROOT)
    tracked = set(filter(None, git(repo, 'ls-files', '-z').split('\0')))
    writes = [n for n, content in entries.items() if not (repo / n).is_file() or (repo / n).read_bytes() != content]
    removes = sorted(tracked - set(entries))
    say(f'{repo}: {len(writes)} to write, {len(removes)} to remove, {len(entries) - len(writes)} unchanged')
    for n in writes: say('  write  ' + n)
    for n in removes: say('  remove ' + n)
    if not args.apply:
        say('Preview only. Pull the clone first, then re-run with --apply to write, stage and audit it.')
        return
    for n in writes:
        (repo / n).parent.mkdir(parents=True, exist_ok=True)
        (repo / n).write_bytes(entries[n])
    if removes: git(repo, 'rm', '--quiet', '--', *removes)
    git(repo, 'add', '--', *entries)
    run([sys.executable, 'scripts/audit_public.py', '--source', '.', '--tracked'], cwd=repo)
    say(git(repo, 'diff', '--cached', '--stat').rstrip() or 'Nothing changed.')
    tag = 'v' + version()
    if git(repo, 'tag', '--list', tag).strip():
        # The version was released before: this sync only publishes unreleased work on the branch.
        say(f'Staged only. {tag} is already tagged, so commit and push the branch without a new tag:')
        say(f'  git -C "{repo}" commit -m "Describe the change"')
        say(f'  git -C "{repo}" push origin HEAD')
        say('Run "maintain.py bump" first when these changes should become a release.')
        return
    say('Staged only. Review "git diff --cached", then commit, tag and push yourself:')
    say(f'  git -C "{repo}" commit -m "Release {version()}"')
    say(f'  git -C "{repo}" tag -a {tag} -m "Agents Talk {version()}"')
    say(f'  git -C "{repo}" push origin HEAD {tag}')


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'): stream.reconfigure(encoding='utf-8', errors='backslashreplace')
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('status', help='Manifest, version pages and changes since the newest archive in dist/')
    p.add_argument('--since', help='Release ZIP or SOURCE-MANIFEST.json to compare against')
    p.add_argument('--strict', action='store_true', help='Exit 2 on missing or unlisted files or version mismatches')
    p.set_defaults(func=cmd_status)
    p = sub.add_parser('check', help='Run every release gate')
    p.add_argument('--browser', action='store_true', help='Also run the Playwright browser suites')
    p.set_defaults(func=cmd_check)
    p = sub.add_parser('bump', help='Set a new version in VERSION, package files, README links and CHANGELOG')
    p.add_argument('version')
    p.add_argument('--apply', action='store_true')
    p.set_defaults(func=cmd_bump)
    p = sub.add_parser('notes', help='Print release notes from CHANGELOG.md')
    p.add_argument('version', nargs='?')
    p.set_defaults(func=cmd_notes)
    p = sub.add_parser('build', help='Build the source ZIP, RELEASE-NOTES.md and SHA256SUMS.txt')
    p.add_argument('--output-dir', help='Defaults to dist/release-VERSION')
    p.add_argument('--portable', action='store_true',
                   help='Also build the Windows package with the pinned python.org runtime (downloaded once into .runtime/cache)')
    p.set_defaults(func=cmd_build)
    p = sub.add_parser('sums', help='Rewrite SHA256SUMS.txt after adding assets to a release folder')
    p.add_argument('directory')
    p.set_defaults(func=cmd_sums)
    p = sub.add_parser('verify', help='Verify a built ZIP in a clean temporary copy')
    p.add_argument('archive')
    p.add_argument('--tests', action='store_true', help='Also run the Python tests inside the clean copy')
    p.set_defaults(func=cmd_verify)
    p = sub.add_parser('sync', help='Mirror the exact manifest into a public Git clone and stage it (no commit or push)')
    p.add_argument('repo')
    p.add_argument('--apply', action='store_true')
    p.add_argument('--allow-dirty', action='store_true')
    p.set_defaults(func=cmd_sync)
    args = parser.parse_args()
    try:
        args.func(args)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as e:
        print('Rejected: ' + str(e), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
