import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {chapterContours,contourMarkup,materialCameraPose} from './direction27-chapters.mjs';
import {scoreMarkup} from './reference27-score.mjs';

test('depth-fold presentation preserves every frame and triangle, with valid packed normals',()=>{
 const base=new URL('./assets/reference27-wave-v17/',import.meta.url),m=JSON.parse(readFileSync(new URL('manifest.json',base))),source=JSON.parse(readFileSync(new URL('./assets/reference27-wave-v12/manifest.json',import.meta.url)));
 assert.equal(m.frames.length,24);assert.equal(m.surfaceReconstruction.physicalSimulation,false);
 for(let i=0;i<m.frames.length;i++){
  const f=m.frames[i],packed=readFileSync(new URL(f.file,base));assert.equal(f.count,source.frames[i].count);assert.equal(createHash('sha256').update(packed).digest('hex'),f.sha256);
  const raw=gunzipSync(packed);assert.equal(raw.length,f.count*12);const n=new Int16Array(raw.buffer,raw.byteOffset+f.count*6,f.count*3);
  for(let q=0;q<n.length;q+=3){const length=Math.hypot(n[q],n[q+1],n[q+2])/32767;assert.ok(length>.95&&length<1.05);}
 }
});
test('post-mechanism chapters have distinct contours and a genuine macro camera',()=>{
 assert.equal(new Set(Object.values(chapterContours).map(JSON.stringify)).size,5);
 assert.equal(contourMarkup('geo'),null);assert.ok(materialCameraPose(0).height<2);
});
test('score uses source durations, barlines and diatonic placement',()=>{
 const score=JSON.parse(readFileSync(new URL('../cybr-song/demo-output/score.json',import.meta.url)));
 const svg=scoreMarkup(score);assert.doesNotMatch(svg,/NaN|undefined/);
 const excerpt=score.notes.filter(n=>(n.staff===1||n.staff===3)&&n.quarter<8);
 assert.equal((svg.match(/data-on=/g)||[]).length,excerpt.length);
 for(const note of excerpt)assert.ok(svg.includes(`data-on="${note.on}" data-off="${note.off}"`));
 assert.match(svg,/var\(--paper\)/);assert.match(svg,/𝄞/);
});
test('new fluid bake is complete, converged and hash-verified without replacing vessel',()=>{
 const base=new URL('./assets/reference27-wave-v3/',import.meta.url),m=JSON.parse(readFileSync(new URL('manifest.json',base)));
 assert.equal(m.complete,true);assert.equal(m.frames.length,24);assert.ok(existsSync(new URL('./assets/instrument-fluid/manifest.json',import.meta.url)));
 for(const f of m.frames){const raw=readFileSync(new URL(f.file,base));assert.equal(createHash('sha256').update(raw).digest('hex'),f.sha256);assert.equal(gunzipSync(raw).length,f.count*12);assert.equal(f.pressure.converged,true);}
});
test('authored combat asset has a complete finite source-sized skeleton',()=>{
 const base=new URL('./assets/reference27-combat/',import.meta.url),m=JSON.parse(readFileSync(new URL('manifest.json',base)));
 const raw=gunzipSync(readFileSync(new URL('stance.bin.gz',base)));
 assert.equal(raw.byteLength,m.frameCount*m.boneCount*16*4);assert.equal(m.boneCount,52);
 const floats=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4);assert.ok(floats.every(Number.isFinite));
 for(let i=0;i<floats.length;i+=16){assert.ok(Math.abs(floats[i+15]-1)<1e-5);for(const j of [0,4,8])assert.ok(Math.abs(Math.hypot(...floats.slice(i+j,i+j+3))-1)<1e-4);}
});

