import * as THREE from './vendor/three-r180/three.module.min.js';
import {waterOuterBoundaryIndices} from './instrument-water-boundary.mjs';

// Inputs are private copies. The main renderer retains all original CAD bytes.
export function classifyWaterBoundaryJob({id,position,index}){
  const p=new THREE.BufferAttribute(position.array,position.itemSize,position.normalized);
  const i=new THREE.BufferAttribute(index.array,index.itemSize,index.normalized);
  const result=waterOuterBoundaryIndices(p,i);
  const usesSourceIndices=result.indices===i.array;
  return {id,usesSourceIndices,indices:usesSourceIndices?null:result.indices,audit:result.audit};
}

self.onmessage=({data:{jobs}})=>{
  try{
    const started=performance.now();
    for(const job of jobs){
      const result=classifyWaterBoundaryJob(job);
      self.postMessage({phase:'boundary',...result},result.indices?[result.indices.buffer]:[]);
    }
    self.postMessage({phase:'complete',workerMs:performance.now()-started});
  }catch(error){self.postMessage({phase:'error',message:error.message});}
};
