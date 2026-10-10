// Verified original-map path, with explicit DOM rollback and API support guards.
export function textureWorkerEligible({requested,mobile,bakedElements,qualityMode,opticalMode,workerSupported=typeof globalThis.Worker==='function',bitmapSupported=typeof globalThis.createImageBitmap==='function'}){
  return (requested==null||requested==='worker')&&workerSupported&&bitmapSupported&&bakedElements&&!qualityMode&&opticalMode==='thickness';
}
export function createTextureDecodeClient({THREE,baseURL,makeWorker=()=>new Worker(new URL('./instrument-texture-decode-worker.mjs',import.meta.url),{type:'module'})}={}){
  let worker,nextID=0,disposed=false,failed=false;
  const pending=new Map(),owned=new Map();
  const stats={mode:'worker-bitmap',completed:0,workerDecodeMs:0,workerReleased:false};
  function stop(error){
    worker?.terminate();worker=undefined;stats.workerReleased=true;
    for(const entry of pending.values())entry.reject(error);pending.clear();
  }
  function start(){
    if(worker)return;
    worker=makeWorker();stats.workerReleased=false;
    worker.onmessage=({data})=>{
      const entry=pending.get(data.id);
      if(!entry){data.bitmap?.close();return;}
      pending.delete(data.id);
      if(data.error){entry.reject(Error(data.error+' ['+entry.url+']'));return;}
      const bitmap=data.bitmap;
      if(!bitmap||!(bitmap.width>0&&bitmap.height>0)){bitmap?.close();entry.reject(Error('Invalid decoded texture'));return;}
      try{
        const texture=new THREE.Texture(bitmap);
        // Three ignores flipY/premultiplyAlpha for ImageBitmap: the worker has
        // already applied the equivalent original TextureLoader upload options.
        texture.userData={...texture.userData,originalTextureURL:entry.url,bitmapOrientation:'flipY'};
        texture.needsUpdate=true;
        const close=()=>{if(!owned.has(texture))return;owned.delete(texture);bitmap.close();texture.removeEventListener('dispose',close);};
        owned.set(texture,close);texture.addEventListener('dispose',close);
        stats.completed++;stats.workerDecodeMs+=data.decodeMs??0;entry.resolve(texture);
      }catch(error){bitmap.close();entry.reject(error);}
    };
    worker.onerror=event=>{event.preventDefault?.();failed=true;stop(Error('Texture decode worker failed'));};
    worker.onmessageerror=()=>{failed=true;stop(Error('Texture decode transfer failed'));};
  }
  return{
    loadAsync(url){
      if(disposed||failed)return Promise.reject(Error('Texture decoder unavailable'));
      try{start();}catch(error){failed=true;return Promise.reject(error);}
      const absolute=new URL(url,baseURL).href,id=++nextID;
      return new Promise((resolve,reject)=>{
        pending.set(id,{resolve,reject,url:absolute});
        try{worker.postMessage({id,url:absolute});}catch(error){pending.delete(id);reject(error);}
      });
    },
    finish(){if(pending.size)throw Error('Texture decoding still pending');stop(Error('Texture decoder finished'));},
    snapshot:()=>({...stats,pending:pending.size,retainedBitmaps:owned.size,disposed}),
    dispose(){if(disposed)return;disposed=true;stop(Error('Texture decoder disposed'));for(const [texture] of owned)texture.dispose();}
  };
}
