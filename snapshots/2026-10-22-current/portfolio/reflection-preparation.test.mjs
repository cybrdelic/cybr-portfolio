import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {withReflectionPreparation} from './reflection-preparation.mjs';

function fixture(){
 const scene=new T.Scene(),geometry=new T.BoxGeometry(),material=new T.MeshPhysicalMaterial({transmission:1}),object=new T.InstancedMesh(geometry,material,48);
 geometry.setDrawRange(3,24);scene.add(object);
 const initial={name:'original'},reflection=new T.WebGLRenderTarget(768,768,{type:T.HalfFloatType}),transmission=new T.WebGLRenderTarget(768,768,{type:T.HalfFloatType,samples:4});
 let active=initial,face=2,mip=1,test=false;const viewport=new T.Vector4(3,4,800,600),scissor=new T.Vector4(10,20,600,500),draws=[];
 const renderer={shadowMap:{enabled:true,autoUpdate:true,needsUpdate:true},getPixelRatio:()=>2,
  getRenderTarget:()=>active,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
  setRenderTarget(target,f=0,m=0){active=target;face=f;mip=m;if(target?.scissor){viewport.set(0,0,target.width,target.height);scissor.copy(target.scissor);test=target.scissorTest;}},
  getViewport:v=>v.copy(viewport),setViewport:v=>viewport.copy(v),
  getScissor:v=>v.copy(scissor),setScissor(v,...rest){v?.isVector4?scissor.copy(v):scissor.set(v,...rest);},getScissorTest:()=>test,setScissorTest:v=>{test=v;},
  renderBufferDirect(camera,scene,g,m,o,group){draws.push({target:active,range:{...g.drawRange},count:o.count,scissor:scissor.toArray(),test,group});}
 };
 const snapshot=()=>({target:active,face,mip,viewport:viewport.toArray(),scissor:scissor.toArray(),test,shadow:{...renderer.shadowMap},range:{...geometry.drawRange},count:object.count,preparing:scene.userData.preparingBuffers});
 return {scene,geometry,material,object,renderer,reflection,transmission,draws,snapshot,dispose(){geometry.dispose();material.dispose();reflection.dispose();transmission.dispose();}};
}

test('warm draw preserves full target allocations and exact variants while bounding primitive and instance work',()=>{
 const f=fixture(),before=f.snapshot(),methods=[f.renderer.setRenderTarget,f.renderer.setScissor,f.renderer.setScissorTest,f.renderer.renderBufferDirect];
 const camera=new T.PerspectiveCamera();
 withReflectionPreparation(T,f.renderer,f.scene,()=>{
  assert.equal(f.scene.userData.preparingBuffers,true);assert.equal(f.renderer.shadowMap.enabled,true);
  assert.equal(f.renderer.shadowMap.autoUpdate,false);assert.equal(f.renderer.shadowMap.needsUpdate,false);
  for(const target of [f.reflection,f.transmission,f.reflection]){
   f.renderer.setRenderTarget(target);f.renderer.setScissorTest(false);f.renderer.setScissor(0,0,500,500);
   f.renderer.renderBufferDirect(camera,f.scene,f.geometry,f.material,f.object,{start:12,count:9});
   assert.equal(f.object.count,48);assert.deepEqual(f.geometry.drawRange,{start:3,count:24});
  }
 });
 assert.deepEqual(f.snapshot(),before);assert.deepEqual([f.renderer.setRenderTarget,f.renderer.setScissor,f.renderer.setScissorTest,f.renderer.renderBufferDirect],methods);
 assert.equal(Object.hasOwn(f.scene.userData,'preparingBuffers'),false);
 for(const draw of f.draws){assert.deepEqual(draw.range,{start:12,count:3});assert.equal(draw.count,1);assert.deepEqual(draw.scissor,[0,0,.5,.5]);assert.equal(draw.test,true);}
 assert.equal(f.reflection.width,768);assert.equal(f.transmission.width,768);assert.equal(f.transmission.samples,4);f.dispose();
});

test('draw failures restore geometry, instances, methods, shadow flags, and existing preparation marker',()=>{
 const f=fixture();f.scene.userData.preparingBuffers='outer';
 f.renderer.renderBufferDirect=()=>{throw Error('draw failed');};const direct=f.renderer.renderBufferDirect,before=f.snapshot();
 assert.throws(()=>withReflectionPreparation(T,f.renderer,f.scene,()=>{f.renderer.setRenderTarget(f.reflection);f.renderer.renderBufferDirect(null,f.scene,f.geometry,f.material,f.object,null);}),/draw failed/);
 assert.deepEqual(f.snapshot(),before);assert.equal(f.renderer.renderBufferDirect,direct);f.dispose();
});

test('preparation refuses presentation framebuffer draws',()=>{
 const f=fixture(),before=f.snapshot();
 assert.throws(()=>withReflectionPreparation(T,f.renderer,f.scene,()=>{f.renderer.setRenderTarget(null);f.renderer.renderBufferDirect(null,f.scene,f.geometry,f.material,f.object,null);}),/presentation framebuffer/);
 assert.deepEqual(f.snapshot(),before);assert.equal(f.draws.length,0);f.dispose();
});