test('volumetric curl has 24 converged frames with consistent surface normals',()=>{
 const base=new URL('./assets/reference27-wave-v12/',import.meta.url),m=JSON.parse(readFileSync(new URL('manifest.json',base)));
 assert.equal(m.complete,true);assert.equal(m.frames.length,24);assert.equal(m.config.shapeTransport,false);
 assert.ok(m.surfaceReconstruction.maxDisplacementMillimetres<.6);assert.equal(m.surfaceReconstruction.triangleCountUnchanged,true);
 for(const f of m.frames){const file=readFileSync(new URL(f.file,base)),raw=gunzipSync(file);assert.equal(createHash('sha256').update(file).digest('hex'),f.sha256);assert.equal(raw.length,f.count*12);assert.equal(f.pressure.converged,true);assert.ok(f.count/3<140000);const normals=new Int16Array(raw.buffer,raw.byteOffset+f.count*6,f.count*3);for(let i=0;i<normals.length;i+=3)assert.ok(Math.abs(Math.hypot(normals[i],normals[i+1],normals[i+2])/32767-1)<.002);}
});
test('refined fluid retains every source triangle and bounds the surface displacement',()=>{
 const base=new URL('./assets/reference27-wave-v4/',import.meta.url),m=JSON.parse(readFileSync(new URL('manifest.json',base))),source=JSON.parse(readFileSync(new URL('./assets/reference27-wave-v3/manifest.json',import.meta.url)));
 assert.equal(m.frames.length,source.frames.length);assert.ok(m.surfaceReconstruction.maxVertexDisplacementMillimetres<.3);
 for(let i=0;i<m.frames.length;i++){const f=m.frames[i],raw=readFileSync(new URL(f.file,base));assert.equal(f.count,source.frames[i].count);assert.equal(createHash('sha256').update(raw).digest('hex'),f.sha256);assert.equal(gunzipSync(raw).length,f.count*12);}
});
test('repaired garments retain valid weighted source geometry',()=>{
 const base=new URL('./assets/reference27-combat/',import.meta.url),m=JSON.parse(readFileSync(new URL('geometry.json',base))),raw=gunzipSync(readFileSync(new URL(m.file,base)));
 assert.equal(raw.byteLength,m.decodedBytes);assert.deepEqual(m.meshes.map(x=>x.name),['body','Sewn shirt','Sewn shorts']);
 for(const mesh of m.meshes){const count=mesh.position.count/3;for(const [key,a] of Object.entries(mesh)){if(!a?.offset&&a?.offset!==0)continue;assert.ok(a.offset+a.count*4<=raw.byteLength);const arr=key==='index'?new Uint32Array(raw.buffer,raw.byteOffset+a.offset,a.count):new Float32Array(raw.buffer,raw.byteOffset+a.offset,a.count);assert.ok(arr.every(Number.isFinite));if(key==='index')assert.ok(arr.every(v=>v<count));if(key==='weights')for(let i=0;i<arr.length;i+=4)assert.ok(Math.abs(arr[i]+arr[i+1]+arr[i+2]+arr[i+3]-1)<.002);}}
});
test('broad water reconstruction is explicitly art-directed and retains complete frames',()=>{
 const base=new URL('./assets/reference27-wave-v5/',import.meta.url),m=JSON.parse(readFileSync(new URL('manifest.json',base)));
 assert.equal(m.surfaceReconstruction.physicalSimulation,false);assert.equal(m.frames.length,24);
 for(const f of m.frames){const raw=readFileSync(new URL(f.file,base));assert.equal(createHash('sha256').update(raw).digest('hex'),f.sha256);assert.equal(gunzipSync(raw).length,f.count*12);}
});
test('rebuilt landscape retains valid indices and conservative bounds',()=>{
 const base=new URL('./assets/journey-sources/',import.meta.url),m=JSON.parse(readFileSync(new URL('reference27-springs.json',base))),raw=gunzipSync(readFileSync(new URL(m.file,base)));let triangles=0;
 assert.equal(raw.byteLength,m.decodedBytes);
 for(const mesh of m.meshes){const p=new Float32Array(raw.buffer,raw.byteOffset+mesh.position.offset,mesh.position.count),Index=mesh.index.componentType==='uint16'?Uint16Array:Uint32Array,ix=new Index(raw.buffer,raw.byteOffset+mesh.index.offset,mesh.index.count);triangles+=ix.length/3;assert.ok(ix.every(i=>i<p.length/3));assert.ok(p.every(Number.isFinite));for(let i=0;i<p.length;i++)assert.ok(p[i]>=mesh.bounds.min[i%3]-.0001&&p[i]<=mesh.bounds.max[i%3]+.0001);}
 assert.equal(triangles,m.audit.reduce((n,a)=>n+a.runtimeTriangles,0));
});
