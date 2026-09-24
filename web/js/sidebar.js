'use strict';
// Sidebar: projects and standalone sessions, organised like a chat product's history list.
const PROJECT_COLORS = [['green','绿'],['teal','青'],['blue','蓝'],['violet','紫'],['amber','琥珀'],['rose','玫红'],['slate','石板']];
const SEEN_KEY='agents-talk.seen-counts';
let seenCounts=readJSON(SEEN_KEY,{}), sidebarKey='', openProjects=new Set(readJSON('agents-talk.open-projects',[])), showArchived=false, libraryBusy=false;
let projectEditing=null, currentProject=null;

function sessionTime(s) {return activityOf(s.id).updated||activityOf(s.id).created||'';}
function markSeen() {
  if(!state)return;
  const count=activityOf(selected).messages||0;
  if(seenCounts[selected]!==count){seenCounts[selected]=count;writeJSON(SEEN_KEY,seenCounts);}
}
function hasNews(s) {const count=activityOf(s.id).messages||0;return s.id!==selected&&seenCounts[s.id]!=null&&count>seenCounts[s.id];}
function sessionRow(s) {
  const meta=sessionMeta(s.id), active=s.id===selected;
  return `<div class="session-row ${active?'active':''}" data-session-row="${esc(s.id)}"><button class="session-item" type="button" data-session="${esc(s.id)}" ${active?'aria-current="page"':''} title="${esc(sessionTitle(s))} · ${esc(statuses[s.status]||s.status)}"><span class="st-dot" data-status="${esc(s.status)}" aria-hidden="true"></span><span class="label">${esc(sessionTitle(s))}</span>${meta.pinned?icon('pin','xs pin'):''}${hasNews(s)?'<span class="new-dot" title="有新动态"></span><span class="sr-only">有新动态</span>':''}</button><button class="icon-btn xs session-more" type="button" data-session-menu="${esc(s.id)}" aria-label="${esc(sessionTitle(s))} 的操作" aria-haspopup="menu"><svg class="i sm"><use href="#i-more"/></svg></button></div>`;
}
function renderSidebar() {
  if(!state)return;
  markSeen();
  const query=$('session-search').value.trim().toLocaleLowerCase();
  const sessions=[...state.sessions].sort((a,b)=>String(sessionTime(b)).localeCompare(String(sessionTime(a))));
  const matches=s=>!query||sessionTitle(s).toLocaleLowerCase().includes(query)||(projectById(sessionProject(s.id))?.name||'').toLocaleLowerCase().includes(query);
  const key=JSON.stringify([query,selected,showArchived,[...openProjects],currentProject,uiView,sessions.map(s=>[s.id,s.status,sessionTitle(s),sessionMeta(s.id),activityOf(s.id).messages,sessionTime(s),hasNews(s)]),libraryProjects()]);
  if(key===sidebarKey)return;
  sidebarKey=key;
  const live=sessions.filter(s=>!sessionMeta(s.id).archived);
  const projects=libraryProjects().map(p=>({...p,sessions:live.filter(s=>sessionProject(s.id)===p.id)}))
    .sort((a,b)=>String(b.sessions[0]?sessionTime(b.sessions[0]):b.created).localeCompare(String(a.sessions[0]?sessionTime(a.sessions[0]):a.created)));
  const projectHTML=projects.filter(p=>!query||p.name.toLocaleLowerCase().includes(query)||p.sessions.some(matches)).map(p=>{
    const open=query?true:openProjects.has(p.id)||p.sessions.some(s=>s.id===selected);
    const shown=(query?p.sessions.filter(matches):p.sessions);
    return `<div class="project" data-project-row="${esc(p.id)}" data-open="${open}"><div class="project-head ${uiView==='project'&&currentProject===p.id?'active':''}"><button class="project-toggle" type="button" data-project-toggle="${esc(p.id)}" aria-expanded="${open}" aria-label="${open?'收起':'展开'} ${esc(p.name)}">${icon('chevron','xs')}</button><button class="project-item" type="button" data-project="${esc(p.id)}" title="${esc(p.name)}"><span class="folder" data-color="${esc(p.color)}">${icon('folder','sm')}</span><span class="label">${esc(p.name)}</span><span class="sb-count">${p.sessions.length||''}</span></button><button class="icon-btn xs session-more" type="button" data-project-menu="${esc(p.id)}" aria-label="${esc(p.name)} 的操作" aria-haspopup="menu"><svg class="i sm"><use href="#i-more"/></svg></button></div><div class="project-sessions">${shown.slice(0,query?50:6).map(sessionRow).join('')}${!query&&shown.length>6?`<button class="project-more-link" type="button" data-project="${esc(p.id)}">查看全部 ${shown.length} 个会话</button>`:''}${!shown.length?'<p class="sb-note">暂无会话</p>':''}</div></div>`;
  }).join('');
  $('project-list').innerHTML=projectHTML||`<p class="sb-note">${query?'没有匹配的项目':'把相关会话放进项目，统一整理。'}</p>`;
  const standalone=live.filter(s=>!sessionProject(s.id)&&matches(s));
  const pinned=standalone.filter(s=>sessionMeta(s.id).pinned), rest=standalone.filter(s=>!sessionMeta(s.id).pinned);
  const groups=[];if(pinned.length)groups.push(['置顶',pinned]);
  for(const s of rest){const bucket=dayBucket(sessionTime(s));const g=groups.find(x=>x[0]===bucket);if(g)g[1].push(s);else groups.push([bucket,[s]]);}
  $('session-list').innerHTML=groups.length?groups.map(([title,list])=>`<div class="sb-group"><div class="sb-group-title">${esc(title)}</div>${list.map(sessionRow).join('')}</div>`).join(''):`<p class="sb-note">${query?'没有匹配的会话':'还没有独立会话'}</p>`;
  $('session-count').textContent=live.filter(s=>!sessionProject(s.id)).length;
  const archived=sessions.filter(s=>sessionMeta(s.id).archived&&matches(s));
  $('archived-toggle').hidden=!archived.length;$('archived-count').textContent=archived.length;
  $('archived-toggle').setAttribute('aria-expanded',String(showArchived));
  $('archived-list').hidden=!showArchived||!archived.length;
  $('archived-list').innerHTML=showArchived?archived.map(sessionRow).join(''):'';
}

