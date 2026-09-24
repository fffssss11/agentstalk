'use strict';
// Board state, polling and write guards. Ported from the previous panel; behaviour is unchanged.
const types = {join:'接入',say:'发言',plan:'方案',task:'派发',claim:'认领',progress:'进展',done:'交付',review:'审查',question:'提问',answer:'回答',decision:'定案',lock:'占用',unlock:'释放',idle:'等待',intervention:'优先干预',ack:'确认',control:'人工控制',session:'新会话',settings:'设置',capability:'能力报告',blocked:'受阻',reassign:'转交',workflow:'协作安排',instance:'实例设置',usage:'用量',leave:'退出读取'};
const kinds = {image_generate:'图像生成',image_edit:'图像编辑',video_generate:'视频生成'};
const availability = {available:'可用（成员已报告）',unavailable:'不可用',unverified:'未验证'};
const statuses = {active:'协作中',paused:'已发出暂停',ended:'已结束'};

let state, selected = readStorage('agents-talk.session') || '', limit = 300, mediaTab = false;
let connected = false, activeSync = null, timer, renderKey = '', skills = {}, skillAgent = 'claude';
let pollingGeneration = 0, contextOffset = 0, contextNext = null, contextGeneration = 0, skillsGeneration = 0;
let creating = false, finishSnapshot = null;
let editingInstance=null, instanceEditorRevision=-1, instanceEditorView=null, rosterKey='';
const drafts = new Map(), operations = new Map(), sessionRequests = new Map();
const dispatchHistory = new Map();

