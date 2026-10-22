import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {createElementsHDRComposite,ELEMENTS_HDR_FRAGMENT} from './elements-hdr-composite.mjs';

function fixture({throwAt=0,autoReset=true,samples=[4,2],depthSamples=[4,2],floatExtension=true,implicitMSAA=false}={}){
 const sourceScene=new T.Scene(),sourceCamera=new T.Camera(),existingTarget={name:'caller target'};
 let target=existingTarget,face=3,mip=2,viewport=new T.Vector4(11,12,210,180),scissor=new T.Vector4(3,4,99,88),scissorTest=true;
 let colour=new T.Color(.1,.2,.3),alpha=.6;
 const records=[],sizes={width:800,height:600};
 const renderer={capabilities:{maxSamples:8},extensions:{has:name=>name==='EXT_color_buffer_float'?floatExtension:name==='WEBGL_multisampled_render_to_texture'?implicitMSAA:false},
  toneMapping:T.ACESFilmicToneMapping,toneMappingExposure:1.7,outputColorSpace:T.SRGBColorSpace,
  autoClear:true,autoClearColor:false,autoClearDepth:true,autoClearStencil:false,
  info:{autoReset,render:{calls:7,triangles:80,lines:4,points:3},reset(){Object.keys(this.render).forEach(k=>this.render[k]=0);}},
  getContext(){return {RENDERBUFFER:1,RGBA16F:2,DEPTH_COMPONENT24:3,SAMPLES:4,getInternalformatParameter:(buffer,format)=>format===2?samples:depthSamples};},
  getDrawingBufferSize:v=>v.set(sizes.width,sizes.height),getPixelRatio:()=>2,
  getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
  setRenderTarget(t,f=0,m=0){target=t;face=f;mip=m;},
  getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>scissorTest,
  setViewport(...args){viewport=args[0]?.isVector4?args[0].clone():new T.Vector4(...args);},
  setScissor(...args){scissor=args[0]?.isVector4?args[0].clone():new T.Vector4(...args);},
  setScissorTest:value=>{scissorTest=value;},getClearColor:c=>c.copy(colour),getClearAlpha:()=>alpha,
  setClearColor(c,a){colour=c.clone();alpha=a;},
  clear(...flags){records.push({kind:'clear',flags,target,scissorTest,targetScissor:target?.scissor?.toArray()});},
  render(scene,camera){
   const ordinal=records.filter(r=>r.kind==='render').length+1;
   records.push({kind:'render',scene,camera,target,toneMapping:this.toneMapping,exposure:this.toneMappingExposure,
    output:this.outputColorSpace,autoReset:this.info.autoReset,viewport:viewport.toArray(),scissorTest,targetScissor:target?.scissor?.toArray(),visibleChildren:scene.children.map(child=>child.visible)});
   if(ordinal===throwAt)throw new Error(`render failure ${ordinal}`);
   this.info.render.calls+=scene===sourceScene?5:1;this.info.render.triangles+=scene===sourceScene?100:1;
  },
  compile(scene,camera){records.push({kind:'compile',scene,camera,target});if(throwAt===-1)throw new Error('compile failure');},
 };
 const state=()=>({target,face,mip,viewport:viewport.toArray(),scissor:scissor.toArray(),scissorTest,colour:colour.toArray(),alpha,
  tone:renderer.toneMapping,exposure:renderer.toneMappingExposure,output:renderer.outputColorSpace,
  autoClear:renderer.autoClear,autoClearColor:renderer.autoClearColor,autoClearDepth:renderer.autoClearDepth,autoClearStencil:renderer.autoClearStencil,autoReset:renderer.info.autoReset});
 return {renderer,sourceScene,sourceCamera,records,sizes,state};
}

test('stage radiance is combined in HDR before exactly one display transform',()=>{
 const f=fixture(),before=f.state(),composite=createElementsHDRComposite(f.renderer);
 composite.render(f.sourceScene,f.sourceCamera);
 const [stage,display]=f.records.filter(r=>r.kind==='render');
 assert.equal(stage.target,composite.target);assert.equal(stage.toneMapping,T.NoToneMapping);assert.equal(stage.exposure,1);
 assert.equal(stage.output,T.LinearSRGBColorSpace);assert.equal(stage.autoReset,false);
 assert.equal(display.target,null);assert.equal(display.toneMapping,T.ACESFilmicToneMapping);assert.equal(display.exposure,1.7);
 assert.equal(display.output,T.SRGBColorSpace);assert.deepEqual(display.viewport,[0,0,400,300]);
 const displayMaterial=display.scene.children[0].material;
 assert.equal(displayMaterial.toneMapped,true);assert.equal(displayMaterial.transparent,false);assert.equal(displayMaterial.blending,T.NoBlending);
 assert.equal(displayMaterial.uniforms.tLinearStage.value,composite.target.texture);
 assert.equal(composite.target.texture.type,T.HalfFloatType);assert.equal(composite.target.texture.colorSpace,T.LinearSRGBColorSpace);
 assert.equal(composite.stats.scene.calls,5);assert.equal(composite.stats.display.calls,1);assert.equal(composite.stats.total.calls,6);
 assert.equal(f.renderer.info.render.calls,6);assert.deepEqual(f.state(),before);composite.dispose();
});

