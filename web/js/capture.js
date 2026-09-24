'use strict';
// Live agent windows through the browser's own window sharing (getDisplayMedia).
// Frames stay inside this page: nothing is recorded, persisted, uploaded or sent to agents,
// except a snapshot the person explicitly previews and confirms.
// Remote control is intentionally absent. A future native helper may add it behind explicit,
// per-session consent; this module only views windows.
const CAPTURE_KEY='agents-talk.capture', LABELS_KEY='agents-talk.capture-labels';
const capturePrefs={quality:5,staticSeconds:180,follow:true,captions:true,leaveWarn:true,...readJSON(CAPTURE_KEY,{})};
const captures=new Map(), captureLabels=readJSON(LABELS_KEY,{});
let connectingCapture=null, pipWindow=null;
const sampleCanvas=document.createElement('canvas');sampleCanvas.width=32;sampleCanvas.height=18;
const sampleContext=sampleCanvas.getContext('2d',{willReadFrequently:true});

function saveCapturePrefs() {writeJSON(CAPTURE_KEY,capturePrefs);}
function captureSupported() {return !!navigator.mediaDevices?.getDisplayMedia;}
// unbound → connecting → live ⇄ static / hidden → ended; "stale" means bound before a reload.
function captureState(id) {
  if(connectingCapture===id)return 'connecting';
  const b=captures.get(id);if(b)return b.state;
  return captureLabels[id]?'stale':'unbound';
}
const CAPTURE_TEXT={live:'实时',static:'静止',hidden:'不可见',ended:'已停止',connecting:'连接中…',unbound:'未绑定',stale:'待重新绑定'};
function liveCaptureCount() {return [...captures.values()].filter(b=>b.state!=='ended').length;}

