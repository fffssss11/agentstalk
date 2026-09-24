'use strict';
// VS Code–style themes: built-ins, "follow system", and editable custom themes (per browser).
const THEME_VARS = {bg:'--bg',sidebar:'--sidebar',sidebarText:'--sidebar-text',sidebarText2:'--sidebar-text-2',surface:'--surface',surface2:'--surface-2',
  surface3:'--surface-3',line:'--line',line2:'--line-2',text:'--text',text2:'--text-2',text3:'--text-3',accent:'--accent',onAccent:'--on-accent',
  ok:'--ok',warn:'--warn',danger:'--danger',info:'--info',stage:'--stage',stageHi:'--stage-hi',tile:'--tile'};
const BUILTIN_THEMES = [
  {id:'mint',name:'淡绿',type:'light',note:'默认',colors:{bg:'#f2f6f2',sidebar:'#e9f1ea',sidebarText:'#1d2a23',sidebarText2:'#5a6b61',surface:'#ffffff',surface2:'#f6f9f6',surface3:'#ecf2ed',line:'#dde6de',line2:'#c9d5cc',text:'#14201a',text2:'#4a5a51',text3:'#607166',accent:'#1f7a55',onAccent:'#ffffff',ok:'#1f8a5b',warn:'#a86d12',danger:'#c43b3b',info:'#3563c9',stage:'#111815',stageHi:'#19231e',tile:'#151d19'}},
  {id:'light',name:'浅色',type:'light',note:'仿 VS Code Light Modern',colors:{bg:'#f8f8f8',sidebar:'#f3f3f3',sidebarText:'#1f1f1f',sidebarText2:'#616161',surface:'#ffffff',surface2:'#f8f8f8',surface3:'#efefef',line:'#e5e5e5',line2:'#d0d0d0',text:'#1f1f1f',text2:'#4d4d4d',text3:'#6a6a6a',accent:'#005fb8',onAccent:'#ffffff',ok:'#2e7d32',warn:'#9a6700',danger:'#c72e2e',info:'#005fb8',stage:'#1e1e1e',stageHi:'#282828',tile:'#1b1b1b'}},
  {id:'dark',name:'深色',type:'dark',note:'仿 VS Code Dark Modern',colors:{bg:'#1f1f1f',sidebar:'#181818',sidebarText:'#cccccc',sidebarText2:'#9d9d9d',surface:'#181818',surface2:'#1f1f1f',surface3:'#2a2d2e',line:'#2b2b2b',line2:'#3c3c3c',text:'#cccccc',text2:'#a8a8a8',text3:'#8f8f8f',accent:'#0078d4',onAccent:'#ffffff',ok:'#3fb950',warn:'#d29922',danger:'#f85149',info:'#4daafc',stage:'#111111',stageHi:'#1a1a1a',tile:'#151515'}},
  {id:'forest',name:'墨绿',type:'dark',note:'深色 · 品牌绿',colors:{bg:'#0f1613',sidebar:'#0b110e',sidebarText:'#d7e3dc',sidebarText2:'#8fa198',surface:'#121a16',surface2:'#16201b',surface3:'#1d2924',line:'#22302a',line2:'#2e3f37',text:'#e3ece7',text2:'#a9b8b0',text3:'#8a9a92',accent:'#3fbf8f',onAccent:'#06140e',ok:'#3fbf7f',warn:'#e0a53a',danger:'#ef6461',info:'#7ea2ff',stage:'#070b09',stageHi:'#0f1613',tile:'#0c120f'}},
  {id:'solarized',name:'暖光',type:'light',note:'仿 Solarized Light',colors:{bg:'#fdf6e3',sidebar:'#eee8d5',sidebarText:'#073642',sidebarText2:'#586e75',surface:'#fffcf4',surface2:'#faf4e2',surface3:'#f1ead3',line:'#e6dfc8',line2:'#d8cfb2',text:'#073642',text2:'#4b6068',text3:'#5d7178',accent:'#1f6fa8',onAccent:'#ffffff',ok:'#5f7a00',warn:'#9c6500',danger:'#c62b28',info:'#1f6fa8',stage:'#06262f',stageHi:'#0b313b',tile:'#082b34'}},
  {id:'contrast',name:'高对比度',type:'dark',note:'仿 VS Code High Contrast',colors:{bg:'#000000',sidebar:'#000000',sidebarText:'#ffffff',sidebarText2:'#d6d6d6',surface:'#000000',surface2:'#0b0b0b',surface3:'#1a1a1a',line:'#6fc3df',line2:'#6fc3df',text:'#ffffff',text2:'#e6e6e6',text3:'#cfcfcf',accent:'#f38518',onAccent:'#000000',ok:'#89d185',warn:'#ffd33d',danger:'#ff7b72',info:'#6fc3df',stage:'#000000',stageHi:'#050505',tile:'#000000'}},
];
// Editable colours; everything else is derived so a custom theme stays coherent.
const EDITABLE = [['accent','主色'],['bg','背景'],['sidebar','侧栏'],['surface','面板'],['text','正文'],['text2','次要文字'],['line','分割线'],['stage','画面舞台']];
const THEME_KEY='agents-talk.theme', HEX=/^#[0-9a-f]{6}$/i;
let themePrefs=loadThemePrefs(), editingTheme=null;