test('multisampling uses intersection of actual float colour and depth support',()=>{
 const f=fixture({samples:[8,4,2],depthSamples:[8,2]});const c=createElementsHDRComposite(f.renderer);
 assert.equal(c.target.samples,2);assert.equal(c.stats.samples,2);c.dispose();
 const n=fixture({samples:[],depthSamples:[4]});const zero=createElementsHDRComposite(n.renderer);
 assert.equal(zero.target.samples,0);zero.dispose();
});

test('same-size frames reuse target and only drawing-buffer resize reallocates storage',()=>{
 const f=fixture(),c=createElementsHDRComposite(f.renderer),target=c.target,texture=target.texture;
 c.render(f.sourceScene,f.sourceCamera);c.render(f.sourceScene,f.sourceCamera);
 assert.equal(c.stats.resizes,1);assert.equal(c.target,target);assert.equal(c.target.texture,texture);
 f.sizes.width=1000;c.render(f.sourceScene,f.sourceCamera);
 assert.equal(c.stats.resizes,2);assert.equal(c.target.width,1000);assert.equal(c.target.height,600);c.dispose();
});

for(const throwAt of [1,2])test(`all caller renderer state restored after pass ${throwAt} throws`,()=>{
 const f=fixture({throwAt}),before=f.state(),c=createElementsHDRComposite(f.renderer);
 assert.throws(()=>c.render(f.sourceScene,f.sourceCamera),/render failure/);
 assert.deepEqual(f.state(),before);assert.equal(c.stats.frames,0);c.dispose();
});

test('existing accumulated renderer.info stays useful with automatic reset disabled',()=>{
 const f=fixture({autoReset:false}),c=createElementsHDRComposite(f.renderer);
 c.render(f.sourceScene,f.sourceCamera);
 assert.equal(f.renderer.info.render.calls,13);assert.equal(c.stats.total.calls,6);
 assert.equal(f.renderer.info.autoReset,false);c.dispose();
});

test('display preparation restores target and view state even when compilation throws',()=>{
 const f=fixture({throwAt:-1}),before=f.state(),c=createElementsHDRComposite(f.renderer);
 assert.throws(()=>c.prepareDisplay(),/compile failure/);assert.deepEqual(f.state(),before);c.dispose();
});

test('disposal is idempotent and rejects later use',()=>{
 const f=fixture(),c=createElementsHDRComposite(f.renderer);let disposed=0;
 c.target.addEventListener('dispose',()=>disposed++);c.dispose();c.dispose();
 assert.equal(disposed,1);assert.throws(()=>c.render(f.sourceScene,f.sourceCamera),/disposed/);
 assert.throws(()=>c.resize(12,12),/disposed/);
});

test('no silent LDR fallback, and display transformation appears exactly once',()=>{
 assert.throws(()=>createElementsHDRComposite(fixture({floatExtension:false}).renderer),/refusing an LDR quality downgrade/);
 assert.equal((ELEMENTS_HDR_FRAGMENT.match(/tonemapping_fragment/g)||[]).length,1);
 assert.equal((ELEMENTS_HDR_FRAGMENT.match(/colorspace_fragment/g)||[]).length,1);
 assert.doesNotMatch(ELEMENTS_HDR_FRAGMENT,/\.rgb\s*\/|\.rgb\s*\*.*\.a/);
});

test('held overlays preserve the same MSAA target and redraw a guarded previous/current union',()=>{
 const f=fixture(),before=f.state(),c=createElementsHDRComposite(f.renderer),target=c.target;
 c.render(f.sourceScene,f.sourceCamera,{backgroundKey:'held-1',dirtyRect:{x:100,y:200,width:50,height:60}});
 assert.equal(c.stats.redraw.mode,'full');assert.equal(c.target.samples,4);
 c.render(f.sourceScene,f.sourceCamera,{backgroundKey:'held-1',dirtyRect:{x:140,y:180,width:90,height:40}});
 assert.equal(c.stats.redraw.mode,'partial');assert.deepEqual(c.stats.redraw.rect,[98,178,134,84]);
 assert.equal(c.target,target);assert.equal(c.stats.resizes,1);assert.equal(c.stats.partialFrames,1);assert.equal(c.stats.fullFrames,1);
 const clear=f.records.filter(r=>r.kind==='clear').at(-1),renders=f.records.filter(r=>r.kind==='render');
 assert.deepEqual(clear.targetScissor,[98,178,134,84]);assert.deepEqual(clear.flags,[true,true,false]);assert.equal(clear.scissorTest,true);
 assert.equal(renders.at(-2).scene,f.sourceScene,'all opaque and overlay geometry still renders with original depth coverage');
 assert.equal(renders.at(-2).scissorTest,true);assert.equal(renders.at(-1).scissorTest,false,'display always covers the entire frame');
 assert.equal(renders.length,4,'there is no extra copy pass');assert.deepEqual(f.state(),before);c.dispose();
});

