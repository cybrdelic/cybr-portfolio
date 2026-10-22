import * as T from './vendor/three-r180/three.module.min.js';
import {createMechanism} from './mechanism-model.mjs?revision=finishes-36';
import {SPEC,loadCase} from './mechanism-math.mjs';
import {clamp,phase} from './aperture-math.mjs';
import {mechanismSequence} from './mechanism-sequence.mjs?revision=presentation-43';

const $=s=>document.querySelector(s),canvas=$('#instrument'),journey=$('.journey');
const presentation=document.body.classList.contains('presentation');
const setText=(selector,value)=>{const el=$(selector);if(el)el.textContent=value;};
const motionPreference=matchMedia('(prefers-reduced-motion:reduce)');
let reduced=motionPreference.matches;

async function boot(){
  const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;renderer.localClippingEnabled=true;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  const scene=new T.Scene(),paper=new T.Color(presentation?0xf1f3f5:0xe8e5dd),ink=new T.Color(0x17221f);
  const camera=new T.OrthographicCamera(-8,8,5,-5,.1,80);camera.position.z=18;
  const mechanism=createMechanism();scene.add(mechanism.root);
  let progress=0,target=0,drive=0,manual=null,drag=null,view='mechanism',cycle=null,raf=0,last=0,visible=true,lost=false,frameCount=0,lastStats=0,benchmark=null;
  let width=1440,height=900,lastLength=0,environmentReady=true,opticsReady=true;
  let hybrid=null,hybridReady=false,hybridSizing=false,hybridKey='',lightingAudit=false,auditRequested=false,lightPresented=false;
  const hybridCanvas=document.createElement('canvas');hybridCanvas.className='hybrid-instrument';hybridCanvas.setAttribute('aria-hidden','true');canvas.after(hybridCanvas);
  async function prepareHybrid(){
    try{
      const {createMechanismLight}=await import('./mechanism-light.mjs?revision=presentation-43');
      hybrid=await createMechanismLight(hybridCanvas,mechanism.hardware);hybridCanvas.dataset.triangles=String(hybrid.triangles);
      await sizeHybrid();
    }catch(e){errors.push('CYBR LIGHT: '+e.message);hybridCanvas.dataset.error=e.message;request();}
  }
  async function sizeHybrid(){
    if(!hybrid||hybridSizing)return;
    const mobile=width<=760,narrow=width/height<1.3,scale=presentation?(mobile?.72:narrow?.95:1.08):(mobile?.62:narrow?.80:.94);
    const x=narrow?-.25:(presentation?2.5:2.25),y=presentation?(narrow?-1:0):(mobile?-2.3:narrow?-2:0);
    const key=width+'x'+height;if(key===hybridKey)return;hybridSizing=true;hybridReady=false;lightPresented=false;
    try{await hybrid.resize(Math.round(width),Math.round(height),camera.top,[0,0]);hybridKey=key;hybridReady=true;delete hybridCanvas.dataset.error;hybridCanvas.dataset.renderer='CYBR LIGHT hybrid / live geometry';}
    catch(e){hybridKey=key;errors.push('CYBR LIGHT: '+e.message);hybridCanvas.dataset.error=e.stack;}
    finally{hybridSizing=false;request();}
  }
  const errors=[],intervals=[],copies=[$('.contour-copy'),$('.housing-copy'),$('.optics-copy')];
  $('#lighting-debug')?.addEventListener('change',e=>{hybrid?.setDebugView(+e.target.value);request();});
  if(!presentation){const button=document.createElement('button');button.id='compare-lighting';button.textContent='Compare moving / settled lighting';$('.mechanism-panel').append(button);const output=document.createElement('section');output.id='lighting-comparison';output.style.cssText='padding:32px;background:#e8e5dd;color:#17221f';$('#work').before(output);button.addEventListener('click',()=>{if(!hybridReady||lightingAudit)return;auditRequested=true;cycle={start:null,from:drive};manual=null;request();});}
  function request(){if(!raf&&visible&&!document.hidden&&!lost)raf=requestAnimationFrame(draw);}
  function resize(){const r=canvas.getBoundingClientRect();width=r.width;height=r.height;renderer.setSize(width,height,false);const vh=width<=760?13.8:width/height<1.3?12.6:10.2;camera.left=-vh*width/height/2;camera.right=-camera.left;camera.top=vh/2;camera.bottom=-vh/2;camera.updateProjectionMatrix();const length=journey.offsetHeight-innerHeight;if(lastLength&&scrollY<=lastLength+2)window.scrollTo({top:target*length,behavior:'instant'});lastLength=length;request();}
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e])=>{visible=e.isIntersecting;last=0;request();}).observe($('.stage'));
  addEventListener('scroll',()=>{if(benchmark&&scrollY<2)return;benchmark=null;target=clamp(scrollY/Math.max(1,journey.offsetHeight-innerHeight));manual=null;cycle=null;setText('#actuate','Run mechanism ↻');request();},{passive:true});
  function go(p){cycle=null;manual=null;benchmark=null;window.scrollTo({top:p*(journey.offsetHeight-innerHeight),behavior:reduced?'instant':'smooth'});}
  document.querySelectorAll('[data-stop]').forEach(b=>b.addEventListener('click',()=>go(+b.dataset.stop)));
  document.querySelectorAll('[data-inspect]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.inspect;document.querySelectorAll('[data-inspect]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));request();}));
  $('#actuate')?.addEventListener('click',()=>{benchmark=null;if(cycle){cycle=null;manual=drive;setText('#actuate','Run mechanism ↻');}else{cycle={start:null,from:drive};setText('#actuate','Stop mechanism ■');if(target<.30)go(.48);cycle={start:null,from:drive};}request();});
  function setReduced(v){reduced=v;cycle=null;setText('#actuate','Run mechanism ↻');$('#motion').setAttribute('aria-pressed',String(v));request();}
  $('#motion').addEventListener('click',()=>setReduced(!reduced));motionPreference.addEventListener('change',e=>setReduced(e.matches));setReduced(reduced);
  canvas.addEventListener('pointerdown',e=>{if(!presentation&&progress>.74)return;e.preventDefault();canvas.focus({preventScroll:true});benchmark=null;cycle=null;drag={x:e.clientX,drive};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;manual=clamp(drag.drive+(e.clientX-drag.x)/Math.min(width*.5,320));request();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>drag=null);
  canvas.addEventListener('keydown',e=>{if(!presentation&&progress>.74)return;if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();cycle=null;manual=clamp(drive+(e.key==='ArrowRight'?.08:-.08));request();}});
  document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden)cycle=null;request();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;$('#status').textContent='GRAPHICS PAUSED — RELOAD TO RESTORE';});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
  $('#benchmark').addEventListener('click',()=>{window.scrollTo({top:0,behavior:'instant'});progress=target=0;manual=null;cycle=null;intervals.length=0;benchmark={start:null};visible=true;last=0;$('#bench-status').textContent='Running a 12-second forward / reverse sweep.';request();});
  const metrics=mechanism.metrics;
  function draw(now){
    raf=0;if(!visible||document.hidden||lost||lightingAudit){last=0;return;}
    const interval=last?now-last:null,dt=interval?Math.min(.05,interval/1000):1/60;last=now;
    if(benchmark){benchmark.start??=now;const t=(now-benchmark.start)/12000;target=t<.5?phase(t,0,.5):1-phase(t,.5,1);if(t>=1){benchmark=null;target=0;$('#bench-status').textContent='Forward / reverse complete.';}}
    const k=reduced?1:1-Math.exp(-dt*11);progress+=(target-progress)*k;
    if(Math.abs(progress-target)<.0002)progress=target;
    const sequence=presentation?mechanismSequence(progress):null;
    let commanded=sequence?sequence.drive:phase(progress,.34,.69);
    if(cycle){cycle.start??=now;const t=(now-cycle.start)/6000,startPhase=Math.acos(1-2*cycle.from);commanded=.5-.5*Math.cos(startPhase+t*Math.PI*2);if(t>=1){manual=cycle.from;cycle=null;commanded=manual;setText('#actuate','Run mechanism ↻');}}
    else if(manual!==null)commanded=manual;
    const moving=Math.abs(progress-target)>.0002||Math.abs(drive-commanded)>.0002;drive+=(commanded-drive)*k;
    if(Math.abs(drive-commanded)<.0002)drive=commanded;
    const assembly=sequence?sequence.light:phase(progress,.08,.30),optical=sequence?sequence.light:phase(progress,.74,.92),dark=presentation?0:hybridReady?0:phase(progress,.10,.30)*(1-phase(progress,.73,.91));
    const mobile=width<=760,narrow=width/height<1.3;
    scene.background??=paper.clone();scene.background.copy(paper).lerp(ink,dark);
    const mix=(a,b)=>`rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*dark)).join(' ')})`;
    document.documentElement.style.setProperty('--ink',mix([36,39,32],[233,235,224]));document.documentElement.style.setProperty('--muted',mix([109,112,102],[168,181,172]));document.documentElement.style.setProperty('--accent',mix([180,72,45],[236,157,116]));
    const p=mechanism.update(drive,0,view,opticsReady?optical:0);
    mechanism.root.scale.setScalar(presentation?(mobile?.46:narrow?.60:.68):(mobile?.62:narrow?.80:.94));
    mechanism.root.position.set(narrow?-.25:(presentation?2.5:2.25),presentation?(narrow?-.2:.7):(mobile?-2.3:narrow?-2.0:0),0);
    const side=phase(progress,.10,.33)*(1-phase(progress,.73,.94));mechanism.root.rotation.x=-.20*side-.20*optical;mechanism.root.rotation.y=-.58*side*(1-.35*phase(progress,.42,.65))-.40*optical;
    if(sequence){mechanism.root.rotation.set(sequence.rotationX,sequence.rotationY,sequence.rotationZ);mechanism.root.scale.multiplyScalar(sequence.scale);}
    const opacity=[1-phase(progress,.16,.26),phase(progress,.25,.34)*(1-phase(progress,.73,.81)),phase(progress,.80,.92)];copies.forEach((el,i)=>{el.style.opacity=opacity[i];el.inert=opacity[i]<.2;});
    if(sequence){copies.forEach((el,i)=>{el.style.opacity=i===sequence.act?1:0;el.inert=i!==sequence.act;});}
    const panel=$('.mechanism-panel');if(panel){panel.style.opacity=phase(progress,.20,.31);panel.inert=progress<.24;}
    const chapter=progress<.26?0:progress<.80?1:2;document.querySelectorAll('[data-stop]').forEach((b,i)=>{if(i===chapter)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
    if(sequence)document.querySelectorAll('[data-stop]').forEach((b,i)=>{if(i===sequence.act)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
    $('.progress i').style.transform=`scaleX(${progress})`;
    $('#gesture').textContent=chapter===0?'FULL GEOMETRY / SCROLL TO ASSEMBLE ↓':chapter===2?'CYBR LIGHT / HYBRID BEAUTY':'DRAG TO ACTUATE ↔';
    $('#object-label').textContent=(presentation?['FORM FOLLOWS CONSTRAINT','ONE INPUT. EVERYTHING CONNECTED.','GEOMETRY BECOMES LIGHT.']:['IRIS—01 / A CONSTRAINED INSTRUMENT','120T : 24T / SIX CAM FOLLOWERS','Ø32 MM / CONTROLLED BY THE MECHANISM'])[chapter];
    if(sequence){$('#object-label').textContent=sequence.detail;$('#gesture').textContent='Scroll to actuate · drag to explore';}
    if(!sequence)$('#status').textContent=chapter>0?(hybridReady?'CYBR LIGHT / LIVE HYBRID + TRACED OPTICS':errors.some(e=>e.startsWith('CYBR LIGHT:'))?'CYBR LIGHT UNAVAILABLE':'PREPARING CYBR LIGHT HYBRID'):'CYBR GEO / IRIS—01';
    // Whiteprint is a technical line drawing. Every shaded phase is rendered
    // by CYBR LIGHT, including the actuating mechanism, not a Three.js preview.
    // Prewarm the held edge-on pose before switching representations. The
    // reveal itself is geometry turning into the studio, not canvas opacity.
    const needsHybrid=!presentation||progress>=.78;
    if(hybridReady&&!hybridSizing&&needsHybrid){try{hybrid.render();}catch(e){hybridReady=false;errors.push('CYBR LIGHT: '+e.message);hybridCanvas.dataset.error=e.message;}}
    if(assembly===0)lightPresented=false;
    else if(hybrid?.frameCurrent)lightPresented=true;
    const reveal=hybridReady&&(!presentation||lightPresented)?assembly:0;
    if(sequence){
      const unavailable=errors.some(e=>e.startsWith('CYBR LIGHT:'));
      setText('#status',sequence.act===2?(reveal?'CYBR LIGHT · live metal & glass':unavailable?'Lighting unavailable · drawing remains interactive':'Preparing lighting · drawing remains interactive'):'CYBR GEO · live mechanism');
      setText('.optics-copy h2',reveal?'Through\nthe aperture.':'The optical\nassembly.');
      setText('#optics-description',reveal?'The same assembly, with metal reflections and a glass optical element.':'Explore the mechanism while lighting prepares, or open the finished optical studies below.');
    }
    hybridCanvas.style.opacity=hybridReady?reveal:0;
    hybridCanvas.style.clipPath='none';
    canvas.style.clipPath='none';canvas.style.opacity=1-reveal;
    if(hybrid&&!hybridSizing&&(width+'x'+height)!==hybridKey)sizeHybrid();
    setText('#ring-angle',(p.ring*180/Math.PI).toFixed(1)+'°');setText('#encoder',String(p.encoder).padStart(4,'0')+' / 4096');
    const aperture=Math.min(.80,Math.max(0,SPEC.pivot*(Math.cos(80*Math.PI/180+p.blade)-Math.cos(80*Math.PI/180))-.015))*40;
    if(sequence){
      setText('#part-name',['24-tooth pinion','Six cam followers','Aperture diameter'][sequence.act]);
      setText('#part-value',sequence.act===0?'5:1':sequence.act===1?(p.ring*180/Math.PI).toFixed(1)+'°':aperture.toFixed(1)+' mm');
      setText('#part-description',['pinion turns : cam-ring turns','cam-ring angle · nominal kinematics','nominal opening · driven by the blades'][sequence.act]);
      const part=mechanism.parts.find(mesh=>[ /pinion/i,/roller/i,/Optical element/i ][sequence.act].test(mesh.name));
      const leader=$('.part-leader');leader.style.visibility=part&&(!reveal||hybrid?.frameCurrent)?'visible':'hidden';
      if(part){part.updateWorldMatrix(true,false);if(!part.geometry.boundingSphere)part.geometry.computeBoundingSphere();const point=part.geometry.boundingSphere.center.clone().applyMatrix4(part.matrixWorld).project(camera);const x=(point.x+1)*width/2,y=(1-point.y)*height/2;const note=$('.part-note').getBoundingClientRect(),stage=$('.stage').getBoundingClientRect();const sx=note.left-stage.left+note.width/2,sy=note.top-stage.top+note.height;$('#part-leader-path').setAttribute('d',`M${sx},${sy+8} L${sx},${sy+22} L${x},${y}`);$('#part-leader-point').setAttribute('cx',x);$('#part-leader-point').setAttribute('cy',y);}
    }
    setText('#pupil',aperture.toFixed(1)+' mm');setText('#home',p.home?'HOME':'TRAVEL');if($('#home'))$('#home').dataset.home=String(p.home);
    setText('#inspect-note',view==='clearance'?'0.28 mm axial blade gap · 0.40 mm diametral roller clearance. Nominal dimensions; not a tolerance certification.':view==='loads'?`25 mN·m assumed input · ${loadCase(drive).rollerForceN.toFixed(2)} N per roller · ${loadCase(drive).pressureAngleDegrees.toFixed(1)}° pressure angle. Ideal static model; not strength-qualified.`:'Rigid blades, fixed pivots, cut cam slots. Drag the instrument or run one complete cycle.');
    const hardwareVisible=mechanism.hardware.visible;mechanism.hardware.visible=false;
    if(reveal<1)renderer.render(scene,camera);mechanism.hardware.visible=hardwareVisible;
    if(auditRequested&&!cycle){auditRequested=false;lightingAudit=true;const output=$('#lighting-comparison');output.textContent='Comparing the last moving frame against converged lighting at the identical GPU pose…';hybrid.compareLighting().then(result=>{output.replaceChildren();for(const [key,label] of [['before','Last moving frame'],['after','Settled — same pose']]){const figure=document.createElement('figure');figure.style.cssText='display:inline-block;width:46%;margin:1%';const img=document.createElement('img');img.src=result[key];img.alt=label;img.style.width='100%';const caption=document.createElement('figcaption');caption.textContent=label;figure.append(img,caption);output.append(figure);}const pre=document.createElement('pre');pre.id='lighting-comparison-metrics';pre.textContent=JSON.stringify(result.metrics,null,2);output.append(pre);}).catch(e=>{output.textContent=e.message;}).finally(()=>{lightingAudit=false;last=0;});}
    frameCount++;if((moving||cycle||benchmark)&&interval!==null&&intervals.length<4000)intervals.push(interval);
    if(now-lastStats>300||!moving){const sorted=[...intervals].sort((a,b)=>a-b);$('#metrics').textContent=JSON.stringify({customGeometry:true,hybrid:hybrid?{...hybrid.stats,triangles:hybrid.triangles,lightingPending:hybrid.lightingPending}:null,geometryEngine:mechanism.root.userData.geometryEngine,whiteprint:mechanism.root.userData.whiteprint,namedParts:mechanism.parts.length,sourceModelDownloads:1,progress:+progress.toFixed(3),drive:+drive.toFixed(3),ringDegrees:+(p.ring*180/Math.PI).toFixed(2),encoder:p.encoder,inspection:view,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frameCount,frameSamples:sorted.length,p95FrameMs:sorted.length?+sorted[Math.floor((sorted.length-1)*.95)].toFixed(2):null,environmentReady,opticsReady,maxFrameMs:sorted.length?+sorted.at(-1).toFixed(2):null,reducedMotion:reduced,errors},null,2);lastStats=now;}
    if(moving||cycle||benchmark||(hybridReady&&hybrid.lightingPending&&needsHybrid))request();else last=0;
  }
  resize();progress=target=clamp(scrollY/Math.max(1,journey.offsetHeight-innerHeight));request();
  setTimeout(prepareHybrid,100);
  addEventListener('pagehide',e=>{if(!e.persisted){hybrid?.destroy();renderer.dispose();}},{once:true});
}
boot().catch(e=>{$('#status').textContent='GRAPHICS UNAVAILABLE — PROJECTS BELOW';$('#metrics').textContent=e.stack;});