function loadThemePrefs() {
  const saved=readJSON(THEME_KEY,{});
  const custom=Array.isArray(saved.custom)?saved.custom.filter(validCustomTheme):[];
  return {selected:typeof saved.selected==='string'?saved.selected:'mint',follow:saved.follow==='system'?'system':'manual',
    light:typeof saved.light==='string'?saved.light:'mint',dark:typeof saved.dark==='string'?saved.dark:'forest',
    scale:[13,14,15,16].includes(saved.scale)?saved.scale:14,custom};
}
function saveThemePrefs() {writeJSON(THEME_KEY,themePrefs);}
function validCustomTheme(t) {
  return t&&typeof t==='object'&&typeof t.id==='string'&&/^custom-[a-z0-9]{4,16}$/.test(t.id)&&typeof t.name==='string'&&t.name.trim()&&t.name.length<=40
    &&['light','dark'].includes(t.type)&&t.colors&&Object.keys(THEME_VARS).every(k=>HEX.test(t.colors[k]||''));
}
function allThemes() {return [...BUILTIN_THEMES,...themePrefs.custom];}
function findTheme(id) {return allThemes().find(t=>t.id===id);}
const systemDark=matchMedia('(prefers-color-scheme: dark)');
function activeThemeId() {
  const id=themePrefs.follow==='system'?(systemDark.matches?themePrefs.dark:themePrefs.light):themePrefs.selected;
  return findTheme(id)?id:'mint';
}
function applyTheme() {
  const theme=findTheme(activeThemeId()), root=document.documentElement;
  root.dataset.theme=theme.id.startsWith('custom-')?'custom':theme.id;root.dataset.themeType=theme.type;
  for(const [key,variable] of Object.entries(THEME_VARS))root.style.setProperty(variable,theme.colors[key]);
  root.style.setProperty('--fs',themePrefs.scale+'px');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme.colors.surface);
}
systemDark.addEventListener('change',()=>{if(themePrefs.follow==='system'){applyTheme();renderThemeSettings();}});

