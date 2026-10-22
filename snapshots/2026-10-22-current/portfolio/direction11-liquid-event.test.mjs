import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {createLiquidEvent,waterSectionThickness,WATER_MAX_THICKNESS} from './direction11-liquid-event.mjs';

test('every visible water surface carries bounded local volume depth',()=>{
 const event=createLiquidEvent();
 event.root.traverse(mesh=>{
  if(!mesh.isMesh)return;
  const depths=mesh.geometry.attributes.waterThickness;
  assert.ok(depths,mesh.name||mesh.type);
  assert.equal(mesh.material.ior,1.333);assert.equal(mesh.material.transmission,1);
  assert.equal(mesh.material.metalness,0);assert.equal(mesh.material.envMapIntensity,1);
  for(const depth of depths.array){assert.ok(Number.isFinite(depth)&&depth>0);assert.ok(depth<=mesh.material.thickness+1e-7);}
 });
 assert.equal(waterSectionThickness(100),WATER_MAX_THICKNESS);
 assert.equal(waterSectionThickness(-1),0);
 event.dispose();
});

test('instanced droplets use their actual diameter, not full crest depth',()=>{
 const event=createLiquidEvent(),drops=event.root.children.find(o=>o.isInstancedMesh),depths=drops.geometry.attributes.waterThickness;
 assert.equal(depths.isInstancedBufferAttribute,true);assert.equal(depths.count,drops.count);
 const matrix=new T.Matrix4(),position=new T.Vector3(),rotation=new T.Quaternion(),scale=new T.Vector3();
 for(const u of [0,.5,1]){
  event.update(u);
  for(let i=0;i<drops.count;i++){
   drops.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
   assert.ok(Math.abs(depths.getX(i)-2*scale.x)<1e-7);
   assert.ok(depths.getX(i)<.15);
  }
 }
 event.dispose();
});

test('pool depth and refraction use baked actual dimensions, not anisotropic object scale',()=>{
 const event=createLiquidEvent(),pool=event.root.children.find(o=>o.name==='Water body / true shallow depth');
 assert.deepEqual(pool.scale.toArray(),[1,1,1]);
 pool.geometry.computeBoundingBox();const size=pool.geometry.boundingBox.getSize(new T.Vector3());
 assert.ok(size.x>3.5&&size.z>1.9);assert.ok(Math.abs(size.y-.054)<1e-7);
 assert.ok(Math.abs(pool.geometry.boundingBox.min.y+pool.position.y)<1e-7,'pool sits on the stage rather than intersecting it');
 assert.equal(pool.material.thickness,.054);
 event.dispose();
});

test('water hooks preserve physical Fresnel/Beer–Lambert and use the same transmission pass',()=>{
 const event=createLiquidEvent(),materials=new Set();
 event.root.traverse(o=>{if(o.isMesh)materials.add(o.material);});
 for(const material of materials){
  const shader={vertexShader:T.ShaderLib.physical.vertexShader,fragmentShader:T.ShaderLib.physical.fragmentShader};
  material.onBeforeCompile(shader);
  assert.match(shader.vertexShader,/attribute float waterThickness/);
  assert.match(shader.fragmentShader,/material\.thickness = clamp\(vWaterThickness,0\.0,thickness\)/);
  assert.match(shader.fragmentShader,/getIBLVolumeRefraction\(/);
  assert.equal(material.userData.optics.extraPasses,0);
  assert.doesNotMatch(shader.fragmentShader,/for\s*\(.*ray|raymarch/);
 }
 const resources=[];event.root.traverse(o=>{if(o.isMesh){resources.push(o.geometry,o.material);}});
 const disposed=new Set();for(const resource of new Set(resources))resource.addEventListener('dispose',()=>disposed.add(resource));
 event.dispose();assert.equal(disposed.size,new Set(resources).size);
});

test('the splash is a thin closed sheet with tiny submerged end caps, not a cut solid rod',()=>{
 const event=createLiquidEvent(),crest=event.root.getObjectByName('Rounded liquid crest'),g=crest.geometry;
 const p=g.attributes.position,n=g.attributes.normal,depth=g.attributes.waterThickness,indices=g.index.array;
 g.computeBoundingBox();
 assert.ok(g.boundingBox.min.y>=.025,'no part of the crest intersects the stage');
 assert.ok(g.boundingBox.max.x-g.boundingBox.min.x>2.2,'the broad sheet must retain its authored width');
 assert.ok(g.boundingBox.max.z-g.boundingBox.min.z<.6,'it must not become a thick glass column');
 assert.ok(Math.max(...depth.array)<.23,'the thin sheet and rolled edge have bounded real local depth');
 assert.equal(g.userData.surface.largeExposedCaps,false);
 let volume=0;const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),cross=new T.Vector3();
 for(let i=0;i<indices.length;i+=3){
  a.fromBufferAttribute(p,indices[i]);b.fromBufferAttribute(p,indices[i+1]);c.fromBufferAttribute(p,indices[i+2]);
  volume+=a.dot(cross.crossVectors(b,c))/6;
 }
 assert.ok(volume>.25&&volume<.55,'the authored thin volume must remain outward-wound');
 for(let i=0;i<n.count;i++)assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
 // The initial cap is approximately 1/1000 of the old exposed base, and sits
 // within the actual pool. Small remaining tip caps cannot create broad flats.
 const capCenter=p.count-2,center=new T.Vector3().fromBufferAttribute(p,capCenter);
 assert.ok(center.y<.054);for(let i=0;i<48;i++)assert.ok(a.fromBufferAttribute(p,i).distanceTo(center)<.016);
 event.dispose();
});

test('runoff has sealed rounded tips, no open six-sided hoops, and stays in the mesh budget',()=>{
 const event=createLiquidEvent(),fingers=event.root.children.filter(o=>o.name.startsWith('Tapered water runoff'));
 assert.equal(fingers.length,5);
 for(const mesh of fingers){
  const g=mesh.geometry,indices=g.index.array,edges=new Map(),directions=new Map();g.computeBoundingBox();
  assert.ok(g.boundingBox.min.y>0);assert.ok(g.boundingBox.max.y<.3);
  for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){
   const a=indices[i+j],b=indices[i+(j+1)%3],key=a<b?`${a}/${b}`:`${b}/${a}`;
   edges.set(key,(edges.get(key)||0)+1);directions.set(key,(directions.get(key)||0)+(a<b?1:-1));
  }
  assert.ok([...edges.values()].every(count=>count===2));
  assert.ok([...directions.values()].every(sum=>sum===0));
 }
 let triangles=0,draws=0;event.root.traverse(mesh=>{if(mesh.isMesh){triangles+=mesh.geometry.index.count/3*(mesh.isInstancedMesh?mesh.count:1);draws++;}});
 assert.ok(triangles<32000);assert.equal(draws,8);
 assert.equal(event.root.userData.optics.extraTransmissionPasses,0);
 event.dispose();
});
