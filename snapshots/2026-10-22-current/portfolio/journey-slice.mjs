import * as T from './vendor/three-r180/three.module.min.js';
import {createMechanism} from './mechanism-model.mjs?revision=finishes-36';
import {sliceState,phase,clamp} from './journey-slice-state.mjs';
import {fetchArtifact} from './artifact-fetch.mjs';
import {applyCybrSurfacesThree} from '../cybr-light/browser/cybr-surfaces-three.mjs';
import {loadJourneyProjects} from './journey-projects.mjs';
import {createMechanismLight} from './mechanism-light.mjs';

const $=s=>document.querySelector(s),canvas=$('#view'),journey=$('#journey');
const songAudio=document.querySelector('audio');
$('#sound').onclick=()=>{if(songAudio.paused)songAudio.play().then(request).catch(e=>{errors.push('Audio: '+e.message);request();});else songAudio.pause();request();};songAudio.onended=request;
const preference=matchMedia('(prefers-reduced-motion:reduce)');
let reduced=preference.matches,raf=0,last=0,p=0,target=0,run=null,disposed=false;
const samples=[],cpu=[],gpu=[],errors=[];let firstFrame=null,frames=0;
const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
renderer.localClippingEnabled=true;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate=false;
const scene=new T.Scene();scene.background=new T.Color(0xecece6);scene.fog=new T.Fog(0xecece6,22,65);
scene.environmentIntensity=1.4;
const camera=new T.PerspectiveCamera(39,1,.04,100);
const mechanism=createMechanism();scene.add(mechanism.root);
let projects=null,hybrid=null,hybridReady=false,hybridError=null,hybridResize=Promise.resolve();
loadJourneyProjects(scene,request).then(x=>{projects=x;request();x.ready.then(()=>renderer.compileAsync(scene,camera)).then(request).catch(e=>{errors.push('Shader preparation: '+e.message);request();});});
const hybridCanvas=document.querySelector('#hybrid-view');
async function prepareHybrid(){try{hybrid=await createMechanismLight(hybridCanvas,mechanism.hardware);await hybrid.resize(Math.round(canvas.clientWidth),Math.round(canvas.clientHeight),8);hybridReady=true;request();}catch(e){hybridError=e.message;request();}}
// CAD solids are closed and outward-oriented. Rendering both faces adds
// redundant transmission work and lets interior faces contaminate highlights.
for(const part of mechanism.parts){part.material.side=T.FrontSide;part.material.needsUpdate=true;}
let surfaces=null;applyCybrSurfacesThree(T,mechanism.hardware,{anisotropy:Math.min(4,renderer.capabilities.getMaxAnisotropy())}).then(result=>{if(disposed)result.dispose();else{surfaces=result;request();}}).catch(e=>{errors.push(e.message);request();});
const hemi=new T.HemisphereLight(0xd9e8f0,0x8f795b,2);scene.add(hemi);
const sun=new T.DirectionalLight(0xffe2b8,3.6);sun.position.set(-4,10,8);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-10;sun.shadow.camera.right=10;sun.shadow.camera.top=10;sun.shadow.camera.bottom=-12;sun.shadow.camera.far=40;sun.shadow.normalBias=.025;scene.add(sun);
const fill=new T.DirectionalLight(0xe1edff,1.4);fill.position.set(8,3,-4);scene.add(fill);
const ground=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshStandardMaterial({color:0xbcb5a3,roughness:.92}));ground.rotation.x=-Math.PI/2;ground.position.y=-4.3;ground.receiveShadow=true;scene.add(ground);
// Elements owns the fluid geometry and its bounded decoded-frame cache.
const cache=null,cacheLoadMs=null;
const beam=new T.SpotLight(0xffedce,0,30,.15,.7,1.5);beam.position.set(0,0,3);beam.target.position.set(0,-1.8,-8);scene.add(beam,beam.target);
let envTarget=null,envReady=false,lastDrive=-1,lastSolid=-1;
async function environment(){
 try{
  const base='./assets/pbr-metal/studio/';
  const [meta,res]=await Promise.all([fetch(base+'studio_small_08-source.json').then(r=>r.json()),fetch(base+'studio_small_08-1024x512-rgba.f32.gz')]);
  if(!res.ok)throw Error('Environment HTTP '+res.status);
  const data=new Float32Array(await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  for(let i=0;i<data.length;i+=4){data[i]*=.125;data[i+1]*=.125;data[i+2]*=.125;}
  if(disposed)return;
  const tex=new T.DataTexture(data,...meta.runtimeDimensions,T.RGBAFormat,T.FloatType);tex.mapping=T.EquirectangularReflectionMapping;tex.needsUpdate=true;
  const pmrem=new T.PMREMGenerator(renderer);envTarget=pmrem.fromEquirectangular(tex);scene.environment=envTarget.texture;tex.dispose();pmrem.dispose();envReady=true;request();
 }catch(e){errors.push(e.message);request();}
}
const gl=renderer.getContext(),timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');let pending=null;
function request(){if(!raf&&!disposed&&!document.hidden)raf=requestAnimationFrame(draw);}
function resize(){const w=canvas.clientWidth,h=canvas.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(hybridReady){hybridReady=false;hybridResize=hybridResize.then(()=>hybrid.resize(Math.round(w),Math.round(h),8)).then(()=>{hybridReady=true;request();}).catch(e=>{hybridError=e.message;request();});}request();}
const observer=new ResizeObserver(resize);observer.observe(canvas);
function readScroll(){target=clamp(scrollY/Math.max(1,journey.offsetHeight-innerHeight));request();}
addEventListener('scroll',()=>{if(!run)readScroll();},{passive:true});
function motion(){ $('#motion').setAttribute('aria-pressed',String(reduced));request(); }
$('#motion').onclick=()=>{reduced=!reduced;motion();};preference.addEventListener('change',e=>{reduced=e.matches;motion();});motion();
document.querySelectorAll('[data-progress]').forEach(b=>b.onclick=()=>{run=null;scrollTo({top:+b.dataset.progress*(journey.offsetHeight-innerHeight),behavior:reduced?'instant':'smooth'});});
$('#benchmark').onclick=()=>{scrollTo({top:0,behavior:'instant'});p=target=0;samples.length=cpu.length=gpu.length=0;run={start:performance.now()};last=0;request();};
addEventListener('visibilitychange',()=>{last=0;if(document.hidden)run=null;else request();});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();disposed=true;$('#status').textContent='Graphics paused. Reload to restore.';});
function percentile(a,q){if(!a.length)return null;const s=[...a].sort((a,b)=>a-b);return +s[Math.floor((s.length-1)*q)].toFixed(2);}
function draw(now){
 raf=0;if(disposed||document.hidden)return;const start=performance.now(),dt=last?Math.min(.05,(now-last)/1000):1/60;
 if(run){const t=(now-run.start)/16000;target=t<.5?phase(t,0,.5):1-phase(t,.5,1);if(t>=1){run=null;target=0;}}
 const wasMoving=Math.abs(target-p)>.00005||!!run;
 if(last&&wasMoving){samples.push(now-last);if(samples.length>1800)samples.shift();}last=now;
 p=reduced?target:p+(target-p)*(1-Math.exp(-dt*12));if(Math.abs(target-p)<.00005)p=target;
 const q=clamp(p/.48),s=sliceState(q),act=p<.145?0:p<.34?1:p<.53?2:p<.68?3:p<.85?4:5;document.body.dataset.act=act;
 mechanism.update(s.drive,s.solid,'mechanism',s.solid);
 // One object, one world, one perspective camera. The camera moves through
 // the physical opening; the iris is culled only once it is behind the eye.
 mechanism.root.rotation.set(0,0,0);mechanism.root.visible=true;
 const align=phase(q,.30,.46),travel=s.travel,wide=camera.aspect<.8?1.45:1;
 const eye=new T.Vector3(8*(1-align),3*(1-align)+.12*align,20*wide*(1-align)+14*wide*align);
 eye.lerp(new T.Vector3(0,.12,-2),phase(q,.46,.66));
 eye.lerp(new T.Vector3(2.7,1.4,-3.5),phase(q,.66,.73));
 const aim=new T.Vector3((camera.aspect<.8?0:-1.6)*(1-align),camera.aspect<.8?1*(1-align):0,-2*align).lerp(new T.Vector3(0,-1.8,-8),travel);
 eye.lerp(new T.Vector3(3,1,-7),phase(p,.49,.61));aim.lerp(new T.Vector3(0,-1.6,-12),phase(p,.49,.61));
 eye.lerp(new T.Vector3(4,1,-11),phase(p,.64,.74));aim.lerp(new T.Vector3(0,-2.3,-17),phase(p,.64,.74));
 eye.lerp(new T.Vector3(2.1,-2.3,-26.2),phase(p,.82,1));aim.lerp(new T.Vector3(-.15,-3.65,-35.15),phase(p,.82,1));
 camera.position.copy(eye);camera.lookAt(aim);camera.updateMatrixWorld();projects?.update(p,songAudio.paused?null:songAudio.currentTime);
 $('#sound').hidden=act!==3;$('#sound').textContent=songAudio.paused?'Play Lantern Steps ↗':'Pause Lantern Steps';if(act!==3&&!songAudio.paused)songAudio.pause();
 const close=phase(q,.47,.54)*(1-phase(q,.68,.73));
 $('.copy').style.opacity=String(1-close);$('#measure').style.opacity=String(1-close);
 document.body.classList.toggle('in-aperture',close>.5);
 hemi.intensity=(1.6+.4*s.solid)*(1-.65*phase(p,.82,1));beam.intensity=80*s.solid*s.drive*(1-phase(p,.32,.4));sun.intensity=3.6-1.8*phase(p,.82,1);fill.intensity=1.4-.9*phase(p,.82,1);
 ground.visible=s.solid>.01&&p<.81;
 if(s.drive!==lastDrive||s.solid!==lastSolid){renderer.shadowMap.needsUpdate=true;lastDrive=s.drive;lastSolid=s.solid;}
 const titles=['One input.\nSix blades.','An opening\nfor light.','Force leaves\na trace.','Motion\nfinds a meter.','Timing becomes\na strike.','A world\nbeyond the lens.'];
 $('#chapter').textContent=['01 / CYBR GEO','02 / CYBR LIGHT','03 / CYBR ELEMENTS','04 / CYBR SONG','05 / CYBR COMBAT','06 / CYBR SCENES'][act];$('#title').innerText=titles[act];
 $('#description').textContent=['The pinion drives the cam ring. Every blade follows.','The same mechanism, shaded by CYBR LIGHT when its hybrid is ready.','Actual APIC / FLIP surface frames. Scroll forwards or backwards through the lateral impulse.','Lantern Steps: the original piano and guitar score. Each bar is a real note event.','The actual CYBR mannequin performs its step-in cross. Scroll controls the source take.','Desert Hot Springs: reduced from the original native scene, not a replacement diorama.'][act];
 $('#measure').textContent=[`120 : 24 / ${(s.drive*60).toFixed(1)}° cam travel`,hybridReady?'CYBR LIGHT / HYBRID':hybridError?'RASTER PREVIEW / WEBGPU UNAVAILABLE':'PREPARING CYBR LIGHT','APIC / FLIP · 436,708 PARTICLES','LANTERN STEPS / 33 NOTE EVENTS','SOURCE TAKE / 52 JOINTS','NATIVE SPRINGS / SOURCE-DERIVED LOD'][act];
 $('#status').textContent=errors.length||projects?.state.errors.length?'Some assets unavailable · see study notes':!envReady?'Preparing photographic environment…':!surfaces?'Loading CYBR MATERIAL maps…':!projects?.state.scenes?'Loading native project assets…':'Scroll to continue · reverse to retrace';
 $('#progress').style.transform=`scaleX(${p})`;document.querySelectorAll('[data-progress]').forEach((b,i)=>{if(i===act)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
 let lightVisible=false;
 if(hybridReady&&p>.16&&p<.29){const e=camera.matrixWorld.elements;hybrid.setCamera({eye:camera.position.toArray(),right:e.slice(0,3),up:e.slice(4,7),forward:e.slice(8,11).map(x=>-x),tan:Math.tan(T.MathUtils.degToRad(camera.fov/2))});try{hybrid.render();lightVisible=true;}catch(e){hybridError=e.message;hybridReady=false;}}
 hybridCanvas.style.opacity=lightVisible?String(phase(p,.16,.18)*(1-phase(p,.27,.29))):'0';
 if(pending&&gl.getQueryParameter(pending,gl.QUERY_RESULT_AVAILABLE)){if(!gl.getParameter(timer.GPU_DISJOINT_EXT)){gpu.push(gl.getQueryParameter(pending,gl.QUERY_RESULT)/1e6);if(gpu.length>600)gpu.shift();}gl.deleteQuery(pending);pending=null;}
 const query=timer&&!pending?gl.createQuery():null;if(query)gl.beginQuery(timer.TIME_ELAPSED_EXT,query);
 renderer.render(scene,camera);if(query){gl.endQuery(timer.TIME_ELAPSED_EXT);pending=query;}
 cpu.push(performance.now()-start);if(cpu.length>600)cpu.shift();frames++;firstFrame??=performance.now();
 $('#metrics').textContent=JSON.stringify({renderer:'Raster PBR / environment prefilter',progress:+p.toFixed(3),frames,firstFrameMs:+firstFrame.toFixed(1),environmentReady:envReady,materialsReady:!!surfaces,cacheMB:cache?+(cache.byteLength/1048576).toFixed(2):0,cacheLoadMs:cacheLoadMs===null?null:+cacheLoadMs.toFixed(1),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,movingFrameP50:percentile(samples,.5),movingFrameP95:percentile(samples,.95),cpuP95:percentile(cpu,.95),gpuP50:percentile(gpu,.5),gpuP95:percentile(gpu,.95),benchmarkRunning:!!run,errors},null,2);
 $('#metrics').textContent+='\n'+JSON.stringify({projects:projects?.state,flip:projects?.fluid(),hybridReady,hybridError,hybridGPU:hybrid?.stats.gpuMs},null,2);
 if(wasMoving||Math.abs(p-target)>.00005||!songAudio.paused||(lightVisible&&hybrid.lightingPending))request();else last=0;
}
resize();readScroll();environment();prepareHybrid();
addEventListener('pagehide',e=>{if(e.persisted)return;disposed=true;cancelAnimationFrame(raf);observer.disconnect();if(pending)gl.deleteQuery(pending);projects?.dispose();hybrid?.destroy();surfaces?.dispose();mechanism.dispose();envTarget?.dispose();scene.traverse(o=>{if(o.isMesh&&!mechanism.parts.includes(o)){o.geometry.dispose();for(const m of [].concat(o.material))m.dispose();}});renderer.dispose();});
