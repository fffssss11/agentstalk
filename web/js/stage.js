'use strict';
// Live stage: one tile per participating instance, with its real window when bound.
const SYSTEM_TYPES=new Set(['join','leave','lock','unlock','idle','ack','usage','capability','settings','instance','control','session']);
let uiLayout=['gallery','speaker','solo'].includes(readStorage('agents-talk.layout'))?readStorage('agents-talk.layout'):'gallery';
let uiMain='', uiPinned=false, lastFollowAt=0, stageSpeakers=null;
const newTaskFlags=new Map(), skillCache={key:'',data:null};

function presenceText(id) {
  const a=state.agents[id];
  if(!a)return '';
  if(!state.session.participants.includes(id))return '未参与';
  if(a.detached)return '已退出读取';
  if(a.read_age_seconds==null)return a.last_read?'读取状态未知':'尚未接入';
  if(a.read_age_seconds>=120)return Math.floor(a.read_age_seconds/60)+' 分钟未读取';
  return a.read_age_seconds<60?'刚刚读取':Math.floor(a.read_age_seconds/60)+' 分钟前读取';
}
function workSummary(id) {
  const run=(state?.tasks||[]).filter(t=>t.owner===id&&t.state==='进行中');
  if(run.length)return '进行中 '+run.map(t=>t.id).join('、');
  const review=(state?.tasks||[]).filter(t=>t.owner===id&&t.state==='待审查');if(review.length)return '待审查 '+review.map(t=>t.id).join('、');
  const blocked=(state?.tasks||[]).filter(t=>t.owner===id&&['受阻','被打回'].includes(t.state));if(blocked.length)return blocked[0].state+' '+blocked.map(t=>t.id).join('、');
  return id===state?.session.lead?'统筹':'待命';
}
function workChips(id) {
  const tasks=state.tasks.filter(t=>t.owner===id), out=[];
  const run=tasks.filter(t=>t.state==='进行中');
  if(run.length)out.push(`<span class="work-chip run">${activityHTML(id,true)}进行中 <b>${esc(run[0].id)}</b><span class="t">${esc(run[0].title)}</span>${run.length>1?` +${run.length-1}`:''}</span>`);
  for(const t of tasks.filter(t=>t.state==='待审查').slice(0,2))out.push(`<span class="work-chip review">待审查 <b>${esc(t.id)}</b></span>`);
  for(const t of tasks.filter(t=>['受阻','被打回'].includes(t.state)).slice(0,2))out.push(`<span class="work-chip blocked">${esc(t.state)} <b>${esc(t.id)}</b></span>`);
  if(!out.length){const open=state.tasks.filter(t=>t.state!=='已完成').length;out.push(`<span class="work-chip">${id===state.session.lead?`统筹 · ${open} 项未完成`:'待命'}</span>`);}
  const held=state.agents[id]?.holding||[];
  if(held.length)out.push(`<span class="work-chip" title="${esc(held.join('\n'))}">${icon('lock','xs')}${held.length}</span>`);
  return out.join('');
}
function lastBoardMessage(id) {
  for(let i=state.messages.length-1;i>=0;i--){const m=state.messages[i];if(m.from===id&&!SYSTEM_TYPES.has(m.type))return m;}
  return null;
}
function captionHTML(id) {
  if(!capturePrefs.captions)return '';
  const m=lastBoardMessage(id);if(!m)return '';
  const age=Date.now()-(parseTime(m.ts)||0);
  if(age>90000)return `<div class="caption collapsed" title="${esc(m.summary||m.body||'')}">最近发言 ${esc(relTime(m.ts))}</div>`;
  const label=(types[m.type]||'发言')+(m.task?' · '+m.task:'');
  return `<div class="caption"><span class="ct">${esc(label)}</span>${esc(m.summary||m.body||'')}<time>刚刚</time></div>`;
}
function captureChip(id) {
  const st=captureState(id), b=captures.get(id);
  if(st==='static'){const mins=Math.max(1,Math.round((Date.now()-b.lastChange)/60000));const alert=state.tasks.some(t=>t.owner===id&&t.state==='进行中');
    return `<span class="cap-chip" data-s="static" data-alert="${alert}" title="画面 ${mins} 分钟没有变化。可能在等待；Chromium/Electron 程序被完全遮挡时也会暂停绘制。"><i></i>静止 ${mins} 分钟</span>`;}
  const titles={hidden:'窗口已最小化或不可见，显示最后一帧',ended:'窗口已关闭，或在浏览器共享提示条上停止了共享',stale:'刷新页面后需要重新选择窗口'};
  return `<span class="cap-chip" data-s="${st}" ${titles[st]?`title="${titles[st]}"`:''}><i></i>${CAPTURE_TEXT[st]}</span>`;
}
function tileHTML(id, variant='full') {
  const a=state.agents[id], client=clientId(id), st=captureState(id), b=captures.get(id);
  const joined=!!(a.last_read||a.msgs), stale=a.needs_attention&&joined&&!a.detached;
  let screen;
  if(b&&b.state!=='ended')screen=`<div class="video-slot" data-video="${esc(id)}"></div>`;
  else {
    const last=b?.state==='ended'&&b.snap?`<img class="lastframe" src="${b.snap}" alt="">`:'';
    const label=st==='stale'?`上次：${esc(captureLabels[id]?.label||'')}`:st==='ended'?'画面已停止':presenceText(id);
    const primaryGuide=!joined&&state.session.status!=='ended';
    const bind=`<button class="btn sm ${primaryGuide?'btn-stage':'btn-stage-accent'}" type="button" data-tile-act="bind" data-id="${esc(id)}" ${st==='connecting'?'disabled':''}>${icon(st==='unbound'?'monitor':'refresh','sm')}${st==='unbound'||st==='connecting'?'绑定窗口':'重新绑定'}</button>`;
    const guide=`<button class="btn sm ${primaryGuide?'btn-stage-accent':'btn-stage'}" type="button" data-tile-act="guide" data-id="${esc(id)}">${icon('copy','sm')}复制接入说明</button>`;
    // Name and role already sit in the identity chip; the card only carries state and next steps.
    screen=`${last}<div class="unbound">${avatar(id,'xl')}<span class="meta ${stale?'w':''}">${esc(label)}</span>${variant==='strip'?'':`<div class="ub-actions">${primaryGuide?guide+bind:bind+guide}</div><span class="ub-hint">窗口可以被遮挡，但不要最小化</span>`}</div>`;
  }
  const tools=variant==='strip'?'':`<div class="tile-tools">
    <button type="button" data-tile-act="solo" data-id="${esc(id)}" title="单屏查看" aria-label="单屏查看 ${esc(name(id))}">${icon('solo','sm')}</button>
    <button type="button" data-tile-act="focus" data-id="${esc(id)}" title="设为主画面" aria-label="把 ${esc(name(id))} 设为主画面">${icon('speaker','sm')}</button>
    <button type="button" data-tile-act="dm" data-id="${esc(id)}" title="给 TA 发消息" aria-label="给 ${esc(name(id))} 发消息">${icon('message','sm')}</button>
    <button type="button" data-tile-act="snap" data-id="${esc(id)}" title="截取画面" aria-label="截取 ${esc(name(id))} 的画面" ${b&&b.state!=='ended'?'':'disabled'}>${icon('camera','sm')}</button>
    <button type="button" data-tile-act="more" data-id="${esc(id)}" title="更多" aria-label="${esc(name(id))} 的更多操作" aria-haspopup="menu">${icon('more','sm')}</button></div>`;
  const flag=newTaskFlags.get(id), flagged=flag&&Date.now()-flag.at<6000;
  const label=`${name(id)}，${instanceRole(id)}，${workSummary(id)}，画面${CAPTURE_TEXT[st]}，${presenceText(id)}`;
  return `<article class="tile" data-tile="${esc(id)}" data-client="${esc(client)}" data-cap="${st}" data-active="${agentActivity(id).active}" data-variant="${variant}" tabindex="0" aria-label="${esc(label)}">
    <div class="screen">${screen}</div>
    <div class="ov-top"><div class="id-stack"><span class="id-chip">${avatar(id)}<b>${esc(name(id))}</b><span class="role">· ${esc(instanceRole(id))}</span>${a.model&&variant!=='strip'?`<span class="model">${esc(a.model)}</span>`:''}</span>${stale&&variant!=='strip'&&b?`<span class="warn-chip">${icon('clock','xs')}${esc(presenceText(id))}</span>`:''}</div><div class="ov-right">${captureChip(id)}${tools}</div></div>
    ${variant==='strip'?'':`<div class="ov-bottom"><div class="work">${workChips(id)}</div>${captionHTML(id)}</div>`}
    ${flagged&&variant!=='strip'?`<span class="new-task">${icon('arrow','xs')}新任务 ${esc(flag.task)}</span>`:''}
  </article>`;
}
// Replace a tile only when its content changed, then move live <video> elements back in.
function reconcileTiles(container, items) {
  const old=new Map([...container.querySelectorAll(':scope > .tile, :scope .tile')].map(el=>[el.dataset.tile+'|'+el.dataset.variant,el]));
  const template=document.createElement('template');
  const nodes=items.map(({html})=>{template.innerHTML=html.trim();return template.content.firstElementChild;});
  const result=nodes.map(next=>{
    const prev=old.get(next.dataset.tile+'|'+next.dataset.variant);
    const sig=next.outerHTML;
    if(prev&&prev.dataset.sig===String(sig.length)+':'+hashText(sig)){old.delete(next.dataset.tile+'|'+next.dataset.variant);return prev;}
    next.dataset.sig=String(sig.length)+':'+hashText(sig);
    const glyph=prev?.querySelector('.activity-glyph'), incoming=next.querySelector('.activity-glyph');
    if(glyph&&incoming)incoming.replaceWith(glyph);
    return next;
  });
  return result;
}
function hashText(text) {let h=5381;for(let i=0;i<text.length;i++)h=(h*33^text.charCodeAt(i))>>>0;return h.toString(36);}
function attachVideos(root) {
  for(const slot of root.querySelectorAll('.video-slot[data-video]')){
    const b=captures.get(slot.dataset.video);
    if(b&&slot.firstElementChild!==b.video){slot.replaceChildren(b.video);b.video.play?.().catch(()=>{});}
  }
}
const phoneLayout=matchMedia('(max-width:767px)');
phoneLayout.addEventListener('change',()=>{$('stage-grid').replaceChildren();if(state)renderStage();});
function renderStage() {
  const grid=$('stage-grid'), stage=$('stage');
  if(!state||state.session.id!==selected){return;}
  const ids=stageAgentIds();
  // Phones always stack every tile; focus and solo layouts need a wide stage.
  const layout=phoneLayout.matches?'gallery':uiLayout;
  stage.dataset.layout=layout;
  if(!ids.includes(uiMain))uiMain=ids[0]||'';
  const speakers=new Map(ids.map(id=>[id,lastBoardMessage(id)?.id||'']));
  let items;
  if(!ids.length){grid.innerHTML='<p class="stage-empty">当前会话没有参与成员。请在右侧「成员」页启用成员。</p>';updateStageChrome(ids);return;}
  if(layout==='gallery'){
    items=ids.map(id=>({html:tileHTML(id,'full')}));
    const nodes=reconcileTiles(grid,items);
    if(grid.querySelector('.speaker-main,.strip,.solo-nav,.stage-empty'))grid.replaceChildren();
    nodes.forEach((node,index)=>{if(grid.children[index]!==node)grid.insertBefore(node,grid.children[index]||null);});
    while(grid.children.length>nodes.length)grid.lastElementChild.remove();
  } else if(layout==='speaker'){
    let main=grid.querySelector(':scope > .speaker-main'), strip=grid.querySelector(':scope > .strip');
    if(!main||!strip){grid.replaceChildren();main=document.createElement('div');main.className='speaker-main';strip=document.createElement('div');strip.className='strip';grid.append(main,strip);}
    const [mainNode]=reconcileTiles(main,[{html:tileHTML(uiMain,'full')}]);
    const stripNodes=reconcileTiles(strip,ids.filter(id=>id!==uiMain).map(id=>({html:tileHTML(id,'strip')})));
    if(main.firstElementChild!==mainNode)main.replaceChildren(mainNode);
    stripNodes.forEach((node,index)=>{if(strip.children[index]!==node)strip.insertBefore(node,strip.children[index]||null);});
    while(strip.children.length>stripNodes.length)strip.lastElementChild.remove();
  } else {
    const current=grid.querySelector(':scope > .tile');
    if(!grid.querySelector(':scope > .solo-nav'))grid.replaceChildren();
    const [node]=reconcileTiles(grid,[{html:tileHTML(uiMain,'full')}]);
    if(current!==node){current?.remove();grid.prepend(node);}
    if(!grid.querySelector(':scope > .solo-nav'))grid.insertAdjacentHTML('beforeend',`<button class="solo-nav prev" type="button" data-tile-act="prev" aria-label="上一位成员">${icon('chevron')}</button><button class="solo-nav next" type="button" data-tile-act="next" aria-label="下一位成员">${icon('chevron')}</button>`);
  }
  attachVideos(grid);
  // A new board message from a member: brief highlight, and auto-follow in speaker view.
  if(stageSpeakers){
    for(const [id,messageId] of speakers){
      if(!messageId||stageSpeakers.get(id)===messageId)continue;
      const tile=grid.querySelector(`.tile[data-tile="${CSS.escape(id)}"]`);
      if(tile&&!reducedMotion()){tile.classList.remove('speaking');void tile.offsetWidth;tile.classList.add('speaking');}
      if(layout==='speaker'&&capturePrefs.follow&&!uiPinned&&id!==uiMain&&Date.now()-lastFollowAt>8000){uiMain=id;lastFollowAt=Date.now();requestAnimationFrame(renderStage);}
    }
  }
  stageSpeakers=speakers;
  updateStageChrome(ids);
  layoutStage();
  renderPip();
}
function updateStageChrome(ids) {
  const bound=ids.filter(id=>{const s=captureState(id);return s==='live'||s==='static'||s==='hidden';}).length;
  $('capture-count').textContent=bound+'/'+ids.length;
  const live=liveCaptureCount();
  $('cap-indicator').hidden=!live;$('cap-ind-text').textContent=`正在显示 ${live} 个窗口画面`;
  $('stage-sub').textContent=`${{gallery:'宫格',speaker:'聚焦'+(uiPinned?' · 已锁定':capturePrefs.follow?' · 自动跟随':''),solo:'单屏'}[uiLayout]} · ${ids.length} 位参与`;
  const layoutMeta={gallery:['宫格','grid'],speaker:['聚焦','speaker'],solo:['单屏','solo']}[uiLayout];
  $('layout-label').textContent=layoutMeta[0];$('layout-icon').innerHTML=`<use href="#i-${layoutMeta[1]}"/>`;
  renderOnboarding(ids,bound);
}
function renderOnboarding(ids,bound) {
  const box=$('onboarding');
  const joined=ids.filter(id=>state.agents[id]?.last_read||state.agents[id]?.msgs).length;
  const humanSpoke=state.messages.some(m=>m.from==='human'&&['say','intervention','task'].includes(m.type));
  const dismissed=readJSON('agents-talk.onboarding-done',[]).includes(selected);
  if(dismissed||state.session.status==='ended'||(joined===ids.length&&humanSpoke)){box.hidden=true;return;}
  const steps=[['选择参与成员',ids.length>0,`${ids.length} 位`],['发送接入说明',joined===ids.length,`${joined}/${ids.length} 已接入`],['绑定窗口画面',bound===ids.length,`${bound}/${ids.length}`],['发出第一条需求',humanSpoke,'']];
  const now=steps.findIndex(s=>!s[1]);
  box.hidden=false;
  box.innerHTML=steps.map(([label,done,extra],i)=>`<span class="step ${done?'done':''} ${i===now?'now':''}"><b>${done?'✓':i+1}</b>${esc(label)}${extra?` · ${esc(extra)}`:''}</span>`).join('')+`<button class="icon-btn xs" type="button" data-tile-act="onboarding-close" aria-label="关闭引导" style="color:var(--on-stage-2)">${icon('x','sm')}</button>`;
}
function layoutStage() {
  const grid=$('stage-grid');if(!grid||$('stage').offsetParent===null)return;
  if(matchMedia('(max-width:767px)').matches){for(const t of grid.querySelectorAll('.tile'))t.style.removeProperty('--w');return;}
  const W=grid.clientWidth,H=grid.clientHeight,gap=14,layout=$('stage').dataset.layout;
  if(layout==='gallery'){
    const tiles=[...grid.querySelectorAll(':scope > .tile')],N=tiles.length;let best=0;
    for(let c=1;c<=N;c++){const r=Math.ceil(N/c);const w=Math.min((W-(c-1)*gap)/c,((H-(r-1)*gap)/r)*1.6);if(w>best)best=w;}
    for(const t of tiles)t.style.setProperty('--w',Math.max(160,Math.floor(best))+'px');
  } else if(layout==='speaker'){
    // Filmstrip on the right or at the bottom, whichever leaves the larger main tile.
    const right=Math.min(W-220-gap,H*1.6), bottom=Math.min(W,(H-124-gap)*1.6), pos=bottom>right?'bottom':'right';
    $('stage').dataset.strip=pos;
    grid.querySelector('.speaker-main > .tile')?.style.setProperty('--w',Math.max(200,Math.floor(pos==='right'?right:bottom))+'px');
    for(const t of grid.querySelectorAll('.strip > .tile'))t.style.setProperty('--w',pos==='right'?'210px':'198px');
  } else grid.querySelector(':scope > .tile')?.style.setProperty('--w',Math.max(200,Math.floor(Math.min(W-96,H*1.6)))+'px');
}
new ResizeObserver(()=>layoutStage()).observe($('stage-area'));
function setLayout(layout,id) {
  uiLayout=layout;writeStorage('agents-talk.layout',layout);
  if(id){uiMain=id;uiPinned=layout!=='gallery';}
  if(layout==='gallery')uiPinned=false;
  for(const t of $$('#stage-grid .tile'))t.remove();
  $('stage-grid').replaceChildren();renderStage();
}
// Dispatch handoff: arc from the dispatcher's tile to the receiver's, only for fresh events.
function stageHandoff(event) {
  if(!event?.to)return;
  newTaskFlags.set(event.to,{task:event.task,at:Date.now()});
  setTimeout(()=>{if(state)renderStage();},6100);
  renderStage();
  if(uiView!=='live'||reducedMotion())return;
  const stage=$('stage'),svg=$('handoff'),sr=stage.getBoundingClientRect();
  const a=$('stage-grid').querySelector(`.tile[data-tile="${CSS.escape(event.from)}"]`),b=$('stage-grid').querySelector(`.tile[data-tile="${CSS.escape(event.to)}"]`);
  if(!a||!b||a===b)return;
  const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
  const x1=ra.left+ra.width/2-sr.left,y1=ra.top+ra.height/2-sr.top,x2=rb.left+rb.width/2-sr.left,y2=rb.top+rb.height/2-sr.top;
  const mx=(x1+x2)/2,my=(y1+y2)/2-Math.max(60,Math.abs(x2-x1)*.25),len=Math.hypot(x2-x1,y2-y1)*1.4;
  const ca=getComputedStyle(a).getPropertyValue('--agent').trim()||'#fff',cb=getComputedStyle(b).getPropertyValue('--agent').trim()||'#fff';
  svg.innerHTML=`<defs><linearGradient id="handoff-gradient" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${ca}"/><stop offset="1" stop-color="${cb}"/></linearGradient></defs><path d="M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}" stroke="url(#handoff-gradient)" style="--len:${len}"/><circle cx="${x1}" cy="${y1}" r="5" fill="${ca}"/><circle cx="${x2}" cy="${y2}" r="5" fill="${cb}"/>`;
  const tag=document.createElement('div');tag.className='handoff-label';tag.style.left=mx+'px';tag.style.top=((my+(y1+y2)/2)/2)+'px';
  tag.innerHTML=`${avatar(event.from,'sm')}${event.type==='reassign'?'转交':'派发'} ${esc(event.task)}${icon('arrow','xs')}${avatar(event.to,'sm')}`;
  stage.append(tag);setTimeout(()=>{tag.remove();svg.innerHTML='';},3200);
}
async function copyGuide(id) {
  closePop();
  if(!sessionReady()){toast('连接恢复后再复制接入说明',true);return;}
  const key=selected+':'+state.session.instance_revision+':'+state.session.participants.join(',');
  try {
    if(skillCache.key!==key){skillCache.data=await api('/api/skills?session='+encodeURIComponent(selected));skillCache.key=key;}
    const text=skillCache.data[id];if(!text)throw Error('没有找到该成员的接入说明');
    if(await copyText(text))toast(`已复制 ${name(id)} 的接入说明，请粘贴到对应客户端的独立对话`);
    else {skillAgent=id;openSkills();}
  } catch(e) {toast(e.message,true);}
}
function captureMenu(anchor) {
  const ids=stageAgentIds();
  openPop(anchor,`<div class="pop-title">成员画面<span class="sp"></span><span>只在本机显示</span></div>${ids.map(id=>{const st=captureState(id),b=captures.get(id);
    const sub=b?`${b.label}${b.width?` · ${b.width}×${b.height}`:''}`:st==='stale'?'上次：'+(captureLabels[id]?.label||''):'尚未选择窗口';
    const bound=b&&b.state!=='ended';
    return `<div class="cap-row">${avatar(id,'sm')}<span style="min-width:0">${esc(name(id))}<small>${esc(sub)}</small></span><span style="display:flex;gap:6px;align-items:center"><span class="st" data-s="${st}"><i></i>${CAPTURE_TEXT[st]}</span>${bound?`<button class="btn btn-line sm" type="button" data-tile-act="bind" data-id="${esc(id)}" title="重新选择窗口" aria-label="重新选择 ${esc(name(id))} 的窗口">${icon('refresh','xs')}</button><button class="btn btn-line sm" type="button" data-tile-act="stop" data-id="${esc(id)}" title="停止画面" aria-label="停止 ${esc(name(id))} 的画面">${icon('stop','xs')}</button>`:`<button class="btn btn-primary sm" type="button" data-tile-act="bind" data-id="${esc(id)}">绑定</button>`}</span></div>`;}).join('')}
    <div class="pop-foot"><span class="subtle">画质</span><div class="seg-mini">${[[15,'流畅'],[5,'均衡'],[1,'省电']].map(([q,l])=>`<button type="button" data-quality-set="${q}" aria-pressed="${capturePrefs.quality===q}">${l}</button>`).join('')}</div><span class="sp"></span><button class="btn btn-line sm" type="button" data-tile-act="stop-all" ${captures.size?'':'disabled'}>全部停止</button></div>
    <p class="pop-note">${icon('info','xs')} 在浏览器选择器里切换到「窗口」。窗口可以被遮挡，但不要最小化。画面只在本页显示，不会上传。${captureSupported()?'':'<br><b>当前浏览器不支持窗口共享。</b>'}</p>`,{above:true,align:'center'});
}
function layoutMenu(anchor) {
  const opt=(k,ic,t,d)=>`<button class="menu-item" type="button" role="menuitemradio" aria-checked="${uiLayout===k}" data-set-layout="${k}">${icon(ic)}<span>${t}<small>${d}</small></span>${uiLayout===k?icon('check','sm check-i end'):''}</button>`;
  openPop(anchor,`<div class="pop-title">舞台布局</div>${opt('gallery','grid','宫格','同时看到所有成员 · G')}${opt('speaker','speaker','聚焦','一个主画面加缩略条 · S')}${opt('solo','solo','单屏','一位成员占满舞台 · Alt+数字')}<div class="menu-sep"></div>
    <label class="menu-item"><span style="flex:1">自动跟随发言成员<small>聚焦布局下切换到最近发言的成员</small></span><span class="switch"><input type="checkbox" data-capture-pref="follow" ${capturePrefs.follow?'checked':''}><span></span></span></label>
    <label class="menu-item"><span style="flex:1">显示发言字幕<small>成员在看板发布的最新消息</small></span><span class="switch"><input type="checkbox" data-capture-pref="captions" ${capturePrefs.captions?'checked':''}><span></span></span></label>`,{above:true,align:'center'});
}
function moreMenu(anchor) {
  openPop(anchor,`<button class="menu-item" type="button" data-export="json">${icon('download')}导出 JSON</button><button class="menu-item" type="button" data-export="md">${icon('download')}导出 Markdown</button><div class="menu-sep"></div><button class="menu-item" type="button" data-menu-act="skills">${icon('book')}接入指南</button><button class="menu-item" type="button" data-menu-act="context">${icon('eye')}预览成员所见</button><button class="menu-item" type="button" data-menu-act="keys">${icon('keyboard')}快捷键</button>`,{above:true,align:'end'});
}
function tileMenu(anchor,id) {
  const b=captures.get(id);
  openPop(anchor,`<div class="pop-title">${esc(name(id))}</div><button class="menu-item" type="button" data-tile-act="bind" data-id="${esc(id)}">${icon('refresh')}${b?'重新选择窗口':'绑定窗口'}</button>${b?`<button class="menu-item" type="button" data-tile-act="stop" data-id="${esc(id)}">${icon('stop')}停止画面</button>`:''}<button class="menu-item" type="button" data-tile-act="guide" data-id="${esc(id)}">${icon('copy')}复制接入说明</button><div class="menu-sep"></div><button class="menu-item" type="button" data-tile-act="tasks" data-id="${esc(id)}">${icon('tasks')}查看 TA 的任务</button><button class="menu-item" type="button" data-tile-act="filter" data-id="${esc(id)}">${icon('message')}只看 TA 的消息</button>`,{align:'end'});
}
function shortcutsMenu(anchor) {
  openPop(anchor,`<div class="pop-title">快捷键</div><div class="shortcut-list"><kbd>/</kbd><span>聚焦输入框</span><kbd>Ctrl+Enter</kbd><span>发送（输入法组词时不触发）</span><kbd>G</kbd><span>宫格布局</span><kbd>S</kbd><span>聚焦布局</span><kbd>Alt+1…9</kbd><span>单屏查看第 N 位成员</span><kbd>Esc</kbd><span>返回宫格 / 关闭弹层</span><kbd>Ctrl+B</kbd><span>收起或展开侧栏</span><kbd>Ctrl+J</kbd><span>收起或展开右侧面板</span></div>`,{above:true,align:'end'});
}

