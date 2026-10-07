// Runtime maps are losslessly packed from the source material library.
// Library procedural assets remain explicitly identified in their metadata.
export async function loadInstrumentPbrAssets(THREE,{base='./assets/pbr-metal/',maxAnisotropy=8}={}){
  const loader=new THREE.TextureLoader(),owned=new Set();
  const names=['Metal010','Metal051A','JulioKnurl'];
  try{
    const results=await Promise.allSettled(names.map(async name=>{
      const source=await fetch(base+name+'/source.json').then(response=>{if(!response.ok)throw Error('PBR source metadata '+response.status);return response.json();});
      const loaded=await Promise.allSettled(['baseColor.webp','normal.webp','roughness-metallic.webp'].map(async file=>{
        const texture=await loader.loadAsync(base+name+'/runtime/'+file);owned.add(texture);return texture;
      }));
      const failure=loaded.find(entry=>entry.status==='rejected');if(failure)throw failure.reason;
      const [baseColor,normal,roughnessMetallic]=loaded.map(entry=>entry.value);
      return[name,{maps:{baseColor,normal,roughness:roughnessMetallic,metallic:roughnessMetallic},source}];
    }));
    const failure=results.find(entry=>entry.status==='rejected');if(failure)throw failure.reason;
    const entries=results.map(entry=>entry.value);
    // Author-selected physical scale: complete source tiles close each collar.
    // The library does not provide measured physical dimensions.
    const assets=Object.fromEntries(entries),knurlTile=[279/17,10],etchTile=[10.4,6.5];
    const profile=(name,tileMM,normalScale,anisotropy,mapping='chart',colorMultiplier=[1,1,1])=>({name,maps:assets[name].maps,tileMM,normalScale,anisotropy,mapping,colorMultiplier,maxAnisotropy,sourceMetadata:assets[name].source});
    const profiles={
      brushed:profile('Metal010',[40,40],[.65,.65],.45),
      barrel:profile('Metal010',[40,40],[.35,.35],.32),
      turned:profile('Metal051A',[120,120],[.08,.08],.32,'radialFace',[.90,.93,.96]),
      bronze:profile('Metal051A',[140,140],[.06,.06],.45,'radialFace',[.80,.61,.34]),
      knurl:profile('JulioKnurl',knurlTile,[.85,.85],.08),
      etched:profile('JulioKnurl',etchTile,[.2,.2],.04),
    };
    let disposed=false;
    return{profiles,assets,snapshot:()=>({enabled:!disposed,textureCount:owned.size,physicalScale:'Author-selected millimetre scale; source physical dimensions unspecified',sourceAssets:names.map(name=>({name,source:assets[name].source.source,license:assets[name].source.license,creationMethod:assets[name].source.creationMethod||assets[name].source.datasetMetadata?.method})),profiles:Object.fromEntries(Object.entries(profiles).map(([name,entry])=>[name,{asset:entry.name,tileMM:entry.tileMM,normalScale:entry.normalScale,mapping:entry.mapping,anisotropy:entry.anisotropy,colorMultiplier:entry.colorMultiplier}]))}),
      dispose(){if(disposed)return;disposed=true;for(const texture of owned)texture.dispose();}};
  }catch(error){for(const texture of owned)texture.dispose();throw error;}
}
