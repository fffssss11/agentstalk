'use strict';
// Orchestration: views, side panel, top bar, render loop and keyboard shortcuts.
let uiView='live', sideTab='chat';

function setView(view) {
  if(!['live','flow','records','project'].includes(view))view='live';
  uiView=view;$('app').dataset.view=view;
  for(const b of $$('#view-tabs [data-view]')){const on=b.dataset.view===view;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}
  for(const [id,name] of [['view-live','live'],['view-flow','flow'],['view-records','records'],['view-project','project']])$(id).hidden=view!==name;
  if(view!=='live')closePop();
  const phone=$('app').dataset.mtab;
  if(phoneLayout.matches&&view==='flow')setMobileTabState('flow');
  else if(phoneLayout.matches&&view!=='live'&&phone==='flow')setMobileTabState('live');
  sidebarKey='';
  if(state&&state.session.id===selected){
    if(view==='flow')renderFlow();
    if(view==='records')renderRecords();
    if(view==='project')renderProjectPage();
    renderSidebar();renderTopbar();
  }
  if(view==='live')requestAnimationFrame(()=>layoutStage());
  updateCaptureVisibility();
}
function setSideTab(tab) {
  sideTab=tab;writeStorage('agents-talk.side-tab',tab);
  for(const b of $$('.side-tab[data-tab]')){const on=b.dataset.tab===tab;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}
  $('conversation').hidden=tab!=='chat';$('task-panel').hidden=tab!=='tasks';$('members-panel').hidden=tab!=='members';
  if(phoneLayout.matches)setMobileTabState(tab);
}
function setSidePanel(open) {
  $('app').dataset.side=open?'open':'closed';writeStorage('agents-talk.side',open?'open':'closed');
  $('side-toggle').setAttribute('aria-pressed',String(open));$('side-toggle').setAttribute('aria-label',open?'收起右侧面板':'展开右侧面板');
  requestAnimationFrame(()=>layoutStage());setTimeout(()=>layoutStage(),220);
}
function setMobileTabState(tab) {
  $('app').dataset.mtab=tab;
  for(const b of $$('#mobile-tabs [data-m]')){if(b.dataset.m===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
}
function setMobileTab(tab) {
  setMobileTabState(tab);
  if(tab==='flow'){setView('flow');return;}
  if(uiView!=='live')setView('live');
  if(tab!=='live')setSideTab(tab);
  else requestAnimationFrame(()=>layoutStage());
}
function resetSessionViews() {
  messageNodes.clear();$('messages').replaceChildren();openOverrides.clear();chatBaseline=null;$('pinned').replaceChildren();
  $('workflow-tree').replaceChildren();$('workflow-dispatch').replaceChildren();$('workflow-search').value='';flowKey='';
  $('records-list').replaceChildren();recordsKey='';recordsOpen.clear();
  $('stage-grid').replaceChildren();stageSpeakers=null;newTaskFlags.clear();uiMain='';uiPinned=false;
  taskOpen.clear();sidebarKey='';notifyBaseline=null;$('agent-list').replaceChildren();
}
function renderTopbar() {
  if(!state)return;
  const s=state.session, pid=sessionProject(s.id), project=projectById(uiView==='project'?currentProject:pid);
  const crumb=$('crumb-project');
  crumb.hidden=!project;
  if(project)crumb.innerHTML=`<span class="folder" data-color="${esc(project.color)}">${icon('folder','sm')}</span><span class="name">${esc(project.name)}</span>`;
  crumb.dataset.project=project?.id||'';
  $('session-status').textContent=statuses[s.status]||s.status;$('session-status').dataset.status=s.status;
  $('mode-chip-text').textContent=`${s.mode==='leader'?'主导协作':'圆桌讨论'} · ${name(s.lead)} 主导`;
  const members=(s.participants||[]).filter(id=>state.agents[id]);
  $('presence-btn').innerHTML=members.slice(0,5).map(id=>{const a=state.agents[id];const cls=connected&&a.online?'online':a.needs_attention&&(a.last_read||a.msgs)?'stale':'';return `<span class="avatar sm" data-client="${esc(clientId(id))}" title="${esc(name(id))} · ${esc(presenceText(id))}">${esc(MARKS[clientId(id)]||'?')}<span class="dot ${cls}"></span></span>`;}).join('')+(members.length>5?`<span class="more">+${members.length-5}</span>`:'');
  $('presence-btn').setAttribute('aria-label',`成员状态：${members.map(id=>name(id)+' '+presenceText(id)).join('，')}`);
}
function renderActivity() {
  if(!state||state.session.id!==selected)return;
  renderMembers();renderStage();
  if(uiView==='flow')renderFlow();else updateFlowActivity();
}
function render() {
  if(state.session.id!==selected) {updateComposer();return;}
  const s=state.session;
  $('session-title').textContent=sessionTitle(s);
  document.title=sessionTitle(s)+' · Agents Talk';
  const paused=s.status==='paused';
  $('pause-resume').innerHTML=`${icon(paused?'play':'pause')}<span>${paused?'恢复协作':'暂停协作'}</span>`;
  $('pause-resume').classList.toggle('on',paused);
  $('mode-select').value=s.mode;
  setAgentOptions('lead-select',agentIds());
  setAgentOptions('agent-filter',agentIds(),[['all','全部成员'],['human','你']]);
  setAgentOptions('recipient-select',agentIds(),[['all','所有成员']]);
  setAgentOptions('media-recipient',mediaAgents());
  setAgentOptions('context-agent',agentIds());
  const nextRoster=JSON.stringify([selected,s.instance_revision]);
  if(rosterKey&&rosterKey!==nextRoster){
    skillsGeneration++;contextGeneration++;skillCache.key='';
    if($('skills-dialog').open)openSkills();
    if($('context-dialog').open){contextOffset=0;previewContext();}
  }
  rosterKey=nextRoster;
  $('lead-select').value=s.lead;
  if(s.migration_required) $('lead-select').value='';
  $('migration-warning').hidden=!s.migration_required;
  $('migration-warning').textContent=s.migration_required?`${name(s.lead)} 已停用，请在设置中选择新的主导成员后继续任务。`:'';
  const members=s.participants||['claude','codex','reasonix'];
  for(const id of ['lead-select','recipient-select','media-recipient']){
    const select=$(id);
    for(const option of select.options)option.disabled=option.value!=='all'&&!members.includes(option.value);
    if(select.selectedOptions[0]?.disabled)select.value=[...select.options].find(o=>!o.disabled)?.value||'';
  }
  $('shared-context').checked=!!s.shared_context;
  $('context-mode-label').textContent=s.shared_context?'开启 · 全队成果摘要':'关闭 · 聚焦主导与自己';
  $('context-description').textContent=s.shared_context?'每个成员可以读取全队任务成果、验证与待解决问题，详细记录按需展开。':'其他成员只读取主导成员和自己的任务信息；主导成员保留全队摘要。';
  $('mode-description').textContent=s.mode==='leader'?'由主导成员拆分任务，成员执行，独立审查。':'成员讨论方案，由主导成员收敛结论。';
  const stalled=Object.values(state.agents).filter(a=>a.needs_attention);
  const onboarding=stalled.length>0&&state.tasks.length===0&&Object.values(state.agents).filter(a=>members.includes(a.id)).every(a=>!a.last_read&&!a.detached&&!a.msgs);
  $('reader-warning').hidden=stalled.length===0;
  $('reader-warning').classList.toggle('onboarding-notice',onboarding);
  $('reader-reconnect').textContent=onboarding?'开始接入':'恢复接入';
  $('reader-warning-text').textContent=onboarding?'尚未接入协作窗口。先选择参与实例，再把各实例的接入说明发到对应客户端；报到和读取后会显示在线状态。':stalled.map(a=>name(a.id)+(a.detached?' 已退出读取':a.last_read?' 超过 120 秒未读取':' 尚无读取记录')).join('；')+'。长工具执行也可能触发，请确认原窗口状态。';
  $('library-warning').hidden=!state.library_error;$('library-warning').textContent=state.library_error||'';
  $('message-count').textContent=state.total;
  renderSidebar();renderTopbar();
  const key=JSON.stringify([state.revision,selected,limit,$('search-input').value,$('agent-filter').value,chatFilter,detailMode]);
  if(key!==renderKey) {renderMessages(); renderTasks(); renderCapabilities(); renderUsage(); renderKey=key;}
  renderActivity();
  if(uiView==='records')renderRecords();
  if(uiView==='project')renderProjectPage();
  renderInstances();
  renderAttention();
  notifyEvents();
  updateComposer();
}

// Global controls.
$('view-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)setView(b.dataset.view);});
$('view-tabs').addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
  const tabs=$$('#view-tabs [data-view]'),i=tabs.findIndex(t=>t.dataset.view===uiView);
  const next=tabs[(Math.max(0,i)+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];e.preventDefault();setView(next.dataset.view);next.focus();
});
$$('.side-tab[data-tab]').forEach(b=>b.onclick=()=>setSideTab(b.dataset.tab));
document.querySelector('.side-tabs').addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight'].includes(e.key)||!e.target.closest('.side-tab'))return;
  const tabs=$$('.side-tab[data-tab]'),i=tabs.findIndex(t=>t.dataset.tab===sideTab);
  const next=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];e.preventDefault();setSideTab(next.dataset.tab);next.focus();
});
$('side-toggle').onclick=()=>setSidePanel($('app').dataset.side!=='open');
$('side-close').onclick=()=>setSidePanel(false);
$('mobile-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-m]');if(b)setMobileTab(b.dataset.m);});
$('crumb-project').onclick=()=>{const pid=$('crumb-project').dataset.project;if(pid)openProject(pid);};
$('session-menu').onclick=e=>{if(state)sessionMenu(e.currentTarget,selected);};
$('session-title').addEventListener('dblclick',()=>{if(state&&!state.library_error)renameMenu($('session-title'),selected);});
$('presence-btn').onclick=()=>openSideTab('members');
$('retry-connection').onclick=()=>sync({fresh:true});
document.querySelectorAll('.modal-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());

// Resizable right panel (pointer and keyboard).
(()=>{
  const handle=$('side-resize'), saved=Number(readStorage('agents-talk.side-width'));
  const apply=w=>{w=Math.max(320,Math.min(600,Math.round(w)));document.documentElement.style.setProperty('--side-w',w+'px');writeStorage('agents-talk.side-width',String(w));layoutStage();};
  if(saved>=320&&saved<=600)document.documentElement.style.setProperty('--side-w',saved+'px');
  let x0=0,w0=0;
  handle.addEventListener('pointerdown',e=>{x0=e.clientX;w0=$('side').offsetWidth;handle.setPointerCapture(e.pointerId);handle.classList.add('drag');});
  handle.addEventListener('pointermove',e=>{if(handle.classList.contains('drag'))apply(w0+(x0-e.clientX));});
  handle.addEventListener('pointerup',()=>handle.classList.remove('drag'));
  handle.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();apply($('side').offsetWidth+(e.key==='ArrowLeft'?24:-24));}});
})();

