import {restoreGeometryBytes} from './instrument-geometry-codec.mjs';

self.onmessage=async({data:{url,segments,transfer,decodedBytes,sha256}})=>{
  try{
    const start=performance.now(),response=await fetch(url);
    if(!response.ok)throw Error('CAD download unavailable: '+response.status);
    let received=0,last=0;
    const progress=new TransformStream({transform(chunk,controller){
      received+=chunk.byteLength;
      const now=performance.now();
      if(now-last>120){self.postMessage({phase:'download',received,total:transfer.bytes});last=now;}
      controller.enqueue(chunk);
    }});
    const shuffled=await new Response(response.body.pipeThrough(progress).pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if(received!==transfer.bytes||shuffled.byteLength!==decodedBytes)throw Error('CAD transfer revision mismatch');
    self.postMessage({phase:'restore',received,total:transfer.bytes});
    const downloaded=performance.now(),buffer=restoreGeometryBytes(shuffled,segments);
    const restored=performance.now();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),x=>x.toString(16).padStart(2,'0')).join('');
    if(hash!==sha256)throw Error('CAD byte identity check failed');
    self.postMessage({phase:'complete',buffer,metrics:{compressedBytes:received,decodedBytes,downloadAndInflateMs:downloaded-start,
      restoreMs:restored-downloaded,verifyMs:performance.now()-restored,decodedSHA256:hash}},[buffer]);
  }catch(error){self.postMessage({phase:'error',message:error.message});}
};
