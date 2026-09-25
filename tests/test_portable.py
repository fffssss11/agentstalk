"""Windows portable package, built from a stand-in runtime archive so the tests never download Python."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import audit_public  # noqa: E402
import build_release  # noqa: E402
import portable  # noqa: E402

# Assembled at run time: this file is released too, and the privacy scan it exercises reads it.
AUTHOR_ADDRESS = 'someone' + '@' + 'example.net'


def stand_in_runtime(extra=None):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as z:
        z.writestr('python.exe', b'MZ stand-in interpreter')
        z.writestr('python313._pth', 'python313.zip\r\n.\r\n')
        z.writestr('python313.zip', b'PK stand-in standard library')
        # Like the real runtime, bundled third-party licenses name their authors.
        z.writestr('LICENSE.txt', f'Includes bzip2, written by {AUTHOR_ADDRESS}\n')
        for name, content in (extra or {}).items(): z.writestr(name, content)
    return buffer.getvalue()


class PortableTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agents-talk-portable-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.project = self.base / 'project'
        for name, content in build_release.inventory(ROOT).items():
            (self.project / name).parent.mkdir(parents=True, exist_ok=True)
            (self.project / name).write_bytes(content)
        self.version = (self.project / 'VERSION').read_text(encoding='utf-8').strip()

    def test_package_holds_the_exact_sources_and_the_unchanged_runtime(self):
        runtime = stand_in_runtime()
        archive = self.base / 'a.zip'
        portable.build(self.project, archive, runtime)
        top = f'{build_release.ARCHIVE_NAME}-{self.version}-{portable.PLATFORM}/'
        with zipfile.ZipFile(archive) as z:
            names = z.namelist()
            self.assertTrue(all(n.startswith(top) for n in names))
            self.assertEqual(z.read(top + 'runtime/python/python.exe'), b'MZ stand-in interpreter')
            self.assertEqual(z.read(top + 'hub.py'), (self.project / 'hub.py').read_bytes())
            manifest = json.loads(z.read(top + 'SOURCE-MANIFEST.json'))
            self.assertEqual({f['path'] for f in manifest['files']}, {n[len(top):] for n in names} - {'SOURCE-MANIFEST.json'})
            for row in manifest['files']:
                self.assertEqual(hashlib.sha256(z.read(top + row['path'])).hexdigest(), row['sha256'])
        self.assertEqual(manifest['platform'], portable.PLATFORM)
        self.assertEqual(manifest['runtime'], {'python': portable.PYTHON_VERSION, 'source': portable.RUNTIME_URL,
                                               'sha256': portable.RUNTIME_SHA256})
        # Reproducible, with an LF checksum file like the source package.
        portable.build(self.project, self.base / 'b.zip', runtime)
        self.assertEqual(archive.read_bytes(), (self.base / 'b.zip').read_bytes())
        self.assertEqual((self.base / 'a.zip.sha256').read_bytes(),
                         f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  a.zip\n'.encode())
        with self.assertRaises(ValueError): portable.build(self.project, archive, runtime)

    def test_privacy_scan_checks_sources_but_not_the_pinned_runtime_texts(self):
        archive = self.base / 'package.zip'
        portable.build(self.project, archive, stand_in_runtime())
        report = audit_public.inspect_artifact(archive)
        self.assertTrue(report['ok'], report)
        self.assertIn('runtime/python', report['runtime'])
        # A personal address in a released source file is still reported.
        (self.project / 'docs' / 'user-guide.md').write_text(f'联系 {AUTHOR_ADDRESS}\n', encoding='utf-8')
        leaked = self.base / 'leaked.zip'
        portable.build(self.project, leaked, stand_in_runtime())
        self.assertFalse(audit_public.inspect_artifact(leaked)['ok'])

    def test_runtime_is_verified_and_unsafe_archives_are_refused(self):
        cache = self.base / 'cache'
        cache.mkdir()
        (cache / portable.RUNTIME_URL.rsplit('/', 1)[1]).write_bytes(b'not the python.org archive')
        with self.assertRaises(ValueError): portable.runtime_archive(cache)
        with self.assertRaises(ValueError): portable.runtime_files(stand_in_runtime({'../outside.txt': 'x'}))
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as z: z.writestr('README.txt', 'no interpreter')
        with self.assertRaises(ValueError): portable.runtime_files(buffer.getvalue())


if __name__ == '__main__':
    unittest.main()
