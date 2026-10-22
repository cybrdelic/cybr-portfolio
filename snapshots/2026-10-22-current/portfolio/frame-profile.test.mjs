import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameProfile} from './frame-profile.mjs';

function fixture({extension=true}={}){
 let time=0,target=null,active=null,disjoint=false,lost=false,nextTimer=1,resultReads=0,availabilityReads=0,disjointReads=0;
 const queries=[],timers=new Map(),ext={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2};
 const gl={QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4,CURRENT_QUERY:5,
  getExtension:()=>extension?ext:null,isContextLost:()=>lost,
  getParameter(){disjointReads++;return disjoint;},getQuery:()=>active,
  createQuery(){const query={available:false,elapsed:0,deleted:false};queries.push(query);return query;},
  beginQuery(type,query){assert.equal(active,null,'elapsed queries must never nest');active=query;},
  endQuery(){assert.ok(active,'only owned active queries may end');active=null;},
  getQueryParameter(query,kind){
   if(kind===this.QUERY_RESULT_AVAILABLE){availabilityReads++;return query.available;}
   assert.equal(query.available,true,'blocking QUERY_RESULT read before availability');resultReads++;return query.elapsed*1e6;
  },
  deleteQuery(query){assert.notEqual(active,query,'must close an owned active query before disposal');query.deleted=true;}
 };
 const work=(cpu=1,gpu=2)=>{time+=cpu;if(active)active.elapsed+=gpu;};
 const renderer={getContext:()=>gl,getRenderTarget:()=>target,
  setRenderTarget(next){assert.equal(this,renderer);target=next;return next;},
  render(scene){assert.equal(this,renderer);if(scene.execute)return scene.execute(renderer,work);work(scene.cpu??1,scene.gpu??2);if(scene.fail)throw Error('synthetic render failure');return scene;}
 };
 const originalRender=renderer.render,originalTarget=renderer.setRenderTarget;
 const profile=createFrameProfile(renderer,{clock:()=>time,schedule:(fn,ms)=>{const id=nextTimer++;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id)});
 return {renderer,profile,queries,timers,originalRender,originalTarget,work,
  advance:ms=>{time+=ms;},available:()=>{for(const query of queries)query.available=true;},
  setDisjoint:value=>{disjoint=value;},setLost:value=>{lost=value;},setForeignQuery:value=>{active=value;},
  active:()=>active,target:()=>target,reads:()=>({resultReads,availabilityReads,disjointReads})};
}
const target={width:256,height:256,texture:{type:1016}};

test('twenty tile draws produce one whole-frame sample, not twenty partial frames',()=>{
 const f=fixture();f.profile.begin('geo');
 for(let i=0;i<20;i++){f.renderer.setRenderTarget(null);f.renderer.render({});}
 f.profile.end();assert.equal(f.queries.length,1);
 let state=f.profile.snapshot();assert.equal(state.geo.cpu.samples,1);assert.equal(state.geo.cpu.lastMs,20);
 assert.equal(state['geo/draw'].cpu.samples,1);assert.equal(state['geo/draw'].cpu.lastMs,20);
 assert.equal(state.geo.gpu.samples,0);assert.equal(f.reads().resultReads,0);
 f.available();f.advance(50);state=f.profile.snapshot();
 assert.equal(state.geo.gpu.samples,1);assert.equal(state.geo.gpu.lastMs,40);
 assert.equal(state['geo/main'].gpu.lastMs,40);assert.equal(f.timers.size,0);
 f.profile.snapshot();assert.equal(state.geo.gpu.samples,1);f.profile.dispose();
});

test('all targets and repeated main passes sum exactly once at end',()=>{
 const f=fixture();f.profile.begin('light');
 f.renderer.render({gpu:2});f.renderer.setRenderTarget(target);f.renderer.render({gpu:3});
 f.renderer.setRenderTarget(null);f.renderer.render({gpu:4});f.profile.end();
 assert.equal(f.queries.length,3);f.available();const state=f.profile.snapshot();
 assert.equal(state.light.gpu.samples,1);assert.equal(state.light.gpu.lastMs,9);
 assert.equal(state['light/main'].gpu.samples,1);assert.equal(state['light/main'].gpu.lastMs,6);
 assert.equal(state['light/target-256x256-1016'].gpu.lastMs,3);f.profile.dispose();
});

