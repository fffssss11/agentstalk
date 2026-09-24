'use strict';
// Side panel tabs: tasks and members, plus the dialogs they open.
const taskOpen=new Map();
const TASK_GROUPS=[['需要关注',t=>['受阻','被打回'].includes(t.state)||needsReassign(t)],['进行中',t=>t.state==='进行中'],['待审查',t=>t.state==='待审查'],['待办',t=>t.state==='待办'],['已完成',t=>t.state==='已完成']];
function needsReassign(t) {return state.session.status!=='ended'&&!state.session.participants?.includes(t.owner)&&['待办','受阻','被打回'].includes(t.state);}
function taskBadge(state) {return {'进行中':'info','待审查':'info','受阻':'danger','被打回':'danger','已完成':'ok'}[state]||'';}
function renderTasks() {
  for(const d of $$('#task-list details[data-task]'))taskOpen.set(d.dataset.task,d.open);
  const tasks=state.tasks, done=tasks.filter(t=>t.state==='已完成').length;
  $('task-count').textContent=tasks.length;
  $('task-summary-label').textContent=tasks.length?'已完成任务':'等待任务';
  $('task-progress-label').textContent=`${done} / ${tasks.length}`;
  const pct=tasks.length?Math.round(done/tasks.length*100):0;
  $('task-progress').setAttribute('aria-valuenow',pct); $('task-progress').firstElementChild.style.width=pct+'%';
  const placed=new Set();
  const groups=TASK_GROUPS.map(([title,test])=>[title,[...tasks].reverse().filter(t=>!placed.has(t.id)&&test(t)&&placed.add(t.id))]).filter(([,list])=>list.length);
  $('task-list').innerHTML=tasks.length?groups.map(([title,list])=>`<div class="task-group"><div class="task-group-title">${esc(title)}<span class="count-badge">${list.length}</span></div>${list.map(t=>taskItemHTML(t,title==='需要关注')).join('')}</div>`).join(''):`<div class="empty-state"><span class="empty-mark">${icon('tasks')}</span><h3>还没有任务</h3><p>主导成员发布正式任务后，负责人、进度和验收会出现在这里。</p></div>`;
  const locks=Object.entries(state.locks); $('lock-count').textContent=locks.length;
  $('lock-list').innerHTML=locks.length?locks.map(([p,o])=>`<div class="lock-entry"><code>${esc(p)}</code><span>${esc(name(o.agent))}${o.task?' · '+esc(o.task):''} · 会话 ${esc(o.session)}</span></div>`).join(''):'<p class="muted">暂无占用中的文件</p>';
  renderWorkflowSummary();
}
function taskItemHTML(t, attention) {
  const waiting=t.waiting_for||[];
  const deps=(t.depends_on?.length||typeof t.ready==='boolean')?`<div class="task-dependencies" data-ready="${String(t.ready)}">${esc([t.depends_on?.length?'依赖：'+t.depends_on.join('、'):'',waiting.length?'等待：'+waiting.join('、'):t.ready===true?'依赖已满足':t.ready===false?'依赖未就绪':''].filter(Boolean).join(' · '))}</div>`:'';
  const open=taskOpen.get(t.id)??attention;
  const locks=Object.entries(state.locks).filter(([,o])=>o.task===t.id).length;
  return `<details class="task-item" data-task="${esc(t.id)}" ${open?'open':''}><summary><span class="task-state-icon" data-state="${esc(t.state)}" aria-hidden="true"></span><span style="min-width:0"><span class="task-title">${esc(t.title)}</span><span class="task-meta"><span class="mono">${esc(t.id)}</span>${avatar(t.owner,'sm')}${t.reviewer?`${icon('arrow','xs')}${avatar(t.reviewer,'sm')}`:''}${t.depends_on?.length?`<span>${icon('link','xs')} ${waiting.length?'等待 '+esc(waiting.join('、')):'前置已通过'}</span>`:''}${t.kind?`<span class="badge accent">${esc(kinds[t.kind])}</span>`:''}${t.stage==='integration'?'<span class="badge accent">整合</span>':''}${locks?`<span>${icon('lock','xs')} ${locks}</span>`:''}</span></span><span class="badge ${taskBadge(t.state)}">${esc(t.state)}</span></summary>
    <div class="task-body"><p>${esc(t.body)}</p><div class="task-owner">${avatar(t.owner,'sm')}<span>${esc(instanceLabel(t.owner))}</span>${t.reviewer?`<span class="muted">· 验收 ${esc(name(t.reviewer))}</span>`:''}</div>${deps}${(t.log||[]).slice(-6).map(e=>`<p class="task-log">${esc(types[e.type]||e.type)} · ${esc(name(e.from))} · ${esc(e.summary||e.body||'')}</p>`).join('')}
    <div class="task-actions">${needsReassign(t)?`<button type="button" class="text-button" data-reassign="${esc(t.id)}">负责人未参与 · 转交主导成员</button>`:''}<button type="button" class="text-button" data-flow-jump="${esc(t.id)}">在流程中查看</button>${state.session.participants.includes(t.owner)?`<button type="button" class="text-button" data-dm="${esc(t.owner)}">给负责人发消息</button>`:''}</div></div></details>`;
}
function renderWorkflowSummary() {
  const tasks=state.tasks, integrations=tasks.filter(t=>t.stage==='integration');
  const pending=tasks.filter(t=>t.state==='待审查').length;
  $('workflow-summary').innerHTML=`<span class="lead">${avatar(state.session.lead,'sm')}当前主导 <b>${esc(name(state.session.lead))}</b></span><span>${tasks.length} 项任务 · ${pending} 项待验收</span><span>${integrations.length?`整合验收通过 ${integrations.filter(t=>t.state==='已完成').length} / ${integrations.length}`:'最终整合安排：未指定'}</span>`;
}
$('task-list').addEventListener('click',async e=>{
  const reassign=e.target.closest('[data-reassign]');
  if(reassign){if(!sessionReady()||state.session.migration_required)return;await control('reassign',{task:reassign.dataset.reassign,to:state.session.lead},'任务已转交主导成员，历史记录已保留。');return;}
  const jump=e.target.closest('[data-flow-jump]');if(jump){setView('flow');focusFlowTask(jump.dataset.flowJump);return;}
  const dm=e.target.closest('[data-dm]');if(dm)focusComposer({to:dm.dataset.dm});
});

