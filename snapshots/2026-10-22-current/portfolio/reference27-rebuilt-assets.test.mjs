import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=new URL('./assets/',import.meta.url);
function model(folder,name){const base=new URL(folder+'/',root),meta=JSON.parse(readFileSync(new URL(name+'.json',base))),raw=gunzipSync(readFileSync(new URL(meta.file,base)));assert.equal(raw.length,meta.decodedBytes);return {meta,raw};}
function audit({meta,raw}){
 let triangles=0;
 for(const mesh of meta.meshes){
  const p=mesh.position,n=mesh.normal,i=mesh.index;
  assert.equal(p.count%3,0);assert.equal(n.count,p.count);assert.equal(i.count%3,0);
  const vertices=p.count/3;triangles+=i.count/3;
  for(let k=0;k<p.count;k++)assert.ok(Number.isFinite(raw.readFloatLE(p.offset+k*4)),mesh.name+' non-finite position');
  for(let k=0;k<i.count;k++){const index=i.componentType==='uint16'?raw.readUInt16LE(i.offset+k*2):raw.readUInt32LE(i.offset+k*4);assert.ok(index<vertices,mesh.name+' invalid index');}
 }
 return triangles;
}
test('sewn panel replacement retains the original avatar and valid skinning',()=>{
 const data=model('reference27-combat','geometry-panels');audit(data);
 const shirt=data.meta.meshes.find(m=>m.name==='Sewn shirt');assert.ok(shirt.index.count/3<20000);
 assert.ok(data.meta.meshes.some(m=>m.name==='body'));
 const w=shirt.weights;for(let k=0;k<w.count;k+=4){let sum=0;for(let j=0;j<4;j++)sum+=data.raw.readFloatLE(w.offset+(k+j)*4);assert.ok(Math.abs(sum-1)<1e-5);}
});
test('all authored water frames are intact and fit the bounded triangle budget',()=>{
 const base=new URL('reference27-sheet/',root),meta=JSON.parse(readFileSync(new URL('manifest.json',base)));
 assert.equal(meta.frames.length,24);assert.match(meta.solver,/not fluid simulation/);
 for(const frame of meta.frames){const packed=readFileSync(new URL(frame.file,base));assert.equal(createHash('sha256').update(packed).digest('hex'),frame.sha256);assert.equal(gunzipSync(packed).length,frame.count*12);assert.ok(frame.count/3<40000);}
});
test('fitted garment has normalized skinning and closed cloth boundaries',()=>{
 const data=model('reference27-combat','geometry-fitted');audit(data);
 const shirt=data.meta.meshes.find(m=>m.name==='Sewn shirt');assert.ok(shirt.index.count/3<35000);
 const edges=new Map(),idx=k=>data.raw.readUInt32LE(shirt.index.offset+k*4);
 for(let k=0;k<shirt.index.count;k+=3){const face=[idx(k),idx(k+1),idx(k+2)];for(let j=0;j<3;j++){const a=face[j],b=face[(j+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);edges.set(key,(edges.get(key)||0)+1);}}
 assert.ok([...edges.values()].every(n=>n===2),'cloth must include collar, cuff and hem bindings');
 const w=shirt.weights;for(let k=0;k<w.count;k+=4){let sum=0;for(let j=0;j<4;j++)sum+=data.raw.readFloatLE(w.offset+(k+j)*4);assert.ok(Math.abs(sum-1)<1e-5);}
});
test('rebuilt landscape stays below source triangle count and contains three water volumes',()=>{
 const data=model('journey-sources','reference27-landscape-rebuilt'),source=JSON.parse(readFileSync(new URL('journey-sources/reference27-springs.json',root)));assert.ok(audit(data)<source.audit.reduce((sum,row)=>sum+row.runtimeTriangles,0));
 assert.equal(data.meta.meshes.filter(m=>m.name.startsWith('Board27 / mineral water')).length,3);
 assert.equal(data.meta.reference27.newTerrain,true);
});
test('production indexing preserves every original position and normal in every frame',()=>{
 const base=new URL('reference27-wave-indexed/',root),source=new URL('reference27-wave-v17/',root),meta=JSON.parse(readFileSync(new URL('manifest.json',base)));
 assert.equal(meta.frames.length,24);assert.equal(meta.normalReconstruction,'Source normals unchanged');
 for(const row of meta.frames){const raw=gunzipSync(readFileSync(new URL(row.file,base))),original=gunzipSync(readFileSync(new URL(row.file,source))),n=row.vertexCount;
  for(let i=0;i<row.count;i++){const v=raw.readUInt32LE(n*12+i*4);for(let c=0;c<3;c++){assert.equal(raw.readInt16LE(v*6+c*2),original.readInt16LE(i*6+c*2));assert.equal(raw.readInt16LE(n*6+v*6+c*2),original.readInt16LE(row.count*6+i*6+c*2));}}
 }
});
test('indexed water preserves every source corner and has complete finite optical records',()=>{
 const base=new URL('reference27-flow-transport/',root),source=new URL('reference27-wave-v17/',root),meta=JSON.parse(readFileSync(new URL('manifest.json',base)));
 assert.equal(meta.frames.length,24);assert.equal(meta.format,'indexed-q16');assert.equal(meta.optics.stride,14);
 for(const row of meta.frames){
  const raw=gunzipSync(readFileSync(new URL(row.file,base))),original=gunzipSync(readFileSync(new URL(row.file,source))),n=row.vertexCount;
  assert.equal(raw.length,n*12+row.count*4);
  for(let i=0;i<row.count;i++){const v=raw.readUInt32LE(n*12+i*4);assert.ok(v<n);for(let c=0;c<3;c++)assert.equal(raw.readInt16LE(v*6+c*2),original.readInt16LE(i*6+c*2));}
  assert.match(meta.normalReconstruction,/positions and triangle indices unchanged/);
  for(let i=0;i<n;i++){const q=n*6+i*6;assert.ok(Math.abs(Math.hypot(raw.readInt16LE(q),raw.readInt16LE(q+2),raw.readInt16LE(q+4))/32767-1)<.001,'unit reconstructed normal');}
  const packed=readFileSync(new URL(row.optics.file,base));assert.equal(createHash('sha256').update(packed).digest('hex'),row.optics.sha256);
  const optical=gunzipSync(packed),quantized=meta.optics.format==='q16';assert.equal(optical.length,n*14*(quantized?2:4));
  if(quantized){for(let i=0;i<n;i++){assert.ok(optical.readInt16LE((i*14+12)*2)>=0);assert.ok(optical.readInt16LE((i*14+13)*2)>=0);}}
  else for(let i=0;i<optical.length;i+=4)assert.ok(Number.isFinite(optical.readFloatLE(i)));
 }
});
