import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import{loadInstrumentPbrAssets,CUSTOM_PBR_ASSETS_VERSION}from './instrument-pbr-custom-assets.mjs';
import{configurePbrMetal,pbrUvFromMillimeters}from './instrument-pbr-materials.mjs';

const names=['BrushedMetal','LatheMetal','DiamondKnurl','DiamondEtch'];
const tiles={BrushedMetal:[40,40],LatheMetal:[120,120],DiamondKnurl:[279/17,10],DiamondEtch:[10.4,6.5]};
const metadata=name=>({source:'Original CYBR authoring fixture',customMadeFor:'CYBR portfolio instrument',creationMethod:'Custom appearance and physical height-derived normal/RM',downloadedInputs:[],authoredTileMM:tiles[name],runtimeMaps:Object.fromEntries(['baseColor','normal','roughnessMetallic'].map((key,i)=>[key,{sha256:(names.indexOf(name)*3+i).toString(16).repeat(64)}]))});
async function fixture(run,{invalidMetadata,failedMap,delayed=false,fallbackRevision=false}={}){
  const previousFetch=globalThis.fetch,requests=[],textures=[],sources=new Map();
  globalThis.fetch=async(path,options)=>{
    assert.equal(options?.cache,'no-store','authored metadata revisions must bypass stale HTTP caches');
    requests.push(path);const match=path.match(/^\.\/assets\/pbr-custom\/([^/]+)\/source\.json$/);assert.ok(match,'only authored custom metadata paths may load');assert.ok(names.includes(match[1]));
    const source=metadata(match[1]);if(fallbackRevision)delete source.runtimeMaps;if(invalidMetadata&&match[1]===names[0])invalidMetadata(source);sources.set(match[1],source);
    return{ok:true,json:async()=>source};
  };
  class TextureLoader{
    async loadAsync(path){
      requests.push(path);const match=path.match(/^\.\/assets\/pbr-custom\/(BrushedMetal|LatheMetal|DiamondKnurl|DiamondEtch)\/runtime\/(baseColor|normal|roughness-metallic)\.webp\?v=([^&]+)$/);assert.ok(match,'only revisioned authored custom map paths may load');
      const key=match[2]==='roughness-metallic'?'roughnessMetallic':match[2];assert.equal(decodeURIComponent(match[3]),sources.get(match[1]).runtimeMaps?.[key]?.sha256||CUSTOM_PBR_ASSETS_VERSION);
      if(path.split('?')[0]===failedMap)throw Error('fixture texture load failure');
      if(delayed)await new Promise(resolve=>setTimeout(resolve,5));
      const texture=new THREE.Texture();texture.disposals=0;texture.path=path;texture.addEventListener('dispose',()=>texture.disposals++);textures.push(texture);return texture;
    }
  }
  try{return await run({THREE:{...THREE,TextureLoader},requests,textures,sources});}
  finally{globalThis.fetch=previousFetch;}
}

test('custom loader uses four original map sets and exposes accurate provenance and authored profiles',async()=>{
  await fixture(async({THREE:runtime,requests,textures,sources})=>{
    const loaded=await loadInstrumentPbrAssets(runtime,{maxAnisotropy:4});
    try{
      assert.deepEqual(Object.keys(loaded.assets),names);assert.equal(requests.length,16);assert.equal(textures.length,12);
      assert.ok(requests.every(path=>!/(ambientcg|polyhaven|Metal010|Metal051A|JulioKnurl|https?:)/i.test(path)));
      const snapshot=loaded.snapshot();assert.equal(snapshot.custom,true);assert.equal(snapshot.assetVersion,CUSTOM_PBR_ASSETS_VERSION);assert.equal(snapshot.textureCount,12);assert.deepEqual(snapshot.downloadedMaterialInputs,[]);
      assert.deepEqual(snapshot.sourceAssets.map(source=>source.name),names);
      assert.ok(snapshot.sourceAssets.every(source=>source.customMadeFor==='CYBR portfolio instrument'&&source.downloadedInputs.length===0&&source.creationMethod.includes('Custom')));
      for(const profile of Object.values(loaded.profiles)){
        assert.equal(profile.sourceMetadata,sources.get(profile.name));assert.deepEqual(profile.tileMM,tiles[profile.name]);assert.deepEqual(profile.normalScale,profile.name==='BrushedMetal'?[.35,.35]:[1,1]);assert.equal(profile.maps.roughness,profile.maps.metallic);assert.equal(profile.maxAnisotropy,4);
      }
      assert.equal(loaded.profiles.turned.mapping,'radialFace');assert.equal(loaded.profiles.bronze.mapping,'radialFace');assert.equal(loaded.profiles.barrel.mapping,'chart');
      for(const name of['turned','bronze']){assert.equal(loaded.profiles[name].roughnessMacroContrast,undefined);assert.equal(snapshot.profiles[name].roughnessMacroContrast,1);}
      for(const name of['brushed','barrel']){assert.equal(loaded.profiles[name].shadedReliefScale,.35);assert.ok(Math.abs(loaded.profiles[name].shadedPeakToValleyMicrons-4.920329866581596)<1e-9);}
    }finally{loaded.dispose();loaded.dispose();}
    assert.ok(textures.every(texture=>texture.disposals===1));assert.equal(loaded.snapshot().enabled,false);
  });
});