// Members: one row per instance, participation switch included.
function memberHTML(id) {
  const a=state.agents[id], enabled=state.session.participants.includes(id), st=captureState(id), usage=state.token_usage?.[id];
  const online=connected&&a.online, stale=a.needs_attention&&enabled;
  const caps=['claude','codex'].includes(clientId(id))?`<span>${icon('spark','xs')}${Object.entries(kinds).map(([k,t])=>`${t} ${a.capabilities?.[k]?.status==='available'?'可用':a.capabilities?.[k]?.status==='unavailable'?'不可用':'未验证'}`).join(' · ')}</span>`:'';
  return `<div class="member ${enabled?'':'not-participating'}" data-member="${esc(id)}"><span class="avatar md" data-client="${esc(clientId(id))}" aria-hidden="true">${esc(MARKS[clientId(id)]||'?')}<span class="dot ${online?'online':stale?'stale':''}"></span></span>
    <div style="min-width:0"><div class="member-name">${esc(name(id))}<span class="badge ${id===state.session.lead?'accent':''}">${esc(instanceRole(id))}</span>${activityHTML(id)}</div>
    <div class="member-sub">${esc(state.clients?.[clientId(id)]?.name||clientId(id))}${a.model?' · 模型标注 '+esc(a.model):''}${isExtraInstance(id)?` · <span class="agent-instance-id">${esc(id)}</span>`:''}</div>
    <div class="member-lines"><span class="${stale?'warn':online?'ok':''}">${icon('clock','xs')}${esc(a.status)} · ${esc(presenceText(id))}${connected?'':' · 状态未更新'}</span><span>${icon('monitor','xs')}画面：${esc(CAPTURE_TEXT[st])}${captures.get(id)?.label?' · '+esc(captures.get(id).label):''}</span><span>${icon('message','xs')}${a.msgs} 条发言 · 用量 ${usage?.reports?fmt(usage.total)+' tokens':'未报告'}</span>${caps}</div></div>
    <div class="member-side"><span class="switch" title="${id===state.session.lead?'主导成员必须参与':'参与本会话'}"><input type="checkbox" data-participant="${esc(id)}" aria-label="${esc(name(id))} 参与本会话" ${enabled?'checked':''}><span aria-hidden="true"></span></span><button class="icon-btn sm" type="button" data-member-menu="${esc(id)}" aria-label="${esc(name(id))} 的操作" aria-haspopup="menu">${icon('more','sm')}</button></div></div>`;
}
function renderMembers() {
  if(!state||state.session.id!==selected)return;
  const ids=displayAgentIds(), members=state.session.participants;
  keyedCards($('agent-list'),ids.map(memberHTML).join(''),'data-member');
  const online=Object.values(state.agents).filter(a=>connected&&a.online&&members.includes(a.id)).length;
  $('agent-count').textContent=members.length;
  $('members-online').textContent=online+' / '+members.length;
  $('members-summary').textContent='位参与成员在线读取';
  updateComposer();
}
$('agent-list').addEventListener('change',async e=>{
  if(!e.target.dataset.participant)return;
  const members=$$('[data-participant]',$('agent-list')).filter(el=>el.checked).map(el=>el.dataset.participant);
  await control('settings',{participants:members},'参与成员已更新，未勾选成员不再接收新派工。');
});
$('agent-list').addEventListener('click',e=>{const b=e.target.closest('[data-member-menu]');if(b)memberMenu(b,b.dataset.memberMenu);});
function memberMenu(anchor,id) {
  openPop(anchor,`<div class="pop-title">${esc(instanceLabel(id))}</div>
    <button class="menu-item" type="button" data-member-act="dm" data-id="${esc(id)}">${icon('message')}给 TA 发消息</button>
    <button class="menu-item" type="button" data-tile-act="filter" data-id="${esc(id)}">${icon('search')}只看 TA 的消息</button>
    <button class="menu-item" type="button" data-tile-act="bind" data-id="${esc(id)}">${icon('monitor')}${captures.get(id)?'重新选择窗口':'绑定窗口画面'}</button>
    <button class="menu-item" type="button" data-tile-act="guide" data-id="${esc(id)}">${icon('copy')}复制接入说明</button>
    <button class="menu-item" type="button" data-member-act="context" data-id="${esc(id)}">${icon('eye')}查看 TA 可见的内容</button>
    <button class="menu-item" type="button" data-member-act="edit" data-id="${esc(id)}" ${state.session.status==='ended'?'disabled':''}>${icon('edit')}编辑实例</button>`,{align:'end'});
}
$('pop').addEventListener('click',e=>{
  const b=e.target.closest('[data-member-act]');if(!b)return;
  closePop();const id=b.dataset.id;
  if(b.dataset.memberAct==='dm')focusComposer({to:id});
  if(b.dataset.memberAct==='context'){openContextPreview();$('context-agent').value=id;contextAgentPicked=true;contextOffset=0;previewContext();}
  if(b.dataset.memberAct==='edit'){openInstances();editInstance(id);$('instance-name').focus();}
});

