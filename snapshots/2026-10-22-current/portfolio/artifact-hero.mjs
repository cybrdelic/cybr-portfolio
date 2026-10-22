import * as T from './vendor/three-r180/three.module.min.js';
import {loadArtifactHardware,loadSourceArtifact,ARTIFACTS,TITLES} from './artifact-designs.mjs?v=4';
import {fetchArtifact} from './artifact-fetch.mjs';
import {updateCable} from './artifact-cable.mjs';
import {createInstrumentInterface,PROJECT_STOPS} from './instrument-interface.mjs?v=13';

async function boot(){
const started=performance.now(),root=document.querySelector('.scroll-score'),stage=document.querySelector('.instrument'),surface=document.querySelector('.sculpture'),status=document.querySelector('.render-status');
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),slider=document.querySelector('#explosion');
const scene=new T.Scene(),camera=new T.PerspectiveCamera(34,1,1,3000);camera.up.set(0,0,1);
const renderer=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xf4f4f2,0);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
surface.append(renderer.domElement);
const {groups,materials,moving}=await loadArtifactHardware();for(const g of groups.values())scene.add(g);
// Environment convolution is deferred. The first real-geometry frame does not
// wait for PMREM shader compilation or the photographed panorama download.
scene.add(new T.HemisphereLight(0xf7f7f2,0x54504b,.6));const key=new T.DirectionalLight(0xffffff,2);key.position.set(-140,-180,320);scene.add(key);
key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-410,right:410,top:140,bottom:-140,near:1,far:900});key.shadow.normalBias=.15;key.shadow.bias=-.00015;
// No per-module cube maps, BVH builds or video decoders in the first-frame path.
let target=0,current=0,raf=0,last=0,ready=false,frames=0,paused=false,firstFrameMs=null;
const loaded={},loading=new Set(),failures=[],sourceGroups=new Map(),detailGroups=new Map();
let detailTimer;
let fluid,fluidLoading=false;
function updateStatus(){status.textContent=failures.length?failures.at(-1):['combat','scenes','elements','studio'].some(name=>!loaded[name])?'Loading artifact details…':'';}
async function requestFluid(){
 if(fluid||fluidLoading)return;fluidLoading=true;
 try{
  const {loadFluid}=await import('./instrument-fluid.js?v=shared-4');
  const water=materials.water.clone();water.transmission=.55;water.roughness=.035;
  fluid=await loadFluid(groups.get('elements'),schedule,{base:'./assets/instrument-elements-bake/water-shared-v3/',material:water,initialFrame:40});
  fluid.mesh.scale.set(.72,.57,.62);fluid.mesh.position.z=7;
  moving.find(x=>x.kind==='fluid').object.visible=false;loaded.elements='recorded-FLIP-frame-40';schedule();
 }catch(e){failures.push('FLIP: '+e.message);}finally{fluidLoading=false;updateStatus();}
}
const clamp=v=>Math.max(0,Math.min(1,v)),smooth=v=>{v=clamp(v);return v*v*(3-2*v);},lerp=T.MathUtils.lerp;
const links=[];
for(let i=0;i<5;i++){
 const mesh=new T.Mesh(new T.BufferGeometry(),materials.red);scene.add(mesh);links.push(mesh);
}
let lastCable=-1;
function cables(compact){
 if(Math.abs(compact-lastCable)<.0005)return;lastCable=compact;
 for(let i=0;i<5;i++){
  const a=groups.get(ARTIFACTS[i]).position.clone().add(new T.Vector3(43,0,-23)),b=groups.get(ARTIFACTS[i+1]).position.clone().add(new T.Vector3(-43,0,-23));
  const curve=new T.CatmullRomCurve3([a,a.clone().lerp(b,.28).add(new T.Vector3(0,0,-3)),a.clone().lerp(b,.72).add(new T.Vector3(0,0,-3)),b]);
  if(!links[i].geometry.attributes.position){links[i].geometry.dispose();links[i].geometry=new T.TubeGeometry(curve,20,2.1,8,false);}
  else updateCable(links[i].geometry,curve);
 }
}
const ui=createInstrumentInterface({stage,root,jump,isReady:()=>ready,getTarget:()=>target,reduced,onPaneChange:v=>{paused=v;if(!v)schedule();}});
function jump(p){target=clamp(p);if(!reduced.matches)window.scrollTo({top:target*Math.max(1,root.offsetHeight-innerHeight),behavior:'instant'});schedule();}
function activeAt(p){let best=0;PROJECT_STOPS.forEach((s,i)=>{if(Math.abs(s.at-p)<Math.abs(PROJECT_STOPS[best].at-p))best=i;});return best;}
function requestDetail(name){
 clearTimeout(detailTimer);if(!['combat','scenes'].includes(name)||detailGroups.has(name)||loading.has(name+'detail'))return;
 detailTimer=setTimeout(async()=>{
  loading.add(name+'detail');try{const replacement=await loadSourceArtifact(name,'detail',groups.get(name));detailGroups.set(name,replacement);loaded[name]='detail';schedule();}
  catch(e){failures.push(`${name} detail: ${e.message}`);}finally{loading.delete(name+'detail');}
 },220);
}
let lastMechanism=-1,lastVisibility='';
function pose(p){
 const compact=smooth(p/.3),spacing=lerp(123,91,compact);
 ARTIFACTS.forEach((name,i)=>groups.get(name).position.set((i-2.5)*spacing,0,0));cables(compact);
 const active=activeAt(p),focused=p>.40&&p<.94;
 for(const name of ['combat','scenes']){
  const detailed=focused&&ARTIFACTS[active]===name&&detailGroups.has(name);
  if(sourceGroups.has(name))sourceGroups.get(name).visible=!detailed;
  if(detailGroups.has(name))detailGroups.get(name).visible=detailed;
 }
 const fluidVisible=p<.35||(focused&&active===2);
 if(fluid)fluid.mesh.visible=fluidVisible;
 moving.find(x=>x.kind==='fluid').object.visible=!(fluid&&fluidVisible);
 // Continuous camera keyframes. The geometry remains resident throughout.
 const knots=[{p:0,x:0,zoom:0},{p:.33,x:0,zoom:0},...PROJECT_STOPS.map((s,i)=>({p:s.at,x:(i-2.5)*spacing,zoom:1})),{p:1,x:0,zoom:0}];
 let n=0;while(n<knots.length-2&&p>knots[n+1].p)n++;
 const a=knots[n],b=knots[n+1],t=smooth((p-a.p)/(b.p-a.p)),zoom=lerp(a.zoom,b.zoom,t),cx=lerp(a.x,b.x,t);
 const aspect=surface.clientWidth/Math.max(1,surface.clientHeight),distance=lerp(Math.max(850,1200/aspect),Math.max(195,140/aspect),zoom);
 const aim=new T.Vector3(cx,0,lerp(4,8,zoom));
 const angle=lerp(.26,-.16,zoom);camera.position.set(cx+Math.sin(angle)*distance,-distance*.84,distance*.52+aim.z);camera.lookAt(aim);camera.updateMatrixWorld();
 // Mechanisms move during assembly; touring the assembled object only moves the camera.
 const mechanism=Math.min(p,.3);
 for(const entry of moving){if(entry.kind==='gear')entry.object.rotation.z=mechanism*2*(entry.phase<0?1:-1)+(entry.phase>0?Math.PI/18:0);if(entry.kind==='key')entry.object.rotation.x=Math.sin(mechanism*35+entry.phase)*.045;}
 stage.classList.toggle('three-active',p>.08);stage.classList.toggle('artifact-detail',focused);
 const fade=1-smooth(p/.18);for(const e of document.querySelectorAll('.project-labels,.inspection,.inspection-note,.registration,.drafting')){e.style.opacity=fade;e.style.pointerEvents=fade>.5?'':'none';}
 const study=document.querySelector('.study-link');study.style.opacity=focused?1:0;study.style.pointerEvents=focused?'auto':'none';study.setAttribute('aria-hidden',String(!focused));study.tabIndex=focused?0:-1;
 study.querySelector('strong').textContent=ARTIFACTS[active].toUpperCase();study.querySelector('.study-number').textContent=`0${active+1} / 06`;study.querySelector('.study-description').textContent=TITLES[active];study.href=`${ARTIFACTS[active]}.html`;
 document.querySelector('.phase-name').textContent=p<.3?'01 / Assemble':focused?'02 / Inside the instrument':'03 / The complete system';
 document.querySelector('.scroll-track i').style.width=`${p*100}%`;slider.value=p*100;ui.update(p,active);
 if(focused){requestDetail(ARTIFACTS[active]);if(active===2)void requestFluid();}
 const visibility=[fluidVisible,...['combat','scenes'].map(name=>detailGroups.get(name)?.visible),...Object.keys(loaded)].join('|');
 if(mechanism!==lastMechanism||visibility!==lastVisibility){renderer.shadowMap.needsUpdate=true;lastMechanism=mechanism;lastVisibility=visibility;}
}
function schedule(){if(!raf&&!document.hidden&&!paused)raf=requestAnimationFrame(draw);}
function draw(time){raf=0;const dt=Math.min(.06,(time-(last||time))/1000);last=time;current=reduced.matches?target:lerp(current,target,1-Math.exp(-dt*13));if(Math.abs(current-target)<.00008)current=target;pose(current);renderer.render(scene,camera);frames++;
 if(firstFrameMs===null){firstFrameMs=performance.now()-started;ready=true;stage.classList.add('three-ready');updateStatus();ui.ready();}
 if(current!==target)schedule();
}
function resize(){const w=surface.clientWidth,h=surface.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/Math.max(h,1);camera.updateProjectionMatrix();schedule();}
root.classList.add('is-enhanced');stage.classList.add('artifact-redesign');document.querySelector('.rail-art').hidden=true;
window.addEventListener('scroll',()=>{if(!reduced.matches){target=clamp(scrollY/Math.max(1,root.offsetHeight-innerHeight));schedule();}},{passive:true});
window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else schedule();});
slider.addEventListener('input',()=>jump(+slider.value/100));document.querySelectorAll('[data-end]').forEach(b=>b.addEventListener('click',()=>b.dataset.end==='0'?jump(0):ui.next()));document.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();jump(+b.dataset.jump);}));
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();status.textContent='Graphics context interrupted. Reload to restore the instrument.';cancelAnimationFrame(raf);raf=0;});
window.instrument3D={setProgress:jump,snapshot:()=>({ready,progress:current,target,design:'six-artifacts-v2',firstFrameMs,elapsedMs:performance.now()-started,sourceAssets:{...loaded},failures:[...failures],drawCount:frames,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,programs:renderer.info.programs.length})};
resize();
// Source subjects stream independently after the first geometry frame. No sprite handoff.
requestAnimationFrame(()=>requestAnimationFrame(()=>{
 for(const name of ['combat','scenes'])loadSourceArtifact(name,'hero',groups.get(name)).then(g=>{sourceGroups.set(name,g);if(!detailGroups.has(name))loaded[name]='hero';updateStatus();schedule();}).catch(e=>{failures.push(`${name}: ${e.message}`);updateStatus();});
 setTimeout(()=>void requestFluid(),1500);
 // Use the retained photographed studio after first paint, without blocking it.
 fetchArtifact('./assets/pbr-metal/studio/studio_small_08-1024x512-rgba.f32.gz').then(data=>{
  if(data.byteLength!==1024*512*16)throw Error('Studio size mismatch');
  const tex=new T.DataTexture(new Float32Array(data),1024,512,T.RGBAFormat,T.FloatType);tex.mapping=T.EquirectangularReflectionMapping;tex.colorSpace=T.LinearSRGBColorSpace;tex.needsUpdate=true;
  const generator=new T.PMREMGenerator(renderer),target=generator.fromEquirectangular(tex);scene.environment=target.texture;scene.environmentRotation.set(Math.PI/2,0,0);scene.environmentIntensity=.7;generator.dispose();tex.dispose();loaded.studio='photographed';updateStatus();schedule();
 }).catch(e=>{failures.push('Studio: '+e.message);updateStatus();});
}));
}
boot().catch(error=>{
 const status=document.querySelector('.render-status');status.textContent=`Instrument could not start: ${error.message}. `;
 const retry=document.createElement('button');retry.textContent='Retry loading';retry.onclick=()=>location.reload();status.append(retry);console.error(error);
});
