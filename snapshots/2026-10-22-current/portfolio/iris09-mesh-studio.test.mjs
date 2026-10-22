import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {createIris09Studio,IRIS09_ROOM,updateIris09Camera} from './iris09-mesh-stage.mjs';
import {iris09Pose} from './iris09-stage.mjs';

const near=(a,b,e=2e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const source=()=>{
 const material=new T.MeshPhysicalMaterial({color:0x30302c,roughness:.58,envMapIntensity:1});
 material.onBeforeCompile=()=>{};material.customProgramCacheKey=()=> 'source-floor-energy';
 return material;
};

test('studio has real low-cost receiver geometry and preserves the original floor height',()=>{
 const original=source(),studio=createIris09Studio(T,original);studio.root.updateMatrixWorld(true);
 assert.equal(studio.root.children.length,IRIS09_ROOM.opaqueDraws);
 let triangles=0;
 for(const mesh of studio.root.children){
  assert.equal(mesh.geometry.type,'BoxGeometry');assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,true);
  assert.equal(mesh.material.transparent,false);triangles+=mesh.geometry.index.count/3;
  assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));
 }
 assert.equal(triangles,IRIS09_ROOM.triangles);
 const floor=new T.Box3().setFromObject(studio.floor),back=new T.Box3().setFromObject(studio.back),side=new T.Box3().setFromObject(studio.side);
 near(floor.max.y,IRIS09_ROOM.floorHeight);near(back.min.y,IRIS09_ROOM.floorHeight);near(side.min.y,IRIS09_ROOM.floorHeight);
 near(back.max.z,IRIS09_ROOM.backFace);near(side.max.x,IRIS09_ROOM.sideFace);near(side.min.z,IRIS09_ROOM.backFace);
 studio.dispose();original.dispose();
});

test('finish keeps source lighting/display hooks and only changes owned room materials',()=>{
 const original=source(),color=original.color.clone(),studio=createIris09Studio(T,original);
 assert.deepEqual(original.color,color);assert.equal(original.map,null);assert.equal(original.bumpMap,null);assert.equal(original.roughness,.58);
 for(const material of [studio.floorMaterial,studio.wallMaterial]){
  assert.notEqual(material,original);assert.equal(material.onBeforeCompile,original.onBeforeCompile);
  assert.equal(material.customProgramCacheKey,original.customProgramCacheKey);
  assert.equal(material.envMapIntensity,original.envMapIntensity);assert.equal(material.envMap,original.envMap);
  assert.equal(material.map,studio.texture);assert.equal(material.bumpMap,studio.texture);
 }
 assert.equal(studio.floorMaterial.color.getHex(),IRIS09_ROOM.floorColor);
 assert.equal(studio.wallMaterial.color.getHex(),IRIS09_ROOM.wallColor);
 assert.equal(studio.floorMaterial.roughness,.70);assert.equal(studio.wallMaterial.roughness,.85);
 studio.dispose();original.dispose();
});

test('mineral is deterministic, near-white, mip-filtered, and mapped in physical units',()=>{
 const original=source(),a=createIris09Studio(T,original),b=createIris09Studio(T,original);
 assert.deepEqual(a.texture.image.data,b.texture.image.data);assert.equal(a.texture.image.data.length,256*256*4);
 assert.equal(a.texture.colorSpace,T.NoColorSpace);assert.equal(a.texture.minFilter,T.LinearMipmapLinearFilter);
 assert.equal(a.texture.generateMipmaps,true);assert.equal(a.texture.wrapS,T.RepeatWrapping);
 for(let i=0;i<a.texture.image.data.length;i+=4){
  const value=a.texture.image.data[i];assert.ok(value>=Math.round(.94*255)&&value<=Math.round(.99*255));
  assert.equal(a.texture.image.data[i+1],value);assert.equal(a.texture.image.data[i+2],value);assert.equal(a.texture.image.data[i+3],255);
 }
 for(const mesh of a.root.children){
  const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,uv=mesh.geometry.attributes.uv;
  for(let i=0;i<p.count;i++){
   const x=p.getX(i)+mesh.position.x,y=p.getY(i)+mesh.position.y,z=p.getZ(i)+mesh.position.z;
   const u=Math.abs(n.getY(i))>.5?x:Math.abs(n.getX(i))>.5?z:x,v=Math.abs(n.getY(i))>.5?z:y;
   near(uv.getX(i),u/IRIS09_ROOM.texturePeriod,1e-5);near(uv.getY(i),v/IRIS09_ROOM.texturePeriod,1e-5);
  }
 }
 a.dispose();b.dispose();original.dispose();
});

test('architectural shell cannot intrude on authored iris camera paths or mechanism bounds',()=>{
 const original=source(),studio=createIris09Studio(T,original);studio.root.updateMatrixWorld(true);
 const walls=[studio.back,studio.side].map(mesh=>new T.Box3().setFromObject(mesh));
 const mechanism=new T.Box3(new T.Vector3(-2.3,-.09,-2.3),new T.Vector3(2.3,1,2.3));
 for(const wall of walls)assert.equal(wall.intersectsBox(mechanism),false);
 const camera=new T.PerspectiveCamera(27,1,1,60);
 for(const [width,height]of [[1920,1080],[1059,930],[390,844],[2560,720]])for(let i=0;i<=60;i++){
  const pose=iris09Pose(i/140,width,height);updateIris09Camera(camera,pose,width,height);
  assert.ok(camera.position.y>IRIS09_ROOM.floorHeight);
  for(const wall of walls)assert.equal(wall.containsPoint(camera.position),false);
 }
 studio.dispose();original.dispose();
});

test('studio disposes only its owned resources once',()=>{
 const original=source(),studio=createIris09Studio(T,original);let sourceDisposals=0;
 original.addEventListener('dispose',()=>sourceDisposals++);
 const owned=[studio.texture,studio.floorMaterial,studio.wallMaterial,...studio.root.children.map(m=>m.geometry)];
 const counts=owned.map(()=>0);owned.forEach((object,i)=>object.addEventListener('dispose',()=>counts[i]++));
 studio.dispose();studio.dispose();assert.deepEqual(counts,owned.map(()=>1));assert.equal(sourceDisposals,0);
 original.dispose();
});