async function bindWindow(id) {
  closePop();
  if(!captureSupported()){toast('当前浏览器不支持窗口共享。请使用新版 Edge 或 Chrome 打开面板。',true);return;}
  if(connectingCapture)return;
  connectingCapture=id;renderStage();
  let controller=null;try {controller=new CaptureController();} catch {}
  try {
    const stream=await navigator.mediaDevices.getDisplayMedia({
      video:{displaySurface:'window',frameRate:{ideal:capturePrefs.quality,max:Math.max(capturePrefs.quality,5)},width:{max:1920},height:{max:1080}},
      audio:false,selfBrowserSurface:'exclude',monitorTypeSurfaces:'exclude',surfaceSwitching:'include',...(controller?{controller}:{})});
    const track=stream.getVideoTracks()[0], settings=track.getSettings();
    // Keep focus on the panel instead of raising the shared window (Chromium only).
    try {if(controller&&settings.displaySurface==='window')controller.setFocusBehavior('no-focus-change');} catch {}
    stopCapture(id,{silent:true,keepLabel:true});
    const video=document.createElement('video');
    video.muted=true;video.autoplay=true;video.playsInline=true;video.srcObject=stream;video.setAttribute('aria-hidden','true');video.dataset.capture=id;
    const binding={id,stream,track,video,label:track.label||'未命名窗口',surface:settings.displaySurface||'window',width:settings.width,height:settings.height,
      state:'live',boundAt:Date.now(),lastChange:Date.now(),prev:null,snap:null,snapAt:0,sampler:null};
    captures.set(id,binding);
    captureLabels[id]={label:binding.label,at:Date.now()};writeJSON(LABELS_KEY,captureLabels);
    track.addEventListener('ended',()=>{if(captures.get(id)!==binding)return;binding.state='ended';clearInterval(binding.sampler);renderStage();renderPip();toast(`${name(id)} 的画面已停止`,true);});
    track.addEventListener('mute',()=>{if(captures.get(id)!==binding)return;binding.state='hidden';renderStage();});
    track.addEventListener('unmute',()=>{if(captures.get(id)!==binding)return;binding.state='live';binding.lastChange=Date.now();renderStage();});
    binding.sampler=setInterval(()=>sampleCapture(binding),2000);
    video.play().catch(()=>{});
    const kind={window:'窗口',monitor:'整个屏幕',browser:'浏览器标签页'}[binding.surface]||'画面';
    toast(`${name(id)} 已绑定${kind}：${binding.label}${binding.width?`（${binding.width}×${binding.height}）`:''}`);
    if(binding.surface==='monitor')toast('你选择的是整个屏幕，画面可能包含其他窗口；建议改选窗口。',true);
  } catch(e) {
    if(e?.name==='NotAllowedError')toast('已取消绑定');
    else toast('绑定失败：'+(e?.message||e),true);
  } finally {
    connectingCapture=null;renderStage();renderPip();updateCaptureVisibility();
  }
}
function stopCapture(id,{silent=false,keepLabel=false}={}) {
  const b=captures.get(id);if(!b)return;
  clearInterval(b.sampler);b.track.stop();b.video.srcObject=null;b.video.remove();captures.delete(id);
  if(!keepLabel){delete captureLabels[id];writeJSON(LABELS_KEY,captureLabels);}
  if(!silent){renderStage();renderPip();toast(`已停止 ${name(id)} 的画面`);}
}
function stopAllCaptures() {
  const count=captures.size;for(const id of [...captures.keys()])stopCapture(id,{silent:true});
  for(const id of Object.keys(captureLabels))delete captureLabels[id];writeJSON(LABELS_KEY,captureLabels);
  renderStage();renderPip();if(count)toast('已停止全部画面');
}
// "Static" compares tiny greyscale frames instead of counting frames: backends differ on
// whether unchanged windows emit frames at all.
function sampleCapture(b) {
  if(captures.get(b.id)!==b||b.state==='ended')return;
  // A window that never produced a picture is not "live" either.
  if(!b.video.videoWidth){if(b.state==='live'&&Date.now()-b.lastChange>capturePrefs.staticSeconds*1000){b.state='static';renderStage();}return;}
  try {sampleContext.drawImage(b.video,0,0,32,18);} catch {return;}
  const data=sampleContext.getImageData(0,0,32,18).data, grey=new Uint8Array(576);let diff=0;
  for(let i=0;i<576;i++){grey[i]=(data[i*4]*.3+data[i*4+1]*.59+data[i*4+2]*.11)|0;if(b.prev)diff+=Math.abs(grey[i]-b.prev[i]);}
  b.prev=grey;
  const before=b.state;
  if(diff>40){b.lastChange=Date.now();if(b.state==='static')b.state='live';}
  else if(b.state==='live'&&Date.now()-b.lastChange>capturePrefs.staticSeconds*1000)b.state='static';
  if(before!==b.state)renderStage();
  // Last frame, kept in memory only, shown when the window closes.
  if(Date.now()-b.snapAt>3000){
    b.snapAt=Date.now();
    try {const c=document.createElement('canvas'),w=Math.min(640,b.video.videoWidth);c.width=w;c.height=Math.round(w*b.video.videoHeight/b.video.videoWidth);c.getContext('2d').drawImage(b.video,0,0,c.width,c.height);b.snap=c.toDataURL('image/jpeg',.7);} catch {}
  }
}
function setCaptureQuality(fps) {
  capturePrefs.quality=fps;saveCapturePrefs();
  for(const b of captures.values())b.track.applyConstraints({frameRate:{max:fps}}).catch(()=>{});
}
// Save work when nobody is looking at the stage.
function updateCaptureVisibility() {
  const visible=!document.hidden&&uiView==='live';
  for(const b of captures.values())if(b.state!=='ended')b.track.applyConstraints({frameRate:{max:visible?capturePrefs.quality:1}}).catch(()=>{});
}
document.addEventListener('visibilitychange',updateCaptureVisibility);
addEventListener('beforeunload',e=>{if(capturePrefs.leaveWarn&&liveCaptureCount()){e.preventDefault();e.returnValue='';}});

