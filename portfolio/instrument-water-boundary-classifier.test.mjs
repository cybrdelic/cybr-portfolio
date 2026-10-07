import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {waterOuterBoundaryIndices} from './instrument-raster-thickness.mjs';

const hash=array=>createHash('sha256').update(Buffer.from(array.buffer,array.byteOffset,array.byteLength)).digest('hex');
function shells(parts){const positions=[],indices=[];for(const {size,cavity=false}of parts){const box=new THREE.BoxGeometry(...size),offset=positions.length/3;positions.push(...box.attributes.position.array);for(let i=0;i<box.index.count;i+=3){const triangle=Array.from(box.index.array.slice(i,i+3));if(cavity)triangle.reverse();indices.push(...triangle.map(v=>v+offset));}box.dispose();}return{position:new THREE.Float32BufferAttribute(positions,3),index:new THREE.Uint32BufferAttribute(indices,1)};}

test('connectivity refinement preserves real microscopic faces instead of discarding rounded-grid collapses',()=>{
 const {position,index}=shells([{size:[2,1.49e-6,2]},{size:[1,.4e-6,1],cavity:true}]),p=hash(position.array),i=hash(index.array),result=waterOuterBoundaryIndices(position,index);
 assert.equal(result.audit.validated,true);assert.equal(result.audit.rawZeroAreaTriangles,0);assert.equal(result.audit.discardedZeroAreaTriangles,0);assert.equal(result.audit.weldedDegenerateTriangles,0);assert.ok(result.audit.quantizationRefinements>0);assert.ok(result.audit.quantizationMM<1e-6);assert.equal(result.audit.outerComponents,1);assert.equal(result.audit.removedCavities,1);assert.equal(result.indices.length,36);assert.deepEqual(result.indices,index.array.slice(0,36));assert.equal(hash(position.array),p);assert.equal(hash(index.array),i);
});

test('only exact zero-area source faces are excluded before mandatory closed-shell validation',()=>{
 const source=shells([{size:[2,2,2]}]),a=source.position.array,mid=[0,1,2].map(axis=>(source.position.getComponent(0,axis)+source.position.getComponent(1,axis))*.5),position=new THREE.Float32BufferAttribute([...a,...mid],3),index=new THREE.Uint32BufferAttribute([...source.index.array,0,0,1,0,1,a.length/3],1),p=hash(position.array),i=hash(index.array),result=waterOuterBoundaryIndices(position,index);
 assert.equal(result.audit.validated,true);assert.equal(result.audit.rawZeroAreaTriangles,2);assert.equal(result.audit.discardedZeroAreaTriangles,2);assert.equal(result.audit.fieldTriangles,12);assert.deepEqual(result.indices,source.index.array);assert.equal(hash(position.array),p);assert.equal(hash(index.array),i);
 const open=new THREE.Uint32BufferAttribute(index.array.slice(3),1),rejected=waterOuterBoundaryIndices(position,open);assert.equal(rejected.audit.validated,false);assert.equal(rejected.audit.discardedZeroAreaTriangles,0);assert.equal(rejected.indices,open.array);
});

const manifest=JSON.parse(readFileSync(new URL('./assets/instrument-working-v1/manifest.json',import.meta.url))),bytes=gunzipSync(readFileSync(new URL('./assets/instrument-working-v1/instrument.bin.gz',import.meta.url)));
function nativeWater(module,material){const mesh=manifest.meshes.find(mesh=>mesh.module===module&&mesh.material===material);return{position:new THREE.BufferAttribute(new Float32Array(bytes.buffer,bytes.byteOffset+mesh.positions.offset,mesh.positions.count),3),index:new THREE.BufferAttribute(new Uint32Array(bytes.buffer,bytes.byteOffset+mesh.indices.offset,mesh.indices.count),1)};}

test('actual unchanged SCENES water retains both native positive exteriors and rejects all1560 closed cavity shells',()=>{
 const {position,index}=nativeWater('scenes',21),p=hash(position.array),i=hash(index.array),result=waterOuterBoundaryIndices(position,index);
 assert.equal(result.audit.validated,true);assert.equal(result.audit.sourceTriangles,125398);assert.equal(result.audit.rawZeroAreaTriangles,0);assert.equal(result.audit.quantizationRefinements,2);assert.ok(Math.abs(result.audit.quantizationMM-1e-6)<1e-18);assert.equal(result.audit.weldedDegenerateTriangles,0);assert.equal(result.audit.componentCount,1562);assert.equal(result.audit.outerComponents,2);assert.equal(result.audit.removedCavities,1560);assert.equal(result.audit.fieldTriangles,89350);assert.equal(result.audit.components[0].triangles,89292);assert.equal(result.audit.components[1].triangles,58);assert.ok(result.audit.components.every(component=>component.closed));
 let cursor=0;for(let triangle=0;triangle<index.count&&cursor<result.indices.length;triangle+=3)if(index.array[triangle]===result.indices[cursor]&&index.array[triangle+1]===result.indices[cursor+1]&&index.array[triangle+2]===result.indices[cursor+2])cursor+=3;assert.equal(cursor,result.indices.length,'every exit-field face remains an exact ordered source triangle');assert.equal(hash(position.array),p);assert.equal(hash(index.array),i);
});

test('actual ELEMENTS optical water keeps its original exterior and18bubble cavities classification',()=>{
 const {position,index}=nativeWater('elements',7),p=hash(position.array),i=hash(index.array),result=waterOuterBoundaryIndices(position,index);
 assert.equal(result.audit.validated,true);assert.equal(result.audit.componentCount,19);assert.equal(result.audit.outerComponents,1);assert.equal(result.audit.removedCavities,18);assert.equal(result.audit.rawZeroAreaTriangles,0);assert.equal(result.audit.quantizationRefinements,0);assert.equal(hash(position.array),p);assert.equal(hash(index.array),i);
});
