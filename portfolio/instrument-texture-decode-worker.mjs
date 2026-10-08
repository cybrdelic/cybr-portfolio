// Decode encoded original bytes off the document thread. No canvas round trip.
export const TEXTURE_BITMAP_OPTIONS=Object.freeze({imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
export function createTextureDecodeHandler({fetchImage=fetch,decode=createImageBitmap,send,now=()=>performance.now()}={}){
  let queue=Promise.resolve();
  return function receive({id,url}){
    // Start network requests together, but bound decode concurrency to one.
    const blob=Promise.resolve().then(()=>fetchImage(url,{credentials:'same-origin'})).then(response=>{
      if(!response.ok)throw Error('Original texture HTTP '+response.status);
      return response.blob();
    });
    // Attach rejection immediately, even while earlier decodes are pending.
    const fetched=blob.then(value=>({value}),error=>({error}));
    queue=queue.then(async()=>{
      let bitmap;
      try{
        const result=await fetched;if(result.error)throw result.error;
        const started=now();bitmap=await decode(result.value,TEXTURE_BITMAP_OPTIONS);
        send({id,bitmap,decodeMs:now()-started},[bitmap]);bitmap=undefined;
      }catch(error){
        bitmap?.close();send({id,error:String(error?.message??error)});
      }
    });
    return queue;
  };
}
if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope){
  const receive=createTextureDecodeHandler({send:(message,transfer)=>postMessage(message,transfer)});
  globalThis.onmessage=event=>receive(event.data);
}
