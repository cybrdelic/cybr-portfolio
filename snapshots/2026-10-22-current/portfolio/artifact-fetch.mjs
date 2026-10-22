// Accept both static gzip files and servers that already decode Content-Encoding.
export async function decodedResponseBytes(response){
 if(!response.body)return response.arrayBuffer();
 const reader=response.body.getReader(),prefix=[];let length=0,ended=false;
 while(length<2){const part=await reader.read();if(part.done){ended=true;break;}prefix.push(part.value);length+=part.value.byteLength;}
 const head=new Uint8Array(Math.min(length,2));let offset=0;
 for(const chunk of prefix){const n=Math.min(chunk.byteLength,head.length-offset);head.set(chunk.subarray(0,n),offset);offset+=n;if(offset===head.length)break;}
 const stream=new ReadableStream({start(controller){for(const chunk of prefix)controller.enqueue(chunk);if(ended)controller.close();},async pull(controller){try{const part=await reader.read();if(part.done)controller.close();else controller.enqueue(part.value);}catch(error){controller.error(error);}},cancel(reason){return reader.cancel(reason);}});
 if(head[0]===31&&head[1]===139){
  if(typeof DecompressionStream==='undefined'){await reader.cancel();throw Error('This browser does not support gzip asset decoding');}
  return new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 }
 return new Response(stream).arrayBuffer();
}
export async function fetchArtifact(url,{json=false,timeout=20000,retries=1}={}){
 for(let attempt=0;;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
   const response=await fetch(url,{signal:controller.signal});
   if(!response.ok)throw Error(`HTTP ${response.status}`);
   const bytes=await decodedResponseBytes(response);
   return json?JSON.parse(new TextDecoder().decode(bytes)):bytes;
  }catch(error){if(attempt>=retries)throw Error(`${url}: ${error.name==='AbortError'?'download timed out':error.message}`);}
  finally{clearTimeout(timer);}
 }
}
