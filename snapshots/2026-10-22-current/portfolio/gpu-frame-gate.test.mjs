import test from 'node:test';
import assert from 'node:assert/strict';
import {createGpuFrameGate} from './gpu-frame-gate.mjs';

function fixture(options={}){
 let time=0,next=0,lost=false,result=0x911b;
 const calls=[],gl={SYNC_GPU_COMMANDS_COMPLETE:0x9117,ALREADY_SIGNALED:0x911a,CONDITION_SATISFIED:0x911c,TIMEOUT_EXPIRED:0x911b,WAIT_FAILED:0x911d,
  fenceSync(...args){const sync={id:++next};calls.push(['fence',...args,sync]);return sync;},
  flush(){calls.push(['flush']);},deleteSync(sync){calls.push(['delete',sync]);},
  clientWaitSync(...args){calls.push(['poll',...args]);return result;},isContextLost(){return lost;}};
 const gate=createGpuFrameGate({getContext:()=>gl},{clock:()=>time,...options});
 return {gl,calls,gate,setTime(v){time=v;},setLost(v){lost=v;},setResult(v){result=v;}};
}

test('one outstanding frame fences all its draws; every readiness poll is nonblocking',()=>{
 const f=fixture();assert.equal(f.gate.ready(),true);assert.deepEqual(f.calls,[]);
 assert.equal(f.gate.submitted(),true);assert.equal(f.gate.submitted(),false);
 assert.deepEqual(f.calls.map(c=>c[0]),['fence','flush']);
 assert.equal(f.gate.ready(),false);assert.equal(f.gate.ready(),false);
 for(const call of f.calls.filter(c=>c[0]==='poll'))assert.deepEqual(call.slice(2),[0,0]);
 f.setResult(f.gl.CONDITION_SATISFIED);assert.equal(f.gate.ready(),true);
 assert.equal(f.calls.filter(c=>c[0]==='delete').length,1);
 assert.equal(f.gate.submitted(),true);
 const s=f.gate.snapshot();assert.equal(s.fencedFrames,2);assert.equal(s.completedFences,1);assert.equal(s.skippedCallbacks,2);
 assert.equal(s.polls,3);assert.equal(s.duplicateSubmissions,1);assert.equal(s.pending,true);
 assert.equal('fps' in s,false);f.gate.dispose();
});

test('already-signaled fences complete once and idle/snapshot calls issue no GL queries',()=>{
 const f=fixture();f.gate.submitted();f.setResult(f.gl.ALREADY_SIGNALED);assert.equal(f.gate.ready(),true);
 const count=f.calls.length;for(let i=0;i<20;i++){assert.equal(f.gate.ready(),true);f.gate.snapshot();}
 assert.equal(f.calls.length,count);assert.equal(f.gate.snapshot().completedFences,1);f.gate.dispose();
});

test('context loss fails open, deletes only the owned fence, and permanently stops GL work',()=>{
 const f=fixture();f.gate.submitted();const owned=f.calls[0][3];f.setLost(true);
 assert.equal(f.gate.ready(),true);assert.equal(f.gate.snapshot().disabledReason,'context-lost');
 assert.deepEqual(f.calls.filter(c=>c[0]==='delete'),[['delete',owned]]);
 const count=f.calls.length;f.setLost(false);assert.equal(f.gate.ready(),true);assert.equal(f.gate.submitted(),false);
 f.gate.dispose();assert.equal(f.calls.length,count);
});

test('failed and unexpected polls fail open rather than freezing the presentation',()=>{
 for(const mode of ['wait-failed','unexpected','throw']){
  const f=fixture();f.gate.submitted();
  if(mode==='throw')f.gl.clientWaitSync=()=>{throw new Error('driver');};else f.setResult(mode==='wait-failed'?f.gl.WAIT_FAILED:12345);
  assert.equal(f.gate.ready(),true);assert.equal(f.gate.snapshot().enabled,false);assert.equal(f.gate.snapshot().pending,false);
  assert.equal(f.gate.submitted(),false);assert.equal(f.calls.filter(c=>c[0]==='delete').length,1);f.gate.dispose();
 }
});

test('null/throwing fence creation and flush errors disable safely',()=>{
 for(const mode of ['null','fence-throw','flush-throw']){
  const f=fixture();
  if(mode==='null')f.gl.fenceSync=()=>null;
  if(mode==='fence-throw')f.gl.fenceSync=()=>{throw new Error('fence');};
  if(mode==='flush-throw')f.gl.flush=()=>{throw new Error('flush');};
  assert.equal(f.gate.submitted(),false);assert.equal(f.gate.ready(),true);
  assert.equal(f.gate.snapshot().enabled,false);assert.equal(f.gate.snapshot().fencedFrames,0);
  assert.equal(f.calls.filter(c=>c[0]==='delete').length,mode==='flush-throw'?1:0);f.gate.dispose();
 }
});

test('a stalled driver has a callback-polled watchdog, not a permanent false readiness',()=>{
 const f=fixture({maxPendingMs:100});f.gate.submitted();f.setTime(99);assert.equal(f.gate.ready(),false);
 f.setTime(100);assert.equal(f.gate.ready(),true);assert.equal(f.gate.snapshot().disabledReason,'fence-timeout');
 assert.equal(f.gate.snapshot().polls,2);assert.equal(f.gate.snapshot().skippedCallbacks,1);f.gate.dispose();
});

