import test from 'node:test';
import assert from 'node:assert/strict';
import {createStartupInputGate} from './instrument-startup-input.mjs';
import {prepareStartupTextures} from './instrument-startup.mjs';

const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function harness(options={}){
  let now=0,id=0;const timers=new Map(),listeners=new Map();
  const target={addEventListener(type,fn,opts){assert.deepEqual(opts,{capture:true,passive:true});listeners.set(type,fn);},removeEventListener(type,fn,capture){assert.equal(capture,true);assert.equal(listeners.get(type),fn);listeners.delete(type);}};
  const gate=createStartupInputGate({target,clock:()=>now,setTimer:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},clearTimer:id=>timers.delete(id),...options});
  return {gate,timers,listeners,emit:(type,event={})=>listeners.get(type)?.(event),async advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await flush();}};
}
const texture=name=>({isTexture:true,name,image:{width:2048,height:2048}});
test('active gesture pauses indefinitely; release/cancel waits for the quiet interval',async()=>{
  for(const end of ['pointerup','pointercancel']){
    const h=harness();h.emit('pointerdown',{pointerType:'touch',pointerId:1});
    let passed=false;const wait=h.gate.beforeUpload().then(()=>passed=true);
    await h.advance(10000);assert.equal(passed,false,'no timeout forces progress');
    h.emit(end,{pointerId:1});await h.advance(179);assert.equal(passed,false);
    await h.advance(16);await wait;assert.equal(passed,true);h.gate.dispose();assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
  }
});
test('touch fallback and multiple pointers remain held until every contact ends',async()=>{
  const h=harness();h.emit('touchstart',{touches:[{}]});h.emit('pointerdown',{pointerType:'touch',pointerId:1});h.emit('pointerdown',{pointerType:'touch',pointerId:2});
  let passed=false;const wait=h.gate.beforeUpload().then(()=>passed=true);
  h.emit('pointerup',{pointerId:1});h.emit('touchcancel',{touches:[]});await h.advance(1000);assert.equal(passed,false);
  h.emit('pointercancel',{pointerId:2});await h.advance(180);await wait;h.gate.dispose();
});
test('scroll inertia extends quiet time after release and continuous scroll makes no progress',async()=>{
  const h=harness();h.emit('scroll');let passed=false;const wait=h.gate.beforeUpload().then(()=>passed=true);
  for(let i=0;i<8;i++){await h.advance(100);assert.equal(passed,false);h.emit('scroll');}
  await h.advance(179);assert.equal(passed,false);await h.advance(16);await wait;h.gate.dispose();
});
test('disposal and pagehide cancel pending waits immediately and remove all listeners/timers',async()=>{
  for(const pagehide of [false,true]){
    const h=harness();h.emit('pointerdown',{pointerType:'touch',pointerId:1});
    const rejection=assert.rejects(h.gate.beforeUpload(),/cancelled/);
    if(pagehide)h.emit('pagehide',{persisted:false});else h.gate.dispose();
    await rejection;assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);h.gate.dispose();
    await assert.rejects(h.gate.beforeUpload(),/cancelled/);
  }
});
test('external disposal cancellation stops even a held gesture on the next poll',async()=>{
  const h=harness();h.emit('touchstart',{touches:[{}]});let cancelled=false;
  const rejection=assert.rejects(h.gate.beforeUpload(()=>cancelled),/cancelled/);cancelled=true;await h.advance(16);await rejection;h.gate.dispose();
});
test('pending continuous input blocks a new upload; unavailable or throwing API is optional',async()=>{
  let pending=true;const h=harness({inputPending:()=>pending});let passed=false;
  const wait=h.gate.beforeUpload().then(()=>passed=true);await h.advance(500);assert.equal(passed,false);pending=false;await h.advance(16);await wait;h.gate.dispose();
  for(const inputPending of [()=>undefined,()=>{throw Error('unsupported');}]){const h=harness({inputPending});await h.gate.beforeUpload();h.gate.dispose();}
  const absent=createStartupInputGate({target:null});await absent.beforeUpload();absent.dispose();
});
test('gesture starting during an atomic upload prevents the next upload, with original identities preserved',async()=>{
  const h=harness(),a=texture('a'),b=texture('b'),calls=[];let yields=0;
  const pending=prepareStartupTextures({renderer:{initTexture(t){calls.push(t);if(t===a)h.emit('pointerdown',{pointerType:'touch',pointerId:1});}},materials:[{map:a,normalMap:b}],beforeUpload:h.gate.beforeUpload,yieldTask:async()=>{yields++;}}).finally(h.gate.dispose);
  await flush();assert.deepEqual(calls,[a]);await h.advance(1000);assert.deepEqual(calls,[a]);
  h.emit('pointerup',{pointerId:1});await h.advance(180);const receipt=await pending;assert.deepEqual(calls,[a,b]);assert.equal(yields,2);assert.equal(receipt.yields,2);assert.equal(h.listeners.size,0);
});
test('mid-preparation upload and yield errors stop work and clean up the owned gate',async()=>{
  for(const failure of ['upload','yield']){
    const h=harness(),calls=[];
    const pending=prepareStartupTextures({renderer:{initTexture(t){calls.push(t.name);if(failure==='upload'&&t.name==='b')throw Error('upload failure');}},materials:[{map:texture('a'),normalMap:texture('b'),roughnessMap:texture('c')}],beforeUpload:h.gate.beforeUpload,yieldTask:async()=>{if(failure==='yield')throw Error('yield failure');}}).finally(h.gate.dispose);
    await assert.rejects(pending,/failure/);assert.deepEqual(calls,failure==='upload'?['a','b']:['a']);assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
  }
});
test('actual integration passes the gate before upload and disposes it on preparation failure',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('./instrument-3d.js',import.meta.url),'utf8');
  assert.ok(source.indexOf('const startupInputGate=createStartupInputGate();')<source.indexOf('async function init()'));
  assert.ok(source.trimEnd().endsWith('.finally(()=>startupInputGate.dispose());'));
  const start=source.indexOf('  if(mobileLayout.matches&&!pathTracer&&!rasterResourcesDisposed&&'),end=source.indexOf("  if(['profile','warmup']",start);
  const execute=new (Object.getPrototypeOf(async function(){}).constructor)('mobileLayout','pathTracer','rasterResourcesDisposed','query','startup','startupPhase','prepareStartupTextures','renderer','objects','cables','startupInputGate',source.slice(start,end));
  const h=harness();h.emit('touchstart',{touches:[{}]});let calls=0;
  const pending=execute({matches:true},false,false,new URLSearchParams(),{},()=>{},async options=>{
    await options.beforeUpload(options.cancelled);calls++;throw Error('upload failure');
  },{},[],[],h.gate);
  const rejected=assert.rejects(pending,/upload failure/);await h.advance(1000);assert.equal(calls,0);
  h.emit('touchend',{touches:[]});await h.advance(180);await rejected;assert.equal(calls,1);assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
});
