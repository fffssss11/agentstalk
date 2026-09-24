'use strict';
// Settings drawer, the attention centre ("需要你处理") and optional desktop notifications.
let settingsTab='collab', notifyBaseline=null;
const notifyPrefs={enabled:false,...readJSON('agents-talk.notify',{})};

function openSettings(tab=settingsTab) {
  closePop();closeNav();
  $('settings-drawer').hidden=false;$('drawer-scrim').hidden=false;
  setSettingsTab(tab);renderThemeSettings();syncCapturePrefControls();syncDisplayPrefControls();
  requestAnimationFrame(()=>$('settings-close').focus());
}
function closeSettings({restoreFocus=true}={}) {
  if($('settings-drawer').hidden)return;
  $('settings-drawer').hidden=true;$('drawer-scrim').hidden=true;
  if(restoreFocus)$('settings-open').focus({preventScroll:true});
}
function setSettingsTab(tab) {
  settingsTab=tab;
  for(const b of $$('.drawer-tabs [data-settings]')){const on=b.dataset.settings===tab;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}
  for(const pane of $$('[data-settings-pane]'))pane.hidden=pane.dataset.settingsPane!==tab;
}
function syncCapturePrefControls() {
  for(const b of $$('#pref-quality [data-quality]'))b.setAttribute('aria-pressed',String(Number(b.dataset.quality)===capturePrefs.quality));
  $('pref-static').value=String(capturePrefs.staticSeconds);
  $('pref-follow').checked=capturePrefs.follow;$('pref-captions').checked=capturePrefs.captions;$('pref-leave').checked=capturePrefs.leaveWarn;
}
function syncDisplayPrefControls() {
  for(const b of $$('#pref-detail [data-detail]'))b.setAttribute('aria-pressed',String(b.dataset.detail===detailMode));
  $('pref-new-flash').checked=newFlash;
  const supported='Notification' in window;
  $('pref-notify').checked=supported&&notifyPrefs.enabled&&Notification.permission==='granted';
  $('pref-notify').disabled=!supported;
  $('notify-status').textContent=!supported?'当前浏览器不支持桌面通知。':Notification.permission==='denied'?'浏览器已拒绝通知权限，请在浏览器设置中允许后再开启。':'通知只包含事件类型与任务编号，不含消息全文。';
}
$('settings-open').onclick=()=>openSettings();
$('mode-chip').onclick=()=>openSettings('collab');
$('settings-close').onclick=()=>closeSettings();
$('drawer-scrim').onclick=()=>closeSettings();
$('theme-btn').onclick=e=>themeMenu(e.currentTarget);
document.addEventListener('click',e=>{const b=e.target.closest('[data-open-settings]');if(b)openSettings(b.dataset.openSettings);});
$('settings-drawer').addEventListener('keydown',e=>{
  if(e.key==='Escape'&&$('pop').hidden){e.preventDefault();closeSettings();return;}
  if(e.target.closest('.drawer-tabs')&&['ArrowLeft','ArrowRight'].includes(e.key)){
    const tabs=$$('.drawer-tabs [data-settings]'),i=tabs.findIndex(t=>t.dataset.settings===settingsTab);
    const next=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];setSettingsTab(next.dataset.settings);next.focus();
  }
});
$('settings-drawer').addEventListener('click',e=>{
  const tab=e.target.closest('.drawer-tabs [data-settings]');if(tab){setSettingsTab(tab.dataset.settings);return;}
  const detail=e.target.closest('#pref-detail [data-detail]');if(detail){setDetailMode(detail.dataset.detail);syncDisplayPrefControls();return;}
  const quality=e.target.closest('#pref-quality [data-quality]');if(quality){setCaptureQuality(Number(quality.dataset.quality));syncCapturePrefControls();}
});
$('settings-drawer').addEventListener('change',async e=>{
  const id=e.target.id;
  if(id==='pref-static'){capturePrefs.staticSeconds=Number(e.target.value);saveCapturePrefs();}
  if(id==='pref-follow'){capturePrefs.follow=e.target.checked;saveCapturePrefs();renderStage();}
  if(id==='pref-captions'){capturePrefs.captions=e.target.checked;saveCapturePrefs();renderStage();}
  if(id==='pref-leave'){capturePrefs.leaveWarn=e.target.checked;saveCapturePrefs();}
  if(id==='pref-new-flash'){newFlash=e.target.checked;writeStorage('agents-talk.flash',newFlash?'on':'off');}
  if(id==='pref-notify'){
    if(e.target.checked&&'Notification' in window&&Notification.permission!=='granted'){
      const result=await Notification.requestPermission().catch(()=>'denied');
      if(result!=='granted'){e.target.checked=false;}
    }
    notifyPrefs.enabled=e.target.checked;writeJSON('agents-talk.notify',notifyPrefs);syncDisplayPrefControls();
  }
});
// Collaboration settings (same write semantics as the previous panel).
for(const [id,field] of [['mode-select','mode'],['lead-select','lead']]) $(id).onchange=()=>control('settings',{[field]:$(id).value});
$('shared-context').onchange=async()=>{
  const enabled=$('shared-context').checked;
  await control('settings',{shared_context:enabled},enabled?'全局协作上下文已开启，成员下次读取时更新。':'已切换到聚焦读取，客户端已有内容不会被清除。');
};

