import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {orbitPose,cauchyIndex,refract2,prismPath,PRISM_SOURCE} from './specimen-optics.mjs';
import {SPECIMENS} from './specimen-catalog.mjs';
const close=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('ORBIT browser poses agree with the original CAD recipe at wrist and jaw limits',()=>{
  const oracle=JSON.parse(readFileSync(new URL('./assets/specimens/geo/pose-validation.json',import.meta.url)));
  assert.equal(oracle.samples.length,18);
  for(const sample of oracle.samples){const matrix=orbitPose(THREE,sample.motion,sample);matrix.elements.forEach((value,i)=>close(value,sample.matrix[i]));}
});
test('the prism obeys Snell refraction, unit ray directions and total internal reflection',()=>{
  const transmitted=refract2([Math.SQRT1_2,-Math.SQRT1_2],[0,1],1,1.5);
  close(Math.hypot(...transmitted),1);close(transmitted[0]*1.5,Math.SQRT1_2);
  assert.equal(refract2([Math.sqrt(3)/2,-.5],[0,1],1.5,1),null);
});
test('LIGHT retains the authored prism and Cauchy coefficients and produces physical detector separation',()=>{
  const original=readFileSync(new URL('../cybr-light/examples/prism.py',import.meta.url),'utf8');
  assert.ok(original.includes('ior_a=1.49,ior_b=.014'));assert.deepEqual(PRISM_SOURCE.crossSection,[[-.65,-.6],[.8,0],[-.65,.6]]);
  assert.ok(cauchyIndex(430)>cauchyIndex(700));
  for(const incidence of [50,60,75]){
    const violet=prismPath(430,{incidence}),red=prismPath(700,{incidence});
    assert.ok(violet.exited&&red.exited&&violet.detector&&red.detector);
    assert.ok(Math.abs(red.detector[1]-violet.detector[1])>.2);
    for(const path of [violet,red]){close(path.points[1][0],-.65);close(path.points[1][1],0);assert.ok(path.points.flat().every(Number.isFinite));}
  }
  assert.notEqual(prismPath(550,{incidence:50}).detector[1],prismPath(550,{incidence:70}).detector[1]);
});
test('published specimen geometry is intact, bounded and tied to the actual source',()=>{
  for(const name of ['geo','elements']){
    const base=new URL(`./assets/specimens/${name}/`,import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',base))),raw=gunzipSync(readFileSync(new URL('geometry.bin.gz',base)));
    assert.equal(raw.length,manifest.geometry.decodedBytes);assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.geometry.sha256);
    for(const part of manifest.parts){
      const n=part.positions.count/3,s=part.indices,indices=new Uint32Array(raw.buffer,raw.byteOffset+s.offset,s.count);
      assert.ok(indices.every(i=>i<n),part.name+' index bounds');
      const p=part.positions,positions=new Float32Array(raw.buffer,raw.byteOffset+p.offset,p.count);assert.ok(positions.every(Number.isFinite));
    }
    if(name==='geo'){
      assert.equal(manifest.parts.length,148);assert.ok(manifest.parts.some(p=>p.name==='G01_72T_Involute_wrist_gear'));assert.ok(manifest.parts.some(p=>p.name==='G02_20T_Involute_input_pinion'));
      assert.equal(manifest.source.recipeSHA256,createHash('sha256').update(readFileSync(new URL('../cybr-geo/examples/orbit_inspection_wrist.py',import.meta.url))).digest('hex'));
    }
  }
});
test('all six projects have source-backed entry points, and each interactive specimen has its own lightweight film',()=>{
  assert.equal(new Set(SPECIMENS.map(p=>p.id)).size,6);
  for(const specimen of SPECIMENS){assert.ok(existsSync(new URL(specimen.poster,import.meta.url)));assert.ok(existsSync(new URL(specimen.details,import.meta.url)));if(specimen.interactive){assert.ok(specimen.controls.length>=2);const bytes=readFileSync(new URL(specimen.film,import.meta.url));assert.ok(bytes.length<600_000);}}
});
