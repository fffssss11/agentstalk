'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const http=require('node:http');
const {EventEmitter}=require('node:events');
const {waitForServer,stopServer}=require('./support.cjs');

function child(overrides={}) {
  return Object.assign(new EventEmitter(),{pid:12345,exitCode:null,signalCode:null},overrides);
}

async function endpoint(t,respond) {
  const requests=[];
  const server=http.createServer((req,res)=>{requests.push(req.url);respond(req,res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return {base:'http://127.0.0.1:'+server.address().port,requests};
}

test('readiness accepts only the spawned child and probes health only',async t=>{
  const {base,requests}=await endpoint(t,(_req,res)=>res.end(JSON.stringify({app:'agents-talk',pid:12345})));
  await waitForServer(child(),base);
  assert.deepEqual(requests,['/api/health']);
});

test('occupied port never grants readiness to an unrelated service',async t=>{
  const {base,requests}=await endpoint(t,(_req,res)=>res.end(JSON.stringify({app:'agents-talk',pid:98765})));
  await assert.rejects(waitForServer(child(),base),/another process/);
  assert.deepEqual(requests,['/api/health']);
});

test('stalled health response has a bounded startup timeout',async t=>{
  const {base}=await endpoint(t,()=>{});
  await assert.rejects(waitForServer(child(),base,{timeoutMs:80}),/timed out/);
});

test('exited child fails promptly without contacting a service',async()=>{
  await assert.rejects(waitForServer(child({exitCode:2}),'http://127.0.0.1:1'),/exited/);
});

test('shutdown handles an already exited child and immediate exit',async()=>{
  await stopServer(child({exitCode:2,kill(){assert.fail('Exited child must not be killed');}}));
  const running=child({kill(){this.exitCode=0;this.emit('exit',0);return true;}});
  await stopServer(running);
  assert.equal(running.listenerCount('exit'),0);
  assert.equal(running.listenerCount('error'),0);
});
