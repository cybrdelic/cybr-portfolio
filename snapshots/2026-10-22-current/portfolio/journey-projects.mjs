import * as T from './vendor/three-r180/three.module.min.js';
import {fetchArtifact} from './artifact-fetch.mjs';
import {loadFluid} from './instrument-fluid.js';
import {phase,clamp} from './journey-slice-state.mjs';
import {applyCybrSurfacesThree} from '../cybr-light/browser/cybr-surfaces-three.mjs';
import {sourceGeometry} from './source-geometry.mjs';
import {applyNativeSpringsFinish} from './native-springs-finish.mjs';
import {loadTextureAsset,loadTextureAssets} from './texture-asset-load.mjs';

// Source-backed assets. Loading and decoding happen outside the animation loop.
export async function loadJourneyProjects(scene,onChange,{lazy=false,fluidBase='./assets/instrument-fluid/',combatPose=null,combatAnimation='stance',combatAnimationBase=null,combatModel='geometry',landscapeModel='reference27-springs',nativeSprings=false,nativeSpringsFinish=true,spatialSprings=false,prepareTexture}={}){
 const root=new T.Group();root.position.set(0,-1.8,-8);scene.add(root);
 const state={elements:false,song:false,combat:false,scenes:false,errors:[],warnings:[]};
 const fluidRoot=new T.Group();fluidRoot.rotation.x=-Math.PI/2;fluidRoot.scale.setScalar(.038);fluidRoot.position.x=.5;root.add(fluidRoot);
 const combatRoot=new T.Group();combatRoot.position.set(0,-2.5,-9);combatRoot.rotation.y=Math.PI;combatRoot.scale.setScalar(2);root.add(combatRoot);
 const springsRoot=new T.Group();springsRoot.position.set(0,-2,-24);root.add(springsRoot);
 const scoreRoot=new T.Group();scoreRoot.position.set(2,-.3,-4);scoreRoot.scale.setScalar(.8);root.add(scoreRoot);
 const noteMeshes=[],bones=[],surfaceAtlases=[];let fluid,score,skins,combatMeta,materialMaps,groundAtlas,nativeFinish,dead=false,lastFrame=-1;
 const tasks=[],loaders=new Map(),pending=new Map();
 function ensure(key){if(!loaders.has(key))return Promise.resolve();if(!pending.has(key)){const task=loaders.get(key)().then(()=>{if(!dead){state[key]=true;onChange();}}).catch(e=>{state.errors.push(key+': '+(e?.message||e?.type||String(e??'Unknown failure')));onChange();});pending.set(key,task);}return pending.get(key);}
 const guard=(key,fn)=>{loaders.set(key,fn);if(!lazy)tasks.push(ensure(key));};
 const source=new URL('./assets/journey-sources/',import.meta.url);
 async function readModel(name,folder=source){
  const meta=await fetchArtifact(new URL(name+'.json',folder),{json:true});
  const bytes=await fetchArtifact(new URL(meta.file||name+'.bin.gz',folder));
  if(bytes.byteLength!==meta.decodedBytes)throw Error('Invalid '+name+' asset size');
  const geometry=m=>sourceGeometry(T,bytes,m);
  return {meta,geometry};
 }
 guard('elements',async()=>{fluid=await loadFluid(fluidRoot,onChange,{cacheFrames:24,base:fluidBase});fluid.mesh.material.attenuationDistance=3;fluid.mesh.material.attenuationColor.set(0x7bbdb9);fluid.mesh.material.thickness=fluidBase.includes('reference27-sheet')?20:fluidBase.includes('reference27')?12:35;if(dead)fluid.dispose();});
 guard('song',async()=>{
  score=await fetchArtifact('../cybr-song/demo-output/score.json',{json:true});
  const geo=new T.BoxGeometry(1,.055,.08);
  const lines=[];for(let midi=48;midi<=84;midi+=6)lines.push(-3.5,midi/24-2.5,-.06,3.5,midi/24-2.5,-.06);
  const staff=new T.BufferGeometry();staff.setAttribute('position',new T.Float32BufferAttribute(lines,3));scoreRoot.add(new T.LineSegments(staff,new T.LineBasicMaterial({color:0x958d7e,transparent:true,opacity:.35})));
  for(const note of score.notes){const duration=Math.max(.04,note.off-note.on),mesh=new T.Mesh(geo,new T.MeshStandardMaterial({color:note.instrument==='guitar'?0xae733c:0x376a69,metalness:.35,roughness:.4}));mesh.position.set((note.on/score.duration-.5)*7,(note.midi??60)/24-2.5,0);mesh.scale.x=duration/score.duration*7;mesh.userData.note=note;noteMeshes.push(mesh);scoreRoot.add(mesh);}
 });
 guard('combat',async()=>{
  const {meta,geometry}=await (combatPose?readModel(combatModel,new URL(combatPose,import.meta.url)):readModel('combat'));combatMeta=meta;
  const authoredPose=combatPose&&combatAnimation==='stance';
  const animationBase=combatAnimationBase||combatPose;
  if(authoredPose){const pose=await fetchArtifact(animationBase+'manifest.json',{json:true});if(pose.boneCount!==meta.boneCount)throw Error('Pose skeleton mismatch');combatMeta={...meta,frameCount:pose.frameCount};}
  skins=new Float32Array(await fetchArtifact(authoredPose?animationBase+'stance.bin.gz':new URL('combat-skins.bin.gz',source)));
  if(skins.length!==combatMeta.frameCount*meta.boneCount*16)throw Error('Invalid Combat skin frame count');
  for(let i=0;i<meta.boneCount;i++){const b=new T.Bone();b.matrixAutoUpdate=false;b.matrixWorldAutoUpdate=false;bones.push(b);}
  const skeleton=new T.Skeleton(bones,bones.map(()=>new T.Matrix4()));
  for(const m of meta.meshes){const a=meta.materials[m.material],cloth=combatPose&&m.material!==0,mat=new T.MeshPhysicalMaterial({color:new T.Color(...a.slice(1,4)),roughness:Math.sqrt(a[17]),metalness:0,sheen:cloth?.35:0,sheenRoughness:.85,sheenColor:new T.Color(.3,.4,.42)});if(combatPose&&m.material===0)mat.color.setRGB(.52,.48,.43);const mesh=new T.SkinnedMesh(geometry(m),mat);mesh.name='CYBR COMBAT / '+m.name;mesh.bindMode='detached';mesh.bind(skeleton,new T.Matrix4());mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;combatRoot.add(mesh);}
  if(nativeSprings)for(const mesh of combatRoot.children){const m=mesh.material;if(mesh.name.endsWith('body')){m.color.setRGB(.38,.27,.20);m.roughness=.56;}else{m.sheen=.16;m.sheenColor.setRGB(.10,.16,.17);if(mesh.name.includes('shirt'))m.color.setRGB(.022,.075,.083);}}
 });
 guard('scenes',async()=>{
  const {meta,geometry}=await readModel(spatialSprings?landscapeModel:'springs');state.sceneTriangles=meta.audit.reduce((n,a)=>n+a.runtimeTriangles,0);
  const sharedMaterials=new Map();let prepared=0;
  for(const m of meta.meshes){
   if(nativeSprings&&m.name.startsWith('Reference27 / accreted'))continue;
   if(spatialSprings&&prepared++%16===0)await new Promise(resolve=>setTimeout(resolve,0));
   const a=meta.materials[m.material],g=geometry(m);if(!g.boundingBox)g.computeBoundingBox();const depth=m.sourceDepth??g.boundingBox.max.y-g.boundingBox.min.y;
   let mat=sharedMaterials.get(m.material);if(!mat){mat=new T.MeshPhysicalMaterial({color:new T.Color(...a.slice(0,3)),roughness:Math.max(.025,a[3]),metalness:a[4],transmission:a[5],ior:a[6]||1.5,thickness:a[5]>.5?depth:0,attenuationColor:new T.Color(...a.slice(12,15)),attenuationDistance:a[15]});if(m.material===4||m.material===8)mat.userData.cybrMaterial=m.material===4?'02_roman_travertine':'04_fumed_oak';sharedMaterials.set(m.material,mat);}
   if(m.color){mat.vertexColors=true;mat.color.setRGB(1,1,1);}
   if(m.name.startsWith('Reference27 / accreted')){mat.userData.cybrMaterial='02_roman_travertine';mat.color.setRGB(1.35,1.30,1.20);}
   if(m.roughness&&!mat.userData.nativeRoughness){mat.userData.nativeRoughness=true;mat.onBeforeCompile=shader=>{shader.vertexShader='attribute float surfaceRoughness; varying float vSurfaceRoughness;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSurfaceRoughness=surfaceRoughness;');shader.fragmentShader='varying float vSurfaceRoughness;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(vSurfaceRoughness,.04,1.);');};mat.customProgramCacheKey=()=> 'native-ground-roughness-v1';}
   const mesh=new T.Mesh(g,mat);mesh.name=m.name;mesh.castShadow=a[5]<.5&&m.boundary!==1;mesh.receiveShadow=a[5]<.5;springsRoot.add(mesh);
  }
  // The source's mineral banks and rocks need the same physical-scale stone
  // maps as the cartridge, not uniform RGB material placeholders.
  for(const mesh of springsRoot.children){const record=meta.meshes.find(m=>m.name===mesh.name);if([0,1,2].includes(record?.material)){mesh.material.userData.cybrMaterial='02_roman_travertine';mesh.material.userData.sourceTint=mesh.material.color.clone();}}
  materialMaps=await applyCybrSurfacesThree(T,springsRoot,{manifestURL:new URL('surfaces.json',source),cooperative:true,prepareTexture});state.sceneMaterialMaps=materialMaps.count;
  for(const mesh of springsRoot.children)if(mesh.material.userData.sourceTint){mesh.material.color.copy(mesh.material.userData.sourceTint).multiplyScalar(1.5);mesh.material.normalScale.set(.35,.35);}
  if(spatialSprings){
   if(meta.reference27?.newTerrain){
    const mineral=sharedMaterials.get(0);
    const ridge=sharedMaterials.get(5);ridge.normalMap=mineral.normalMap;ridge.normalScale.set(.5,.5);ridge.needsUpdate=true;
    const atlasBase=new URL('../reference27-rebuilt-surfaces/',source);
    const atlasMeta=await fetchArtifact(new URL('manifest.json',atlasBase),{json:true});
    if(atlasMeta.terrainFile!==meta.file)throw Error('Rebuilt terrain surface atlas is stale');
    const maps=await loadTextureAssets(new T.TextureLoader(),['albedo.png','normal.png'].map(f=>new URL(f,atlasBase).href));
    maps.forEach((map,i)=>{map.flipY=false;map.colorSpace=i===0?T.SRGBColorSpace:T.NoColorSpace;map.repeat.set(1/72,1/78);map.offset.set(.5,29/39);map.anisotropy=4;map.needsUpdate=true;prepareTexture?.(map);surfaceAtlases.push(map);});
    mineral.map=maps[0];mineral.normalMap=maps[1];mineral.metalness=0;mineral.metalnessMap=null;mineral.needsUpdate=true;
   }
   if(!meta.reference27?.newTerrain){
   groundAtlas=await loadTextureAsset(new T.TextureLoader(),'./assets/reference27-ground-atlas/albedo.png');groundAtlas.colorSpace=T.SRGBColorSpace;groundAtlas.flipY=false;groundAtlas.anisotropy=4;prepareTexture?.(groundAtlas);
   const groundMaterial=sharedMaterials.get(0),previousCompile=groundMaterial.onBeforeCompile,previousKey=groundMaterial.customProgramCacheKey();
   groundMaterial.onBeforeCompile=shader=>{
    previousCompile.call(groundMaterial,shader);shader.uniforms.nativeGroundAlbedo={value:groundAtlas};
    shader.vertexShader='varying vec2 nativeGroundXZ;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nnativeGroundXZ=position.xz;');
    shader.fragmentShader='varying vec2 nativeGroundXZ;uniform sampler2D nativeGroundAlbedo;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
     vec2 atlasUV=(nativeGroundXZ-vec2(-12.,-14.))/24.;
     vec2 edge=min(nativeGroundXZ-vec2(-12.,-14.),vec2(12.,10.)-nativeGroundXZ);
     float atlasWeight=smoothstep(0.,1.,min(edge.x,edge.y));
     diffuseColor.rgb=mix(diffuseColor.rgb,texture2D(nativeGroundAlbedo,clamp(atlasUV,0.,1.)).rgb,atlasWeight);`);
   };groundMaterial.customProgramCacheKey=()=>previousKey+'/native-ground-atlas-v1';groundMaterial.needsUpdate=true;
   }
   // The board calls for pale mineral terraces, not a sand tint multiplied
   // into an already coloured travertine albedo. Keep the physical maps.
   for(const mesh of springsRoot.children){const record=meta.meshes.find(m=>m.name===mesh.name);
    if([0,1].includes(record?.material)){mesh.material.color.setRGB(...(meta.reference27?.newTerrain?[1,1,1]:[1.45,1.38,1.25]));mesh.material.normalScale.set(.7,.7);}
    if(record?.material===5){mesh.material.color.setRGB(1,1,1);mesh.material.roughness=.94;}
   if([6,7].includes(record?.material)&&!nativeSprings){mesh.material.thickness=.38;mesh.material.attenuationColor.setRGB(.37,.82,.80);mesh.material.attenuationDistance=.3;mesh.material.roughness=.035;}
    if(record?.material===4){mesh.material.color.setRGB(1.45,1.4,1.3);mesh.material.normalScale.set(.6,.6);}
    if(mesh.name.startsWith('Reference27 / accreted')){
     // Keep the authored mineral variation: dropping the albedo map turned
     // the terraces into uniform white plastic regardless of surface detail.
     const calcite=mesh.material,compile=calcite.onBeforeCompile,key=calcite.customProgramCacheKey();
     calcite.color.setRGB(1,1,1);calcite.metalness=0;calcite.metalnessMap=null;calcite.normalScale.set(.85,.85);
     calcite.onBeforeCompile=shader=>{compile.call(calcite,shader);shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      float mineralLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
      diffuseColor.rgb=vec3(.94,.93,.90)*(.22+.78*mineralLuma);`);};
     calcite.customProgramCacheKey=()=>key+'/neutral-calcite-v1';calcite.needsUpdate=true;
    }
    if(record?.color){
     // Native vertex samples retain geology and wetness, but cannot represent
     // sub-triangle pores. Keep the physical-scale CYBR stone normal map for
     // that band; do not multiply a second albedo into the native colours.
     Object.assign(mesh.material,{map:null,roughnessMap:null,metalnessMap:null,metalness:0});mesh.material.normalScale.set(.28,.28);mesh.material.color.setRGB(1,1,1);mesh.material.needsUpdate=true;
    }
   }
  }
  if(nativeSprings&&nativeSpringsFinish){nativeFinish=await applyNativeSpringsFinish(springsRoot,meta,{prepareTexture});state.nativeSprings=true;}
  else if(nativeSprings){state.nativeSprings=false;state.warnings.push('SCENES: source geometry and base materials. Full finish unavailable: two external rock maps excluded.');}
 });
 const matrix=new T.Matrix4(),q0=new T.Quaternion(),q1=new T.Quaternion(),v0=new T.Vector3(),v1=new T.Vector3(),s0=new T.Vector3(),s1=new T.Vector3();
 function update(p,audioTime=null,activeKey=null){
  root.visible=p>.32;fluidRoot.visible=p<.64;scoreRoot.visible=p>.48&&p<.79;combatRoot.visible=p>.62&&p<.91;springsRoot.visible=p>.78;
  if(activeKey===null||activeKey==='elements')fluid?.setProgress(clamp((p-.38)/.20));
  const songTime=audioTime??phase(p,.53,.70)*(score?.duration||0);
  if(activeKey===null||activeKey==='song')for(const m of noteMeshes){const n=m.userData.note,active=songTime>=n.on&&songTime<n.off;m.material.emissive.copy(m.material.color).multiplyScalar(active?.7:0);m.position.z=active?.18:0;}
  if(skins&&(activeKey===null||activeKey==='combat')){const frame=phase(p,.68,.84)*(combatMeta.frameCount-1);if(frame!==lastFrame){const a=Math.floor(frame),b=Math.min(a+1,combatMeta.frameCount-1),t=frame-a;for(let i=0;i<bones.length;i++){matrix.fromArray(skins,(a*bones.length+i)*16).decompose(v0,q0,s0);matrix.fromArray(skins,(b*bones.length+i)*16).decompose(v1,q1,s1);bones[i].matrixWorld.compose(v0.lerp(v1,t),q0.slerp(q1,t),s0.lerp(s1,t));}lastFrame=frame;}}
 }
 return {state,update,ensure,groups:{root,elements:fluidRoot,song:scoreRoot,combat:combatRoot,scenes:springsRoot},score:()=>score,ready:Promise.all(tasks),fluid:()=>fluid?.snapshot(),dispose(){dead=true;fluid?.dispose();materialMaps?.dispose();nativeFinish?.dispose();groundAtlas?.dispose();surfaceAtlases.forEach(t=>t.dispose());scene.remove(root);root.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});}};
}
