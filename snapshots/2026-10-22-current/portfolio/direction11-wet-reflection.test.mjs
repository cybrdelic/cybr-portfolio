import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {createWetReflection} from './direction11-wet-reflection.mjs';

function fixture(){
 const scene=new T.Scene(),root=new T.Group(),geometry=new T.BoxGeometry(),material=new T.MeshBasicMaterial();
 const floor=new T.Mesh(geometry,material),terrace=new T.Mesh(geometry,material),wall=new T.Mesh(geometry,material);
 floor.castShadow=true;
 terrace.visible=false;root.add(floor,terrace,wall);scene.add(root);
 root.userData.wetness={value:1};
 const set={root,reflectionReceivers:[floor,terrace],reflectionHeight:-3.35};
 const source=new T.PerspectiveCamera(40,1.6,.1,100);source.position.set(2,4,8);source.lookAt(0,-2,0);
 const previousTarget={name:'previous target'},clip=[new T.Plane(new T.Vector3(1,0,0),10)];
 let activeTarget=previousTarget,face=2,mip=1,alpha=.45,scissorTest=true;
 const color=new T.Color(.2,.3,.4),viewport=new T.Vector4(3,4,500,300),scissor=new T.Vector4(5,6,400,200);
 let draws=0,shadowDraws=0,onRender=()=>{};
 const renderer={
  clippingPlanes:clip,localClippingEnabled:true,shadowMap:{enabled:true,autoUpdate:false,needsUpdate:true},
  getRenderTarget:()=>activeTarget,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
  setRenderTarget(t,f=0,m=0){activeTarget=t;face=f;mip=m;},
  getClearColor:target=>target.copy(color),getClearAlpha:()=>alpha,
  setClearColor(c,a){color.copy(c);alpha=a;},
  getViewport:target=>target.copy(viewport),setViewport:v=>viewport.copy(v),
  getScissor:target=>target.copy(scissor),setScissor:(v,...args)=>v?.isVector4?scissor.copy(v):scissor.set(v,...args),
  getScissorTest:()=>scissorTest,setScissorTest:value=>{scissorTest=value;},clear(){},
  render(s,c){draws++;onRender(s,c);if(this.shadowMap.needsUpdate){shadowDraws++;this.shadowMap.needsUpdate=false;}}
 };
 const snapshot=()=>({target:activeTarget,face,mip,alpha,color:color.toArray(),viewport:viewport.toArray(),scissor:scissor.toArray(),scissorTest,clipping:renderer.clippingPlanes,localClipping:renderer.localClippingEnabled});
 return {renderer,scene,set,source,floor,terrace,wall,clip,snapshot,
  counts:()=>({draws,shadowDraws}),onRender:fn=>{onRender=fn;},
  dispose(){geometry.dispose();material.dispose();}
 };
}

test('reflection keeps walls and receiver shadow casters, clips below floor, and consumes current shadows once',()=>{
 const f=fixture(),before=f.snapshot(),reflection=createWetReflection(f.renderer,f.scene,f.set);
 const originalMaterial=f.floor.material;
 f.onRender((scene,camera)=>{
  assert.equal(scene,f.scene);assert.equal(f.floor.visible,true);assert.equal(f.terrace.visible,false);assert.equal(f.wall.visible,true);
  assert.equal(f.floor.castShadow,true,'receiver must remain in shared shadow traversal');
  assert.equal(f.floor.material.colorWrite,false);assert.equal(f.floor.material.depthWrite,false);
  assert.equal(f.wall.material,originalMaterial,'other meshes sharing the source material remain normal');
  assert.equal(f.renderer.shadowMap.needsUpdate,true,'use current-pose shadows, not stale ones');
  assert.equal(f.renderer.clippingPlanes[0],f.clip[0]);
  const plane=f.renderer.clippingPlanes[1];
  assert.ok(plane.distanceToPoint(new T.Vector3(0,-3.3,0))>0);
  assert.ok(plane.distanceToPoint(new T.Vector3(0,-3.4,0))<0);
  assert.ok(Math.abs(camera.position.y-(-10.7))<1e-12);
  assert.equal(f.set.root.userData.wetReflection.texture.value,null,'never sample the target while writing it');
  assert.equal(f.set.root.userData.wetReflection.ready.value,0);
 });
 reflection.update(f.source,.5);
 assert.deepEqual(f.snapshot(),before,'restore target face/mip, viewport, scissor, clipping, and clear state');
 assert.equal(f.floor.visible,true);assert.equal(f.terrace.visible,false);assert.equal(f.wall.visible,true);
 assert.equal(f.floor.material,originalMaterial);
 assert.equal(f.renderer.shadowMap.needsUpdate,false);
 assert.equal(f.set.root.userData.wetReflection.ready.value,1);
 assert.deepEqual(f.counts(),{draws:1,shadowDraws:1});
 reflection.update(f.source,.5);assert.deepEqual(f.counts(),{draws:1,shadowDraws:1},'stationary frame must reuse reflection');
 reflection.dispose();f.dispose();
});

