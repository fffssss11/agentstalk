'use strict';
// Shared helpers. Classic scripts share one global scope; later files build on these names.
const $ = id => document.getElementById(id);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name, cls='') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const MARKS = {claude:'✳', codex:'⌘', reasonix:'R', zcode:'Z', pi:'π', human:'你'};
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function storageUnavailable() {
  const notice=$('draft-storage-notice');
  if(notice)notice.hidden=false;
}
// Browser storage is a per-viewer convenience; every access tolerates denial or quota errors.
function readStorage(key) {
  try {return localStorage.getItem(key);} catch {storageUnavailable();return null;}
}
function writeStorage(key,value) {
  try {localStorage.setItem(key,value);} catch {storageUnavailable();}
}
function readJSON(key,fallback) {
  const raw=readStorage(key);
  if(raw===null)return fallback;
  try {const value=JSON.parse(raw);return value??fallback;} catch {return fallback;}
}
function writeJSON(key,value) {writeStorage(key,JSON.stringify(value));}

async function api(path, data, options={}) {
  const response = await fetch(path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json','X-Agents-Token':options.csrf??state?.csrf??''},body:data===undefined?undefined:JSON.stringify(data),signal:options.signal||AbortSignal.timeout(12000)});
  const result = await response.json();
  if(!response.ok) throw Error(result.error || `请求失败 (${response.status})`);
  return result;
}

function toast(msg, error=false) {
  const el=document.createElement('div');el.className='toast'+(error?' error':'');el.setAttribute('role',error?'alert':'status');
  el.innerHTML=icon(error?'alert':'check','sm')+`<span>${esc(msg)}</span>`;
  $('toast-region').append(el);
  while($('toast-region').children.length>3)$('toast-region').firstElementChild.remove();
  setTimeout(()=>el.remove(),error?6000:4000);
}
function errorAt(id,msg='') {$(id).textContent=msg;$(id).hidden=!msg;}

function parseTime(ts) {const t=Date.parse(ts);return Number.isNaN(t)?null:t;}
function clockTime(ts) {const t=parseTime(ts);return t===null?'':new Date(t).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});}
function stamp(ts) {const t=parseTime(ts);return t===null?'时间未记录':new Date(t).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});}
function relTime(ts, now=Date.now()) {
  const t=typeof ts==='number'?ts:parseTime(ts);if(t===null)return '';
  const s=Math.max(0,(now-t)/1000);
  if(s<10)return '刚刚';if(s<60)return Math.round(s)+' 秒前';if(s<3600)return Math.floor(s/60)+' 分钟前';
  if(s<86400)return Math.floor(s/3600)+' 小时前';return Math.floor(s/86400)+' 天前';
}
// Sidebar time buckets, like chat products: today, yesterday, this week, this month, older.
function dayBucket(ts, now=new Date()) {
  const t=parseTime(ts);if(t===null)return '更早';
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(), day=86400000;
  if(t>=start)return '今天';if(t>=start-day)return '昨天';if(t>=start-6*day)return '7 天内';if(t>=start-29*day)return '30 天内';return '更早';
}
const fmt = n => n==null ? '未报告' : Number(n).toLocaleString('zh-CN');
const compactNumber = n => n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e4?(n/1e3).toFixed(1)+'k':Number(n).toLocaleString('zh-CN');

async function copyText(text) {
  try {await navigator.clipboard.writeText(text);return true;}
  catch {
    const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();
    let ok=false;try {ok=document.execCommand('copy');} catch {}
    area.remove();return ok;
  }
}

// One popover at a time, positioned against its trigger; Escape returns focus to the trigger.
let popOwner=null;
function openPop(anchor, html, {above=false, align='start', onOpen}={}) {
  const pop=$('pop');
  if(popOwner===anchor&&!pop.hidden){closePop();return false;}
  closePop();
  pop.innerHTML=html;pop.hidden=false;popOwner=anchor;anchor.setAttribute('aria-expanded','true');
  const r=anchor.getBoundingClientRect(), pw=pop.offsetWidth, ph=pop.offsetHeight;
  let left=align==='end'?r.right-pw:align==='center'?r.left+r.width/2-pw/2:r.left;
  left=Math.max(8,Math.min(left,innerWidth-pw-8));
  let top=above?r.top-ph-8:r.bottom+6;
  if(above&&top<8)top=r.bottom+6;
  if(!above&&top+ph>innerHeight-8)top=Math.max(8,r.top-ph-8);
  pop.style.left=left+'px';pop.style.top=Math.max(8,top)+'px';
  onOpen?.(pop);
  return true;
}
function closePop({restoreFocus=false}={}) {
  const pop=$('pop');if(pop.hidden)return;
  pop.hidden=true;pop.innerHTML='';
  const owner=popOwner;popOwner=null;
  if(owner){owner.setAttribute('aria-expanded','false');if(restoreFocus&&owner.isConnected)owner.focus();}
}
document.addEventListener('pointerdown',e=>{
  const pop=$('pop');
  if(!pop.hidden&&!pop.contains(e.target)&&!(popOwner&&popOwner.contains(e.target)))closePop();
});
document.addEventListener('keydown',e=>{
  const pop=$('pop');if(pop.hidden)return;
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePop({restoreFocus:true});return;}
  if(!['ArrowDown','ArrowUp'].includes(e.key))return;
  const items=$$('button:not(:disabled),[href],input,select',pop).filter(el=>el.getClientRects().length);
  if(!items.length)return;
  e.preventDefault();
  const index=items.indexOf(document.activeElement), down=e.key==='ArrowDown';
  const next=index<0?(down?0:items.length-1):(index+(down?1:items.length-1))%items.length;
  items[next].focus();
},true);
addEventListener('resize',()=>closePop());

function confirmAction(title, text, okLabel='确认', danger=true) {
  const dialog=$('confirm-dialog');
  $('confirm-title').textContent=title;$('confirm-text').textContent=text;
  $('confirm-ok').textContent=okLabel;$('confirm-ok').className='btn '+(danger?'btn-danger':'btn-primary');
  dialog.showModal();
  return new Promise(resolve=>{
    const done=value=>{dialog.removeEventListener('close',onClose);$('confirm-ok').onclick=null;resolve(value);};
    const onClose=()=>done(false);
    dialog.addEventListener('close',onClose);
    $('confirm-ok').onclick=()=>{dialog.removeEventListener('close',onClose);dialog.close();done(true);};
  });
}