test('new keys, resize, invalid projections, missing keys and explicit invalidation force full redraw',()=>{
 const f=fixture(),c=createElementsHDRComposite(f.renderer),options={backgroundKey:'a',dirtyRect:[0,1,100,100]};
 c.render(f.sourceScene,f.sourceCamera,options);c.render(f.sourceScene,f.sourceCamera,options);
 assert.equal(c.stats.redraw.mode,'partial');assert.deepEqual(c.stats.redraw.rect,[0,0,102,103]);
 for(const next of [{...options,backgroundKey:'b'},{...options,dirtyRect:[NaN,1,5,5]},{...options,dirtyRect:[900,0,4,4]},{}]){
  c.render(f.sourceScene,f.sourceCamera,next);assert.equal(c.stats.redraw.mode,'full');
  c.render(f.sourceScene,f.sourceCamera,options);assert.equal(c.stats.redraw.mode,'full');
 }
 c.render(f.sourceScene,f.sourceCamera,options);assert.equal(c.stats.redraw.mode,'partial');
 f.sizes.width=1000;c.render(f.sourceScene,f.sourceCamera,options);assert.equal(c.stats.redraw.mode,'full');
 c.render(f.sourceScene,f.sourceCamera,options);assert.equal(c.stats.redraw.mode,'partial');
 c.invalidate();c.render(f.sourceScene,f.sourceCamera,options);assert.equal(c.stats.redraw.mode,'full');
 c.render(new T.Scene(),f.sourceCamera,options);assert.equal(c.stats.redraw.mode,'full');c.dispose();
});

test('implicit MSAA resolve paths never silently use lossy resolved-cache reconstruction',()=>{
 const f=fixture({implicitMSAA:true}),c=createElementsHDRComposite(f.renderer),options={backgroundKey:'held',dirtyRect:[20,20,50,50]};
 c.render(f.sourceScene,f.sourceCamera,options);c.render(f.sourceScene,f.sourceCamera,options);
 assert.equal(c.target.samples,4);assert.equal(c.stats.retainedSamplesSupported,false);assert.equal(c.stats.redraw.mode,'full');
 assert.equal(c.stats.partialFrames,0);assert.match(c.stats.redraw.reason,/retention unavailable/);c.dispose();
});

test('a failed partial frame invalidates retention and restores scissor/state',()=>{
 const f=fixture({throwAt:3}),before=f.state(),c=createElementsHDRComposite(f.renderer),options={backgroundKey:'held',dirtyRect:[20,20,50,50]};
 c.render(f.sourceScene,f.sourceCamera,options);
 assert.throws(()=>c.render(f.sourceScene,f.sourceCamera,options),/render failure/);
 assert.deepEqual(f.state(),before);assert.equal(c.stats.frames,1);
 c.render(f.sourceScene,f.sourceCamera,options);assert.equal(c.stats.redraw.mode,'full');c.dispose();
});

test('refraction captures linear color and resolved depth into a distinct unchanged-quality target',()=>{
 const f=fixture(),before=f.state(),overlay=new T.Group();f.sourceScene.add(overlay);const c=createElementsHDRComposite(f.renderer);
 c.render(f.sourceScene,f.sourceCamera,{overlay,backgroundKey:'held',dirtyRect:[10,10,50,60]});
 const [opaque,final,display]=f.records.filter(record=>record.kind==='render');
 assert.equal(opaque.target,c.opaqueTarget);assert.notEqual(c.opaqueTarget,c.target);
 assert.equal(c.opaqueTarget.texture.type,T.HalfFloatType);assert.equal(c.opaqueTarget.texture.colorSpace,T.LinearSRGBColorSpace);
 assert.equal(c.opaqueTarget.samples,c.target.samples);assert.equal(c.opaqueTarget.samples,4);assert.equal(c.opaqueTarget.resolveDepthBuffer,true);
 assert.equal(c.opaqueTarget.depthTexture.isDepthTexture,true);assert.equal(c.opaqueTarget.depthTexture.type,T.UnsignedIntType);
 assert.equal(c.opaqueTarget.depthTexture.format,T.DepthFormat);assert.equal(c.opaqueTarget.depthTexture.minFilter,T.NearestFilter);
 assert.equal(opaque.toneMapping,T.NoToneMapping);assert.equal(opaque.exposure,1);assert.deepEqual(opaque.visibleChildren,[false]);
 assert.equal(final.target,c.target);assert.deepEqual(final.visibleChildren,[true]);assert.equal(display.target,null);
 assert.equal(overlay.visible,true);assert.equal(c.stats.opaque.calls,5);assert.equal(c.stats.scene.calls,5);assert.equal(c.stats.total.calls,11);
 assert.equal(c.stats.opaqueCaptures,1);assert.equal(c.stats.opaqueReuses,0);assert.deepEqual(f.state(),before);c.dispose();
});

