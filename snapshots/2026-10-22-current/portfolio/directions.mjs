import * as T from './vendor/three-r180/three.module.min.js';
import {createReferenceInstrument} from './reference-instrument.mjs';
import {createIris09MeshStage} from './iris09-mesh-stage.mjs';
import {createScrollFrameBenchmark} from './scroll-frame-benchmark.mjs';
import {loadJourneyProjects} from './journey-projects.mjs';
import {applyCybrSurfacesThree} from '../cybr-light/browser/cybr-surfaces-three.mjs';
import {designs,chapters as baseChapters,clamp,smooth,journeyState} from './directions-state.mjs';
import {studioCopy} from './direction11-copy.mjs';
import {contourSegments} from './source-contours.mjs';
import {createEventStudio} from './event-studio.mjs';
import {applyTurnedFinish} from './turned-finish.mjs';
import {applyReference27Finish} from './reference27-finish.mjs';
import {technicalLettering,geoLettering} from './reference27-lettering.mjs';
import {contourMarkup,materialCameraPose,chapterClipDefs,chapterTitles,titleMarkup} from './direction27-chapters.mjs';
import {scoreMarkup} from './reference27-score.mjs';
import {createBakedWaterOptics} from './baked-water-optics.mjs';
import {createFrameProfile} from './frame-profile.mjs';
import {prepareVisiblePrograms,observeBackgroundPrograms,preparationSnapshot} from './prepare-visible-programs.mjs';
import {withReflectionPreparation} from './reflection-preparation.mjs';
import {installTransmissionRegion} from './transmission-region.mjs';
import {morphContours} from './contour-handoff.mjs';
import {createEventCave} from './direction14-cave.mjs';
import {eventScoreMarkup} from './direction14-score.mjs';
import {createSongAsset} from './direction14-song-asset.mjs';
import {createShadowScore} from './direction11-song.mjs';
import {createShadowSet} from './direction11-set.mjs';
import {applyDirection11SourceFinishes} from './direction11-source-finishes.mjs';
import {createElementsShader as createShadowSplash} from './direction11-elements-shader.mjs';
import {loadElementsVolume,loadElementsOccupancy} from './elements-volume-data.mjs';
import {createElementsHDRComposite} from './elements-hdr-composite.mjs';
import {createElementsRoomProbe} from './elements-room-probe.mjs';
import {createElementsProjectedRegion} from './elements-projected-region.mjs';
import {installCanvasDemoRecorder} from './canvas-demo-recorder.mjs';
import {createShadowChoreography,chapterPresentation} from './direction11-choreography.mjs';
import {createSpringReflection} from './spring-reflection.mjs';
let springReflection;
addEventListener('pagehide',()=>springReflection?.dispose());