test('preparation and out-of-frame draws are excluded without losing later visible draws',()=>{
 const f=fixture();f.renderer.render({gpu:500});assert.equal(f.queries.length,0);
 f.profile.begin('material');f.renderer.render({cpu:2,gpu:2});
 f.renderer.render({userData:{preparingBuffers:true},execute(renderer,work){renderer.setRenderTarget(target);work(100,100);renderer.render({gpu:500});renderer.setRenderTarget(null);}});
 f.renderer.render({cpu:3,gpu:3});f.profile.end();f.available();const state=f.profile.snapshot();
 assert.equal(state.material.gpu.lastMs,5);assert.equal(state['material/draw'].cpu.lastMs,5);
 assert.equal(state.material.gpu.samples,1);assert.equal(f.queries.length,2);f.profile.dispose();
});

test('end(false) and idle reuse never inject fake zero GPU samples',()=>{
 const f=fixture();f.profile.begin('scenes');f.renderer.render({gpu:8});f.profile.end();f.available();
 assert.equal(f.profile.snapshot().scenes.gpu.lastMs,8);
 f.profile.begin('scenes');f.profile.end(false);
 f.profile.begin('scenes');f.renderer.render({gpu:3});f.profile.end(false);f.available();f.advance(50);
 const state=f.profile.snapshot();assert.equal(state.scenes.gpu.samples,1);assert.equal(state.scenes.gpu.lastMs,8);
 assert.equal(state.pendingQueries,0);assert.equal(f.timers.size,0);f.profile.dispose();
});

test('a disjoint result invalidates the entire frame, including already collected passes',()=>{
 const f=fixture();f.profile.begin('elements');f.renderer.render({});f.renderer.setRenderTarget(target);f.renderer.render({});f.profile.end();
 f.queries[0].available=true;f.profile.snapshot();assert.equal(f.reads().resultReads,1);
 f.setDisjoint(true);f.advance(50);let state=f.profile.snapshot();
 assert.equal(state.elements.gpu.samples,0);assert.equal(state.discardedGpuFrames,1);assert.equal(state.disjointEvents,1);
 assert.equal(state.pendingQueries,0);assert.equal(f.timers.size,0);
 f.setDisjoint(false);f.profile.begin('elements');f.renderer.render({gpu:7});f.profile.end();f.available();f.advance(50);
 state=f.profile.snapshot();assert.equal(state.elements.gpu.lastMs,7);f.profile.dispose();
});

test('pending storage and idle draining are bounded and never read unavailable results',()=>{
 const f=fixture();
 for(let i=0;i<100;i++){f.profile.begin('combat');f.renderer.render({});f.profile.end();}
 assert.equal(f.queries.length,64);assert.equal(f.profile.snapshot().pendingQueries,64);
 assert.equal(f.profile.snapshot().skippedGpuFrames,36,'capacity pressure is reported, never sampled as zero');
 assert.equal(f.reads().resultReads,0);assert.equal(f.timers.size,1);
 const before=f.reads().availabilityReads;for(let i=0;i<20;i++)f.profile.snapshot();
 assert.equal(f.reads().availabilityReads,before,'repeated snapshots must not repeatedly poll the same frame');
 f.advance(10001);const state=f.profile.snapshot();
 assert.equal(state.pendingQueries,0);assert.equal(state.combat.gpu.samples,0);
 assert.equal(f.timers.size,0);assert.equal(f.reads().resultReads,0);f.profile.dispose();
});

