import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {RASTER_KEY_DIRECTION,boxCorners,shadowBasis,shadowCameraCoordinates,fitRasterShadowBounds,setupRasterLighting} from './instrument-raster-lighting.mjs';

const close=(a,b,tolerance=1e-8)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<tolerance,`${a} != ${b}`));
function covered(boxes,fit){for(const box of boxes)for(const p of boxCorners(box)){const q=shadowCameraCoordinates(p,fit),c=fit.camera;assert.ok(q[0]>=c.left-1e-8&&q[0]<=c.right+1e-8);assert.ok(q[1]>=c.bottom-1e-8&&q[1]<=c.top+1e-8);assert.ok(q[2]>=c.near-1e-8&&q[2]<=c.far+1e-8);}assert.ok(fit.camera.near>0);}
const translate=(boxes,delta)=>boxes.map(b=>({min:b.min.map((v,i)=>v+delta[i]),max:b.max.map((v,i)=>v+delta[i])}));

test('the actual six CYBR cartridges remain inside the Z-up shadow camera through exploded and condensed arrangements',async()=>{
 const manifest=JSON.parse(await readFile(new URL('./assets/instrument-working-v1/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.modules.length,6);
 for(const progress of [0,.15,.5,.85,1]){
  const boxes=manifest.modules.map(m=>{const shift=m.explodedX*(1-progress)+m.assembledX*progress;return{min:m.bounds[0].map((v,i)=>v+(i===0?shift:0)),max:m.bounds[1].map((v,i)=>v+(i===0?shift:0))};});
  const fit=fitRasterShadowBounds(boxes);covered(boxes,fit);assert.deepEqual(fit.camera.up,[0,0,1]);
  assert.ok(fit.basis.v[2]>0);for(const extent of fit.extents)assert.equal(extent%8,0);
 }
});

test('fixed light basis is orthonormal, right handed, and matches Three shadow-camera projection',()=>{
 const boxes=[{min:[-200,-60,-35],max:[360,75,140]}],fit=fitRasterShadowBounds(boxes),b=shadowBasis();
 const dot=(a,c)=>a.reduce((s,v,i)=>s+v*c[i],0);
 close([Math.hypot(...b.u),Math.hypot(...b.v),Math.hypot(...b.w)],[1,1,1]);close([dot(b.u,b.v),dot(b.u,b.w),dot(b.v,b.w)],[0,0,0]);
 const camera=new THREE.OrthographicCamera(fit.camera.left,fit.camera.right,fit.camera.top,fit.camera.bottom,fit.camera.near,fit.camera.far);camera.up.set(0,0,1);camera.position.fromArray(fit.position);camera.lookAt(new THREE.Vector3(...fit.target));camera.updateMatrixWorld();
 for(const p of boxCorners(boxes[0])){const clip=new THREE.Vector3(...p).project(camera);assert.ok(Math.abs(clip.x)<1&&Math.abs(clip.y)<1&&Math.abs(clip.z)<1);const local=new THREE.Vector3(...p).applyMatrix4(camera.matrixWorldInverse);const q=shadowCameraCoordinates(p,fit);close([local.x,local.y,-local.z],q);}
});

test('subtexel motion cannot move a snapped shadow centre; larger motion advances exactly one texel',()=>{
 let boxes=[{min:[-137.13,-32.41,-7.27],max:[213.58,41.33,94.68]}];const first=fitRasterShadowBounds(boxes),middle=boxes[0].min.map((v,i)=>(v+boxes[0].max[i])/2);
 boxes=translate(boxes,first.target.map((v,i)=>v-middle[i]));const aligned=fitRasterShadowBounds(boxes);const delta=aligned.basis.u.map((v,i)=>v*aligned.texelSizeMM[0]*.37+aligned.basis.v[i]*aligned.texelSizeMM[1]*.29);
 const jitter=fitRasterShadowBounds(translate(boxes,delta));close(jitter.target,aligned.target);assert.deepEqual(jitter.extents,aligned.extents);
 const moved=fitRasterShadowBounds(translate(boxes,aligned.basis.u.map(v=>v*aligned.texelSizeMM[0]*.62)));
 close(moved.centerLight,[aligned.centerLight[0]+aligned.texelSizeMM[0],aligned.centerLight[1],aligned.centerLight[2]]);
});

test('shadow texture resolution changes texel density without changing physical coverage or light direction',()=>{
 const boxes=[{min:[-455,-80,-32],max:[470,82,155]}];const a=fitRasterShadowBounds(boxes),b=fitRasterShadowBounds(boxes,{resolution:4096});
 covered(boxes,a);covered(boxes,b);assert.deepEqual(a.extents,b.extents);close(b.texelSizeMM,a.texelSizeMM.map(v=>v/2));close(a.basis.w,b.basis.w);assert.deepEqual(RASTER_KEY_DIRECTION,[-.55,-.72,1.1]);
});

test('opaque hardware and cables cast once per geometry update, optics are excluded even with manual transmission shaders, and disposal restores state',()=>{
 const scene=new THREE.Scene();scene.rotation.z=.2;scene.position.set(7,-11,4);
 const opaque=new THREE.Mesh(new THREE.BoxGeometry(60,20,15),new THREE.MeshPhysicalMaterial({roughness:.24,metalness:.95}));opaque.receiveShadow=true;
 const glass=new THREE.Mesh(new THREE.SphereGeometry(20,12,8),new THREE.MeshPhysicalMaterial({transmission:0,opacity:1}));glass.material.userData.cadTransmission=1;glass.position.x=85;
 const cable=new THREE.Mesh(new THREE.CylinderGeometry(2.35,2.35,45,8),new THREE.MeshPhysicalMaterial({roughness:.35}));cable.position.x=35;
 scene.add(opaque,glass,cable);const renderer={shadowMap:{enabled:false,type:THREE.PCFShadowMap,autoUpdate:true,needsUpdate:false}},originalShadow={...renderer.shadowMap};let scheduled=0;
 const lighting=setupRasterLighting({THREE,renderer,scene,objects:[opaque,glass],cableMeshes:[cable],groups:new Map([['geo',{}]]),schedule:()=>scheduled++});
 const camera=new THREE.PerspectiveCamera(40,1,.05,7000);assert.equal(lighting.update(camera,{progress:0,geometryChanged:false,now:1}),true);
 assert.equal(opaque.castShadow,true);assert.equal(cable.castShadow,true);assert.equal(glass.castShadow,false);assert.equal(glass.receiveShadow,false);
 assert.equal(renderer.shadowMap.autoUpdate,false);assert.equal(renderer.shadowMap.needsUpdate,true);assert.equal(lighting.needsFrame(),true);
 const key=scene.children.find(o=>o.name==='CYBR raster studio key');key.shadow.updateMatrices(key);
 assert.deepEqual(key.shadow.camera.up.toArray(),[0,0,1]);
 for(const mesh of [opaque,glass,cable]){mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);for(const p of boxCorners({min:box.min.toArray(),max:box.max.toArray()})){const clip=new THREE.Vector3(...p).project(key.shadow.camera);assert.ok(Math.abs(clip.x)<1&&Math.abs(clip.y)<1&&Math.abs(clip.z)<1);}}
 renderer.shadowMap.needsUpdate=false;key.shadow.needsUpdate=false;assert.equal(lighting.needsFrame(),false);const requests=lighting.snapshot().shadowUpdateRequests;
 camera.position.set(200,-300,130);camera.up.set(0,0,1);camera.lookAt(0,0,0);assert.equal(lighting.update(camera,{progress:.5,moving:true,geometryChanged:false,now:2}),false);assert.equal(lighting.snapshot().shadowUpdateRequests,requests);assert.equal(renderer.shadowMap.needsUpdate,false);
 cable.position.x+=15;assert.equal(lighting.update(camera,{geometryChanged:true,now:3}),true);assert.equal(lighting.snapshot().shadowUpdateRequests,requests+1);assert.equal(lighting.snapshot().shadowUpdatesObserved,1);
 assert.equal(lighting.snapshot().opaqueCasters,2);assert.equal(lighting.snapshot().opticalNonCasters,1);assert.equal(lighting.snapshot().bounceGI,false);assert.ok(scheduled>=2);
 lighting.dispose();assert.equal(opaque.castShadow,false);assert.equal(opaque.receiveShadow,true);assert.equal(glass.castShadow,false);assert.deepEqual(renderer.shadowMap,originalShadow);assert.equal(scene.children.length,3);assert.equal(lighting.needsFrame(),false);
});

test('invalid or degenerate shadow-fitting inputs fail explicitly',()=>{
 assert.throws(()=>fitRasterShadowBounds([]),/Invalid/);assert.throws(()=>fitRasterShadowBounds([{min:[1,0,0],max:[0,1,1]}]),/Invalid/);assert.throws(()=>shadowBasis([0,0,1]),/parallel/);
});

test('camera and viewport changes reuse the identical native shadow; world or buffer changes invalidate it',()=>{
 const scene=new THREE.Scene(),object=new THREE.Mesh(new THREE.BoxGeometry(20,20,20),new THREE.MeshPhysicalMaterial());scene.add(object);
 const renderer={shadowMap:{enabled:false,autoUpdate:false,needsUpdate:false}},lighting=setupRasterLighting({THREE,renderer,scene,objects:[object]});
 const camera=new THREE.PerspectiveCamera();lighting.update(camera,{geometryChanged:true,now:0});
 const key=scene.children.find(o=>o.name==='CYBR raster studio key');renderer.shadowMap.needsUpdate=false;key.shadow.needsUpdate=false;
 const before=lighting.snapshot();camera.position.z=100;camera.aspect=2;camera.updateProjectionMatrix();
 assert.equal(lighting.update(camera,{geometryChanged:true,now:1}),false);
 assert.equal(lighting.snapshot().shadowUpdateRequests,before.shadowUpdateRequests);assert.equal(lighting.snapshot().geometryCacheHits,1);
 assert.deepEqual(lighting.snapshot().shadowMapSize,[2048,2048]);assert.deepEqual(lighting.snapshot().fit,before.fit);
 object.position.x=5;assert.equal(lighting.update(camera,{geometryChanged:true,now:2}),true);
 object.geometry.attributes.position.needsUpdate=true;assert.equal(lighting.update(camera,{geometryChanged:true,now:3}),true);
 object.geometry=new THREE.BoxGeometry(30,20,20);assert.equal(lighting.update(camera,{geometryChanged:true,now:4}),true);
 lighting.dispose();
});
