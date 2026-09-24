import concurrent.futures
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
os.environ['AGENTS_TALK_CONFIG'] = str(ROOT / 'config.example.json')
spec = importlib.util.spec_from_file_location('hub', ROOT / 'hub.py')
hub = importlib.util.module_from_spec(spec); spec.loader.exec_module(hub)

class HubTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agents-talk-test-')
        hub.DATA = Path(self.temp.name); hub.BOARD = hub.DATA / 'board.jsonl'
    def tearDown(self): self.temp.cleanup()
    def post(self, who='claude', typ='say', **kw):
        return hub.post({'session':'main','from':who,'type':typ,'body':'test evidence',**kw})
    def task(self, **kw): return self.post(**{'typ':'task', 'task':'T-1', 'to':['codex'], **kw})
    def acknowledge(self, who='codex'):
        for m in hub.pending(hub.load(),'main',who): self.post(who,'ack',reply_to=m['id'])
    def test_task_lifecycle_independent_review(self):
        self.task()
        with self.assertRaises(hub.Reject): self.post('reasonix','claim',task='T-1')
        self.post('codex','claim',task='T-1')
        self.post('codex','done',task='T-1')
        with self.assertRaises(hub.Reject): self.post('codex','review',task='T-1',verdict='pass')
        self.post('claude','review',task='T-1',verdict='fail')
        self.post('codex','claim',task='T-1')
        self.post('codex','done',task='T-1')
        self.post('claude','review',task='T-1',verdict='pass')
        self.assertEqual(hub.read_state()['tasks'][0]['state'],'已完成')
    def test_intervention_ack_and_pause(self):
        self.task()
        m=hub.post({'session':'main','type':'intervention','to':['codex'],'body':'new constraint'},human=True)
        with self.assertRaises(hub.Reject): self.post('codex','claim',task='T-1')
        self.acknowledge(); self.post('codex','claim',task='T-1')
        self.assertEqual(hub.read_state()['receipts'][m['id']],['codex'])
        hub.session_action({'session':'main','action':'paused'})
        self.acknowledge()
        with self.assertRaises(hub.Reject): self.post('codex','done',task='T-1')
        hub.session_action({'session':'main','action':'active'})
        with self.assertRaises(hub.Reject): self.post('codex','done',task='T-1')
        self.acknowledge();self.post('codex','done',task='T-1')
    def test_media_provider_and_capability_gate(self):
        with self.assertRaises(hub.Reject): self.task(kind='video_generate',to=['reasonix'])
        self.task(kind='video_generate')
        with self.assertRaises(hub.Reject): self.post('codex','claim',task='T-1')
        self.post('codex','blocked',task='T-1')
        self.post('codex','capability',kind='video_generate',availability='available')
        self.post('codex','claim',task='T-1')
    def test_edit_requires_image(self):
        with self.assertRaises(hub.Reject): self.task(kind='image_edit')
        a=hub.save_attachment('ref.png',b'\x89PNG\r\n\x1a\nfixture')
        self.task(kind='image_edit',attachments=[a['id']])
    def test_files_canonicalized_and_cross_session_locks(self):
        self.post('codex','lock',files=['workspace/A.py'])
        alias='workspace/./a.py' if os.name=='nt' else 'workspace/./A.py'
        with self.assertRaises(hub.Reject): self.post('claude','lock',files=[alias])
        sid=hub.session_action({'action':'create','title':'Second'})['session']
        with self.assertRaises(hub.Reject): self.post('codex','lock',files=[alias],session=sid)
        with self.assertRaises(hub.Reject): self.post('claude','lock',files=['workspace/../hub.py'])
        self.post('codex','unlock'); self.post('claude','lock',files=[alias])
    def test_parallel_cli_lock_has_one_winner(self):
        env={**os.environ,'AGENTS_TALK_DATA':self.temp.name}
        def run(a):
            return subprocess.run([sys.executable,str(ROOT/'hub.py'),'post','--from',a,'--session','main','--type','lock','--files','workspace/concurrent.py','--body','test'],env=env,capture_output=True).returncode
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            codes=list(executor.map(run,['claude','codex','reasonix','zcode']))
        self.assertEqual(sorted(codes),[0,2,2,2]);self.assertEqual(len(hub.load()),1)
    def test_sessions_retained_and_ended_write_rejected(self):
        self.post(body='original history')
        sid=hub.session_action({'action':'create','title':'Second'})['session']
        self.assertEqual(len(hub.read_state('main')['messages']),1)
        self.assertEqual(hub.read_state(sid)['total'],1)
        hub.session_action({'session':'main','action':'ended'})
        with self.assertRaises(hub.Reject): self.post(body='late write')
        self.post('claude','unlock')
    def test_dedup_and_corrupt_log(self):
        first=self.post(request_id='same-request');second=self.post(request_id='same-request')
        self.assertEqual(first['id'],second['id']);self.assertEqual(len(hub.load()),1)
        with hub.BOARD.open('ab') as f:f.write(b'{broken')
        with self.assertRaisesRegex(hub.Reject,'2'): self.post()
    def test_read_tail_does_not_consume_unread(self):
        for i in range(5):self.post(body=str(i))
        env={**os.environ,'AGENTS_TALK_DATA':self.temp.name,'PYTHONUTF8':'1'}
        base=[sys.executable,str(ROOT/'hub.py')]
        subprocess.run(base+['read','--agent','codex','--session','main','--tail','1'],env=env,capture_output=True,check=True)
        r=subprocess.run(base+['wait','--agent','codex','--session','main','--timeout','1'],env=env,capture_output=True,check=True)
        self.assertEqual(len(json.loads(r.stdout)['messages']),5)
        r=subprocess.run(base+['wait','--agent','codex','--session','main','--timeout','1','--poll','.1'],env=env,capture_output=True)
        self.assertEqual(r.returncode,3)
    def test_http_validation_export_upload_and_identity(self):
        server=hub.ThreadingHTTPServer(('127.0.0.1',0),hub.Handler)
        server.daemon_threads=True
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        def req(path, data=None, **headers):
            return urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers=headers),timeout=5)
        try:
            with req('/api/state') as r:state=json.load(r)
            payload=json.dumps({'session':'main','type':'say','body':'<script>alert(1)</script>','from':'claude'}).encode()
            with self.assertRaises(urllib.error.HTTPError):req('/api/post',payload)
            with self.assertRaises(urllib.error.HTTPError):req('/api/post',payload,**{'X-Agents-Token':state['csrf'],'Origin':'https://evil.example'})
            with req('/api/post',payload,**{'X-Agents-Token':state['csrf']}) as r:self.assertEqual(json.load(r)['from'],'human')
            with req('/api/upload?name=unsafe.html',b'<script>bad</script>',**{'X-Agents-Token':state['csrf']}) as r:a=json.load(r)
            with req(a['url']) as r:self.assertEqual(r.headers['Content-Type'],'application/octet-stream');self.assertIn('attachment',r.headers['Content-Disposition'])
            with req('/api/export?session=main') as r:self.assertEqual(json.load(r)['total'],1)
            with self.assertRaises(urllib.error.HTTPError):req('/../../config.json')
            for fields in (dict(task=[]), dict(attachments=[{}]), dict(files=[{}]), dict(kind={})):
                with self.subTest(invalid_http_fields=fields):
                    malformed = json.dumps({'session':'main','type':'say','body':'rejected',**fields}).encode()
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        req('/api/post', malformed, **{'X-Agents-Token':state['csrf']})
                    self.assertEqual(error.exception.code, 400)
                    self.assertTrue(json.load(error.exception)['error'])
            with req('/api/state') as r:self.assertEqual(json.load(r)['total'],1)
        finally:server.shutdown();server.server_close();thread.join()

    def view(self, agent='codex', **kw):
        return hub.agent_context(hub.derive(hub.load(),hub.config(),'main'),agent,**kw)

    def test_focused_scope_excludes_peer_tasks_and_broadcasts(self):
        self.task(body='OWN-TASK')
        self.task(task='T-2',to=['reasonix'],body='PEER-SECRET')
        self.post('reasonix','claim',task='T-2',body='PEER-CLAIM')
        self.post('reasonix','progress',task='T-2',body='PEER-HISTORY')
        self.post('reasonix','say',body='PEER-BROADCAST')
        self.post('reasonix','answer',to=['codex'],body='PEER-DIRECT')
        self.post('claude','say',to=['reasonix'],body='LEAD-PRIVATE')
        self.post('claude','say',to=['codex'],body='LEAD-OWN')
        self.post('claude','say',body='LEAD-BROADCAST')
        self.task(task='T-3',to=['claude'],body='LEAD-TASK')
        v=self.view(full=True)
        text=json.dumps(v)
        for secret in ['PEER-SECRET','PEER-CLAIM','PEER-HISTORY','PEER-BROADCAST','PEER-DIRECT','LEAD-PRIVATE']:
            self.assertNotIn(secret,text)
        for expected in ['OWN-TASK','LEAD-OWN','LEAD-BROADCAST','LEAD-TASK']:self.assertIn(expected,text)
        self.assertEqual({t['id'] for t in v['tasks']},{'T-1','T-3'})
        with self.assertRaises(hub.Reject):self.view(task_id='T-2',full=True)
        self.assertEqual(len(self.view('claude')['tasks']),3)

    def test_toggle_delta_rebuild_and_persistence(self):
        self.task(task='PEER',to=['reasonix'],body='TEAM-DELIVERY')
        rev=self.view()['context']['revision']
        hub.session_action({'session':'main','action':'settings','shared_context':True})
        v=self.view(since=rev)
        self.assertTrue(v['context']['refresh']);self.assertEqual(v['tasks'][0]['id'],'PEER')
        rev=v['context']['revision']
        self.assertEqual(self.view(since=rev)['tasks'],[])
        self.assertEqual(self.view(since=rev)['messages'],[])
        hub.session_action({'session':'main','action':'settings','mode':'roundtable'})
        self.assertTrue(hub.read_state()['session']['shared_context'])
        hub.session_action({'session':'main','action':'settings','shared_context':False})
        v=self.view(since=rev,full=True)
        self.assertTrue(v['context']['refresh']);self.assertNotIn('TEAM-DELIVERY',json.dumps(v))
        self.assertFalse(hub.read_state()['session']['shared_context'])
        for bad in ['false',0,None,{}]:
            with self.assertRaises(hub.Reject):hub.session_action({'session':'main','action':'settings','shared_context':bad})
        sid=hub.session_action({'action':'create','title':'independent','shared_context':True})['session']
        self.assertTrue(hub.read_state(sid)['session']['shared_context'])
        self.assertFalse(hub.read_state('main')['session']['shared_context'])

    def test_digest_sources_details_and_history_reduction(self):
        t=self.task()
        self.post('codex','claim',task='T-1')
        for i in range(60):self.post('codex','progress',task='T-1',body='step '+str(i)+'x'*1000)
        done=self.post('codex','done',task='T-1',body='FULL-EVIDENCE '+('z'*3000),
                       summary='实现完成',result='workspace/main.py',verification='8 checks passed',blockers='')
        self.post('claude','review',task='T-1',verdict='fail',body='missing boundary check')
        v=self.view();digest=v['tasks'][0]
        self.assertEqual(digest['state'],'被打回')
        self.assertEqual(digest['sources']['verification'],done['id'])
        self.assertNotIn('log',digest);self.assertEqual(digest['verification'],'8 checks passed')
        self.assertLess(len(json.dumps(v)),len(json.dumps(hub.read_state()))//5)
        self.assertIn('FULL-EVIDENCE',json.dumps(self.view(task_id='T-1',full=True)))
        msg=self.post('claude','say',body='a'*1200+'END-EVIDENCE')
        v=self.view();self.assertTrue(v['messages'][-1]['truncated'])
        self.assertTrue(self.view(message_id=msg['id'],full=True)['messages'][0]['body'].endswith('END-EVIDENCE'))
        initial=self.task(task='T-2');self.assertEqual(self.view(task_id='T-2')['tasks'][0]['source_id'],initial['id'])

    def test_task_pagination_and_incremental_changes(self):
        for i in range(35):self.task(task='T-'+str(i))
        first=self.view();second=self.view(offset=30)
        self.assertEqual(first['context']['next_task_offset'],30)
        self.assertEqual(len(second['tasks']),5)
        self.assertEqual(len({t['id'] for t in first['tasks']+second['tasks']}),35)
        rev=first['context']['revision']
        self.post('codex','claim',task='T-5')
        self.assertEqual([t['id'] for t in self.view(since=rev)['tasks']],['T-5'])

    def test_human_controls_and_own_reviews_survive_scope_filter(self):
        self.task();self.post('codex','claim',task='T-1');self.post('codex','done',task='T-1')
        self.post('claude','review',task='T-1',verdict='pass',body='OWN-REVIEW')
        m=hub.post({'session':'main','type':'intervention','body':'HUMAN-PRIORITY'},human=True)
        v=self.view();self.assertEqual(v['pending_interventions'][0]['id'],m['id'])
        self.assertIn('OWN-REVIEW',json.dumps(v));self.assertEqual(v['tasks'][0]['state'],'已完成')

    def test_cli_scope_and_wait_pages_never_skip(self):
        env={**os.environ,'AGENTS_TALK_DATA':self.temp.name,'PYTHONUTF8':'1'}
        def run(command,*flags):
            r=subprocess.run([sys.executable,str(ROOT/'hub.py'),command,'--agent','codex','--session','main',*flags],env=env,capture_output=True,check=True)
            return json.loads(r.stdout)
        self.task(task='PEER',to=['reasonix'],body='HIDDEN-PEER')
        for i in range(43):self.post(body='MSG-'+str(i))
        for cmd in ['read','status','tasks']:self.assertNotIn('HIDDEN-PEER',json.dumps(run(cmd,'--full')))
        pages=[run('wait','--timeout','1') for _ in range(3)]
        ids=[m['id'] for p in pages for m in p['messages']]
        self.assertEqual(len(ids),43);self.assertEqual(len(set(ids)),43)
        self.assertEqual(pages[0]['context']['unread_remaining'],23)
        hub.session_action({'session':'main','action':'settings','shared_context':True})
        self.assertIn('HIDDEN-PEER',json.dumps(run('wait','--timeout','1')))

    def test_participants_default_and_codex_lead_cannot_assign_zcode(self):
        hub.session_action({'session':'main','action':'settings','lead':'codex'})
        self.assertNotIn('zcode',hub.read_state()['session']['participants'])
        for typ in ['task','question']:
            with self.assertRaisesRegex(hub.Reject,'未参与'):
                self.post('codex',typ,to=['zcode'],task='ZCODE-TASK')
        with self.assertRaisesRegex(hub.Reject,'未参与'):self.post('zcode','join')
        self.assertFalse(self.view('zcode')['participation']['enabled'])
        self.assertFalse(hub.read_state()['agents']['zcode']['enabled'])
        hub.session_action({'session':'main','action':'settings','participants':['codex','claude','reasonix','zcode']})
        self.post('zcode','join');self.post('codex','task',task='ZCODE-TASK',to=['zcode'])
        self.post('zcode','claim',task='ZCODE-TASK')

    def test_participants_validation_persistence_and_independent_review(self):
        for members in [[],['zcode'],['claude','bogus'],'claude',None]:
            with self.assertRaises(hub.Reject):hub.session_action({'session':'main','action':'settings','participants':members})
        hub.session_action({'session':'main','action':'settings','participants':['claude','reasonix']})
        hub.session_action({'session':'main','action':'settings','shared_context':True})
        self.assertEqual(hub.read_state()['session']['participants'],['claude','reasonix'])
        self.task(to=['claude']);self.post('claude','claim',task='T-1');self.post('claude','done',task='T-1')
        self.post('reasonix','review',task='T-1',verdict='pass')
        self.assertEqual(hub.read_state()['tasks'][0]['state'],'已完成')
        sid=hub.session_action({'action':'create','title':'new'})['session']
        self.assertNotIn('zcode',hub.read_state(sid)['session']['participants'])

    def test_reassign_disabled_member_retains_history(self):
        hub.session_action({'session':'main','action':'settings','participants':['claude','codex','reasonix','zcode']})
        self.task(to=['zcode'],body='Original deliverable')
        hub.session_action({'session':'main','action':'settings','participants':['claude','codex','reasonix']})
        self.assertEqual(self.view('claude')['participation']['tasks_needing_reassignment'],['T-1'])
        hub.session_action({'session':'main','action':'reassign','task':'T-1','to':'codex'})
        task=hub.read_state()['tasks'][0]
        self.assertEqual(task['owner'],'codex');self.assertEqual(task['body'],'Original deliverable')
        self.assertEqual(task['log'][-1]['type'],'reassign')
        self.post('codex','claim',task='T-1')
        with self.assertRaises(hub.Reject):hub.session_action({'session':'main','action':'reassign','task':'T-1','to':'claude'})

    def test_disabled_agent_can_release_but_not_work(self):
        self.post('codex','lock',files=['workspace/x.py'])
        hub.session_action({'session':'main','action':'settings','participants':['claude','reasonix']})
        with self.assertRaises(hub.Reject):self.post('codex','lock',files=['workspace/y.py'])
        self.post('codex','unlock');self.assertEqual(hub.read_state()['locks'],{})

    def usage(self, who='codex', sid='main', **kw):
        return hub.post({'session':sid,'from':who,'type':'usage','usage_id':'request-1',
            'input_tokens':1000,'output_tokens':300,'cached_input_tokens':400,'reasoning_output_tokens':100,
            'provider':'fixture-provider','model':'fixture-model','usage_source':'isolated response usage fixture',**kw})

    def test_token_usage_reports_exact_totals_and_dedup(self):
        self.assertIsNone(hub.read_state()['token_usage']['codex']['total'])
        self.post('codex',body='中文 text')
        m=self.usage();self.assertEqual(self.usage()['id'],m['id'])
        with self.assertRaises(hub.Reject):self.usage(input_tokens=2000)
        self.usage(usage_id='request-2',input_tokens=0,output_tokens=0,cached_input_tokens=0,reasoning_output_tokens=0)
        u=hub.read_state()['token_usage']['codex']
        self.assertEqual((u['input'],u['output'],u['total'],u['cached_input'],u['reasoning_output'],u['reports']),(1000,300,1300,400,100,2))
        self.assertGreater(u['board_output_estimate'],0)
        self.assertIsNone(hub.read_state()['token_usage']['reasonix']['total'])

    def test_token_usage_rejects_invalid_and_accepts_late_reports(self):
        for kw in [{'input_tokens':-1},{'output_tokens':True},{'cached_input_tokens':1001},
                   {'reasoning_output_tokens':301},{'usage_source':''},{'usage_id':None},{'input_tokens':None}]:
            with self.assertRaises(hub.Reject):self.usage(**kw)
        hub.session_action({'session':'main','action':'ended'})
        self.usage();self.assertEqual(hub.read_state()['token_usage']['codex']['total'],1300)
        self.usage('zcode');self.assertEqual(hub.read_state()['token_usage']['zcode']['reports'],1)

    def test_token_usage_session_isolation_and_agent_context_scope(self):
        self.usage();self.usage('claude',input_tokens=10,output_tokens=20,cached_input_tokens=0,reasoning_output_tokens=0)
        sid=hub.session_action({'action':'create','title':'Second usage session'})['session']
        self.usage(sid=sid)
        self.assertEqual(hub.read_state('main')['token_usage']['codex']['total'],1300)
        self.assertEqual(hub.read_state(sid)['token_usage_all_sessions']['codex']['total'],2600)
        self.assertEqual(set(self.view()['token_usage']),{'codex'})
        self.assertIn('claude',self.view('claude')['token_usage'])

    def test_media_production_without_kind_cannot_go_to_reasonix(self):
        for body in ['生成一张海报','制作产品宣传视频','编辑参考图片','create an image of a forest','剪辑一段视频','视频内容制作','做一段视频']:
            with self.assertRaisesRegex(hub.Reject,'媒体任务只允许'):
                self.task(to=['reasonix'],body=body)
        self.task(to=['codex'],body='制作产品宣传视频')
        self.assertEqual(hub.read_state()['tasks'][0]['kind'],'video_generate')
        with self.assertRaises(hub.Reject):hub.session_action({'action':'reassign','session':'main','task':'T-1','to':'reasonix'})
        self.task(task='CODE',to=['reasonix'],body='实现视频播放器的键盘快捷键')

    def test_legacy_untyped_media_task_claim_is_rejected(self):
        with hub.transaction():
            hub.append({'session':'main','from':'claude','to':['reasonix'],'type':'task','task':'LEGACY','body':'生成一张封面图片'})
        with self.assertRaisesRegex(hub.Reject,'仅由'):self.post('reasonix','claim',task='LEGACY')
        with self.assertRaises(hub.Reject):hub.session_action({'action':'reassign','session':'main','task':'LEGACY','to':'reasonix'})

    def test_invalid_optional_message_fields_never_poison_board(self):
        self.post(body='preserved history')
        before = hub.BOARD.read_bytes()
        invalid = [dict(task=[]), dict(task={}), dict(task=123), dict(files=[{}]),
                   dict(files=[123]), dict(attachments=[{}]), dict(request_id=123),
                   dict(request_id=''), dict(session=[]), dict(kind={})]
        for fields in invalid:
            with self.subTest(fields=fields):
                with self.assertRaises(hub.Reject): self.post(**fields)
                self.assertEqual(hub.BOARD.read_bytes(), before)
                self.assertEqual(hub.read_state()['total'], 1)

    def test_cli_scoped_commands_require_identity(self):
        self.task(to=['reasonix'], body='SCOPE-PRIVATE-TASK')
        env = {**os.environ, 'AGENTS_TALK_DATA': self.temp.name, 'PYTHONUTF8': '1'}
        for command in ('read', 'status', 'tasks'):
            result = subprocess.run([sys.executable, str(ROOT/'hub.py'), command, '--session', 'main'],
                                    env=env, capture_output=True, text=True, encoding='utf-8', timeout=8)
            self.assertEqual(result.returncode, 2, result.stdout)
            self.assertIn('--agent', result.stderr)
            self.assertNotIn('SCOPE-PRIVATE-TASK', result.stdout)
        presence = {p.name: p.read_bytes() for p in (hub.DATA / '.presence').glob('*')}
        result = subprocess.run([sys.executable, str(ROOT/'hub.py'), 'status', '--human', '--session', 'main'],
                                env=env, capture_output=True, text=True, encoding='utf-8', timeout=8)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('SCOPE-PRIVATE-TASK', result.stdout)
        self.assertEqual({p.name: p.read_bytes() for p in (hub.DATA / '.presence').glob('*')}, presence)
        result = subprocess.run([sys.executable, str(ROOT/'hub.py'), 'status', '--human', '--agent', 'codex'],
                                env=env, capture_output=True, text=True, encoding='utf-8', timeout=8)
        self.assertEqual(result.returncode, 2)

    def test_message_retry_rejects_changed_intent(self):
        original = self.post(request_id='retry-fixture', body='first intent')
        self.assertEqual(self.post(request_id='retry-fixture', body='first intent')['id'], original['id'])
        for fields in [dict(body='changed intent'), dict(to=['reasonix']), dict(typ='plan')]:
            with self.subTest(fields=fields):
                with self.assertRaisesRegex(hub.Reject, '请求编号'):
                    self.post(request_id='retry-fixture', **{'body':'first intent', **fields})
        self.assertEqual(len(hub.load()), 1)

    def test_pre_fingerprint_message_retries_compare_persisted_content(self):
        original = self.post(request_id='legacy-retry', body='preserved legacy')
        original.pop('request_hash')
        hub.BOARD.write_text(json.dumps(original, ensure_ascii=False) + '\n', encoding='utf-8')
        self.assertEqual(self.post(request_id='legacy-retry', body='preserved legacy')['id'], original['id'])
        with self.assertRaises(hub.Reject): self.post(request_id='legacy-retry', body='changed legacy')
        usage = self.usage(request_id='legacy-usage')
        rows = hub.load()
        for row in rows:
            row.pop('request_hash', None); row.pop('_i', None)
        hub.BOARD.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding='utf-8')
        self.assertEqual(self.usage(request_id='legacy-usage')['id'], usage['id'])
        with self.assertRaises(hub.Reject): self.usage(request_id='legacy-usage', input_tokens=2000)

    def test_cli_attachment_retry_uses_content_for_current_and_legacy_records(self):
        source = hub.DATA / 'retry attachment.txt'
        env = {**os.environ, 'AGENTS_TALK_DATA': self.temp.name, 'PYTHONUTF8': '1'}
        for legacy in ('current', 'unfingerprinted', 'id-fingerprint'):
            with self.subTest(legacy=legacy):
                source.write_bytes(b'original attachment content')
                command = [sys.executable, str(ROOT/'hub.py'), 'post', '--from', 'claude', '--session', 'main',
                           '--type', 'say', '--body', 'retry attachment', '--request-id', f'attachment-retry-{legacy}',
                           '--attach', str(source)]
                first = subprocess.run(command, env=env, capture_output=True, text=True, encoding='utf-8', timeout=8)
                self.assertEqual(first.returncode, 0, first.stderr)
                original = json.loads(first.stdout)
                if legacy != 'current':
                    rows = hub.load()
                    for row in rows:
                        row.pop('_i', None)
                        if row['id'] == original['id']:
                            if legacy == 'unfingerprinted': row.pop('request_hash', None)
                            else:
                                previous_intent = {'session':'main', 'from':'claude', 'type':'say', 'to':['all'],
                                                   'body':'retry attachment', 'attachments':[row['attachments'][0]['id']]}
                                row['request_hash'] = hashlib.sha256(json.dumps(previous_intent, sort_keys=True).encode()).hexdigest()
                            for item in row['attachments']:
                                item.pop('sha256', None)
                                metadata_path = hub.DATA / 'uploads' / (item['id'] + '.json')
                                metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
                                metadata.pop('sha256', None)
                                metadata_path.write_text(json.dumps(metadata), encoding='utf-8')
                    hub.BOARD.write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')
                before = hub.BOARD.read_bytes()
                retry = subprocess.run(command, env=env, capture_output=True, text=True, encoding='utf-8', timeout=8)
                self.assertEqual(retry.returncode, 0, retry.stderr)
                repeated = json.loads(retry.stdout)
                self.assertEqual(repeated['id'], original['id'])
                self.assertEqual(repeated['attachments'][0]['id'], original['attachments'][0]['id'])
                self.assertEqual(hub.BOARD.read_bytes(), before)
                source.write_bytes(b'modified attachment content')
                changed = subprocess.run(command, env=env, capture_output=True, text=True, encoding='utf-8', timeout=8)
                self.assertEqual(changed.returncode, 2, changed.stdout)
                self.assertIn('请求编号', changed.stderr)
                self.assertEqual(hub.BOARD.read_bytes(), before)

    def test_valid_json_with_invalid_event_reports_corrupt_line(self):
        message = self.post()
        before = hub.BOARD.read_text(encoding='utf-8')
        for fields in (dict(task=[]), dict(**{'from':[]}), dict(files=[{}]),
                       dict(attachments=[{}]), dict(type='reassign', task='T-1', to=[])):
            with self.subTest(fields=fields):
                hub.BOARD.write_text(before + json.dumps({**message, **fields}) + '\n', encoding='utf-8')
                corrupted = hub.BOARD.read_bytes()
                with self.assertRaisesRegex(hub.Reject, '第 2 行损坏'): hub.read_state()
                with self.assertRaisesRegex(hub.Reject, '第 2 行损坏'): self.post()
                self.assertEqual(hub.BOARD.read_bytes(), corrupted)

if __name__=='__main__':unittest.main()
