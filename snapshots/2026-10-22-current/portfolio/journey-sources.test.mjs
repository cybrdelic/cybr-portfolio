import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const dir=new URL('./assets/journey-sources/',import.meta.url);
for(const name of ['combat','springs'])test(name+' source buffer and triangle indices are complete',()=>{
 const meta=JSON.parse(readFileSync(new URL(name+'.json',dir)));
 const data=gunzipSync(readFileSync(new URL(meta.file||name+'.bin.gz',dir)));
 assert.equal(data.length,meta.decodedBytes);
 for(const m of meta.meshes){const count=m.position.count/3;for(const key of ['position','normal']){const d=m[key];assert.ok(d.offset+d.count*4<=data.length);for(let i=0;i<d.count;i++)assert.ok(Number.isFinite(data.readFloatLE(d.offset+i*4)));}for(let i=0;i<m.index.count;i++)assert.ok(data.readUInt32LE(m.index.offset+i*4)<count);}
 if(name==='springs'){
  assert.equal(meta.audit.reduce((n,a)=>n+a.runtimeTriangles,0),meta.meshes.reduce((n,m)=>n+m.index.count/3,0));
  for(const m of meta.meshes)for(let i=0;i<m.normal.count;i+=3){let length=0;for(let j=0;j<3;j++)length+=data.readFloatLE(m.normal.offset+(i+j)*4)**2;assert.ok(length>.99&&length<1.01,'Unit shading normals, including reduced rock meshes');}
 }
});
test('Combat clip retains all 45 source poses and 52 bones',()=>{const m=JSON.parse(readFileSync(new URL('combat.json',dir)));const b=gunzipSync(readFileSync(new URL('combat-skins.bin.gz',dir)));assert.equal(m.frameCount,45);assert.equal(m.boneCount,52);assert.equal(b.length,m.frameCount*m.boneCount*64);assert.notDeepEqual(b.subarray(0,3328),b.subarray(-3328));});
test('CYBR MATERIAL maps retain full mip chains',()=>{const m=JSON.parse(readFileSync(new URL('surfaces.json',dir)));for(const d of m.materials)for(const map of d.runtimeMaps){const data=gunzipSync(readFileSync(new URL(map.file,dir)));assert.equal(data.length,map.bytes);assert.equal(data.length,11184808);}});