// Session and project menus.
function sessionMenu(anchor,sid) {
  const s=state.sessions.find(x=>x.id===sid);if(!s)return;
  const meta=sessionMeta(sid), disabled=libraryBusy||!!state.library_error;
  openPop(anchor,`<div class="pop-title">${esc(sessionTitle(s))}</div>
    <button class="menu-item" type="button" data-lib="rename" data-sid="${esc(sid)}" ${disabled?'disabled':''}>${icon('edit')}重命名</button>
    <button class="menu-item" type="button" data-lib="pin" data-sid="${esc(sid)}" ${disabled?'disabled':''}>${icon('pin')}${meta.pinned?'取消置顶':'置顶'}</button>
    <button class="menu-item" type="button" data-lib="move" data-sid="${esc(sid)}" ${disabled?'disabled':''}>${icon('folder-move')}移动到项目<span class="end">${esc(projectById(sessionProject(sid))?.name||'')}</span></button>
    <div class="menu-sep"></div>
    <button class="menu-item" type="button" data-lib="archive" data-sid="${esc(sid)}" ${disabled?'disabled':''}>${icon(meta.archived?'unarchive':'archive')}${meta.archived?'取消归档':'归档'}</button>
    ${state.library_error?`<p class="pop-note">${esc(state.library_error)}</p>`:''}`,{align:'end'});
}
function moveMenu(anchor,sid) {
  const current=sessionProject(sid);
  openPop(anchor,`<div class="pop-title">移动到项目</div>${libraryProjects().map(p=>`<button class="menu-item" type="button" data-move-to="${esc(p.id)}" data-sid="${esc(sid)}" ${p.id===current?'aria-checked="true"':''}><span class="folder" data-color="${esc(p.color)}">${icon('folder','sm')}</span>${esc(p.name)}${p.id===current?icon('check','sm end'):''}</button>`).join('')||'<p class="pop-note">还没有项目。</p>'}
    <div class="menu-sep"></div>${current?`<button class="menu-item" type="button" data-move-to="" data-sid="${esc(sid)}">${icon('x')}移出项目</button>`:''}
    <button class="menu-item" type="button" data-move-new="${esc(sid)}">${icon('plus')}新建项目并移入…</button>`,{align:'end'});
}
function renameMenu(anchor,sid) {
  const s=state.sessions.find(x=>x.id===sid);if(!s)return;
  openPop(anchor,`<form class="rename-form" data-rename="${esc(sid)}" style="display:flex;gap:6px;padding:6px"><label class="sr-only" for="rename-input">会话名称</label><input id="rename-input" class="rename-input" maxlength="120" value="${esc(sessionTitle(s))}" autocomplete="off"><button class="btn btn-primary sm" type="submit">保存</button></form><p class="pop-note">只改变面板中的显示名称，成员读取的会话名不变。留空恢复原名。</p>`,{align:'end',onOpen:pop=>{const input=pop.querySelector('input');input.focus();input.select();}});
}
function projectMenu(anchor,pid) {
  const p=projectById(pid);if(!p)return;
  openPop(anchor,`<div class="pop-title">${esc(p.name)}</div>
    <button class="menu-item" type="button" data-project-new-session="${esc(pid)}">${icon('compose')}在项目中新建会话</button>
    <button class="menu-item" type="button" data-project-open="${esc(pid)}">${icon('home')}打开项目主页</button>
    <button class="menu-item" type="button" data-project-edit="${esc(pid)}">${icon('edit')}编辑项目</button>
    <div class="menu-sep"></div>
    <button class="menu-item danger" type="button" data-project-delete="${esc(pid)}">${icon('trash')}删除项目</button>`,{align:'end'});
}
async function libraryWrite(data, message) {
  if(libraryBusy)return false;
  libraryBusy=true;
  try {await libraryAPI(data);sidebarKey='';await sync({fresh:true});if(message)toast(message);return true;}
  catch(e) {toast(e.message,true);return false;}
  finally {libraryBusy=false;}
}
async function deleteProject(pid) {
  const p=projectById(pid);if(!p)return;
  const count=state.sessions.filter(s=>sessionProject(s.id)===pid).length;
  if(!await confirmAction('删除项目？',`「${p.name}」中的 ${count} 个会话会移回会话列表，历史记录不受影响。`,'删除项目'))return;
  if(await libraryWrite({action:'project_delete',project:pid},'项目已删除，会话已移回列表')){
    openProjects.delete(pid);writeJSON('agents-talk.open-projects',[...openProjects]);
    $('project-dialog').close();
    if(uiView==='project'&&currentProject===pid)setView('live');
  }
}