test('stable opaque backdrop is reused while final MSAA scene still redraws the overlay region',()=>{
 const f=fixture(),overlay=new T.Group();f.sourceScene.add(overlay);const c=createElementsHDRComposite(f.renderer);
 const options={overlay,backgroundKey:'held',dirtyRect:[10,10,50,60]},opaqueTarget=c.opaqueTarget,depth=c.opaqueTarget.depthTexture;
 c.render(f.sourceScene,f.sourceCamera,options);c.render(f.sourceScene,f.sourceCamera,options);
 assert.equal(c.stats.opaqueCaptures,1);assert.equal(c.stats.opaqueReuses,1);assert.equal(c.stats.opaque.calls,0);
 assert.equal(c.stats.redraw.mode,'partial');assert.equal(c.stats.scene.calls,5);assert.equal(c.stats.total.calls,6);
 assert.equal(c.opaqueTarget,opaqueTarget);assert.equal(c.opaqueTarget.depthTexture,depth);
 assert.equal(f.records.filter(r=>r.kind==='render'&&r.target===opaqueTarget).length,1);c.dispose();
});

test('motion, projection, lighting key and dimensions invalidate both background caches',()=>{
 const f=fixture(),overlay=new T.Group();f.sourceScene.add(overlay);const c=createElementsHDRComposite(f.renderer);
 const options={overlay,backgroundKey:'held',dirtyRect:[10,10,50,60]};c.render(f.sourceScene,f.sourceCamera,options);
 for(const change of [()=>{f.sourceCamera.position.x=1;},()=>{f.sourceCamera.projectionMatrix.elements[0]=2;},()=>{options.backgroundKey='lighting-2';},()=>{f.sizes.width=900;},()=>c.invalidate()]){
  const captures=c.stats.opaqueCaptures;change();c.render(f.sourceScene,f.sourceCamera,options);
  assert.equal(c.stats.opaqueCaptures,captures+1);assert.equal(c.stats.redraw.mode,'full');
 }
 const captures=c.stats.opaqueCaptures;c.render(f.sourceScene,f.sourceCamera,{overlay});c.render(f.sourceScene,f.sourceCamera,{overlay});
 assert.equal(c.stats.opaqueCaptures,captures+2,'an absent stable key refreshes the backdrop every frame');
 assert.equal(c.opaqueTarget.width,900);assert.equal(c.target.width,900);c.dispose();
});

test('failed backdrop capture restores visibility and caller state and is not reused',()=>{
 const f=fixture({throwAt:1}),before=f.state(),overlay=new T.Group();f.sourceScene.add(overlay);const c=createElementsHDRComposite(f.renderer);
 const options={overlay,backgroundKey:'held',dirtyRect:[10,10,50,60]};
 assert.throws(()=>c.render(f.sourceScene,f.sourceCamera,options),/render failure/);
 assert.equal(overlay.visible,true);assert.deepEqual(f.state(),before);assert.equal(c.stats.frames,0);
 c.render(f.sourceScene,f.sourceCamera,options);assert.equal(c.stats.opaqueCaptures,1);assert.equal(c.stats.opaqueReuses,0);assert.equal(c.stats.redraw.mode,'full');c.dispose();
});

test('already hidden overlays stay hidden and scene-wide hiding is rejected',()=>{
 const f=fixture(),overlay=new T.Group();overlay.visible=false;f.sourceScene.add(overlay);const c=createElementsHDRComposite(f.renderer);
 c.render(f.sourceScene,f.sourceCamera,{overlay});assert.equal(overlay.visible,false);
 assert.throws(()=>c.render(f.sourceScene,f.sourceCamera,{overlay:f.sourceScene}),/not the entire scene/);c.dispose();
});

test('disposing compositor also disposes its separate opaque render target',()=>{
 const f=fixture(),c=createElementsHDRComposite(f.renderer);let disposed=0;c.opaqueTarget.addEventListener('dispose',()=>disposed++);
 c.dispose();c.dispose();assert.equal(disposed,1);
});
