import * as T from './vendor/three-r180/three.module.min.js';
import {fetchArtifact} from './artifact-fetch.mjs';
import {clamp,phase,contourRadius,instrumentState,irisLeaf} from './aperture-math.mjs';
const $=s=>document.querySelector(s),canvas=$('#instrument'),journey=$('.journey');
const systemMotion=matchMedia('(prefers-reduced-motion:reduce)');
let reduced=systemMotion.matches;

async function boot(){
  const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  const scene=new T.Scene(),camera=new T.OrthographicCamera(-7,7,4.2,-4.2,.1,70);camera.position.set(0,0,15);
  const paper=new T.Color(0xe8e5dd),ink=new T.Color(0x191d1c);scene.background=paper.clone();
  const root=new T.Group(),shell=new T.Group(),draft=new T.Group();root.add(shell,draft);scene.add(root);
  scene.add(new T.HemisphereLight(0xffffff,0x72766b,1.8));
  const key=new T.DirectionalLight(0xffffff,3.8);key.position.set(-4,7,7);scene.add(key);
  const edge=new T.DirectionalLight(0xffb38f,2);edge.position.set(5,-1,-3);scene.add(edge);
  const fill=new T.DirectionalLight(0xd8edff,1.2);fill.position.set(1,2,8);scene.add(fill);
  const metal=new T.MeshStandardMaterial({color:0xb7c2bd,metalness:.88,roughness:.25,transparent:true});
  const graphite=new T.MeshStandardMaterial({color:0x252e2b,metalness:.8,roughness:.31,transparent:true});
  const copper=new T.MeshStandardMaterial({color:0xcf7955,metalness:.75,roughness:.27,transparent:true});
  const bladeMaterial=new T.MeshStandardMaterial({color:0x28312e,metalness:.75,roughness:.35,side:T.DoubleSide,transparent:true});
  renderer.localClippingEnabled=true;
  const revealPlane=new T.Plane(new T.Vector3(0,-1,0),-4);
  const bladeMaterials=Array.from({length:6},(_,i)=>{const m=bladeMaterial.clone();m.color.multiplyScalar(.65+i*.13);return m;});
  for(const m of [metal,graphite,copper,...bladeMaterials]){m.transparent=false;m.clippingPlanes=[revealPlane];}
  const profiles=[],contours=[],handles=[],leaves=[],N=160;

  // Bevelled, watertight contour extrusion. Every ring shares this site's profile.
  function ring(outer,inner,depth,z,material,deform=true,innerDeform=false){
    const geometry=new T.BufferGeometry(),positions=new Float32Array(N*8*3),indices=[];
    for(let i=0;i<N;i++)for(let j=0;j<8;j++){const a=i*8+j,b=((i+1)%N)*8+j,c=((i+1)%N)*8+(j+1)%8,d=i*8+(j+1)%8;indices.push(a,b,c,a,c,d);}
    geometry.setAttribute('position',new T.BufferAttribute(positions,3));geometry.setIndex(indices);
    const mesh=new T.Mesh(geometry,material);mesh.position.z=z;shell.add(mesh);profiles.push({geometry,positions,outer,inner,depth,deform,innerDeform});return mesh;
  }
  ring(1.80,1.23,1.26,-.56,graphite);
  for(let i=0;i<12;i++)ring(1.97-i*.008,1.25,.055,-i*.105,i%4===0?metal:graphite);
  ring(2.10,1.21,.17,.15,graphite);ring(1.96,1.23,.14,-1.23,metal);
  ring(2.10,2.065,.02,.246,metal,true,true);
  ring(1.38,1.20,.065,.26,copper,false);
  function contour(radius,z,color){const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(N*3),3));const m=new T.LineBasicMaterial({color,transparent:true});const line=new T.LineLoop(g,m);draft.add(line);contours.push({g,radius,z,line});return line;}
  contour(2.10,.25,0xb4482d);
  for(let i=1;i<12;i++)contour(1.97-i*.008,-i*.105,0x747c70);
  const innerPoints=Array.from({length:N},(_,i)=>new T.Vector3(Math.cos(i/N*Math.PI*2)*1.21,Math.sin(i/N*Math.PI*2)*1.21,.25));
  const innerLine=new T.LineLoop(new T.BufferGeometry().setFromPoints(innerPoints),new T.LineBasicMaterial({color:0x747c70,transparent:true}));draft.add(innerLine);
  for(let i=0;i<3;i++){
    const a=i*Math.PI*2/3;
    const handle=new T.Mesh(new T.TorusGeometry(.055,.012,6,24),new T.MeshBasicMaterial({color:0xb4482d,transparent:true}));draft.add(handle);handles.push({handle,a});
    const bolt=new T.Mesh(new T.CylinderGeometry(.065,.065,.055,16),metal);bolt.rotation.x=Math.PI/2;bolt.position.set(Math.cos(a)*2.09,Math.sin(a)*2.09,.275);shell.add(bolt);
    const slot=new T.Mesh(new T.BoxGeometry(.073,.014,.009),graphite);slot.position.set(bolt.position.x,bolt.position.y,.306);slot.rotation.z=a;shell.add(slot);
  }
  // Actual polygon leaves, with the hidden portion clipped to the optical seat.
  // Their visible boundaries follow the rotating-pivot half-plane construction.
  for(let i=0;i<6;i++){const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(300*3),3));g.setAttribute('normal',new T.BufferAttribute(new Float32Array(300*3),3));for(let j=0;j<300;j++)g.attributes.normal.array[j*3+2]=1;const leaf=new T.Mesh(g,bladeMaterials[i]);leaf.frustumCulled=false;leaf.position.z=.12+i*.004;shell.add(leaf);leaves.push(g);}
  const glassMaterial=new T.MeshPhysicalMaterial({color:0xffffff,roughness:.025,transmission:1,thickness:.62,ior:1.52,dispersion:1.4,metalness:0,envMapIntensity:.55});
  const lens=new T.Mesh(new T.SphereGeometry(1.205,72,40),glassMaterial);lens.scale.z=.30;lens.position.z=-.28;shell.add(lens);

  function lettering(text,width,height,size,color){const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`600 ${size}px Arial`;ctx.fillText(text,width/2,height/2);const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;return map;}
  const engraving=new T.Mesh(new T.PlaneGeometry(1.55,.16),new T.MeshBasicMaterial({map:lettering('C Y B R D E L I C   /   0 0 1',1024,96,37,'#bdc7bc'),transparent:true,depthWrite:false}));engraving.position.set(0,1.62,.242);shell.add(engraving);
  const lowerMark=new T.Mesh(new T.PlaneGeometry(.9,.12),new T.MeshBasicMaterial({map:lettering('G E O  →  L I G H T',768,96,37,'#bdc7bc'),transparent:true,depthWrite:false}));lowerMark.position.set(0,-1.59,.242);shell.add(lowerMark);
  const typeGroup=new T.Group();scene.add(typeGroup);
  for(const [text,y,color] of [['CYBR',.77,'#242c27'],['LIGHT',-.77,'#ba4c32']]){const mesh=new T.Mesh(new T.PlaneGeometry(8,1.7),new T.MeshBasicMaterial({map:lettering(text,2048,512,450,color),alphaTest:.45,side:T.DoubleSide}));mesh.position.y=y;typeGroup.add(mesh);}
  typeGroup.position.z=-2.1;

  let progress=0,target=0,bend=0,bendTarget=0,yaw=0,yawTarget=0,lensX=0,lensY=0,targetX=0,targetY=0,lastBend=NaN;
  let raf=0,last=0,visible=true,lost=false,drag=null,lastLength=0,frameCount=0,benchmark=null,lastOpening=NaN;
  const errors=[],intervals=[],start=performance.now();let environmentReady=false;
  const copies=[$('.contour-copy'),$('.housing-copy'),$('.optics-copy')];
  function updateProfile(value){
    if(Math.abs(value-lastBend)<.0001)return;lastBend=value;
    for(const {geometry,positions,outer,inner,depth,deform,innerDeform} of profiles){const bevel=Math.min(.025,depth*.22,(outer-inner)*.2);
      for(let i=0;i<N;i++){const a=i/N*Math.PI*2,r=outer*(deform?contourRadius(a,value):1),ir=inner*(innerDeform?contourRadius(a,value):1),profile=[[ir+bevel,-depth/2],[r-bevel,-depth/2],[r,-depth/2+bevel],[r,depth/2-bevel],[r-bevel,depth/2],[ir+bevel,depth/2],[ir,depth/2-bevel],[ir,-depth/2+bevel]];
        for(let j=0;j<8;j++){const [radius,z]=profile[j];positions.set([Math.cos(a)*radius,Math.sin(a)*radius,z],(i*8+j)*3);}}
      geometry.attributes.position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();}
    for(const {g,radius} of contours){for(let i=0;i<N;i++){const a=i/N*Math.PI*2,r=radius*contourRadius(a,value);g.attributes.position.array.set([Math.cos(a)*r,Math.sin(a)*r,0],i*3);}g.attributes.position.needsUpdate=true;g.computeBoundingSphere();}
    for(const {handle,a} of handles){const r=2.1*contourRadius(a,value);handle.position.set(Math.cos(a)*r,Math.sin(a)*r,.28);}
  }
  function request(){if(!raf&&visible&&!document.hidden&&!lost)raf=requestAnimationFrame(draw);}
  function resize(){const rect=canvas.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);const mobile=rect.width<=760,narrow=rect.width/rect.height<1.3;const height=mobile?10.5:narrow?9.2:8.2,width=height*rect.width/rect.height;camera.left=-width/2;camera.right=width/2;camera.top=height/2;camera.bottom=-height/2;camera.updateProjectionMatrix();const length=journey.offsetHeight-innerHeight;if(lastLength&&scrollY<=lastLength+2)window.scrollTo({top:target*length,behavior:'instant'});lastLength=length;request();}
  new ResizeObserver(resize).observe(canvas);new IntersectionObserver(([e])=>{visible=e.isIntersecting;last=0;request();}).observe($('.stage'));
  addEventListener('scroll',()=>{if(benchmark&&scrollY<2)return;benchmark=null;target=clamp(scrollY/Math.max(1,journey.offsetHeight-innerHeight));request();},{passive:true});
  document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden)benchmark=null;request();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;$('#status').textContent='GRAPHICS PAUSED — RELOAD TO RESTORE';});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
  function go(p){benchmark=null;window.scrollTo({top:p*(journey.offsetHeight-innerHeight),behavior:reduced?'instant':'smooth'});}
  document.querySelectorAll('[data-stop]').forEach(button=>button.addEventListener('click',()=>go(Number(button.dataset.stop))));
  function setReduced(v){reduced=v;$('#motion').setAttribute('aria-pressed',String(v));request();}
  $('#motion').addEventListener('click',()=>setReduced(!reduced));systemMotion.addEventListener('change',e=>setReduced(e.matches));setReduced(reduced);
  canvas.addEventListener('pointerdown',e=>{e.preventDefault();benchmark=null;drag={x:e.clientX,y:e.clientY,bend:bendTarget,yaw:yawTarget,lensX:targetX,lensY:targetY};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(target<.28)bendTarget=clamp(drag.bend+dx/160,-1,1);else if(target<.68)yawTarget=clamp(drag.yaw+dx/220,-.7,.7);else{targetX=clamp(drag.lensX+dx/canvas.clientWidth*5,-1.3,1.3);targetY=clamp(drag.lensY-dy/canvas.clientHeight*4,-.7,.7);}request();});
  for(const event of ['pointerup','pointercancel'])canvas.addEventListener(event,()=>drag=null);
  canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const d=['ArrowLeft','ArrowDown'].includes(e.key)?-1:1;if(target<.28)bendTarget=clamp(bendTarget+d*.15,-1,1);else if(target<.68)yawTarget=clamp(yawTarget+d*.1,-.7,.7);else if(['ArrowUp','ArrowDown'].includes(e.key))targetY=clamp(targetY+d*.1,-.7,.7);else targetX=clamp(targetX+d*.15,-1.3,1.3);request();});
  $('#benchmark').addEventListener('click',()=>{window.scrollTo({top:0,behavior:'instant'});progress=target=0;intervals.length=0;benchmark={start:null};visible=true;last=0;$('#bench-status').textContent='Running forward and reverse for 12 seconds.';request();});
  fetchArtifact('./assets/pbr-metal/studio/studio_small_08-1024x512-rgba.f32.gz').then(raw=>{if(raw.byteLength!==1024*512*16)throw Error('Environment size mismatch');const tex=new T.DataTexture(new Float32Array(raw),1024,512,T.RGBAFormat,T.FloatType);tex.mapping=T.EquirectangularReflectionMapping;tex.needsUpdate=true;const pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(tex).texture;scene.environmentIntensity=.85;pmrem.dispose();tex.dispose();environmentReady=true;request();}).catch(e=>{errors.push(e.message);request();});
  let lastStats=0;
  function draw(now){raf=0;if(!visible||document.hidden||lost){last=0;return;}const interval=last?now-last:null,dt=interval?Math.min(.05,interval/1000):1/60;last=now;
    if(benchmark){benchmark.start??=now;const t=(now-benchmark.start)/12000;target=t<.5?phase(t,0,.5):1-phase(t,.5,1);if(t>=1){target=0;benchmark=null;$('#bench-status').textContent='Forward / reverse complete.';}}
    const moving=Math.abs(progress-target)>.0002||Math.abs(bend-bendTarget)>.0002||Math.abs(yaw-yawTarget)>.0002||Math.abs(lensX-targetX)>.0002||Math.abs(lensY-targetY)>.0002;
    const k=reduced?1:1-Math.exp(-dt*10);progress+=(target-progress)*k;bend+=(bendTarget-bend)*k;yaw+=(yawTarget-yaw)*k;lensX+=(targetX-lensX)*k;lensY+=(targetY-lensY)*k;
    const s=instrumentState(progress),mobile=canvas.clientWidth<=760,narrow=canvas.clientWidth/canvas.clientHeight<1.3;
    updateProfile(bend);scene.background.copy(paper).lerp(ink,s.dark);
    const mix=(a,b)=>`rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*s.dark)).join(' ')})`;
    document.documentElement.style.setProperty('--ink',mix([36,39,32],[233,235,224]));document.documentElement.style.setProperty('--muted',mix([109,112,102],[163,174,163]));document.documentElement.style.setProperty('--accent',mix([180,72,45],[236,157,116]));
    const baseScale=mobile?.72:narrow?.92:1.05;
    root.scale.setScalar(baseScale*(1+.08*s.solid));root.position.set((narrow?0:2.0)+lensX*s.optics*(mobile?.55:1),narrow?-1.05:0,0);root.position.y+=lensY*s.optics;
    const side=phase(progress,.10,.44)*(1-phase(progress,.60,.88));root.rotation.set(-.20*side,-.72*side+yaw*side,-.16-.20*side+.16*s.optics);
    shell.visible=s.solid>.001;shell.scale.z=Math.max(.002,s.depth);revealPlane.constant=-4+8*s.solid;
    engraving.material.opacity=lowerMark.material.opacity=s.solid;
    if(!Number.isFinite(lastOpening)||Math.abs(s.opening-lastOpening)>.0001){lastOpening=s.opening;leaves.forEach((g,i)=>{const points=irisLeaf(i,s.opening);let n=0;for(let j=1;j<points.length-1;j++)for(const point of [points[0],points[j],points[j+1]]){g.attributes.position.array.set([point[0],point[1],0],n++*3);}g.setDrawRange(0,n);g.attributes.position.needsUpdate=true;});}
    lens.visible=s.optics>.05;
    contours.forEach(({line,z},i)=>{line.position.z=z*s.depth;line.material.opacity=s.sketch*(i===0?1:.65*s.depth);line.material.color.set(i===0?(s.dark>.5?0xf3af87:0xb4482d):(s.dark>.5?0x99aea0:0x747c70));});
    innerLine.material.opacity=s.sketch*.6;for(const {handle} of handles)handle.material.opacity=s.sketch;
    const typeReveal=phase(progress,.73,.91);typeGroup.visible=typeReveal>.001;typeGroup.scale.setScalar(typeReveal*(mobile?.49:narrow?.72:1));typeGroup.position.x=narrow?0:2;typeGroup.position.y=narrow?-1.05:0;
    const copyOpacity=[1-phase(progress,.17,.28),phase(progress,.30,.41)*(1-phase(progress,.57,.68)),phase(progress,.78,.90)];
    copies.forEach((el,i)=>{el.style.opacity=copyOpacity[i];el.style.transform=`translateY(${(1-copyOpacity[i])*18}px)`;el.inert=copyOpacity[i]<.2;});
    document.querySelector('.progress i').style.transform=`scaleX(${progress})`;
    const chapter=progress<.28?0:progress<.68?1:2;document.querySelectorAll('[data-stop]').forEach((el,i)=>{if(i===chapter)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
    $('#gesture').textContent=['DRAG TO SHAPE ↔','DRAG TO TURN ↔','DRAG THE LENS ↔'][chapter];$('#object-label').textContent=['CUSTOM PROFILE / THREE LOBES','12 RIBS / ONE CONTINUOUS PROFILE','SIX LEAVES / ONE OPTICAL OPENING'][chapter];$('#status').textContent=environmentReady?'CYBRDELIC / CUSTOM INSTRUMENT':'CUSTOM GEOMETRY READY / STUDIO LOADING';
    renderer.render(scene,camera);frameCount++;if(moving&&interval!==null&&intervals.length<3000)intervals.push(interval);
    if(now-lastStats>300||!moving){const sorted=[...intervals].sort((a,b)=>a-b);$('#metrics').textContent=JSON.stringify({customGeometry:true,sourceModelDownloads:0,progress:+progress.toFixed(3),bend:+bend.toFixed(3),lens:[+lensX.toFixed(2),+lensY.toFixed(2)],drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frameCount,frameSamples:sorted.length,p95FrameMs:sorted.length?+sorted[Math.floor((sorted.length-1)*.95)].toFixed(2):null,environmentReady,reducedMotion:reduced,errors},null,2);lastStats=now;}
    if(moving||benchmark)request();else last=0;
  }
  resize();target=clamp(scrollY/Math.max(1,journey.offsetHeight-innerHeight));request();
}
boot().catch(e=>{$('#status').textContent='GRAPHICS UNAVAILABLE — PROJECTS BELOW';$('#metrics').textContent=e.message;});
