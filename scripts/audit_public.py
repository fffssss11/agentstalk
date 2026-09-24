#!/usr/bin/env python3
"""Read-only checks of allowlisted source, tracked files and explicit release artifacts.

Pattern checks are best-effort; screenshots and factual claims still need human review.
Reports name the file and issue category without echoing matched secrets.
"""
import argparse
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_release import inventory


def text_issues(text):
    issues = []
    normalized = re.sub(r'/+', '/', text.replace('\\', '/'))
    if str(Path.home()).replace('\\', '/').lower() in normalized.lower():
        issues.append('local-home-path')
    component = r"[^/\s<>()\[\]'\"|$%]+"
    if re.search(r'(?:[A-Za-z]:/Users/|/Users/|/home/)' + component + '/', normalized, re.I):
        issues.append('personal-path')
    if re.search(r'\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bsk-[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', text):
        issues.append('credential-pattern')
    if re.search(r'file:' + r'/{2}|(?:Target|href)=["\'][A-Za-z]:[/\\]', text, re.I):
        issues.append('local-file-link')
    emails = re.findall(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', text)
    if any(not e.endswith(('@users.noreply.github.com', '@example.com', '@example.org')) for e in emails):
        issues.append('non-public-email')
    return sorted(set(issues))


def inspect_artifact(path):
    path = Path(path)
    findings = []
    data = path.read_bytes()
    if path.suffix.lower() in ('.zip', '.pptx'):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            seen = set()
            for member in archive.infolist():
                name = member.filename
                issues = []
                if name.startswith('/') or '..' in PurePosixPath(name).parts or '\\' in name or ':' in name:
                    issues.append('unsafe-archive-path')
                key = name.rstrip('/').casefold()
                if key in seen: issues.append('duplicate-archive-path')
                seen.add(key)
                if member.is_dir():
                    if issues: findings.append({'part': name, 'issues': sorted(set(issues))})
                    continue
                suffix = PurePosixPath(name).suffix.lower()
                if suffix in ('.xml', '.rels', '.md', '.py', '.js', '.cjs', '.json', '.ps1', '.txt', '.yml', '.yaml', '.html', '.css', '.svg', '.cmd', '.vbs', '.sh') or PurePosixPath(name).name.upper() in ('LICENSE', 'NOTICE', 'VERSION', 'COPYING', '.GITIGNORE', '.GITATTRIBUTES'):
                    # ZipInfo preserves each entry when duplicate names are present.
                    text = archive.read(member).decode('utf-8-sig')
                    issues.extend(text_issues(text))
                    if suffix == '.rels':
                        tree = ET.fromstring(text)
                        for relationship in tree:
                            if relationship.get('TargetMode') == 'External' and not relationship.get('Target', '').startswith('https://'):
                                issues.append('non-https-external-relationship')
                if path.suffix.lower() == '.pptx' and ('/embeddings/' in name.lower() or name.lower().endswith('vbaproject.bin')):
                    issues.append('embedded-file-or-macro')
                if issues: findings.append({'part': name, 'issues': sorted(set(issues))})
    elif path.suffix.lower() == '.pdf':
        # Binary image/compressed streams can coincidentally resemble credentials.
        # Only inspect the exposed PDF syntax here; use a PDF parser and visual
        # review separately for encoded metadata, streams, actions and attachments.
        exposed = re.sub(rb'\bstream(?:\r\n|\n|\r).*?\bendstream\b', b'stream endstream', data, flags=re.S)
        issues = text_issues(exposed.decode('latin-1'))
        if any(k in exposed for k in (b'/EmbeddedFile', b'/JavaScript', b'/Launch')): issues.append('active-or-embedded-pdf-content')
        if issues: findings.append({'part': 'metadata', 'issues': issues})
    else:
        issues = text_issues(data.decode('utf-8', errors='ignore'))
        if issues: findings.append({'part': 'content', 'issues': issues})
    result = {'file': path.name, 'findings': findings, 'ok': not findings}
    if path.suffix.lower() == '.pdf':
        result['scope'] = 'Exposed PDF syntax only. Encoded metadata and streams require a dedicated parser and visual review.'
    return result


def audit_source(root, tracked=False):
    root = Path(root).resolve()
    files = inventory(root)
    findings = []
    for name, data in files.items():
        if Path(name).suffix.lower() in ('.png', '.jpg', '.ico'): continue
        issues = text_issues(data.decode('utf-8-sig'))
        if issues: findings.append({'file': name, 'issues': issues})
    if tracked:
        raw = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root)
        actual = set(raw.decode('utf-8').rstrip('\0').split('\0'))
        if actual != set(files): findings.append({'file': 'git-index', 'issues': ['tracked-files-differ-from-release-allowlist']})
        identities = subprocess.check_output(['git', 'log', '--all', '--format=%ae%n%ce'], cwd=root).decode().splitlines()
        if any(not i.endswith('@users.noreply.github.com') for i in identities):
            findings.append({'file': 'git-history', 'issues': ['commit-email-not-private']})
    return {'files_checked': len(files), 'findings': findings, 'ok': not findings}


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'): stream.reconfigure(encoding='utf-8', errors='backslashreplace')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--tracked', action='store_true')
    parser.add_argument('--artifact', type=Path, action='append', default=[])
    args = parser.parse_args()
    if not args.source and not args.artifact: parser.error('Provide --source or --artifact')
    try:
        results = []
        if args.source: results.append(audit_source(args.source, args.tracked))
        results.extend(inspect_artifact(p) for p in args.artifact)
        ok = all(r['ok'] for r in results)
        print(json.dumps({'ok': ok, 'checks': results, 'note': 'Best-effort privacy checks; manual content and image review is still required.'}, ensure_ascii=False, indent=2))
        return 0 if ok else 2
    except (OSError, ValueError, zipfile.BadZipFile, ET.ParseError, subprocess.SubprocessError) as e:
        print('Public audit failed: ' + type(e).__name__, file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
