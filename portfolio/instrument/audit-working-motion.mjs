// Numerical audit of the actual new binary package, never legacy substitute data.
// node portfolio/instrument/audit-working-motion.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import * as THREE from '../vendor/three-r180/three.module.min.js';
import {createWorkingMotion,createWorkingTubeBuffers} from '../instrument-working-motion.js';
import {auditTubeMesh} from './working-tube-audit.mjs';

const base=new URL('../assets/instrument-working-v1/',import.meta.url);
const read=path=>JSON.parse(fs.readFileSync(path,'utf8'));
const manifest=read(new URL('manifest.json',base)),route=read(new URL('route.json',base));
if(!manifest.workingGeometry)throw Error('Refusing to audit a legacy package as working geometry.');
const buffer=zlib.gunzipSync(fs.readFileSync(new URL('instrument.bin.gz',base)));
const hash=crypto.createHash('sha256').update(buffer).digest('hex');
if(hash!==manifest.stats.sha256||buffer.length!==manifest.stats.decodedGeometryBytes)throw Error('Actual working geometry revision mismatch.');
const groups=new Map(manifest.modules.map(m=>[m.name,new THREE.Group()])),objects=[];
for(const mesh of manifest.meshes){
  const geometry=new THREE.BufferGeometry(),values=new Float32Array(buffer.buffer,buffer.byteOffset+mesh.positions.offset,mesh.positions.count);
  geometry.setAttribute('position',new THREE.BufferAttribute(values,3));
  const object=new THREE.Mesh(geometry);object.userData.meshRecord=mesh;groups.get(mesh.module).add(object);objects.push(object);
}
const cables=[{from:['takeup'],to:['takeup'],segments:644},...manifest.modules.slice(0,-1).map((m,i)=>({from:[m.name],to:[manifest.modules[i+1].name],segments:96}))].map(c=>{
  const buffers=createWorkingTubeBuffers(c.segments),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(buffers.positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(buffers.normals,3));geometry.setIndex(buffers.indices);
  return {...c,...buffers,geometry};
});
const motion=createWorkingMotion({manifest,route,groups,objects,cables});
const original=read(new URL('../assets/instrument-path-light/manifest.json',import.meta.url));
const dense=Array.from({length:201},(_,i)=>i/200),original49=original.frames.map(f=>f.progress);
const samples=[...new Set([...dense,...original49])].sort((a,b)=>a-b);
const report=motion.audit(samples);
report.includesOriginal49CameraProgresses=original49.every(p=>samples.includes(p));
report.sourceMeshes=manifest.meshes.length;
report.motionMeshes=manifest.meshes.filter(m=>m.motion&&m.motion.kind!=='static').length;
report.exportedCADValidation=manifest.cadValidation||manifest.validation||null;
report.emittedCableMeshes=[];
for(const progress of[0,.15,.28,.7,1]){
  motion.setProgress(progress);
  for(const cable of cables)report.emittedCableMeshes.push({progress,cable:cable.from[0],...auditTubeMesh(cable)});
}
report.passed=report.passed&&report.emittedCableMeshes.every(r=>r.passed);
const out=new URL('working-motion-audit.json',import.meta.url);fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,sourceGeometryHash:hash,original49:report.includesOriginal49CameraProgresses,measured:report.measured,report:out.pathname}));
if(!report.passed)process.exitCode=1;
