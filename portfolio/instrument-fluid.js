import * as THREE from './vendor/three-r180/three.module.min.js';

export async function loadFluid(group,onChange,{base='./assets/instrument-fluid/',material:providedMaterial}={}){
  const manifest=await fetch(base+'manifest.json',{cache:'no-store'}).then(r=>r.json());
  if(!manifest.complete||manifest.frames.length<2||!(manifest.frameDt>0))throw Error('Incomplete FLIP surface bake');
  const capacity=Math.max(...manifest.frames.map(f=>f.count)),cache=new Map();
  const positions=new Float32Array(capacity*3),normals=new Int16Array(capacity*3);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3,true).setUsage(THREE.DynamicDrawUsage));
  const indices=new Uint32Array(capacity);for(let k=0;k<capacity;k++)indices[k]=k;
  geometry.setIndex(new THREE.BufferAttribute(indices,1));
  geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),55);
  const material=providedMaterial||new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.008,transmission:1,ior:1.333,thickness:35,attenuationColor:0xafd7d9,attenuationDistance:180,transparent:true,depthWrite:false,side:THREE.DoubleSide,dithering:true});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='elements/baked-FLIP';mesh.renderOrder=1;mesh.userData.staticWater=true;mesh.userData.bakedFluid=true;mesh.userData.meshRecord={module:'elements',material:7};group.add(mesh);
  let wanted=0,displayed=-1,busy=false,failed=null,disposed=false,pendingUpdate=null;
  const inflight=new Map();
  async function decode(i){
    if(cache.has(i)){const f=cache.get(i);cache.delete(i);cache.set(i,f);return f;}
    if(inflight.has(i))return inflight.get(i);
    const task=read(i);inflight.set(i,task);
    try{return await task;}finally{inflight.delete(i);}
  }
  async function read(i){
    const item=manifest.frames[i],response=await fetch(base+item.file+'?v='+item.sha256);
    if(!response.ok)throw Error('Fluid frame unavailable: '+i);
    const raw=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if(raw.byteLength!==item.count*12)throw Error('Invalid FLIP frame length');
    const p=new Int16Array(raw,0,item.count*3),n=new Int16Array(raw,item.count*6,item.count*3);
    const f={p,n,count:item.count};if(!disposed)cache.set(i,f);while(cache.size>8)cache.delete(cache.keys().next().value);
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
        normals.set(f.n);geometry.setDrawRange(0,f.count);
        // The inactive capacity must not enlarge the optical chord field.
        const bounds=new THREE.Box3();for(let k=0;k<f.count;k++){const q=k*3;bounds.min.x=Math.min(bounds.min.x,positions[q]);bounds.min.y=Math.min(bounds.min.y,positions[q+1]);bounds.min.z=Math.min(bounds.min.z,positions[q+2]);bounds.max.x=Math.max(bounds.max.x,positions[q]);bounds.max.y=Math.max(bounds.max.y,positions[q+1]);bounds.max.z=Math.max(bounds.max.z,positions[q+2]);}geometry.boundingBox=bounds;
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
  await update();if(failed)throw Error(failed);
  return {mesh,frameCount:manifest.frames.length,setFrame,
    prefetch(indices){return Promise.all(indices.filter(i=>i>=0&&i<manifest.frames.length).map(decode));},
    setProgress(p){void setFrame(Math.max(0,Math.min(1,p))*(manifest.frames.length-1)).catch(()=>{});},
    snapshot:()=>({frame:displayed,target:wanted,pending:busy,cachedFrames:cache.size,failed,particles:manifest.frames[0].particles,gridMillimetres:manifest.config.h*1000,surfaceTriangles:displayed>=0?manifest.frames[displayed].count/3:0,simulationSeconds:manifest.frames.length*manifest.frameDt,lineage:manifest.lineage}),
    dispose(){disposed=true;geometry.dispose();if(!providedMaterial)material.dispose();group.remove(mesh);cache.clear();}};
}