// Attention centre: only things a person should act on, each with a direct action.
function attentionItems() {
  if(!state)return [];
  const items=[], s=state.session;
  if(!connected)items.push({level:'danger',icon:'alert',title:'连接中断',text:'面板暂时无法同步；输入内容会保留，正在自动重连。',act:'重新连接',action:'retry'});
  if(s.migration_required)items.push({level:'danger',icon:'alert',title:'主导成员已停用',text:'请选择新的主导成员后再继续任务。',act:'打开协作设置',action:'settings'});
  for(const m of state.messages.filter(m=>m.type==='intervention')){
    const waiting=receiptTargets(m).filter(a=>!ackedBy(m).includes(a));
    if(waiting.length)items.push({level:'warn',icon:'bolt',title:'干预待确认',text:`${waiting.map(name).join('、')} 尚未确认：${firstLine(m.body).slice(0,40)}`,act:'查看',action:'chat'});
  }
  for(const t of state.tasks.filter(t=>['受阻','被打回'].includes(t.state))){
    const last=[...(t.log||[])].reverse().find(e=>['blocked','review'].includes(e.type));
    items.push({level:'warn',icon:'alert',title:`${t.id} ${t.state}`,text:`${name(t.owner)}：${firstLine(last?.blockers||last?.summary||last?.body||t.title).slice(0,60)}`,act:'回复负责人',action:'dm',id:t.owner});
  }
  for(const t of state.tasks.filter(needsReassign))items.push({level:'warn',icon:'users',title:`${t.id} 需要转交`,text:`负责人 ${name(t.owner)} 未参与本会话。`,act:'查看任务',action:'tasks'});
  for(const a of Object.values(state.agents).filter(a=>a.needs_attention&&s.status!=='ended'&&(a.last_read||a.msgs||a.detached)))
    items.push({level:'info',icon:'clock',title:`${name(a.id)} ${a.detached?'已退出读取':presenceText(a.id)}`,text:a.detached?'需要在原窗口重新接入。':'执行长工具时也会出现，请先确认原窗口状态。',act:'复制恢复说明',action:'guide',id:a.id});
  for(const t of state.tasks.filter(t=>t.state==='待审查'))items.push({level:'info',icon:'eye',title:`${t.id} 待验收`,text:`${t.title} · 验收人 ${t.reviewer?name(t.reviewer):'未指定'}`,act:'查看任务',action:'tasks'});
  for(const id of stageAgentIds())if(['ended','hidden'].includes(captureState(id)))items.push({level:'info',icon:'monitor',title:`${name(id)} 画面${CAPTURE_TEXT[captureState(id)]}`,text:captureState(id)==='hidden'?'窗口可能被最小化。可以被遮挡，但不要最小化。':'窗口已关闭或共享已停止。',act:'重新绑定',action:'bind',id});
  return items;
}
function renderAttention() {
  const count=attentionItems().filter(x=>x.level!=='info').length;
  $('attn-count').textContent=count;$('attn-count').hidden=!count;
  $('attn-btn').setAttribute('aria-label',count?`需要你处理：${count} 项`:'需要你处理');
}
function attentionMenu(anchor) {
  const items=attentionItems(), urgent=items.filter(x=>x.level!=='info').length;
  openPop(anchor,`<div class="pop-title">需要你处理<span class="sp"></span><span>${urgent?urgent+' 项待处理':'暂无紧急事项'}</span></div>${items.map((x,i)=>`<div class="attn-item"><span class="attn-ic ${x.level}">${icon(x.icon,'sm')}</span><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p><button class="btn btn-line sm" type="button" data-attn="${i}">${esc(x.act)}</button></div></div>`).join('')||'<p class="pop-note">目前没有需要你处理的事项。</p>'}`,{align:'end'});
  $('pop').dataset.attention=JSON.stringify(items.map(({action,id})=>({action,id})));
}
$('attn-btn').onclick=e=>attentionMenu(e.currentTarget);
$('pop').addEventListener('click',e=>{
  const b=e.target.closest('[data-attn]');if(!b)return;
  const item=JSON.parse($('pop').dataset.attention||'[]')[Number(b.dataset.attn)];closePop();if(!item)return;
  if(item.action==='retry')sync({fresh:true});
  if(item.action==='settings')openSettings('collab');
  if(item.action==='chat'){focusComposer({});$('message-scroll').scrollTop=0;}
  if(item.action==='dm')focusComposer({to:item.id});
  if(item.action==='tasks')openSideTab('tasks');
  if(item.action==='guide')copyGuide(item.id);
  if(item.action==='bind')bindWindow(item.id);
});

// Desktop notifications: only while the page is hidden, only important events, no full text.
function notifyEvents() {
  if(!state)return;
  const ids=new Set(state.messages.map(m=>m.id));
  if(!notifyBaseline||notifyBaseline.session!==selected){notifyBaseline={session:selected,seen:ids};return;}
  const fresh=state.messages.filter(m=>!notifyBaseline.seen.has(m.id));
  for(const id of ids)notifyBaseline.seen.add(id);
  if(!fresh.length||!document.hidden||!notifyPrefs.enabled||!('Notification' in window)||Notification.permission!=='granted')return;
  for(const m of fresh){
    const text={blocked:`${m.task||''} 受阻`,done:`${m.task||''} 待审查`,leave:'已退出读取',review:m.verdict==='pass'?'':`${m.task||''} 被退回`}[m.type];
    if(!text)continue;
    try {new Notification(`${name(m.from)} · ${text}`,{body:`会话：${sessionTitle(state.session)}`,tag:'agents-talk-'+m.id,silent:false});} catch {}
  }
}
