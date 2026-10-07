import {mobilePageToPose,mobilePoseToPage,mobileCameraFrame,fitMobileView} from './instrument-mobile-story.mjs?v=story-1';
import {createRenderGate} from './instrument-render-gate.mjs';
import {createScrollTour} from './instrument-scroll-tour.mjs?v=story-1';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {loadGeometry} from './instrument-geometry-loader.mjs';
import {loadFluid} from './instrument-fluid.js?v=shared-3';
import {loadElementsComposite} from './instrument-elements-composite.mjs?v=shared-3';
import {createHdrComposite} from './instrument-hdr-composite.mjs?v=1';
import {opticalGeometryInView} from './instrument-visible-bounds.mjs';
import {span,takeup,takeupForLength,internal,length as routeLength} from './instrument-routing.js';
import {volumeDepth} from './instrument-volume.js';
import {loadPathBake} from './instrument-path-bake.js?v=4';
import {createWorkingMotion,createWorkingTubeBuffers} from './instrument-working-motion.js?v=mobile-frame-1';
import {createRasterTiming} from './instrument-raster-timing.mjs';
import {setupRasterLighting} from './instrument-raster-lighting.mjs?v=realism-key-5';
import {bindRasterCamera} from './instrument-raster-camera.mjs?v=depth-3';
import {createRasterPaper} from './instrument-raster-paper.mjs?v=depth-3';
import {MACHINED_ROUGHNESS_SHADER_CHUNK,MACHINED_ROUGHNESS_MEAN,MACHINED_VARIATION_LIMIT} from './instrument-raster-finish.mjs?v=depth-3';
import {createStudioEnvironment,STUDIO_ENVIRONMENT_METADATA} from './instrument-studio-environment.mjs?v=realism-strip-5';
import {attachMetalCoordinates,METAL_STYLES} from './instrument-metal-coordinates.mjs?v=wear-1';
import {bindMetalFinish,METAL_FINISH_VERSION,METAL_FINISH_PROFILES} from './instrument-metal-finish.mjs?v=finish-3';
import {configurePbrMetal,buildPbrMaterialGroups,PBR_METAL_VERSION} from './instrument-pbr-materials.mjs?v=machining-9';
import {loadInstrumentPbrAssets} from './instrument-pbr-custom-assets.mjs?v=machining-7';
import {loadInstrumentPbrWearAssets} from './instrument-pbr-wear-assets.mjs?v=wear-4';
import {createInstrumentInterface,PROJECT_STOPS} from './instrument-interface.mjs?v=12';

const root=document.querySelector('.scroll-score'), stage=document.querySelector('.instrument');
const surface=document.querySelector('.sculpture'), status=document.querySelector('.render-status');
const slider=document.querySelector('#explosion'), reduced=matchMedia('(prefers-reduced-motion: reduce)');
const names=['geo','light','elements','song','combat','scenes'];
const mobileLayout=matchMedia('(max-width:900px), (orientation:landscape) and (max-height:600px) and (hover:none) and (pointer:coarse)');
const startup={started:performance.now(),phase:'metadata',geometry:{},phases:{}};
window.instrumentStartup=startup;
let canvasVisible=true,lastNativeScroll=-Infinity,mobileScrollWake;
const mobileIntro=document.querySelector('.mobile-intro');
stage.classList.add('mobile-loading');
function mobilePrelude(p,preview=false){
  if(!mobileLayout.matches)return;
  mobileIntro.querySelector('h2').innerHTML=preview?'GEO':p<.28?'Six systems.<br>One instrument.':p<.46?'Follow<br>the cable.':'One connected<br>instrument.';
  mobileIntro.querySelector('.mobile-kicker').textContent=preview?'01 / 06 — GEOMETRY':'CYBRDELIC / SIX SYSTEMS';
  mobileIntro.querySelector('.mobile-hint').textContent=preview?'The real GEO component. The other systems are loading.':p<.28?'Scroll to assemble and explore.':p<.46?'Six projects along one continuous route.':'Scroll back to explore, or open the projects.';
}
function mobileMoving(){return mobileLayout.matches&&performance.now()-lastNativeScroll<160;}
function startupPhase(phase,message){startup.phases[phase]=performance.now()-startup.started;startup.phase=phase;if(message)status.textContent=message;}
// A fixed mobile canvas avoids resizing GPU targets on every scroll frame.
stage.append(status);
const query=new URLSearchParams(location.search),cartridgeChoice=query.get('cartridges')||'working';
const bakedElements=cartridgeChoice==='working'&&query.get('elements')!=='static'&&!['pathtrace','pathtracer','quality'].includes(query.get('renderer'))&&(!query.has('optics')||query.get('optics')==='thickness');
const rasterOpticalMode=query.get('optics')||(bakedElements?'thickness':'staged');
const stagedGeometryOptics=rasterOpticalMode==='staged';
const nativeGeometryOptics=rasterOpticalMode==='geometry'||stagedGeometryOptics;
const partialRayOptics=nativeGeometryOptics||(rasterOpticalMode==='ray'&&query.get('optics-modules')==='light,elements');
const cartridgePreview=cartridgeChoice!=='legacy';
// The validated native CAD instrument is the default. Earlier source packages
// remain independently inspectable with legacy and legacy-c.
const geometryBase=cartridgePreview?(['c','working'].includes(cartridgeChoice)?'./assets/instrument-working-v1/':cartridgeChoice==='legacy-c'?'./assets/instrument-cartridges-c/':'./assets/instrument-cartridges-v1/'):'./assets/instrument-3d/';
let assembled,routeSpec,inspectionRoute,referenceExternalLength,referenceTakeupLength;
const groups=new Map(), materials=[], cables=[];
const assemblyDetails=[];
const metalCharts=[];
const pbrGroups=[];let pbrAssets,pbrWearAssets;
const objects=[];let workingMotion,auditElement;
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10);};
const mix=(a,b,t)=>a+(b-a)*t;
const vector=(x,y,z)=>new THREE.Vector3(x,y,z);
let renderer,scene,camera,manifest,frame=0,current=0,target=0,lastTime=0,ready=false,drawCount=0;
let pathTracer,lastTracePose=-1;
let rasterLighting,rasterTiming,rasterProbes,rasterOptics,rasterTransport,rasterThickness,hitPbrArrays,lastRasterPose=-1;
let nativeStartup;
let geoStarter,renderGate,displayedProgress,fullFrameComplete=false;
window.addEventListener('pagehide',event=>{clearTimeout(mobileScrollWake);if(!event.persisted)geoStarter?.dispose();});
let interfacePaused=false;
let elementPlayback,elementFrameDirty=false,elementAudit,hdrComposite;
const samplerInventory=new Map();
function nativeSamplerInventory(){
  if(!nativeGeometryOptics||!query.has('audit')||!renderer)return undefined;
  const gl=renderer.getContext(),types=new Set([gl.SAMPLER_2D,gl.SAMPLER_CUBE,gl.SAMPLER_2D_ARRAY,gl.SAMPLER_2D_SHADOW,gl.SAMPLER_CUBE_SHADOW,gl.SAMPLER_2D_ARRAY_SHADOW,gl.INT_SAMPLER_2D,gl.UNSIGNED_INT_SAMPLER_2D]);
  for(const program of renderer.info.programs){
    if(samplerInventory.has(program.id))continue;
    const source=gl.getShaderSource(program.fragmentShader)||'';
    if(!source.includes('cadNativeTransport')&&!source.includes('cadTransportMap')&&!source.includes('cadStaged')){samplerInventory.set(program.id,null);continue;}
    const samplers=[];for(let index=0,count=gl.getProgramParameter(program.program,gl.ACTIVE_UNIFORMS);index<count;index++){const uniform=gl.getActiveUniform(program.program,index);if(uniform&&types.has(uniform.type))samplers.push({name:uniform.name,size:uniform.size});}
    samplerInventory.set(program.id,{program:program.id,capture:source.includes('cadNativeTransport'),linked:gl.getProgramParameter(program.program,gl.LINK_STATUS),units:samplers.reduce((sum,uniform)=>sum+uniform.size,0),samplers});
  }
  return [...samplerInventory.values()].filter(Boolean);
}
const qualityMode=['pathtrace','pathtracer','quality'].includes(query.get('renderer'));
let qualityRecoveryRequested=false;
function recoverQuality(error){
  if(qualityRecoveryRequested)return;
  qualityRecoveryRequested=true;pathTracer?.dispose();
  console.warn('CYBR quality renderer lost its GPU session; restoring raster.',error?.message||String(error));
  const restored=new URL(location.href);restored.searchParams.delete('renderer');restored.searchParams.delete('optics');restored.searchParams.set('gpu-recovery','1');restored.searchParams.set('resume',String(current));
  location.replace(restored.href);
}
let lastCondense=-1, lastUI=-1, frameTimes=[], lastRender=0,lastWidth=0,lastHeight=0;
let fluid,glassShell,opticalLens,layeredTarget,workingOuterTarget,optics,workingTransmissionLayers;
let rasterEnvironmentTarget,rasterSourceEnvironment,rasterPaperBackground,rasterResourcesDisposed=false;
function disposeRasterResources(){
  if(rasterResourcesDisposed)return;
  rasterResourcesDisposed=true;renderGate?.dispose();renderGate=undefined;geoStarter?.dispose();geoStarter=undefined;
  pbrAssets?.dispose();
  pbrWearAssets?.dispose();
  elementPlayback?.dispose();fluid?.dispose?.();
  hdrComposite?.dispose();
  hitPbrArrays?.dispose();
  layeredTarget?.dispose();workingOuterTarget?.dispose();rasterEnvironmentTarget?.dispose();rasterSourceEnvironment?.dispose();renderer?.dispose();
}
let volumePasses=[];
let frameCalls=0,frameTriangles=0;
const layeredMap={value:null},layeredSize={value:new THREE.Vector2(1,1)};
const workingOuterMap={value:null};
const debugNoFinish=new URLSearchParams(location.search).has('no-finish');
const physicalMetal=index=>manifest.workingGeometry&&!qualityMode&&!debugNoFinish&&query.get('metal')!=='legacy'&&[0,1,2,5,8,9].includes(index);
const metalAnisotropy=index=>({0:.45,1:.32,2:.22,5:.48,8:.48,9:.45})[index]||0;
const referenceDirection=vector(50,-80,50).normalize();
const annotations=['Machined chassis','Optical assembly','Glass / water / air','Formed cymbals',cartridgePreview?'CYBR Combat mannequin':'Articulated gripper',cartridgePreview?'Desert Hot Springs':'Mineral cage'];