test('custom native materials retain authored roughness and a single centered Cartesian lathe map',async()=>{
  await fixture(async({THREE:runtime,textures})=>{
    const loaded=await loadInstrumentPbrAssets(runtime),material=new THREE.MeshPhysicalMaterial();
    try{
      configurePbrMetal(material,{THREE,...loaded.profiles.turned,chartKind:1});
      assert.equal(material.roughness,1);assert.equal(material.metalness,1);assert.equal(material.roughnessMap,material.metalnessMap);assert.deepEqual(material.normalScale.toArray(),[1,1]);
      assert.equal(material.map.colorSpace,THREE.SRGBColorSpace);assert.equal(material.normalMap.colorSpace,THREE.NoColorSpace);assert.equal(material.roughnessMap.colorSpace,THREE.NoColorSpace);
      const source={uv:[100,47],localPosition:[3,47,0],chart:[2,279],tileMM:loaded.profiles.turned.tileMM,mapping:'radialFace',chartKind:1};
      assert.deepEqual(pbrUvFromMillimeters(source),[.5+47/120,.5]);
      const shader={vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.physical.uniforms)};
      material.onBeforeCompile(shader,{});assert.ok(shader.fragmentShader.includes('texelRoughness.g'));assert.ok(shader.fragmentShader.includes('texelMetalness.b'));assert.ok(!shader.fragmentShader.includes('machiningVariation'));assert.ok(!shader.fragmentShader.includes('metalFinishSine'));
      assert.ok(!shader.fragmentShader.includes('pbrMacroSample'));assert.equal(shader.uniforms.pbrRoughnessMacro,undefined);assert.ok(!material.userData.pbrMetal.roughnessMacro);
      material.dispose();assert.ok(textures.every(texture=>texture.disposals===0),'material disposal retains loader-owned shared maps');
    }finally{loaded.dispose();}
    assert.ok(textures.every(texture=>texture.disposals===1));
  },{fallbackRevision:true});
});

test('invalid custom provenance and physical scale reject before that pack loads and clean other packs',async()=>{
  for(const invalidMetadata of[source=>{source.customMadeFor='foreign material';},source=>{source.downloadedInputs=['material-library.png'];},source=>{source.authoredTileMM=[40,0];}]){
    await fixture(async({THREE:runtime,textures,requests})=>{
      await assert.rejects(()=>loadInstrumentPbrAssets(runtime),/Custom PBR (provenance|physical scale) required/);
      assert.equal(textures.length,9);assert.ok(textures.every(texture=>texture.disposals===1));assert.ok(!requests.some(path=>path.includes('BrushedMetal/runtime/')));
    },{invalidMetadata});
  }
});

test('a partial texture failure waits for all completed maps and disposes each shared texture exactly once',async()=>{
  await fixture(async({THREE:runtime,textures,requests})=>{
    await assert.rejects(()=>loadInstrumentPbrAssets(runtime),/fixture texture load failure/);
    assert.equal(requests.length,16);assert.equal(textures.length,11);assert.ok(textures.every(texture=>texture.disposals===1));
  },{failedMap:'./assets/pbr-custom/LatheMetal/runtime/normal.webp',delayed:true});
});
