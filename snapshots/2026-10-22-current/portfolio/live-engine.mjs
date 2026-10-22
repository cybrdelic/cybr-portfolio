import * as T from './vendor/three-r180/three.module.min.js';
import {fetchArtifact} from './artifact-fetch.mjs';
import {loadSourceArtifact} from './artifact-designs.mjs?v=4';
import {clamp,mix,percentile} from './live-math.mjs';

const $=s=>document.querySelector(s),canvas=$('#live-canvas'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
const names=['geo','light','elements','song','combat','scenes'];
const chapters=[
 ['GEOMETRY','Built to<br><em>move.</em>','Six systems. One instrument. Take it apart.','Drag to turn the drive','Drive position','Reverse drive ↗','Procedural mechanism · illustrative geometry, not a production CAD assembly'],
 ['LIGHT','Follow<br>the <em>light.</em>','Rotate the optical core. Find another reflection.','Drag to turn the optical core','Optic rotation','Turn the optic ↗','Real-time raster lighting · iridescent surfaces, not spectral path tracing'],
 ['MATTER','Order into<br><em>motion.</em>','A suspended field, disturbed by your touch.','Drag through the particles · click to pulse','Field strength','Disturb field ↗','Live spring particles · not a FLIP fluid solver'],
 ['SOUND','Pull on<br>a <em>note.</em>','A small instrument inside the instrument.','Pluck across the strings · keys 1–9','Pitch register','Play a phrase ↗','Live synthesized strings · audio is opt-in'],
 ['MOVEMENT','A body<br>in <em>balance.</em>','The original Combat avatar, held for inspection.','Drag to orbit the avatar','Viewing angle','Turn around ↗','Original CYBR Combat mesh · static source pose, not a live fight'],
 ['ENVIRONMENTS','Worlds<br><em>within.</em>','Desert Hot Springs, lifted out of its frame.','Drag to orbit the terrain','Water level','Orbit terrain ↗','Original terrain and water meshes · real-time raster study']
];
let renderer;
try{renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});}catch(e){$('#runtime-status').textContent=e.message;throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x232220,0);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
const scene=new T.Scene(),camera=new T.PerspectiveCamera(32,1,.1,100);camera.position.set(4,3,10);
scene.add(new T.HemisphereLight(0xffeee0,0x353b4b,2.1));
for(const [color,power,pos] of [[0xffd3b5,4,[-4,5,6]],[0xb4d2e4,3,[6,0,4]],[0xff9c73,2,[0,-4,-3]]]){const light=new T.DirectionalLight(color,power);light.position.set(...pos);scene.add(light);}
const shell=new T.MeshStandardMaterial({color:0x303238,metalness:.75,roughness:.32});
const edge=new T.MeshStandardMaterial({color:0x797b7e,metalness:.85,roughness:.29});
const copper=new T.MeshStandardMaterial({color:0xf19b77,metalness:.6,roughness:.26,emissive:0x532016,emissiveIntensity:.25});
const black=new T.MeshStandardMaterial({color:0x111319,metalness:.4,roughness:.4});
const accent=new T.MeshStandardMaterial({color:0xefa388,emissive:0xfaa98c,emissiveIntensity:1.6,roughness:.4});
const core=new T.Group();scene.add(core);const modules=names.map(name=>{const group=new T.Group();group.name=name;core.add(group);return group;});
const boxGeo=new T.BoxGeometry(1,1,1),cylinderGeo=new T.CylinderGeometry(1,1,1,32),torusCache=new Map();
const movers=[],shells=[],sources={},errors=[],counts=new Uint32Array(6),actions=new Uint32Array(6),drawCosts=[],frameTimes=[];
function box(group,x,y,z,sx,sy,sz,material=shell){const mesh=new T.Mesh(boxGeo,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);group.add(mesh);return mesh;}
function cylinder(group,r,depth,z,material=shell){const mesh=new T.Mesh(cylinderGeo,material);mesh.rotation.x=Math.PI/2;mesh.scale.set(r,depth,r);mesh.position.z=z;group.add(mesh);return mesh;}
function ring(group,r,tube,z,material=edge){const key=`${r}/${tube}`;if(!torusCache.has(key))torusCache.set(key,new T.TorusGeometry(r,tube,6,80));const mesh=new T.Mesh(torusCache.get(key),material);mesh.position.z=z;group.add(mesh);return mesh;}
function radial(group,count,r,z,size,material,phase=0){const mesh=new T.InstancedMesh(boxGeo,material,count),dummy=new T.Object3D();for(let i=0;i<count;i++){const a=i/count*Math.PI*2+phase;dummy.position.set(Math.cos(a)*r,Math.sin(a)*r,z);dummy.rotation.z=a;dummy.scale.set(...size);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}group.add(mesh);return mesh;}
function segment(group,r,depth,start,arc,material){
 const shape=new T.Shape(),inner=r-.14;shape.absarc(0,0,r,start,start+arc,false);shape.lineTo(Math.cos(start+arc)*inner,Math.sin(start+arc)*inner);shape.absarc(0,0,inner,start+arc,start,true);shape.closePath();
 const geo=new T.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:.015,bevelSize:.015,bevelSegments:1,curveSegments:24});const m=new T.Mesh(geo,material);m.position.z=-depth/2;group.add(m);return m;
}
// The same machined vocabulary is used throughout; fasteners and vents are instanced.
for(const [index,group] of modules.entries()){
 ring(group,1.28,.035,-.22);ring(group,1.28,.035,.22);ring(group,1.14,.018,.24,black);
 radial(group,64,1.24,.19,[.07,.024,.065],edge);radial(group,12,1.2,-.22,[.075,.045,.075],black);
 for(let j=0;j<4;j++){
  const panel=segment(group,1.33,.34,j*Math.PI/2+.10,Math.PI/2-.22,shell);shells.push({mesh:panel,index,angle:j*Math.PI/2+.7});
  segment(group,1.355,.028,j*Math.PI/2+.10,Math.PI/2-.26,j===index%4?copper:edge).position.z=.19;
 }
}
// GEO: three genuinely linked rotors and an exposed belt around the outer drive.
const drive=new T.Group();modules[0].add(drive);
for(let i=0;i<3;i++){const a=i*Math.PI*2/3,gear=new T.Group();gear.position.set(Math.cos(a)*.62,Math.sin(a)*.62,0);drive.add(gear);cylinder(gear,.34,.12,0,black);ring(gear,.27,.032,.09,copper);radial(gear,24,.35,.04,[.06,.045,.10],edge);radial(gear,6,.19,.11,[.14,.03,.02],edge);movers.push(gear);}
cylinder(drive,.23,.32,0,black);ring(drive,.23,.03,.17,copper);radial(drive,18,.25,.17,[.045,.045,.07],edge);ring(modules[0],1.02,.032,.1,copper);radial(modules[0],90,1.06,.02,[.06,.022,.16],black);
// LIGHT: surface optics remain view dependent, with restrained material complexity.
const optical=new T.Group();modules[1].add(optical);
const opticMat=new T.MeshPhysicalMaterial({color:0x98acba,metalness:.95,roughness:.13,iridescence:1,iridescenceIOR:1.65,iridescenceThicknessRange:[170,500],clearcoat:1});
const optic=new T.Mesh(new T.IcosahedronGeometry(.8,1),opticMat);optical.add(optic);ring(optical,.96,.035,0,copper).rotation.y=.4;ring(optical,1.03,.02,0,edge).rotation.x=1.2;
for(let i=0;i<5;i++){const blade=segment(optical,.87-i*.1,.035,.2+i*.8,2.9,i%2?opticMat:edge);blade.position.z=.1+i*.04;}
// ELEMENTS: bounded, live spring simulation on the GPU-friendly instance buffer.
const matter=new T.InstancedMesh(new T.IcosahedronGeometry(.027,0),new T.MeshStandardMaterial({color:0x9bc7b6,metalness:.28,roughness:.3}),500);modules[2].add(matter);
const particles=Array.from({length:500},(_,i)=>{const a=i*2.39996,z=(i/499-.5)*1.7,r=Math.sqrt(Math.max(0,.78-z*z));return {base:new T.Vector3(Math.cos(a)*r,Math.sin(a)*r,z),p:new T.Vector3(Math.cos(a)*r,Math.sin(a)*r,z),v:new T.Vector3()};});
ring(modules[2],.96,.02,0,edge).rotation.y=1.3;
// SONG: nine independently plucked strings and tuned bridge pieces.
const stringPositions=new Float32Array(9*65*3),stringEnergy=new Float32Array(9),stringPhase=new Float32Array(9),strings=[];
for(let i=0;i<9;i++){
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(stringPositions.subarray(i*195,(i+1)*195),3));const string=new T.Line(geometry,new T.LineBasicMaterial({color:i%2?0xf4cf98:0xdcae7c}));strings.push(string);modules[3].add(string);const x=(i-4)*.20;box(modules[3],x,.91,0,.09,.16,.17,copper);box(modules[3],x,-.91,0,.09,.16,.17,edge);
}
box(modules[3],0,1.02,0,1.9,.12,.2,black);box(modules[3],0,-1.02,0,1.9,.12,.2,black);
// Original source meshes are loaded only once, not reconstructed from photographs.
async function source(name,index){
 try{
  const wrapper=new T.Group();const model=await loadSourceArtifact(name,'hero',wrapper);
  // The retained water export includes a deep volume skirt. This open study shows
  // its upper surface, not a hanging cylinder under the landscape.
  if(name==='scenes')model.traverse(o=>{if(!o.isMesh||!o.material.transmission)return;const g=o.geometry,p=g.attributes.position,indices=g.index,keep=[],a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),ab=new T.Vector3(),ac=new T.Vector3();g.computeBoundingBox();const cutoff=(g.boundingBox.min.z+g.boundingBox.max.z)/2;
   for(let i=0;i<indices.count;i+=3){const ia=indices.getX(i),ib=indices.getX(i+1),ic=indices.getX(i+2);a.fromBufferAttribute(p,ia);b.fromBufferAttribute(p,ib);c.fromBufferAttribute(p,ic);ab.subVectors(b,a);ac.subVectors(c,a);ab.cross(ac).normalize();if(Math.abs(ab.z)>.65&&(a.z+b.z+c.z)/3>cutoff)keep.push(ia,ib,ic);}
   if(keep.length){g.setIndex(keep);g.boundingBox.makeEmpty();for(const i of keep)g.boundingBox.expandByPoint(a.fromBufferAttribute(p,i));g.boundingSphere=g.boundingBox.getBoundingSphere(new T.Sphere());}
  });
  model.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(model),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
  const pivot=new T.Group(),normalizer=new T.Group();normalizer.add(model);normalizer.position.copy(center).multiplyScalar(-1);pivot.add(normalizer);const s=(name==='combat'?1.8:1.95)/Math.max(size.x,size.y,size.z);pivot.scale.setScalar(s);pivot.rotation.x=name==='scenes'?-.75:-Math.PI/2;
  model.traverse(object=>{if(object.isMesh){object.castShadow=false;object.receiveShadow=false;if(object.material.transmission){object.material.transmission=0;object.material.transparent=true;object.material.opacity=.78;object.material.depthWrite=false;object.material.color.set(0x6ba5a5);}else{object.material.roughness=.65;}}});
  modules[index].add(pivot);sources[name]={pivot,model,loaded:true};status();request();
 }catch(e){errors.push(`${name}: ${e.message}`);status();}
}
void source('combat',4);void source('scenes',5);
// Studio reflections are an optional enhancement, never a prerequisite for geometry.
fetchArtifact('./assets/pbr-metal/studio/studio_small_08-1024x512-rgba.f32.gz').then(data=>{
 if(data.byteLength!==1024*512*16)throw Error('Studio length mismatch');const tex=new T.DataTexture(new Float32Array(data),1024,512,T.RGBAFormat,T.FloatType);tex.mapping=T.EquirectangularReflectionMapping;tex.needsUpdate=true;
 const generator=new T.PMREMGenerator(renderer),target=generator.fromEquirectangular(tex);scene.environment=target.texture;scene.environmentIntensity=.65;generator.dispose();tex.dispose();status();request();
}).catch(e=>{errors.push(`Studio: ${e.message}`);status();});

