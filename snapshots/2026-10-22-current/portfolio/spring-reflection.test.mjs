import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {createSpringReflection} from './spring-reflection.mjs';

function fixture(){
 const scene=new T.Scene(),root=new T.Group();scene.add(root);
 const geometry=new T.PlaneGeometry(),material=new T.MeshPhysicalMaterial();
 const water=new T.Mesh(geometry,material);material.userData.springPool=0;water.castShadow=true;root.add(water);
 const otherPool=new T.Mesh(geometry,material.clone());otherPool.material.userData.springPool=1;otherPool.visible=false;root.add(otherPool);
 const shared=new T.Mesh(geometry,material);scene.add(shared);
 const source=new T.PerspectiveCamera(45,1,.1,100);source.position.set(0,3,8);source.lookAt(0,0,0);
 const originalTarget={name:'original'},clip=[new T.Plane(new T.Vector3(1,0,0),8)];
 let activeTarget=originalTarget,face=2,mip=1,scissorTest=true,draws=0,shadowDraws=0;
 const viewport=new T.Vector4(2,3,1000,900),scissor=new T.Vector4(4,5,600,500);
 const sun={shadow:{map:null}};
 let onShadow=()=>{},onDraw=()=>{};
 const renderer={
  clippingPlanes:clip,localClippingEnabled:true,shadowMap:{enabled:true,autoUpdate:false,needsUpdate:true},
  getRenderTarget:()=>activeTarget,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
  setRenderTarget(t,f=0,m=0){activeTarget=t;face=f;mip=m;},
  getViewport:v=>v.copy(viewport),setViewport:v=>viewport.copy(v),
  getScissor:v=>v.copy(scissor),setScissor:(v,...args)=>v?.isVector4?scissor.copy(v):scissor.set(v,...args),
  getScissorTest:()=>scissorTest,setScissorTest:v=>{scissorTest=v;},clear(){},
  render(s,c){
   if(this.shadowMap.needsUpdate){onShadow();sun.shadow.map??={allocated:true};shadowDraws++;this.shadowMap.needsUpdate=false;}
   draws++;onDraw(s,c);
  }
 };
 const snapshot=()=>({target:activeTarget,face,mip,viewport:viewport.toArray(),scissor:scissor.toArray(),scissorTest,clipping:renderer.clippingPlanes,localClipping:renderer.localClippingEnabled});
 const reflection=createSpringReflection(renderer,scene,root);
 const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <opaque_fragment>'};
 material.onBeforeCompile(shader);
 return {renderer,scene,root,water,otherPool,shared,source,material,sun,clip,reflection,uniforms:shader.uniforms,snapshot,
  counts:()=>({draws,shadowDraws}),onDraw:fn=>{onDraw=fn;},onShadow:fn=>{onShadow=fn;},
  dispose(){reflection.dispose();geometry.dispose();material.dispose();otherPool.material.dispose();}
 };
}

test('first pool reflection allocates current sun shadows before drawing and restores renderer state',()=>{
 const f=fixture(),before=f.snapshot();
 f.onShadow(()=>{
  assert.equal(f.sun.shadow.map,null,'exercise the first outdoor shadow allocation');
  assert.equal(f.water.visible,true);assert.equal(f.water.castShadow,true);
  assert.equal(f.water.material.colorWrite,false);assert.equal(f.water.material.depthWrite,false);
 });
 f.onDraw((scene,camera)=>{
  assert.equal(scene,f.scene);assert.ok(f.sun.shadow.map,'reflected beauty uses the newly allocated shadow map');
  assert.equal(f.shared.material,f.material,'sharing a shader does not mask unrelated meshes');
  assert.equal(f.otherPool.visible,false);
  assert.equal(f.uniforms.springReflection.value,null,'avoid reading the reflection texture while writing it');
  assert.equal(f.uniforms.springReady.value,0);
  assert.equal(f.renderer.clippingPlanes[0],f.clip[0]);
  const plane=f.renderer.clippingPlanes[1];
  assert.ok(plane.distanceToPoint(new T.Vector3(0,.1,0))>0);
  assert.ok(plane.distanceToPoint(new T.Vector3(0,0,0))<0);
  assert.ok(Math.abs(camera.position.y-(-2.89))<1e-12);
  const target=f.renderer.getRenderTarget();assert.equal(target.width,768);assert.equal(target.height,768);assert.equal(target.texture.type,T.HalfFloatType);
 });
 f.reflection.update(f.source);
 assert.deepEqual(f.snapshot(),before);
 assert.equal(f.water.material,f.material);assert.equal(f.water.visible,true);
 assert.equal(f.renderer.shadowMap.needsUpdate,false,'beauty reuses consumed shadows instead of updating them twice');
 assert.equal(f.uniforms.springReady.value,1);assert.ok(f.uniforms.springReflection.value.isTexture);
 f.reflection.update(f.source);
 assert.deepEqual(f.counts(),{draws:1,shadowDraws:1},'no extra reflection or shadow pass for a stationary frame');
 f.dispose();
});

