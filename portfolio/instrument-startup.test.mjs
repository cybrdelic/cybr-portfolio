import test from 'node:test';
import assert from 'node:assert/strict';
import {collectStartupTextures,prepareStartupTextures,createStartupProfiler} from './instrument-startup.mjs';

const texture=name=>({isTexture:true,name,image:{width:1024,height:1024}});
test('startup preparation finds original material and compiled uniform textures once, without touching video or render targets',()=>{
  const color=texture('color'),normal=texture('normal'),video={...texture('video'),isVideoTexture:true},target={...texture('target'),isRenderTargetTexture:true},framebuffer={...texture('framebuffer'),isFramebufferTexture:true};
  const nested={value:normal};nested.circular=nested;
  const material={map:color,userData:{shader:{uniforms:{normal:nested,color:{value:color},target:{value:target},video:{value:video},framebuffer:{value:framebuffer}}}}};
  const before=[material.map,material.userData.shader.uniforms.normal.value];
  assert.deepEqual(collectStartupTextures([material,material,{normalMap:normal}]),[color,normal]);
  assert.deepEqual([material.map,material.userData.shader.uniforms.normal.value],before);
  assert.equal(collectStartupTextures([{map:{isTexture:true,image:null}}]).length,0);
});
test('a completed upload budget yields before the next original texture and reports slow atomic uploads honestly',async()=>{
  const a=texture('a'),b=texture('b'),c=texture('c'),order=[];let now=0;
  const result=await prepareStartupTextures({renderer:{initTexture(t){order.push(t.name);now+=t===b?11:3;}},materials:[{map:a,normalMap:b,roughnessMap:c}],clock:()=>now,yieldTask:async()=>{order.push('yield');now+=2;},budgetMs:4});
  assert.deepEqual(order,['a','b','yield','c']);assert.equal(result.textures,3);assert.equal(result.yields,1);assert.equal(result.maxUploadMs,11);assert.equal(result.elapsedMs,19);
  assert.deepEqual(result.records.map(r=>r.durationMs),[3,11,3]);
});
test('a rejected upload stops the queue and a cancelled continuation initializes no further resources',async()=>{
  const a=texture('a'),b=texture('b');let calls=0;
  await assert.rejects(prepareStartupTextures({renderer:{initTexture(){calls++;throw Error('upload failure');}},materials:[{map:a,normalMap:b}]}),/upload failure/);assert.equal(calls,1);
  calls=0;let cancelled=false,now=0;
  await assert.rejects(prepareStartupTextures({renderer:{initTexture(){calls++;now+=4;}},materials:[{map:a,normalMap:b}],clock:()=>now,yieldTask:async()=>{cancelled=true;},cancelled:()=>cancelled}),/cancelled/);assert.equal(calls,1);
});
test('invalid preparation cannot begin and an empty queue allocates no GPU resource',async()=>{
  let calls=0;const renderer={initTexture(){calls++;}};
  await assert.rejects(prepareStartupTextures({renderer,materials:[],budgetMs:0}),/Invalid/);
  const result=await prepareStartupTextures({renderer,materials:[]});assert.equal(result.textures,0);assert.equal(calls,0);
});
test('first-frame diagnostics preserve nested return values and failures with inclusive timings',()=>{
  let now=10;const profile=createStartupProfiler({clock:()=>now});
  assert.equal(profile.run('drawScene',()=>{now+=1;const value=profile.run('opaqueHDR',()=>{now+=8;return 17;});now+=2;return value;}),17);
  assert.throws(()=>profile.run('waterHDR',()=>{now+=3;throw Error('draw failed');}),/draw failed/);
  const snapshot=profile.snapshot();assert.deepEqual(snapshot.blocks.map(b=>[b.name,b.durationMs,b.success]),[['opaqueHDR',8,true],['drawScene',11,true],['waterHDR',3,false]]);
  snapshot.blocks[0].name='changed';assert.equal(profile.snapshot().blocks[0].name,'opaqueHDR');
});