// Project dialog (create / edit) and the project home page.
function defaultAgents() {return Object.keys(state?.clients||{claude:1,codex:1,reasonix:1,zcode:1});}
function checkboxes(container,values,checked,disabledValue) {
  container.innerHTML=values.map(id=>`<label><input type="checkbox" value="${esc(id)}" ${checked.includes(id)?'checked':''} ${id===disabledValue?'disabled':''}>${esc(state?.clients?.[id]?.name||id)}</label>`).join('');
}
function openProjectDialog(pid=null, afterCreate=null) {
  if(!state)return;
  const p=pid?projectById(pid):null;projectEditing={pid,afterCreate};
  $('project-dialog-title').textContent=p?'编辑项目':'新建项目';$('project-save').textContent=p?'保存':'创建项目';
  $('project-delete').hidden=!p;
  $('project-name').value=p?.name||'';$('project-description').value=p?.description||'';
  const color=p?.color||'green';
  $('project-colors').innerHTML=PROJECT_COLORS.map(([c,label])=>`<button type="button" class="color-swatch" role="radio" data-color="${c}" aria-checked="${c===color}" aria-label="${label}" title="${label}"></button>`).join('');
  const d=p?.defaults||{};
  $('project-mode').value=d.mode||'';
  $('project-lead').innerHTML='<option value="">沿用全局默认</option>'+defaultAgents().map(id=>`<option value="${esc(id)}">${esc(state.clients?.[id]?.name||id)}</option>`).join('');
  $('project-lead').value=d.lead||'';
  checkboxes($('project-participants'),defaultAgents(),d.participants||[],null);
  $('project-shared').checked=!!d.shared_context;
  $('project-defaults-box').open=!!(d.mode||d.lead||d.participants||'shared_context' in d);
  errorAt('project-form-error');$('project-dialog').showModal();$('project-name').focus();
}
function projectFormDefaults() {
  const d={};
  if($('project-mode').value)d.mode=$('project-mode').value;
  if($('project-lead').value)d.lead=$('project-lead').value;
  const members=[...$('project-participants').querySelectorAll('input:checked')].map(i=>i.value);
  if(members.length){if(d.lead&&!members.includes(d.lead))members.push(d.lead);d.participants=members;}
  if($('project-shared').checked)d.shared_context=true;
  return d;
}
$('project-colors').addEventListener('click',e=>{const b=e.target.closest('[data-color]');if(!b)return;for(const s of $$('#project-colors [data-color]'))s.setAttribute('aria-checked',String(s===b));});
$('project-form').addEventListener('submit',async e=>{
  e.preventDefault();if(libraryBusy)return;
  const color=document.querySelector('#project-colors [aria-checked="true"]')?.dataset.color||'green';
  const data={name:$('project-name').value,color,description:$('project-description').value,defaults:projectFormDefaults()};
  const editing=projectEditing;
  libraryBusy=true;$('project-save').disabled=true;errorAt('project-form-error');
  try {
    const result=await libraryAPI(editing?.pid?{action:'project_update',project:editing.pid,...data}:{action:'project_create',...data});
    $('project-dialog').close();openProjects.add(result.project);writeJSON('agents-talk.open-projects',[...openProjects]);
    sidebarKey='';await sync({fresh:true});
    toast(editing?.pid?'项目已更新':'项目已创建');
    if(editing?.afterCreate)await editing.afterCreate(result.project);
  } catch(err) {errorAt('project-form-error',err.message);}
  finally {libraryBusy=false;$('project-save').disabled=false;}
});
$('project-delete').addEventListener('click',()=>{if(projectEditing?.pid)deleteProject(projectEditing.pid);});
function renderProjectPage() {
  const p=projectById(currentProject);
  if(!p){$('project-page').innerHTML='<p class="muted">项目不存在或已删除。</p>';return;}
  const all=state.sessions.filter(s=>sessionProject(s.id)===p.id).sort((a,b)=>String(sessionTime(b)).localeCompare(String(sessionTime(a))));
  const live=all.filter(s=>!sessionMeta(s.id).archived), archived=all.length-live.length, d=p.defaults||{};
  const defaults=[d.mode?(d.mode==='leader'?'主导协作':'圆桌讨论'):'',d.lead?'主导 '+(state.clients?.[d.lead]?.name||d.lead):'',d.participants?'参与 '+d.participants.map(id=>state.clients?.[id]?.name||id).join('、'):'',d.shared_context?'全局上下文开启':''].filter(Boolean);
  $('project-page').innerHTML=`<header class="project-hero"><span class="folder" data-color="${esc(p.color)}">${icon('folder')}</span><div style="min-width:0"><h2>${esc(p.name)}</h2>${p.description?`<p>${esc(p.description)}</p>`:'<p class="muted">还没有项目说明。</p>'}</div><div class="project-actions"><button class="btn btn-line sm" type="button" data-project-edit="${esc(p.id)}">${icon('edit','sm')}编辑项目</button><button class="btn btn-primary sm" type="button" data-project-new-session="${esc(p.id)}">${icon('compose','sm')}在此项目中新建会话</button></div></header>
    <div class="defaults-line">${defaults.length?defaults.map(x=>`<span class="badge">${esc(x)}</span>`).join(''):'<span class="badge">新会话沿用全局默认设置</span>'}</div>
    <section class="project-sessions"><h3>会话 · ${live.length}${archived?` <span class="muted">（另有 ${archived} 个已归档）</span>`:''}</h3>
    <div class="session-cards">${live.map(s=>{const a=activityOf(s.id);return `<button class="session-card" type="button" data-open-session="${esc(s.id)}"><strong>${esc(sessionTitle(s))}</strong><span><span class="st-dot" data-status="${esc(s.status)}"></span>${esc(statuses[s.status]||s.status)} · ${a.messages||0} 条消息</span><span>${icon('clock','xs')}${a.updated?'最近活动 '+esc(relTime(a.updated)):'尚无活动'}</span></button>`;}).join('')||'<p class="muted">这个项目还没有会话。</p>'}</div></section>`;
}

