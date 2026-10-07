import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {loadInstrumentPbrWearAssets} from './instrument-pbr-wear-assets.mjs';
const alloys={AluminumWear:'aluminum',SteelWear:'steel',BronzeWear:'bronze'};
async function fixture(run,{fail,invalid=false}={}){
  const previous=globalThis.fetch,owned=[],requests=[];
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.cache,'no-store');requests.push(url);
    const name=/pbr-custom-worn\/([^/]+)\/source\.json$/.exec(url)?.[1];assert.ok(alloys[name]);
    return{ok:true,json:async()=>({source:'Original CYBR wear',customMadeFor:'CYBR portfolio instrument',alloy:invalid&&name==='SteelWear'?'bronze':alloys[name],downloadedInputs:[],authoredTileMM:[128,128],runtimeMaps:{colorCoverage:{sha256:'color'},surface:{sha256:'surface'},normal:{sha256:'normal'}}})};
  };
  class TextureLoader{
    async loadAsync(url){
      requests.push(url);assert.match(url,/\?v=(color|surface|normal)$/);
      if(fail&&url.includes(fail))throw Error('wear map failure');
      await new Promise(resolve=>setTimeout(resolve,5));
      const texture=new THREE.Texture();texture.disposals=0;texture.addEventListener('dispose',()=>texture.disposals++);owned.push(texture);return texture;
    }
  }
  try{await run({...THREE,TextureLoader},owned,requests);}finally{globalThis.fetch=previous;}
}
test('alloy macro wear maps keep color/data spaces and share one owned copy per alloy',async()=>{
  await fixture(async(runtime,owned)=>{
    const loaded=await loadInstrumentPbrWearAssets(runtime,{maxAnisotropy:4});
    assert.deepEqual(Object.keys(loaded.alloys),['aluminum','steel','bronze']);
    for(const [alloy,entry] of Object.entries(loaded.alloys)){
      assert.equal(entry.wearAlloy,alloy);assert.deepEqual(entry.wearTileMM,[128,128]);
      assert.equal(entry.wearMaps.color.colorSpace,THREE.SRGBColorSpace);
      assert.equal(entry.wearMaps.surface.colorSpace,THREE.NoColorSpace);assert.equal(entry.wearMaps.normal.colorSpace,THREE.NoColorSpace);
      assert.equal(entry.wearMaps.normal.anisotropy,4);
    }
    assert.equal(loaded.snapshot().textureCount,9);assert.deepEqual(loaded.snapshot().downloadedMaterialInputs,[]);
    loaded.dispose();loaded.dispose();assert.ok(owned.every(t=>t.disposals===1));
  });
});
test('wrong alloy provenance rejects without assigning bronze wear to steel',async()=>{
  await fixture(async(runtime,owned)=>{
    await assert.rejects(()=>loadInstrumentPbrWearAssets(runtime),/Custom alloy wear provenance/);
    assert.equal(owned.length,6);assert.ok(owned.every(t=>t.disposals===1));
  },{invalid:true});
});
test('failed wear map waits for delayed successful maps before disposing all allocations',async()=>{
  await fixture(async(runtime,owned)=>{
    await assert.rejects(()=>loadInstrumentPbrWearAssets(runtime),/wear map failure/);
    assert.equal(owned.length,8);assert.ok(owned.every(t=>t.disposals===1));
  },{fail:'SteelWear/runtime/normal'});
});
