// Original part-scale contaminants; fine machining maps remain independently tiled.
export const PBR_WEAR_ASSETS_VERSION='cybr-custom-wear-v2';
export async function loadInstrumentPbrWearAssets(THREE,{base='./assets/pbr-custom-worn/',maxAnisotropy=8}={}){
  const loader=new THREE.TextureLoader(),owned=new Set();
  const specifications=[['aluminum','AluminumWear'],['steel','SteelWear'],['bronze','BronzeWear']];
  try{
    const results=await Promise.allSettled(specifications.map(async ([alloy,name])=>{
      const response=await fetch(base+name+'/source.json',{cache:'no-store'});
      if(!response.ok)throw Error('Custom wear metadata '+response.status);
      const source=await response.json();
      if(source.customMadeFor!=='CYBR portfolio instrument'||source.alloy!==alloy||!Array.isArray(source.downloadedInputs)||source.downloadedInputs.length)throw Error('Custom alloy wear provenance required: '+name);
      if(source.authoredTileMM?.length!==2||!source.authoredTileMM.every(x=>Number.isFinite(x)&&x>0))throw Error('Custom wear physical scale required: '+name);
      const entries=[['color-coverage.webp','colorCoverage','color'],['surface.webp','surface','surface'],['normal.webp','normal','normal']];
      const loaded=await Promise.allSettled(entries.map(async ([file,key,slot])=>{
        const revision=source.runtimeMaps?.[key]?.sha256||PBR_WEAR_ASSETS_VERSION;
        const texture=await loader.loadAsync(base+name+'/runtime/'+file+'?v='+encodeURIComponent(revision));owned.add(texture);
        texture.colorSpace=slot==='color'?THREE.SRGBColorSpace:THREE.NoColorSpace;
        texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
        texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
        texture.generateMipmaps=true;texture.anisotropy=Math.min(8,maxAnisotropy);texture.needsUpdate=true;
        return[slot,texture];
      }));
      const failed=loaded.find(x=>x.status==='rejected');if(failed)throw failed.reason;
      return[alloy,{wearMaps:Object.fromEntries(loaded.map(x=>x.value)),wearTileMM:[...source.authoredTileMM],wearAlloy:alloy,wearStrength:1,sourceMetadata:source}];
    }));
    const failed=results.find(x=>x.status==='rejected');if(failed)throw failed.reason;
    const alloys=Object.fromEntries(results.map(x=>x.value));let disposed=false;
    return{alloys,snapshot:()=>({enabled:!disposed,version:PBR_WEAR_ASSETS_VERSION,custom:true,textureCount:owned.size,downloadedMaterialInputs:[],coordinateScale:'Part-local millimeters; nearest integer closed cylindrical repeats; independent fine-grain mapping',alloys:specifications.map(([alloy,name])=>({alloy,asset:name,tileMM:alloys[alloy].wearTileMM,strength:alloys[alloy].wearStrength,source:alloys[alloy].sourceMetadata.source}))}),dispose(){if(disposed)return;disposed=true;for(const texture of owned)texture.dispose();}};
  }catch(error){for(const texture of owned)texture.dispose();throw error;}
}
