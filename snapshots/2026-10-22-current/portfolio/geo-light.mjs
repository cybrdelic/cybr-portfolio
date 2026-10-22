import * as T from './vendor/three-r180/three.module.min.js';
import {fetchArtifact} from './artifact-fetch.mjs';
import {clamp,phase,choreography,tracePrism} from './geo-light-math.mjs';

const $=s=>document.querySelector(s);
const canvas=$('#transport'),scrub=$('#scrub'),angleInput=$('#optical-angle');
const systemReduced=matchMedia('(prefers-reduced-motion: reduce)');
let reduced=systemReduced.matches;

async function boot(){
  const renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.setClearColor(0x171a19,0);
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.05;
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(34,1,.05,100);
  scene.background=new T.Color(0x171a19);
  const machine=new T.Group(),source=new T.Group(),optic=new T.Group();
  scene.add(machine,optic);machine.add(source);machine.rotation.x=-Math.PI/2;
  // One persistent index: rotation graduations become a wavelength scale.
  // Instances remain the same objects throughout the scroll, not crossfaded panels.
  const indexCount=96,indexDummy=new T.Object3D();
  const indexMaterial=new T.MeshBasicMaterial({transparent:true,opacity:.85,depthWrite:false});
  const instrumentIndex=new T.InstancedMesh(new T.BoxGeometry(1,1,.018),indexMaterial,indexCount);
  instrumentIndex.instanceMatrix.setUsage(T.DynamicDrawUsage);instrumentIndex.frustumCulled=false;scene.add(instrumentIndex);
  const cameraRight=new T.Vector3(),cameraUp=new T.Vector3(),cameraBack=new T.Vector3(),indexOrigin=new T.Vector3();
  const indexLabelStart=new T.Vector3(),indexLabelEnd=new T.Vector3(),wavelengthLegend=$('.wavelength-legend');
  const indexInk=new T.Color(),indexPaper=new T.Color(0x504a40);
  const darkBackground=new T.Color(0x171a19),paperBackground=new T.Color(0xdcd8cf);
  // Real lettering behind the prism supplies a visible refracted reference.
  const lettering=document.createElement('canvas');lettering.width=1536;lettering.height=384;
  const typeContext=lettering.getContext('2d');typeContext.font='900 330px Arial';typeContext.textAlign='center';typeContext.textBaseline='middle';typeContext.fillStyle='#26332b';typeContext.strokeStyle='#a3b39e';typeContext.lineWidth=2.5;typeContext.fillText('LIGHT',768,206);typeContext.strokeText('LIGHT',768,206);
  const typeTexture=new T.CanvasTexture(lettering);typeTexture.colorSpace=T.SRGBColorSpace;
  const typeMaterial=new T.MeshBasicMaterial({map:typeTexture,alphaTest:.5,side:T.DoubleSide});
  const lightType=new T.Mesh(new T.PlaneGeometry(10,2.5),typeMaterial);lightType.position.set(1.9,.9,-1.1);scene.add(lightType);
  const ambient=new T.HemisphereLight(0xdce7e8,0x23261e,.9);
  scene.add(ambient);
  const key=new T.DirectionalLight(0xffffff,2.8);key.position.set(-4,6,-5);scene.add(key);
  const rim=new T.DirectionalLight(0xc4e7dc,1.3);rim.position.set(5,2,5);scene.add(rim);
  const opticalKey=new T.DirectionalLight(0xcbd9ff,.8);opticalKey.position.set(0,4,7);scene.add(opticalKey);

  const shape=new T.Shape();shape.moveTo(-1,-.57735);shape.lineTo(1,-.57735);shape.lineTo(0,1.1547);shape.closePath();
  const prismGeometry=new T.ExtrudeGeometry(shape,{depth:.65,bevelEnabled:true,bevelThickness:.012,bevelSize:.012,bevelSegments:2,steps:1});
  prismGeometry.translate(0,0,-.325);
  const prismMaterial=new T.MeshPhysicalMaterial({color:0xffffff,metalness:0,roughness:.035,transmission:1,thickness:1.1,ior:1.544,dispersion:.8,attenuationColor:0xc6dbe2,attenuationDistance:20,clearcoat:0,envMapIntensity:.65,side:T.FrontSide});
  const prism=new T.Mesh(prismGeometry,prismMaterial);optic.add(prism);
  const outline=new T.LineSegments(new T.EdgesGeometry(prismGeometry,20),new T.LineBasicMaterial({color:0xc7e2ec,transparent:true,opacity:.42}));prism.add(outline);
  const beamGroup=new T.Group();optic.add(beamGroup);
  const receiver=new T.Mesh(new T.BoxGeometry(.045,1,.08),new T.MeshStandardMaterial({color:0x9ca69c,metalness:.7,roughness:.28}));
  beamGroup.add(receiver);
  const pathPositions=new Float32Array(2048*3),pathColors=new Float32Array(2048*3);
  const pathGeometry=new T.BufferGeometry();
  pathGeometry.setAttribute('position',new T.BufferAttribute(pathPositions,3));
  pathGeometry.setAttribute('color',new T.BufferAttribute(pathColors,3));
  const pathMaterial=new T.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.55,blending:T.AdditiveBlending,depthWrite:false,depthTest:false});
  const paths=new T.LineSegments(pathGeometry,pathMaterial);paths.frustumCulled=false;paths.renderOrder=10;beamGroup.add(paths);
  const fanPositions=new Float32Array(2048*3),fanColors=new Float32Array(2048*3),fanGeometry=new T.BufferGeometry();
  fanGeometry.setAttribute('position',new T.BufferAttribute(fanPositions,3));fanGeometry.setAttribute('color',new T.BufferAttribute(fanColors,3));
  const fanMaterial=new T.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.22,side:T.DoubleSide,blending:T.AdditiveBlending,depthWrite:false});
  const fan=new T.Mesh(fanGeometry,fanMaterial);fan.frustumCulled=false;beamGroup.add(fan);
  const whiteGeometry=new T.BufferGeometry();
  const whitePositions=new Float32Array(18);whiteGeometry.setAttribute('position',new T.BufferAttribute(whitePositions,3));
  const whiteMaterial=new T.MeshBasicMaterial({color:0xf3f3dc,transparent:true,opacity:.65,side:T.DoubleSide,blending:T.AdditiveBlending,depthWrite:false});
  const incoming=new T.Mesh(whiteGeometry,whiteMaterial);incoming.frustumCulled=false;beamGroup.add(incoming);

  let p=0,target=0,turn=0,targetTurn=0,angle=-15,targetAngle=-15;
  let raf=0,last=0,visible=true,ready=false,contextLost=false,lastAngle=NaN,lastBeamMobile=null,drag=null,benchmark=null;
  let frameIntervals=[],cpuTimes=[],lastStats=0,renderCount=0,errors=[],lastSequenceLength=0;
  const parts=[],targetPoint=new T.Vector3();
  const copies=[$('.geo-copy'),$('.bridge-copy'),$('.light-copy')];
  const status=$('#asset-status'),sequence=$('.sequence'),angleControl=$('.lens-control');
  const startTime=performance.now();
  let geometryReadyMs=null;
  function request(){if(!raf&&!document.hidden&&visible&&!contextLost)raf=requestAnimationFrame(draw);}
  function resize(){
    const box=canvas.getBoundingClientRect();renderer.setSize(box.width,box.height,false);
    camera.aspect=box.width/box.height;camera.updateProjectionMatrix();
    const nextLength=Math.max(1,sequence.offsetHeight-innerHeight);
    if(lastSequenceLength&&Math.abs(nextLength-lastSequenceLength)>1&&scrollY<=lastSequenceLength+2)window.scrollTo({top:target*nextLength,behavior:'instant'});
    lastSequenceLength=nextLength;request();
  }
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;last=0;if(visible)request();}).observe($('.stage'));
  document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden)benchmark=null;request();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;status.textContent='GRAPHICS PAUSED — RELOAD TO RESTORE';});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());

  function spectralColor(t){return new T.Color().setHSL(.74*(1-t),.9,.57,T.SRGBColorSpace);}
  function updateBeams(degrees){
    const mobile=canvas.clientWidth<=760;
    if(Math.abs(lastAngle-degrees)<.001&&lastBeamMobile===mobile)return;
    lastAngle=degrees;lastBeamMobile=mobile;const radians=degrees*Math.PI/180;prism.rotation.z=radians;
    const rays=Array.from({length:41},(_,i)=>{
      const ray=tracePrism(radians,420+i*6.5);
      // End at the optical study's receiving plane instead of a twelve-unit offscreen streak.
      if(ray.exited){const a=ray.points.at(-2),b=ray.points.at(-1),endX=mobile?1.5:2.3,t=(endX-a[0])/(b[0]-a[0]);ray.points[ray.points.length-1]=[endX,a[1]+(b[1]-a[1])*t];}
      return {ray,color:spectralColor(i/40)};
    });
    const ends=rays.filter(({ray})=>ray.exited).map(({ray})=>ray.points.at(-1));
    const low=Math.min(...ends.map(v=>v[1])),high=Math.max(...ends.map(v=>v[1]));
    receiver.position.set(mobile?1.5:2.3,(low+high)/2,-.055);receiver.scale.y=high-low+.24;
    let n=0,f=0;
    function vertex(array,colors,index,point,color){array.set([point[0],point[1],0],index*3);colors.set([color.r,color.g,color.b],index*3);}
    for(const {ray,color} of rays){
      for(let j=1;j<ray.points.length-1;j++)for(const point of [ray.points[j],ray.points[j+1]])vertex(pathPositions,pathColors,n++,point,color);
    }
    for(let i=0;i<rays.length-1;i++){
      const a=rays[i],b=rays[i+1];if(!a.ray.exited||!b.ray.exited)continue;
      const ae=a.ray.points.at(-2),az=a.ray.points.at(-1),be=b.ray.points.at(-2),bz=b.ray.points.at(-1);
      for(const [point,color] of [[ae,a.color],[az,a.color],[bz,b.color],[ae,a.color],[bz,b.color],[be,b.color]])vertex(fanPositions,fanColors,f++,point,color);
    }
    const entry=rays[20].ray.points[1],start=rays[20].ray.points[0];
    const vertices=[[start[0],start[1]-.018,0],[entry[0],entry[1]-.018,0],[entry[0],entry[1]+.018,0],[start[0],start[1]-.018,0],[entry[0],entry[1]+.018,0],[start[0],start[1]+.018,0]];
    vertices.forEach((v,i)=>whitePositions.set(v,i*3));whiteGeometry.attributes.position.needsUpdate=true;
    pathGeometry.setDrawRange(0,n);fanGeometry.setDrawRange(0,f);
    for(const geometry of [pathGeometry,fanGeometry]){geometry.attributes.position.needsUpdate=true;geometry.attributes.color.needsUpdate=true;}
  }

  const modelPromise=Promise.all([fetchArtifact('./assets/orbit-web/display.json',{json:true}),fetchArtifact('./assets/orbit-web/display.bin.gz')]).then(([meta,raw])=>{
    if(raw.byteLength!==meta.byteLength)throw Error('ORBIT byte length mismatch');
    const materials=new Map(Object.entries(meta.customMaterials).map(([id,m])=>[+id,new T.MeshStandardMaterial({color:new T.Color().setRGB(...m.color),metalness:m.metalness,roughness:Math.max(.26,m.roughness)})]));
    for(const record of meta.meshes){
      const geometry=new T.BufferGeometry();
      geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(raw,record.positions.offset,record.positions.count),3));
      geometry.setAttribute('normal',new T.BufferAttribute(new Float32Array(raw,record.normals.offset,record.normals.count),3));
      geometry.setIndex(new T.BufferAttribute(new Uint32Array(raw,record.indices.offset,record.indices.count),1));
      const mesh=new T.Mesh(geometry,materials.get(record.material));source.add(mesh);
      parts.push({mesh,offset:new T.Vector3(...record.explode)});
    }
    // Normalise in source-local space: the parent has already rotated Z-up to Y-up.
    const bounds=new T.Box3();
    for(const {mesh} of parts){mesh.geometry.computeBoundingBox();bounds.union(mesh.geometry.boundingBox);}
    const size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3()),scale=5.1/Math.max(size.x,size.y,size.z);
    source.scale.setScalar(scale);source.position.copy(center).multiplyScalar(-scale);
    geometryReadyMs=Math.round(performance.now()-startTime);status.textContent='148 ORIGINAL PARTS / STUDIO LOADING';request();
  });
  const environmentPromise=fetchArtifact('./assets/pbr-metal/studio/studio_small_08-1024x512-rgba.f32.gz').then(raw=>{
    if(raw.byteLength!==1024*512*16)throw Error('Studio byte length mismatch');
    const tex=new T.DataTexture(new Float32Array(raw),1024,512,T.RGBAFormat,T.FloatType);tex.mapping=T.EquirectangularReflectionMapping;tex.needsUpdate=true;
    const pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(tex).texture;scene.environmentIntensity=.8;tex.dispose();pmrem.dispose();request();
  }).catch(error=>{errors.push(error.message);});
  Promise.all([modelPromise,environmentPromise]).then(async()=>{
    await renderer.compileAsync(scene,camera);ready=true;status.textContent='148 ORIGINAL PARTS / LIVE GEOMETRY';request();
  }).catch(error=>{errors.push(error.message);status.textContent='MODEL UNAVAILABLE / PROJECT LINKS BELOW';writeStats();});

  function setProgress(value){target=clamp(value);scrub.value=Math.round(target*1000);request();}
  function cancelBenchmark(){if(benchmark){benchmark=null;$('#benchmark-status').textContent='Measurement interrupted by input.';}}
  function scrollProgress(){if(benchmark&&scrollY<2)return;cancelBenchmark();setProgress(scrollY/Math.max(1,sequence.offsetHeight-innerHeight));}
  addEventListener('scroll',scrollProgress,{passive:true});
  scrub.addEventListener('input',()=>{cancelBenchmark();const value=Number(scrub.value)/1000;window.scrollTo({top:value*(sequence.offsetHeight-innerHeight),behavior:'instant'});setProgress(value);});
  function go(value){cancelBenchmark();window.scrollTo({top:value*(sequence.offsetHeight-innerHeight),behavior:reduced?'instant':'smooth'});}
  $('#to-geo').addEventListener('click',()=>go(0));$('#to-light').addEventListener('click',()=>go(1));
  angleInput.addEventListener('input',()=>{cancelBenchmark();targetAngle=Number(angleInput.value);request();});
  // Keep range keyboard navigation inside the instrument, rather than allowing
  // PageUp/Home to move the document and make the optical control inert mid-edit.
  angleInput.addEventListener('keydown',e=>{
    const values={Home:-25,End:-5,PageUp:targetAngle+2,PageDown:targetAngle-2};
    if(!(e.key in values))return;e.preventDefault();cancelBenchmark();targetAngle=clamp(values[e.key],-25,-5);angleInput.value=String(targetAngle);request();
  });
  scrub.addEventListener('keydown',e=>{
    const values={Home:0,End:1,PageUp:target+.1,PageDown:target-.1};
    if(!(e.key in values))return;e.preventDefault();cancelBenchmark();const value=clamp(values[e.key]);window.scrollTo({top:value*(sequence.offsetHeight-innerHeight),behavior:'instant'});setProgress(value);
  });
  function setReduced(value){reduced=value;document.body.classList.toggle('motion-reduced',value);$('#motion').setAttribute('aria-pressed',String(value));request();}
  $('#motion').addEventListener('click',()=>setReduced(!reduced));systemReduced.addEventListener('change',e=>setReduced(e.matches));setReduced(reduced);
  canvas.addEventListener('pointerdown',e=>{cancelBenchmark();drag={x:e.clientX,y:e.clientY,turn:targetTurn,angle:targetAngle};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{
    if(!drag)return;
    const dx=e.clientX-drag.x;if(target>.65)targetAngle=clamp(drag.angle+dx*.045,-25,-5);else targetTurn=clamp(drag.turn+dx*.004,-.65,.65);
    request();
  });
  for(const event of ['pointerup','pointercancel'])canvas.addEventListener(event,()=>{drag=null;});
  canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();cancelBenchmark();const direction=e.key==='ArrowLeft'?-1:1;if(target>.65)targetAngle=clamp(targetAngle+direction,-25,-5);else targetTurn=clamp(targetTurn+direction*.1,-.65,.65);request();});
  $('#benchmark').addEventListener('click',()=>{
    if(!ready){$('#benchmark-status').textContent='Wait for original geometry to finish loading.';return;}
    window.scrollTo({top:0,behavior:'instant'});
    // Start on the next user-visible click after scroll settlement; scroll handler ignores this setup.
    p=target=0;frameIntervals=[];cpuTimes=[];benchmark={start:null};visible=true;last=0;
    $('#benchmark-status').textContent='Running a 10-second forward/reverse sequence.';request();
  });
  function writeStats(){
    const sorted=[...frameIntervals].sort((a,b)=>a-b),cpu=[...cpuTimes].sort((a,b)=>a-b);
    const percentile=(values,q)=>values.length?values[Math.floor((values.length-1)*q)].toFixed(1):'—';
    $('#metrics').textContent=JSON.stringify({sourceParts:148,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometryReadyMs,renderCount,frameSamples:sorted.length,frameMedianMs:percentile(sorted,.5),frameP95Ms:percentile(sorted,.95),cpuP95Ms:percentile(cpu,.95),progress:+p.toFixed(4),prismAngle:+angle.toFixed(2),reducedMotion:reduced,errors},null,2);
  }
  function draw(now){
    raf=0;if(document.hidden||!visible||contextLost){last=0;return;}
    const cpuStart=performance.now(),interval=last?now-last:null,dt=interval?Math.min(interval/1000,.05):1/60;last=now;
    if(benchmark){
      benchmark.start??=now;const t=(now-benchmark.start)/10000;
      target=t<.5?phase(t,0,.5):1-phase(t,.5,1);scrub.value=Math.round(target*1000);
      if(t>=1){target=0;benchmark=null;$('#benchmark-status').textContent='Forward/reverse measurement complete. See raw timings above.';}
    }
    const moving=Math.abs(p-target)>.0002||Math.abs(turn-targetTurn)>.0002||Math.abs(angle-targetAngle)>.001;
    const k=reduced?1:1-Math.exp(-dt*11);
    p+=(target-p)*k;turn+=(targetTurn-turn)*k;angle+=(targetAngle-angle)*k;
    const state=choreography(p),mobile=canvas.clientWidth<=760,narrow=camera.aspect<1.35;
    scene.background.copy(darkBackground).lerp(paperBackground,state.paper);
    const mixInk=(a,b)=>`rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*state.paper)).join(' ')})`;
    document.documentElement.style.setProperty('--paper',mixInk([233,237,228],[40,43,37]));
    document.documentElement.style.setProperty('--muted',mixInk([155,163,155],[75,81,71]));
    document.documentElement.style.setProperty('--accent',mixInk([181,228,196],[52,77,55]));
    for(const part of parts)part.mesh.position.copy(part.offset).multiplyScalar(state.open*.65);
    machine.position.set(-8.2*state.travel,-.3*state.travel,-2.6*state.travel);
    machine.rotation.z=turn*(1-state.travel)+state.open*.18;machine.scale.setScalar(1-state.travel*.35);
    const theta=2.45*(1-state.travel),radius=(mobile?21.5:narrow?14:10.3)+state.travel*(mobile?-8:.4)-Math.sin(Math.PI*state.travel)*(mobile?1:2.4)+(mobile?state.open*3.8:0);
    targetPoint.set((mobile?.65*state.open:narrow?.25:2.5)*(1-state.travel)+(mobile?0:.4)*state.travel,(mobile?.85:narrow?1.35:-.1)*(1-state.travel)+.5*state.travel,0);
    camera.position.set(targetPoint.x+Math.sin(theta)*radius,3.4*(1-state.travel)+.4*state.travel+targetPoint.y,Math.cos(theta)*radius);
    camera.lookAt(targetPoint);
    cameraRight.set(1,0,0).applyQuaternion(camera.quaternion);cameraUp.set(0,1,0).applyQuaternion(camera.quaternion);cameraBack.set(0,0,-1).applyQuaternion(camera.quaternion);
    const unfold=phase(p,.45,.86),radiusIndex=mobile?2.75:narrow?2.4:2.8;
    indexOrigin.copy(machine.position).multiplyScalar(1-unfold).lerp(targetPoint,unfold);
    for(let i=0;i<indexCount;i++){
      const u=i/(indexCount-1),a=u*Math.PI*2+turn*.22,major=i%8===0;
      const x=Math.cos(a)*radiusIndex,y=Math.sin(a)*radiusIndex;
      indexDummy.position.copy(indexOrigin).addScaledVector(cameraRight,x*(1-unfold)+(u-.5)*(mobile?3.5:7.8)*unfold).addScaledVector(cameraUp,y*(1-unfold)+(mobile?-2.75:-2.05)*unfold);
      indexDummy.position.addScaledVector(cameraBack,1.4);
      if(i===0)indexLabelStart.copy(indexDummy.position).addScaledVector(cameraUp,-.16);
      if(i===indexCount-1)indexLabelEnd.copy(indexDummy.position).addScaledVector(cameraUp,-.16);
      indexDummy.quaternion.copy(camera.quaternion);indexDummy.rotateZ((a-Math.PI/2)*(1-unfold));
      const selected=Math.abs(u-.25-turn/(Math.PI*2))<.018;
      indexDummy.scale.set(major?.027:.016,(selected?.31:major?.25:.10)*(1-unfold)+.32*unfold,1);indexDummy.updateMatrix();instrumentIndex.setMatrixAt(i,indexDummy.matrix);
      indexInk.set(selected?0xb5ffaf:major?0xccddc8:0x52645a).lerp(indexPaper,state.paper);
      indexInk.lerp(spectralColor(u),unfold);instrumentIndex.setColorAt(i,indexInk);
    }
    instrumentIndex.instanceMatrix.needsUpdate=true;instrumentIndex.instanceColor.needsUpdate=true;
    // Anchor labels to the actual 3D scale at every aspect ratio.
    camera.updateMatrixWorld();indexLabelStart.project(camera);indexLabelEnd.project(camera);
    wavelengthLegend.style.left=`${Math.max(24,(indexLabelStart.x*.5+.5)*canvas.clientWidth)}px`;
    wavelengthLegend.style.right=`${Math.max(24,(.5-indexLabelEnd.x*.5)*canvas.clientWidth)}px`;
    wavelengthLegend.style.top=`${Math.max((.5-indexLabelStart.y*.5),(.5-indexLabelEnd.y*.5))*canvas.clientHeight+9}px`;
    wavelengthLegend.style.bottom='auto';
    const opticalScale=.02+phase(p,.45,.76)*(mobile?.88:1.28);
    optic.position.set(1.6-state.travel*(mobile?1.85:1.0),.3+state.travel*.25,0);optic.scale.setScalar(opticalScale);optic.visible=p>.52;optic.rotation.set(.12*state.travel,theta*.8-.22*state.travel,.48*state.travel);
    updateBeams(angle);
    // Reveal opaque refractable lettering by scale, never by multiplying it to black:
    // darkening opaque glyphs made an intrusive black billboard during the paper beat.
    const letteringReveal=phase(p,.70,.89);
    lightType.visible=letteringReveal>.001;lightType.position.set(mobile?0:1.0,.65,-1.1);lightType.scale.setScalar(letteringReveal*(mobile?.42:narrow?.72:.9));
    beamGroup.visible=state.optics>.001;fanMaterial.opacity=state.optics*.30;pathMaterial.opacity=state.optics*.12;whiteMaterial.opacity=state.optics*.8;
    key.intensity=2.8-state.travel*1.4;ambient.intensity=.9-state.travel*.55+state.paper*.5;
    opticalKey.intensity=.8+state.optics*1.5;
    const opacities=[state.geoCopy,state.bridgeCopy,state.lightCopy];
    copies.forEach((element,i)=>{element.style.opacity=opacities[i];element.style.transform=`translateY(${(1-opacities[i])*18}px)`;element.inert=opacities[i]<.1;});
    angleControl.style.opacity=state.lightCopy;angleControl.inert=state.lightCopy<.9;
    $('.wavelength-legend').style.opacity=state.lightCopy;
    $('#chapter-status').textContent=p<.15?'SCROLL TO OPEN':p<.48?'01 / INSPECT':p<.75?'GEO → LIGHT':'02 / TURN THE PRISM';
    $('#object-name').textContent=p<.6?`ORBIT / VIEW ${(turn*180/Math.PI).toFixed(0)}°`:'OPTICAL PRISM / DISPERSION';
    $('#gesture').textContent=p<.6?'DRAG TO INSPECT ↔':'DRAG TO REFRACT ↔';
    $('#angle-value').textContent=`${angle.toFixed(1)}°`;angleInput.value=angle.toFixed(1);
    $('#sequence-percent').textContent=`${String(Math.round(p*100)).padStart(3,'0')} / 100`;
    for(const [id,current] of [['#to-geo',p<.6],['#to-light',p>=.6]]){if(current)$(id).setAttribute('aria-current','step');else $(id).removeAttribute('aria-current');}
    renderer.render(scene,camera);renderCount++;
    if(ready&&moving&&interval!==null){frameIntervals.push(interval);cpuTimes.push(performance.now()-cpuStart);if(frameIntervals.length>3000){frameIntervals.shift();cpuTimes.shift();}}
    if(now-lastStats>250||!moving){writeStats();lastStats=now;}
    if(moving||benchmark)request();else last=0;
  }
  resize();scrollProgress();
}
boot().catch(error=>{$('#asset-status').textContent='3D UNAVAILABLE / PROJECT LINKS BELOW';$('#metrics').textContent=error.message;});