const $=s=>document.querySelector(s),id=new URLSearchParams(location.search).get('concept')||'11',design=designs[id]||designs['27'];
const chapters=id==='11'?baseChapters.map(chapter=>({...chapter,...studioCopy[chapter.key]})):baseChapters;
document.body.dataset.design=designs[id]?id:'27';document.title=`${id} / ${design.name} — CYBRDELIC`;
if(id==='11'){const style=document.createElement('link');style.rel='stylesheet';style.href='./direction-11.css';document.head.append(style);$('.header-links').textContent='';}
$('#storyboard').href='../docs/SCOPE.md';
const nav=$('#chapters'),audio=$('audio'),motion=matchMedia('(prefers-reduced-motion: reduce)');
let reduced=motion.matches;$('#reduced').checked=reduced;$('#reduced').onchange=e=>{reduced=e.target.checked;request();};motion.addEventListener('change',e=>{reduced=e.matches;$('#reduced').checked=reduced;request();});
chapters.forEach((c,i)=>{const b=document.createElement('button');b.textContent=c.name;b.dataset.chapter=c.key;b.onclick=()=>jump(i);nav.append(b);});
// The selected 14 reference shows successive poses of ONE chapter. Preserve
// that editorial navigation instead of putting a second project menu over it.
let eventPoses,openingContours;
if(id==='27'){
 $('.stage').insertAdjacentHTML('beforeend',chapterClipDefs);
 $('#score').setAttribute('preserveAspectRatio','none');
 $('.header-links a').textContent='WORK';$('.header-links a').href='#chapters';
 for(const el of [$('.brand span'),$('.header-links a'),$('#about'),...nav.children]){
  const label=el.textContent;el.setAttribute('aria-label',label);el.innerHTML=technicalLettering(label,{bold:el.matches('.brand span')});
 }
 const title=document.createElement('div');title.className='reference-geo-title';title.innerHTML=geoLettering;$('.stage').append(title);
 $('.guides').setAttribute('viewBox','0 0 1672 941');
 $('.guides').innerHTML='<g fill="none" stroke="currentColor" stroke-width="2.5"><path d="M0 233H640C710 233 690 157 744 157C800 157 814 58 1048 58C1310 58 1388 272 1440 272H1672"/><path d="M0 312H653"/><path d="M0 611H639C722 611 703 865 1055 865C1160 865 1190 817 1270 817H1672"/><path d="M0 720H700C770 720 784 865 1055 865"/></g>';
 openingContours=$('.guides').innerHTML;
 // Preserve the board's composition in taller desktop windows. Distorting
 // the frame stretched typography and pulled the rails away from the model.
 const composition=document.createElement('div');composition.className='reference-composition';
 for(const selector of ['#scene','.poster','.guides','#score','.caption','.reference-geo-title']){const node=$(selector);if(node)composition.append(node);}
 $('.stage').append(composition);
}
if(id==='14'){
 $('.header-links').hidden=true;
 $('.brand span').innerHTML=technicalLettering('CYBRDELIC',{bold:true});
 eventPoses=document.createElement('nav');eventPoses.className='event-poses';eventPoses.setAttribute('aria-label','Opening poses');
 eventPoses.setAttribute('aria-label','Seven project chapters');
 for(const [i,label] of chapters.map(c=>c.name).entries()){
  const b=document.createElement('button');b.textContent=String(i+1).padStart(2,'0');b.setAttribute('aria-label',label);
  b.onclick=()=>jump(i);eventPoses.append(b);
 }
 $('.stage').append(eventPoses);
}
function jump(i){document.body.dataset.settled='false';const destination=(i+(i===3||i===5?.4:.08))/7;target=destination;if(id!=='11'||reduced)progress=destination;scrollTo({top:destination*($('#journey').offsetHeight-innerHeight),behavior:'instant'});request();}
$('#next').onclick=()=>jump((journeyState(progress).index+1)%7);
for(const [button,dialog] of [['#notes-button','#notes'],['#about','#about-dialog']])if($(button)){
 const panel=$(dialog);let returnY=0;
 // Focus/scrollIntoView on a child of a sticky stage can move the document
 // before the click arrives. Preserve the presented pose, not that focus jump.
 $(button).onclick=()=>{returnY=progress*Math.max(1,$('#journey').offsetHeight-innerHeight);target=progress;panel.showModal();};
 // Native dialog focus restoration must not select another chapter while
 // inspecting transport controls at the end of a long diagnostic panel.
 panel.addEventListener('close',()=>{
  $(button).focus({preventScroll:true});
  scrollTo({top:returnY,behavior:'instant'});readScroll();
 });
}
document.querySelectorAll('dialog .close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('#sound').onclick=()=>{if(audio.paused)audio.play().then(request).catch(e=>errors.push(e.message));else audio.pause();request();};audio.onended=request;
const errors=[],canvas=$('#scene');let bootReady=false,raf=0,last=0,progress=0,target=0,disposed=false,projects,environmentReady=false,surfaces=null,frames=0,previousChapter=-1;
const renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true,logarithmicDepthBuffer:id!=='27'&&id!=='11',powerPreference:'high-performance'});
// Three normally logs failed programs and continues. Surface these failures
// in the page: a completed compilation promise is not proof of visible assets.
const shaderFailures=[];
renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{
 const detail=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n').slice(0,1600);
 const message='Shader compilation failed: '+detail;
 if(!shaderFailures.includes(message)){shaderFailures.push(message);errors.push(message);console.error(message);request();}
};
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.localClippingEnabled=true;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
// Authored camera paths never approach within 0.4 units of a surface. Avoid
// fragment-depth writes while retaining precision for the distant landscape.
const scene=new T.Scene(),camera=new T.PerspectiveCamera(39,1,id==='27'||id==='11'?.4:.04,20000),heroCamera=new T.OrthographicCamera(-10,10,6,-6,.04,100);
const eventSong=id==='14'?createSongAsset():null;if(eventSong){scene.add(eventSong.root);eventSong.root.visible=false;}
const shadowScore=id==='11'?createShadowScore({onChange:sourceChanged}):null;if(shadowScore)scene.add(shadowScore.root);
const shadowSet=id==='11'?createShadowSet():null;if(shadowSet)scene.add(shadowSet.root);
const shadowSplash=id==='11'?createShadowSplash():null;if(shadowSplash)scene.add(shadowSplash.root);
const elementsComposite=id==='11'?createElementsHDRComposite(renderer):null;
const elementsRoomProbe=id==='11'?createElementsRoomProbe(renderer,{resolution:512}):null;
const elementsProbePosition=new T.Vector3();
const elementsProjectedRegion=createElementsProjectedRegion();
let elementsDebugMode='beauty';
if(shadowSplash){
 const label=document.createElement('label');label.textContent='Elements transport view ';
 const select=document.createElement('select');select.id='elements-debug';
 for(const [value,text]of[['beauty','Beauty'],['full-frame-reference','Beauty · full-frame reference'],['frozen-beauty','Frozen beauty · retained samples'],['frozen-full-frame','Frozen beauty · full-frame reference'],['budget','Ray-budget exhaustion'],['backdrop','Refracted background coverage'],['fire-only','Fire only'],['water-only','Water only'],['fire-only-compiled','Fire only · compiled isolation'],['water-only-compiled','Water only · compiled isolation'],['none-compiled','Stage only · compiled isolation'],['no-air','Without air'],['no-earth','Without earth']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
 select.onchange=()=>{elementsDebugMode=select.value;shadowSplash.setDebugBudget(select.value==='budget');shadowSplash.setDebugMode(['budget','full-frame-reference','frozen-beauty','frozen-full-frame'].includes(select.value)?'beauty':select.value);request();};
 label.append(select);$('#notes').append(label);
 const probeStatus=document.createElement('p');probeStatus.id='elements-room-probe-status';probeStatus.textContent='Room reflection cache: waiting for the settled Elements stage.';$('#notes').append(probeStatus);
}
const elementsSourceState={phase:id==='11'?'pending':'unused',fire:false,water:false,error:null};
const elementsSourceAbort=new AbortController();let elementsSourceTask;
function prepareElementsSources(){
 if(!shadowSplash)return Promise.resolve();
 if(elementsSourceTask)return elementsSourceTask;
 elementsSourceTask=(async()=>{
  elementsSourceState.phase='loading';request();
  // Decode and upload serially offstage. These are 3D native simulation
  // coefficients/distances, not color frames or a screen-facing sprite.
  for(const [kind,url,setter]of[
   ['water','./assets/elements-current/water/flip-012-192.cybrvol','setSourceWaterVolume'],
   ['fire','./assets/elements-current/fire/native-fire.cybrvol','setSourceFireVolume']]){
   const volume=await loadElementsVolume(url,{signal:elementsSourceAbort.signal});
   if(disposed)return;
   const occupancy=kind==='fire'?await loadElementsOccupancy('./assets/elements-current/fire/native-fire-occupancy.json',{signal:elementsSourceAbort.signal}):null;
   if(disposed)return;
   const texture=shadowSplash[setter](volume,{occupancy});renderer.initTexture(texture);
   if(texture.userData.occupancyTexture)renderer.initTexture(texture.userData.occupancyTexture);
   elementsSourceState[kind]=true;request();
  }
  elementsComposite.prepareDisplay();elementsSourceState.phase='ready';request();
 })().catch(error=>{
  if(elementsSourceAbort.signal.aborted)return;
  elementsSourceState.phase='error';elementsSourceState.error=error.message;
  errors.push(`Elements source data: ${error.message}`);request();
 });
 return elementsSourceTask;
}
const shadowChoreography=id==='11'?createShadowChoreography():null;
const eventCave=id==='14'?createEventCave(T):null,eventRed=new T.Color(0x80170c);if(eventCave)scene.add(eventCave.group);
const eventBacking=id==='14'?new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshBasicMaterial({color:eventRed,toneMapped:false})):null;if(eventBacking){eventBacking.position.set(0,0,-12);eventBacking.visible=false;scene.add(eventBacking);}
const eventStudio=id==='11'||id==='14'||id==='27'?createEventStudio(T,renderer,{neutral:id!=='14',sculpted:id==='11'}):null;
const waterOptics=id==='27'?createBakedWaterOptics(T,renderer):null;
let referenceFinish;
scene.environmentIntensity=1.9;scene.environmentRotation.y=.5;
let irisStage=null,irisPreparation=null,irisCompileLabel='',irisCompileNotice=null,irisRenderError=null,contextLoss=null;
function stopIrisCompileNotice(){clearInterval(irisCompileNotice);irisCompileNotice=null;}
function renderIrisStage(options){
 if(irisRenderError)return false;
 try{return irisStage.render(renderer,options);}
 catch(error){
  // Three may report a program/link error only when the completed program is
  // first used. Keep that failure visible instead of abandoning the RAF before
  // the status and ready state can be updated, or retrying it on every scroll.
  irisRenderError=`IRIS / 09 render failed: ${error?.message||String(error)}`;
  if(!errors.includes(irisRenderError))errors.push(irisRenderError);
  return false;
 }
}
if(id==='11'){
 $('#heading').textContent=chapters[0].title;
 $('#description').textContent=chapters[0].description;
 $('#status').textContent='Preparing IRIS / 09 geometry…';
 const compileStarted=performance.now();
 irisCompileNotice=setInterval(()=>{irisCompileLabel=`Preparing IRIS / 09 materials · ${Math.round((performance.now()-compileStarted)/1000)}s`;if(irisStage?.status.phase!=='ready')request();},1000);
 irisPreparation=(async()=>{
 try{
  if(disposed)return;
  irisStage=createIris09MeshStage(T);
  await irisStage.compile(renderer);
  if(shaderFailures.length)throw Error(shaderFailures[0]);
 }catch(error){irisRenderError=error.message;if(!errors.includes(error.message))errors.push(error.message);throw error;}
  finally{stopIrisCompileNotice();}
 })();
 // A driver compile must not block the chapter navigation or the independent
 // project scenes. Do not substitute an image or the rejected mesh meanwhile.
 irisPreparation.then(request).catch(request);
}
const mechanism=id==='11'?null:createReferenceInstrument({concept:id,drawingColor:design.red?0xf5e7cd:0x171b18});
if(mechanism)scene.add(mechanism.root);
document.body.dataset.assetRevision=id==='11'?'iris09-constrained-mechanism-2':mechanism.root.userData.assetRevision;
$('#notes h2').textContent='Reference-built instruments. Original project sources.';
$('#notes > p').textContent=`The opening instrument is newly modeled from the selected concept, not the previous iris01 assembly. Its recipe authors the circular chassis, ${mechanism?.recipe.blades??9} overlapping leaves, slotted cam plate, optical seat, support bridges and pinion. These are visual reconstruction assets, not certified mechanisms.`;
$('#notes dd').textContent='New analytic profiles and beveled solids, with CYBR GEO’s reusable hidden-line renderer. No old iris01 meshes.';
if(id==='11'){
 $('#notes h2').textContent='IRIS / 09 — constrained mechanical reconstruction';
 $('#notes > p').textContent='The recovered exterior surrounds redesigned internals: nine rigid blades on fixed pivots, captured follower pins, a slotted drive ring, journals and hard stops. The ring is the single input; blade angles are solved from pin/slot constraints. Much of this assembly sits beneath the faceplate. Scroll transforms real geometry, not a video or sprite.';
 $('#notes dd').textContent='A variable aperture, not a fully closing shutter. The shortened ring stroke avoids crossing the nine slots. Dimensions are unscaled source units. This model does not simulate friction, forces, stress or deformation, and is not a manufacturing certification.';
 $('#notes dd:nth-of-type(2)').textContent='Source-derived metal finishes, filtered machining and engraving, with a prefiltered studio environment. The original GLSL is retained as a reference, not compiled by visitors.';
 $('#notes dd:nth-of-type(3)').textContent='Fire and water use native CYBR simulation data: linear emission/extinction in a 3D field and a recorded FLIP free surface. Mineral fragments and air are shader-authored. All four share one bounded render shader and one draw. These are captured simulation states with authored presentation motion, not a live coupled four-element simulation.';
 $('#notes dd:nth-of-type(4)').textContent='Original CYBR SONG score events on a curved 3D sheet, with filtered shader fibres and approximate thin-sheet backlighting. Not a cloth simulation.';
 $('#notes dd:nth-of-type(5)').textContent='Original avatar and recorded skeletal take. Source-UV knit on the shirt; the shorts have no valid UVs and use a fibre BRDF only. No new combat/contact physics is claimed.';
 $('#notes dd:nth-of-type(6)').textContent='Native Desert Hot Springs geometry, height maps and ripple modes. Corrected relief orientation and material-program identity; the source detail scale is preserved. Screen-space water refraction remains an approximation.';
 $('#renderer-note').textContent='The mechanism uses real geometry with shader-authored finishes and cached studio shadows. The warm mineral set uses raster lighting, a shared key/reflection rig, approximate indirect corner occlusion, and a static broad fire-light proxy—not live GI. Elements uses one bounded object-space shader, a cached HDR capture of the actual room for local reflections, and a depth-validated opaque-room view for refraction. The room capture is reused during animation, not rendered six times per frame. The native landscape retains its own water renderer. These are interactive transport approximations, not exact path tracing or live physics.';
}
// Separate only the presentation reveal materials. The CAD solids, map IDs,
// physical UV scale and source finishes remain the shared project data.
const revealMaterials=new Set(),revealParts=new Set(),revealClones=new Map();
if(id==='14'||id==='27')for(const part of mechanism.parts){if(part.material.transmission||id==='27'&&/iris blade|pinion|Lens retaining lip|Pivot retainer|Roller retaining head|Black cam linkage|Controller board|Routed encoder cable|Encoder connector|Encoder cap|Optical seal/i.test(part.name))continue;const original=part.material;if(!revealClones.has(original))revealClones.set(original,original.clone());part.material=revealClones.get(original);revealMaterials.add(part.material);revealParts.add(part);}
if(id==='27'){
 const blade=mechanism.parts.find(p=>/Rigid iris blade/.test(p.name));
 for(const part of mechanism.parts)if(part.name==='24T pinion')part.material=blade.material;
}
const hemi=new T.HemisphereLight(0xe7edf0,design.red?0x883f2a:0x817970,1.7);scene.add(hemi);
const sun=new T.DirectionalLight(0xffedcf,3.1);sun.position.set(design.red?12:6,design.red?6:10,9);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-16,right:16,top:16,bottom:-16,far:60});sun.shadow.normalBias=.025;scene.add(sun);
// A studio lamp has a finite origin. An infinite directional key illuminated
// through the room's rear wall and cast a spurious stripe across the stage.
const studioKey=id==='11'?new T.SpotLight(0xffdfae,0,0,Math.PI/3,.25,2):null;
if(studioKey){
 studioKey.castShadow=true;studioKey.shadow.mapSize.set(2048,2048);
 studioKey.shadow.camera.near=.2;studioKey.shadow.camera.far=80;studioKey.shadow.normalBias=.006;
 studioKey.shadow.focus=.72;studioKey.shadow.radius=2.25;
 scene.add(studioKey,studioKey.target,sun.target);
}
const fireSpill=id==='11'?new T.PointLight(0xff6826,0,16,2):null;
if(fireSpill){fireSpill.name='Captured fire / broad indirect-light proxy';scene.add(fireSpill);}
const fill=new T.DirectionalLight(0xc2d5e4,1.5);fill.position.set(-8,2,6);scene.add(fill);
if(id==='14'){sun.position.set(-5,20,12);fill.color.set(0xffddbb);sun.shadow.mapSize.set(2048,2048);}
const ground=new T.Mesh(new T.PlaneGeometry(100,100),new T.ShadowMaterial({color:design.red?0x35160b:0x4b473e,opacity:design.red?.50:.18}));ground.rotation.x=-Math.PI/2;ground.position.y=-4.3;ground.receiveShadow=true;scene.add(ground);
if(id==='11'){
 ground.material.dispose();ground.material=shadowSet.material;sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.006;
 renderer.shadowMap.type=T.PCFShadowMap;sun.shadow.radius=2.5;
}
let envTarget,fieldEnvTarget,outdoorTarget,fieldOutdoorTarget,outdoorTexture,skyTask,fieldRenderer,fieldCamera=new T.PerspectiveCamera(48,1,.04,20000),scoreBuilt=false,contoursReady=false;
const contourScene=new T.Scene(),contourViewport=new T.Vector2(1,1);
const contourMaterial=new T.LineBasicMaterial({color:0x72786c,transparent:true,opacity:.16,depthWrite:false});
contourMaterial.onBeforeCompile=shader=>{shader.uniforms.viewport={value:contourViewport};shader.fragmentShader='uniform vec2 viewport;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nvec2 uv=gl_FragCoord.xy/viewport;uv.y=1.0-uv.y;bool mobile=viewport.x/viewport.y<0.8;float start=mobile?0.35:0.33;float t=(uv.x-start)/(1.0-start);float top=mix(mobile?0.30:0.42,0.08,t);float bottom=mix(mobile?0.44:0.56,mobile?0.76:0.91,t);if(uv.x>=start&&uv.y>=top&&uv.y<=bottom)discard;');};
// Only Optical Field pays for the extra viewport. Its landscape is the same
// source geometry, not a generated backdrop or a photograph on a plane.
if(id==='05'){fieldRenderer=new T.WebGLRenderer({canvas:$('#optical'),alpha:true,antialias:true,logarithmicDepthBuffer:true,powerPreference:'high-performance'});fieldRenderer.setPixelRatio(Math.min(devicePixelRatio,1.25));fieldRenderer.toneMapping=T.ACESFilmicToneMapping;fieldRenderer.toneMappingExposure=1.05;}
// Async source geometry and fluid frames can arrive after scroll has settled.
// Their visibility and silhouettes still invalidate the shadow map.
const sourceFinishes=[],finishedSourceChapters=new Set();
function sourceChanged(){
 if(id==='11'&&projects)for(const key of ['combat','scenes'])if(projects.state[key]&&!finishedSourceChapters.has(key)){
  sourceFinishes.push(applyDirection11SourceFinishes(T,{combatRoot:key==='combat'?projects.groups.combat:null,sceneRoot:key==='scenes'?projects.groups.scenes:null}));
  finishedSourceChapters.add(key);
 }
 renderer.shadowMap.needsUpdate=true;springReflection?.invalidate();request();
}
const reviewAssets=new URLSearchParams(location.search).get('assetReview')==='7';
const sourceReady=loadJourneyProjects(scene,sourceChanged,{landscapeModel:id==='11'?'direction11-springs':'reference27-springs',lazy:true,...(id==='11'?{combatPose:'./assets/direction11-combat/',combatModel:'geometry',combatAnimationBase:'./assets/direction11-combat/',nativeSprings:true,nativeSpringsFinish:false,spatialSprings:true,prepareTexture:t=>renderer.initTexture(t)}:{}),...(id==='14'?{fluidBase:'./assets/reference27-wave-indexed/',combatPose:'./assets/reference27-combat/',combatAnimationBase:'./assets/direction14-source-punch/',spatialSprings:true,prepareTexture:t=>renderer.initTexture(t)}:{}),...(id==='27'?{fluidBase:'./assets/reference27-flow-transport/',combatPose:'./assets/reference27-combat/',...(reviewAssets?{combatModel:'geometry-fitted',landscapeModel:'reference27-landscape-rebuilt'}:{}),spatialSprings:true,prepareTexture:t=>renderer.initTexture(t)}:{})}).then(p=>{projects=p;if(id==='27')p.groups.elements.position.y=.2;if(id==='05')p.ensure('scenes');sourceChanged();return p;});
function prepareOutdoor(){if(skyTask)return skyTask;skyTask=(async()=>{try{const res=await fetch('./assets/springs-cartridge-v3/sky.bin.gz');if(!res.ok)throw Error('Source desert sky unavailable');const bytes=await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(bytes.byteLength!==512*256*16)throw Error('Invalid desert sky dimensions');outdoorTexture=new T.DataTexture(new Float32Array(bytes),512,256,T.RGBAFormat,T.FloatType);outdoorTexture.flipY=true;outdoorTexture.mapping=T.EquirectangularReflectionMapping;outdoorTexture.needsUpdate=true;const pmrem=new T.PMREMGenerator(renderer);outdoorTarget=pmrem.fromEquirectangular(outdoorTexture);pmrem.dispose();if(fieldRenderer){const fieldPMREM=new T.PMREMGenerator(fieldRenderer);fieldOutdoorTarget=fieldPMREM.fromEquirectangular(outdoorTexture);fieldPMREM.dispose();}lastFieldSignature='';request();}catch(e){errors.push(e.message);request();}})();return skyTask;}
const letteringCanvas=document.createElement('canvas'),letteringContext=letteringCanvas.getContext('2d'),letteringTexture=new T.CanvasTexture(letteringCanvas);letteringTexture.colorSpace=T.SRGBColorSpace;
let transmissionBackdropSize='';
function prepareTransmissionBackdrop(){
 const w=canvas.clientWidth,h=canvas.clientHeight,key=w+'x'+h;if(key===transmissionBackdropSize)return;transmissionBackdropSize=key;
 letteringCanvas.width=w;letteringCanvas.height=h;const ctx=letteringContext;ctx.fillStyle='#f5f5f0';ctx.fillRect(0,0,w,h);
 // Same glyph metrics, placement and clipping as titleMarkup/chapterTitles.
 // The old independent font size refracted a second, misaligned title.
 const [left,top,width,height]=chapterTitles.elements;
 ctx.fillStyle='#151915';ctx.save();ctx.translate(w*left,h*top);ctx.beginPath();ctx.rect(0,0,w*width,h*height);ctx.clip();ctx.scale(w*width/500,h*height/100);ctx.font='122px Impact';ctx.textBaseline='alphabetic';ctx.scale(500/ctx.measureText('ELEMENTS').width,1);ctx.fillText('ELEMENTS',0,98);ctx.restore();letteringTexture.needsUpdate=true;
}
function fitPoster(){if(id!=='04'&&id!=='27')return;const poster=$('.poster'),w=innerWidth,h=innerHeight,mobile=w/h<.8;letteringContext.font='100px Impact';const units=letteringContext.measureText(poster.textContent).width/100;if(id==='27'){poster.style.fontSize=Math.min(h*.4,w*(mobile?.33:.25),w*(mobile?.86:.34)/(units*.72))+'px';return;}const size=Math.min(mobile?w*.67:h*.9,w*.95/(units*.75)),stretch=Math.min(1.4,w*.95/(units*size));poster.style.fontFamily='Impact, sans-serif';poster.style.fontSize=size+'px';poster.style.transform=`scaleX(${stretch})`;poster.style.transformOrigin='left top';poster.style.left='3%';poster.style.top=mobile?'23%':'11%';
 letteringCanvas.width=w;letteringCanvas.height=h;letteringContext.fillStyle='#eeeee8';letteringContext.fillRect(0,0,w,h);letteringContext.fillStyle='#080909';letteringContext.font=`${size}px Impact`;letteringContext.textBaseline='top';letteringContext.save();letteringContext.translate(w*.03,h*(mobile?.23:.11));letteringContext.scale(stretch,1);letteringContext.fillText(poster.textContent,0,0);letteringContext.restore();letteringTexture.needsUpdate=true;}