test('a completed fence after long idle is released without disabling the gate',()=>{
 for(const result of [0x911a,0x911c]){
  const f=fixture({maxPendingMs:100});f.gate.submitted();f.setTime(60000);f.setResult(result);
  assert.equal(f.gate.ready(),true);assert.equal(f.gate.snapshot().enabled,true);
  assert.equal(f.gate.snapshot().disabledReason,null);assert.equal(f.gate.snapshot().completedFences,1);
  assert.equal(f.gate.snapshot().polls,1);assert.equal(f.gate.snapshot().failures,0);
  assert.equal(f.gate.submitted(),true);assert.equal(f.gate.snapshot().fencedFrames,2);f.gate.dispose();
 }
});

test('unsupported contexts and unavailable contexts are inert and safe to dispose',()=>{
 for(const renderer of [{getContext:()=>({})},{getContext(){throw new Error('lost');}}]){
  const gate=createGpuFrameGate(renderer);assert.equal(gate.ready(),true);assert.equal(gate.submitted(),false);
  assert.equal(gate.snapshot().enabled,false);gate.dispose();gate.dispose();assert.equal(gate.ready(),true);
 }
});

test('dispose is idempotent and does not alter renderer methods or state',()=>{
 const f=fixture();f.gate.submitted();f.gate.dispose();f.gate.dispose();
 assert.equal(f.calls.filter(c=>c[0]==='delete').length,1);const count=f.calls.length;
 assert.equal(f.gate.ready(),true);assert.equal(f.gate.submitted(),false);assert.equal(f.calls.length,count);
 assert.equal(f.gate.snapshot().disposed,true);assert.equal(f.gate.snapshot().pending,false);
});

test('cleanup failure cannot trap callers or leave the same sync pending',()=>{
 const f=fixture();f.gate.submitted();f.gl.deleteSync=()=>{throw new Error('lost during cleanup');};
 f.setResult(f.gl.ALREADY_SIGNALED);assert.equal(f.gate.ready(),true);assert.equal(f.gate.snapshot().pending,false);
 assert.equal(f.gate.snapshot().failures,1);f.gate.dispose();
});

test('two-frame capacity preserves overlap but strictly bounds obsolete queued frames',()=>{
 const f=fixture({maxFramesInFlight:2});assert.equal(f.gate.snapshot().maxFramesInFlight,2);
 assert.equal(f.gate.submitted(),true);const first=f.calls[0][3];
 assert.equal(f.gate.ready(),true,'one pending frame leaves room for overlap');
 assert.equal(f.gate.snapshot().skippedCallbacks,0);assert.equal(f.gate.submitted(),true);
 const second=f.calls.filter(c=>c[0]==='fence')[1][3];
 assert.equal(f.gate.snapshot().pendingFrames,2);assert.equal(f.gate.submitted(),false);
 assert.equal(f.gate.ready(),false);assert.equal(f.gate.snapshot().skippedCallbacks,1);
 assert.deepEqual(f.calls.filter(c=>c[0]==='poll').map(c=>c[1]),[first,first]);
 f.setResult(f.gl.ALREADY_SIGNALED);assert.equal(f.gate.ready(),true);
 assert.equal(f.gate.snapshot().pendingFrames,1);assert.equal(f.gate.snapshot().completedFences,1);
 assert.deepEqual(f.calls.filter(c=>c[0]==='delete'),[['delete',first]]);
 assert.equal(f.gate.submitted(),true);assert.equal(f.gate.snapshot().pendingFrames,2);
 assert.equal(f.gate.ready(),true);assert.equal(f.calls.filter(c=>c[0]==='poll').at(-1)[1],second);
 assert.equal(f.gate.snapshot().completedFences,2);f.gate.dispose();
 assert.equal(f.calls.filter(c=>c[0]==='delete').length,3);
 assert.equal(f.calls.filter(c=>c[0]==='flush').length,3);
});

test('two-frame errors and timeout release both fences and fail open',()=>{
 for(const mode of ['lost','timeout','failed']){
  const f=fixture({maxFramesInFlight:2,maxPendingMs:100});f.gate.submitted();f.setTime(20);f.gate.submitted();
  if(mode==='lost')f.setLost(true);else if(mode==='timeout')f.setTime(100);else f.setResult(f.gl.WAIT_FAILED);
  assert.equal(f.gate.ready(),true);assert.equal(f.gate.snapshot().enabled,false);
  assert.equal(f.gate.snapshot().pendingFrames,0);assert.equal(f.calls.filter(c=>c[0]==='delete').length,2);
  const count=f.calls.length;f.gate.dispose();assert.equal(f.calls.length,count);
 }
});

test('invalid frame capacities retain one-frame default rather than growing a queue',()=>{
 for(const capacity of [0,3,100,Infinity,NaN,'2',null]){
  const f=fixture({maxFramesInFlight:capacity});assert.equal(f.gate.snapshot().maxFramesInFlight,1);
  assert.equal(f.gate.submitted(),true);assert.equal(f.gate.submitted(),false);assert.equal(f.gate.snapshot().pendingFrames,1);f.gate.dispose();
 }
});
