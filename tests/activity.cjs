// Task activity and dispatch animations use isolated records and a dedicated port.
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {spawn,spawnSync}=require('child_process');
const {chromium,python,launchOptions,waitForServer,stopServer}=require('./support.cjs');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'agents-talk-activity-'));
const env={...process.env,AGENTS_TALK_DATA:data,AGENTS_TALK_CONFIG:path.join(root,'config.example.json'),PYTHONUTF8:'1'};
const base='http://127.0.0.1:18771';let server,browser;
function run(args){const r=spawnSync(python,args,{cwd:root,env,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
function post(who,type,...args){return run(['hub.py','post','--session','main','--from',who,'--type',type,...args]);}
function read(who){return run(['hub.py','read','--session','main','--agent',who]);}
function start(){server=spawn(python,['hub.py','serve','--port','18771','--no-open'],{cwd:root,env,windowsHide:true,stdio:'pipe'});}
const stop=()=>stopServer(server);
const ready=()=>waitForServer(server,base);
async function control(action){const s=await(await fetch(base+'/api/state')).json();const r=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json','X-Agents-Token':s.csrf},body:JSON.stringify({session:'main',action,request_id:'activity-'+action})});assert(r.ok,await r.text());}
(async()=>{try{
  post('claude','task','--task','WORK','--to','codex','--reviewer','reasonix','--body','制作协作入口');read('codex');
  start();await ready();browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:1600,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>document.querySelector('#session-title').textContent==='协作工作室');
  assert.equal(await page.locator('[data-activity]').count(),0,'online without claimed tasks must not imply work');
  await page.locator('#workflow-open').click();assert.equal(await page.locator('[data-live="true"]').count(),0,'existing records are not new dispatches');
  assert((await page.locator('.dispatch-route').textContent()).includes('Claude'));
  await page.locator('#live-open').click();await page.evaluate(()=>openSideTab('members'));
  post('codex','claim','--task','WORK','--body','开始实现');read('codex');
  await page.waitForSelector('#agent-list [data-activity="codex"]');
  await page.waitForSelector('#stage-grid [data-activity="codex"]');
  assert.equal(await page.locator('#stage-grid [data-tile="codex"]').getAttribute('data-active'),'true');
  await page.evaluate(()=>{window.savedTileGlyph=document.querySelector('#stage-grid [data-activity="codex"] svg');window.savedMemberGlyph=document.querySelector('#agent-list [data-activity="codex"] svg');});
  post('reasonix','say','--body','独立验收准备中');
  await page.waitForFunction(()=>document.querySelector('#stage-grid [data-tile="reasonix"]').textContent.includes('独立验收准备中'));
  assert(await page.evaluate(()=>window.savedTileGlyph===document.querySelector('#stage-grid [data-activity="codex"] svg')),'other messages must preserve the tile glyph');
  assert(await page.evaluate(()=>window.savedMemberGlyph===document.querySelector('#agent-list [data-activity="codex"] svg')),'other messages must preserve the member glyph');
  await page.screenshot({path:path.join(root,'.runtime/activity-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'.runtime/activity-mobile.png')});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#mobile-tabs [data-m="flow"]').click();
  const sent=post('claude','task','--task','NEW','--to','reasonix','--reviewer','codex','--body','核对 <script> 内容与窄屏布局');
  await page.waitForSelector('[data-dispatch-id="'+sent.id+'"][data-live="true"]');
  assert.equal(await page.locator('#workflow-dispatch script').count(),0);
  assert.equal(await page.locator('#workflow-dispatch .dispatch-event').count(),2);
  assert(await page.locator('#workflow-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:path.join(root,'.runtime/dispatch-mobile.png')});
  await page.setViewportSize({width:1600,height:1050});await page.screenshot({path:path.join(root,'.runtime/dispatch-desktop.png')});
  await page.waitForFunction(()=>!document.querySelector('#workflow-dispatch [data-live="true"]'));
  await page.locator('.dispatch-task').first().click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.flowTask),'NEW');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('#agent-list .activity-glyph').first().evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('#live-open').click();
  post('codex','done','--task','WORK','--body','提交待验收');await page.waitForFunction(()=>!document.querySelector('[data-activity="codex"]'));
  post('reasonix','claim','--task','NEW','--body','开始验证');read('reasonix');await page.waitForSelector('[data-activity="reasonix"]');
  post('reasonix','blocked','--task','NEW','--body','缺少输入');await page.waitForFunction(()=>!document.querySelector('[data-activity="reasonix"]'));
  post('reasonix','claim','--task','NEW','--body','输入已齐，重新认领并继续验证');read('reasonix');await page.waitForSelector('[data-activity="reasonix"]');
  await page.route('**/api/state?*',async route=>{const response=await route.fetch();const json=await response.json();json.agents.reasonix.online=false;json.agents.reasonix.needs_attention=true;await route.fulfill({response,json});});
  await page.waitForFunction(()=>!document.querySelector('[data-activity="reasonix"]'));
  await page.unroute('**/api/state?*');await page.waitForSelector('[data-activity="reasonix"]');
  await stop();await page.waitForFunction(()=>document.querySelector('#connection-status').classList.contains('disconnected'));assert.equal(await page.locator('[data-activity]').count(),0);
  start();await ready();await page.waitForSelector('[data-activity="reasonix"]');assert.equal(await page.locator('[data-live="true"]').count(),0);
  await control('paused');await page.waitForFunction(()=>document.querySelector('#session-status').textContent==='已发出暂停');assert.equal(await page.locator('[data-activity]').count(),0);
  await control('ended');await page.waitForFunction(()=>document.querySelector('#session-status').textContent==='已结束');assert.equal(await page.locator('[data-activity]').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS activity: claim, independent messages, fresh dispatch, history, escaping, done, blocked, heartbeat expiry, disconnect/reconnect, pause/end, reduced motion, desktop/mobile.');
}finally{if(browser)await browser.close();await stop();const target=fs.realpathSync(data);assert.equal(path.dirname(target),fs.realpathSync(os.tmpdir()));assert(path.basename(target).startsWith('agents-talk-activity-'));fs.rmSync(target,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