// New session dialog; project defaults prefill the form.
function openSessionDialog(projectId='') {
  if(!sessionReady()||operations.has(selected)||creating)return;
  errorAt('session-form-error');
  $('new-session-project').innerHTML='<option value="">不放入项目</option>'+libraryProjects().map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('new-session-project').value=projectId&&projectById(projectId)?projectId:'';
  $('new-session-lead').innerHTML=defaultAgents().map(id=>`<option value="${esc(id)}">${esc(state.clients?.[id]?.name||id)}</option>`).join('');
  applyProjectDefaults();
  $('session-dialog').showModal();$('new-session-title').focus();
}
function applyProjectDefaults() {
  const p=projectById($('new-session-project').value), d=p?.defaults||{};
  const fallbackMembers=[...new Set([...(state.session_defaults?.participants||['claude','codex','reasonix'])])];
  $('new-session-mode').value=d.mode||'leader';
  $('new-session-lead').value=d.lead||state.session_defaults?.lead||'claude';
  if(!$('new-session-lead').value)$('new-session-lead').value=defaultAgents()[0];
  checkboxes($('new-session-participants'),defaultAgents(),d.participants||fallbackMembers,$('new-session-lead').value);
  for(const box of $$('#new-session-participants input'))if(box.value===$('new-session-lead').value)box.checked=true;
  $('new-session-shared').checked=!!d.shared_context;
  sessionRequests.delete(selected+':create');
}
$('new-session-project').addEventListener('change',applyProjectDefaults);
$('new-session-lead').addEventListener('change',()=>{
  const lead=$('new-session-lead').value;
  for(const box of $$('#new-session-participants input')){box.disabled=box.value===lead;if(box.value===lead)box.checked=true;}
});
for(const id of ['new-session-title','new-session-mode','new-session-lead','new-session-shared']) $(id).addEventListener('input',()=>sessionRequests.delete(selected+':create'));
$('new-session-participants').addEventListener('change',()=>sessionRequests.delete(selected+':create'));
$('session-form').onsubmit=async e=>{
  e.preventDefault();if(creating)return;
  const op=beginOperation('create');if(!op)return;creating=true;updateComposer();
  const data={action:'create',title:$('new-session-title').value,mode:$('new-session-mode').value};
  // Keep the request minimal when defaults are untouched so retries remain comparable.
  const lead=$('new-session-lead').value, members=[...$('new-session-participants').querySelectorAll('input:checked')].map(i=>i.value);
  if(lead)data.lead=lead;
  if(members.length)data.participants=members;
  if($('new-session-shared').checked)data.shared_context=true;
  if($('new-session-project').value)data.project=$('new-session-project').value;
  try {
    const r=await sessionAPI(op,data);
    if(isCurrent(op)) {$('session-dialog').close();$('session-form').reset();switchSession(r.session,{view:'live'});}
  } catch(err) {if(isCurrent(op))errorAt('session-form-error',err.message);}
  finally {creating=false;endOperation(op);}
};