async function inflate(url){
  const response=await fetch(url);if(!response.ok)throw new Error(`${url}: ${response.status}`);
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
function attribute(buffer,spec,size){
  const Type=spec.dtype==='float32'?Float32Array:spec.dtype==='int16'?Int16Array:Uint32Array;
  return new THREE.BufferAttribute(new Type(buffer,spec.offset,spec.count),size,Type===Int16Array);
}
function useWorkingTransmissionBuffer(shader,layer='outer'){
  shader.uniforms.workingTransmissionMap=layer==='inner'?layeredMap:workingOuterMap;shader.uniforms.workingTransmissionSize=layeredSize;
  shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_pars_fragment>',THREE.ShaderChunk.transmission_pars_fragment);
  shader.fragmentShader=shader.fragmentShader.replaceAll('transmissionSamplerMap','workingTransmissionMap').replaceAll('transmissionSamplerSize','workingTransmissionSize');
}
function bindRasterMaterial(shader,material,module){
  if(manifest.workingGeometry&&!qualityMode)bindRasterCamera(shader,THREE);
  if(query.has('audit'))material.userData.auditRasterShader=shader;
  const transmission=material.userData.cadTransmission;
  if(transmission>0){
    // Our explicit opaque / water / vessel passes already supply the HDR
    // transmission buffers. Keep the physical shader and its authored units,
    // without asking Three to render a second hidden transmission prepass.
    shader.uniforms.transmission.value=transmission;
    shader.uniforms.thickness.value=material.thickness;
    shader.uniforms.attenuationDistance.value=material.attenuationDistance;
    shader.uniforms.attenuationColor.value.copy(material.attenuationColor);
  }
  rasterProbes?.bindMaterialShader(shader,material);
  if(manifest.workingGeometry&&!qualityMode&&query.get('lighting')!=='workshop'){
    // The studio panorama supplies reflection cards. Its diffuse integral
    // must not overpower the shadowed key on cloth and the mannequin.
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',
      '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse*=.3;');
  }
  rasterThickness?.bindShader(shader,material);
  rasterOptics?.bindShader(shader,material,module);
  rasterTransport?.bindShader(shader,material,module);
}
function externalTransmission(material,module){
  material.userData.module=module;
  if(!manifest.workingGeometry||qualityMode||!(material.transmission>0))return;
  material.userData.cadTransmission=material.transmission;
  material.transmission=0;
  material.defines={...material.defines,USE_TRANSMISSION:''};
  // Closed optical CAD renders its front surface once. Explicit HDR buffers
  // and CAD exit fields supply transmission without drawing its back again.
  material.side=THREE.FrontSide;
}
function materialFor(index,texture,module,pbrProfile=null){
  const custom=manifest.customMaterials?.[index];
  if(custom){
    const water=custom.role==='springs-water',glass=custom.nativeType==='glass',color=new THREE.Color(...custom.color);
    // Bronze uses conductor reflectance, not a dark diffuse pigment. Keep the
    // original native source prescription available in quality/workshop mode.
    if(manifest.workingGeometry&&!qualityMode&&query.get('lighting')!=='workshop'&&index===8)color.setRGB(.76,.58,.34);
    if(manifest.workingGeometry){
      const transmission=custom.transmission??0,opacity=custom.opacity??1;
      const mat=new THREE.MeshPhysicalMaterial({color,vertexColors:!!custom.vertexColors,
        metalness:custom.metalness??0,roughness:custom.roughness??.4,ior:custom.ior??1.5,
        transmission,thickness:custom.thicknessMM??0,opacity,transparent:opacity<1,depthWrite:opacity>=1,
        clearcoat:custom.coat??0,clearcoatRoughness:custom.coatRoughness??0,anisotropy:physicalMetal(index)?metalAnisotropy(index):custom.anisotropy??0,side:THREE.DoubleSide,dithering:true,
        envMapIntensity:1,...((custom.attenuationDistanceMM??custom.attenuationDistance)!==undefined?{attenuationDistance:custom.attenuationDistanceMM??custom.attenuationDistance}: {}),
        ...(custom.attenuationColor?{attenuationColor:new THREE.Color(...custom.attenuationColor)}: {})});
      mat.userData.secondarySourceFinish=false;
      if(custom.microfinish==='machined'&&custom.metalness>0&&!debugNoFinish)mat.roughnessMap=texture;
      mat.onBeforeCompile=shader=>{
        shader.vertexShader='attribute float occlusion;\nvarying float vWorkingVisibility;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvWorkingVisibility=occlusion;');
        shader.fragmentShader='varying float vWorkingVisibility;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',`#include <aomap_fragment>
          float cadVisibility=mix(.7,1.,clamp(vWorkingVisibility,0.,1.));
          reflectedLight.indirectDiffuse*=cadVisibility;`);
        if(!pbrProfile)shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\n${MACHINED_ROUGHNESS_SHADER_CHUNK}`);
        if(physicalMetal(index)&&!pbrProfile&&!pbrAssets)bindMetalFinish(shader,{THREE});
        if(transmission>0)useWorkingTransmissionBuffer(shader,water?'inner':'outer');
        bindRasterMaterial(shader,mat,module);
      };
      mat.customProgramCacheKey=()=>`working-cad-diffuse-contact-transmission-v5-${physicalMetal(index)?METAL_FINISH_VERSION:'plain'}-${module}-${index}`;
      if(pbrAssets&&!pbrProfile)mat.anisotropy=0;
      if(pbrProfile){mat.vertexColors=false;configurePbrMetal(mat,{THREE,...pbrProfile});}
      externalTransmission(mat,module);
      materials.push(mat);return mat;
    }
    if(custom.role==='body')color.multiplyScalar(.78);
    const mat=new THREE.MeshPhysicalMaterial({color,vertexColors:!!custom.vertexColors,metalness:custom.metalness,roughness:custom.roughness,side:THREE.DoubleSide,dithering:true,...(water?{transmission:1,ior:1.334,thickness:12}:glass?{transmission:1,ior:custom.ior,thickness:custom.thickness*15}: {})});
    materials.push(mat);return mat;
  }
  const specs=[
    {color:0xe6e7e8,metalness:1,roughness:.32,anisotropy:.35},
    {color:0xc4c7cb,metalness:1,roughness:.18,anisotropy:.18},
    {color:0x25292d,metalness:.65,roughness:.48},
    {color:0xffffff,metalness:0,roughness:.035,transmission:1,thickness:module==='light'?12:3,ior:1.52,dispersion:module==='light'?.12:0,iridescence:module==='light'?.5:0,iridescenceIOR:1.38,iridescenceThicknessRange:[280,420]},
    {color:0x9e0c21,metalness:.15,roughness:.28},
    {color:0xd1c5ac,metalness:1,roughness:.42,anisotropy:.6},
    {color:0x080909,metalness:0,roughness:.62},
    {color:0xffffff,metalness:0,roughness:.025,transmission:1,thickness:42,ior:1.333,attenuationColor:0xc1e5e8,attenuationDistance:280}
  ];
  const material=new THREE.MeshPhysicalMaterial({...specs[index],side:THREE.DoubleSide,envMapIntensity:1,dithering:true});
  material.userData.secondarySourceFinish=!pbrProfile;
  if(physicalMetal(index))material.anisotropy=metalAnisotropy(index);
  if((index===3||index===7)&&!manifest.workingGeometry){material.transparent=true;material.depthWrite=false;}
  if([0,1,2,5].includes(index)&&!debugNoFinish){
    material.roughnessMap=texture;
  }
  material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute float occlusion;\nattribute vec2 finish;\nvarying vec2 vPartFinish;\nvarying float vSurfaceAO;\nvarying vec3 vMachiningPosition,vFinishY,vFinishZ;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vPartFinish=finish;vSurfaceAO=occlusion;vMachiningPosition=position;
      vFinishY=mat3(modelViewMatrix)*vec3(0.,1.,0.);
      vFinishZ=mat3(modelViewMatrix)*vec3(0.,0.,1.);`);
    shader.fragmentShader='varying vec2 vPartFinish;\nvarying float vSurfaceAO;\nvarying vec3 vMachiningPosition,vFinishY,vFinishZ;\n'+shader.fragmentShader;
    if(!pbrProfile){
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=vPartFinish.y;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\n${MACHINED_ROUGHNESS_SHADER_CHUNK}\nroughnessFactor*=vPartFinish.x;`);
    }
    if(physicalMetal(index)&&!pbrProfile&&!pbrAssets)bindMetalFinish(shader,{THREE});
    else if(!pbrProfile&&!pbrAssets)shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>
      #ifdef USE_ANISOTROPY
        vec3 finishT=-vMachiningPosition.z*vFinishY+vMachiningPosition.y*vFinishZ;
        finishT-=normal*dot(normal,finishT);
        if(dot(finishT,finishT)>.000001){
          material.anisotropyT=normalize(finishT);
          material.anisotropyB=normalize(cross(normal,material.anisotropyT));
        }
      #endif`);
    // The sparse diffuse visibility samples are unsuitable for glossy
    // directions: spreading them across broad CAD triangles facets the metal.
    // Actual CAD shadows handle direct occlusion; preserve specular radiance.
    shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',manifest.workingGeometry?`#include <aomap_fragment>
      float localVisibility=mix(.7,1.,clamp(vSurfaceAO,0.,1.));
      reflectedLight.indirectDiffuse*=localVisibility;`:`#include <aomap_fragment>
      float localVisibility=mix(.22,1.,clamp(vSurfaceAO,0.,1.));
      reflectedLight.indirectDiffuse*=localVisibility;
      reflectedLight.indirectSpecular*=mix(localVisibility,1.,pow(1.-roughnessFactor,3.));`);
    if(manifest.workingGeometry&&(index===3||index===7))useWorkingTransmissionBuffer(shader,index===7?'inner':'outer');
    if(index===3&&module==='elements'&&!manifest.workingGeometry){
      shader.uniforms.layeredTransmissionMap=layeredMap;shader.uniforms.layeredTransmissionSize=layeredSize;
      // Expand this chunk first: its sampler references live inside it.
      shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_pars_fragment>',THREE.ShaderChunk.transmission_pars_fragment);
      shader.fragmentShader=shader.fragmentShader.replaceAll('transmissionSamplerMap','layeredTransmissionMap').replaceAll('transmissionSamplerSize','layeredTransmissionSize');
    }
    bindRasterMaterial(shader,material,module);
  };
  material.customProgramCacheKey=()=>`instrument-material-${manifest.workingGeometry?'diffuse-contact-v5':'v2'}-${physicalMetal(index)?METAL_FINISH_VERSION:'plain'}-${module}-${index}`;
  if(pbrAssets&&!pbrProfile&&physicalMetal(index))material.anisotropy=0;
  if(pbrProfile){material.vertexColors=false;configurePbrMetal(material,{THREE,...pbrProfile});}
  externalTransmission(material,module);
  materials.push(material);return material;
}

function makeCable(from,to,segments=96){
  const sides=16,closed=!!manifest.workingGeometry,tube=closed?createWorkingTubeBuffers(segments,sides):null,count=(segments+1)*(sides+1);
  const positions=tube?.positions||new Float32Array(count*3),normals=tube?.normals||new Float32Array(count*3),uv=tube?.uv||new Float32Array(count*2),indices=tube?.indices||[];
  if(!closed)for(let i=0;i<=segments;i++)for(let j=0;j<=sides;j++){
    const k=i*(sides+1)+j;uv[k*2]=i/segments;uv[k*2+1]=j/sides;
    if(i<segments&&j<sides){const a=k,b=k+sides+1;indices.push(a,b,a+1,b,b+1,a+1);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setIndex(indices);
  const material=new THREE.MeshStandardMaterial({color:0xae1028,roughness:.3,metalness:.12});
  if(query.has('wireframe'))material.wireframe=true;
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec2 vBraid;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBraid=uv;');
    shader.fragmentShader='varying vec2 vBraid;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float braid=sin((vBraid.x*32.+vBraid.y*7.)*6.283)*sin((vBraid.x*32.-vBraid.y*7.)*6.283);
      diffuseColor.rgb*=.8+.2*smoothstep(-.4,.4,braid);`);
  };
  const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
  cables.push({from,to,geometry,mesh,segments,sides,positions,normals,capBase:tube?.capBase??null});
}
function updateCables(){
  const spans=cables.filter(c=>c.from[0]!=='takeup').map(c=>span(
    c.from[1].map((v,i)=>v+groups.get(c.from[0]).position.getComponent(i)),
    c.to[1].map((v,i)=>v+groups.get(c.to[0]).position.getComponent(i))));
  const externalLength=spans.reduce((s,p)=>s+routeLength(p),0);
  if(referenceExternalLength===undefined){referenceExternalLength=externalLength;referenceTakeupLength=routeLength(takeup(1));}
  const coil=takeupForLength(referenceTakeupLength+referenceExternalLength-externalLength).map(p=>[p[0]+groups.get('geo').position.x,p[1],p[2]]);
  let spanIndex=0;
  for(const cable of cables){
    const points=cable.from[0]==='takeup'?coil:spans[spanIndex++];
    for(let i=0;i<=cable.segments;i++){
      const p=vector(...points[i]),tangent=vector(...points[Math.min(points.length-1,i+1)]).sub(vector(...points[Math.max(0,i-1)])).normalize();
      const n=new THREE.Vector3().crossVectors(tangent,vector(0,0,1)).normalize();
      const bn=new THREE.Vector3().crossVectors(tangent,n).normalize();
      for(let j=0;j<=cable.sides;j++){
        const angle=j/cable.sides*Math.PI*2,normal=n.clone().multiplyScalar(Math.cos(angle)).addScaledVector(bn,Math.sin(angle));
        const k=(i*(cable.sides+1)+j)*3;
        p.clone().addScaledVector(normal,routeSpec.cableRadius).toArray(cable.positions,k);normal.toArray(cable.normals,k);
      }
    }
    cable.geometry.attributes.position.needsUpdate=true;cable.geometry.attributes.normal.needsUpdate=true;
    cable.geometry.computeBoundingSphere();
  }
  const path=[[-47+groups.get('geo').position.x,0,0],[61+groups.get('geo').position.x,0,0]];
  for(let i=0;i<spans.length;i++){
    path.push(...spans[i].slice(1));
    const name=names[i+1],offset=groups.get(name).position.x;
    const local=routeSpec.internalRoutes?.[name]?new THREE.CatmullRomCurve3(routeSpec.internalRoutes[name].map(p=>vector(...p)),false,'centripetal').getPoints(120).map(p=>p.toArray()):internal(name,routeSpec.ports[name]);
    path.push(...local.slice(1).map(p=>[p[0]+offset,p[1],p[2]]));
  }
  // Follow the working cable through the ports, with an external inspection
  // camera. The take-up loop remains physical but does not spin the camera.
  inspectionRoute=new THREE.CatmullRomCurve3(path.map(p=>vector(...p)),false,'centripetal');
}

