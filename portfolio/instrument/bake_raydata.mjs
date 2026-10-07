import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {gzipSync,gunzipSync} from 'node:zlib';import crypto from 'node:crypto';
const build=process.argv[2],out=path.join(build,'ray-v4');fs.mkdirSync(out,{recursive:true});
const THREE=await import(pathToFileURL(path.join(build,'tools/web-ray/node_modules/three/build/three.module.js')));
const {MeshBVH,MeshBVHUniformStruct,FloatVertexAttributeTexture}=await import(pathToFileURL(path.join(build,'tools/web-ray/node_modules/three-mesh-bvh/build/index.module.js')));
function pack(positions,normals,indices,labels,file){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setIndex(new THREE.BufferAttribute(indices,1));
 const bvh=new MeshBVH(g,{maxLeafSize:8,maxDepth:32}),uniform=new MeshBVHUniformStruct();uniform.updateFrom(bvh);
 const normal=new FloatVertexAttributeTexture();normal.updateFrom(new THREE.BufferAttribute(normals,3));
 const material=new FloatVertexAttributeTexture();material.updateFrom(new THREE.BufferAttribute(labels,1));
 const textures={...Object.fromEntries(['index','position','bvhBounds','bvhContents'].map(k=>[k,uniform[k]])),normal,material};
 const chunks=[],meta={};let offset=0;
 for(const [key,t] of Object.entries(textures)){
  const a=t.image.data,bytes=Buffer.from(a.buffer,a.byteOffset,a.byteLength);meta[key]={offset,length:a.length,dtype:a.constructor.name,width:t.image.width,height:t.image.height,type:t.type,format:t.format,internalFormat:t.internalFormat};chunks.push(bytes);offset+=bytes.length;
 }
 const header=Buffer.from(JSON.stringify(meta)),pad=(4-header.length%4)%4,prefix=Buffer.alloc(4);prefix.writeUInt32LE(header.length);const packed=gzipSync(Buffer.concat([prefix,header,Buffer.alloc(pad),...chunks]),{level:9});fs.writeFileSync(path.join(out,file),packed);uniform.dispose();normal.dispose();material.dispose();g.dispose();
 return {file,bytes:packed.length,sha256:crypto.createHash('sha256').update(packed).digest('hex')};
}
const folder=path.join(build,'web-v4'),m=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'))),raw=gunzipSync(fs.readFileSync(path.join(folder,'instrument.bin.gz')));const buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
function attr(s){const T=s.dtype==='float32'?Float32Array:s.dtype==='int16'?Int16Array:Uint32Array;return new T(buffer,s.offset,s.count);}
const manifest={version:1,static:{},frames:[]};
for(const name of ['elements','light']){
 // Moving exploded trim remains raster geometry; do not leave stale phantom
 // trim at its exploded position inside a static local reflection structure.
 const parts=m.meshes.filter(p=>p.module===name&&p.material!==7&&!p.assemblyShiftX);let total=parts.reduce((n,p)=>n+p.positions.count,0),nfaces=parts.reduce((n,p)=>n+p.indices.count,0);const pos=new Float32Array(total),norm=new Float32Array(total),labels=new Float32Array(total/3),idx=new Uint32Array(nfaces);let v=0,f=0;
 for(const p of parts){pos.set(attr(p.positions),v);norm.set(Float32Array.from(attr(p.normals),n=>n/32767),v);labels.fill(p.material,v/3,(v+p.positions.count)/3);idx.set(Uint32Array.from(attr(p.indices),i=>i+v/3),f);v+=p.positions.count;f+=p.indices.count;}
 manifest.static[name]=pack(pos,norm,idx,labels,`${name}.ray.gz`);console.log(name+' ray tree baked');
}
const fluidDir=path.join(build,'fluid-v4-contact'),fm=JSON.parse(fs.readFileSync(path.join(fluidDir,'manifest.json')));
for(let i=0;i<fm.frames.length;i++){
 const item=fm.frames[i],data=gunzipSync(fs.readFileSync(path.join(fluidDir,item.file))),b=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),count=item.count;
 manifest.frames.push(pack(Float32Array.from(new Int16Array(b,0,count*3),n=>n/512),Float32Array.from(new Int16Array(b,count*6,count*3),n=>n/32767),Uint32Array.from({length:count},(_,i)=>i),new Float32Array(count).fill(7),`${String(i).padStart(3,'0')}.ray.gz`));
 if(i%12===0)console.log('fluid ray tree '+i);
}
manifest.complete=true;fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest));console.log(JSON.stringify({out,frames:manifest.frames.length,bytes:manifest.frames.reduce((n,f)=>n+f.bytes,0)}));
