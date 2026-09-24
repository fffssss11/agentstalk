import importlib.util
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('public_audit', ROOT / 'scripts/audit_public.py')
audit = importlib.util.module_from_spec(spec); spec.loader.exec_module(audit)


class PublicAuditTests(unittest.TestCase):
    def test_tokens_personal_paths_and_private_email_are_detected(self):
        for text in ['gh' + 'p_' + 'A' * 40, str(Path.home() / 'private'), 'person' + '@' + 'private.invalid']:
            self.assertTrue(audit.text_issues(text))

    def test_public_email_and_source_notes_are_accepted(self):
        self.assertEqual(audit.text_issues('123+author@users.noreply.github.com'), [])
        self.assertEqual(audit.text_issues('Source: README.md / PROTOCOL.md'), [])

    def test_office_notes_relationships_and_macros_are_checked(self):
        with tempfile.TemporaryDirectory(prefix='agents-talk-audit-') as tmp:
            path = Path(tmp) / 'fixture.pptx'
            with zipfile.ZipFile(path, 'w') as z:
                z.writestr('ppt/notesSlides/notesSlide1.xml', '<notes>' + str(Path.home() / 'private') + '</notes>')
                z.writestr('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship TargetMode="External" Target="' + 'file:' + '///private/data"/></Relationships>')
                z.writestr('ppt/vbaProject.bin', b'fixture')
            result = audit.inspect_artifact(path)
            self.assertFalse(result['ok']); self.assertEqual(len(result['findings']), 3)
            self.assertNotIn(str(Path.home()), str(result))

    def test_public_https_links_and_empty_deck_are_accepted(self):
        with tempfile.TemporaryDirectory(prefix='agents-talk-audit-') as tmp:
            path = Path(tmp) / 'fixture.pptx'
            with zipfile.ZipFile(path, 'w') as z:
                z.writestr('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship TargetMode="External" Target="https://github.com"/></Relationships>')
            self.assertTrue(audit.inspect_artifact(path)['ok'])

    def test_archive_checks_each_duplicate_member(self):
        with tempfile.TemporaryDirectory(prefix='agents-talk-audit-') as tmp:
            path = Path(tmp) / 'fixture.zip'
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                with zipfile.ZipFile(path, 'w') as z:
                    z.writestr('README.md', 'gh' + 'p_' + 'A' * 40)
                    z.writestr('README.md', 'public replacement')
            result = audit.inspect_artifact(path)
            categories = {issue for row in result['findings'] for issue in row['issues']}
            self.assertIn('credential-pattern', categories)
            self.assertIn('duplicate-archive-path', categories)

    def test_archive_checks_uppercase_and_extensionless_text(self):
        with tempfile.TemporaryDirectory(prefix='agents-talk-audit-') as tmp:
            path = Path(tmp) / 'fixture.zip'
            with zipfile.ZipFile(path, 'w') as z:
                z.writestr('config.JSON', 'gh' + 'p_' + 'A' * 40)
                z.writestr('LICENSE', 'person' + '@' + 'private.invalid')
            result = audit.inspect_artifact(path)
            self.assertEqual({r['part'] for r in result['findings']}, {'config.JSON', 'LICENSE'})

    def test_archive_checks_unsafe_directory_entries(self):
        with tempfile.TemporaryDirectory(prefix='agents-talk-audit-') as tmp:
            path = Path(tmp) / 'fixture.zip'
            with zipfile.ZipFile(path, 'w') as z:
                z.writestr('../outside/', b'')
            result = audit.inspect_artifact(path)
            self.assertFalse(result['ok'])
            self.assertIn('unsafe-archive-path', result['findings'][0]['issues'])

    def test_pdf_streams_do_not_masquerade_as_metadata(self):
        with tempfile.TemporaryDirectory(prefix='agents-talk-audit-') as tmp:
            path = Path(tmp) / 'fixture.pdf'
            value = ('person' + '@' + 'private.invalid').encode()
            path.write_bytes(b'%PDF-1.4\nstream\n' + value + b'\nendstream\n')
            result = audit.inspect_artifact(path)
            self.assertTrue(result['ok']); self.assertIn('dedicated parser', result['scope'])
            path.write_bytes(b'%PDF-1.4\n/Author (' + value + b')\n')
            self.assertFalse(audit.inspect_artifact(path)['ok'])
