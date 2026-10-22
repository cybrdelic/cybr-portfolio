// Presentation adapter only. All solid geometry and CAD curves come from CYBR GEO.
import * as T from './vendor/three-r180/three.module.min.js';
import {instantiateAssembly} from '../cybr-geo/browser/assembly.mjs';
import {applyIrisFinishes} from '../cybr-geo/examples/iris01/finishes.mjs?revision=finishes-36';
import {createWhiteprint} from '../cybr-geo/browser/whiteprint.mjs';
import {pose,gearMetrics} from './mechanism-math.mjs';
import {fetchArtifact} from './artifact-fetch.mjs';
const assetURL=new URL('../cybr-geo/examples/iris01/browser.json.gz?revision=chamfers-7',import.meta.url);
let asset;
try{asset=JSON.parse(new TextDecoder().decode(await fetchArtifact(assetURL.href)));}
catch(error){const status=document.querySelector('#status');if(status)status.textContent='CYBR GEO ASSET UNAVAILABLE — '+error.message;throw error;}

export function createMechanism({drawing=true,drawingColor=0x39423e}={}){
 const assembly=instantiateAssembly(T,asset,{unitsPerMillimetre:.05});
 // Reuse authored CYBR MATERIAL finishes at their real metre scale. Geometry
 // stays native CYBR GEO; the renderer imports and filters the actual maps.
 applyIrisFinishes(assembly.materials,assembly.parts);
 const root=new T.Group(),hardware=assembly.root;root.add(hardware);
 const whiteprint=drawing?createWhiteprint(T,hardware,{color:drawingColor,opacity:.9}):null;if(whiteprint)root.add(whiteprint.root);
 const reveal=new T.Plane(new T.Vector3(0,-1,0),4);
 for(const m of assembly.materials)m.clippingPlanes=[reveal];
 for(const mesh of assembly.parts){mesh.castShadow=/iris blade|cam gear|pinion|Optical retaining mask|Cover support/.test(mesh.name);mesh.receiveShadow=!mesh.material.transmission;}
 const lens=assembly.parts.find(p=>p.name==='Optical element');
 root.userData.geometryEngine='CYBR GEO / OpenCascade';root.userData.whiteprint=whiteprint?.stats;
 return {root,hardware,whiteprint,parts:assembly.parts,metrics:gearMetrics(),
  update(u,construction=1,view='mechanism',optical=0){
   root.rotation.z=-.10;assembly.setDrive(u);reveal.constant=-4+8*construction;
   hardware.visible=construction>.01;if(lens)lens.visible=optical>.05;
   whiteprint?.update(1-construction);return pose(u);
  },dispose(){whiteprint?.dispose();assembly.dispose();}};
}