// Usage and media capability cards (statistics semantics unchanged).
function renderUsage(){
  const all=$('usage-scope').value==='all',group=$('usage-group').value==='client';
  const data=(group?(all?state.token_usage_clients_all_sessions:state.token_usage_clients):(all?state.token_usage_all_sessions:state.token_usage))||{};
  const actors=(group?state.clients:all?state.usage_agents_all_sessions:state.agents)||state.agents;
  const rows=Object.entries(actors).filter(([id])=>id!=='pi').map(([id,a])=>[id,a,data[id]||{}]);
  const reports=rows.reduce((n,[,,u])=>n+(u.reports||0),0);
  $('usage-total').textContent=reports?fmt(rows.reduce((n,[,,u])=>n+(u.total||0),0)):'未报告';
  $('usage-list').innerHTML=rows.map(([id,a,u])=>`<div class="usage-row" data-usage-agent="${esc(id)}"><div class="usage-heading">${avatar(id,'sm')}<strong>${esc(a.name)}</strong><b>${fmt(u.total)}</b></div>${!group&&a.client&&a.client!==id?`<div class="usage-meta">${esc(id)}</div>`:''}<div class="usage-numbers"><span>输入 <b>${fmt(u.input)}</b></span><span>输出 <b>${fmt(u.output)}</b></span></div><div class="usage-meta">${u.reports||0} 次调用已报告 · 看板发言估算 ≈${fmt(u.board_output_estimate||0)}</div>${u.reports?`<details class="usage-sources"><summary>来源与明细</summary><p>缓存输入 ${fmt(u.cached_input)} · 推理输出 ${fmt(u.reasoning_output)}</p>${(u.sources||[]).map(s=>`<p>${esc(s.provider)} / ${esc(s.model)}<br>${esc(s.source)}</p>`).join('')}</details>`:''}</div>`).join('');
  // Top bar chip: current session, all instances.
  const sessionRows=Object.values(state.token_usage||{}), sessionReports=sessionRows.reduce((n,u)=>n+(u.reports||0),0);
  $('usage-chip-total').textContent=sessionReports?compactNumber(sessionRows.reduce((n,u)=>n+(u.total||0),0)):'未报告';
}
$('usage-scope').onchange=$('usage-group').onchange=()=>{if(state)renderUsage();};
$('usage-chip').onclick=()=>{openSideTab('members');requestAnimationFrame(()=>document.querySelector('.usage-card')?.scrollIntoView({block:'start',behavior:reducedMotion()?'auto':'smooth'}));};
function renderCapabilities() {
  $('capability-list').innerHTML=mediaAgents().map(id=>`<div class="capability-agent"><div class="capability-agent-heading">${avatar(id,'sm')}${esc(instanceLabel(id))}</div>${Object.entries(kinds).map(([kind,title])=>{const c=state.agents[id]?.capabilities[kind];return `<div class="capability-row" title="${esc(c?.detail||'成员尚未验证当前工具')}"><span>${title}</span><span class="capability-value ${c?.status==='available'?'':'unverified'}">${availability[c?.status||'unverified']}</span></div>`;}).join('')}</div>`).join('')||'<p class="muted">没有 Codex 或 Claude 实例参与。</p>';
}

