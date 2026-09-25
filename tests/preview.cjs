// Public README screenshots from an isolated board, never the user's server.
// 1) The empty board a new user sees first.
// 2) A clearly labelled demo session: simulated members post through the CLI, and simulated window
//    pictures are canvases stamped "演示画面". No real screen, conversation or model call is involved.
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {spawn,spawnSync}=require('child_process');
const {chromium,python,launchOptions,waitForServer,stopServer}=require('./support.cjs');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'agents-talk-public-preview-'));
const port=18768,base='http://127.0.0.1:'+port,assets=path.join(root,'docs/assets');
const env={...process.env,AGENTS_TALK_DATA:data,AGENTS_TALK_CONFIG:path.join(root,'config.example.json'),PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'};
const server=spawn(python,[path.join(root,'hub.py'),'serve','--port',String(port),'--no-open'],{env,windowsHide:true,stdio:'ignore'});
function cli(...args){const r=spawnSync(python,[path.join(root,'hub.py'),...args],{env,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim()?JSON.parse(r.stdout):null;}
const post=(who,type,...args)=>cli('post','--session','main','--from',who,'--type',type,...args);
const read=who=>cli('read','--session','main','--agent',who);
async function api(pathname,body){
  const s=await(await fetch(base+'/api/state')).json();
  const r=await fetch(base+pathname,{method:'POST',headers:{'Content-Type':'application/json','X-Agents-Token':s.csrf},body:JSON.stringify(body)});
  const text=await r.text();assert(r.ok,text);return JSON.parse(text);
}
// Simulated member windows: canvases stamped as demo pictures, bound in the order claude, codex, reasonix.
const demoCapture=()=>{
  const scenes=[
    {title:'Claude Code · 登录页开发',lines:[['#c9d1d9','> 规划：官网改版 / 登录页开发'],['#3fb950','✓ LOGIN 登录页　已通过 Reasonix 验收'],['#d29922','● API 接口联调　进行中（Codex）'],['#d29922','● DOCS 使用说明　进行中（Reasonix）'],['#8b949e','下一步：接口完成后安排整合验收']]},
    {title:'Codex · workspace/demo',lines:[['#c9d1d9','$ npm test'],['#3fb950',' PASS  login.form.test.js    12 tests'],['#3fb950',' PASS  login.layout.test.js   5 tests'],['#c9d1d9','$ node scripts/api-check.js'],['#8b949e','  200  POST /api/login   正确账号'],['#8b949e','  401  POST /api/login   密码错误'],['#d29922','正在补充错误码处理']]},
    {title:'Reasonix · 验收清单',lines:[['#c9d1d9','验收 LOGIN 登录页'],['#3fb950','✓ 表单校验与错误提示'],['#3fb950','✓ 390px 窄屏布局'],['#3fb950','✓ 键盘操作说明'],['#c9d1d9','结论：通过'],['#8b949e','正在整理 docs/login.md']]}
  ];
  let count=0;
  navigator.mediaDevices.getDisplayMedia=async()=>{
    const scene=scenes[count++%scenes.length];
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=600;
    const g=canvas.getContext('2d');let tick=0;
    const paint=()=>{
      g.fillStyle='#0d1117';g.fillRect(0,0,960,600);
      g.fillStyle='#161b22';g.fillRect(0,0,960,44);
      // Centred so the tile's name chip in the top-left corner does not collide with it.
      g.fillStyle='#8b949e';g.font='18px "Microsoft YaHei", sans-serif';g.textAlign='center';g.fillText(scene.title,480,29);g.textAlign='left';
      g.font='24px Consolas, "Microsoft YaHei", monospace';
      scene.lines.forEach(([color,text],i)=>{g.fillStyle=color;g.fillText(text,36,104+i*48);});
      if(tick%2){g.fillStyle='#c9d1d9';g.fillRect(36,104+scene.lines.length*48-22,14,26);}
      // Mid-right, clear of the tile's name, status and caption overlays.
      g.fillStyle='#d29922';g.fillRect(820,250,120,34);g.fillStyle='#0d1117';g.font='bold 18px "Microsoft YaHei", sans-serif';g.fillText('演示画面',844,273);
    };
    paint();setInterval(()=>{tick++;paint();},500);
    const stream=canvas.captureStream(5),track=stream.getVideoTracks()[0];
    Object.defineProperty(track,'label',{value:scene.title});
    const settings=track.getSettings.bind(track);track.getSettings=()=>({...settings(),displaySurface:'window',width:960,height:600});
    return stream;
  };
};
let browser;
(async()=>{
  try{
    await waitForServer(server,base);
    browser=await chromium.launch(launchOptions);
    const page=await browser.newPage({viewport:{width:1600,height:1050},reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(demoCapture);
    await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#instances-open').disabled);
    const state=await(await fetch(base+'/api/state')).json();
    assert.equal(state.total,0);assert.equal(state.tasks.length,0);
    assert(Object.values(state.agents).every(a=>!a.online));
    assert(await page.locator('#reader-warning').evaluate(el=>el.classList.contains('onboarding-notice')));
    fs.mkdirSync(assets,{recursive:true});
    await page.screenshot({path:path.join(assets,'dashboard.png')});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(root,'.runtime/public-empty-mobile.png')});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    console.log('PASS public preview: empty isolated board, desktop and narrow layout, no real conversations.');

    // Demo session: a project with two sessions, a standalone session and simulated members at work.
    await api('/api/library',{action:'project_create',request_id:'demo-project',name:'官网改版',color:'green',description:'登录页、接口和文档一起推进'});
    const project=(await(await fetch(base+'/api/state')).json()).library.projects.find(p=>p.name==='官网改版').id;
    await api('/api/library',{action:'session_update',request_id:'demo-main',session:'main',title:'登录页开发',project});
    await api('/api/session',{action:'create',request_id:'demo-perf',title:'首页性能优化',project});
    await api('/api/session',{action:'create',request_id:'demo-weekly',title:'周报整理'});
    for(const who of ['claude','codex','reasonix'])post(who,'join','--body','已接入。');
    post('claude','say','--body','今天目标：完成登录页并通过独立验收。Codex 负责实现，Reasonix 负责验收。');
    post('claude','task','--task','LOGIN','--to','codex','--reviewer','reasonix','--body','实现登录页：表单校验、错误提示、窄屏布局。');
    post('claude','task','--task','API','--to','codex','--reviewer','reasonix','--depends-on','LOGIN','--body','对接登录接口，补充错误码处理。');
    post('claude','task','--task','DOCS','--to','reasonix','--reviewer','claude','--body','整理登录流程的使用说明。');
    read('codex');post('codex','claim','--task','LOGIN','--body','开始实现登录页。');
    post('codex','say','--body','表单与校验完成，正在处理窄屏布局。');
    post('codex','done','--task','LOGIN','--body','登录页完成，已自测桌面与 390px 窄屏。');
    read('reasonix');post('reasonix','review','--task','LOGIN','--verdict','pass','--body','独立验收通过：校验、错误提示与窄屏布局符合要求。');
    read('codex');post('codex','claim','--task','API','--body','开始对接登录接口。');
    read('reasonix');post('reasonix','claim','--task','DOCS','--body','开始整理使用说明。');
    post('codex','say','--body','接口联调中：成功与密码错误两种情况已通过。');
    // Usage figures are labelled as demo data, not as any real model's consumption.
    for(const [who,input,output] of [['claude',9410,1320],['codex',18230,2140],['reasonix',6020,880]])
      post(who,'usage','--usage-id','demo-'+who,'--input-tokens',String(input),'--output-tokens',String(output),'--provider','demo','--model','demo','--usage-source','演示数据');

    await page.setViewportSize({width:1600,height:1000});
    await page.reload();await page.waitForFunction(()=>!document.querySelector('#send-button').disabled);
    await page.locator('#session-list, #project-list').getByText('登录页开发').first().click();
    await page.waitForFunction(()=>document.querySelector('#session-title').textContent==='登录页开发');
    // A human request sent as a priority intervention, then acknowledged when members read.
    await page.locator('#message-body').fill('请在交付前补充键盘操作说明。');
    await page.locator('#intervene-toggle').click();
    await page.locator('#send-button').click();
    await page.waitForFunction(()=>document.querySelector('#message-body').value==='');
    const intervention=(await(await fetch(base+'/api/state?session=main')).json()).messages.filter(m=>m.type==='intervention').pop();
    for(const who of ['claude','codex','reasonix'])read(who);
    // Two members acknowledge; the third still shows as waiting, as receipts do in real use.
    post('claude','ack','--reply-to',intervention.id,'--body','收到，交付前会核对键盘操作说明。');
    post('codex','ack','--reply-to',intervention.id,'--body','收到，接口完成后补充键盘操作说明。');
    for(const who of ['claude','codex','reasonix']){
      await page.locator(`#stage-grid [data-tile="${who}"] [data-tile-act="bind"]`).first().click();
      await page.waitForFunction(id=>{const v=document.querySelector(`#stage-grid [data-tile="${id}"] video`);return v&&v.videoWidth>0;},who);
    }
    await page.waitForTimeout(1500);
    // Binding notices are transient; the screenshot shows the settled workspace.
    await page.evaluate(()=>{document.activeElement?.blur();document.querySelectorAll('#toast-region > *').forEach(t=>t.remove());});
    await page.screenshot({path:path.join(assets,'screenshot-live.png')});
    await page.locator('#workflow-open').click();await page.waitForTimeout(800);
    await page.screenshot({path:path.join(assets,'screenshot-flow.png')});
    await page.locator('#live-open').click();
    await page.evaluate(()=>{selectTheme('dark');setLayout('speaker');});
    await page.waitForTimeout(1200);
    await page.screenshot({path:path.join(assets,'screenshot-dark.png')});
    await page.evaluate(()=>{selectTheme('mint');setLayout('gallery');});
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(800);
    await page.screenshot({path:path.join(assets,'screenshot-mobile.png')});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log('PASS demo screenshots: live stage, flow, dark focus layout and phone layout from simulated members.');
  }finally{
    if(browser)await browser.close();
    await stopServer(server);
    const resolved=fs.realpathSync(data),tmp=fs.realpathSync(os.tmpdir());
    if(path.dirname(resolved)!==tmp||!path.basename(resolved).startsWith('agents-talk-public-preview-'))throw Error('Unsafe cleanup target');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