function agentActivity(id) {
  const a=state?.agents?.[id], tasks=(state?.tasks||[]).filter(t=>t.owner===id&&t.state==='进行中');
  const active=!!(tasks.length&&connected&&state.session.status==='active'&&state.session.participants.includes(id)&&a?.online&&!a.detached&&!a.needs_attention&&a.status!=='等待中');
  return {active,tasks};
}
function activityHTML(id, compact=false) {
  const {active,tasks}=agentActivity(id);
  if(!active)return '';
  const rays=Array.from({length:10},(_,i)=>`<rect x="14.5" y="2" width="3" height="8" rx="1.5" opacity="${(.4+i*.06).toFixed(2)}" transform="rotate(${i*36} 16 16)"/>`).join('');
  return `<span class="agent-activity" data-activity="${esc(id)}" title="任务进行中：${esc(tasks.map(t=>t.id).join('、'))}。依据已认领任务与近期读取；不表示模型内部推理状态。"><svg class="activity-glyph" viewBox="0 0 32 32" aria-hidden="true">${rays}</svg>${compact?'':'<span>任务进行中</span>'}</span>`;
}
// Keep ongoing glyph animations and <video> elements alive when another member publishes.
function keyedCards(container,html,key) {
  const template=document.createElement('template');template.innerHTML=html;
  const old=new Map([...container.children].map(el=>[el.getAttribute(key),el]));
  let index=0;
  for(const next of [...template.content.children]) {
    const previous=old.get(next.getAttribute(key));old.delete(next.getAttribute(key));
    if(key==='data-dispatch-id'&&previous?.dataset.live===next.dataset.live)next.style.cssText=previous.style.cssText;
    let node=next;
    if(previous?.innerHTML===next.innerHTML){
      for(const attr of [...previous.attributes])if(!next.hasAttribute(attr.name))previous.removeAttribute(attr.name);
      for(const attr of [...next.attributes])if(previous.getAttribute(attr.name)!==attr.value)previous.setAttribute(attr.name,attr.value);
      node=previous;
    }else if(previous){
      const glyph=previous.querySelector('.activity-glyph'), incoming=next.querySelector('.activity-glyph');
      if(glyph&&incoming)incoming.replaceWith(glyph);
      previous.replaceWith(next);
    }
    if(container.children[index]!==node)container.insertBefore(node,container.children[index]||null);index++;
  }
  for(const el of old.values())el.remove();
}
function dispatchEvents() {
  return (state?.tasks||[]).flatMap(t=>[
    {id:t.source_id,from:t.from,to:t.to?.[0]||t.owner,task:t.id,title:t.title,body:t.body,ts:t.ts,order:t._i||0,type:'task'},
    ...(t.log||[]).filter(e=>e.type==='reassign').map(e=>({...e,to:e.to?.[0],title:t.title,body:t.body,task:t.id,order:e._i||0}))
  ]).filter(e=>e.id).sort((a,b)=>b.order-a.order||String(b.ts).localeCompare(String(a.ts))||String(b.id).localeCompare(String(a.id)));
}
function observeDispatches(wasConnected) {
  const events=dispatchEvents();let history=dispatchHistory.get(selected);
  if(!history){history={seen:new Set(),live:new Map()};dispatchHistory.set(selected,history);}
  const fresh=[];
  for(const event of events) {
    if(wasConnected&&history.seen.size&&!history.seen.has(event.id)){history.live.set(event.id,Date.now());fresh.push(event);}
  }
  for(const event of events)history.seen.add(event.id);
  // An empty session also needs a baseline before its first real task arrives.
  history.seen.add('__initialized__');
  for(const [id,time] of history.live)if(Date.now()-time>4200||!wasConnected)history.live.delete(id);
  return fresh;
}
function getDraft(id) {
  if(!drafts.has(id)) drafts.set(id,{body:readStorage('agents-talk.draft.'+id)||'',attachments:[],requestKey:null});
  return drafts.get(id);
}
let draft = getDraft(selected);
function sessionReady() { return connected && !!selected && state?.session.id===selected; }
function snapshot() { return {session:selected,generation:pollingGeneration,csrf:state?.csrf||''}; }
function isCurrent(s) { return s.session===selected && s.generation===pollingGeneration; }
function beginOperation(kind) {
  if(!sessionReady() || operations.has(selected) || (state.session.status==='ended'&&kind!=='create')) return null;
  const op={...snapshot(),kind,draft}; operations.set(op.session,op); updateComposer(); return op;
}
function endOperation(op) {
  if(operations.get(op.session)===op) operations.delete(op.session);
  if(state) render(); else updateComposer();
}
function agentIds() { return Object.keys(state?.agents||{}).filter(id=>id!=='pi'); }
function clientId(id) {return state?.agents?.[id]?.client||state?.usage_agents_all_sessions?.[id]?.client||(MARKS[id]?id:'');}
function avatar(id, cls='') {
  const client=id==='human'?'human':clientId(id);
  return `<span class="avatar ${cls}" data-client="${esc(client||'unknown')}" aria-hidden="true">${esc(MARKS[client]||'?')}</span>`;
}
function name(id) { return id === 'pi' ? '历史 Pi' : id === 'human' ? '你' : id === 'all' ? '所有成员' : state?.agents?.[id]?.name || state?.usage_agents_all_sessions?.[id]?.name || id; }
// Extra same-client instances show their unique ID; default instances do not.
function isExtraInstance(id) {const client=clientId(id);return !!client&&client!==id;}
function instanceLabel(id) {const a=state?.agents?.[id];return name(id)+(a?.model?' · '+a.model:'')+(isExtraInstance(id)?' ['+id+']':'');}
function instanceRole(id) {return id===state?.session.lead?'主导':state?.agents[id]?.role==='reviewer'?'验收':'协同';}
function mediaAgents() {return agentIds().filter(id=>['claude','codex'].includes(clientId(id)));}
function displayAgentIds() {
  const rank=id=>id===state.session.lead?0:!state.session.participants.includes(id)?3:clientId(id)===clientId(state.session.lead)?1:2;
  return agentIds().sort((a,b)=>rank(a)-rank(b));
}
// Stage order: lead, then collaborators, then reviewers; stable, never reshuffled by activity.
function stageAgentIds() {
  const members=state?.session.participants||[];
  const rank=id=>id===state.session.lead?0:state.agents[id]?.role==='reviewer'?2:1;
  return agentIds().filter(id=>members.includes(id)).sort((a,b)=>rank(a)-rank(b));
}
function setAgentOptions(id,ids,prefix=[]) {
  const select=$(id),value=select.value;
  const html=[...prefix,...ids.map(a=>[a,instanceLabel(a)])].map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('');
  if(select.dataset.options!==html){select.innerHTML=html;select.dataset.options=html;if([...select.options].some(o=>o.value===value))select.value=value;}
}
async function sessionAPI(op,data) {
  // Keep the latest failed intent stable; changing its payload starts a new intent.
  const key=op.session+':'+(data.action==='create'?'create':data.action.startsWith('instance_')?'instance':'control'), signature=JSON.stringify(data);
  let pending=sessionRequests.get(key);
  if(!pending||pending.signature!==signature) {pending={signature,id:crypto.randomUUID()};sessionRequests.set(key,pending);}
  const result=await api('/api/session',{...data,request_id:pending.id},op);
  if(sessionRequests.get(key)===pending)sessionRequests.delete(key);
  return result;
}
// Projects and session labels live in the panel library, outside the agent event log.
const libraryRequests=new Map();
async function libraryAPI(data) {
  const key='library:'+data.action+':'+(data.project||data.session||''), signature=JSON.stringify(data);
  let pending=libraryRequests.get(key);
  if(!pending||pending.signature!==signature){pending={signature,id:crypto.randomUUID()};libraryRequests.set(key,pending);}
  const result=await api('/api/library',{...data,request_id:pending.id});
  if(libraryRequests.get(key)===pending)libraryRequests.delete(key);
  return result;
}
function libraryProjects() {return state?.library?.projects||[];}
function sessionMeta(sid) {return state?.library?.sessions?.[sid]||{};}
function sessionTitle(s) {return sessionMeta(s.id).title||s.title;}
function projectById(pid) {return libraryProjects().find(p=>p.id===pid);}
function sessionProject(sid) {const pid=sessionMeta(sid).project;return pid&&projectById(pid)?pid:null;}
function activityOf(sid) {return state?.session_activity?.[sid]||{};}

