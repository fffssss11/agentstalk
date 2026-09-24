// Generate a public README screenshot from an empty isolated board, never the user's server.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {spawn}=require('child_process');
const {chromium,python,launchOptions,waitForServer,stopServer}=require('./support.cjs');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'agents-talk-public-preview-'));
const base='http://127.0.0.1:18768';
const server=spawn(python,[path.join(root,'hub.py'),'serve','--port','18768','--no-open'],{
  env:{...process.env,AGENTS_TALK_DATA:data,AGENTS_TALK_CONFIG:path.join(root,'config.example.json'),PYTHONUTF8:'1'},
  windowsHide:true,stdio:'ignore'
});
let browser;
(async()=>{
  try{
    await waitForServer(server,base);
    browser=await chromium.launch(launchOptions);
    const page=await browser.newPage({viewport:{width:1600,height:1050},reducedMotion:'reduce'});
    await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#instances-open').disabled);
    const state=await(await fetch(base+'/api/state')).json();
    assert.equal(state.total,0);assert.equal(state.tasks.length,0);
    assert(Object.values(state.agents).every(a=>!a.online));
    assert(await page.locator('#reader-warning').evaluate(el=>el.classList.contains('onboarding-notice')));
    fs.mkdirSync(path.join(root,'docs/assets'),{recursive:true});
    await page.screenshot({path:path.join(root,'docs/assets/dashboard.png')});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(root,'.runtime/public-empty-mobile.png')});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    console.log('PASS public preview: empty isolated board, desktop and narrow layout, no real conversations.');
  }finally{
    if(browser)await browser.close();
    await stopServer(server);
    const resolved=fs.realpathSync(data),tmp=fs.realpathSync(os.tmpdir());
    if(path.dirname(resolved)!==tmp||!path.basename(resolved).startsWith('agents-talk-public-preview-'))throw Error('Unsafe cleanup target');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