let turnedFinish;
if(mechanism)applyCybrSurfacesThree(T,mechanism.hardware,{anisotropy:Math.min(8,renderer.capabilities.getMaxAnisotropy()),cooperative:true,prepareTexture:t=>renderer.initTexture(t)}).then(s=>{
 surfaces=s;
 for(const m of new Set(mechanism.parts.map(p=>p.material))){
  if(m.userData.cybrMaterial==='BrushedMetal'){m.normalScale.set(.12,.12);m.roughness=id==='11'?.8:id==='14'?.31:.65;m.anisotropy=.65;m.needsUpdate=true;}
  if(m.userData.cybrMaterial==='06_blackened_steel'){m.color.setRGB(...(id==='11'?[.8,.8,.8]:id==='27'?[3.3,2.95,2.6]:[3,2.8,2.5]));m.normalScale.set(.2,.2);m.roughness=id==='11'?.95:id==='27'?.55:id==='14'?.43:.8;m.envMapIntensity=id==='27'?3:1;}
 }
 if(id==='11'){
  const steel=mechanism.parts.find(p=>p.material.userData.cybrMaterial==='BrushedMetal')?.material;
  if(steel){steel.color.setRGB(.72,.70,.66);steel.roughness=.72;steel.normalScale.set(.08,.08);}
  // Preserve the actual black-oxide material; replacing its maps with bright
  // machined aluminium erased the distinction between leaves and carrier.
  for(const m of new Set(mechanism.parts.map(p=>p.material)))if(m.userData.cybrMaterial==='06_blackened_steel'){m.normalScale.set(.08,.08);m.needsUpdate=true;}
 }
 turnedFinish=applyTurnedFinish(mechanism.parts,id==='11'?{anisotropy:.35}:{});if(id==='27')referenceFinish=applyReference27Finish(mechanism.parts);for(const part of revealParts)revealMaterials.add(part.material);sourceChanged();
}).catch(e=>{errors.push(e.message);request();});
async function environment(){try{const base='./assets/pbr-metal/studio/',[meta,res]=await Promise.all([fetch(base+'studio_small_08-source.json').then(r=>r.json()),fetch(base+'studio_small_08-1024x512-rgba.f32.gz')]);if(!res.ok)throw Error('HDR unavailable');const data=new Float32Array(await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)data[i+c]*=.125;const tex=new T.DataTexture(data,...meta.runtimeDimensions,T.RGBAFormat,T.FloatType);tex.mapping=T.EquirectangularReflectionMapping;tex.needsUpdate=true;const pmrem=new T.PMREMGenerator(renderer);envTarget=pmrem.fromEquirectangular(tex);scene.environment=envTarget.texture;if(fieldRenderer){const fieldPMREM=new T.PMREMGenerator(fieldRenderer);fieldEnvTarget=fieldPMREM.fromEquirectangular(tex);fieldPMREM.dispose();}tex.dispose();pmrem.dispose();environmentReady=true;request();}catch(e){errors.push(e.message);request();}}
function request(){if(bootReady&&!raf&&!disposed&&!document.hidden)raf=requestAnimationFrame(draw);}
function fitHeadline(){if(id!=='11')return;const el=$('.shadow-headline'),mobile=innerWidth/innerHeight<.8;letteringContext.font='900 100px Arial';const width=Math.max(...el.innerHTML.split(/<br\s*\/?\s*>/i).map(t=>letteringContext.measureText(t).width))/100;el.style.fontSize=Math.min(innerWidth*(mobile?.2:.115),innerWidth*(mobile?.86:.40)/width)+'px';}
function resize(){const w=canvas.clientWidth,h=canvas.clientHeight;renderer.setSize(w,h,false);fieldRenderer?.setSize(w,h,false);lastFieldSignature='';camera.aspect=fieldCamera.aspect=w/h;camera.updateProjectionMatrix();fieldCamera.updateProjectionMatrix();fitPoster();fitHeadline();readScroll();}
const observer=new ResizeObserver(resize);observer.observe(canvas);
function readScroll(){if(document.querySelector('dialog[open]'))return;target=clamp(scrollY/Math.max(1,$('#journey').offsetHeight-innerHeight));document.body.dataset.settled='false';if(frames===0)progress=target;request();}
addEventListener('scroll',readScroll,{passive:true});addEventListener('visibilitychange',()=>{last=0;if(!document.hidden)request();});
function handleContextLost(event){
 event.preventDefault();disposed=true;stopIrisCompileNotice();cancelAnimationFrame(raf);raf=0;last=0;
 const chapter=String(document.body.dataset.chapter||journeyState(progress).key).slice(0,48);
 const reason=String(event.statusMessage||'No driver reason provided').slice(0,384);
 const message=`WebGL context lost during ${chapter}: ${reason}`;
 contextLoss={lost:true,chapter,reason};
 if(!errors.includes(message))errors.push(message);
 document.body.dataset.ready='false';document.body.dataset.settled='false';document.body.dataset.context='lost';
 $('#status').textContent=`${message}. Reload this direction to restore.`;
 // Context loss happens outside draw(), so update the diagnostics immediately
 // rather than leaving the last successful frame's empty errors/ready state.
 let metrics={};try{metrics=JSON.parse($('#metrics').textContent)||{};}catch{}
 $('#metrics').textContent=JSON.stringify({...metrics,ready:false,settled:false,context:contextLoss,errors},null,2);
}
canvas.addEventListener('webglcontextlost',handleContextLost);
 function buildScore(){const score=projects?.score();if(!score||scoreBuilt)return;scoreBuilt=true;const ns='http://www.w3.org/2000/svg',svg=$('#score');if(id==='14'){svg.innerHTML=eventScoreMarkup(score);return;}if(id==='27'){svg.innerHTML=scoreMarkup(score);svg.setAttribute('aria-label','Lantern Steps: source melody and guitar notation');return;}for(let staff=0;staff<2;staff++){for(let l=0;l<5;l++){const path=document.createElementNS(ns,'path');path.dataset.staffY=140+staff*150+l*16;path.setAttribute('d',`M0 ${140+staff*150+l*16}H1200`);path.setAttribute('stroke','currentColor');path.setAttribute('fill','none');path.setAttribute('stroke-width','.8');path.setAttribute('opacity','.5');svg.append(path);}}
 for(const n of score.notes){const g=document.createElementNS(ns,'g'),x=35+n.on/score.duration*1120,staff=n.instrument==='guitar'?1:0,y=195+staff*150-((n.midi??60)-60)*4;g.dataset.x=x;g.dataset.on=n.on;g.dataset.off=n.off;g.innerHTML=`<ellipse cx="${x}" cy="${y}" rx="8" ry="5" transform="rotate(-20 ${x} ${y})" fill="currentColor"/><path d="M${x+7} ${y}v-48" stroke="currentColor" stroke-width="1.5"/>`;svg.append(g);} }