let snapshotFile=null;
function snapshotCapture(id) {
  closePop();
  const b=captures.get(id);
  if(!b||b.state==='ended'||!b.video.videoWidth){toast('先为该成员绑定窗口，才能截取画面。',true);return;}
  if(!sessionReady()||operations.has(selected)||state.session.status==='ended'){toast('当前无法添加附件。',true);return;}
  const c=document.createElement('canvas');c.width=b.video.videoWidth;c.height=b.video.videoHeight;c.getContext('2d').drawImage(b.video,0,0);
  $('snapshot-image').src=c.toDataURL('image/png');
  $('snapshot-meta').textContent=`来自 ${name(id)} 的画面 · ${c.width}×${c.height} · 确认前不会上传。`;
  errorAt('snapshot-error');snapshotFile=null;
  c.toBlob(blob=>{if(blob)snapshotFile=new File([blob],`${clientId(id)||'agent'}-画面-${new Date().toTimeString().slice(0,8).replace(/:/g,'')}.png`,{type:'image/png'});},'image/png');
  $('snapshot-dialog').showModal();
}
$('snapshot-confirm').onclick=async()=>{
  if(!snapshotFile){errorAt('snapshot-error','截图仍在生成，请稍候再试。');return;}
  const file=snapshotFile;snapshotFile=null;$('snapshot-dialog').close();
  focusComposer({});await uploadFiles([file]);
};
$('snapshot-dialog').addEventListener('close',()=>{$('snapshot-image').removeAttribute('src');});

// Floating monitor: Document Picture-in-Picture keeps compact tiles on top of other windows.
async function openPip() {
  if(pipWindow&&!pipWindow.closed){pipWindow.focus();return;}
  if(!('documentPictureInPicture' in window)){toast('当前浏览器不支持悬浮窗（需要 Chrome 或 Edge 116 以上）。',true);return;}
  try {
    pipWindow=await documentPictureInPicture.requestWindow({width:560,height:380});
    const doc=pipWindow.document;
    doc.documentElement.dataset.theme=document.documentElement.dataset.theme;doc.documentElement.dataset.themeType='dark';
    doc.documentElement.style.cssText=document.documentElement.style.cssText;
    const link=doc.createElement('link');link.rel='stylesheet';link.href='/app.css';doc.head.append(link);
    doc.head.append(document.querySelector('.sprite').cloneNode(true));
    doc.title='Agents Talk · 成员画面';
    doc.body.innerHTML='<div class="pip-grid" id="pip-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;padding:8px;min-height:100vh;box-sizing:border-box;background:var(--stage)"></div>';
    doc.body.style.margin='0';
    pipWindow.addEventListener('pagehide',()=>{pipWindow=null;});
    renderPip();
  } catch(e) {toast('无法打开悬浮窗：'+(e?.message||e),true);}
}
let pipKey='';
function renderPip() {
  if(!pipWindow||pipWindow.closed||!state)return;
  const grid=pipWindow.document.getElementById('pip-grid');if(!grid)return;
  const ids=stageAgentIds();
  // Rebuild only on visible changes; recreating <video> elements would flicker.
  const key=JSON.stringify(ids.map(id=>[id,captureState(id),agentActivity(id).active,workSummary(id),name(id)]));
  if(key===pipKey&&grid.childElementCount)return;
  pipKey=key;
  grid.innerHTML=ids.map(id=>`<div class="tile" data-client="${esc(clientId(id))}" data-active="${agentActivity(id).active}" style="width:100%"><div class="screen" data-pip="${esc(id)}">${captures.has(id)&&captures.get(id).state!=='ended'?'':`<div class="unbound">${avatar(id,'md')}<b>${esc(name(id))}</b><span class="meta">${esc(workSummary(id))}</span></div>`}</div><div class="ov-top"><span class="id-chip">${avatar(id)}<b>${esc(name(id))}</b></span>${captureChip(id)}</div></div>`).join('');
  for(const id of ids){
    const b=captures.get(id);if(!b||b.state==='ended')continue;
    const v=pipWindow.document.createElement('video');v.muted=true;v.autoplay=true;v.playsInline=true;v.srcObject=b.stream;v.style.cssText='width:100%;height:100%;object-fit:contain';
    grid.querySelector(`[data-pip="${CSS.escape(id)}"]`)?.append(v);
  }
}