// Keyboard shortcuts never fire while typing, composing with an IME, or inside a dialog.
document.addEventListener('keydown',e=>{
  if(e.isComposing||e.keyCode===229)return;
  const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)||document.activeElement?.isContentEditable;
  const dialog=document.querySelector('dialog[open]');
  if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&!dialog){
    if(e.key.toLowerCase()==='b'&&!typing){e.preventDefault();if(narrowNavigation.matches)$('menu-toggle').click();else setSidebarOpen($('app').dataset.sidebar!=='open');return;}
    if(e.key.toLowerCase()==='j'&&!typing){e.preventDefault();setSidePanel($('app').dataset.side!=='open');return;}
  }
  if(dialog||typing||e.ctrlKey||e.metaKey)return;
  if(e.key==='Escape'){
    if(!$('pop').hidden)return;
    if(!$('settings-drawer').hidden){closeSettings();return;}
    if(uiLayout!=='gallery'&&uiView==='live'){setLayout('gallery');}
    return;
  }
  if(e.altKey&&/^[1-9]$/.test(e.key)){const id=stageAgentIds()[Number(e.key)-1];if(id){e.preventDefault();setView('live');setLayout('solo',id);}return;}
  if(e.altKey)return;
  if(e.key==='/'){e.preventDefault();focusComposer({});}
  else if(e.key==='g'||e.key==='G'){setView('live');setLayout('gallery');}
  else if(e.key==='s'||e.key==='S'){setView('live');setLayout('speaker');}
  else if(e.key==='?'){shortcutsMenu($('more-open'));}
});

// Startup.
(()=>{
  if(readStorage('agents-talk.sidebar')==='closed'&&!narrowNavigation.matches)$('app').dataset.sidebar='closed';
  if(readStorage('agents-talk.side')==='closed')setSidePanel(false);
  setMobileTabState('live');
  const savedTab=readStorage('agents-talk.side-tab');
  if(['chat','tasks','members'].includes(savedTab)&&!phoneLayout.matches)setSideTab(savedTab);
  setDetailMode(detailMode,{persist:false});
  syncCapturePrefControls();syncDisplayPrefControls();
  $('message-body').value=draft.body;autosizeComposer();
  updateComposer();
  sync();
})();
addEventListener('beforeunload',saveDraft);