// Navigation drawer (narrow screens) and desktop collapse.
const narrowNavigation=matchMedia('(max-width:1100px)');
function closeNav({restoreFocus=false}={}) {
  const wasOpen=$('sidebar').classList.contains('open');
  $('sidebar').classList.remove('open');$('sidebar-scrim').hidden=true;$('menu-toggle').setAttribute('aria-expanded','false');
  $('main').inert=false;
  if(wasOpen&&restoreFocus&&narrowNavigation.matches)$('menu-toggle').focus();
}
function setSidebarOpen(open) {
  $('app').dataset.sidebar=open?'open':'closed';writeStorage('agents-talk.sidebar',open?'open':'closed');
  $('sidebar-collapse').setAttribute('aria-label',open?'收起侧栏':'展开侧栏');
  requestAnimationFrame(()=>layoutStage());setTimeout(()=>layoutStage(),240);
}
$('menu-toggle').onclick=()=>{
  if(!narrowNavigation.matches){setSidebarOpen(true);$('new-session').focus();return;}
  $('sidebar').classList.add('open');$('sidebar-scrim').hidden=false;$('menu-toggle').setAttribute('aria-expanded','true');
  $('main').inert=true;
  ($('new-session').disabled?$('session-search'):$('new-session')).focus();
};
$('sidebar-collapse').onclick=()=>setSidebarOpen(false);
$('sidebar-scrim').onclick=()=>closeNav({restoreFocus:true});
document.addEventListener('keydown',e=>{
  if(!$('sidebar').classList.contains('open')||document.querySelector('dialog[open]'))return;
  if(e.key==='Escape'&&$('pop').hidden){e.preventDefault();closeNav({restoreFocus:true});}
  else if(e.key==='Tab'){
    const items=$$('a[href],button:not(:disabled),input:not([hidden]),[tabindex="0"]',$('sidebar')).filter(el=>el.getClientRects().length);
    items.push($('sidebar-scrim'));
    const index=items.indexOf(document.activeElement);
    if(index<0||(e.shiftKey&&index===0)||(!e.shiftKey&&index===items.length-1)){
      e.preventDefault();items[e.shiftKey?items.length-1:0]?.focus();
    }
  }
});
narrowNavigation.addEventListener('change',e=>{if(!e.matches)closeNav();});