test('foreign queries are left alone and disposal restores only owned wrappers',()=>{
 const f=fixture(),foreign={};f.setForeignQuery(foreign);f.profile.begin('song');f.renderer.render({});f.profile.end();
 assert.equal(f.queries.length,0);assert.equal(f.active(),foreign);
 f.setForeignQuery(null);f.profile.begin('song');f.renderer.render({});f.profile.end();
 f.profile.dispose();assert.equal(f.renderer.render,f.originalRender);assert.equal(f.renderer.setRenderTarget,f.originalTarget);
 assert.equal(f.active(),null);assert.equal(f.timers.size,0);assert.ok(f.queries.every(query=>query.deleted));f.profile.dispose();
 const other=fixture(),newerRender=function(){};other.renderer.render=newerRender;other.profile.dispose();
 assert.equal(other.renderer.render,newerRender,'later instrumentation must not be overwritten');
});

test('render failures and unmatched begins cannot publish partial frames or nest timers',()=>{
 const f=fixture();f.profile.begin('geo');assert.throws(()=>f.renderer.render({fail:true}),/synthetic/);f.profile.end();f.available();
 assert.equal(f.profile.snapshot().geo.gpu.samples,0);
 f.profile.begin('geo');f.renderer.render({gpu:100});f.profile.begin('light');f.renderer.render({gpu:3});f.profile.end();
 f.available();f.advance(50);const state=f.profile.snapshot();assert.equal(state.geo.gpu.samples,0);assert.equal(state.light.gpu.lastMs,3);
 assert.equal(f.active(),null);f.profile.dispose();
});

test('CPU frame and draw summaries still work when the GPU timer extension is absent',()=>{
 const f=fixture({extension:false});f.profile.begin('geo');f.work(2,0);f.renderer.render({cpu:3});f.renderer.render({cpu:4});f.profile.end();
 const state=f.profile.snapshot();assert.equal(state.gpuTimerAvailable,false);assert.equal(state.geo.cpu.lastMs,9);
 assert.equal(state['geo/draw'].cpu.lastMs,7);assert.equal(state.geo.gpu.samples,0);assert.equal(f.timers.size,0);f.profile.dispose();
});

test('nested visible renders do not double-count CPU or GPU work',()=>{
 const f=fixture();f.profile.begin('light');
 f.renderer.render({execute(renderer,work){work(1,1);renderer.render({cpu:2,gpu:2});work(3,3);}});
 f.profile.end();f.available();const state=f.profile.snapshot();
 assert.equal(state.light.cpu.lastMs,6);assert.equal(state['light/draw'].cpu.lastMs,6);
 assert.equal(state.light.gpu.lastMs,6);assert.equal(f.queries.length,1);f.profile.dispose();
});

test('context loss rejects pending results and mid-frame disposal preserves the caller target',()=>{
 const f=fixture();f.profile.begin('elements');f.renderer.render({});f.profile.end();f.setLost(true);
 const state=f.profile.snapshot();assert.equal(state.elements.gpu.samples,0);assert.equal(state.pendingQueries,0);
 assert.equal(f.timers.size,0);f.profile.dispose();
 const live=fixture();live.renderer.setRenderTarget(target);live.profile.begin('material');live.renderer.render({});
 live.profile.dispose();assert.equal(live.active(),null);assert.equal(live.target(),target);
 assert.equal(live.timers.size,0);assert.ok(live.queries.every(query=>query.deleted));
});

test('late query availability cannot make lastMs refer to an older presentation frame',()=>{
 const f=fixture();f.profile.begin('geo');f.renderer.render({gpu:3});f.profile.end();
 f.profile.begin('geo');f.renderer.render({gpu:8});f.profile.end();f.queries[1].available=true;f.advance(50);
 assert.equal(f.profile.snapshot().geo.gpu.lastMs,8);
 f.queries[0].available=true;f.advance(50);const state=f.profile.snapshot();
 assert.equal(state.geo.gpu.samples,2);assert.equal(state.geo.gpu.lastMs,8);assert.equal(state['geo/main'].gpu.lastMs,8);
 f.profile.dispose();
});
