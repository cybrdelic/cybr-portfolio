import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import * as T from './vendor/three-r180/three.module.min.js';
import {buildArtifacts,ARTIFACTS} from './artifact-designs.mjs';

test('all six new artifacts have finite 3D geometry and bounded draw counts',()=>{
 const {groups,moving}=buildArtifacts();assert.deepEqual([...groups.keys()],ARTIFACTS);
 let draws=0;
 for(const [name,group] of groups){
  const bounds=new T.Box3().setFromObject(group);assert.ok(bounds.max.z>(name==='scenes'?-10:10),name);assert.ok(bounds.min.z>=-30,name);
  group.traverse(o=>{if(!o.isMesh)return;draws++;assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite),name);});
 }
 assert.ok(draws<85,`draws=${draws}`);assert.ok(moving.length>10);
});
test('source subjects are independent, checked compact payloads',()=>{
 let heroBytes=0;
 for(const name of ['combat','scenes'])for(const lod of ['hero','detail']){
  const base=new URL(`./assets/artifacts-v2/${name}-${lod}`,import.meta.url),meta=JSON.parse(fs.readFileSync(new URL(base.href+'.json')));
  const packed=fs.readFileSync(new URL(base.href+'.bin.gz')),data=zlib.gunzipSync(packed);
  assert.equal(data.length,meta.bytes);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),meta.sha256);
  assert.equal(meta.source,'486afb1b0c1ea6bb75642626beb6fb4b284db9824d99bdbb21de7ee7456fc756');
  if(lod==='hero')heroBytes+=packed.length;
 }
 assert.ok(heroBytes<450000);
});

test('prebuilt hardware preserves authored geometry bounds and object transforms',()=>{
 const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./assets/artifacts-v2/hardware.json.gz',import.meta.url))));
 const restored=new T.ObjectLoader().parse(data.scene),original=buildArtifacts();restored.updateMatrixWorld(true);
 for(const [name,group] of original.groups){group.updateMatrixWorld(true);const a=new T.Box3().setFromObject(group),b=new T.Box3().setFromObject(restored.getObjectByName(name));
  assert.ok(a.min.distanceTo(b.min)<.0001,name+' minimum');assert.ok(a.max.distanceTo(b.max)<.0001,name+' maximum');
 }
});