function updateUI(s){const c=chapters[s.index];if(previousChapter!==s.index){document.body.dataset.chapter=c.key;$('.poster').textContent=c.name;$('.counter').textContent=String(s.index+1).padStart(2,'0');$('#eyebrow').textContent=`0${s.index+1} / CYBR ${c.name}`;$('#heading').innerText=id==='14'?c.event:id==='05'?(s.index===0?'A world,\nresolved.':c.title):c.title;$('#description').textContent=c.description;$('#project-link').href=id==='11'?'#chapters':c.url;$('#project-link').textContent=`Explore ${c.name} ↗`;$('#next').textContent=s.index===6?'↺ GEO':`→ ${chapters[s.index+1].name}`;$('.shadow-headline').innerHTML=['FORM<br>FINDS<br>LIGHT','LIGHT<br>FINDS<br>FORM','MATTER<br>HOLDS<br>LIGHT','FORCE<br>FINDS<br>FORM','FORM<br>FINDS<br>RHYTHM','INTENT<br>BECOMES<br>MOTION','FORM<br>BECOMES<br>PLACE'][s.index];[...nav.children].forEach((b,i)=>{if(i===s.index)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});if(s.key!=='song')audio.pause();previousChapter=s.index;}
 if(id==='27'&&$('.guides').dataset.chapter!==s.key){morphContours($('.guides'),contourMarkup(s.key)||openingContours,{reduced});$('.guides').dataset.chapter=s.key;$('.guides').style.transform='';}
 if($('.poster').dataset.fitted!==s.key){fitPoster();fitHeadline();if(id==='27'&&chapterTitles[s.key]){const el=$('.poster'),[x,y,w,h]=chapterTitles[s.key];el.innerHTML=titleMarkup(chapters[s.index].name);el.style.cssText=`left:${x*100}%;top:${y*100}%;width:${w*100}%;height:${h*100}%;transform:none`; }$('.poster').dataset.fitted=s.key;}
 $('#sound').hidden=s.key!=='song'||id==='14';$('#sound').textContent=audio.paused?'Play Lantern Steps ↗':'Pause Lantern Steps';$('.progress i').style.transform=`scaleX(${s.progress})`; }
