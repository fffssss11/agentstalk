'use strict';
// Conversation: every board event is shown. "概要" keeps each to its gist; "详细" expands all.
const TASK_TYPES=new Set(['task','claim','progress','done','review','blocked','reassign','workflow']);
const TALK_TYPES=new Set(['say','plan','question','answer','decision']);
let detailMode=readStorage('agents-talk.detail')==='full'?'full':'summary', chatFilter='all', intervene=false;
const openOverrides=new Map(), messageNodes=new Map();
let chatBaseline=null, newFlash=readStorage('agents-talk.flash')!=='off';

function messageKind(m) {
  // Protocol chatter (including the human's own setting changes) renders as compact event rows.
  if(SYSTEM_TYPES.has(m.type))return 'system';
  if(m.from==='human')return 'human';
  if(TASK_TYPES.has(m.type))return 'task';
  return 'talk';
}
function bodyHTML(text) {
  return String(text).split(/```/).map((part,i)=>{
    if(i%2===0) return part?`<span class="body-text">${esc(part)}</span>`:'';
    const newline=part.indexOf('\n'); const language=newline>=0?part.slice(0,newline):'';
    const code=newline>=0?part.slice(newline+1):part;
    return `<details class="code-block" open><summary>${esc(language||'代码')}<button type="button" class="copy-code">复制</button></summary><pre><code>${esc(code)}</code></pre></details>`;
  }).join('');
}
function mediaHTML(a) {
  const url='/media/'+encodeURIComponent(a.id);
  let view='';
  if(a.mime?.startsWith('image/')) view=`<img class="attachment-media" src="${url}" alt="${esc(a.name)}" loading="lazy">`;
  if(a.mime?.startsWith('video/')) view=`<video class="attachment-media" src="${url}" controls preload="metadata"></video>`;
  return `<div class="message-attachment">${view}<a class="attachment-link" href="${url}" download="${esc(a.name)}">${esc(a.name)}<small>${(a.size/1024).toFixed(1)} KB · 下载附件</small></a></div>`;
}
const firstLine=text=>String(text||'').replace(/```[\s\S]*?```/g,' [代码] ').replace(/\s+/g,' ').trim();
// One short line per event: who did what to which task, plus the most useful text.
function eventSummary(m) {
  const t=m.task?`<b class="mono">${esc(m.task)}</b>`:'';
  const to=m.to?.[0];
  const usageTotal=m.usage?(m.usage.input||0)+(m.usage.output||0):null;
  switch(m.type){
    case 'task':return {verb:`派发 ${t} → ${esc(name(to))}${m.reviewer?` · 验收 ${esc(name(m.reviewer))}`:''}${m.stage==='integration'?' · 整合':''}`,gist:m.summary||firstLine(m.body)};
    case 'claim':return {verb:`认领 ${t}`,gist:firstLine(m.body)};
    case 'progress':return {verb:`进展 ${t}`,gist:m.summary||firstLine(m.body)};
    case 'done':return {verb:`提交 ${t} 待审查`,gist:m.summary||m.result||firstLine(m.body)};
    case 'review':return {verb:`审查 ${t} · ${m.verdict==='pass'?'通过':'退回'}`,gist:m.summary||firstLine(m.body)};
    case 'blocked':return {verb:`受阻 ${t}`,gist:m.blockers||m.summary||firstLine(m.body)};
    case 'reassign':return {verb:`转交 ${t} → ${esc(name(to))}`,gist:firstLine(m.body)};
    case 'workflow':return {verb:`调整 ${t} 协作安排`,gist:firstLine(m.body)};
    case 'join':return {verb:'已接入',gist:firstLine(m.body)};
    case 'leave':return {verb:'退出读取',gist:firstLine(m.body)};
    case 'lock':return {verb:`占用 ${m.files?.length||0} 个文件${m.task?' · '+esc(m.task):''}`,gist:(m.files||[]).join('、')};
    case 'unlock':return {verb:`释放${m.files?.length?` ${m.files.length} 个`:'全部'}文件${m.task?' · '+esc(m.task):''}`,gist:(m.files||[]).join('、')};
    case 'idle':return {verb:'等待中',gist:firstLine(m.body)};
    case 'ack':return {verb:'已确认人工要求',gist:firstLine(m.body)};
    case 'usage':return {verb:`上报用量 ${usageTotal==null?'':fmt(usageTotal)+' tokens'}`,gist:m.usage?`${m.usage.provider} / ${m.usage.model}`:''};
    case 'capability':return {verb:`能力报告 · ${esc(kinds[m.kind]||m.kind||'')} ${esc(availability[m.availability]||m.availability||'')}`,gist:firstLine(m.body)};
    default:return {verb:'',gist:firstLine(m.body||m.summary||'')};
  }
}
function badgeFor(m) {
  const map={plan:['方案',''],decision:['定案','accent'],question:['提问',''],answer:['回答',''],intervention:['⚡ 优先干预','warn'],control:['人工控制','warn'],settings:['设置',''],instance:['实例设置',''],session:['新会话','']};
  const b=map[m.type];return b?`<span class="badge message-type ${b[1]}">${b[0]}</span>`:'';
}
function receiptTargets(m) {
  return ((m.to||['all']).includes('all')?Object.keys(state.agents):m.to).filter(a=>(state.session.participants||Object.keys(state.agents)).includes(a));
}
// ACKs may be outside the loaded window, so the server supplies receipts.
function ackedBy(m) {return state.receipts?.[m.id]||state.messages.filter(a=>a.type==='ack'&&a.reply_to===m.id).map(a=>a.from);}
function receiptsHTML(m) {
  if(!['intervention','control'].includes(m.type))return '';
  const acked=ackedBy(m);
  return `<div class="receipts">${receiptTargets(m).map(a=>`<span class="receipt ${acked.includes(a)?'ok':'wait'}">${avatar(a)}${esc(name(a))}${acked.includes(a)?' 已确认':' 待确认'}</span>`).join('')}</div>`;
}
function detailHTML(m) {
  const u=m.usage;
  const fields=[['结论',m.summary],['交付',m.result],['验证',m.verification],['遗留',m.blockers,'warn'],['整合方式',m.integration_plan],
    ...(u?[['用量',`输入 ${fmt(u.input)} · 输出 ${fmt(u.output)}${u.cached_input!=null?` · 缓存输入 ${fmt(u.cached_input)}`:''}${u.reasoning_output!=null?` · 推理输出 ${fmt(u.reasoning_output)}`:''}`],['来源',`${u.provider} / ${u.model} · ${u.source}`]]:[])].filter(r=>r[1]);
  const meta=[m.task?`任务 ${esc(m.task)}${m.verdict?' · '+esc(m.verdict==='pass'?'通过':m.verdict):''}`:'',m.reviewer&&m.type!=='task'?`验收 ${esc(name(m.reviewer))}`:'',m.depends_on?.length?`依赖 ${esc(m.depends_on.join('、'))}`:'',m.reply_to?`回复 <code>${esc(m.reply_to)}</code>`:'',`编号 <code>${esc(m.id)}</code>`].filter(Boolean);
  return `${m.body?`<div class="message-body">${bodyHTML(m.body)}</div>`:''}${fields.length?`<dl class="fields">${fields.map(([k,v,c])=>`<dt>${k}</dt><dd class="${c||''}">${esc(v)}</dd>`).join('')}</dl>`:''}${m.files?.length?'<div class="message-files">'+m.files.map(f=>`<span class="file-chip">${esc(f)}</span>`).join('')+'</div>':''}<div class="meta-row">${meta.join('<span aria-hidden="true">·</span>')}</div>`;
}
function messageSig(m) {return JSON.stringify([name(m.from),state.agents[m.from]?.model||'',(m.to||[]).map(instanceLabel)]);}
function messageHTML(m) {
  const kind=messageKind(m), {verb,gist}=eventSummary(m);
  const instance=[state.agents[m.from]?.model?'标注 '+state.agents[m.from].model:'',isExtraInstance(m.from)?m.from:''].filter(Boolean).join(' · ');
  const recipients=(m.to||['all']).filter(x=>x!=='all');
  return `<button class="msg-line" type="button" aria-expanded="false">${avatar(m.from)}<span class="msg-head"><span class="message-author">${esc(name(m.from))}</span>${instance?`<span class="message-instance" title="当前实例编号和模型标注；实际调用模型以 usage 来源为准">${esc(instance)}</span>`:''}${recipients.length&&m.type!=='task'&&m.type!=='reassign'?`<span class="message-recipient">→ ${esc(recipients.map(instanceLabel).join('、'))}</span>`:m.from==='human'&&kind==='human'&&m.type!=='settings'?'<span class="message-recipient">→ 所有成员</span>':''}${badgeFor(m)}${verb?`<span class="msg-verb">${verb}</span>`:''}</span><span class="message-time" title="${esc(m.ts)}">${esc(clockTime(m.ts))}</span>${gist?`<span class="msg-gist">${esc(gist)}</span>`:''}</button>${receiptsHTML(m)}${m.attachments?.length?'<div class="message-attachments">'+m.attachments.map(mediaHTML).join('')+'</div>':''}<div class="msg-detail">${detailHTML(m)}</div>`;
}
function isOpen(m) {return openOverrides.has(m.id)?openOverrides.get(m.id):detailMode==='full';}
function matchesFilter(m) {
  const kind=messageKind(m);
  if(chatFilter==='talk'&&!(kind==='talk'))return false;
  if(chatFilter==='task'&&!TASK_TYPES.has(m.type))return false;
  if(chatFilter==='human'&&m.from!=='human')return false;
  const filter=$('agent-filter').value, search=$('search-input').value.toLocaleLowerCase();
  if(filter!=='all'&&m.from!==filter)return false;
  if(search&&![m.body,m.summary,m.result,m.task,name(m.from),types[m.type],...(m.files||[])].join(' ').toLocaleLowerCase().includes(search))return false;
  return true;
}
function renderMessages() {
  const scroll=$('message-scroll'), container=$('messages');
  const nearBottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<90;
  const visible=state.messages.filter(matchesFilter);
  const filtered=chatFilter!=='all'||$('agent-filter').value!=='all'||!!$('search-input').value;
  $('clear-filters').hidden=!filtered;
  $('empty-conversation').hidden=state.total>0;
  $('no-results').hidden=visible.length>0||state.total===0;
  $('load-older').hidden=state.messages.length>=state.total||limit>=10000;
  container.dataset.detail=detailMode;
  const anchor=[...container.children].find(n=>n.getBoundingClientRect().bottom>scroll.getBoundingClientRect().top);
  const anchorTop=anchor?.getBoundingClientRect().top;
  const baseline=chatBaseline===null;chatBaseline??=new Set();
  const nextNodes=[];
  for(const m of visible) {
    let el=messageNodes.get(m.id);
    const sig=messageSig(m);
    if(!el||el.dataset.sig!==sig) {
      const kind=messageKind(m);
      const fresh=!el&&!baseline&&!chatBaseline.has(m.id);
      el=document.createElement('article');
      el.className=`message ${kind}${m.type==='intervention'||m.type==='control'?' intervention':''}${fresh&&newFlash?' fresh':''}`;
      el.dataset.id=m.id;el.dataset.sender=m.from;el.dataset.type=m.type;el.dataset.client=m.from==='human'?'human':clientId(m.from);el.dataset.sig=sig;
      el.innerHTML=messageHTML(m);
      messageNodes.set(m.id,el);
    } else if(['intervention','control'].includes(m.type)) {
      const receipts=el.querySelector('.receipts'), html=receiptsHTML(m);
      if(receipts&&receipts.outerHTML!==html)receipts.outerHTML=html;
    }
    chatBaseline.add(m.id);
    const open=isOpen(m);
    if(el.dataset.open!==String(open)){el.dataset.open=String(open);el.querySelector('.msg-line').setAttribute('aria-expanded',String(open));}
    nextNodes.push(el);
  }
  // Keep unchanged nodes attached so a new message does not interrupt video playback.
  const wanted=new Set(nextNodes);
  for(const node of [...container.children]) if(!wanted.has(node)) node.remove();
  nextNodes.forEach((node,index)=>{const current=container.children[index];if(current!==node)container.insertBefore(node,current||null);});
  if(!nearBottom&&anchor?.isConnected) scroll.scrollTop+=anchor.getBoundingClientRect().top-anchorTop;
  const view=snapshot();
  if(nearBottom) requestAnimationFrame(()=>{if(!isCurrent(view))return;scroll.scrollTop=scroll.scrollHeight;$('jump-latest').hidden=true;});
  else if(visible.length&&!baseline) $('jump-latest').hidden=false;
  renderPinned();
}
function renderPinned() {
  // Newest human intervention still waiting for acknowledgements stays pinned on top.
  const pending=[...state.messages].reverse().find(m=>m.type==='intervention'&&receiptTargets(m).some(a=>!ackedBy(m).includes(a)));
  const box=$('pinned');
  if(!pending){if(box.innerHTML)box.innerHTML='';return;}
  const html=`<div class="pinned" data-pinned="${esc(pending.id)}"><div class="pinned-head">${icon('bolt','xs')}干预待确认</div><p>${esc(pending.body)}</p>${receiptsHTML(pending)}</div>`;
  if(box.innerHTML!==html)box.innerHTML=html;
}
function setDetailMode(mode,{persist=true}={}) {
  detailMode=mode;openOverrides.clear();if(persist)writeStorage('agents-talk.detail',mode);
  for(const b of $$('#detail-mode [data-detail], #pref-detail [data-detail]'))b.setAttribute('aria-pressed',String(b.dataset.detail===mode));
  if(state)renderMessages();
}
$('messages').addEventListener('click',async e=>{
  const copy=e.target.closest('.copy-code');
  if(copy){e.preventDefault();e.stopPropagation();const ok=await copyText(copy.closest('.code-block').querySelector('code').textContent);copy.textContent=ok?'已复制':'请手动复制';setTimeout(()=>copy.textContent='复制',2000);return;}
  const line=e.target.closest('.msg-line');if(!line)return;
  const article=line.closest('.message'), open=article.dataset.open!=='true';
  openOverrides.set(article.dataset.id,open);article.dataset.open=String(open);line.setAttribute('aria-expanded',String(open));
});
$('detail-mode').addEventListener('click',e=>{const b=e.target.closest('[data-detail]');if(b)setDetailMode(b.dataset.detail);});
$('chat-filters').addEventListener('click',e=>{
  const b=e.target.closest('[data-f]');if(!b)return;chatFilter=b.dataset.f;
  for(const c of $$('#chat-filters [data-f]'))c.setAttribute('aria-pressed',String(c===b));
  renderKey='';if(state)render();
});
$('search-toggle').onclick=()=>{
  const box=$('chat-search'), open=box.hidden;box.hidden=!open;$('search-toggle').setAttribute('aria-pressed',String(open));
  if(open)$('search-input').focus();
};
$('search-input').oninput=$('agent-filter').onchange=()=>{renderKey='';if(state)render();};
$('clear-filters').onclick=()=>{
  $('search-input').value='';$('agent-filter').value='all';chatFilter='all';
  for(const c of $$('#chat-filters [data-f]'))c.setAttribute('aria-pressed',String(c.dataset.f==='all'));
  renderKey='';render();
};
$('load-older').onclick=()=>{limit=Math.min(10000,limit+300);renderKey='';sync({fresh:true});};
$('jump-latest').onclick=()=>{$('message-scroll').scrollTop=$('message-scroll').scrollHeight;$('jump-latest').hidden=true;};
$('message-scroll').onscroll=()=>{const s=$('message-scroll');if(s.scrollHeight-s.scrollTop-s.clientHeight<90)$('jump-latest').hidden=true;};

// Composer.
function updateComposer() {
  const ready=sessionReady(), busy=operations.has(selected);
  const ended=state?.session.status==='ended';
  const locked=!ready||busy||ended;
  $('instances-open').disabled=!ready||busy;
  for(const id of ['instance-name','instance-model','instance-role','instance-save','instance-new'])$(id).disabled=locked;
  $('instance-client').disabled=locked||!!editingInstance;
  $('send-button').disabled=locked;
  $('attach-button').disabled=$('file-input').disabled=$('snapshot-button').disabled=locked;
  $('message-body').disabled=busy||!selected||(ready&&ended);
  for(const id of ['mode-select','lead-select','shared-context','pause-resume','finish-session','confirm-finish','tab-message','tab-media','media-kind','media-recipient','recipient-select','intervene-toggle','intervene-open']) $(id).disabled=locked;
  $$('[data-participant]').forEach(el=>el.disabled=locked||el.dataset.participant===state?.session.lead);
  $('task-list').querySelectorAll('[data-reassign]').forEach(el=>el.disabled=locked||!!state?.session.migration_required);
  for(const id of ['skills-open','empty-guide','reader-reconnect','context-preview-open','export-format','session-menu']) $(id).disabled=!ready;
  $('new-session').disabled=$('create-session-submit').disabled=!ready||busy||creating;
  $('new-session-title').disabled=$('new-session-mode').disabled=creating;
  $('message-form').setAttribute('aria-busy',String(busy));
  $('message-form').classList.toggle('intervene',intervene&&!mediaTab);
  $('intervene-toggle').setAttribute('aria-pressed',String(intervene));
  $('send-label').textContent=busy?'正在发送…':mediaTab?'创建媒体任务':intervene?'发送干预':'发送';
  const cap=state?.agents[$('media-recipient').value]?.capabilities[$('media-kind').value];
  $('media-capability').textContent=availability[cap?.status||'unverified'];
  $('media-capability').className='badge '+(cap?.status==='available'?'ok':cap?.status==='unavailable'?'danger':'');
  let note=ended?'会话已结束，仍可查看与导出记录。':state?.session.status==='paused'?'协作暂停中，可以补充要求；恢复后成员才会继续工作。':mediaTab?'将创建待办任务。成员确认工具可用后才会认领，面板不会自行调用生成服务。':intervene?'成员下次读取时收到并需要明确确认；正在执行的外部工具无法即时中断。':'';
  if(mediaTab && state?.session.status==='paused') $('send-button').disabled=true;
  if(mediaTab && state?.session.migration_required) {$('send-button').disabled=true;note='请先选择新的主导成员，再创建媒体任务。';}
  if(mediaTab && !$('media-recipient').value)$('send-button').disabled=true;
  $('composer-notice').innerHTML=note?icon(intervene&&!mediaTab?'bolt':'info','xs')+`<span>${esc(note)}</span>`:'';$('composer-notice').hidden=!note;
}
function setTab(media) {
  if(operations.has(selected)) return;
  mediaTab=media; draft.requestKey=null; $('message-options').hidden=media; $('media-options').hidden=!media;
  for(const [id,on] of [['tab-message',!media],['tab-media',media]]) {$(id).setAttribute('aria-selected',String(on)); $(id).tabIndex=on?0:-1;}
  updateComposer();
}
function setIntervene(on) {if(operations.has(selected))return;intervene=on;draft.requestKey=null;updateComposer();}
function openSideTab(tab) {
  if(phoneLayout.matches){setMobileTab(tab==='chat'?'chat':tab);return;}
  if(uiView!=='live')setView('live');
  setSidePanel(true);setSideTab(tab);
}
function focusComposer({to,intervene:urgent}={}) {
  openSideTab('chat');
  if(mediaTab)setTab(false);
  if(to&&[...$('recipient-select').options].some(o=>o.value===to&&!o.disabled))$('recipient-select').value=to;
  if(urgent!==undefined)setIntervene(urgent);
  updateComposer();
  requestAnimationFrame(()=>$('message-body').focus());
}
function renderAttachments() {
  $('attachment-list').innerHTML=draft.attachments.map((a,i)=>`<div class="pending-attachment">${a.mime.startsWith('image/')?`<img src="/media/${encodeURIComponent(a.id)}" alt="${esc(a.name)}">`:`<div class="file-icon">${icon('clip','sm')}</div>`}<span class="pending-attachment-name">${esc(a.name)}</span><span class="pending-attachment-status">已上传 · ${(a.size/1024).toFixed(1)} KB</span><button class="remove-attachment" type="button" data-remove="${i}" aria-label="移除 ${esc(a.name)}">${icon('x','xs')}</button></div>`).join('');
}
async function uploadFiles(files) {
  if(!files.length||!sessionReady()||operations.has(selected))return;
  if(draft.attachments.length+files.length>8) return errorAt('composer-error','单条消息最多 8 个附件。');
  const op=beginOperation('upload');if(!op)return;errorAt('composer-error');
  try {for(const file of files) {if(file.size>32*1024*1024) throw Error(file.name+' 超过 32 MB');const r=await fetch('/api/upload?name='+encodeURIComponent(file.name),{method:'POST',headers:{'X-Agents-Token':op.csrf},body:file,signal:AbortSignal.timeout(60000)});const a=await r.json();if(!r.ok) throw Error(a.error);op.draft.attachments.push(a);op.draft.requestKey=null;if(draft===op.draft)renderAttachments();}}
  catch(e){if(isCurrent(op))errorAt('composer-error',e.message);}
  finally{endOperation(op);}
}
$('message-form').addEventListener('submit',async e=>{
  e.preventDefault(); if(!sessionReady()||operations.has(selected)||state.session.status==='ended'||(mediaTab&&(state.session.status==='paused'||state.session.migration_required))) return;
  const body=$('message-body').value.trim(); if(!body) return errorAt('composer-error','请写下需求或消息内容。');
  saveDraft(); const op=beginOperation('send'); if(!op)return;
  errorAt('composer-error');
  const data={session:op.session,type:mediaTab?'task':intervene?'intervention':'say',to:[mediaTab?$('media-recipient').value:$('recipient-select').value],body,attachments:op.draft.attachments.map(a=>a.id)};
  if(mediaTab)data.kind=$('media-kind').value;
  const signature=JSON.stringify(data);
  if(!op.draft.requestKey||op.draft.requestPayload!==signature)op.draft.requestKey=crypto.randomUUID();
  op.draft.requestPayload=signature;data.request_id=op.draft.requestKey;
  if(mediaTab)data.task='M-'+data.request_id.slice(0,12);
  try {
    await api('/api/post',data,op);
    // Commit only to the captured draft, including its storage key.
    op.draft.body='';op.draft.attachments=[];op.draft.requestKey=null;
    writeStorage('agents-talk.draft.'+op.session,'');
    if(draft===op.draft) {$('message-body').value='';autosizeComposer();renderAttachments();}
    if(isCurrent(op)) {toast(data.kind?'媒体任务已创建，等待成员接单。':data.type==='intervention'?'干预已发布，等待成员确认。':'消息已发布。');if(data.type==='intervention')intervene=false;renderKey='';await sync({fresh:true});}
  } catch(e) {if(isCurrent(op))errorAt('composer-error',e.message);}
  finally {endOperation(op);}
});
function autosizeComposer() {const el=$('message-body');el.style.height='auto';el.style.height=Math.min(220,Math.max(60,el.scrollHeight))+'px';}
$('message-body').addEventListener('input',()=>{saveDraft();draft.requestKey=null;autosizeComposer();});
$('message-body').addEventListener('keydown',e=>{if(!e.isComposing&&e.keyCode!==229&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();$('message-form').requestSubmit();}});
$('message-body').addEventListener('paste',e=>{
  const files=[...(e.clipboardData?.files||[])];if(!files.length)return;
  e.preventDefault();uploadFiles(files);
});
for(const type of ['dragenter','dragover'])$('message-form').addEventListener(type,e=>{if([...(e.dataTransfer?.types||[])].includes('Files')){e.preventDefault();$('message-form').classList.add('dragging');}});
for(const type of ['dragleave','drop'])$('message-form').addEventListener(type,e=>{if(type==='dragleave'&&$('message-form').contains(e.relatedTarget))return;$('message-form').classList.remove('dragging');});
$('message-form').addEventListener('drop',e=>{const files=[...(e.dataTransfer?.files||[])];if(files.length){e.preventDefault();uploadFiles(files);}});
$('tab-message').onclick=()=>setTab(false); $('tab-media').onclick=()=>setTab(true);
for(const id of ['tab-message','tab-media']) $(id).addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setTab(!mediaTab);$(mediaTab?'tab-media':'tab-message').focus();}});
for(const id of ['media-kind','media-recipient','recipient-select']) $(id).onchange=()=>{if(!operations.has(selected))draft.requestKey=null;updateComposer();};
$('intervene-toggle').onclick=()=>setIntervene(!intervene);
$('attach-button').onclick=()=>$('file-input').click();
$('file-input').onchange=()=>{const files=[...$('file-input').files];$('file-input').value='';uploadFiles(files);};
$('snapshot-button').onclick=e=>{
  const bound=stageAgentIds().filter(id=>captures.get(id)&&captures.get(id).state!=='ended');
  if(!bound.length){toast('还没有绑定任何成员窗口。先在舞台上点击「绑定窗口」。',true);return;}
  openPop(e.currentTarget,`<div class="pop-title">截取哪位成员的画面？</div>${bound.map(id=>`<button class="menu-item" type="button" data-tile-act="snap" data-id="${esc(id)}">${avatar(id,'sm')}${esc(name(id))}</button>`).join('')}`,{above:true,align:'end'});
};
$('attachment-list').onclick=e=>{const b=e.target.closest('[data-remove]');if(b&&!operations.has(selected)){draft.attachments.splice(Number(b.dataset.remove),1);draft.requestKey=null;renderAttachments();}};

async function exportSession(format) {
  if(!format||!sessionReady())return;
  const view=snapshot();
  try {
    const r=await fetch('/api/export?session='+encodeURIComponent(view.session)+'&format='+format,{signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw Error('导出失败');
    const blob=await r.blob();if(!isCurrent(view))return;
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='agents-talk-'+view.session+'.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  } catch(e){if(isCurrent(view))toast(e.message,true);}
}
$('export-format').onchange=async()=>{const format=$('export-format').value;await exportSession(format);$('export-format').value='';};
