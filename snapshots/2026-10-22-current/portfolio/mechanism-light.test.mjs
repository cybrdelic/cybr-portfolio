import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {packMechanism} from './mechanism-light.mjs';
import {packThreeScene} from '../cybr-light/browser/three-hybrid.mjs';
test('CYBR LIGHT adapter preserves indexed triangles, transforms, normals and PBR values',()=>{
 const group=new T.Group(),material=new T.MeshPhysicalMaterial({color:0x885522,metalness:.8,roughness:.21,transmission:.6,ior:1.52});
 const mesh=new T.Mesh(new T.BoxGeometry(1,2,3),material);mesh.position.set(2,3,4);group.add(mesh);
 const packed=packMechanism(group);assert.equal(packed.triangles.length,12*12);assert.equal(packed.attributes.length,12*24);
 assert.equal(packed.lighting.byteLength,96);assert.ok(Math.abs(packed.materials[4]-.8)<1e-6);assert.ok(Math.abs(packed.materials[5]-.6)<1e-6);
 for(let i=0;i<12;i++){assert.ok(packed.triangles[i*12]>=1.5);assert.ok(packed.triangles[i*12]<=2.5);assert.ok(Math.abs(Math.hypot(...packed.attributes.slice(i*24,i*24+3))-1)<1e-6);}
});
test('all instances are exported with distinct boundary identities',()=>{
 const group=new T.Group(),mesh=new T.InstancedMesh(new T.BoxGeometry(),new T.MeshStandardMaterial(),2);
 mesh.setMatrixAt(1,new T.Matrix4().makeTranslation(5,0,0));group.add(mesh);
 const p=packMechanism(group);assert.equal(p.triangles.length,24*12);assert.equal(p.attributes[3],1);assert.equal(p.attributes[12*24+3],2);assert.equal(p.triangles[12*12]-p.triangles[0],5);
});
test('authored material mapping is part-local and preserves physical tile scale',()=>{
 const material=new T.MeshStandardMaterial();material.userData={cybrMaterial:'brass',cybrMetresPerUnit:.001};
 const mesh=new T.Mesh(new T.BoxGeometry(100,100,10),material),root=new T.Group();root.add(mesh);
 const definitions=[{id:'brass',tile_m:.2}];const first=packThreeScene(T,root,[],definitions);
 root.position.x=15;root.rotation.z=.6;const moved=packThreeScene(T,root,[],definitions);
 assert.equal(first.materials[11],1);
 for(let i=0;i<first.attributes.length;i+=24)assert.deepEqual(first.attributes.slice(i+12,i+24),moved.attributes.slice(i+12,i+24));
 assert.ok(first.attributes.filter((v,i)=>i%24>=12).some(v=>Math.abs(v)===.25));
 assert.throws(()=>packThreeScene(T,root));
});