// Instances dialog (same request, revision and retry semantics as before).
function renderInstances() {
  if(!$('instances-dialog').open||!state||state.session.id!==selected)return;
  const html=displayAgentIds().map(id=>{const a=state.agents[id],busy=operations.has(selected),enabled=state.session.participants.includes(id);
    return `<article class="instance-entry" data-instance="${esc(id)}"><div class="instance-entry-main">${avatar(id,'md')}<div><strong>${esc(name(id))}<span class="count-badge">${instanceRole(id)}</span></strong><code>${esc(id)}</code><p>${esc(state.clients?.[clientId(id)]?.name||clientId(id))} · 模型标注 ${esc(a.model||'未填写')} · ${enabled?'已参与':'未参与'}</p></div></div><div class="instance-entry-actions"><button type="button" class="btn btn-line sm" data-instance-edit="${esc(id)}" ${!sessionReady()||busy||state.session.status==='ended'?'disabled':''}>编辑</button><button type="button" class="btn btn-line sm" data-instance-guide="${esc(id)}" ${!sessionReady()||busy?'disabled':''}>接入说明</button></div></article>`;
  }).join('');
  if($('instance-list').innerHTML!==html)$('instance-list').innerHTML=html;
  $('instance-stale').hidden=!instanceEditorView||(state.session.instance_revision??-1)===instanceEditorRevision;
}
function editInstance(id=null) {
  if(!sessionReady()||operations.has(selected))return;
  const a=id?state.agents[id]:null;if(id&&!a)return;
  editingInstance=id;instanceEditorRevision=state.session.instance_revision??-1;instanceEditorView=snapshot();
  sessionRequests.delete(selected+':instance');
  $('instance-editor-title').textContent=id?'编辑 '+name(id):'新增实例';$('instance-save').textContent=id?'保存实例':'创建实例';
  $('instance-client').value=a?clientId(id):(state.agents[state.session.lead]?.client||'codex');
  $('instance-name').value=a?.name||'';$('instance-model').value=a?.model||'';
  $('instance-role').value=id===state.session.lead?'lead':a?.role==='reviewer'?'reviewer':'worker';
  errorAt('instance-error');$('instance-result').hidden=true;renderInstances();updateComposer();
}
function openInstances() {if(!sessionReady())return;closeNav();closePop();$('instances-dialog').showModal();editInstance();renderInstances();}
$('instances-open').onclick=openInstances;
$('instance-new').onclick=()=>editInstance();
$('instances-dialog').onclose=()=>{if(!$('instances-dialog').open)instanceEditorView=null;};
$('instance-list').onclick=e=>{
  const edit=e.target.closest('[data-instance-edit]'),guide=e.target.closest('[data-instance-guide]');
  if(edit){editInstance(edit.dataset.instanceEdit);$('instance-name').focus();}
  if(guide&&sessionReady()&&!operations.has(selected)){skillAgent=guide.dataset.instanceGuide;$('instances-dialog').close();openSkills();}
};
$('instance-form').onsubmit=async e=>{
  e.preventDefault();if(!$('instances-dialog').open||!instanceEditorView||!isCurrent(instanceEditorView))return;
  const op=beginOperation('instance');if(!op)return;
  const data={action:editingInstance?'instance_update':'instance_create',session:op.session,expected_revision:instanceEditorRevision,
    name:$('instance-name').value,model:$('instance-model').value,role:$('instance-role').value};
  if(editingInstance)data.instance=editingInstance;else data.client=$('instance-client').value;
  errorAt('instance-error');$('instance-result').hidden=true;
  try {
    const result=await sessionAPI(op,data);
    if(isCurrent(op)){renderKey='';await sync({fresh:true});if(isCurrent(op)){
      // Release the local form lock before initializing the next, independent intent.
      endOperation(op);if($('instances-dialog').open&&sessionReady())editInstance();
      $('instance-result').textContent=`已记录实例 ${result.instance}。点击该实例的“接入说明”，复制到对应客户端的独立对话中；此操作未启动模型调用。`;
      $('instance-result').hidden=false;
    }}
  }catch(e){if(isCurrent(op))errorAt('instance-error',e.message+'。请求结果不确定时保留表单重试，修改前先核对列表，避免重复创建。');}
  finally{endOperation(op);}
};

