import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as ThreadWorker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {waterOuterBoundaryIndices} from './instrument-water-boundary.mjs';
import {prepareWaterBoundaries,matchingWaterBoundary,waterBoundaryObjects} from './instrument-water-boundary-preparation.mjs';

class NativeThreadWorker{
  constructor(url){
    this.thread=new ThreadWorker(`const{parentPort,workerData}=require('node:worker_threads');globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};const ready=import(workerData.url);parentPort.on('message',async data=>{try{await ready;self.onmessage({data});}catch(error){parentPort.postMessage({phase:'error',message:error.message});}});`,{eval:true,workerData:{url:url.href}});
    this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',error=>this.onerror?.(error));
  }
  postMessage(data,transfer){this.thread.postMessage(data,transfer);}
  terminate(){this.terminated=true;this.thread.terminate();}
}
const hash=array=>createHash('sha256').update(new Uint8Array(array.buffer,array.byteOffset,array.byteLength)).digest('hex');
function water(geometry){const material=new THREE.MeshPhysicalMaterial({ior:1.333});material.userData.cadTransmission=1;const object=new THREE.Mesh(geometry,material);object.userData.staticWater=true;return object;}
function nativeWaters(){
  const manifest=JSON.parse(readFileSync(new URL('./assets/instrument-working-v1/manifest.json',import.meta.url))),raw=gunzipSync(readFileSync(new URL('./assets/instrument-working-v1/instrument.bin.gz',import.meta.url)));
  const buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
  return manifest.meshes.filter(record=>(record.module==='elements'&&record.material===7)||manifest.customMaterials?.[record.material]?.role==='springs-water').map(record=>{
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(buffer,record.positions.offset,record.positions.count),3));geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer,record.indices.offset,record.indices.count),1));
    const object=water(geometry);object.name=record.name;return object;
  });
}
test('real module worker produces byte-identical native water indices and complete classification audits while retaining original buffers',async t=>{
  const objects=nativeWaters();assert.ok(objects.length>=2,'ELEMENTS and SCENES native water');
  const before=objects.map(o=>[hash(o.geometry.attributes.position.array),hash(o.geometry.index.array)]),original=objects.map(o=>[o.geometry.attributes.position.array,o.geometry.index.array]);
  const expected=objects.map(o=>waterOuterBoundaryIndices(o.geometry.attributes.position,o.geometry.index)),metrics={};
  const prepared=await prepareWaterBoundaries([...objects,objects[0]],{WorkerConstructor:NativeThreadWorker,metrics});
  assert.equal(metrics.backend,'module worker');assert.equal(prepared.size,objects.length);assert.ok(metrics.inputCopyBytes>0);
  objects.forEach((object,i)=>{
    const result=matchingWaterBoundary(prepared,object.geometry);assert.deepEqual(result.audit,expected[i].audit);assert.equal(hash(result.indices),hash(expected[i].indices));assert.deepEqual(result.indices,expected[i].indices);
    assert.equal(object.geometry.attributes.position.array,original[i][0]);assert.equal(object.geometry.index.array,original[i][1]);assert.ok(original[i][0].buffer.byteLength>0&&original[i][1].buffer.byteLength>0);
    assert.deepEqual([hash(original[i][0]),hash(original[i][1])],before[i]);
    if(expected[i].indices===original[i][1])assert.equal(result.indices,original[i][1]);
  });
  t.diagnostic(JSON.stringify({workerEquivalence:true,metrics,meshes:objects.map((o,i)=>({module:i===0?'elements':'scenes',sourcePositionsSHA256:before[i][0],sourceIndicesSHA256:before[i][1],derivedIndicesSHA256:hash(expected[i].indices),sourceTriangles:expected[i].audit.sourceTriangles,fieldTriangles:expected[i].audit.fieldTriangles,completeAuditIdentical:true}))}));
});
test('fallback preserves source-index identity, and changed versions/attributes cannot reuse stale derived geometry',async()=>{
  const object=water(new THREE.BoxGeometry(4,4,4)),prepared=await prepareWaterBoundaries([object],{WorkerConstructor:null});
  assert.equal(matchingWaterBoundary(prepared,object.geometry).indices,object.geometry.index.array);
  object.geometry.attributes.position.needsUpdate=true;assert.equal(matchingWaterBoundary(prepared,object.geometry),null);
  const newer=await prepareWaterBoundaries([object],{WorkerConstructor:null});object.geometry.setIndex(object.geometry.index.clone());assert.equal(matchingWaterBoundary(newer,object.geometry),null);
  const baked=water(new THREE.BoxGeometry());baked.userData.bakedFluid=true;const opaque=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());
  assert.deepEqual(waterBoundaryObjects([object,baked,opaque]),[object]);
});
test('worker error, cancellation and a geometry revision during preparation reject and terminate the owned worker',async()=>{
  const object=water(new THREE.BoxGeometry());let created;
  class ControlledWorker{constructor(){created=this;}postMessage(){queueMicrotask(()=>this.onmessage({data:{phase:'error',message:'classification failed'}}));}terminate(){this.terminated=true;}}
  await assert.rejects(prepareWaterBoundaries([object],{WorkerConstructor:ControlledWorker}),/classification failed/);assert.equal(created.terminated,true);
  let cancel=false;
  class CancelWorker extends ControlledWorker{postMessage(){cancel=true;queueMicrotask(()=>this.onmessage({data:{phase:'complete',workerMs:1}}));}}
  await assert.rejects(prepareWaterBoundaries([object],{WorkerConstructor:CancelWorker,cancelled:()=>cancel}),/cancelled/);assert.equal(created.terminated,true);
  class RevisionWorker extends ControlledWorker{postMessage(){object.geometry.index.needsUpdate=true;queueMicrotask(()=>this.onmessage({data:{phase:'boundary',id:0,usesSourceIndices:true,audit:{}}}));}}
  await assert.rejects(prepareWaterBoundaries([object],{WorkerConstructor:RevisionWorker}),/changed during preparation/);assert.equal(created.terminated,true);
});