// Follow the cable with an external macro camera: the working bores have
// sub-millimetre cable clearance, not room for an unobstructed interior view.
const orthographic=new THREE.OrthographicCamera(),perspective=new THREE.PerspectiveCamera();
function pose(p,aspect){
  const condense=smooth((p-.035)/.245);
  if(workingMotion){inspectionRoute=workingMotion.setProgress(p);lastCondense=condense;}
  else if(Math.abs(condense-lastCondense)>1e-7){
    manifest.modules.forEach((module,i)=>groups.get(module.name).position.x=mix(module.explodedX,assembled[i],condense));
    assemblyDetails.forEach(({object,shift})=>object.position.x=shift*condense);
    updateCables();lastCondense=condense;
  }
  const turn=smooth((p-.28)/.18),travel=clamp((p-.46)/.44),exit=smooth((p-.90)/.10);
  const entry=inspectionRoute.getPointAt(0),entryOffset=vector(-55,-80*Math.cos(.5),80*Math.sin(.5));
  const pivot=(workingMotion?workingMotion.cameraFrame().center:vector(mix(35,60,condense),0,0)).lerp(entry,turn);
  const direction=referenceDirection.clone().lerp(entryOffset.clone().normalize(),turn).normalize();
  const distance=mix(6000,entryOffset.length(),turn),viewHeight=mix(400,2*entryOffset.length()*Math.tan(THREE.MathUtils.degToRad(34)),turn);
  let eye=pivot.clone().addScaledVector(direction,distance),look=pivot.clone();
  let visibleHeight=viewHeight,perspectiveBlend=turn;
  if(p>.46){
    const dive=smooth(travel/.13),point=inspectionRoute.getPointAt(travel),ahead=inspectionRoute.getPointAt(Math.min(1,travel+.018));
    if(workingMotion&&travel+.018>1)ahead.addScaledVector(inspectionRoute.getTangentAt(1),(travel+.018-1)*inspectionRoute.total);
    const angle=.5+.45*Math.sin(travel*Math.PI),inspectionEye=point.clone().add(vector(-55,-80*Math.cos(angle),80*Math.sin(angle)));
    if(!workingMotion&&point.distanceTo(ahead)<1)ahead.add(vector(10,0,0));
    eye.lerp(inspectionEye,dive);look.lerp(ahead,dive);
    // Keep a stable finite field of view while inspecting along the assembly.
    visibleHeight=mix(viewHeight,2*eye.distanceTo(look)*Math.tan(THREE.MathUtils.degToRad(34)),dive);
  }
  if(exit>0){
    const whole=workingMotion?workingMotion.cameraFrame().center:vector(40,0,0);
    const outside=workingMotion?whole.clone().add(vector(580,-420,285)):vector(620,-420,285);
    eye.lerp(outside,exit);look.lerp(whole,exit);
    visibleHeight=mix(visibleHeight,370,exit);
  }
  const mobileView=mobileLayout.matches&&workingMotion?mobileCameraFrame(workingMotion,p,aspect):null;
  if(mobileView){eye=mobileView.eye;look=mobileView.look;perspectiveBlend=mobileView.perspectiveBlend;}
  camera.position.copy(eye);camera.up.set(0,0,1);camera.lookAt(look);
  if(mobileView?.roll)camera.rotateZ(mobileView.roll);camera.updateMatrixWorld();
  const d=Math.max(1,eye.distanceTo(look));
  if(mobileView)visibleHeight=fitMobileView(camera,mobileView.bounds,aspect,perspectiveBlend,d,mobileView.occupancy);
  else if(workingMotion)visibleHeight=workingMotion.fitViewHeight(camera,visibleHeight,p,aspect,perspectiveBlend,d);
  orthographic.left=-visibleHeight*aspect/2;orthographic.right=-orthographic.left;
  const near=p>.46&&p<.9?.05:Math.max(.2,d-650),far=d+750;
  orthographic.top=visibleHeight/2;orthographic.bottom=-orthographic.top;orthographic.near=near;orthographic.far=far;orthographic.updateProjectionMatrix();
  perspective.aspect=aspect;perspective.near=near;perspective.far=far;
  perspective.fov=THREE.MathUtils.radToDeg(2*Math.atan(visibleHeight/2/d));perspective.updateProjectionMatrix();
  for(let i=0;i<16;i++)camera.projectionMatrix.elements[i]=mix(orthographic.projectionMatrix.elements[i],perspective.projectionMatrix.elements[i]/d,perspectiveBlend);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const plate=1-smooth((p-.025)/.18);
  stage.style.setProperty('--plate-opacity',plate);stage.style.setProperty('--label-opacity',plate);
  stage.style.setProperty('--study-opacity',smooth((p-.38)/.08)*(1-exit));
  const label=p<.035?'01 / Exploded':p<.28?'02 / Condense':p<.46?'03 / Align':p<.9?'04 / Inspect the route':'05 / Complete instrument';
  document.querySelector('.phase-name').textContent=label;
  stage.dataset.progress=p.toFixed(5);slider.value=Math.round(p*100);slider.setAttribute('aria-valuetext',label);
  document.querySelector('.scroll-track i').style.transform=`scaleX(${p})`;
  const active=mobileView?mobileView.active:names.reduce((best,n,i)=>Math.abs(assembled[i]-look.x)<Math.abs(assembled[best]-look.x)?i:best,0);
  if(mobileLayout.matches&&lastUI!==active||mobileLayout.matches&&stage.dataset.prelude!==String(p<.28?0:p<.46?1:2)){mobilePrelude(p);stage.dataset.prelude=String(p<.28?0:p<.46?1:2);}
  if(lastUI!==active){
    const link=document.querySelector('.study-link');link.href=`${names[active]}.html`;
    link.querySelector('strong').textContent=names[active].toUpperCase();
    link.querySelector('.study-number').textContent=`0${active+1} / 06`;
    link.querySelector('.study-description').textContent=mobileLayout.matches?PROJECT_STOPS[active].discipline:annotations[active];
    if(mobileLayout.matches)link.querySelector('.study-action').innerHTML='View project <b aria-hidden="true">↗</b>';lastUI=active;
  }
  const readable=mobileLayout.matches;
  const labelsAvailable=plate>.5;
  document.querySelector('.study-link').tabIndex=readable||p>.4&&p<.9?0:-1;
  document.querySelector('.study-link').setAttribute('aria-hidden',String(!(readable||p>.4&&p<.9)));
  document.querySelectorAll('[data-label]').forEach(el=>{el.tabIndex=labelsAvailable?0:-1;el.setAttribute('aria-hidden',String(!labelsAvailable));});
  document.querySelector('.social-card').inert=plate<.5;
  interfaceController.update(p,active);
}
function resize(){
  const active=current>.24&&!reduced.matches;stage.classList.toggle('three-active',active);
  const expansion=reduced.matches?0:smooth((current-.24)/.12),stageHeight=stage.clientHeight;
  if(mobileLayout.matches){
    surface.style.removeProperty('height');surface.style.removeProperty('top');surface.style.removeProperty('transform');
    const w=surface.clientWidth,h=surface.clientHeight;
    if(pathTracer)pathTracer.resize(w,h);
    else if(w!==lastWidth||h!==lastHeight){renderer.setSize(w,h,false);lastWidth=w;lastHeight=h;lastRasterPose=-1;}
    return w/h;
  }
  const baseHeight=surface.clientWidth/1.6;
  surface.style.height=`${mix(baseHeight,stageHeight,expansion)}px`;
  surface.style.top=`${mix(innerWidth<=900?stageHeight*.1+baseHeight/2:stageHeight*.42,stageHeight*.5,expansion)}px`;
  surface.style.transform='translateY(-50%)';
  const w=surface.clientWidth,h=surface.clientHeight;
  const override=Number(new URLSearchParams(location.search).get('samples'));
  const ratio=pathTracer?1:override>0?Math.min(override,2):1;
  // The CSS viewport changes through the transition, but the backing targets
  // stay fixed-height: reallocating multisampled HDR targets every frame stalls.
  const bufferHeight=Math.ceil(stageHeight);
  if(pathTracer)pathTracer.resize(w,bufferHeight);
  else{
    if(renderer.getPixelRatio()!==ratio)renderer.setPixelRatio(ratio);
    if(w!==lastWidth||bufferHeight!==lastHeight){renderer.setSize(w,bufferHeight,false);lastWidth=w;lastHeight=bufferHeight;lastRasterPose=-1;}
  }
  return w/h;
}
const frameWork=[];
let lastViewProgress,lastViewAspect,lastViewMobile;
function render(now){
  frame=0;if(!ready||document.hidden||interfacePaused||!canvasVisible)return;
  if(renderGate&&!renderGate.canSubmit()){renderGate.request();return;}
  let phaseAt=performance.now();const work={at:phaseAt},phase=name=>{const next=performance.now();work[name]=next-phaseAt;phaseAt=next;};
  const dt=Math.min(.25,(now-(lastTime||now-16))/1000);lastTime=now;
  // Native mobile scrolling already supplies a continuous coordinate. Do not
  // enqueue additional eased poses behind a slow GPU-completion fence.
  const proposed=reduced.matches||mobileLayout.matches?target:mix(current,target,1-Math.exp(-dt/0.10));
  optics?.requestProgress?.(proposed);
  const resolved=optics?.resolveProgress?optics.resolveProgress(proposed):proposed;
  if(optics?.resolveProgress&&resolved===current&&current!==target){
    const state=optics.snapshot();
    status.textContent=state.failed?'A baked view could not load. The last valid view is preserved; reload to retry.':'Loading the next baked view…';
    if(state.pending||state.failed)return;
  }else if(optics?.resolveProgress)status.textContent='';
  current=resolved;
  if(Math.abs(current-target)<.000025)current=target;
  const aspect=resize();
  if(!mobileLayout.matches||current!==lastViewProgress||aspect!==lastViewAspect||mobileLayout.matches!==lastViewMobile){
    pose(current,aspect);lastViewProgress=current;lastViewAspect=aspect;lastViewMobile=mobileLayout.matches;
  }phase('poseMs');
  if(!optics&&!bakedElements)fluid?.setProgress(current);
  elementPlayback?.update(camera,current);
  optics?.setProgress(current);
  phase('playbackMs');rasterTiming?.poll();phase('timerPollMs');
  const moving=Math.abs(current-target)>.000025;
  const finishMobileScroll=mobileLayout.matches&&!mobileMoving()&&rasterProbes?.snapshot().moving;
  const begin=performance.now(),submitted=pathTracer||!workingMotion||current!==lastRasterPose||elementFrameDirty||finishMobileScroll||rasterProbes?.needsFrame()||rasterLighting?.needsFrame()?drawScene():false;
  phase('drawMs');elementFrameDirty=false;
  if(submitted!==false){if(renderGate)renderGate.submitted({progress:current});else displayedProgress=current;}
  phase('gateSubmitMs');
  if(elementAudit)elementAudit.textContent=JSON.stringify({water:fluid?.snapshot(),fire:elementPlayback?.snapshot(),progress:current,optics:rasterOpticalMode,paused:interfacePaused});
  if(submitted!==false){lastRender=performance.now()-begin;drawCount++;if(frameTimes.length<1000)frameTimes.push(lastRender);rasterTiming?.recordFrame({now,moving,submitMs:lastRender});}
  if(auditElement&&window.instrument3D)auditElement.textContent=JSON.stringify(window.instrument3D.snapshot());
  phase('auditMs');frameWork.push(work);if(frameWork.length>12)frameWork.shift();
  if(moving||pathTracer?.needsFrame()||rasterProbes?.needsFrame()||rasterLighting?.needsFrame()||rasterTiming?.snapshot().pendingQueries)schedule();
}
function drawScene(){
  frameCalls=0;frameTriangles=0;
  if(pathTracer){
    scene.updateMatrixWorld(true);
    const submitted=pathTracer.render(camera,{geometryChanged:current!==lastTracePose,moving:Math.abs(current-target)>.000025});
    if(submitted!==false)lastTracePose=current;
    if(auditElement&&window.instrument3D)auditElement.textContent=JSON.stringify(window.instrument3D.snapshot());
    return submitted;
  }
  const moving=mobileMoving()||Math.abs(current-target)>.000025,geometryChanged=current!==lastRasterPose,now=performance.now();
  scene.updateMatrixWorld(true);
  rasterLighting?.update(camera,{progress:current,moving,geometryChanged,now});
  rasterOptics?.update(camera);
  // Optical rays refine after scrolling; the visible CAD remains full size.
  rasterTransport?.setScale?.(Number(query.get('optics-scale'))|| (moving ? (stagedGeometryOptics ? .18 : .35) : .5));
  rasterTiming?.begin(lastRasterPose<0?'startup':moving?'moving':rasterProbes?.snapshot().pending?'probe-update':'stationary');
  try{
    const beforeProbe=rasterProbes?.snapshot();
    rasterProbes?.update(camera,{progress:current,moving,geometryChanged,now});
    const afterProbe=rasterProbes?.snapshot();
    // Cube capture writes another target. Present the retained full-resolution
    // HDR image when no visible scene state changed, including a partial cube.
    const retained=mobileLayout.matches&&bakedElements&&afterProbe?.timeSliced&&!moving&&!geometryChanged&&!elementFrameDirty&&
      !rasterLighting?.needsFrame()&&beforeProbe?.blend===afterProbe.blend&&beforeProbe?.diffuseBlend===afterProbe.diffuseBlend&&hdrComposite?.present(renderer);
    if(retained){frameCalls+=retained.calls;frameTriangles+=retained.triangles;}
    else drawRasterScene();
    lastRasterPose=current;
  }finally{rasterTiming?.end();}
  return true;
}
function drawRasterScene(){
  optics?.prepare();
  let transportRendered=false;
  const opticalInView=!mobileLayout.matches||!bakedElements||opticalGeometryInView({THREE,objects,camera});
  if(workingMotion&&opticalInView){
    const size=renderer.getDrawingBufferSize(new THREE.Vector2());
    if(layeredTarget.width!==size.x||layeredTarget.height!==size.y)layeredTarget.setSize(size.x,size.y);
    if(workingOuterTarget.width!==size.x||workingOuterTarget.height!==size.y)workingOuterTarget.setSize(size.x,size.y);
    layeredSize.value.copy(size);
    const thicknessPass=rasterThickness?.render(camera);if(thicknessPass){frameCalls+=thicknessPass.calls||0;frameTriangles+=thicknessPass.triangles||0;}
    const optical=objects.filter(o=>!Array.isArray(o.material)&&(o.material.userData.cadTransmission??o.material.transmission)>0).map(o=>({object:o,visible:o.visible})),background=scene.background,previousTarget=renderer.getRenderTarget();
    // Water reads the opaque scene. The outer vessel reads a separate HDR
    // scene containing that actual water, avoiding both optical feedback and
    // the outer glass overwriting the inner liquid with an opaque-only image.
    // Both layers include paper instead of zero-alpha clear pixels. The final
    // output remains transparent; IOR, Fresnel and absorption remain physical.
    try{
      optical.forEach(({object})=>object.visible=false);scene.background=rasterPaperBackground;
      renderer.setRenderTarget(layeredTarget);renderer.render(scene,camera);
      frameCalls+=renderer.info.render.calls;frameTriangles+=renderer.info.render.triangles;
      if(partialRayOptics&&rasterTransport){
        optical.filter(({object})=>['light','elements'].includes(object.userData.meshRecord.module)).forEach(({object,visible})=>object.visible=visible);
        if(nativeGeometryOptics)rasterOptics.update(camera);
        const transportPass=rasterTransport.render(camera,{sourceRevision:current});transportRendered=true;
        if(transportPass){frameCalls+=transportPass.calls||0;frameTriangles+=transportPass.triangles||0;}
        optical.forEach(({object})=>object.visible=false);
      }
      if(!rasterOptics||partialRayOptics){
        optical.filter(({object})=>object.userData.staticWater).forEach(({object,visible})=>object.visible=visible);
        renderer.setRenderTarget(workingOuterTarget);renderer.render(scene,camera);
        frameCalls+=renderer.info.render.calls;frameTriangles+=renderer.info.render.triangles;
      }
      workingTransmissionLayers={inner:nativeGeometryOptics?'real opaque CAD hits with custom PBR; retained SCENES opaque HDR':'live opaque geometry HDR, native depth and page paper',outer:nativeGeometryOptics?'native LIGHT/ELEMENTS optical primitives, duct and opaque CAD intersections':partialRayOptics?'selected CAD boundary rays plus retained SCENES water and opaque HDR':rasterOptics?'actual glass/water boundary rays into opaque HDR':'live opaque geometry, actual CAD water and page paper',
        waterSourceMeshCount:optical.filter(({object,visible})=>visible&&object.userData.staticWater).length,
        outerOpticalMeshCount:optical.filter(({object,visible})=>visible&&!object.userData.staticWater).length,
        separateReadWriteTargets:true,scenePasses:partialRayOptics?4:rasterTransport?3:rasterOptics?2:3,samples:0};
    }finally{
      optical.forEach(({object,visible})=>object.visible=visible);scene.background=background;renderer.setRenderTarget(previousTarget);
    }
  }
  if(rasterTransport&&opticalInView&&!transportRendered){const info=rasterTransport.render(camera,{sourceRevision:current});if(info){frameCalls+=info.calls;frameTriangles+=info.triangles;}}
  const volumeSize=renderer.getDrawingBufferSize(new THREE.Vector2());
  for(const pass of volumePasses){const info=pass.render(renderer,camera,volumeSize);frameCalls+=info.calls;frameTriangles+=info.triangles;}
  if(glassShell&&fluid&&!optics&&!workingMotion){
    const size=renderer.getDrawingBufferSize(new THREE.Vector2());
    if(layeredTarget.width!==size.x||layeredTarget.height!==size.y)layeredTarget.setSize(size.x,size.y);
    layeredSize.value.copy(size);
    // Water is rendered first without the outer shell, so the shell can refract
    // the actual current liquid mesh rather than an opaque-only scene buffer.
    glassShell.visible=false;renderer.setRenderTarget(layeredTarget);renderer.render(scene,camera);
    frameCalls+=renderer.info.render.calls;frameTriangles+=renderer.info.render.triangles;
    glassShell.visible=true;renderer.setRenderTarget(null);
  }
  if(hdrComposite){const pass=hdrComposite.render(renderer,scene,camera,rasterPaperBackground);frameCalls+=pass.calls;frameTriangles+=pass.triangles;}
  else{renderer.render(scene,camera);frameCalls+=renderer.info.render.calls;frameTriangles+=renderer.info.render.triangles;}
  if(auditElement&&window.instrument3D)auditElement.textContent=JSON.stringify(window.instrument3D.snapshot());
}
function schedule(){
  if(frame||!ready||document.hidden||interfacePaused||!canvasVisible)return;
  if(renderGate&&!renderGate.canSubmit()){renderGate.request();return;}
  frame=requestAnimationFrame(render);
}
function updateRenderDependents(gate=renderGate?.snapshot()){
  const base=interfacePaused||!canvasVisible||document.hidden;
  const blocked=base||!!gate&&(gate.inFlight||gate.paused||gate.held||gate.quietUntil>performance.now()||!!gate.error);
  elementPlayback?.setPaused(blocked);rasterProbes?.setPaused(blocked);
  if(gate?.error)status.textContent='3D rendering paused. Reload to restore the instrument, or use the project links.';
}
function updateRenderPause(){
  renderGate?.setPaused(interfacePaused||!canvasVisible||document.hidden);
  updateRenderDependents();
}
function configureRenderGate(){
  const enabled=mobileLayout.matches&&bakedElements&&workingMotion&&!pathTracer&&query.get('frame-gate')!=='off';
  if(!enabled){renderGate?.dispose();renderGate=undefined;updateRenderPause();return;}
  if(renderGate)return;
  renderGate=createRenderGate({gl:renderer.getContext(),onReady:schedule,onState:updateRenderDependents,
    onComplete:job=>{
      displayedProgress=job.progress;
      if(!fullFrameComplete){fullFrameComplete=true;startup.fullReadyMs=performance.now()-startup.started;startup.gpuFullReadyMs=startup.fullReadyMs;}
      if(Math.abs(displayedProgress-target)<.000025)status.textContent='';
    }});
  updateRenderPause();
}
function deferMobileRender(){
  if(!renderGate)return;cancelAnimationFrame(frame);frame=0;renderGate.hold(120);
}
let controlPointer;
document.addEventListener('pointerdown',event=>{
  // Canvas/document swipes keep rendering the scroll choreography. Only a
  // pressed button or link pauses work until its release/cancellation.
  if(!renderGate||!event.target.closest('button,a'))return;
  controlPointer=event.pointerId;cancelAnimationFrame(frame);frame=0;renderGate.beginInteraction();
},{capture:true,passive:true});
for(const type of ['pointerup','pointercancel'])document.addEventListener(type,event=>{
  if(event.pointerId!==controlPointer)return;controlPointer=undefined;renderGate?.endInteraction(120);
},{capture:true,passive:true});
document.addEventListener('keydown',event=>{if(event.target.closest('button,input,a'))deferMobileRender();},{capture:true});
const scrollTour=createScrollTour({root,stage,viewport:window,onProgress:setTarget,isReduced:()=>reduced.matches,allowReducedScroll:()=>mobileLayout.matches,isPaused:()=>interfacePaused,mapProgress:p=>mobileLayout.matches?mobilePageToPose(p):p,unmapProgress:p=>mobileLayout.matches?mobilePoseToPage(p):p});
function measureScroll(){scrollTour.measure();}
function setTarget(p){
  const wasSettled=Math.abs(current-target)<=.000025;target=clamp(p);
  if(mobileLayout.matches)interfaceController.target(target);
  if(geoStarter&&!ready)geoStarter.setProgress(target);
  if(wasSettled)lastTime=0;schedule();
}
function scroll(){
  if(mobileLayout.matches){
    lastNativeScroll=performance.now();clearTimeout(mobileScrollWake);
    // Wake once after native scroll settles so full-quality refinement can resume.
    mobileScrollWake=setTimeout(()=>{mobileScrollWake=undefined;schedule();},180);
  }
  scrollTour.scroll();
}
function jump(p){
  measureScroll();scrollTour.jump(p);
  if(reduced.matches){current=target;schedule();}
}
function fallback(message){
  ready=false;cancelAnimationFrame(frame);frame=0;
  pathTracer?.dispose();pathTracer?.canvas.remove();pathTracer=undefined;
  rasterTiming?.dispose();rasterProbes?.dispose();rasterTransport?.dispose();rasterOptics?.dispose();rasterThickness?.dispose();rasterLighting?.dispose();
  renderer?.domElement.remove();disposeRasterResources();root.classList.remove('is-enhanced');
  stage.classList.remove('three-ready','three-active');
  surface.style.removeProperty('height');surface.style.removeProperty('top');surface.style.removeProperty('transform');
  stage.style.setProperty('--plate-opacity',1);stage.style.setProperty('--label-opacity',1);stage.style.setProperty('--study-opacity',0);
  window.scrollTo({top:root.offsetTop,behavior:'instant'});
  document.querySelector('.social-card').inert=false;
  document.querySelectorAll('[data-label]').forEach(el=>{el.tabIndex=0;el.removeAttribute('aria-hidden');});
  status.textContent=message;stage.classList.add('mobile-loading');
  import('./instrument-elements-movie.mjs?v=shared-4').then(({loadElementsMovieFallback})=>loadElementsMovieFallback({surface,reduced,status})).catch(error=>console.warn('Baked composite preview unavailable',error));
}