let active=0,progress=0,targetProgress=0,time=0,last=0,raf=0,paused=reduced.matches,parameter=50,driveDirection=1,drag=false,lastX=0,turn=0,targetTurn=0,fieldKick=0;
let audio=null,sound=false,frames=0,measurement=null,measured=null,contextLost=false;
const dummy=new T.Object3D(),look=new T.Vector3(),layout={explode:0,focus:0},raycaster=new T.Raycaster(),mouse=new T.Vector2(),pointer=new T.Vector3(9,9,9);
function status(){
 $('#runtime-status').textContent=errors.length?errors.join('\n'):`WebGL active · ${Object.keys(sources).length}/2 original source meshes loaded`;
 $('#retry').hidden=!errors.length;$('#runtime-metrics').textContent=JSON.stringify({chapter:names[active],frames,paused,sound,sourceMeshes:Object.keys(sources),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,cpuP95Ms:+percentile(drawCosts,.95).toFixed(2),frameP95Ms:+percentile(frameTimes,.95).toFixed(2),chapterFrames:Array.from(counts),interactions:Array.from(actions),measurement:measured,errors},null,2);
}
function request(){if(!raf&&!document.hidden&&!contextLost)raf=requestAnimationFrame(draw);}
function geometry(dt){
 for(let i=0;i<movers.length;i++)movers[i].rotation.z=-(time*.18*driveDirection+parameter/100*Math.PI*2)*1.5;drive.rotation.z=time*.035*driveDirection+targetTurn*.12;
 optical.rotation.y=turn*.4+parameter*.012;optical.rotation.z=time*.035;
 fieldKick*=Math.exp(-3*dt);for(let i=0;i<particles.length;i++){
  const p=particles[i],a=time*.4+i*.09,wave=Math.sin(a)*(.045+parameter*.001),target=p.base.clone().multiplyScalar(1+wave+fieldKick*.4),distance=p.p.distanceTo(pointer);
  if(distance<.55)target.add(p.p.clone().sub(pointer).normalize().multiplyScalar((.55-distance)*1.5));
  p.v.addScaledVector(target.sub(p.p),32*dt).multiplyScalar(Math.exp(-7*dt));p.p.addScaledVector(p.v,dt);dummy.position.copy(p.p);dummy.rotation.set(a*.1,a*.13,0);dummy.scale.setScalar(1);dummy.updateMatrix();matter.setMatrixAt(i,dummy.matrix);
 }matter.instanceMatrix.needsUpdate=true;
 for(let i=0;i<9;i++){stringEnergy[i]*=Math.exp(-2.6*dt);stringPhase[i]+=dt*35;const position=strings[i].geometry.attributes.position;for(let j=0;j<65;j++){const u=j/64;position.setXYZ(j,(i-4)*.2+Math.sin(u*Math.PI)*Math.sin(stringPhase[i]-u*10)*stringEnergy[i]*.1,-.88+u*1.76,0);}position.needsUpdate=true;}
 if(sources.combat)sources.combat.pivot.rotation.z=active===4?turn+parameter*.04:0;
 if(sources.scenes){sources.scenes.pivot.rotation.z=turn*.4;sources.scenes.model.traverse(o=>{if(o.isMesh&&o.material.transparent)o.position.z=active===5?(parameter-50)*.06:0;});}
}
function compose(dt){
 // One persistent construction opens into a row, then each module rises in turn.
 const p=progress,opening=clamp(p/.72),ease=opening*opening*(3-2*opening),focus=clamp((p-.5)/.3);layout.explode=ease;layout.focus=focus;
 const continuous=clamp(p,0,5),targetX=(continuous-2.5)*2.75;
 for(let i=0;i<6;i++){
  const g=modules[i],weight=Math.max(0,1-Math.abs(i-continuous));
  g.position.set(mix(0,(i-2.5)*2.75,ease),focus*weight*.2,mix((2.5-i)*.48,0,ease));
  g.rotation.y=mix(0,Math.sin(i*1.4)*.13,ease);g.scale.setScalar(1);
 }
 for(const {mesh,index,angle} of shells){const exposure=ease*Math.max(0,1-Math.abs(index-continuous));mesh.position.x=Math.cos(angle)*exposure*.22;mesh.position.y=Math.sin(angle)*exposure*.22;}
 const aspect=camera.aspect,small=aspect<1;const distance=mix(small?8.8:7.0,small?9.6:8.6,focus);
 look.set(targetX*ease,0,0);camera.position.set(look.x+mix(3.4,.5,focus)+turn*.13,mix(2.3,.9,focus),distance);camera.lookAt(look);
 core.rotation.z=mix(-.24,0,ease);core.rotation.y=mix(-.22,0,ease);
}
function draw(now){
 raf=0;const start=performance.now(),elapsed=last?now-last:0,dt=paused?0:Math.min(elapsed/1000||1/60,.035);last=now;if(elapsed>0&&elapsed<250){frameTimes.push(elapsed);if(frameTimes.length>180)frameTimes.shift();}
 if(!paused)time+=dt;progress=mix(progress,targetProgress,paused?1:1-Math.exp(-dt*14));chapter(Math.round(progress));turn=mix(turn,targetTurn,paused?1:1-Math.exp(-dt*12));geometry(dt);compose(dt);renderer.render(scene,camera);frames++;counts[active]++;
 const cost=performance.now()-start;drawCosts.push(cost);if(drawCosts.length>180)drawCosts.shift();
 if(measurement){measurement.cpu.push(cost);if(elapsed>0)measurement.intervals.push(elapsed);if(now>=measurement.until){measured={chapter:names[active],samples:measurement.intervals.length,cpuP95Ms:percentile(measurement.cpu,.95),frameP95Ms:percentile(measurement.intervals,.95)};measurement=null;$('#measure').textContent='Measure next 3 seconds';status();}}
 if(frames%40===0||paused)status();if(!paused||measurement)request();
}
function chapter(i){if(i===active&&frames)return;active=i;parameter=50;const c=chapters[i];$('#chapter-number').textContent=`0${i+1}`;$('#category').textContent=c[0];$('#headline').innerHTML=c[1];$('#intro').textContent=c[2];$('#gesture-text').textContent=c[3];$('#parameter-label').textContent=c[4];$('#parameter').value=50;$('#parameter-value').textContent=50;$('#action').textContent=c[5];$('#provenance').textContent=c[6];$('#project-link').href=`${names[i]}.html`;$('#project-link').innerHTML=`Explore CYBR ${names[i].toUpperCase()} <span>↗</span>`;canvas.setAttribute('aria-label',`${c[0]} live 3D study. ${c[3]}. Keyboard alternatives below.`);for(const [n,a] of [...document.querySelectorAll('.chapters a')].entries()){if(n===i)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}request();}
function resize(){const r=canvas.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();request();}
function scroll(){targetProgress=clamp(scrollY/innerHeight,0,5);request();}
function pluck(index){stringEnergy[index]=1;actions[3]++;request();if(!sound||!audio)return;const frequencies=[130.81,146.83,164.81,196,220,261.63,293.66,329.63,392],at=audio.currentTime,osc=audio.createOscillator(),gain=audio.createGain();osc.type='triangle';osc.frequency.value=frequencies[index]*2**((parameter-50)/50);gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.06,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+1.3);osc.connect(gain).connect(audio.destination);osc.start();osc.stop(at+1.4);osc.onended=()=>{osc.disconnect();gain.disconnect();};}
function locate(e){const r=canvas.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(mouse,camera);const plane=new T.Plane(new T.Vector3(0,0,1),0),hit=new T.Vector3();if(raycaster.ray.intersectPlane(plane,hit))pointer.copy(modules[active].worldToLocal(hit));}
canvas.onpointerdown=e=>{drag=true;lastX=e.clientX;canvas.setPointerCapture(e.pointerId);actions[active]++;locate(e);if(active===2)fieldKick=1;if(active===3)pluck(clamp(Math.round(pointer.x/.2+4),0,8));request();};
canvas.onpointermove=e=>{locate(e);if(drag){targetTurn+=(e.clientX-lastX)*.015;lastX=e.clientX;if(active===3){const i=clamp(Math.round(pointer.x/.2+4),0,8);if(stringEnergy[i]<.3)pluck(i);}}request();};
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>{drag=false;};canvas.onpointerleave=()=>{pointer.set(9,9,9);};
canvas.onkeydown=e=>{if(active===3&&/^[1-9]$/.test(e.key)){e.preventDefault();pluck(+e.key-1);}if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();targetTurn+=e.key==='ArrowRight'?.2:-.2;actions[active]++;request();}};
$('#parameter').oninput=e=>{parameter=+e.target.value;$('#parameter-value').textContent=parameter;actions[active]++;request();};
$('#action').onclick=()=>{actions[active]++;if(active===0)driveDirection*=-1;else if(active===2)fieldKick=1;else if(active===3)[0,2,4,6,8].forEach((n,i)=>setTimeout(()=>{if(active===3&&!document.hidden)pluck(n);},i*120));else{targetTurn+=Math.PI/2;if(active===1)parameter=(parameter+30)%100;$('#parameter').value=parameter;$('#parameter-value').textContent=parameter;}request();};
$('#sound').onclick=async()=>{try{audio??=new AudioContext();sound=!sound;if(sound)await audio.resume();else await audio.suspend();$('#sound').textContent=sound?'Sound on':'Sound off';$('#sound').setAttribute('aria-pressed',String(sound));status();}catch(e){errors.push(`Audio: ${e.message}`);status();}};
$('#pause').onclick=()=>{paused=!paused;$('#pause').textContent=paused?'Resume motion':'Pause motion';$('#pause').setAttribute('aria-pressed',String(paused));last=0;request();};
$('#measure').onclick=()=>{measurement={until:performance.now()+3000,cpu:[],intervals:[]};last=0;$('#measure').textContent='Measuring…';request();};
$('#retry').onclick=()=>{errors.length=0;for(const [name,i] of [['combat',4],['scenes',5]])if(!sources[name])void source(name,i);};
window.addEventListener('scroll',scroll,{passive:true});window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;audio?.suspend();}else{if(sound)audio?.resume();request();}});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;cancelAnimationFrame(raf);raf=0;errors.push('Graphics context lost. Reload to restore.');status();});
reduced.addEventListener('change',()=>{paused=reduced.matches;$('#pause').textContent=paused?'Resume motion':'Pause motion';$('#pause').setAttribute('aria-pressed',String(paused));request();});
if(paused){$('#pause').textContent='Resume motion';$('#pause').setAttribute('aria-pressed','true');}
chapter(0);resize();scroll();
