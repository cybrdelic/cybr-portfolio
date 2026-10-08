import test from 'node:test';
import assert from 'node:assert/strict';
import {DepthTexture} from './vendor/three-r180/three.module.min.js';
import {collectStartupTextures,prepareStartupTextures,createStartupProfiler} from './instrument-startup.mjs';

const texture=name=>({isTexture:true,name,image:{width:1024,height:1024}});
test('startup preparation finds original material and compiled uniform textures once, without touching video or render targets',()=>{
  const color=texture('color'),normal=texture('normal'),video={...texture('video'),isVideoTexture:true},target={...texture('target'),isRenderTargetTexture:true},framebuffer={...texture('framebuffer'),isFramebufferTexture:true},depth=new DepthTexture(390,692);
  assert.equal(depth.isRenderTargetTexture,false,'real depth textures do not carry the color render-target marker');
  const nested={value:normal};nested.circular=nested;
  const material={map:color,userData:{shader:{uniforms:{normal:nested,color:{value:color},target:{value:target},depth:{value:depth},video:{value:video},framebuffer:{value:framebuffer}}}}};
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


test('actual mobile startup selects the original warmup by default and retains explicit rollback/renderer variants',async()=>{
  const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('./instrument-3d.js',import.meta.url),'utf8');
  const start=source.indexOf('  if(mobileLayout.matches&&!pathTracer&&!rasterResourcesDisposed&&'),end=source.indexOf("  if(['profile','warmup']",start);
  assert.ok(start>=0&&end>start);
  const execute=new (Object.getPrototypeOf(async function(){}).constructor)('mobileLayout','pathTracer','rasterResourcesDisposed','query','startup','startupPhase','prepareStartupTextures','renderer','objects','cables',source.slice(start,end));
  const material={map:texture('original')},cableMaterial={normalMap:texture('cable')};
  for(const mobile of [false,true])for(const tracing of [false,true])for(const disposed of [false,true])for(const mode of [null,'profile','warmup','off','full','whole','tiles','unknown']){
    const startup={},phases=[],calls=[];
    await execute({matches:mobile},tracing,disposed,new URLSearchParams(mode===null?'':'startup='+mode),startup,(...args)=>phases.push(args),async options=>{calls.push(options);assert.deepEqual(options.materials,[material,cableMaterial]);assert.equal(options.cancelled(),disposed);return {textures:2,maxUploadMs:470};},{},[{material}],[{mesh:{material:cableMaterial}}]);
    const selected=mobile&&!tracing&&!disposed&&[null,'profile','warmup'].includes(mode);
    assert.equal(calls.length,selected?1:0,`${mobile}/${tracing}/${disposed}/${mode}`);
    assert.equal(phases.length,calls.length);assert.equal(startup.fullReadyMs,undefined);assert.equal(startup.gpuFullReadyMs,undefined);
  }
  const startup={},order=[];let release;
  const pending=execute({matches:true},false,false,new URLSearchParams(),startup,(phase)=>order.push(phase),()=>new Promise(resolve=>{release=resolve;}),{},[{material}],[]);
  assert.deepEqual(order,['texture-preparation']);assert.equal(startup.texturePreparation,undefined);assert.equal(startup.fullReadyMs,undefined);
  release({textures:1,maxUploadMs:470});await pending;assert.equal(startup.texturePreparation.maxUploadMs,470);assert.equal(startup.fullReadyMs,undefined);
});

test('actual loading state waits for the existing GPU fence and preserves the ungated compatibility path',async()=>{
  const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('./instrument-3d.js',import.meta.url),'utf8');
  const begin=source.indexOf('    onComplete:job=>{'),end=source.indexOf('    }});',begin);assert.ok(begin>=0&&end>begin);
  const callback=source.slice(begin,end)+'    }';
  const run=new Function('state',`with(state){return ({${callback}}).onComplete;}`);
  let now=200,removals=0;const state={displayedProgress:undefined,fullFrameComplete:false,startup:{started:100},performance:{now:()=>now},stage:{classList:{remove:name=>{assert.equal(name,'mobile-loading');removals++;}}},target:.04,status:{textContent:'Rendering the instrument.'}};
  const complete=run(state);assert.equal(state.fullFrameComplete,false);assert.equal(removals,0);
  complete({progress:.03});assert.equal(state.fullFrameComplete,true);assert.equal(state.startup.fullReadyMs,100);assert.equal(state.startup.gpuFullReadyMs,100);assert.equal(removals,1);assert.equal(state.status.textContent,'Rendering the instrument.');
  now=300;complete({progress:.04});assert.equal(state.status.textContent,'');assert.equal(removals,1);assert.equal(state.startup.gpuFullReadyMs,100);
  const cpuStart=source.indexOf("  stage.classList.add('three-ready');"),cpuEnd=source.indexOf("  document.querySelector('[data-end=",cpuStart);
  const cpu=source.slice(cpuStart,cpuEnd);assert.ok(cpu.includes("if(!renderGate)status.textContent=''"));assert.ok(cpu.includes("if(!renderGate)stage.classList.remove('mobile-loading')"));
  for(const gated of [false,true]){const events=[];const f=new Function('renderGate','stage','status',"stage.classList.add('three-ready');if(!renderGate)status.textContent='';if(!renderGate)stage.classList.remove('mobile-loading');");const status={textContent:'Rendering the instrument.'};f(gated?{}:undefined,{classList:{add:()=>{},remove:name=>events.push(name)}},status);assert.equal(status.textContent,gated?'Rendering the instrument.':'');assert.equal(events.length,gated?0:1);}
});
