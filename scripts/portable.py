#!/usr/bin/env python3
"""Windows portable package: the exact release sources plus the official embeddable Python from python.org.

The runtime is pinned by version and by the SHA-256 that python.org publishes, and every runtime file is
kept byte-for-byte unchanged, so the package is reproducible and can be checked against python.org.
Nothing runs from the network at start-up: the download happens only when a maintainer builds.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_release  # noqa: E402

PLATFORM = 'windows-x64'
PYTHON_VERSION = '3.13.15'
RUNTIME_URL = f'https://www.python.org/ftp/python/{PYTHON_VERSION}/python-{PYTHON_VERSION}-embed-amd64.zip'
# Published by python.org for the file above (https://www.python.org/api/v2/downloads/release_file/).
RUNTIME_SHA256 = 'd1f04d990aee1253d8569e8e5104e30fa9f5fa830899f14843448872d936a2cf'
RUNTIME_DIR = 'runtime/python'
CACHE = ROOT / '.runtime' / 'cache'


def runtime_archive(cache=CACHE):
    """The pinned python.org archive: downloaded once into the cache, verified on every use."""
    path = Path(cache) / RUNTIME_URL.rsplit('/', 1)[1]
    if not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(RUNTIME_URL, timeout=120) as response:
            data = response.read()
        partial = path.with_name(path.name + '.part')
        partial.write_bytes(data)
        partial.replace(path)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != RUNTIME_SHA256:
        raise ValueError(f'{path} does not match the pinned python.org SHA-256; delete it and build again')
    return data


def runtime_files(archive):
    files = {}
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        for info in z.infolist():
            if info.is_dir(): continue
            name = PurePosixPath(info.filename)
            if name.is_absolute() or '..' in name.parts or '\\' in info.filename:
                raise ValueError('Unsafe path in the Python runtime archive: ' + info.filename)
            files[f'{RUNTIME_DIR}/{name}'] = z.read(info)
    if f'{RUNTIME_DIR}/python.exe' not in files: raise ValueError('The runtime archive has no python.exe')
    return files


def build(root, output, runtime):
    """Sources from release-files.json plus the unchanged runtime; SOURCE-MANIFEST.json lists both."""
    manifest = build_release.build(root)
    sources = build_release.inventory(root)
    bundled = runtime_files(runtime)
    manifest['files'] += [{'path': p, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()} for p, b in sorted(bundled.items())]
    manifest['platform'] = PLATFORM
    manifest['runtime'] = {'python': PYTHON_VERSION, 'source': RUNTIME_URL, 'sha256': RUNTIME_SHA256}
    top = f'{build_release.ARCHIVE_NAME}-{manifest["version"]}-{PLATFORM}'
    entries = {**sources, **bundled, 'SOURCE-MANIFEST.json': build_release.manifest_bytes(manifest)}
    return {**manifest, **build_release.write_archive(output, top, entries)}


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'): stream.reconfigure(encoding='utf-8', errors='backslashreplace')
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', type=Path, help='Defaults to dist/agentstalk-VERSION-windows-x64.zip')
    args = parser.parse_args()
    try:
        version = (ROOT / 'VERSION').read_text(encoding='utf-8').strip()
        output = args.output or ROOT / 'dist' / f'{build_release.ARCHIVE_NAME}-{version}-{PLATFORM}.zip'
        result = build(ROOT, output, runtime_archive())
        print(json.dumps({k: result[k] for k in ('version', 'platform', 'runtime', 'archive', 'bytes', 'checksum')}, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as e:
        print('Portable build rejected: ' + str(e), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