function updateConnection(ok, msg='') {
  connected=ok; $('connection-status').classList.toggle('disconnected',!ok);
  $('connection-status').classList.toggle('connected',ok);
  $('connection-status').querySelector('span').textContent=ok?'实时同步 · 1 秒':'连接中断';
  $('connection-error').hidden=ok; $('connection-error-text').textContent=msg;
  $('sync-label').textContent=ok?'同步于 '+new Date().toLocaleTimeString('zh-CN'):'恢复后自动同步';
  updateComposer();
  renderInstances();
  renderActivity();
  if(!ok)renderStage();
}
function sync({fresh=false}={}) {
  if(fresh && activeSync) {activeSync.controller.abort(); activeSync=null;}
  if(activeSync) return activeSync.promise;
  clearTimeout(timer);
  const run={...snapshot(),controller:new AbortController()};
  activeSync=run;
  run.promise=(async()=>{
    try {
      const d=await api('/api/state?limit='+limit+(run.session?'&session='+encodeURIComponent(run.session):''),undefined,{signal:AbortSignal.any([run.controller.signal,AbortSignal.timeout(12000)])});
      if(activeSync!==run || !isCurrent(run)) return false;
      if(run.session && d.session.id!==run.session) throw Error('会话响应不匹配');
      const wasConnected=connected;
      state=d;
      if(selected!==d.session.id) {selected=d.session.id;draft=getDraft(selected);$('message-body').value=draft.body;renderAttachments();}
      writeStorage('agents-talk.session',selected);
      const fresh=observeDispatches(wasConnected);
      updateConnection(true); render();
      for(const event of fresh)stageHandoff(event);
      return true;
    } catch(e) {
      if(activeSync!==run || !isCurrent(run)) return false;
      if(e.message==='会话不存在' && selected) {switchSession('');return false;}
      updateConnection(false,'暂时无法同步：'+e.message+'。输入内容会保留，正在自动重连。');
      return false;
    } finally {
      if(activeSync===run) {activeSync=null;timer=setTimeout(()=>sync(),1000);}
    }
  })();
  return run.promise;
}
function switchSession(id, {view=null}={}) {
  closeNav();closePop();
  saveDraft(); selected=id; pollingGeneration++; limit=300; renderKey=''; draft=getDraft(id);
  contextGeneration++; skillsGeneration++; finishSnapshot=null;
  for(const dialogId of ['context-dialog','skills-dialog','finish-dialog','session-dialog','project-dialog','instances-dialog','snapshot-dialog','confirm-dialog']) $(dialogId).close();
  instanceEditorView=null;
  resetSessionViews();
  $('export-format').value='';
  $('message-body').value=draft.body;
  errorAt('composer-error');renderAttachments();
  if(view||uiView==='project')setView(view||'live');
  connected=false;updateComposer();sync({fresh:true});
}
function saveDraft() {if(selected) {draft.body=$('message-body').value;writeStorage('agents-talk.draft.'+selected,draft.body);}}
async function control(action,extra={},message='') {
  const op=beginOperation('settings');if(!op)return;
  try {
    await sessionAPI(op,{action,session:op.session,...extra});
    if(isCurrent(op)) {renderKey='';await sync({fresh:true});if(isCurrent(op)&&message)toast(message);}
  } catch(e) {if(isCurrent(op))toast(e.message,true);}
  finally {endOperation(op);}
}
