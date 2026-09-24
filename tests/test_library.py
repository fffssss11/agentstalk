"""Projects, session labels and panel asset routing. Uses temporary state only."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
os.environ['AGENTS_TALK_CONFIG'] = str(ROOT / 'config.example.json')
spec = importlib.util.spec_from_file_location('hub', ROOT / 'hub.py')
hub = importlib.util.module_from_spec(spec); spec.loader.exec_module(hub)


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agents-talk-library-')
        hub.DATA = Path(self.temp.name); hub.BOARD = hub.DATA / 'board.jsonl'

    def tearDown(self): self.temp.cleanup()

    def create_session(self, **kw):
        return hub.session_action({'action': 'create', 'title': kw.pop('title', '整理测试'), **kw})['session']

    def test_projects_group_sessions_without_touching_the_event_log(self):
        sid = self.create_session()
        before = hub.BOARD.read_bytes()
        pid = hub.library_action({'action': 'project_create', 'name': '检索工具', 'color': 'teal',
                                  'defaults': {'mode': 'roundtable', 'lead': 'codex', 'participants': ['codex', 'claude']}})['project']
        hub.library_action({'action': 'session_update', 'session': sid, 'project': pid, 'pinned': True, 'title': '增量索引迭代'})
        self.assertEqual(hub.BOARD.read_bytes(), before, 'library edits must never append agent-visible events')
        state = hub.read_state(sid)
        self.assertEqual(state['library']['projects'][0]['name'], '检索工具')
        self.assertEqual(state['library']['projects'][0]['defaults']['lead'], 'codex')
        self.assertEqual(state['library']['sessions'][sid], {'project': pid, 'pinned': True, 'title': '增量索引迭代'})
        self.assertEqual(state['session']['title'], '整理测试', 'renaming only changes the panel label')
        self.assertEqual(state['session_activity'][sid]['messages'], 1)
        # Clearing every label removes the entry instead of keeping empty records.
        hub.library_action({'action': 'session_update', 'session': sid, 'project': None, 'pinned': False, 'title': ''})
        self.assertNotIn(sid, hub.read_state(sid)['library']['sessions'])

    def test_deleting_a_project_keeps_its_sessions_as_standalone(self):
        first, second = self.create_session(title='A'), self.create_session(title='B')
        pid = hub.library_action({'action': 'project_create', 'name': '临时项目'})['project']
        hub.library_action({'action': 'session_update', 'session': first, 'project': pid})
        hub.library_action({'action': 'session_update', 'session': second, 'project': pid, 'archived': True})
        hub.library_action({'action': 'project_delete', 'project': pid})
        labels = hub.read_state()['library']['sessions']
        self.assertNotIn(first, labels)
        self.assertEqual(labels[second], {'archived': True})
        self.assertEqual(len(hub.read_state()['sessions']), 3, 'history stays intact')

    def test_validation_rejects_unknown_targets_and_bad_fields(self):
        sid = self.create_session()
        bad = [
            {'action': 'project_create', 'name': ''},
            {'action': 'project_create', 'name': 'x' * 61},
            {'action': 'project_create', 'name': 'ok', 'color': '#123456'},
            {'action': 'project_create', 'name': 'ok', 'defaults': {'lead': 'pi'}},
            {'action': 'project_create', 'name': 'ok', 'defaults': {'participants': ['codex'], 'lead': 'claude'}},
            {'action': 'project_update', 'project': 'p-missing', 'name': 'x'},
            {'action': 'session_update', 'session': 'missing', 'pinned': True},
            {'action': 'session_update', 'session': sid, 'project': 'p-missing'},
            {'action': 'session_update', 'session': sid, 'pinned': 'yes'},
            {'action': 'session_update', 'session': sid, 'title': 'a\x00b'},
            {'action': 'unknown'},
        ]
        for data in bad:
            with self.subTest(data=data), self.assertRaises(hub.Reject):
                hub.library_action(data)
        self.assertFalse((hub.DATA / '.library.json').exists(), 'rejected edits must not create state')

    def test_request_ids_make_retries_safe(self):
        first = hub.library_action({'action': 'project_create', 'name': '重试', 'request_id': 'lib-1'})
        again = hub.library_action({'action': 'project_create', 'name': '重试', 'request_id': 'lib-1'})
        self.assertEqual(first, again)
        self.assertEqual(len(hub.read_state()['library']['projects']), 1)
        with self.assertRaises(hub.Reject):
            hub.library_action({'action': 'project_create', 'name': '另一个意图', 'request_id': 'lib-1'})

    def test_corrupt_library_keeps_board_readable_and_refuses_writes(self):
        sid = self.create_session()
        damaged = b'{"projects": [broken'
        (hub.DATA / '.library.json').write_bytes(damaged)
        state = hub.read_state(sid)
        self.assertIn('library_error', state)
        self.assertEqual(state['library'], {'projects': [], 'sessions': {}})
        with self.assertRaises(hub.Reject):
            hub.library_action({'action': 'project_create', 'name': '不应写入'})
        with self.assertRaises(hub.Reject):
            self.create_session(project='p-anything')
        self.assertEqual((hub.DATA / '.library.json').read_bytes(), damaged, 'the damaged file is preserved for recovery')

    def test_create_session_with_lead_and_project(self):
        pid = hub.library_action({'action': 'project_create', 'name': '默认值'})['project']
        sid = self.create_session(lead='codex', project=pid, participants=['codex', 'reasonix'], mode='roundtable')
        state = hub.read_state(sid)
        self.assertEqual((state['session']['lead'], state['session']['mode']), ('codex', 'roundtable'))
        self.assertEqual(state['session']['participants'], ['codex', 'reasonix'])
        self.assertEqual(state['library']['sessions'][sid], {'project': pid})
        # Without explicit participants the chosen lead joins the configured defaults.
        other = self.create_session(title='默认名单', lead='zcode')
        self.assertIn('zcode', hub.read_state(other)['session']['participants'])
        count = len(hub.read_state()['sessions'])
        for data in ({'lead': 'pi'}, {'project': 'p-missing'}, {'lead': 'claude', 'participants': ['codex']}):
            with self.subTest(data=data), self.assertRaises(hub.Reject):
                self.create_session(**data)
        self.assertEqual(len(hub.read_state()['sessions']), count, 'rejected creates must not add sessions')

    def test_agents_never_receive_library_metadata(self):
        sid = self.create_session()
        pid = hub.library_action({'action': 'project_create', 'name': 'PRIVATE_PROJECT_LABEL'})['project']
        hub.library_action({'action': 'session_update', 'session': sid, 'project': pid, 'title': 'PRIVATE_TITLE'})
        view = hub.agent_context(hub.derive(hub.load(), hub.config(), sid), 'claude')
        text = json.dumps(view, ensure_ascii=False)
        self.assertNotIn('PRIVATE_PROJECT_LABEL', text)
        self.assertNotIn('PRIVATE_TITLE', text)


class PanelRoutingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agents-talk-routes-')
        hub.DATA = Path(self.temp.name); hub.BOARD = hub.DATA / 'board.jsonl'
        self.server = hub.ThreadingHTTPServer(('127.0.0.1', 0), hub.Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.temp.cleanup()

    def get(self, path, **headers):
        return urllib.request.urlopen(urllib.request.Request(self.base + path, headers=headers), timeout=5)

    def test_every_allowlisted_asset_exists_and_nothing_else_is_served(self):
        for name, mime in hub.WEB_FILES.items():
            with self.subTest(asset=name), self.get('/' + name) as r:
                self.assertTrue(r.headers['Content-Type'].startswith(mime))
                self.assertIn("script-src 'self'", r.headers['Content-Security-Policy'])
                self.assertEqual(r.read(), (ROOT / 'web' / name).read_bytes())
        with self.get('/') as r:
            self.assertIn('display-capture=(self)', r.headers['Permissions-Policy'])
            self.assertIn('camera=()', r.headers['Permissions-Policy'])
        for path in ('/app.js', '/style.css', '/js/unknown.js', '/js/../../hub.py', '/%2e%2e/config.json', '/web/index.html'):
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError) as error:
                self.get(path)
            self.assertEqual(error.exception.code, 404)

    def test_index_references_only_allowlisted_assets(self):
        html = (ROOT / 'web' / 'index.html').read_text(encoding='utf-8')
        import re
        referenced = set(re.findall(r'(?:src|href)="/([^"#?]+)"', html))
        self.assertTrue(referenced, 'index must load the panel assets')
        self.assertLessEqual(referenced - {'guide'}, set(hub.WEB_FILES))
        scripts = re.findall(r'<script src="/(js/[a-z]+\.js)" defer></script>', html)
        self.assertEqual(sorted(scripts), sorted(n for n in hub.WEB_FILES if n.startswith('js/')), 'every script is loaded once')

    def test_library_writes_require_the_page_token(self):
        with self.get('/api/state') as r:
            state = json.load(r)
        payload = json.dumps({'action': 'project_create', 'name': 'HTTP 项目'}).encode()
        request = urllib.request.Request(self.base + '/api/library', data=payload, headers={'Content-Type': 'application/json'})
        with self.assertRaises(urllib.error.HTTPError):
            urllib.request.urlopen(request, timeout=5)
        request.add_header('X-Agents-Token', state['csrf'])
        with urllib.request.urlopen(request, timeout=5) as r:
            self.assertTrue(json.load(r)['project'].startswith('p-'))
        with self.get('/api/state') as r:
            self.assertEqual(json.load(r)['library']['projects'][0]['name'], 'HTTP 项目')


if __name__ == '__main__':
    unittest.main()