// Colour maths for derived tokens and contrast warnings.
function hexToRgb(hex) {const n=parseInt(hex.slice(1),16);return [n>>16&255,n>>8&255,n&255];}
function rgbToHex(rgb) {return '#'+rgb.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');}
function mixHex(a,b,t) {const x=hexToRgb(a),y=hexToRgb(b);return rgbToHex(x.map((v,i)=>v+(y[i]-v)*t));}
function luminance(hex) {return hexToRgb(hex).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);}
function contrast(a,b) {const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);}
function deriveColors(theme) {
  const c={...theme.colors};
  c.surface2=mixHex(c.surface,c.text,.03);c.surface3=mixHex(c.surface,c.text,.075);
  c.line2=mixHex(c.line,c.text,.12);c.text3=mixHex(c.text2,c.surface,.16);
  c.sidebarText=contrast(c.text,c.sidebar)>=4.5?c.text:(luminance(c.sidebar)>.4?'#1a1a1a':'#f2f2f2');
  c.sidebarText2=mixHex(c.sidebarText,c.sidebar,.34);
  c.onAccent=contrast('#ffffff',c.accent)>=contrast('#000000',c.accent)?'#ffffff':'#000000';
  c.stageHi=mixHex(c.stage,'#ffffff',.05);c.tile=mixHex(c.stage,'#ffffff',.025);
  return c;
}
function themeWarnings(c) {
  const out=[];
  if(contrast(c.text,c.surface)<4.5)out.push('正文与面板对比度不足 4.5:1');
  if(contrast(c.text,c.bg)<4.5)out.push('正文与背景对比度不足 4.5:1');
  if(contrast(c.onAccent,c.accent)<4.5)out.push('主色按钮文字对比度不足 4.5:1');
  if(contrast(c.text3,c.surface)<4.5)out.push('辅助文字对比度偏低');
  return out;
}

