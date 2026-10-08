import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {createTextureDecodeClient,textureWorkerEligible} from './instrument-texture-decode.mjs';
import {createTextureDecodeHandler,TEXTURE_BITMAP_OPTIONS} from './instrument-texture-decode-worker.mjs';
import {loadInstrumentPbrAssets} from './instrument-pbr-custom-assets.mjs';
import {loadInstrumentPbrWearAssets} from './instrument-pbr-wear-assets.mjs';

function fixture(){
  const worker={sent:[],terminations:0,postMessage(m){this.sent.push(m);},terminate(){this.terminations++;}};
  const client=createTextureDecodeClient({THREE,baseURL:'https://test.invalid/portfolio/',makeWorker:()=>worker});
  const bitmap=()=>({width:2048,height:2048,closed:0,close(){this.closed++;}});
  const deliver=(id,b=bitmap())=>{worker.onmessage({data:{id,bitmap:b,decodeMs:7}});return b;};
  return{worker,client,bitmap,deliver};
}
test('experimental selection excludes secondary CPU optics and quality renderers',()=>{
  const options={requested:'worker',mobile:true,bakedElements:true,qualityMode:false,opticalMode:'thickness'};
  assert.equal(textureWorkerEligible(options),true);
  for(const patch of [{requested:null},{mobile:false},{bakedElements:false},{qualityMode:true},{opticalMode:'geometry'},{opticalMode:'staged'}])assert.equal(textureWorkerEligible({...options,...patch}),false);
});
test('worker starts fetches together, serializes decode, transfers original bitmap with explicit semantics',async()=>{
  const fetched=[],decoded=[],sent=[];let unblock,active=0,maxActive=0;
  const held=new Promise(resolve=>unblock=resolve);
  const receive=createTextureDecodeHandler({fetchImage:async(url,options)=>{fetched.push(url);assert.equal(options.credentials,'same-origin');return{ok:true,blob:async()=>url};},decode:async(blob,options)=>{
    active++;maxActive=Math.max(maxActive,active);decoded.push(blob);assert.deepEqual(options,{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
    if(blob==='first')await held;active--;return{width:2048,height:2048,close(){}};
  },send:(message,transfer)=>sent.push({message,transfer}),now:()=>1});
  const first=receive({id:1,url:'first'}),second=receive({id:2,url:'second'});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(fetched,['first','second']);assert.deepEqual(decoded,['first']);unblock();await Promise.all([first,second]);
  assert.equal(maxActive,1);assert.deepEqual(decoded,['first','second']);for(const row of sent)assert.equal(row.transfer[0],row.message.bitmap);
  assert.equal(Object.isFrozen(TEXTURE_BITMAP_OPTIONS),true);
});
test('network failure does not prevent later queued maps decoding',async()=>{
  const sent=[];const receive=createTextureDecodeHandler({fetchImage:async url=>({ok:url!=='bad',status:404,blob:async()=>url}),decode:async()=>({close(){}}),send:m=>sent.push(m)});
  await Promise.all([receive({id:1,url:'bad'}),receive({id:2,url:'good'})]);assert.match(sent[0].error,/404/);assert.ok(sent[1].bitmap);
});
test('transfer failure closes untransferred bitmap',async()=>{
  let closed=0;const messages=[];const receive=createTextureDecodeHandler({fetchImage:async()=>({ok:true,blob:async()=>null}),decode:async()=>({close(){closed++;}}),send:(m,t)=>{if(t)throw Error('transfer');messages.push(m);}});
  await receive({id:1,url:'map'});assert.equal(closed,1);assert.match(messages[0].error,/transfer/);
});
test('client keeps original Three defaults and closes bitmap once at texture disposal',async()=>{
  const {client,worker,deliver}=fixture();const waiting=client.loadAsync('./map.webp?v=immutable');const bitmap=deliver(1),texture=await waiting,original=new THREE.Texture();
  assert.equal(worker.sent[0].url,'https://test.invalid/portfolio/map.webp?v=immutable');
  for(const key of ['flipY','premultiplyAlpha','format','type','generateMipmaps','minFilter','magFilter','colorSpace'])assert.equal(texture[key],original[key],key);
  assert.equal(texture.image,bitmap);client.finish();assert.equal(worker.terminations,1);assert.equal(bitmap.closed,0);
  texture.dispose();texture.dispose();client.dispose();assert.equal(bitmap.closed,1);assert.equal(client.snapshot().retainedBitmaps,0);
});
test('dispose rejects pending maps and closes stale transferred results',async()=>{
  const {client,worker,deliver}=fixture();const waiting=client.loadAsync('map');const rejection=assert.rejects(waiting,/disposed/);client.dispose();await rejection;
  const late=deliver(1);assert.equal(late.closed,1);assert.equal(worker.terminations,1);await assert.rejects(client.loadAsync('map'),/unavailable/);
});
test('worker failure rejects all pending and cannot restart silently',async()=>{
  const {client,worker}=fixture();const a=client.loadAsync('a'),b=client.loadAsync('b');const rejected=[assert.rejects(a,/worker failed/),assert.rejects(b,/worker failed/)];
  worker.onerror({preventDefault(){}});await Promise.all(rejected);assert.equal(worker.terminations,1);await assert.rejects(client.loadAsync('c'),/unavailable/);
});
test('bad dimensions reject and close bitmap',async()=>{
  const {client,deliver,bitmap}=fixture();const b=bitmap();b.width=0;const waiting=client.loadAsync('map');deliver(1,b);await assert.rejects(waiting,/Invalid decoded/);assert.equal(b.closed,1);client.dispose();
});
test('injected PBR delivery preserves URLs, aliases, colors, filtering and owned cleanup',async()=>{
  const prior=globalThis.fetch,urls=[],textures=[];
  globalThis.fetch=async url=>({ok:true,json:async()=>({customMadeFor:'CYBR portfolio instrument',downloadedInputs:[],authoredTileMM:[40,40],alloy:url.includes('Aluminum')?'aluminum':url.includes('Steel')?'steel':'bronze',runtimeMaps:{}})});
  const loadTexture=async url=>{urls.push(url);const t=new THREE.Texture();t.disposals=0;t.addEventListener('dispose',()=>t.disposals++);textures.push(t);return t;};
  const runtime={...THREE,TextureLoader:class{constructor(){throw Error('DOM loader must not run');}}};
  try{
    const fine=await loadInstrumentPbrAssets(runtime,{loadTexture}),wear=await loadInstrumentPbrWearAssets(runtime,{loadTexture,maxAnisotropy:4});
    assert.equal(urls.length,21);assert.equal(new Set(urls).size,21);assert.ok(urls.every(url=>url.includes('/runtime/')&&url.includes('?v=')));
    for(const asset of Object.values(fine.assets))assert.equal(asset.maps.roughness,asset.maps.metallic);
    for(const asset of Object.values(wear.alloys)){assert.equal(asset.wearMaps.color.colorSpace,THREE.SRGBColorSpace);assert.equal(asset.wearMaps.surface.colorSpace,THREE.NoColorSpace);assert.equal(asset.wearMaps.color.generateMipmaps,true);assert.equal(asset.wearMaps.normal.anisotropy,4);}
    fine.dispose();wear.dispose();assert.ok(textures.every(t=>t.disposals===1));
  }finally{globalThis.fetch=prior;}
});
