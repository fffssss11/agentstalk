// Projects/sessions sidebar, themes, event display and live window capture on an isolated server.
// Window capture uses a canvas-backed fake getDisplayMedia; no real window is shared.
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {spawn,spawnSync}=require('child_process');
const {chromium,python,launchOptions,waitForServer,stopServer}=require('./support.cjs');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'agents-talk-workspace-'));
const env={...process.env,AGENTS_TALK_DATA:data,AGENTS_TALK_CONFIG:path.join(root,'config.example.json'),PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'};
const port=18772,base='http://127.0.0.1:'+port,shots=path.join(root,'.runtime');
let server,browser;
function run(args){const r=spawnSync(python,args,{cwd:root,env,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
function post(who,type,...args){return run(['hub.py','post','--from',who,'--session','main','--type',type,...args]);}
function start(){server=spawn(python,['hub.py','serve','--port',String(port),'--no-open'],{cwd:root,env,windowsHide:true,stdio:'pipe'});}
const stop=()=>stopServer(server), ready=()=>waitForServer(server,base);
async function state(sid){return (await fetch(base+'/api/state'+(sid?'?session='+sid:''))).json();}
const settle=page=>page.waitForFunction(()=>connected&&!libraryBusy);
// A fake window stream: a canvas that keeps repainting until told to freeze.
const fakeCapture=()=>{
  window.__fake={draw:true,tracks:[]};
  navigator.mediaDevices.getDisplayMedia=async()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;
    const g=canvas.getContext('2d');let n=0;
    setInterval(()=>{if(!window.__fake.draw)return;n++;g.fillStyle=`hsl(${(n*47)%360} 55% 42%)`;g.fillRect(0,0,640,400);g.fillStyle='#fff';g.font='28px sans-serif';g.fillText('frame '+n,24,48);},80);
    const stream=canvas.captureStream(15),track=stream.getVideoTracks()[0];
    Object.defineProperty(track,'label',{value:'Fake agent window'});
    const settings=track.getSettings.bind(track);track.getSettings=()=>({...settings(),displaySurface:'window',width:640,height:400});
    window.__fake.tracks.push(track);return stream;
  };
};
(async()=>{try{
  post('claude','join','--body','已接入。');post('codex','join','--body','已接入。');
  post('claude','task','--task','T-1','--to','codex','--reviewer','reasonix','--body','实现检索接口');
  post('codex','claim','--task','T-1','--body','开始实现');
  post('codex','blocked','--task','T-1','--blockers','缺少样本数据','--body','需要样本数据才能继续。');
  post('codex','lock','--files','workspace/app.py','--body','占用文件') ;
  start();await ready();browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(fakeCapture);
  await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#send-button').disabled);

  // Event display: protocol chatter is compact, every event is still shown.
  assert(await page.locator('#messages article.system[data-type="join"]').count()>=2);
  assert(await page.locator('#messages article[data-type="blocked"]').isVisible());
  assert((await page.locator('#messages article[data-type="blocked"] .msg-gist').textContent()).includes('缺少样本数据'));
  console.log('PASS events: compact protocol rows and structured gists');

  // Attention centre lists the blocked task and jumps to a reply to its owner.
  assert.equal(await page.locator('#attn-count').textContent(),'1');
  await page.locator('#attn-btn').click();
  assert((await page.locator('#pop').textContent()).includes('T-1 受阻'));
  await page.locator('#pop .attn-item').filter({hasText:'T-1 受阻'}).getByRole('button').click();
  assert.equal(await page.locator('#recipient-select').inputValue(),'codex');
  console.log('PASS attention: blocked task, direct reply action');

  // Projects: create, file a new session into it, rename, pin, move, archive, delete.
  await page.locator('#new-project').click();
  await page.locator('#project-name').fill('检索工具');
  await page.locator('#project-colors [data-color="teal"]').click();
  await page.locator('#project-defaults-box summary').click();
  await page.selectOption('#project-lead','codex');
  await page.locator('#project-save').click();await settle(page);
  const project=(await state()).library.projects[0];
  assert.equal(project.name,'检索工具');assert.equal(project.color,'teal');assert.equal(project.defaults.lead,'codex');
  await page.locator(`[data-project-menu="${project.id}"]`).click();
  await page.locator('#pop [data-project-new-session]').click();
  assert.equal(await page.locator('#new-session-project').inputValue(),project.id);
  assert.equal(await page.locator('#new-session-lead').inputValue(),'codex','project defaults prefill the dialog');
  await page.locator('#new-session-title').fill('项目内会话');await page.locator('#create-session-submit').click();
  await page.waitForFunction(()=>document.querySelector('#session-title').textContent==='项目内会话');
  let st=await state();assert.equal(st.session.lead,'codex');assert.equal(st.library.sessions[st.session.id].project,project.id);
  const sid=st.session.id;
  assert(await page.locator(`[data-project-row="${project.id}"] [data-session="${sid}"]`).isVisible());
  assert.equal(await page.locator('#crumb-project').textContent(),'检索工具');
  await page.locator('#session-title').dblclick();
  await page.locator('#rename-input').fill('项目内会话 · 改名');await page.locator('#rename-input').press('Enter');await settle(page);
  await page.waitForFunction(()=>document.querySelector('#session-title').textContent==='项目内会话 · 改名');
  assert.equal((await state(sid)).session.title,'项目内会话','renaming never rewrites the agent-visible title');
  await page.locator(`[data-session-menu="main"]`).click();await page.locator('#pop [data-lib="pin"]').click();await settle(page);
  await page.waitForFunction(()=>document.querySelector('[data-session="main"] .pin'));
  await page.locator(`[data-session-menu="main"]`).click();await page.locator('#pop [data-lib="move"]').click();
  await page.locator(`#pop [data-move-to="${project.id}"]`).click();await settle(page);
  await page.waitForFunction(pid=>document.querySelector(`[data-project-row="${pid}"] [data-session="main"]`),project.id);
  await page.locator(`[data-session-menu="main"]`).click();await page.locator('#pop [data-lib="archive"]').click();await settle(page);
  await page.waitForFunction(()=>!document.querySelector('#archived-toggle').hidden);
  assert.equal(await page.locator('[data-session="main"]').count(),0,'archived sessions leave the main lists');
  await page.locator('#archived-toggle').click();assert(await page.locator('#archived-list [data-session="main"]').isVisible());
  await page.locator('#session-search').fill('不存在的名字');
  await page.waitForFunction(()=>document.querySelector('#session-list').textContent.includes('没有匹配的会话'));
  await page.locator('#session-search').fill('');
  await page.locator(`[data-project="${project.id}"]`).first().click();
  await page.waitForFunction(()=>document.querySelector('#app').dataset.view==='project');
  assert((await page.locator('#project-page').textContent()).includes('项目内会话 · 改名'));
  await page.screenshot({path:path.join(shots,'project-desktop-qa.png')});
  await page.locator(`[data-project-menu="${project.id}"]`).click();await page.locator('#pop [data-project-delete]').click();
  await page.locator('#confirm-ok').click();await settle(page);
  await page.waitForFunction(()=>document.querySelector('#app').dataset.view==='live');
  st=await state();assert.equal(st.library.projects.length,0);
  assert.deepEqual(st.library.sessions[sid],{title:'项目内会话 · 改名'},'deleting a project keeps the panel label, drops the project link');
  assert(await page.locator(`#session-list [data-session="${sid}"]`).isVisible(),'sessions of a deleted project become standalone');
  await page.locator(`#archived-list [data-session-menu="main"]`).click();await page.locator('#pop [data-lib="archive"]').click();await settle(page);
  await page.locator('[data-session="main"]').click();await page.waitForFunction(()=>document.querySelector('#session-title').textContent==='协作工作室');
  console.log('PASS library: project defaults, filed sessions, panel-only rename, pin, move, archive, search, project page, delete');

  // Themes: quick switch, persistence, follow system, custom theme with derived colours and import.
  await page.locator('#theme-btn').click();await page.locator('#pop [data-pick-theme="dark"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
  await page.reload();await page.waitForFunction(()=>connected);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark','theme choice persists');
  await page.evaluate(()=>openSettings('appearance'));
  await page.locator('#theme-follow [data-follow="system"]').click();
  await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='mint');
  await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='forest');
  await page.locator('#theme-follow [data-follow="manual"]').click();
  await page.locator('#theme-new').click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'custom');
  assert(await page.locator('#theme-editor').isVisible());
  await page.locator('[data-color-text="accent"]').fill('#aa3366');
  await page.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#aa3366');
  await page.locator('#theme-import-file').setInputFiles({name:'theme.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({name:'导入的主题',type:'light',colors:{accent:'#225588',bg:'#fafafa'}}))});
  await page.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#225588');
  assert.equal(await page.locator('#theme-list .theme-card').count(),8);
  await page.locator('#ui-scale [data-scale="16"]').click();
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'16px');
  await page.locator('#ui-scale [data-scale="14"]').click();
  await page.locator('[data-theme-id="mint"]').click();await page.evaluate(()=>closeSettings({restoreFocus:false}));
  await page.emulateMedia({colorScheme:'light'});
  console.log('PASS themes: quick switch, persistence, follow system, custom colours, import, font size');

  // Live capture with a fake window stream.
  await page.locator('#stage-grid [data-tile="codex"] [data-tile-act="bind"]').click();
  await page.waitForFunction(()=>document.querySelector('#stage-grid [data-tile="codex"]').dataset.cap==='live');
  assert(await page.locator('#stage-grid [data-tile="codex"] video').isVisible());
  assert(await page.locator('#cap-indicator').isVisible());
  assert.equal(await page.locator('#capture-count').textContent(),'1/3');
  await page.waitForFunction(()=>captures.get('codex').video.readyState>=2,{},{timeout:10000});
  await page.evaluate(()=>{capturePrefs.staticSeconds=1;window.__fake.draw=false;});
  await page.waitForFunction(()=>document.querySelector('#stage-grid [data-tile="codex"]').dataset.cap==='static',{},{timeout:15000});
  await page.evaluate(()=>{window.__fake.draw=true;});
  await page.waitForFunction(()=>document.querySelector('#stage-grid [data-tile="codex"]').dataset.cap==='live',{},{timeout:15000});
  await page.evaluate(()=>window.__fake.tracks.at(-1).dispatchEvent(new Event('mute')));
  await page.waitForFunction(()=>document.querySelector('#stage-grid [data-tile="codex"]').dataset.cap==='hidden');
  await page.evaluate(()=>window.__fake.tracks.at(-1).dispatchEvent(new Event('unmute')));
  await page.waitForFunction(()=>document.querySelector('#stage-grid [data-tile="codex"]').dataset.cap==='live');
  // Layouts and shortcuts keep the live element playing.
  await page.keyboard.press('s');assert.equal(await page.locator('#stage').getAttribute('data-layout'),'speaker');
  await page.keyboard.press('Alt+2');assert.equal(await page.locator('#stage').getAttribute('data-layout'),'solo');
  assert(await page.locator('#stage-grid > .tile[data-tile="codex"] video').isVisible());
  await page.keyboard.press('Escape');assert.equal(await page.locator('#stage').getAttribute('data-layout'),'gallery');
  await page.keyboard.press('/');await page.waitForFunction(()=>document.activeElement.id==='message-body');
  await page.evaluate(()=>document.activeElement.blur());
  // Snapshot: preview first, upload only after confirmation.
  const uploads=[];page.on('request',r=>{if(r.url().includes('/api/upload'))uploads.push(r.url());});
  await page.locator('#stage-grid [data-tile="codex"]').hover();
  await page.locator('#stage-grid [data-tile="codex"] [data-tile-act="snap"]').click();
  assert(await page.locator('#snapshot-dialog').evaluate(e=>e.open));assert.equal(uploads.length,0,'nothing uploads before confirmation');
  await page.waitForFunction(()=>typeof snapshotFile!=='undefined'&&snapshotFile);
  await page.locator('#snapshot-confirm').click();
  await page.waitForFunction(()=>document.querySelectorAll('#attachment-list .pending-attachment').length===1);
  assert.equal(uploads.length,1);
  await page.locator('#attachment-list .remove-attachment').click();
  await page.screenshot({path:path.join(shots,'capture-desktop-qa.png')});
  // Window closed: last frame kept; a reload asks to rebind instead of pretending to be live.
  await page.evaluate(()=>window.__fake.tracks.at(-1).dispatchEvent(new Event('ended')));
  await page.waitForFunction(()=>document.querySelector('#stage-grid [data-tile="codex"]').dataset.cap==='ended');
  assert.equal(await page.locator('#stage-grid [data-tile="codex"] video').count(),0);
  await page.locator('#stage-grid [data-tile="codex"] [data-tile-act="bind"]').click();
  await page.waitForFunction(()=>document.querySelector('#stage-grid [data-tile="codex"]').dataset.cap==='live');
  page.once('dialog',d=>d.accept());
  await page.reload();await page.waitForFunction(()=>connected);
  await page.waitForFunction(()=>document.querySelector('#stage-grid [data-tile="codex"]').dataset.cap==='stale');
  assert((await page.locator('#stage-grid [data-tile="codex"]').textContent()).includes('Fake agent window'));
  await page.locator('#capture-open').click();assert((await page.locator('#pop').textContent()).includes('待重新绑定'));
  await page.keyboard.press('Escape');
  console.log('PASS capture: bind, static detection, hidden/unhidden, layouts and shortcuts, confirmed snapshot upload, ended state, rebind after reload');

  // Panels: collapse and restore both side areas.
  await page.locator('#side-toggle').click();assert.equal(await page.locator('#app').getAttribute('data-side'),'closed');
  await page.locator('#side-toggle').click();assert.equal(await page.locator('#app').getAttribute('data-side'),'open');
  await page.locator('#sidebar-collapse').click();assert.equal(await page.locator('#app').getAttribute('data-sidebar'),'closed');
  await page.locator('#menu-toggle').click();assert.equal(await page.locator('#app').getAttribute('data-sidebar'),'open');
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(shots,'workspace-mobile-qa.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS workspace: panels, narrow layout, no page errors');
}finally{
  if(browser)await browser.close();await stop();
  const target=fs.realpathSync(data);assert.equal(path.dirname(target),fs.realpathSync(os.tmpdir()));assert(path.basename(target).startsWith('agents-talk-workspace-'));fs.rmSync(target,{recursive:true,force:true});
}})().catch(e=>{console.error(e);process.exitCode=1;});
