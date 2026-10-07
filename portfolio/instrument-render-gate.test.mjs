import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderGate} from './instrument-render-gate.mjs';

function harness(){
  let now=0,id=0,signal=false,ready=0,complete=[];const timers=new Map(),deleted=[],waits=[];
  const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,TIMEOUT_EXPIRED:4,
    fenceSync:()=>({id:++id}),flush(){},deleteSync(sync){deleted.push(sync.id);},
    clientWaitSync(sync,flags,timeout){waits.push([flags,timeout]);return signal?2:4;},finish(){assert.fail('no blocking waits');}};
  const gate=createRenderGate({gl,clock:()=>now,setTimer(fn,ms){timers.set(++id,{at:now+ms,fn});return id;},clearTimer(key){timers.delete(key);},
    onReady:()=>ready++,onComplete:value=>complete.push(value)});
  function tick(ms){now+=ms;for(const [key,timer] of [...timers])if(timer.at<=now){timers.delete(key);timer.fn();}}
  return{gate,gl,tick,timers,deleted,waits,signal:()=>signal=true,counts:()=>({ready,complete})};
}
test('one outstanding frame coalesces requests until a nonblocking completion',()=>{
  const h=harness();assert.equal(h.gate.canSubmit(),true);h.gate.submitted(.49);
  for(let i=0;i<10;i++)h.gate.request();assert.equal(h.gate.canSubmit(),false);
  h.tick(16);assert.equal(h.counts().ready,0);assert.deepEqual(h.waits,[[0,0]]);
  assert.throws(()=>h.gate.submitted(.55),/one WebGL frame/);
  h.signal();h.tick(16);assert.deepEqual(h.counts(),{ready:1,complete:[.49]});assert.equal(h.gate.canSubmit(),true);
  assert.equal(h.deleted.length,1);assert.equal(h.gate.snapshot().coalesced,9);
  assert.equal(h.gate.snapshot().maxCompletionWaitMs,32);h.gate.dispose();
});
test('gestures and quiet intervals stop both submission and polling until controls can paint',()=>{
  const h=harness();h.gate.submitted(.28);h.gate.request();h.gate.beginInteraction();h.signal();
  h.tick(1000);assert.equal(h.waits.length,0);assert.equal(h.gate.canSubmit(),false);
  h.gate.endInteraction(120);h.tick(119);assert.equal(h.waits.length,0);h.tick(1);
  assert.deepEqual(h.counts(),{ready:1,complete:[.28]});assert.equal(h.gate.canSubmit(),true);h.gate.dispose();
});
test('hidden or modal pauses retain the one frame and request without background polling',()=>{
  const h=harness();h.gate.submitted(.6);h.gate.request();h.gate.setPaused(true);h.signal();h.tick(1000);
  assert.equal(h.waits.length,0);assert.equal(h.timers.size,0);h.gate.setPaused(false);h.tick(16);
  assert.deepEqual(h.counts(),{ready:1,complete:[.6]});h.gate.dispose();
});
test('a static completed frame causes no repeated rendering, including reduced-motion use',()=>{
  const h=harness();h.gate.submitted(.86);h.signal();h.tick(16);h.tick(10000);
  assert.equal(h.counts().ready,0);assert.equal(h.gate.snapshot().completed,1);assert.equal(h.timers.size,0);h.gate.dispose();
});
test('disposal cancels waits and releases only the owned fence',()=>{
  const h=harness();h.gate.submitted(.55);h.gate.request();h.gate.dispose();h.gate.dispose();h.tick(1000);
  assert.equal(h.deleted.length,1);assert.equal(h.waits.length,0);assert.equal(h.counts().ready,0);assert.equal(h.timers.size,0);
});
test('missing sync support keeps completed static frames usable without a wait',()=>{
  let complete=0;const gate=createRenderGate({gl:{},onComplete:()=>complete++});assert.equal(gate.canSubmit(),true);
  assert.equal(gate.submitted(.28),false);assert.equal(complete,1);assert.equal(gate.snapshot().inFlight,false);gate.dispose();
});

test('fence failure stops submission and polling even when visibility resumes',()=>{
  const h=harness();h.gl.clientWaitSync=()=>0;h.gate.submitted(.28);h.tick(16);
  assert.match(h.gate.snapshot().error,/fence failed/);h.gate.setPaused(false);h.gate.request();h.tick(1000);
  assert.equal(h.gate.canSubmit(),false);assert.equal(h.timers.size,0);assert.equal(h.counts().ready,0);
  assert.equal(h.counts().complete.length,0);h.gate.dispose();assert.equal(h.deleted.length,1);
});

test('a lost context during flush preserves owned-fence cleanup without an unbounded queue',()=>{
  const h=harness();h.gl.flush=()=>{throw Error('context lost');};assert.equal(h.gate.submitted(.28),false);
  assert.match(h.gate.snapshot().error,/context lost/);assert.equal(h.gate.canSubmit(),false);
  h.gate.request();h.tick(1000);assert.equal(h.timers.size,0);h.gate.dispose();assert.equal(h.deleted.length,1);
});