test('source arrivals, pending shadows, and root pose changes invalidate a stationary reflection',()=>{
 const f=fixture();f.reflection.update(f.source);
 f.reflection.invalidate();assert.equal(f.uniforms.springReady.value,0);
 f.reflection.update(f.source);assert.deepEqual(f.counts(),{draws:2,shadowDraws:1});
 f.renderer.shadowMap.needsUpdate=true;f.reflection.update(f.source);
 assert.deepEqual(f.counts(),{draws:3,shadowDraws:2});
 f.root.position.y=2;f.reflection.update(f.source);assert.equal(f.counts().draws,4);
 f.scene.environment=new T.Texture();f.reflection.update(f.source);assert.equal(f.counts().draws,5);
 f.reflection.update(f.source);assert.equal(f.counts().draws,5);
 f.scene.environment.dispose();f.dispose();
});

test('a failed reflection restores materials, clipping, projection, and pending shadow work',()=>{
 const f=fixture();f.reflection.update(f.source);
 const before=f.snapshot(),projection=f.uniforms.springProjection.value.clone();
 f.source.position.x=2;f.renderer.shadowMap.needsUpdate=true;
 f.onDraw(()=>{throw Error('test render failure');});
 assert.throws(()=>f.reflection.update(f.source),/test render failure/);
 assert.deepEqual(f.snapshot(),before);assert.equal(f.water.material,f.material);
 assert.equal(f.water.visible,true);assert.equal(f.otherPool.visible,false);
 assert.equal(f.renderer.shadowMap.needsUpdate,true,'retry shadows if a draw did not complete');
 assert.equal(f.uniforms.springReady.value,1);assert.ok(f.uniforms.springReflection.value.isTexture);
 assert.deepEqual(f.uniforms.springProjection.value.elements,projection.elements);
 f.onDraw(()=>{});f.reflection.update(f.source);assert.equal(f.renderer.shadowMap.needsUpdate,false);
 f.dispose();f.reflection.dispose();
 const draws=f.counts().draws;f.reflection.update(f.source);assert.equal(f.counts().draws,draws);
});

test('receiver masks preserve alpha, displacement, and local shadow-clipping silhouettes',()=>{
 const f=fixture(),material=f.material;
 material.side=T.DoubleSide;material.shadowSide=T.FrontSide;material.alphaTest=.4;
 material.map=new T.Texture();material.alphaMap=new T.Texture();material.displacementMap=new T.Texture();
 material.displacementScale=.2;material.displacementBias=-.1;
 material.clippingPlanes=[new T.Plane(new T.Vector3(0,0,1),2)];material.clipShadows=true;material.clipIntersection=true;
 f.onShadow(()=>{
  const mask=f.water.material;
  for(const key of ['side','shadowSide','alphaTest','map','alphaMap','displacementMap','displacementScale','displacementBias','clippingPlanes','clipShadows','clipIntersection'])assert.equal(mask[key],material[key],key);
  assert.equal(mask.visible,true);assert.equal(f.water.visible,true);assert.equal(f.water.castShadow,true);
 });
 f.reflection.update(f.source);assert.equal(f.water.material,material);
 material.map.dispose();material.alphaMap.dispose();material.displacementMap.dispose();f.dispose();
});

test('missing primary pool keeps the existing optional-reflection API',()=>{
 assert.equal(createSpringReflection({},new T.Scene(),new T.Group()),null);
});

test('pool preparation retains actual scene/camera/target identity and never caches its one-pixel image',()=>{
 const f=fixture(),before=f.snapshot();let cameraIdentity,targetIdentity;
 f.onDraw((scene,camera)=>{
  assert.equal(scene,f.scene);cameraIdentity=camera;targetIdentity=f.renderer.getRenderTarget();
  assert.equal(scene.userData.preparingBuffers,true);assert.equal(f.renderer.shadowMap.autoUpdate,false);assert.equal(f.renderer.shadowMap.needsUpdate,false);
  assert.deepEqual(f.snapshot().scissor,[0,0,1,1]);assert.equal(f.renderer.getScissorTest(),true);
  assert.equal(f.renderer.clippingPlanes.length,2);assert.equal(f.water.material.colorWrite,false);
 });
 f.reflection.prepare(f.source);assert.deepEqual(f.snapshot(),before);assert.equal(f.renderer.shadowMap.needsUpdate,true);
 assert.equal(f.uniforms.springReady.value,0);assert.equal(Object.hasOwn(f.scene.userData,'preparingBuffers'),false);
 f.onDraw((scene,camera)=>{assert.equal(camera,cameraIdentity);assert.equal(f.renderer.getRenderTarget(),targetIdentity);});
 f.reflection.update(f.source);assert.deepEqual(f.counts(),{draws:2,shadowDraws:1});assert.equal(f.uniforms.springReady.value,1);
 f.onDraw(()=>{throw Error('warm failed');});assert.throws(()=>f.reflection.prepare(f.source),/warm failed/);
 assert.deepEqual(f.snapshot(),before);assert.equal(f.uniforms.springReady.value,0);f.dispose();
});
