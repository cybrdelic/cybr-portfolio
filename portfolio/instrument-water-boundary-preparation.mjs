import {waterOuterBoundaryIndices} from './instrument-water-boundary.mjs';

const optical=material=>(material?.userData?.cadTransmission??material?.transmission??0)>0;
export function waterBoundaryObjects(objects){
  return objects.filter(object=>!Array.isArray(object.material)&&optical(object.material)&&
    (object.userData.staticWater||object.material.ior<1.4)&&!object.userData.bakedFluid);
}
export function matchingWaterBoundary(prepared,geometry){
  const record=prepared?.get(geometry),position=geometry.getAttribute('position'),index=geometry.getIndex();
  return record&&record.position===position&&record.index===index&&
    record.positionVersion===position.version&&record.indexVersion===index.version?record.result:null;
}
export async function prepareWaterBoundaries(objects,{WorkerConstructor=globalThis.Worker,
  clock=()=>performance.now(),cancelled=()=>false,onProgress=()=>{},metrics={}}={}){
  const started=clock(),prepared=new Map(),records=[];
  for(const object of waterBoundaryObjects(objects)){
    const geometry=object.geometry;if(records.some(record=>record.geometry===geometry))continue;
    const position=geometry.getAttribute('position'),index=geometry.getIndex();
    records.push({geometry,position,index,positionVersion:position.version,indexVersion:index.version});
  }
  const check=()=>{if(cancelled())throw Error('Water boundary preparation cancelled');};
  check();
  if(!records.length){Object.assign(metrics,{backend:'empty',meshes:0,elapsedMs:clock()-started});return prepared;}
  if(typeof WorkerConstructor!=='function'||records.some(record=>record.position.isInterleavedBufferAttribute||record.index.isInterleavedBufferAttribute)){
    for(const record of records){check();record.result=waterOuterBoundaryIndices(record.position,record.index);prepared.set(record.geometry,record);await new Promise(resolve=>setTimeout(resolve,0));}
    Object.assign(metrics,{backend:'synchronous compatibility fallback',meshes:records.length,elapsedMs:clock()-started});return prepared;
  }
  const copiedAt=clock(),jobs=records.map((record,id)=>({id,
    position:{array:record.position.array.slice(),itemSize:record.position.itemSize,normalized:record.position.normalized},
    index:{array:record.index.array.slice(),itemSize:record.index.itemSize,normalized:record.index.normalized}}));
  const copyMs=clock()-copiedAt,inputCopyBytes=jobs.reduce((sum,job)=>sum+job.position.array.byteLength+job.index.array.byteLength,0);
  const worker=new WorkerConstructor(new URL('./instrument-water-boundary-worker.mjs',import.meta.url),{type:'module'});
  try{
    const workerMs=await new Promise((resolve,reject)=>{
      worker.onerror=event=>reject(Error(event.message||'Water boundary worker could not start'));
      worker.onmessage=({data})=>{
        try{
          check();
          if(data.phase==='error')throw Error(data.message);
          if(data.phase==='complete'){
            if(prepared.size!==records.length)throw Error('Incomplete water boundary preparation');
            resolve(data.workerMs);return;
          }
          if(data.phase!=='boundary')throw Error('Unknown water boundary worker response');
          const record=records[data.id];if(!record||prepared.has(record.geometry))throw Error('Invalid water boundary worker result');
          if(record.geometry.getAttribute('position')!==record.position||record.geometry.getIndex()!==record.index||record.position.version!==record.positionVersion||record.index.version!==record.indexVersion)throw Error('Water geometry changed during preparation');
          if(!data.usesSourceIndices&&!(data.indices instanceof record.index.array.constructor))throw Error('Invalid water boundary index type');
          record.result={indices:data.usesSourceIndices?record.index.array:data.indices,audit:data.audit};
          prepared.set(record.geometry,record);onProgress(prepared.size,records.length);
        }catch(error){reject(error);}
      };
      worker.postMessage({jobs},jobs.flatMap(job=>[job.position.array.buffer,job.index.array.buffer]));
    });
    check();Object.assign(metrics,{backend:'module worker',meshes:records.length,inputCopyBytes,copyMs,workerMs,elapsedMs:clock()-started});
    return prepared;
  }finally{worker.terminate();}
}
