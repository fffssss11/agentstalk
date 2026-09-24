const path=require('path'),fs=require('fs');
const {spawnSync}=require('child_process');
// npm ci + npx playwright install chromium is the public default.
const {chromium}=require(process.env.AGENTS_TALK_NODE_MODULES ? path.join(process.env.AGENTS_TALK_NODE_MODULES,'playwright') : 'playwright');
const root=path.resolve(__dirname,'..');
fs.mkdirSync(path.join(root,'.runtime'),{recursive:true});
function findPython(){
  const choices=process.env.AGENTS_TALK_PYTHON ? [process.env.AGENTS_TALK_PYTHON] : ['python3','python'];
  for(const candidate of choices){
    const r=spawnSync(candidate,['-c','import sys; assert sys.version_info >= (3,10); print(sys.executable)'],{encoding:'utf8',windowsHide:true});
    if(r.status===0&&r.stdout.trim())return r.stdout.trim();
  }
  throw Error('Python 3.10+ not found. Set AGENTS_TALK_PYTHON to its executable.');
}
const executablePath=process.env.AGENTS_TALK_BROWSER||process.env.AGENTS_TALK_CHROME;

// Probe only the read-only health endpoint, and verify the child identity before
// allowing a browser test to open a page or submit anything on a fixed port.
async function waitForServer(server, base, {timeoutMs=10000}={}) {
  let spawnError;
  const onError=error=>{spawnError=error;};
  server.on('error',onError);
  const deadline=Date.now()+timeoutMs;
  try {
    while(Date.now()<deadline) {
      if(spawnError)throw spawnError;
      if(server.exitCode!==null||server.signalCode!==null)throw Error('Isolated test server exited before becoming ready');
      let health;
      try {
        const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(Math.max(1,Math.min(1000,deadline-Date.now())))});
        if(response.ok)health=await response.json();
      } catch {}
      if(health) {
        if(health.app!=='agents-talk'||health.pid!==server.pid)throw Error('Test port belongs to another process; refusing to use it');
        if(server.exitCode!==null||server.signalCode!==null)throw Error('Isolated test server exited during readiness check');
        return;
      }
      await new Promise(resolve=>setTimeout(resolve,Math.min(100,Math.max(0,deadline-Date.now()))));
    }
    throw Error('Isolated test server readiness timed out');
  } finally {server.removeListener('error',onError);}
}

async function stopServer(server) {
  if(!server||!server.pid||server.exitCode!==null||server.signalCode!==null)return;
  await new Promise((resolve,reject)=>{
    let timer;
    const cleanup=()=>{clearTimeout(timer);server.removeListener('exit',done);server.removeListener('error',failed);};
    const done=()=>{cleanup();resolve();};
    const failed=error=>{cleanup();reject(error);};
    server.once('exit',done);server.once('error',failed);
    timer=setTimeout(()=>failed(Error('Isolated test server did not stop within 5 seconds')),5000);
    server.kill();
  });
}

module.exports={chromium,python:findPython(),launchOptions:{headless:true,...(executablePath?{executablePath}:{})},waitForServer,stopServer};