async function init(){
  [routeSpec,manifest]=await Promise.all([
    fetch(cartridgePreview?geometryBase+'route.json':'./instrument-route.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Route unavailable: '+r.status);return r.json();}),
    fetch(geometryBase+'manifest.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('CAD manifest unavailable: '+r.status);return r.json();})
  ]);assembled=routeSpec.assembled;
  if(manifest.workingGeometry){
    const thumbnails=document.querySelectorAll('.rail-art img');
    for(const [index,name] of[[3,'song'],[4,'combat'],[5,'scenes']])if(thumbnails[index])thumbnails[index].src=`${geometryBase}thumb-${name}.webp?v=${manifest.stats.sha256}`;
  }
  const studioLighting=manifest.workingGeometry&&!qualityMode&&query.get('lighting')!=='workshop';
  const photographedStudio=studioLighting&&query.get('pbr-env')!=='authored';
  const photographedEnvironment={file:'./assets/pbr-metal/studio/studio_small_08-1024x512-rgba.f32.gz',width:1024,height:512,sha256:'a924864ac722d9bb7706b308c5be65df3d0feb27408c02ce34eed8a8158b7a5f',source:'Poly Haven Studio Small 08',author:'Sergej Majboroda',license:'CC0 1.0',method:'photographed HDR studio',rotationX:90,rotationZ:0,intensity:.38};
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
  const customPbr=manifest.workingGeometry&&!qualityMode&&!debugNoFinish&&!['legacy','procedural'].includes(query.get('metal'));
  const progressive=mobileLayout.matches&&bakedElements&&photographedStudio&&manifest.progressiveGeo&&typeof Worker!=='undefined'&&globalThis.crypto?.subtle&&query.get('startup')!=='full';
  let seed;
  if(progressive){
    startupPhase('geo-assets','Loading the complete GEO component.');
    const geoManifest={...manifest,meshes:manifest.meshes.filter(mesh=>mesh.module==='geo'),
      losslessTransfer:manifest.progressiveGeo,stats:{...manifest.stats,decodedGeometryBytes:manifest.progressiveGeo.decodedBytes,sha256:manifest.progressiveGeo.sha256Decoded}};
    startup.geo={};
    const [geoBuffer,environment,texture]=await Promise.all([
      loadGeometry(geoManifest,geometryBase,{onProgress:message=>status.textContent=message,metrics:startup.geo}),
      inflate(photographedEnvironment.file),
      new THREE.TextureLoader().loadAsync(`${geometryBase}machined-roughness.png?v=${manifest.stats.sha256}`)
    ]);
    seed={environment,texture};
    const {createGeoStarter}=await import('./instrument-geo-starter.mjs?v=story-1');
    startupPhase('geo-setup','Preparing the complete GEO component.');
    geoStarter=await createGeoStarter({THREE,renderer,surface,manifest,buffer:geoBuffer,environment,texture,slider,reduced,
      makeMaterial:materialFor,forgetMaterial:material=>{const index=materials.indexOf(material);if(index>=0)materials.splice(index,1);},scrollDriven:true,onProgress:jump});
    startupPhase('first-usable-3d');startup.firstUsable3DMs=performance.now()-startup.started;
    stage.classList.add('three-ready','geo-starter');root.classList.add('is-enhanced');
    measureScroll();scroll();
    interfaceController.ready(['geo']);interfaceController.update(target,0);mobilePrelude(target,true);
    document.querySelector('.phase-name').textContent='01 / GEO component';
    document.querySelector('.scroll-position>span:last-child').textContent='Scroll to explore ↓';
    const study=document.querySelector('.study-link');study.tabIndex=0;study.setAttribute('aria-hidden','false');
    study.dataset.project='geo';study.querySelector('.study-description').textContent='Complete native GEO component';
    document.querySelectorAll('[data-end]').forEach(button=>button.disabled=true);
    window.instrument3D={setProgress:jump,snapshot:()=>({...geoStarter.snapshot(),mobileLayout:true,
      renderMode:'native-geo-progressive-webgl2',scrollTour:scrollTour.snapshot(),fullGeometryVerified:false,geometryVerificationScope:'GEO only'})};
    status.textContent='GEO is interactive. Loading the full instrument and finishes.';
    // Allow the real model and its controls to paint before starting the large background transfer.
    await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  startupPhase('assets','Loading the full CAD and original materials.');
  const [buffer,environment,texture,customAssets,wearAssets]=await Promise.all([
    loadGeometry(manifest,geometryBase,{onProgress:message=>status.textContent=(progressive?'GEO is interactive. ':'')+message,legacy:query.get('transfer')==='legacy',metrics:startup.geometry}),seed?Promise.resolve(seed.environment):photographedStudio?inflate(photographedEnvironment.file):studioLighting?Promise.resolve(null):inflate(`${geometryBase}${manifest.environment.file}?v=${manifest.environment.sha256||manifest.stats.sha256}`),
    seed?Promise.resolve(seed.texture):new THREE.TextureLoader().loadAsync(`${geometryBase}machined-roughness.png?v=${manifest.stats.sha256}`),
    customPbr?loadInstrumentPbrAssets(THREE,{maxAnisotropy:renderer.capabilities.getMaxAnisotropy()}).then(value=>{if(rasterResourcesDisposed)value.dispose();else pbrAssets=value;return value;}):null,
    customPbr&&query.get('wear')!=='clean'?loadInstrumentPbrWearAssets(THREE,{maxAnisotropy:renderer.capabilities.getMaxAnisotropy()}).then(value=>{if(rasterResourcesDisposed)value.dispose();else pbrWearAssets=value;return value;}):null
  ]);pbrAssets=customAssets;pbrWearAssets=wearAssets;
  startupPhase('mesh-setup','Preparing the complete instrument.');
  geoStarter?.dispose();geoStarter=undefined;
  stage.classList.remove('geo-starter');slider.disabled=true;
  window.instrument3D=undefined;
  if(buffer.byteLength!==manifest.stats.decodedGeometryBytes)throw new Error('Mesh package revision mismatch. Reload to fetch matching assets.');
  // Full native raster resolution with hardware edge AA. Explicit higher
  // sampling remains available for matched offline comparisons.
  const sampleOverride=Number(new URLSearchParams(location.search).get('samples'));
  renderer.setPixelRatio(sampleOverride>0?Math.min(sampleOverride,2):1);
  renderer.setClearColor(0xf4f4f2,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=studioLighting?1:1.04;
  rasterPaperBackground=createRasterPaper(THREE,{color:0xf4f4f2,exposure:renderer.toneMappingExposure});
  if(bakedElements)hdrComposite=createHdrComposite(THREE);
  renderer.transmissionResolutionScale=1;
  layeredTarget=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,minFilter:THREE.LinearMipmapLinearFilter,generateMipmaps:true,samples:manifest.workingGeometry?0:4});
  if(manifest.workingGeometry&&!qualityMode&&['ray','thickness','geometry','staged'].includes(rasterOpticalMode)){layeredTarget.depthTexture=new THREE.DepthTexture(1,1,THREE.FloatType);layeredTarget.depthTexture.minFilter=layeredTarget.depthTexture.magFilter=THREE.NearestFilter;}
  layeredMap.value=layeredTarget.texture;
  if(manifest.workingGeometry){
    workingOuterTarget=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,minFilter:THREE.LinearMipmapLinearFilter,generateMipmaps:true,samples:0});workingOuterMap.value=workingOuterTarget.texture;
    if(!qualityMode&&(rasterOpticalMode==='thickness'||partialRayOptics)){workingOuterTarget.depthTexture=new THREE.DepthTexture(1,1,THREE.FloatType);workingOuterTarget.depthTexture.minFilter=workingOuterTarget.depthTexture.magFilter=THREE.NearestFilter;}
  }
  surface.append(renderer.domElement);scene=new THREE.Scene();camera=new THREE.Camera();
  if(photographedStudio&&environment.byteLength!==photographedEnvironment.width*photographedEnvironment.height*16)throw new Error('Studio HDR dimensions do not match its runtime data.');
  const environmentSpec=photographedStudio?photographedEnvironment:manifest.environment;
  const env=studioLighting&&!photographedStudio?createStudioEnvironment(THREE):new THREE.DataTexture(new Float32Array(environment),environmentSpec.width,environmentSpec.height,THREE.RGBAFormat,THREE.FloatType);
  env.colorSpace=THREE.LinearSRGBColorSpace;env.flipY=false;
  env.mapping=THREE.EquirectangularReflectionMapping;env.needsUpdate=true;
  if(manifest.workingGeometry&&qualityMode)scene.environment=env;
  else{
    const pmrem=new THREE.PMREMGenerator(renderer);rasterEnvironmentTarget=pmrem.fromEquirectangular(env);
    scene.environment=rasterEnvironmentTarget.texture;pmrem.dispose();
  }
  // CYBR Light's lat-long longitude starts at +X; Three starts at -X.
  if(photographedStudio){scene.environmentRotation.set(Math.PI/2,0,0);scene.environmentIntensity=photographedEnvironment.intensity;}
  else if(studioLighting){scene.environmentRotation.set(0,0,0);scene.environmentIntensity=1;}
  else if(manifest.environment.rotationZ!==undefined){scene.environmentRotation.z=THREE.MathUtils.degToRad(manifest.environment.rotationZ);scene.environmentIntensity=manifest.environment.intensity;}
  else scene.environmentRotation.y=Math.PI;
  env.generateMipmaps=true;env.minFilter=THREE.LinearMipmapLinearFilter;env.magFilter=THREE.LinearFilter;env.needsUpdate=true;
  // Settled local probes also use the source panorama as their HDR background.
  // Retain it through their lifetime instead of forcing a disposed reupload.
  rasterSourceEnvironment=env;
  for(const module of manifest.modules){const group=new THREE.Group();group.position.x=module.explodedX;groups.set(module.name,group);scene.add(group);}
  const materialCache=new Map();
  texture.colorSpace=THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());

  for(const mesh of manifest.meshes){
    const key=mesh.module+mesh.material;
    if(!materialCache.has(key))materialCache.set(key,materialFor(mesh.material,texture,mesh.module));
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',attribute(buffer,mesh.positions,3));
    geometry.setAttribute('normal',attribute(buffer,mesh.normals,3));geometry.setIndex(attribute(buffer,mesh.indices,1));geometry.computeBoundingSphere();
    geometry.setAttribute('uv',attribute(buffer,mesh.uv,2));geometry.setAttribute('occlusion',attribute(buffer,mesh.occlusion,1));
    if(mesh.colors)geometry.setAttribute('color',attribute(buffer,mesh.colors,3));
    if(mesh.finish)geometry.setAttribute('finish',attribute(buffer,mesh.finish,2));
    else geometry.setAttribute('finish',new THREE.BufferAttribute(new Float32Array(mesh.positions.count/3*2).fill(1),2));
    if(physicalMetal(mesh.material))metalCharts.push({module:mesh.module,feature:mesh.feature,...attachMetalCoordinates({THREE,geometry,mesh,materialIndex:mesh.material})});
    let meshMaterial=materialCache.get(key);
    if(pbrAssets&&physicalMetal(mesh.material)){
      const profileMaterials=[meshMaterial],profileIndices=new Map();
      const grouped=buildPbrMaterialGroups(geometry,{triangleMaterial:({style,chartKind})=>{
        if(style===0)return 0;
        const name=style===1?'brushed':style===3?'knurl':style===4?'etched':chartKind===1?(mesh.material===8?'bronze':'turned'):'barrel';
        const variant=name+'-chart-'+chartKind;
        if(!profileIndices.has(variant)){
          const profileKey=key+'-pbr-'+variant;
          if(!materialCache.has(profileKey)){
            let profile={...pbrAssets.profiles[name],chartKind};
            if(mesh.material===2)profile={...profile,colorMultiplier:[.12,.14,.16]};
            if(pbrWearAssets){
              const alloy=mesh.material===8?'bronze':[0,9].includes(mesh.material)?'aluminum':'steel';
              const wear=pbrWearAssets.alloys[alloy];
              profile={...profile,wearMaps:wear.wearMaps,wearTileMM:wear.wearTileMM,wearAlloy:alloy,wearStrength:wear.wearStrength};
            }
            materialCache.set(profileKey,materialFor(mesh.material,texture,mesh.module,profile));
          }
          profileIndices.set(variant,profileMaterials.length);profileMaterials.push(materialCache.get(profileKey));
        }
        return profileIndices.get(variant);
      }});
      geometry.setIndex(new THREE.BufferAttribute(grouped.indices,1));geometry.clearGroups();
      for(const entry of grouped.groups)geometry.addGroup(entry.start,entry.count,entry.materialIndex);
      pbrGroups.push({module:mesh.module,material:mesh.material,triangles:grouped.triangleCount,styleCounts:grouped.styleCounts,groups:grouped.groups});
      meshMaterial=profileMaterials;
    }
    const object=new THREE.Mesh(geometry,meshMaterial);object.name=mesh.module+'/'+mesh.feature+'/'+mesh.material;groups.get(mesh.module).add(object);
    object.userData.meshRecord=mesh;objects.push(object);
    if(progressive)await new Promise(resolve=>setTimeout(resolve,0));
    if(query.has('wireframe'))for(const activeMaterial of Array.isArray(object.material)?object.material:[object.material])activeMaterial.wireframe=true;
    if(mesh.assemblyShiftX)assemblyDetails.push({object,shift:mesh.assemblyShiftX});
    if(mesh.module==='elements'&&mesh.material===3){glassShell=object;object.renderOrder=2;}
    if(mesh.module==='light'&&mesh.material===3)opticalLens=object;
    if(mesh.module==='elements'&&mesh.material===7||manifest.customMaterials?.[mesh.material]?.role==='springs-water')object.userData.staticWater=true;
  }
  startupPhase('playback','Preparing cached water and fire.');
  const params=new URLSearchParams(location.search),bakeAuthor=params.has('bake-author'),working=!!manifest.workingGeometry,pathBake=!working&&!bakeAuthor&&!params.has('live-optics');
  if(!working&&!bakeAuthor&&!pathBake)fluid=await loadFluid(groups.get('elements'),schedule);
  if(!working&&!bakeAuthor&&!pathBake&&!new URLSearchParams(location.search).has('screen-optics')){
    const {rayOptics}=await import('./instrument-ray-optics.js');
    optics=await rayOptics({elements:glassShell,light:opticalLens},env,schedule);fluid.mesh.visible=false;
  }else if(!working&&!bakeAuthor&&!pathBake)volumePasses=[volumeDepth(fluid.mesh),volumeDepth(glassShell)];
  groups.get('elements').children.filter(o=>o.userData.staticWater).forEach(o=>o.visible=working);
  if(working&&bakedElements){
    // The verified FLIP cache replaces only the static CAD liquid. The vessel,
    // jacket and the rest of the instrument retain their actual geometry.
    objects.filter(object=>object.userData.staticWater&&object.userData.meshRecord.module==='elements').forEach(object=>object.visible=false);
    const waterMaterial=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.012,transmission:1,ior:1.333,thickness:42,attenuationColor:0xe3eff1,attenuationDistance:400,envMapIntensity:1,dithering:true});
    externalTransmission(waterMaterial,'elements');
    waterMaterial.onBeforeCompile=shader=>{useWorkingTransmissionBuffer(shader,'inner');bindRasterMaterial(shader,waterMaterial,'elements');};
    waterMaterial.customProgramCacheKey=()=> 'CYBR-native-FLIP-live-optics-v1';materials.push(waterMaterial);
    fluid=await loadFluid(groups.get('elements'),()=>{elementFrameDirty=true;schedule();},{base:'./assets/instrument-elements-bake/water-shared-v3/',material:waterMaterial});
    objects.push(fluid.mesh);
    elementPlayback=await loadElementsComposite({group:groups.get('elements'),fluid,reduced,visibleOnly:mobileLayout.matches,schedule:()=>{elementFrameDirty=true;schedule();}});
    if(query.has('audit')){elementAudit=document.createElement('output');elementAudit.id='elements-bake-output';elementAudit.hidden=true;document.body.append(elementAudit);}
  }
  if(pathBake)optics=['c','legacy-c'].includes(cartridgeChoice)
    ?await (await import('./instrument-hybrid-bake.js?v=4')).loadHybridBake(groups,schedule,manifest.stats.sha256)
    :await loadPathBake(groups,schedule,manifest.stats.sha256,cartridgeChoice==='legacy'?{base:query.has('legacy-bake')?'./assets/instrument-path/':'./assets/instrument-path-light/'}: {});
  makeCable(['takeup',[0,0,0]],['takeup',[0,0,0]],takeup(1).length-1);
  for(let i=0;i<names.length-1;i++)makeCable([names[i],routeSpec.ports[names[i]][1]],[names[i+1],routeSpec.ports[names[i+1]][0]]);
  if(working){workingMotion=createWorkingMotion({manifest,route:routeSpec,groups,objects,cables});assembled=workingMotion.assembled;}
  measureScroll();current=target=query.has('resume')?clamp(Number(query.get('resume'))||0):reduced.matches?target:scrollTour.progress();
  startupPhase('lighting','Preparing native lighting and optics.');
  resize();pose(current,surface.clientWidth/surface.clientHeight);
  elementPlayback?.update(camera,current);
  if(working&&qualityMode){
    status.textContent='Starting CYBR LIGHT realtime path tracing…';
    try{
      const {createInstrumentPathTracer}=await import('./instrument-pathtracer.js?v=temporal-8');
      pathTracer=await createInstrumentPathTracer({scene,objects,cableMeshes:cables.map(c=>c.mesh),environment:env,camera,
        onProgress:message=>status.textContent=message,
        onError:recoverQuality});
    }catch(error){recoverQuality(error);return;}
    if(qualityRecoveryRequested)return;
    renderer.domElement.remove();disposeRasterResources();surface.append(pathTracer.canvas);resize();pose(current,surface.clientWidth/surface.clientHeight);
  }else{
    if(working){
      rasterTiming=createRasterTiming(renderer,{gpuQueries:!mobileLayout.matches||query.get('timing')==='gpu'});
      rasterLighting=setupRasterLighting({THREE,renderer,scene,objects,cableMeshes:cables.map(c=>c.mesh),groups,schedule,studio:studioLighting});
      const {setupRasterProbes}=await import('./instrument-raster-probes.mjs?v=depth-3');
      if(query.get('probes')!=='off')rasterProbes=setupRasterProbes({THREE,renderer,scene,objects,cableMeshes:cables.map(c=>c.mesh),groups,environment:env,schedule,reflectionWeight:.15,diffuseWeight:0,sliceCapture:mobileLayout.matches,captureTriangles:mobileLayout.matches&&query.get('probe-chunks')!=='off'?8192:0});
      await rasterProbes?.prepare();
      // Rasterized CAD exit depths preserve physical thickness without BVH
      // traversal. Existing HDR depth buffers reject foreground sample leaks.
      if(rasterOpticalMode==='thickness'||partialRayOptics){
        const {setupRasterThickness}=await import('./instrument-raster-thickness.mjs?v=water-boundary-11');
        rasterThickness=setupRasterThickness({THREE,renderer,scene,objects:partialRayOptics?objects.filter(o=>o.userData.meshRecord.module==='scenes'):objects,fullSize:layeredSize,schedule,innerDepth:{value:layeredTarget.depthTexture},outerDepth:{value:workingOuterTarget.depthTexture},paperColor:rasterPaperBackground});
      }
      // Expensive ray candidates remain available for explicit inspection.
      if(['ray','boundary'].includes(rasterOpticalMode)){
        const {setupRasterOptics}=await import('./instrument-raster-optics.mjs?v=depth-4');
        status.textContent='Preparing CAD optics…';
        const rayObjects=partialRayOptics?objects.filter(o=>['light','elements'].includes(o.userData.meshRecord.module)):objects;
        rasterOptics=await setupRasterOptics({THREE,objects:rayObjects,environment:env,camera,scene,innerMap:layeredMap,outerMap:workingOuterMap,size:layeredSize,opaqueDepth:{value:layeredTarget.depthTexture},debugMode:Number(query.get('optics-debug'))||0,sampleMode:query.get('optics')==='boundary'?'boundary':'screen-ray',paperColor:rasterPaperBackground});
        if(query.get('optics')==='ray'){
          const {setupRasterTransport}=await import('./instrument-raster-transport.mjs?v=selected-cache-2');
          rasterTransport=setupRasterTransport({THREE,renderer,scene,objects:rayObjects,cableMeshes:cables.map(c=>c.mesh),fullSize:layeredSize,scale:.5,sourceRevision:()=>{const probe=rasterProbes?.snapshot();return[current,probe?.capturedEpoch,probe?.blend].join(':');}});
        }
      }
      if(nativeGeometryOptics){
        nativeStartup={started:performance.now()};
        status.textContent='Preparing native glass and water…';
        const {buildHitPbrTextureArrays}=await import('./instrument-hit-pbr.mjs?v=native-pbr-3');
        const fineLayers=Object.entries(pbrAssets.assets).map(([name,asset])=>({name,kind:'fine',color:asset.maps.baseColor,normal:asset.maps.normal,surface:asset.maps.roughness}));
        const wearLayers=Object.entries(pbrWearAssets?.alloys??{}).map(([alloy,asset])=>({name:alloy,alloy,kind:'wear',color:asset.wearMaps.color,normal:asset.wearMaps.normal,surface:asset.wearMaps.surface}));
        hitPbrArrays=await buildHitPbrTextureArrays({THREE,layers:[...fineLayers,...wearLayers],size:1024,maxAnisotropy:renderer.capabilities.getMaxAnisotropy()});
        nativeStartup.materialArraysMs=performance.now()-nativeStartup.started;
        status.textContent='Indexing native hidden surfaces…';
        const {setupNativeGeometryTransport}=await import('./instrument-native-geometry-transport.mjs?v=native-events-2');
        rasterOptics=await setupNativeGeometryTransport({THREE,scene,objects,cableMeshes:cables.map(c=>c.mesh),camera,size:layeredSize,paperColor:rasterPaperBackground,arrays:hitPbrArrays,specializeCapture:true,triangleBoundaries:stagedGeometryOptics});
        nativeStartup.geometryBuildMs=performance.now()-nativeStartup.started-nativeStartup.materialArraysMs;
        if(stagedGeometryOptics){
          const {setupNativeStagedTransport}=await import('./instrument-native-staged-transport.mjs?v=staged-realism-3');
          rasterTransport=await setupNativeStagedTransport({THREE,renderer,scene,objects,camera,fullSize:layeredSize,nativeTransport:rasterOptics,scale:.5,boundaryMode:'triangles',interfaceLimit:32,auditSamples:query.has('optical-samples')?[{x:600,y:260},{x:750,y:270},{x:700,y:410},{x:560,y:220}]:[],onProgress:message=>{
            status.textContent='Preparing glass and water…';
            nativeStartup.phase=message;
            if(query.has('audit')){
              let output=document.querySelector('#native-startup-output');
              if(!output){output=document.createElement('output');output.id='native-startup-output';output.hidden=true;document.body.append(output);}
              output.textContent=JSON.stringify(nativeStartup);
            }
          }});
        }else{
          const {setupRasterTransport}=await import('./instrument-raster-transport.mjs?v=selected-cache-2');
          rasterTransport=setupRasterTransport({THREE,renderer,scene,objects:objects.filter(object=>['light','elements'].includes(object.userData.meshRecord.module)),fullSize:layeredSize,scale:.5,sourceRevision:()=>current,specializeCapture:true});
        }
      }
    }
    startupPhase('shader-compile','Compiling the original materials.');
    const shaderCompileStarted=performance.now();
    await renderer.compileAsync(scene,camera);
    if(nativeGeometryOptics){
      nativeStartup.mainCompileMs=performance.now()-shaderCompileStarted;
      status.textContent='Compiling native glass and water…';
      const captureCompileStarted=performance.now();
      await rasterTransport.compileCaptureAsync(camera);
      nativeStartup.captureCompileMs=performance.now()-captureCompileStarted;
      nativeStartup.totalMs=performance.now()-nativeStartup.started;
      nativeStartup.phase='first-native-frame';
      status.textContent='Rendering the first native optical frame…';
      if(query.has('audit')){
        let startupOutput=document.querySelector('#native-startup-output');
        if(!startupOutput){startupOutput=document.createElement('output');startupOutput.id='native-startup-output';startupOutput.hidden=true;document.body.append(startupOutput);}
        startupOutput.textContent=JSON.stringify(nativeStartup);
      }
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  startupPhase('first-frame','Rendering the instrument.');
  root.classList.add('is-enhanced');measureScroll();
  if(!reduced.matches||mobileLayout.matches){current=target=scrollTour.progress();resize();pose(current,surface.clientWidth/surface.clientHeight);elementPlayback?.update(camera,current);}
  ready=true;configureRenderGate();
  const initialSubmit=performance.now();drawScene();lastRender=performance.now()-initialSubmit;drawCount++;
  renderGate?.submitted({progress:current});if(!renderGate){displayedProgress=current;fullFrameComplete=true;}
  stage.classList.add('three-ready');status.textContent='';
  startupPhase('ready');startup.readyMs=performance.now()-startup.started;startup.cpuFullReadyMs=startup.readyMs;if(!renderGate)startup.fullReadyMs=startup.readyMs;
  if(!startup.firstUsable3DMs)startup.firstUsable3DMs=startup.readyMs;
  slider.disabled=false;document.querySelectorAll('[data-end]').forEach(button=>button.disabled=false);
  measureScroll();interfaceController.ready();stage.classList.remove('mobile-loading');mobilePrelude(current);
  document.querySelector('[data-end="100"]').textContent='Next →';
  document.querySelector('.scroll-position>span:last-child').textContent='Scroll to assemble & inspect ↓';
  slider.addEventListener('input',()=>jump(Number(slider.value)/100));
  document.querySelectorAll('[data-end]').forEach(b=>b.addEventListener('click',()=>b.dataset.end==='100'?interfaceController.next():jump(0)));
  document.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();jump(.49);}));
  document.querySelectorAll('a[href="#projects"]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();jump(0);}));
  if(typeof IntersectionObserver!=='undefined'){
    const observer=new IntersectionObserver(([entry])=>{
      canvasVisible=!mobileLayout.matches||entry.isIntersecting;
      updateRenderPause();lastTime=0;
      if(canvasVisible)schedule();else{cancelAnimationFrame(frame);frame=0;}
    });observer.observe(surface);
    window.addEventListener('pagehide',event=>{if(!event.persisted)observer.disconnect();});
  }
  mobileLayout.addEventListener('change',()=>{configureRenderGate();const rect=surface.getBoundingClientRect();canvasVisible=!mobileLayout.matches||rect.bottom>0&&rect.top<innerHeight;updateRenderPause();measureScroll();scroll();schedule();
    document.querySelector('.scroll-position>span:last-child').textContent='Scroll to assemble & inspect ↓';});
  document.addEventListener('visibilitychange',()=>{lastTime=0;updateRenderPause();if(!document.hidden)schedule();});
  window.addEventListener('pagehide',event=>{if(!event.persisted){pathTracer?.dispose();rasterTiming?.dispose();rasterLighting?.dispose();rasterProbes?.dispose();rasterTransport?.dispose();rasterOptics?.dispose();rasterThickness?.dispose();disposeRasterResources();}});
  reduced.addEventListener('change',()=>{measureScroll();current=target=0;jump(0);schedule();});
  if(!rasterResourcesDisposed)renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();fallback('3D context lost. Reload to restore the instrument, or use the project links.');});
  window.instrument3D={setProgress:jump,snapshot:()=>({ready,fullReady:ready&&fullFrameComplete,viewReady:fullFrameComplete&&Math.abs((displayedProgress??-1)-target)<.000025,displayedProgress,renderGate:renderGate?.snapshot(),preview:false,frameWork,scrollTour:scrollTour.snapshot(),fullGeometryVerified:!!startup.geometry.decodedSHA256,startup,mobileLayout:mobileLayout.matches,mobileStory:mobileLayout.matches?{pageProgress:scrollTour.snapshot().pageProgress,poseProgress:current,framing:'real CAD envelopes',directScroll:true}:undefined,canvasVisible,progress:current,target,renderMode:pathTracer?'cybr-light-webgpu-pathtracer':working?'working-cad-hybrid-raster-webgl2':pathBake?'camera-path-bake':'live-optics',
    meshes:manifest.meshes.length,sourceParts:manifest.stats.sourceParts,triangles:manifest.stats.triangles,
    calls:frameCalls,submittedTriangles:frameTriangles,
    drawCount,submitMs:lastRender,submitSamples:frameTimes.slice(-120),
    camera:camera.position.toArray(),geometryBytes:manifest.stats.geometryBytes,
    opticalReference:query.has('audit')?{projectionInverse:camera.projectionMatrixInverse.toArray(),cameraWorld:camera.matrixWorld.toArray(),modules:['light','elements'].map(name=>({name,world:groups.get(name).matrixWorld.toArray()})),viewport:layeredSize.value.toArray()}:undefined,
    geometryReference:query.has('reference')?{modules:names.map(name=>({name,world:groups.get(name).matrixWorld.toArray()})),objects:objects.map(object=>({name:object.name,world:object.matrixWorld.toArray()})),cables:cables.map(cable=>({name:cable.mesh.name,world:cable.mesh.matrixWorld.toArray(),positions:Array.from(cable.geometry.attributes.position.array),normals:Array.from(cable.geometry.attributes.normal.array),uv:Array.from(cable.geometry.attributes.uv.array),indices:Array.from(cable.geometry.index.array)}))}:undefined,
    pendingFrame:!!frame,fluid:fluid?.snapshot(),elementsBake:elementPlayback?.snapshot(),optics:optics?.snapshot(),pathTracer:pathTracer?.snapshot(),workingMotion:workingMotion?.snapshot(),
    rasterTiming:rasterTiming?.snapshot(),rasterLighting:rasterLighting?.snapshot(),rasterProbes:rasterProbes?.snapshot(),rasterOptics:rasterOptics?.snapshot(),
    rasterTransport:rasterTransport?.snapshot(),rasterThickness:rasterThickness?.snapshot(),hitPbrArrays:hitPbrArrays?.snapshot(),nativeActiveSamplers:nativeSamplerInventory(),nativeStartup,
    lightingEnvironment:photographedStudio?photographedEnvironment:studioLighting?STUDIO_ENVIRONMENT_METADATA:manifest.environment,
    opticalShading:query.has('audit')&&!pathTracer?objects.filter(o=>!Array.isArray(o.material)&&o.material.userData.cadTransmission>0).map(o=>({name:o.name,roughness:o.material.roughness,thicknessMM:o.material.thickness,compiledThickness:o.material.userData.auditRasterShader?.uniforms.thickness?.value,transmission:o.material.userData.auditRasterShader?.uniforms.transmission?.value,mixedTransmissionView:o.material.userData.auditRasterShader?.fragmentShader.includes('inverseTransformDirection(geometryViewDir, viewMatrix)')})):undefined,
    machinedFinish:pathTracer?undefined:pbrAssets?{nativePbrMaps:true,roughnessNormalization:false,protectedMaterials:'original prescription'}:{preservesAuthoredRoughness:true,textureMean:MACHINED_ROUGHNESS_MEAN,resolvedVariationLimit:MACHINED_VARIATION_LIMIT,unresolvedVariation:0},
    metalFinishes:pathTracer?undefined:{enabled:metalCharts.length>0,version:pbrAssets?PBR_METAL_VERSION:METAL_FINISH_VERSION,proceduralRelief:!pbrAssets,styles:METAL_STYLES,profiles:pbrAssets?undefined:METAL_FINISH_PROFILES,normalMappedRelief:true,silhouetteDisplacement:false,grainAxes:'Physical per-part millimetre charts; GGX broad axis crosses grain',charts:metalCharts},
    pbrMaterials:pbrAssets?{version:PBR_METAL_VERSION,...pbrAssets.snapshot(),wear:pbrWearAssets?.snapshot(),grouping:pbrGroups}:undefined,
    transmissionPaper:pathTracer?undefined:{targetSRGB:[244,244,242],linearHDR:rasterPaperBackground.toArray(),exposure:renderer.toneMappingExposure},
    rasterContactVisibility:working&&!pathTracer?{diffuseMinimum:.7,diffuseStrength:.3,specularAttenuation:false,studioDiffuseIBLScale:studioLighting?.3:1}:undefined,
    geometryHash:manifest.stats.sha256,workingGeometry:working,legacyBeautyProjection:!working&&pathBake,
    staticCADWater:working,waterMeshCount:objects.filter(o=>o.userData.staticWater&&o.visible).length,
    transmissionBackground:pathTracer?'nested dielectric paths through actual CAD glass and water':working?'two live geometry layers with actual CAD water; final canvas transparent':undefined,
    transmissionLayers:working&&!pathTracer?workingTransmissionLayers:undefined,
    surfaceVisibility:working?manifest.surfaceVisibility:undefined,
    cadValidation:manifest.cadValidation||manifest.validation,approximateReflections:!pathTracer,route:'camera follows the working cable from outside narrow bores; GEO loop preserves cable length'})};
  if(query.has('audit')){auditElement=document.createElement('output');auditElement.id='audit-output';auditElement.hidden=true;document.body.append(auditElement);auditElement.textContent=JSON.stringify(window.instrument3D.snapshot());}
  if(bakeAuthor)window.instrument3D.exportBakePose=p=>{
    pose(p,1.6);scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    return {progress:p,projection:camera.projectionMatrix.toArray(),world:camera.matrixWorld.toArray(),
      groups:names.map(name=>({name,x:groups.get(name).position.x})),
      objects:[...groups.values()].flatMap(g=>g.children.map(o=>({name:o.name,shift:o.position.x,...(working?{matrix:o.matrix.toArray(),motion:o.userData.meshRecord?.motion}: {})}))),
      cables:cables.map(c=>{const a=c.geometry.attributes.position.array,points=[];for(let i=0;i<a.length;i+=17*3){const point=[0,0,0];for(let j=0;j<16;j++)for(let k=0;k<3;k++)point[k]+=a[i+j*3+k]/16;points.push(point);}return points;})};
  };
  if(!working&&new URLSearchParams(location.search).has('qa'))window.instrument3D.inspectFluid=async(p)=>{
    cancelAnimationFrame(frame);frame=0;
    fluid.setProgress(p);
    optics?.setProgress(p);
    while(fluid.snapshot().pending||optics?.snapshot().pending)await new Promise(resolve=>setTimeout(resolve,10));
    cancelAnimationFrame(frame);frame=0;
    groups.forEach((g,name)=>g.visible=name==='elements');
    const center=groups.get('elements').position.clone();
    camera.position.copy(center).addScaledVector(referenceDirection,145);camera.up.set(0,0,1);camera.lookAt(center);camera.updateMatrixWorld();
    perspective.aspect=surface.clientWidth/surface.clientHeight;perspective.fov=40;perspective.near=.1;perspective.far=1000;perspective.updateProjectionMatrix();
    camera.projectionMatrix.copy(perspective.projectionMatrix);camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    drawScene();
  };
  if(query.has('resume'))jump(current);else scroll();schedule();
}
const interfaceController=createInstrumentInterface({stage,root,jump,isReady:name=>ready||!!geoStarter&&(!name||name==='geo'),getTarget:()=>target,reduced,onInspect:()=>{},onPaneChange:open=>{interfacePaused=open;updateRenderPause();if(open){cancelAnimationFrame(frame);frame=0;}else{lastTime=0;measureScroll();scroll();schedule();}}});
measureScroll();window.addEventListener('scroll',scroll,{passive:true});
window.addEventListener('resize',()=>{scrollTour.resize({preserve:mobileLayout.matches});schedule();},{passive:true});
init().catch(error=>{console.error(error);if(qualityMode&&/gpu|adapter|device|context/i.test(error.message||''))recoverQuality(error);else if(/creating WebGL context|context.*lost/i.test(error.message||''))fallback('This browser cannot start 3D graphics. Reopen the browser to retry, or explore the project links below.');else fallback('3D could not load. Use the project links or reload to retry.'+(query.has('audit')?' '+error.message:''));});