test('source arrivals and pending shadows invalidate a stationary reflection without extra idle passes',()=>{
 const f=fixture(),reflection=createWetReflection(f.renderer,f.scene,f.set);
 reflection.update(f.source,.5);
 reflection.invalidate();reflection.update(f.source,.5);
 assert.deepEqual(f.counts(),{draws:2,shadowDraws:1});
 f.renderer.shadowMap.needsUpdate=true;reflection.update(f.source,.5);
 assert.deepEqual(f.counts(),{draws:3,shadowDraws:2});
 reflection.update(f.source,.5);assert.equal(f.counts().draws,3);
 f.set.root.userData.wetness.value=0;reflection.invalidate();reflection.update(f.source,.6);
 assert.equal(f.counts().draws,3);
 reflection.dispose();f.dispose();
});

test('a failed reflected draw restores visibility, clipping, target state, and pending shadow work',()=>{
 const f=fixture(),before=f.snapshot(),reflection=createWetReflection(f.renderer,f.scene,f.set);
 const originalMaterial=f.floor.material;
 f.onRender(()=>{f.renderer.shadowMap.needsUpdate=false;throw new Error('draw failed');});
 assert.throws(()=>reflection.update(f.source,.5),/draw failed/);
 assert.deepEqual(f.snapshot(),before);assert.equal(f.renderer.shadowMap.needsUpdate,true);
 assert.equal(f.floor.visible,true);assert.equal(f.terrace.visible,false);assert.equal(f.wall.visible,true);
 assert.equal(f.floor.material,originalMaterial);
 assert.equal(f.set.root.userData.wetReflection.ready.value,0);
 assert.ok(f.set.root.userData.wetReflection.texture.value?.isTexture);
 f.onRender(()=>{});reflection.update(f.source,.5);
 assert.equal(f.set.root.userData.wetReflection.ready.value,1);
 reflection.dispose();reflection.dispose();f.dispose();
});

test('receiver masks preserve the source shadow silhouette and local clipping settings',()=>{
 const f=fixture(),material=f.floor.material;
 material.side=T.DoubleSide;material.shadowSide=T.FrontSide;material.alphaTest=.4;
 material.alphaMap=new T.Texture();material.map=new T.Texture();material.displacementMap=new T.Texture();
 material.displacementScale=.2;material.displacementBias=-.1;
 material.clippingPlanes=[new T.Plane(new T.Vector3(0,0,1),2)];material.clipShadows=true;material.clipIntersection=true;
 const reflection=createWetReflection(f.renderer,f.scene,f.set);
 f.onRender(()=>{
  const mask=f.floor.material;
  for(const key of ['side','shadowSide','alphaTest','alphaMap','map','displacementMap','displacementScale','displacementBias','clippingPlanes','clipShadows','clipIntersection'])assert.equal(mask[key],material[key],key);
  assert.equal(mask.visible,true);assert.equal(f.floor.visible,true);assert.equal(f.floor.castShadow,true);
 });
 reflection.update(f.source,.5);assert.equal(f.floor.material,material);
 reflection.dispose();material.map.dispose();material.alphaMap.dispose();material.displacementMap.dispose();f.dispose();
});

test('preparation warms the actual mirror identity without consuming shadows or publishing partial pixels',()=>{
 const f=fixture(),before=f.snapshot(),reflection=createWetReflection(f.renderer,f.scene,f.set);
 let cameraIdentity,targetIdentity;
 f.onRender((scene,camera)=>{
  assert.equal(scene,f.scene);cameraIdentity=camera;targetIdentity=f.renderer.getRenderTarget();
  assert.equal(scene.userData.preparingBuffers,true);assert.equal(f.renderer.shadowMap.autoUpdate,false);assert.equal(f.renderer.shadowMap.needsUpdate,false);
  assert.deepEqual(f.snapshot().scissor,[0,0,1,1]);assert.equal(f.renderer.getScissorTest(),true);
  assert.equal(f.renderer.clippingPlanes.length,2);assert.equal(f.floor.material.colorWrite,false);
 });
 reflection.prepare(f.source,.5);
 assert.deepEqual(f.snapshot(),before);assert.equal(f.renderer.shadowMap.needsUpdate,true);
 assert.equal(f.set.root.userData.wetReflection.ready.value,0);assert.equal(Object.hasOwn(f.scene.userData,'preparingBuffers'),false);
 f.onRender((scene,camera)=>{assert.equal(camera,cameraIdentity);assert.equal(f.renderer.getRenderTarget(),targetIdentity);assert.equal(f.renderer.shadowMap.needsUpdate,true);});
 reflection.update(f.source,.5);assert.deepEqual(f.counts(),{draws:2,shadowDraws:1});
 assert.equal(f.set.root.userData.wetReflection.ready.value,1);
 f.onRender(()=>{throw Error('warm failed');});
 assert.throws(()=>reflection.prepare(f.source,.5),/warm failed/);assert.deepEqual(f.snapshot(),before);
 assert.equal(f.set.root.userData.wetReflection.ready.value,0,'failed partial warm-up must invalidate previously ready reflection');
 reflection.dispose();f.dispose();
});