function selectTheme(id) {
  if(!findTheme(id))return;
  if(themePrefs.follow==='system'){if(findTheme(id).type==='dark')themePrefs.dark=id;else themePrefs.light=id;}
  else themePrefs.selected=id;
  saveThemePrefs();applyTheme();renderThemeSettings();
}
function themePreview(t) {
  const c=t.colors;
  return `<span class="theme-preview" aria-hidden="true" style="background:${c.bg}"><span class="p-side" style="background:${c.sidebar}"><i style="background:${c.sidebarText}"></i><i style="background:${c.sidebarText2};width:70%"></i><i style="background:${c.accent};width:55%;opacity:.9"></i></span><span class="p-main"><span class="p-bar" style="background:${c.text};width:60%"></span><span class="p-stage" style="background:${c.stage}"><span class="p-accent" style="background:${c.accent}"></span></span></span></span>`;
}
function renderThemeSettings() {
  const list=$('theme-list');if(!list)return;
  const current=activeThemeId();
  for(const b of $$('#theme-follow button'))b.setAttribute('aria-pressed',String(b.dataset.follow===themePrefs.follow));
  $('theme-system-prefs').hidden=themePrefs.follow!=='system';
  const options=type=>allThemes().filter(t=>t.type===type).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  $('theme-light-pref').innerHTML=options('light');$('theme-light-pref').value=themePrefs.light;
  $('theme-dark-pref').innerHTML=options('dark');$('theme-dark-pref').value=themePrefs.dark;
  list.innerHTML=allThemes().map(t=>`<button class="theme-card" type="button" role="radio" aria-checked="${t.id===current}" data-theme-id="${esc(t.id)}">${themePreview(t)}<span class="theme-name">${esc(t.name)}<small>${esc(t.note||(t.type==='dark'?'自定义 · 深色':'自定义 · 浅色'))}</small></span></button>`).join('');
  for(const b of $$('#ui-scale button'))b.setAttribute('aria-pressed',String(Number(b.dataset.scale)===themePrefs.scale));
  const custom=current.startsWith('custom-')?findTheme(current):null;
  if(!custom)editingTheme=null;
  renderThemeEditor(custom);
}
function renderThemeEditor(theme) {
  const box=$('theme-editor');
  if(!theme){box.hidden=true;box.innerHTML='';return;}
  const warnings=themeWarnings(theme.colors);
  box.hidden=false;
  box.innerHTML=`<h4>编辑自定义主题</h4>
    <div class="field-row"><label for="theme-edit-name">名称</label><input id="theme-edit-name" type="text" maxlength="40" value="${esc(theme.name)}"></div>
    <div class="field-row"><span>类型</span><div class="seg-mini" id="theme-edit-type"><button type="button" data-type="light" aria-pressed="${theme.type==='light'}">浅色</button><button type="button" data-type="dark" aria-pressed="${theme.type==='dark'}">深色</button></div></div>
    <div class="color-grid">${EDITABLE.map(([key,label])=>`<label class="color-field"><input type="color" value="${theme.colors[key]}" data-color-key="${key}" aria-label="${label}"><span>${label}</span><input type="text" value="${theme.colors[key]}" data-color-text="${key}" aria-label="${label}色值" spellcheck="false"></label>`).join('')}</div>
    <p class="contrast-note ${warnings.length?'bad':''}">${warnings.length?esc(warnings.join('；')):'对比度检查通过（正文 ≥ 4.5:1）'}</p>
    <div class="editor-actions"><button class="btn btn-line sm" type="button" id="theme-export">${icon('download','sm')}导出 JSON</button><button class="btn btn-danger-line sm" type="button" id="theme-delete">${icon('trash','sm')}删除此主题</button></div>`;
}
function updateCustomColor(key,value) {
  const theme=findTheme(activeThemeId());
  if(!theme||!theme.id.startsWith('custom-')||!HEX.test(value))return;
  theme.colors[key]=value.toLowerCase();theme.colors=deriveColors(theme);
  saveThemePrefs();applyTheme();
  // Keep the editor inputs stable while dragging a colour; only refresh previews and warnings.
  for(const card of $$('#theme-list [data-theme-id]'))if(card.dataset.themeId===theme.id)card.querySelector('.theme-preview').outerHTML=themePreview(theme);
  const warnings=themeWarnings(theme.colors),note=document.querySelector('#theme-editor .contrast-note');
  if(note){note.classList.toggle('bad',warnings.length>0);note.textContent=warnings.length?warnings.join('；'):'对比度检查通过（正文 ≥ 4.5:1）';}
  const text=document.querySelector(`[data-color-text="${key}"]`),picker=document.querySelector(`[data-color-key="${key}"]`);
  if(text&&document.activeElement!==text)text.value=value;if(picker&&document.activeElement!==picker)picker.value=value;
}
function createCustomTheme(fromId=activeThemeId(), imported=null) {
  const base=imported||findTheme(fromId);
  const id='custom-'+crypto.randomUUID().replace(/-/g,'').slice(0,10);
  const theme={id,name:imported?imported.name:(base.name+' · 自定义').slice(0,40),type:base.type,colors:{...base.colors}};
  if(!imported)theme.colors=deriveColors(theme);
  themePrefs.custom.push(theme);
  themePrefs.follow='manual';themePrefs.selected=id;saveThemePrefs();applyTheme();renderThemeSettings();
  return theme;
}
function exportTheme() {
  const theme=findTheme(activeThemeId());if(!theme)return;
  const blob=new Blob([JSON.stringify({app:'agents-talk-theme',version:1,name:theme.name,type:theme.type,colors:theme.colors},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`agents-talk-theme-${theme.name.replace(/[^\w一-龥-]+/g,'_')}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function importTheme(file) {
  try {
    if(file.size>50000)throw Error('文件过大');
    const data=JSON.parse(await file.text());
    const candidate={id:'custom-import',name:String(data.name||'').trim().slice(0,40),type:data.type,colors:data.colors||{}};
    // Accept partial colour sets by filling from the closest built-in of the same type.
    const base=BUILTIN_THEMES.find(t=>t.type===candidate.type)||BUILTIN_THEMES[0];
    candidate.colors=Object.fromEntries(Object.keys(THEME_VARS).map(k=>[k,HEX.test(candidate.colors[k]||'')?candidate.colors[k].toLowerCase():base.colors[k]]));
    if(!candidate.name||!['light','dark'].includes(candidate.type))throw Error('缺少名称或类型（light / dark）');
    createCustomTheme(null,candidate);
    toast('已导入主题：'+candidate.name);
  } catch(e) {toast('主题导入失败：'+e.message,true);}
}
function deleteCustomTheme(id) {
  themePrefs.custom=themePrefs.custom.filter(t=>t.id!==id);
  for(const key of ['selected','light','dark'])if(themePrefs[key]===id)themePrefs[key]=key==='dark'?'forest':'mint';
  saveThemePrefs();applyTheme();renderThemeSettings();
}
function themeMenu(anchor) {
  const current=activeThemeId();
  openPop(anchor,`<div class="pop-title">主题${themePrefs.follow==='system'?' · 跟随系统':''}</div>${allThemes().map(t=>`<button class="menu-item" type="button" role="menuitemradio" aria-checked="${t.id===current}" data-pick-theme="${esc(t.id)}"><span class="theme-dot" style="display:inline-block;width:16px;height:16px;border-radius:5px;background:${t.colors.bg};box-shadow:inset 0 0 0 4px ${t.colors.accent}"></span><span>${esc(t.name)}<small>${esc(t.note||'自定义')}</small></span>${t.id===current?icon('check','sm check-i end'):''}</button>`).join('')}<div class="menu-sep"></div><button class="menu-item" type="button" data-open-settings="appearance">${icon('palette')}主题设置与自定义…</button>`,{align:'end'});
}

// Wiring for the appearance pane (the drawer itself lives in settings.js).
document.addEventListener('click',e=>{
  const card=e.target.closest('[data-theme-id]');if(card){selectTheme(card.dataset.themeId);return;}
  const pick=e.target.closest('[data-pick-theme]');if(pick){closePop();selectTheme(pick.dataset.pickTheme);return;}
  const follow=e.target.closest('#theme-follow [data-follow]');
  if(follow){themePrefs.follow=follow.dataset.follow;if(themePrefs.follow==='manual')themePrefs.selected=activeThemeId();saveThemePrefs();applyTheme();renderThemeSettings();return;}
  const scale=e.target.closest('#ui-scale [data-scale]');if(scale){themePrefs.scale=Number(scale.dataset.scale);saveThemePrefs();applyTheme();renderThemeSettings();return;}
  const type=e.target.closest('#theme-edit-type [data-type]');
  if(type){const theme=findTheme(activeThemeId());if(theme?.id.startsWith('custom-')){theme.type=type.dataset.type;saveThemePrefs();applyTheme();renderThemeSettings();}return;}
  if(e.target.closest('#theme-new')){createCustomTheme();toast('已基于当前主题新建自定义主题，可在下方调整颜色');return;}
  if(e.target.closest('#theme-import')){$('theme-import-file').click();return;}
  if(e.target.closest('#theme-export')){exportTheme();return;}
  if(e.target.closest('#theme-delete')){const theme=findTheme(activeThemeId());if(theme?.id.startsWith('custom-'))confirmAction('删除自定义主题？',`「${theme.name}」会从本浏览器移除，可先导出备份。`,'删除').then(ok=>{if(ok)deleteCustomTheme(theme.id);});}
});
document.addEventListener('input',e=>{
  if(e.target.dataset.colorKey)updateCustomColor(e.target.dataset.colorKey,e.target.value);
  else if(e.target.dataset.colorText&&HEX.test(e.target.value.trim()))updateCustomColor(e.target.dataset.colorText,e.target.value.trim());
  else if(e.target.id==='theme-edit-name'){const theme=findTheme(activeThemeId());if(theme?.id.startsWith('custom-')&&e.target.value.trim()){theme.name=e.target.value.trim().slice(0,40);saveThemePrefs();for(const n of $$('#theme-list [aria-checked="true"] .theme-name'))n.firstChild.textContent=theme.name;}}
});
document.addEventListener('change',e=>{
  if(e.target.id==='theme-light-pref'){themePrefs.light=e.target.value;saveThemePrefs();applyTheme();renderThemeSettings();}
  if(e.target.id==='theme-dark-pref'){themePrefs.dark=e.target.value;saveThemePrefs();applyTheme();renderThemeSettings();}
  if(e.target.id==='theme-import-file'){const file=e.target.files[0];e.target.value='';if(file)importTheme(file);}
});
applyTheme();
