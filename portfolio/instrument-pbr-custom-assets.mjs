// Original CYBR appearances and physical height-derived material data.
// No material-library maps are read by this loader.
export const CUSTOM_PBR_ASSETS_VERSION='cybr-custom-pbr-v7';
export async function loadInstrumentPbrAssets(THREE,{base='./assets/pbr-custom/',maxAnisotropy=8,loadTexture}={}){
  const loader=loadTexture?{loadAsync:loadTexture}:new THREE.TextureLoader(),owned=new Set();
  const names=['BrushedMetal','LatheMetal','DiamondKnurl','DiamondEtch'];
  try{
    const results=await Promise.allSettled(names.map(async name=>{
      const response=await fetch(base+name+'/source.json',{cache:'no-store'});
      if(!response.ok)throw Error('Custom PBR metadata '+response.status);
      const source=await response.json();
      if(source.customMadeFor!=='CYBR portfolio instrument'||!Array.isArray(source.downloadedInputs)||source.downloadedInputs.length!==0)throw Error('Custom PBR provenance required for '+name);
      if(source.authoredTileMM?.length!==2||!source.authoredTileMM.every(value=>Number.isFinite(value)&&value>0))throw Error('Custom PBR physical scale required for '+name);
      const loaded=await Promise.allSettled([['baseColor.webp','baseColor'],['normal.webp','normal'],['roughness-metallic.webp','roughnessMetallic']].map(async ([file,key])=>{
        const revision=source.runtimeMaps?.[key]?.sha256||CUSTOM_PBR_ASSETS_VERSION;
        const texture=await loader.loadAsync(base+name+'/runtime/'+file+'?v='+encodeURIComponent(revision));owned.add(texture);return texture;
      }));
      const failure=loaded.find(entry=>entry.status==='rejected');if(failure)throw failure.reason;
      const [baseColor,normal,roughnessMetallic]=loaded.map(entry=>entry.value);
      return[name,{maps:{baseColor,normal,roughness:roughnessMetallic,metallic:roughnessMetallic},source}];
    }));
    const failure=results.find(entry=>entry.status==='rejected');if(failure)throw failure.reason;
    const assets=Object.fromEntries(results.map(entry=>entry.value));
    const profile=(name,anisotropy,mapping='chart',colorMultiplier=[1,1,1])=>({name,maps:assets[name].maps,tileMM:[...assets[name].source.authoredTileMM],normalScale:[1,1],heightNormals:true,cavity:['DiamondKnurl','DiamondEtch'].includes(name),anisotropy,mapping,colorMultiplier,maxAnisotropy,sourceMetadata:assets[name].source});
    const profiles={
      brushed:{...profile('BrushedMetal',.52),normalScale:[.35,.35],shadedReliefScale:.35,shadedPeakToValleyMicrons:14.058085333090276*.35},
      barrel:{...profile('BrushedMetal',.44),normalScale:[.35,.35],shadedReliefScale:.35,shadedPeakToValleyMicrons:14.058085333090276*.35},
      turned:profile('LatheMetal',.32,'radialFace'),
      bronze:profile('LatheMetal',.30,'radialFace',[1,.67,.35]),
      knurl:profile('DiamondKnurl',.08),
      etched:profile('DiamondEtch',.04),
    };
    let disposed=false;
    return{profiles,assets,snapshot:()=>({enabled:!disposed,assetVersion:CUSTOM_PBR_ASSETS_VERSION,custom:true,textureCount:owned.size,downloadedMaterialInputs:[],physicalScale:'Authored millimetre and micron surface recipes; not specimen measurements',sourceAssets:names.map(name=>({name,source:assets[name].source.source,creationMethod:assets[name].source.creationMethod,customMadeFor:assets[name].source.customMadeFor,downloadedInputs:assets[name].source.downloadedInputs})),profiles:Object.fromEntries(Object.entries(profiles).map(([name,entry])=>[name,{asset:entry.name,tileMM:entry.tileMM,normalScale:entry.normalScale,shadedReliefScale:entry.shadedReliefScale??1,shadedPeakToValleyMicrons:entry.shadedPeakToValleyMicrons??null,heightNormals:entry.heightNormals,cavity:entry.cavity,mapping:entry.mapping,anisotropy:entry.anisotropy,colorMultiplier:entry.colorMultiplier,roughnessMacroContrast:entry.roughnessMacroContrast??1,roughnessMacroReference:entry.roughnessMacroReference??null}]))}),
      dispose(){if(disposed)return;disposed=true;for(const texture of owned)texture.dispose();}};
  }catch(error){for(const texture of owned)texture.dispose();throw error;}
}