// One delegated handler for tiles, stage buttons and the stage menus.
async function stageAction(el) {
  const act=el.dataset.tileAct, id=el.dataset.id;
  if(act==='bind')return bindWindow(id);
  if(act==='stop'){closePop();stopCapture(id);return;}
  if(act==='stop-all'){closePop();stopAllCaptures();return;}
  if(act==='snap')return snapshotCapture(id);
  if(act==='guide')return copyGuide(id);
  if(act==='solo'){setLayout('solo',id);return;}
  if(act==='focus'){setLayout('speaker',id);return;}
  if(act==='dm'){focusComposer({to:id});return;}
  if(act==='more'){tileMenu(el,id);return;}
  if(act==='tasks'){closePop();openSideTab('tasks');return;}
  if(act==='filter'){closePop();focusComposer({});$('chat-search').hidden=false;$('search-toggle').setAttribute('aria-pressed','true');$('agent-filter').value=id;renderKey='';render();return;}
  if(act==='prev'||act==='next'){const ids=stageAgentIds(),i=ids.indexOf(uiMain);uiMain=ids[(i+(act==='next'?1:ids.length-1))%ids.length];renderStage();return;}
  if(act==='onboarding-close'){const done=readJSON('agents-talk.onboarding-done',[]);done.push(selected);writeJSON('agents-talk.onboarding-done',done.slice(-50));$('onboarding').hidden=true;}
}
$('stage').addEventListener('click',e=>{
  const el=e.target.closest('[data-tile-act]');if(el){stageAction(el);return;}
  const tile=e.target.closest('.strip > .tile');if(tile){uiPinned=true;uiMain=tile.dataset.tile;renderStage();}
});
$('stage-grid').addEventListener('dblclick',e=>{const tile=e.target.closest('.tile');if(tile&&!e.target.closest('button'))setLayout(uiLayout==='solo'?'gallery':'solo',tile.dataset.tile);});
$('pop').addEventListener('click',e=>{
  const el=e.target.closest('[data-tile-act]');if(el){stageAction(el);return;}
  const layout=e.target.closest('[data-set-layout]');if(layout){closePop();setLayout(layout.dataset.setLayout);return;}
  const q=e.target.closest('[data-quality-set]');if(q){setCaptureQuality(Number(q.dataset.qualitySet));for(const b of $$('[data-quality-set]',$('pop')))b.setAttribute('aria-pressed',String(b===q));toast('画质已切换为 '+q.textContent);return;}
  const exp=e.target.closest('[data-export]');if(exp){closePop();exportSession(exp.dataset.export);return;}
  const act=e.target.closest('[data-menu-act]');
  if(act){const kind=act.dataset.menuAct;if(kind==='keys'){shortcutsMenu($('more-open'));return;}closePop();if(kind==='skills')openSkills();if(kind==='context')openContextPreview();}
});
$('pop').addEventListener('change',e=>{
  const pref=e.target.dataset.capturePref;if(!pref)return;
  capturePrefs[pref]=e.target.checked;saveCapturePrefs();syncCapturePrefControls();renderStage();
});
$('stop-all-capture').onclick=()=>stopAllCaptures();
$('capture-open').onclick=e=>captureMenu(e.currentTarget);
$('layout-open').onclick=e=>layoutMenu(e.currentTarget);
$('more-open').onclick=e=>moreMenu(e.currentTarget);
$('pip-open').onclick=()=>openPip();
$('intervene-open').onclick=()=>focusComposer({to:'all',intervene:true});
$('pause-resume').onclick=()=>control(state.session.status==='paused'?'active':'paused',{},'控制信号已发布，请查看成员确认回执。');
$('finish-session').onclick=()=>{if(!sessionReady()||operations.has(selected))return;finishSnapshot=snapshot();$('finish-dialog').showModal();errorAt('finish-error');};
