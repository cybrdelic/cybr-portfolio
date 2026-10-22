// Keep Three's image loader, URL resolution, cache, CORS policy and original
// image content. Only an individual failed image may be retried, never a scene.
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const short=value=>String(value).slice(0,360);

function errorReason(error){
 if(typeof error?.message==='string'&&error.message)return short(error.message);
 if(error?.type==='error')return 'Image error event; browser did not expose the network or decode reason';
 if(error?.type)return short(error.type);
 if(typeof error==='string')return short(error);
 return 'Image load rejected without an error message';
}

function requestedURL(loader,url,error){
 // An image event supplies the actual URL, including any manager URL modifier.
 const image=error?.target,actual=image?.currentSrc||image?.src;
 const value=actual||String(loader.path??'')+url;
 if(value.startsWith('data:'))return '[embedded image data URL]';
 try{return new URL(value,globalThis.document?.baseURI??import.meta.url).href;}
 catch{return value;}
}

function canRetry(error){
 // Image error events hide HTTP/decode details; a single retry is useful but
 // does not establish that the first failure was transient. Never retry a
 // cancellation, security denial, or explicit programming/configuration error.
 const name=error?.name;
 return error?.type!=='abort'&&!['AbortError','SecurityError','TypeError','RangeError','SyntaxError'].includes(name);
}

export async function loadTextureAsset(loader,url,{retryDelayMs=120,delay=wait}={}){
 if(!loader||typeof loader.loadAsync!=='function')throw new TypeError('Texture asset requires a loader with loadAsync');
 const request=String(url);
 if(!request||!Number.isFinite(retryDelayMs)||retryDelayMs<0||typeof delay!=='function')throw new TypeError('Invalid texture load URL or retry options');
 for(let attempt=1;attempt<=2;attempt++){
  let started=false;
  try{
   const pending=loader.loadAsync(request);started=true;
   return await pending;
  }catch(cause){
   if(attempt===1&&started&&canRetry(cause)){await delay(retryDelayMs);continue;}
   const assetURL=requestedURL(loader,request,cause);
   const error=new Error(`Texture load failed after ${attempt} attempt${attempt===1?'':'s'}: ${assetURL} (${errorReason(cause)})`,{cause});
   error.name='TextureAssetLoadError';error.url=assetURL;error.attempts=attempt;
   throw error;
  }
 }
}

export async function loadTextureAssets(loader,urls,options){
 // Settle this small batch so a rejected sibling cannot leave an unowned
 // decoded/GPU texture behind, or finish after the failure has been reported.
 const results=await Promise.allSettled(urls.map(url=>loadTextureAsset(loader,url,options)));
 const failed=results.find(result=>result.status==='rejected');
 if(failed){
  const released=new Set();
  for(const result of results)if(result.status==='fulfilled'&&!released.has(result.value)){
   released.add(result.value);result.value?.dispose?.();
  }
  throw failed.reason;
 }
 return results.map(result=>result.value);
}