// Access instructions and context preview.
async function openSkills(){
  if(!sessionReady())return;
  closeNav();closePop();
  const view=snapshot(), generation=++skillsGeneration;
  skills={};$('skill-code').textContent='';$('skill-tabs').textContent='';$('copy-skill').disabled=true;
  if(!$('skills-dialog').open)$('skills-dialog').showModal();errorAt('skill-error');
  try {const d=await api('/api/skills?session='+encodeURIComponent(view.session));if(generation!==skillsGeneration||!isCurrent(view))return;skills=d;renderSkills();$('copy-skill').disabled=false;}
  catch(e){if(generation===skillsGeneration&&isCurrent(view))errorAt('skill-error',e.message);}
}
$('skills-dialog').onclose=()=>{skillsGeneration++;};
function renderSkills(){ const ids=agentIds().filter(id=>id in skills);if(!ids.includes(skillAgent))skillAgent=ids[0];$('skill-tabs').innerHTML=ids.map(id=>`<button class="skill-tab ${id===skillAgent?'selected':''}" role="tab" aria-selected="${id===skillAgent}" data-skill="${esc(id)}" type="button">${esc(name(id))}</button>`).join('');$('skill-name').textContent=skillAgent?name(skillAgent):'';$('skill-code').textContent=skills[skillAgent]||'';}
$('skills-open').onclick=$('empty-guide').onclick=openSkills;
$('reader-reconnect').onclick=()=>{skillAgent=Object.values(state.agents).find(a=>a.needs_attention)?.id||state.session.lead;openSkills();};
$('skill-tabs').onclick=e=>{const b=e.target.closest('[data-skill]');if(b){skillAgent=b.dataset.skill;renderSkills();}};
$('copy-skill').onclick=async()=>{if(await copyText($('skill-code').textContent))toast('接入说明已复制');else errorAt('skill-error','复制失败，请手动选择上方文本。');};
async function previewContext(){
  if(!sessionReady())return;
  const generation=++contextGeneration, view=snapshot(), agent=$('context-agent').value;
  errorAt('context-preview-error');$('context-preview').textContent='正在读取…';$('context-next').hidden=true;
  try{
    const d=await api('/api/context?session='+encodeURIComponent(view.session)+'&agent='+encodeURIComponent(agent)+'&offset='+contextOffset);
    if(generation!==contextGeneration||!isCurrent(view))return;
    const text=JSON.stringify(d,null,2);$('context-preview').textContent=text;
    $('context-preview-meta').textContent=`${name(agent)} · ${d.context.scope==='team'?'全局摘要':'聚焦读取'}${d.context.lead_overview?' · 主导成员全队概览':''} · ${d.context.task_count} 个可见任务 · 本页 ${text.length} 字符`;
    contextNext=d.context.next_task_offset;$('context-next').hidden=contextNext===null;
  }catch(e){if(generation===contextGeneration&&isCurrent(view)){$('context-preview').textContent='';errorAt('context-preview-error',e.message);}}
}
// Default to a non-lead member: the lead always sees the whole team, members see the focused scope.
let contextAgentPicked=false;
function openContextPreview() {
  if(!sessionReady())return;closePop();contextOffset=0;
  const member=state.session.participants.find(id=>id!==state.session.lead);
  if(!contextAgentPicked&&member)$('context-agent').value=member;
  if(!$('context-dialog').open)$('context-dialog').showModal();previewContext();
}
$('context-dialog').onclose=()=>{contextGeneration++;};
$('context-preview-open').onclick=openContextPreview;
$('context-agent').onchange=()=>{contextAgentPicked=true;contextOffset=0;previewContext();};
$('context-next').onclick=()=>{contextOffset=contextNext;previewContext();};
$('finish-form').onsubmit=async e=>{
  e.preventDefault();if(!finishSnapshot||!isCurrent(finishSnapshot))return;
  const op=beginOperation('finish');if(!op)return;
  try {await sessionAPI(op,{action:'ended',session:op.session});if(isCurrent(op)){$('finish-dialog').close();renderKey='';await sync({fresh:true});}}
  catch(e){if(isCurrent(op))errorAt('finish-error',e.message);}
  finally{endOperation(op);}
};
