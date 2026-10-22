import * as THREE from './vendor/three-r180/three.module.min.js';
import {fetchArtifact} from './artifact-fetch.mjs';

export async function loadFluid(group,onChange,{base='./assets/instrument-fluid/',material:providedMaterial,initialFrame=0,cacheFrames=8}={}){
  const manifest=await fetchArtifact(base+'manifest.json',{json:true});
  if(!manifest.complete||manifest.frames.length<2||!(manifest.frameDt>0))throw Error('Incomplete FLIP surface bake');
  const capacity=Math.max(...manifest.frames.map(f=>f.vertexCount||f.count)),indexCapacity=Math.max(...manifest.frames.map(f=>f.count)),cache=new Map();
  const cacheLimit=Math.max(1,Math.min(manifest.frames.length,Math.floor(cacheFrames)||8));
  const positions=new Float32Array(capacity*3),normals=new Int16Array(capacity*3);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3,true).setUsage(THREE.DynamicDrawUsage));
  let optics;
  if(manifest.optics){
    if(manifest.optics.version!==1||manifest.optics.stride!==14)throw Error('Unsupported fluid transport bake');
    optics=new THREE.InterleavedBuffer(new Float32Array(capacity*14),14).setUsage(THREE.DynamicDrawUsage);
    for(const [name,size,offset] of [['opticalExit',3,0],['opticalDirection',3,3],['opticalReturn',3,6],['opticalReflection',3,9],['opticalWeight',2,12]])geometry.setAttribute(name,new THREE.InterleavedBufferAttribute(optics,size,offset));
  }
  const indices=new Uint32Array(indexCapacity);for(let k=0;k<indexCapacity;k++)indices[k]=k;
  geometry.setIndex(new THREE.BufferAttribute(indices,1).setUsage(THREE.DynamicDrawUsage));
  geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),55);
  const material=providedMaterial||new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.008,transmission:1,ior:1.333,thickness:35,attenuationColor:0xafd7d9,attenuationDistance:180,transparent:true,depthWrite:false,side:THREE.DoubleSide,dithering:true});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='elements/baked-FLIP';mesh.renderOrder=1;mesh.userData.staticWater=true;mesh.userData.bakedFluid=true;mesh.userData.meshRecord={module:'elements',material:7};group.add(mesh);
  mesh.userData.bakedOptics=manifest.optics||null;
  let wanted=Math.max(0,Math.min(manifest.frames.length-1,Math.round(initialFrame))),displayed=-1,busy=false,failed=null,disposed=false,pendingUpdate=null;
  const inflight=new Map();
  async function decode(i){
    if(cache.has(i)){const f=cache.get(i);cache.delete(i);cache.set(i,f);return f;}
    if(inflight.has(i))return inflight.get(i);
    const task=read(i);inflight.set(i,task);
    try{return await task;}finally{inflight.delete(i);}
  }
  async function read(i){
    const item=manifest.frames[i],raw=await fetchArtifact(base+item.file+'?v='+item.sha256);
    const count=item.vertexCount||item.count,indexed=manifest.format==='indexed-q16';
    if(raw.byteLength!==count*12+(indexed?item.count*4:0))throw Error('Invalid FLIP frame length');
    const p=new Int16Array(raw,0,count*3),n=new Int16Array(raw,count*6,count*3),ix=indexed?new Uint32Array(raw,count*12,item.count):null;
    let transport=null;if(optics){const bytes=await fetchArtifact(base+item.optics.file+'?v='+item.optics.sha256),quantized=manifest.optics.format==='q16';if(bytes.byteLength!==count*14*(quantized?2:4))throw Error('Invalid fluid transport frame');if(quantized){const q=new Int16Array(bytes);transport=Float32Array.from(q,(v,i)=>{const k=i%14;return v/(k===13?32:k<3||(k>=6&&k<9)?256:32767);});}else transport=new Float32Array(bytes);}
    const f={p,n,transport,ix,count,indexCount:item.count};if(!disposed)cache.set(i,f);while(cache.size>cacheLimit)cache.delete(cache.keys().next().value);
    return f;
  }
  async function update(){
    if(busy||wanted===displayed||failed)return;busy=true;
    try{
      while(wanted!==displayed&&!disposed){
        const i=wanted,f=await decode(i);
        if(disposed)return;
        if(i!==wanted)continue;
        for(let k=0;k<f.p.length;k++)positions[k]=f.p[k]/manifest.positionScale;
        normals.set(f.n);geometry.setDrawRange(0,f.indexCount);
        if(f.ix){indices.set(f.ix);geometry.index.clearUpdateRanges();geometry.index.addUpdateRange(0,f.indexCount);geometry.index.needsUpdate=true;}
        if(optics){optics.array.set(f.transport);optics.clearUpdateRanges();optics.addUpdateRange(0,f.count*14);optics.needsUpdate=true;}
        // The inactive capacity must not enlarge the optical chord field.
        if(!f.bounds){const bounds=new THREE.Box3();for(let k=0;k<f.count;k++){const q=k*3;bounds.min.x=Math.min(bounds.min.x,positions[q]);bounds.min.y=Math.min(bounds.min.y,positions[q+1]);bounds.min.z=Math.min(bounds.min.z,positions[q+2]);bounds.max.x=Math.max(bounds.max.x,positions[q]);bounds.max.y=Math.max(bounds.max.y,positions[q+1]);bounds.max.z=Math.max(bounds.max.z,positions[q+2]);}f.bounds=bounds;}
        geometry.boundingBox=f.bounds;
        // Upload only this frame's active vertices, not maximum bake capacity.
        for(const attribute of [geometry.attributes.position,geometry.attributes.normal]){attribute.clearUpdateRanges();attribute.addUpdateRange(0,f.count*3);}
        geometry.attributes.position.needsUpdate=true;geometry.attributes.normal.needsUpdate=true;
        displayed=i;onChange();
      }
    }catch(error){failed=error.message;console.error(error);}finally{busy=false;}
  }
  async function setFrame(i){
    if(disposed)return false;
    const requested=Math.max(0,Math.min(manifest.frames.length-1,Math.round(i)));wanted=requested;
    if(!busy)pendingUpdate=update();
    await pendingUpdate;
    if(failed)throw Error(failed);
    return !disposed&&displayed===requested;
  }
  await update();if(failed){geometry.dispose();if(!providedMaterial)material.dispose();group.remove(mesh);throw Error(failed);}
  return {mesh,frameCount:manifest.frames.length,setFrame,
    prefetch(indices){return Promise.all(indices.filter(i=>i>=0&&i<manifest.frames.length).map(decode));},
    setProgress(p){void setFrame(Math.max(0,Math.min(1,p))*(manifest.frames.length-1)).catch(()=>{});},
    snapshot:()=>({frame:displayed,target:wanted,pending:busy,cachedFrames:cache.size,failed,particles:manifest.frames[0].particles??null,gridMillimetres:manifest.config?.h?manifest.config.h*1000:null,surfaceTriangles:displayed>=0?manifest.frames[displayed].count/3:0,simulationSeconds:manifest.frames.length*manifest.frameDt,lineage:manifest.lineage,solver:manifest.solver}),
    dispose(){disposed=true;geometry.dispose();if(!providedMaterial)material.dispose();group.remove(mesh);cache.clear();}};
}