// Sidebar clicks.
$('sidebar').addEventListener('click',e=>{
  const session=e.target.closest('[data-session]');if(session){closeNav();if(session.dataset.session!==selected||uiView==='project')switchSession(session.dataset.session,{view:uiView==='project'?'live':null});return;}
  const menu=e.target.closest('[data-session-menu]');if(menu){sessionMenu(menu,menu.dataset.sessionMenu);return;}
  const toggle=e.target.closest('[data-project-toggle]');
  if(toggle){const pid=toggle.dataset.projectToggle;if(openProjects.has(pid))openProjects.delete(pid);else openProjects.add(pid);writeJSON('agents-talk.open-projects',[...openProjects]);sidebarKey='';renderSidebar();return;}
  const project=e.target.closest('[data-project]');if(project){closeNav();openProject(project.dataset.project);return;}
  const pmenu=e.target.closest('[data-project-menu]');if(pmenu){projectMenu(pmenu,pmenu.dataset.projectMenu);return;}
});
function openProject(pid) {
  if(!projectById(pid))return;
  currentProject=pid;openProjects.add(pid);writeJSON('agents-talk.open-projects',[...openProjects]);
  sidebarKey='';setView('project');
}
$('new-session').onclick=()=>{closeNav();openSessionDialog(uiView==='project'?currentProject:'');};
$('new-project').onclick=()=>openProjectDialog();
$('session-search').addEventListener('input',()=>{sidebarKey='';renderSidebar();});
$('archived-toggle').onclick=()=>{showArchived=!showArchived;sidebarKey='';renderSidebar();};
// Menu actions come from the shared popover.
$('pop').addEventListener('click',async e=>{
  const lib=e.target.closest('[data-lib]');
  if(lib){
    const sid=lib.dataset.sid, meta=sessionMeta(sid), anchor=popOwner;
    if(lib.dataset.lib==='rename'){closePop();renameMenu(anchor?.isConnected?anchor:$('session-title'),sid);return;}
    if(lib.dataset.lib==='move'){closePop();moveMenu(anchor?.isConnected?anchor:$('session-title'),sid);return;}
    closePop();
    if(lib.dataset.lib==='pin')await libraryWrite({action:'session_update',session:sid,pinned:!meta.pinned},meta.pinned?'已取消置顶':'已置顶');
    if(lib.dataset.lib==='archive')await libraryWrite({action:'session_update',session:sid,archived:!meta.archived},meta.archived?'已取消归档':'已归档，可在侧栏底部「已归档」找到');
    return;
  }
  const move=e.target.closest('[data-move-to]');
  if(move){closePop();const pid=move.dataset.moveTo||null;await libraryWrite({action:'session_update',session:move.dataset.sid,project:pid},pid?'已移动到「'+(projectById(pid)?.name||'项目')+'」':'已移出项目');return;}
  const moveNew=e.target.closest('[data-move-new]');
  if(moveNew){const sid=moveNew.dataset.moveNew;closePop();openProjectDialog(null,async pid=>{await libraryWrite({action:'session_update',session:sid,project:pid},'已移入新项目');});return;}
  const newIn=e.target.closest('[data-project-new-session]');if(newIn){closePop();openSessionDialog(newIn.dataset.projectNewSession);return;}
  const openP=e.target.closest('[data-project-open]');if(openP){closePop();openProject(openP.dataset.projectOpen);return;}
  const edit=e.target.closest('[data-project-edit]');if(edit){closePop();openProjectDialog(edit.dataset.projectEdit);return;}
  const del=e.target.closest('[data-project-delete]');if(del){closePop();deleteProject(del.dataset.projectDelete);}
});
$('pop').addEventListener('submit',async e=>{
  const form=e.target.closest('[data-rename]');if(!form)return;
  e.preventDefault();const sid=form.dataset.rename, title=form.querySelector('input').value;
  closePop();await libraryWrite({action:'session_update',session:sid,title},title.trim()?'已重命名':'已恢复原名');
});
$('project-page').addEventListener('click',e=>{
  const open=e.target.closest('[data-open-session]');if(open){switchSession(open.dataset.openSession,{view:'live'});return;}
  const newIn=e.target.closest('[data-project-new-session]');if(newIn){openSessionDialog(newIn.dataset.projectNewSession);return;}
  const edit=e.target.closest('[data-project-edit]');if(edit)openProjectDialog(edit.dataset.projectEdit);
});
