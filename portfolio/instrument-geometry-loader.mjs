import {geometrySegments} from './instrument-geometry-codec.mjs';

export async function loadGeometry(manifest,base,{onProgress=()=>{},legacy=false,metrics={}}={}) {
  const transfer=manifest.losslessTransfer;
  if(!transfer||legacy||typeof Worker==='undefined'||!globalThis.crypto?.subtle){
    onProgress('Loading the full CAD instrument.');
    const start=performance.now(),response=await fetch(`${base}instrument.bin.gz?v=${manifest.stats.sha256}`);
    if(!response.ok)throw Error('CAD download unavailable: '+response.status);
    const buffer=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    Object.assign(metrics,{format:'original-gzip',compressedBytes:manifest.stats.geometryBytes,downloadAndInflateMs:performance.now()-start});
    return buffer;
  }
  if(transfer.format!=='attribute-xor-byteplanes-gzip-v1')throw Error('Unknown CAD transfer format');
  const worker=new Worker(new URL('./instrument-geometry-worker.mjs',import.meta.url),{type:'module'});
  try{
    return await new Promise((resolve,reject)=>{
      worker.onerror=event=>reject(Error(event.message||'CAD loader could not start'));
      worker.onmessage=({data})=>{
        if(data.phase==='error'){reject(Error(data.message));return;}
        if(data.phase==='complete'){
          Object.assign(metrics,{format:transfer.format,...data.metrics});resolve(data.buffer);return;
        }
        onProgress(data.phase==='restore'?'Verifying the original CAD geometry.':
          `Loading full CAD: ${(data.received/1e6).toFixed(1)} / ${(data.total/1e6).toFixed(1)} MB.`);
      };
      worker.postMessage({url:new URL(`${base}${transfer.file}?v=${transfer.sha256}`,location.href).href,
        segments:geometrySegments(manifest.meshes),transfer,decodedBytes:manifest.stats.decodedGeometryBytes,sha256:manifest.stats.sha256});
    });
  }finally{worker.terminate();}
}