const frameTimes=[],assemblyBounds=new T.Box3(),frameProfile=createFrameProfile(renderer);let lastDrive=-1,lastFieldSignature='',lastBeautySignature='',reusedBeautyFrames=0,lastShadow11='',lastMetricsTime=-Infinity,chapterPreparationComplete=id!=='11';
const benchmarkButton=document.createElement('button'),benchmarkOutput=document.createElement('pre');
benchmarkButton.textContent='Run 30-second scroll check';benchmarkButton.id='scroll-benchmark';benchmarkOutput.id='scroll-benchmark-results';
$('#notes').append(benchmarkButton,benchmarkOutput);
const scrollBenchmark=createScrollFrameBenchmark({button:benchmarkButton,output:benchmarkOutput,journey:$('#journey'),closeNotes:()=>$('#notes').close()});
const sceneRecorder=installCanvasDemoRecorder({canvas,container:$('#notes'),closeNotes:()=>$('#notes').close(),onStart:request,onStop:request});
const preparedPrograms=new Map();let preparationQueue=Promise.resolve();
const transmissionRegion=installTransmissionRegion(T,renderer);
const stopBackgroundObservation=observeBackgroundPrograms(renderer);
let elementsTime=0;
const elementsFrustum=new T.Frustum(),elementsViewProjection=new T.Matrix4();
const shadowInputs=()=>({width:canvas.clientWidth,height:canvas.clientHeight,mechanism,splash:shadowSplash,score:shadowScore,projects,set:shadowSet,ground,sun,studioKey,fireSpill,fill,hemi,scene,studio:eventStudio.texture,elementsTime:elementsDebugMode.startsWith('frozen-')?0:elementsTime,outdoor:outdoorTarget?.texture,sky:outdoorTexture});
const shadowProgramKey=state=>`11/${state.index}/${state.blend>0?`${state.index}-${state.next}`:''}/${!!outdoorTarget}/${!!scene.fog}`;
function enqueuePreparation(programKey,preparation,water=null){
 if(preparedPrograms.has(programKey))return preparationQueue;
 preparedPrograms.set(programKey,false);
 preparationQueue=preparationQueue.then(()=>water?waterOptics?.prepareProgram(water,preparation.camera):null)
  .then(()=>{if(!disposed)return prepareVisiblePrograms(T,renderer,preparation.scene,preparation.camera);})
  .then(()=>{if(shaderFailures.length)throw Error(shaderFailures[0]);preparedPrograms.set(programKey,true);request();})
  .catch(e=>{if(!errors.includes(e.message))errors.push(e.message);preparedPrograms.set(programKey,false);request();});
 return preparationQueue;
}
function draw(now){raf=0;if(disposed||document.hidden)return;const dt=last?Math.min(.05,(now-last)/1000):1/60,moving=Math.abs(progress-target)>.00002;if(last&&moving){frameTimes.push(now-last);if(frameTimes.length>240)frameTimes.shift();}last=now;progress=reduced?target:progress+(target-progress)*(1-Math.exp(-dt*16));if(Math.abs(progress-target)<.00002)progress=target;const s=journeyState(progress),u=smooth(s.local);if(id!=='27'&&id!=='11')updateUI(s);
 let elementsAnimating=id==='11'&&!reduced&&progress*7>2.64&&progress*7<4;
 if(elementsAnimating)elementsTime+=dt;
 if(id==='11'&&s.index<3&&(irisRenderError||irisStage?.status.phase!=='ready')){
  // No synchronous GL queries while the browser driver compiles. Keep the
  // navigation and the pending/error diagnostics responsive in the DOM.
  updateUI(s);document.body.dataset.ready='false';document.body.dataset.settled=String(!moving);
  $('#status').textContent=irisRenderError||errors[0]||irisCompileLabel||'Preparing IRIS / 09 materials…';
  $('#metrics').textContent=JSON.stringify({chapter:s.key,iris:irisStage?.status,source:irisStage?.metadata,context:contextLoss,errors},null,2);
  if(moving)request();else last=0;return;
 }
 const projectKeys=id==='11'?['song','combat','scenes']:['elements','song','combat','scenes'];if(projects){const destination=journeyState(target).key;if(projectKeys.includes(destination))projects.ensure(destination);if(s.key===destination&&projectKeys.includes(s.key))projects.ensure(s.key);if(s.local>.55){const next=chapters[s.index+1]?.key;if(projectKeys.includes(next))projects.ensure(next);}const legacy=[0,.22,.27,.39+u*.19,.53+u*.17,.68+u*.16,.99][s.index];projects.update(legacy,audio.paused?null:audio.currentTime,s.key);projects.groups.root.visible=s.index>=3;for(const k of ['elements','song','combat','scenes'])projects.groups[k].visible=k===s.key;projects.groups.song.visible=false;buildScore();}
 frameProfile.begin(s.key==='elements'&&elementsDebugMode!=='beauty'?`elements/${elementsDebugMode}`:s.key);let frameRendered=true,frameReused=false;
 let activeCamera=camera;
 const reveal=s.index===0?(id==='14'?smooth((s.local-.82)/.18):id==='27'?smooth((s.local-.65)/.35):1):1;
 // The source-derived IRIS stage owns the opening. Do not update an invisible
 // previous instrument or run its separate material/camera director behind it.
 if(id!=='11'){
 if(id==='11')$('.shadow-headline').innerHTML='FORM<br>FINDS<br>LIGHT';
 let drive=s.index===0?.5+.4*u:s.index===1?.9-.45*u:s.index===2?.45+.15*u:.6;
 if(id==='14'&&s.index===0)drive=.78-.27*smooth((s.local-.2)/.6);
 if(s.index<3||id==='05')mechanism.update(drive,1,'mechanism',s.index>0?1:0);mechanism.root.rotation.set(id==='14'?0:.04,0,id==='14'?0:-.12+(s.index+u)*.07);mechanism.root.visible=s.index<3;ground.visible=s.index<3||s.key==='combat';
 for(const m of revealMaterials){const transparent=reveal<.999;if(m.transparent!==transparent){m.transparent=transparent;m.needsUpdate=true;}m.opacity=reveal;m.depthWrite=!transparent;}
 for(const part of mechanism.parts)part.visible=part.name==='Optical element'?id==='11'||s.index>0:!revealParts.has(part)||reveal>.001;
 if(s.index===0&&(id==='27'||id==='14')){mechanism.whiteprint?.update(1-reveal);mechanism.hardware.visible=id==='27'||reveal>.001;}
 if(id==='14'){
  [...eventPoses.children].forEach((b,i)=>{if(i===s.index)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
  // The lens stays clear in the source reference; do not introduce an opaque
  // pink transmission disk during the geometry/material presentation.
  if(s.index===0)for(const p of mechanism.parts)if(p.name==='Optical element')p.visible=false;
  if(s.index===0)for(const p of mechanism.parts)if(/^(Optical retaining mask|Lens retaining lip)$/.test(p.name)){
   const alpha=reveal*smooth((s.local-.68)/.2);p.visible=alpha>.001;
   if(p.material.transparent!==(alpha<.999)){p.material.transparent=alpha<.999;p.material.needsUpdate=true;}
   p.material.opacity=alpha;p.material.depthWrite=alpha>=.999;
  }
 }
 const mobile=camera.aspect<.8;
 if(s.index<3){activeCamera=heroCamera;const center=mobile?(id==='11'?[.62,.55]:id==='14'?[.62,.46]:[.5,.49]):design.center,macro=s.index===2,close=mobile?.12:.22;const height=(mobile?22:design.height)*(macro?1-close:s.index===1?1-close*smooth((u-.75)/.25):1);heroCamera.left=-height*camera.aspect/2;heroCamera.right=height*camera.aspect/2;heroCamera.top=height/2;heroCamera.bottom=-height/2;heroCamera.position.set(macro?10:s.index===1?7+u*3:7,3,23);heroCamera.lookAt(0,0,0);heroCamera.setViewOffset(canvas.clientWidth,canvas.clientHeight,(.5-center[0])*canvas.clientWidth,(.5-center[1])*canvas.clientHeight,canvas.clientWidth,canvas.clientHeight);heroCamera.updateProjectionMatrix();}
 else {const eye=s.key==='elements'?[2.7,1.4,-3.5]:s.key==='song'?[3,1,-7]:s.key==='combat'?[4,1,-11]:[2.1+u*.55,-2.3,-26.2];const aim=s.key==='elements'?[0,-1.8,-8]:s.key==='song'?[0,-1.6,-12]:s.key==='combat'?[0,-2.3,-17]:[-.15,-3.65,-35.15];camera.position.fromArray(eye);camera.lookAt(new T.Vector3(...aim));camera.clearViewOffset();if(s.key!=='scenes'){camera.setViewOffset(canvas.clientWidth,canvas.clientHeight,(mobile?-.05:-.19)*canvas.clientWidth,0,canvas.clientWidth,canvas.clientHeight);}if(mobile&&s.key!=='scenes')camera.position.lerp(new T.Vector3(...aim),-.4);camera.updateProjectionMatrix();}
 if(id==='14'&&s.index<3){
  const macro=s.index===2,h=macro?(mobile?4:3):(mobile?Math.max(11.9,9.8/camera.aspect):10.5),center=mobile?[.57,.49]:[.64,.49];
  heroCamera.left=-h*camera.aspect/2;heroCamera.right=h*camera.aspect/2;heroCamera.top=h/2;heroCamera.bottom=-h/2;
  if(macro){heroCamera.position.set(8+u*.4,4,7);heroCamera.lookAt(2,.8,.2);}else{heroCamera.position.set(1.4,1.6,26);heroCamera.lookAt(0,0,0);}
  heroCamera.setViewOffset(canvas.clientWidth,canvas.clientHeight,(.5-center[0])*canvas.clientWidth,(.5-center[1])*canvas.clientHeight,canvas.clientWidth,canvas.clientHeight);heroCamera.updateProjectionMatrix();
 }
 if(id==='11'){
  shadowSet.update(s.key);
  shadowSet.material.color.set(s.index<3||s.key==='elements'?0x9c8170:0xffffff);
  shadowSplash.root.visible=s.key==='elements';
  if(s.key==='elements'){
   if(projects)projects.groups.elements.visible=false;
   shadowSplash.update(u);ground.visible=false;
   camera.clearViewOffset();camera.position.set(0,1.3,13);camera.lookAt(0,-.7,0);
   camera.setViewOffset(canvas.clientWidth,canvas.clientHeight,(mobile?-.12:-.24)*canvas.clientWidth,0,canvas.clientWidth,canvas.clientHeight);camera.updateProjectionMatrix();
  }
  shadowScore.root.visible=s.key==='song';
  if(s.key==='scenes'&&projects){projects.groups.scenes.position.z=-28.5;projects.groups.scenes.position.y=-2.8;}
  if(s.key==='scenes'){camera.fov=2*Math.atan(Math.tan(36*Math.PI/180)/camera.aspect)*180/Math.PI;camera.position.set(2.1+u*.15,-3.08,-30.85);camera.lookAt(-.15,-4.45,-39.65);camera.clearViewOffset();camera.updateProjectionMatrix();}else if(camera.fov!==39){camera.fov=39;camera.updateProjectionMatrix();}
  if(s.index<2){const h=mobile?17:14.5;heroCamera.left=-h*camera.aspect/2;heroCamera.right=h*camera.aspect/2;heroCamera.top=h/2;heroCamera.bottom=-h/2;heroCamera.position.set(5,8,23);heroCamera.lookAt(0,-.3,0);heroCamera.setViewOffset(canvas.clientWidth,canvas.clientHeight,(mobile?-.12:-.24)*canvas.clientWidth,.04*canvas.clientHeight,canvas.clientWidth,canvas.clientHeight);heroCamera.updateProjectionMatrix();}
  if(s.key==='song'){shadowScore.update(u);camera.clearViewOffset();camera.position.set(0,2.3,Math.max(11.5,10/camera.aspect));camera.lookAt(0,-.3,0);camera.updateProjectionMatrix();ground.visible=true;}
  if(s.key==='material'){const h=mobile?5:4.3;heroCamera.left=-h*camera.aspect/2;heroCamera.right=h*camera.aspect/2;heroCamera.top=h/2;heroCamera.bottom=-h/2;heroCamera.position.set(8+u,3,8);heroCamera.lookAt(1.8,.6,0);heroCamera.updateProjectionMatrix();}
 }
 if(id==='14'){
  eventSong.root.visible=s.key==='song';
  if(s.key==='song'){
   eventSong.update(u);eventSong.root.position.set(mobile?.2:1.2,-.2,0);
   camera.clearViewOffset();camera.fov=39;camera.position.set((u-.5)*.65,0,Math.max(18,16/camera.aspect));camera.lookAt(.5,.2,0);camera.updateProjectionMatrix();
  }
  if(s.key==='scenes'){camera.fov=50;camera.position.set(0,-1.7,-20);camera.lookAt(0,-3,-40);camera.clearViewOffset();camera.updateProjectionMatrix();}else if(camera.fov!==39){camera.fov=39;camera.updateProjectionMatrix();}
  scene.background=s.key==='elements'?eventRed:s.key==='scenes'&&outdoorTexture?outdoorTexture:null;
  eventBacking.visible=s.key==='elements';
  eventCave.group.visible=s.key==='scenes';if(s.key==='scenes')eventCave.update(camera,projects?.groups.scenes);
  // Clear mechanical aperture through the first three beats, as in the board.
  for(const part of mechanism.parts)if(part.name==='Optical element')part.visible=false;
  if(s.key==='elements'&&projects){projects.groups.elements.position.set(.6,0,0);projects.groups.elements.rotation.set(-1.12,-.22,.8);projects.groups.elements.scale.setScalar(.027);camera.position.set(0,.4,-2.2);camera.lookAt(.3,-1.8,-8);camera.updateProjectionMatrix();}
  if(s.key==='combat'){if(projects)projects.groups.combat.rotation.y=-Math.PI*.8;camera.position.set(.5,-1.4,-9);camera.lookAt(0,-2.6,-17);camera.setViewOffset(canvas.clientWidth,canvas.clientHeight,(mobile?0:-.08)*canvas.clientWidth,0,canvas.clientWidth,canvas.clientHeight);camera.updateProjectionMatrix();}
 }
 if(id==='27'&&s.index<3){
  const h=mobile?Math.max(15,9.2/camera.aspect):Math.max(8.15,14.48/camera.aspect),center=mobile?[.52,.48]:[.635,.51];
  heroCamera.left=-h*camera.aspect/2;heroCamera.right=h*camera.aspect/2;heroCamera.top=h/2;heroCamera.bottom=-h/2;
  heroCamera.position.set(0,0,26);heroCamera.lookAt(0,0,0);
  heroCamera.setViewOffset(canvas.clientWidth,canvas.clientHeight,(.5-center[0])*canvas.clientWidth,(.5-center[1])*canvas.clientHeight,canvas.clientWidth,canvas.clientHeight);heroCamera.updateProjectionMatrix();
  mechanism.root.rotation.set(0,0,0);mechanism.whiteprint?.update(s.index===0?1-reveal:0);ground.visible=false;
  if(s.key==='light'&&!mobile){const scale=8.15/h;$('.guides').style.transform=`scaleY(${scale})`;$('.guides').style.transformOrigin='50% 51%';$('.poster').style.top=(.51+(.365-.51)*scale)*100+'%';$('.poster').style.height=.295*scale*100+'%';}
  if(s.key==='material'){
   const pose=materialCameraPose(u),height=mobile?5:pose.height;
   heroCamera.left=-height*camera.aspect/2;heroCamera.right=height*camera.aspect/2;heroCamera.top=height/2;heroCamera.bottom=-height/2;
   heroCamera.position.fromArray(pose.eye);heroCamera.lookAt(...pose.target);heroCamera.setViewOffset(canvas.clientWidth,canvas.clientHeight,(.5-(mobile?.7:pose.center[0]))*canvas.clientWidth,(.5-pose.center[1])*canvas.clientHeight,canvas.clientWidth,canvas.clientHeight);heroCamera.updateProjectionMatrix();
  }
  if(s.index===0){
   $('#heading').textContent='Mechanical systems, made visible.';
   if(!mobile){const layoutScale=8.15/h,top=(51-18*layoutScale);$('.guides').style.transform=`scaleY(${layoutScale})`;$('.guides').style.transformOrigin='50% 51%';$('.poster').style.top=top+'%';$('.reference-geo-title').style.top=(.51+(.365-.51)*layoutScale)*100+'%';$('.reference-geo-title').style.height=.295*layoutScale*100+'%';$('.caption').style.top=(.51+(.69-.51)*layoutScale)*canvas.clientHeight+'px';$('.caption').style.bottom='auto';}
   else{$('.guides').style.transform=`scaleY(${8.8/h})`;$('.guides').style.transformOrigin='50% 49%';$('.poster').style.top='';$('.caption').style.top='';$('.caption').style.bottom='';}
  }
 }
 if(id==='27'&&s.key==='combat'&&projects?.state.combat){
  // Show the source take from the side, with feet and floor in the frame.
  projects.groups.combat.scale.setScalar(2.2);
  const height=mobile?6.4:4.4;heroCamera.left=-height*camera.aspect/2;heroCamera.right=height*camera.aspect/2;heroCamera.top=height/2;heroCamera.bottom=-height/2;
  heroCamera.position.set(.5,-.7,0);heroCamera.lookAt(0,-2.5,-17);heroCamera.setViewOffset(canvas.clientWidth,canvas.clientHeight,(mobile?-.04:-.19)*canvas.clientWidth,0,canvas.clientWidth,canvas.clientHeight);heroCamera.updateProjectionMatrix();activeCamera=heroCamera;
 }
 if(id==='27'&&s.key==='elements'){
  projects?.groups.elements.scale.setScalar(.038);
  if(projects){projects.groups.elements.position.set(-.3,.35,0);projects.groups.elements.rotation.set(-1.12,-.22,-.08);}
  camera.position.set(0,.4,-2.2);camera.lookAt(.3,-1.8,-8);camera.setViewOffset(canvas.clientWidth,canvas.clientHeight,(mobile?0:-.12)*canvas.clientWidth,0,canvas.clientWidth,canvas.clientHeight);camera.updateProjectionMatrix();prepareTransmissionBackdrop();
 }
 if(id==='27'&&s.key==='scenes'){
  camera.fov=58;camera.position.set(-.3,reviewAssets?-.5:-2.1,reviewAssets?-23:-24);camera.lookAt(0,reviewAssets?-3.5:-4.1,reviewAssets?-40:-35);camera.clearViewOffset();camera.updateProjectionMatrix();
 }else if(id==='27'&&camera.fov!==39){camera.fov=39;camera.updateProjectionMatrix();}
 if(id!=='14'&&s.key==='song'&&scoreBuilt){const score=projects.score(),time=audio.paused?u*score.duration:audio.currentTime;const bend=x=>id==='27'?0:Math.sin(x/1200*Math.PI*1.5+time*.25)*Math.sin(x/1200*Math.PI)*(id==='11'?72:40);for(const path of $('#score').querySelectorAll('[data-staff-y]')){let d='';for(let x=0;x<=1200;x+=30)d+=(x?'L':'M')+x+' '+(+path.dataset.staffY+bend(x)).toFixed(2);path.setAttribute('d',d);}for(const n of $('#score').querySelectorAll('g')){const on=time>=+n.dataset.on&&time<+n.dataset.off;n.style.color=on?'#db7936':'';n.style.opacity=time>=+n.dataset.on?'1':'.7';n.setAttribute('transform',`translate(0 ${bend(+n.dataset.x)})`);}}
 if(id==='05'||s.key==='scenes')prepareOutdoor();scene.environment=s.key==='scenes'&&outdoorTarget?outdoorTarget.texture:envTarget?.texture||null;scene.environmentRotation.y=s.key==='scenes'?0:.5;
 hemi.intensity=s.key==='scenes'?.8:1.7;sun.intensity=s.key==='scenes'?2.5:3.1;fill.intensity=s.key==='scenes'?.5:1.5;scene.environmentIntensity=1.9;
 if(id==='11'&&s.key!=='scenes'){hemi.intensity=.4;fill.intensity=.16;scene.environmentIntensity=.75;sun.intensity=4.2;const z=s.key==='combat'?-17:s.key==='elements'?-8:0;sun.position.set(9,6,z-1);sun.target.position.set(0,-2,z);sun.target.updateMatrixWorld();}
 if(id==='11'&&s.key==='song'){sun.position.set(8,7,6);sun.intensity=1.8;hemi.intensity=.4;fill.color.set(0xffd6aa);fill.intensity=.25;}
 if(id==='11'&&s.index<3){sun.position.set(8,6,-10);sun.color.set(0xffedcf);fill.intensity=1.8;fill.color.set(0xffdbb5);scene.environment=eventStudio.texture;scene.environmentIntensity=1.2;}
 if(id==='11'&&s.key==='elements'){sun.position.set(8,6,-3);sun.target.position.set(0,-2,0);sun.target.updateMatrixWorld();scene.environment=eventStudio.texture;scene.environmentIntensity=2;sun.intensity=1.8;fill.intensity=.3;}
 if(id==='11'&&s.key==='scenes'){sun.position.set(-30,12,-55);sun.target.position.set(-1,-4,-36);sun.target.updateMatrixWorld();sun.intensity=3.4;sun.color.set(0xffe3bd);hemi.intensity=.22;fill.intensity=.08;scene.environmentIntensity=.8;}
 if(id==='11'){sun.shadow.bias=s.key==='scenes'?-.0004:0;sun.shadow.normalBias=s.key==='scenes'?.035:.006;}
 if(id==='14'){sun.position.set(-5,20,12);sun.target.position.set(0,0,0);sun.target.updateMatrixWorld();}
 if(id==='14'&&s.index<3){scene.environment=eventStudio.texture;scene.environmentRotation.y=0;scene.environmentIntensity=1;hemi.intensity=.25;sun.intensity=1.8;fill.intensity=.2;}
 if(id==='14'&&s.key==='elements'){hemi.intensity=0;sun.intensity=1.2;fill.intensity=0;scene.environmentIntensity=6;}
 if(id==='14'&&s.key==='scenes'){hemi.intensity=.25;fill.intensity=.1;scene.environmentIntensity=.6;sun.intensity=3;sun.position.set(20,14,-22);sun.target.position.set(0,-4,-35);sun.target.updateMatrixWorld();}
 if(id==='14'&&s.key==='combat'){hemi.intensity=.4;fill.intensity=.25;scene.environmentIntensity=.75;sun.intensity=3.2;sun.position.set(-4,5,-10);sun.target.position.set(0,-2.5,-17);sun.target.updateMatrixWorld();}
 if(id==='27'&&s.index<3){scene.environment=eventStudio.texture;scene.environmentRotation.y=0;scene.environmentIntensity=.85;hemi.intensity=.4;sun.intensity=1.4;fill.intensity=.35;}
 if(id==='27'&&s.key==='elements'){scene.environment=envTarget?.texture||null;scene.environmentRotation.y=.5;scene.environmentIntensity=1.9;hemi.intensity=.1;sun.intensity=.4;fill.intensity=.1;}
 if(id==='27'){
  const landscape=s.key==='scenes';sun.position.set(...(landscape?[12,5,-48]:[6,10,9]));sun.target.position.set(...(landscape?[0,-3.8,-35]:[0,0,0]));sun.target.updateMatrixWorld();
  if(landscape){hemi.intensity=reviewAssets?.35:.6;fill.intensity=reviewAssets?.08:.2;sun.intensity=reviewAssets?3.2:4;if(reviewAssets){scene.environmentIntensity=.85;sun.position.set(30,12,-20);sun.color.set(0xffd3a0);}}
  else sun.color.set(0xffedcf);
  if(s.key==='combat'){scene.environmentIntensity=.65;hemi.intensity=.5;fill.intensity=.35;sun.intensity=3.2;sun.position.set(-4,5,-10);sun.target.position.set(0,-2.5,-17);sun.target.updateMatrixWorld();}
  const shadowExtent=s.key==='combat'?5:16;Object.assign(sun.shadow.camera,{left:-shadowExtent,right:shadowExtent,top:shadowExtent,bottom:-shadowExtent});sun.shadow.camera.updateProjectionMatrix();sun.shadow.normalBias=s.key==='combat'?.003:.025;
 }
 if(id==='14'&&s.index===0)ground.visible=reveal>.99;
 if(s.key==='combat')ground.position.y=-4.3;
 else if(ground.visible){mechanism.root.updateMatrixWorld(true);if(id==='11'&&s.index<3){const m=mechanism.root.matrixWorld.elements;ground.position.y=m[13]-mechanism.recipe.radius*Math.hypot(m[1],m[5])+Math.min((-mechanism.recipe.depth-.15)*m[9],.75*m[9])-.008;}else ground.position.y=assemblyBounds.setFromObject(mechanism.hardware).min.y-.008;}
 if(id==='11'&&s.key==='song')ground.position.y=-3.3;
 if(id==='11'&&s.key==='elements')ground.position.y=-3.35;
 if(projects?.state.elements){const water=projects.groups.elements.children.find(o=>o.isMesh);if(water){water.material.attenuationDistance=180;water.material.attenuationColor.set(0xc9e3e2);water.material.side=T.FrontSide;if(water.material.transparent){water.material.transparent=false;water.material.depthWrite=true;water.material.needsUpdate=true;}}}
 const shadowPose=s.index<3?`${s.index}/${drive}/${u}`:s.key==='combat'||id==='11'&&s.key==='song'?`${s.key}/${u}`:s.key;
 if(lastDrive!==shadowPose){renderer.shadowMap.needsUpdate=true;lastDrive=shadowPose;}
 if(id==='05'&&projects){const g=projects.groups;scene.environment=(s.index===0||s.key==='scenes')&&fieldOutdoorTarget?fieldOutdoorTarget.texture:fieldEnvTarget?.texture||null;let opticalCamera=activeCamera;
  if(s.index===0||s.key==='scenes'){g.root.visible=g.scenes.visible=true;mechanism.root.visible=ground.visible=false;for(const k of ['elements','combat'])g[k].visible=false;fieldCamera.position.set(2.1,-2.3,-26.2);fieldCamera.lookAt(-.15,-3.65,-35.15);opticalCamera=fieldCamera;}
  else if(s.index<3){heroCamera.setViewOffset(canvas.clientWidth,canvas.clientHeight,-.24*canvas.clientWidth,0,canvas.clientWidth,canvas.clientHeight);heroCamera.updateProjectionMatrix();}
  const fieldSignature=[s.index,s.index===0?0:s.local.toFixed(4),environmentReady,!!surfaces,projects.state.scenes,projects.state[s.key],s.key==='elements'?projects.fluid()?.frame:0].join('/');
  if(fieldSignature!==lastFieldSignature){scene.background=(s.index===0||s.key==='scenes')&&outdoorTexture?outdoorTexture:new T.Color(0xdedbd1);fieldRenderer.render(scene,opticalCamera);lastFieldSignature=fieldSignature;}scene.background=null;scene.environment=envTarget?.texture||null;
  // The physical iris stays at the origin of the editorial field in every
  // chapter; only the live content on its other side changes.
  g.root.visible=false;mechanism.root.visible=true;ground.visible=true;mechanism.update(drive,1,'mechanism',0);for(const part of mechanism.parts)part.visible=part.name!=='Optical element';
  const h=mobile?30:design.height,center=mobile?[.35,.37]:design.center;heroCamera.left=-h*camera.aspect/2;heroCamera.right=h*camera.aspect/2;heroCamera.top=h/2;heroCamera.bottom=-h/2;heroCamera.position.set(7,3,23);heroCamera.lookAt(0,0,0);heroCamera.setViewOffset(canvas.clientWidth,canvas.clientHeight,(.5-center[0])*canvas.clientWidth,(.5-center[1])*canvas.clientHeight,canvas.clientWidth,canvas.clientHeight);heroCamera.updateProjectionMatrix();activeCamera=heroCamera;
 }
 if(s.key==='scenes'&&id!=='05')scene.background=outdoorTexture||new T.Color(0xd9e0df);else if(id==='04'&&s.key==='elements')scene.background=letteringTexture;else scene.background=null;
 if(id==='27'&&s.key==='elements')scene.background=letteringTexture;
 if(id==='11'&&s.key==='elements')scene.background=new T.Color(0x70200f);
 }
 let irisOpacity=0;
 if(shadowChoreography){
  const result=shadowChoreography.apply(progress,shadowInputs());
  activeCamera=result.camera;document.body.dataset.handoff=result.state.blend>0?`${result.state.index}-${result.state.next}`:'';
  if(elementsAnimating){
   activeCamera.updateMatrixWorld();shadowSplash.root.updateMatrixWorld(true);
   elementsViewProjection.multiplyMatrices(activeCamera.projectionMatrix,activeCamera.matrixWorldInverse);
   elementsFrustum.setFromProjectionMatrix(elementsViewProjection);
   elementsAnimating=shadowSplash.root.visible&&elementsFrustum.intersectsObject(shadowSplash.root.children[0]);
  }
  const presentation=chapterPresentation(result.state);
  irisOpacity=result.state.index<2?1:result.state.index===2?1-result.state.blend:0;
  document.body.dataset.irisStage=irisOpacity>0?'true':'false';
  updateUI({...s,index:presentation.index,key:chapters[presentation.index].key});
  $('.caption').style.opacity=String(presentation.opacity);
  // The outdoor camera is fixed after the threshold. Re-rendering millions
  // of static shadow triangles on every scroll tick changed no pixels.
  // Source arrivals still invalidate through sourceChanged().
  // Liquid interfaces do not cast opaque shadows. During their held chapter,
  // every actual caster and light stays fixed; only the liquid transforms move.
  const shadow11=result.state.index===6?'outdoor':result.state.index===3&&result.state.blend===0?'elements-static':String(progress);
  if(lastShadow11!==shadow11){renderer.shadowMap.needsUpdate=true;lastShadow11=shadow11;}
  if(projects&&s.index>=5){projects.ensure('scenes');prepareOutdoor();}
 }
 // Compile the exact visible material/light variant asynchronously before
 // its first draw. Keep the previous canvas while the driver links programs.
 if(id==='27'&&(!environmentReady||!surfaces||(s.index>=3&&!projects?.state[s.key]))){
  frameProfile.end(false);scene.background=null;document.body.dataset.ready='false';document.body.dataset.settled='false';
  const loadingError=errors[0]||projects?.state.errors[0];
  $('#status').textContent=loadingError?`Asset unavailable: ${loadingError}. Restore the source assets and reload.`:!environmentReady?'Preparing photographic environment…':!surfaces?'Loading CYBR MATERIAL maps…':`Loading original CYBR ${chapters[s.index].name}…`;
  document.body.dataset.loadError=loadingError?'true':'false';
  if(moving)request();else last=0;return;
 }
 if(((id==='27'&&environmentReady&&surfaces&&(s.index<3||projects?.state[s.key]))||(id==='11'&&irisOpacity<1&&(s.index===2||s.index===3||projects?.state[s.key])))&&renderer.extensions.has('KHR_parallel_shader_compile')){
  if(id==='27'&&s.key==='elements'){const water=projects.groups.elements.children.find(o=>o.isMesh);if(water)waterOptics?.prepare(water);}
  const programKey=id==='11'?`11/${s.index}/${document.body.dataset.handoff}/${!!outdoorTarget}/${!!scene.fog}`:(s.key==='material'?'light':s.key)+'/'+(s.key==='geo'&&reveal<.999?'reveal':'opaque')+'/'+(s.key==='scenes'?!!outdoorTarget:'studio');
  if(!preparedPrograms.has(programKey)){
   // Three's compile traverses hidden objects too. Compile only this chapter,
   // using the real scene for lights/environment, without reparenting meshes.
   const water=id==='27'&&s.key==='elements'?projects.groups.elements.children.find(o=>o.isMesh):null;
   const preparation=preparationSnapshot(T,scene,activeCamera);
   enqueuePreparation(programKey,preparation,water);
  }
  if(!preparedPrograms.get(programKey)){
   frameProfile.end(false);scene.background=null;last=0;
   document.body.dataset.ready='false';document.body.dataset.settled='false';
   $('#status').textContent='Preparing GPU materials…';return;
  }
 }
 // Commit the chapter's DOM, clipping and title only after the exact visible
 // GPU variant is ready. The old composition remains intact during loading.
 // This happens in the same animation frame as the new canvas draw.
 if(id==='27')updateUI(s);
 const irisPending=irisOpacity>0&&irisStage?.status.phase!=='ready';
 if(irisOpacity===1&&irisPending){
  renderer.clear();frameRendered=false;
 }else if(irisOpacity===1){
  frameRendered=renderIrisStage({progress,width:canvas.width,height:canvas.height});
 }else if(id==='05'){
  if(projects?.state.scenes&&!contoursReady){projects.groups.root.updateMatrixWorld(true);for(const mesh of projects.groups.scenes.children.slice(0,2)){const g=mesh.geometry,levels=mesh.name.endsWith('0')?[-1.5,-1,-.5,-.2,0,.15,.3,.5]:[70,160,300,500,750,1000,1400];const lines=new T.BufferGeometry();lines.setAttribute('position',new T.BufferAttribute(contourSegments(g.attributes.position.array,g.index.array,levels),3));const drawing=new T.LineSegments(lines,contourMaterial);drawing.matrixAutoUpdate=false;drawing.matrix.copy(mesh.matrixWorld);contourScene.add(drawing);}contoursReady=true;}
  contourViewport.set(canvas.width,canvas.height);
  renderer.autoClear=false;renderer.clear();if(contoursReady)renderer.render(contourScene,fieldCamera);renderer.clearDepth();renderer.render(scene,activeCamera);renderer.autoClear=true;
 }else {
  // Concept 27's landscape camera is fixed; water changes only at baked-frame
  // boundaries. Keep the live canvas when its complete visible input is equal.
  // UI/scroll choreography still updates at display cadence.
  activeCamera.updateMatrixWorld();
  const cacheable=id==='27'&&(s.key==='scenes'||s.key==='elements')||id==='11'&&s.key==='scenes';
  const beautySignature=cacheable?[s.key,canvas.width,canvas.height,scene.environment?.uuid,scene.background?.uuid,outdoorTarget?.texture.uuid,projects?.state[s.key],projects?.state.sceneMaterialMaps,projects?.fluid()?.frame,...activeCamera.matrixWorld.elements,...activeCamera.projectionMatrix.elements].join('/') : '';
  if(cacheable&&beautySignature===lastBeautySignature&&!renderer.shadowMap.needsUpdate){reusedBeautyFrames++;frameRendered=false;frameReused=true;}
  else{if(waterOptics&&s.key==='elements'&&projects?.state.elements){const water=projects.groups.elements.children.find(o=>o.isMesh);if(water)waterOptics.render(water,activeCamera);}
   // Match the conservative bounds of reference27-material-clip. Pixels
   // outside this box are discarded by CSS anyway; keep a 2px AA guard.
   const clipped=id==='27'&&(s.key==='material'||s.key==='scenes');
   if(clipped){const landscape=s.key==='scenes',w=canvas.clientWidth,h=canvas.clientHeight,x=Math.max(0,Math.floor(w*(landscape?.09:.4))-2),y=landscape?0:Math.max(0,Math.floor(h*.07)-2);renderer.setScissor(x,y,w-x,h-y);renderer.setScissorTest(true);}
   // The pool is already visible during the doorway handoff, including on
   // reverse scroll. Its projection must follow that camera, not the last
   // settled SCENES pose.
   if(id==='11'&&projects?.groups.scenes.visible&&projects?.state.nativeSprings){
    springReflection??=createSpringReflection(renderer,scene,projects.groups.scenes);
    springReflection?.update(activeCamera);
   }
   if(id==='11'&&shadowSplash.root.visible){
    elementsComposite.resize(canvas.width,canvas.height);
    shadowSplash.setEnvironment(eventStudio.texture,{intensity:scene.environmentIntensity,rotation:scene.environmentRotation});
    shadowSplash.setBackdrop({texture:elementsComposite.opaqueTarget.texture,depthTexture:elementsComposite.opaqueTarget.depthTexture,camera:activeCamera,receivers:shadowSet.root});
    const roomStable=s.key==='elements'&&!moving&&elementsSourceState.phase==='ready'&&!renderer.shadowMap.needsUpdate;
    if(roomStable){
     shadowSet.root.updateWorldMatrix(true,true);shadowSplash.root.updateWorldMatrix(true,false);
     elementsProbePosition.set(0,2.1,0).applyMatrix4(shadowSplash.root.matrixWorld);
     // World-space content, not the viewer/camera, invalidates the room cube.
     // No six-face rebuild while the Elements field rotates or the page scrolls.
     const roomKey=[...elementsProbePosition.toArray(),scene.environment?.uuid,scene.environmentIntensity,...scene.environmentRotation.toArray()];
     shadowSet.root.traverseVisible(object=>{if(object.isMesh){roomKey.push(object.uuid,...object.matrixWorld.elements);for(const material of Array.isArray(object.material)?object.material:[object.material])roomKey.push(material.uuid,material.version,material.color?.getHex(),material.roughness,material.metalness);}});
     for(const light of [studioKey,sun,fill,hemi,fireSpill])roomKey.push(light.intensity,...light.position.toArray(),...light.color.toArray(),...(light.target?.position.toArray()||[]),light.groundColor?.getHex());
     if(elementsRoomProbe.update({scene,receivers:shadowSet.root,position:elementsProbePosition,key:roomKey.join('/')}))$('#elements-room-probe-status').textContent=`Room reflection cache: ${elementsRoomProbe.stats.captures} capture(s), ${elementsRoomProbe.stats.faces} faces, 512 × 512 linear HDR. Reused across animation and camera motion; one-viewpoint room approximation.`;
    }
    shadowSplash.setRoomProbe({texture:elementsRoomProbe.texture,position:elementsRoomProbe.position,valid:elementsRoomProbe.stats.valid});
    const stable=roomStable&&!['full-frame-reference','frozen-full-frame'].includes(elementsDebugMode);
    const backgroundKey=stable?[progress,canvas.width,canvas.height,scene.environment?.uuid,scene.environmentIntensity,...scene.environmentRotation.toArray(),scene.background?.uuid,scene.background?.getHex?.(),...activeCamera.matrixWorld.elements,...activeCamera.projectionMatrix.elements,...[studioKey,sun,fill,hemi,fireSpill].flatMap(light=>[light.intensity,...light.position.toArray(),...light.color.toArray()]),shadowSet.material.version,...shadowSet.material.color.toArray()].join('/') : null;
    elementsComposite.render(scene,activeCamera,{overlay:shadowSplash.root,backgroundKey,dirtyRect:stable?elementsProjectedRegion(shadowSplash.root.children[0],activeCamera,canvas.width,canvas.height):null});
   }
   else renderer.render(scene,activeCamera);
   if(clipped)renderer.setScissorTest(false);lastBeautySignature=beautySignature;}
 }
 if(irisOpacity>0&&irisOpacity<1&&!irisPending&&!renderIrisStage({progress,width:canvas.width,height:canvas.height,opacity:irisOpacity}))frameRendered=false;
 if(frameRendered)sceneRecorder.recordFrame(now);
 scene.background=null;frames++;
 const visibleKey=id==='11'?document.body.dataset.chapter:s.key,visibleChapter=chapters.findIndex(c=>c.key===visibleKey);
 const elementsWaiting=id==='11'&&visibleKey==='elements'&&elementsSourceState.phase!=='ready';
 const snapshotWarning=visibleKey==='scenes'?projects?.state.warnings?.[0]:null;
 const waiting=elementsWaiting||visibleChapter>=3&&!(id==='11'&&visibleKey==='elements')&&!projects?.state[visibleKey],issue=errors[0]||projects?.state.errors[0];$('#status').textContent=irisRenderError|| (issue?'Asset issue — open source notes':irisPending?irisCompileLabel||'Preparing IRIS / 09 materials…':elementsWaiting?'Loading native CYBR fire and FLIP fields…':waiting?`Loading original CYBR ${chapters[visibleChapter].name}…`:id==='05'&&!projects?.state.scenes?'Loading original Desert Hot Springs…':!environmentReady?'Preparing photographic environment…':!surfaces&&id!=='11'?'Loading CYBR MATERIAL maps…':snapshotWarning||'');
 // A skipped beauty-cache draw still presents the exact current composition;
 // a pending or failed shader draw does not. Do not conflate the two states.
 document.body.dataset.settled=String(!moving);document.body.dataset.ready=String(!contextLoss&&!irisRenderError&&(frameRendered||frameReused)&&!irisPending&&!waiting&&environmentReady&&(!!surfaces||id==='11')&&!issue&&(id==='11'||s.key!=='elements'||!projects?.fluid()?.pending)&&(id!=='05'||!!projects?.state.scenes)&&((id!=='05'&&s.key!=='scenes')||!!outdoorTarget));
 frameProfile.end(frameRendered);
 scrollBenchmark.record(now,s.key,document.body.dataset.ready==='true');
 // Diagnostics are sampled continuously, but sorting every history and replacing
 // a large hidden DOM text node is not rendering work. Publish at 4 Hz and on
 // the final settled frame; this never changes the measurement samples.
 if(!moving&&!elementsAnimating||now-lastMetricsTime>=250){lastMetricsTime=now;$('#metrics').textContent=JSON.stringify({design:id,chapter:s.key,frames,reusedBeautyFrames,renderer:irisOpacity>0?'WebGL2 / source-derived IRIS09 mesh PBR':s.key==='elements'&&id==='11'?'WebGL2 / single bounded Elements shader':'WebGL2 / raster PBR',mechanism:irisStage?.metadata||mechanism?.root.userData.mechanism,iris:irisStage?.status,elements:shadowSplash?{...shadowSplash.metadata,time:elementsTime,animating:elementsAnimating,hdr:elementsComposite?.stats}:null,context:contextLoss,environment:environmentReady,materialMaps:surfaces?.count||0,projects:projects?.state,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,movingFrameMedianMs:frameTimes.length?+([...frameTimes].sort((a,b)=>a-b)[Math.floor(frameTimes.length/2)]).toFixed(1):null,profile:frameProfile.snapshot(),preparation:{complete:chapterPreparationComplete,variants:preparedPrograms.size,ready:[...preparedPrograms.values()].filter(Boolean).length},errors},null,2);}
 if(moving||elementsAnimating||!audio.paused)request();else last=0;
}
bootReady=true;if(id==='11')environmentReady=true;resize();if(id!=='11')environment();sourceReady.then(request);
// Fetch later source assets serially after the opening instrument is ready.
// They previously all arrived together in the first liquid transition.
if(id==='11')Promise.all([irisPreparation,sourceReady]).then(async()=>{
 for(const prepare of [prepareElementsSources,()=>projects.ensure('song'),()=>projects.ensure('combat'),prepareOutdoor,()=>projects.ensure('scenes')]){
  await new Promise(resolve=>{if('requestIdleCallback'in window)requestIdleCallback(resolve,{timeout:2500});else setTimeout(resolve,120);});
  if(disposed)return;await prepare();
 }
 // Compile source-loaded chapter variants while the opening is being read.
 // Snapshot, then restore live choreography synchronously before any await.
 // No hidden animation, second WebGL context, or parallel renderer is needed.
 springReflection??=createSpringReflection(renderer,scene,projects.groups.scenes);
 const warmDirector=createShadowChoreography();
 const displayWarmTarget=new T.WebGLRenderTarget(16,16,{colorSpace:renderer.outputColorSpace});
 displayWarmTarget.isXRRenderTarget=true;
 let completedWarmups=0;
 try{
 for(const beat of [2.85,3.1,3.85,4.1,4.85,5.1,5.85,6.1]){
  await new Promise(resolve=>{if('requestIdleCallback'in window)requestIdleCallback(resolve,{timeout:2500});else setTimeout(resolve,120);});
  if(disposed)return;
  // Speculative preparation must not queue unrelated GPU work behind the
  // chapter the user is now inspecting. Its exact visible variant already
  // has the on-demand preparation path above; no content is skipped.
  if(journeyState(target).index>=3)break;
  const warm=warmDirector.apply(beat/7,shadowInputs()),key=shadowProgramKey(warm.state);
  const snapshot=preparationSnapshot(T,scene,warm.camera);
  shadowChoreography.apply(progress,shadowInputs());
  await enqueuePreparation(key,snapshot);
  if(disposed)return;
  if(journeyState(target).index>=3)break;
  // Three stores transmission buffers per scene AND camera. Exercise the real
  // camera identities, not the temporary compilation camera, before entry.
  // A full drawing-buffer viewport allocates the correct transmission size;
  // the helper writes only one pixel/primitive to an offscreen display target.
  const background=scene.background;
  try{
   const actual=shadowChoreography.apply(beat/7,shadowInputs());
   displayWarmTarget.viewport.set(0,0,canvas.width,canvas.height);
   withReflectionPreparation(T,renderer,scene,()=>{renderer.setRenderTarget(displayWarmTarget);renderer.render(scene,actual.camera);});
   if(projects.groups.scenes.visible)springReflection?.prepare(actual.camera);
  }finally{shadowChoreography.apply(progress,shadowInputs());scene.background=background;}
  completedWarmups++;request();
 }
 }finally{displayWarmTarget.dispose();}
 chapterPreparationComplete=completedWarmups===8&&!shaderFailures.length&&[...preparedPrograms.values()].every(Boolean);request();
}).catch(error=>{errors.push(error.message);request();});
addEventListener('pagehide',e=>{if(!e.persisted){sceneRecorder.dispose();scrollBenchmark.dispose();elementsSourceAbort.abort();elementsComposite?.dispose();elementsRoomProbe?.dispose();}});
addEventListener('pagehide',e=>{if(!e.persisted){sourceFinishes.forEach(f=>f.dispose());stopBackgroundObservation();transmissionRegion.dispose();frameProfile.dispose();}});
addEventListener('pagehide',e=>{if(!e.persisted){shadowSplash?.dispose();shadowScore?.dispose();shadowSet?.dispose();eventSong?.dispose();referenceFinish?.dispose();turnedFinish?.dispose();eventStudio?.dispose();waterOptics?.dispose();eventCave?.dispose();eventBacking?.geometry.dispose();eventBacking?.material.dispose();}});
addEventListener('pagehide',e=>{if(e.persisted)return;disposed=true;stopIrisCompileNotice();cancelAnimationFrame(raf);observer.disconnect();projects?.dispose();mechanism?.dispose();irisStage?.dispose();surfaces?.dispose();for(const m of revealClones.values())m.dispose();envTarget?.dispose();fieldEnvTarget?.dispose();outdoorTarget?.dispose();fieldOutdoorTarget?.dispose();outdoorTexture?.dispose();letteringTexture.dispose();contourScene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer.dispose();fieldRenderer?.dispose();});
