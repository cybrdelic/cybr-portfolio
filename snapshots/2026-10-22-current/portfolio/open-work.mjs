import * as T from './vendor/three-r180/three.module.min.js';
import {fetchArtifact} from './artifact-fetch.mjs';
const $=s=>document.querySelector(s),canvas=$('#mechanism'),slider=$('#assembly'),status=$('#load-status');
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),clamp=v=>Math.max(0,Math.min(1,v));
async function start(){
const renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.setClearColor(0,0);
const scene=new T.Scene(),camera=new T.PerspectiveCamera(32,1,.01,100),pivot=new T.Group(),model=new T.Group();scene.add(pivot);pivot.add(model);
scene.add(new T.HemisphereLight(0xffffff,0xa9a594,1.3));
for(const [p,intensity] of [[[3,5,5],2],[[-4,2,-3],1],[[1,-3,4],.6]]){const l=new T.DirectionalLight(0xffffff,intensity);l.position.set(...p);scene.add(l);}
let target=0,opening=0,turn=0,targetTurn=0,drag=false,lastX=0,raf=0,last=0,ready=false,visible=true,frameTimes=[],frames=0;
const parts=[];const started=performance.now();
function request(){if(!raf&&!document.hidden&&visible)raf=requestAnimationFrame(draw);}
function resize(){const r=canvas.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();request();}
new ResizeObserver(resize).observe(canvas);
const source='./assets/orbit-web/display';
Promise.all([fetchArtifact(source+'.json',{json:true}),fetchArtifact(source+'.bin.gz')]).then(([meta,raw])=>{
 if(raw.byteLength!==meta.byteLength)throw Error('Geometry length mismatch');
 const materials=new Map(Object.entries(meta.customMaterials).map(([id,m])=>[+id,new T.MeshStandardMaterial({color:new T.Color().setRGB(...m.color),metalness:m.metalness,roughness:Math.max(.25,m.roughness)})]));
 for(const m of meta.meshes){const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(raw,m.positions.offset,m.positions.count),3));g.setAttribute('normal',new T.BufferAttribute(new Float32Array(raw,m.normals.offset,m.normals.count),3));g.setIndex(new T.BufferAttribute(new Uint32Array(raw,m.indices.offset,m.indices.count),1));g.computeBoundingBox();const mesh=new T.Mesh(g,materials.get(m.material));mesh.name=m.name;model.add(mesh);parts.push({mesh,offset:new T.Vector3(...m.explode)});}
 const bounds=new T.Box3().setFromObject(model),center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3()),scale=4.9/Math.max(size.x,size.y,size.z);
 model.scale.setScalar(scale);model.position.copy(center).multiplyScalar(-scale);pivot.rotation.set(-Math.PI/2,0,0);
 ready=true;status.textContent='ORBIT / 148 ORIGINAL CYBR GEO PARTS';$('#metrics').textContent=`Original geometry ready in ${Math.round(performance.now()-started)} ms. ${parts.length} draw batches. Drag or scroll to measure motion.`;request();
}).catch(e=>{status.textContent='MODEL UNAVAILABLE — PROJECT ARCHIVE STILL OPEN';$('#metrics').textContent=e.message;});
fetchArtifact('./assets/pbr-metal/studio/studio_small_08-1024x512-rgba.f32.gz').then(raw=>{const tex=new T.DataTexture(new Float32Array(raw),1024,512,T.RGBAFormat,T.FloatType);tex.mapping=T.EquirectangularReflectionMapping;tex.needsUpdate=true;const pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(tex).texture;scene.environmentIntensity=.8;tex.dispose();pmrem.dispose();request();}).catch(()=>{status.textContent+=' / DIRECT LIGHTING';});
function setTarget(v){target=clamp(v);slider.value=Math.round(target*100);$('#assembly-value').textContent=String(Math.round(target*100)).padStart(2,'0')+'%';request();}
slider.addEventListener('input',()=>setTarget(Number(slider.value)/100));
addEventListener('scroll',()=>setTarget(scrollY/Math.max(1,$('.opening').offsetHeight-innerHeight)),{passive:true});
canvas.addEventListener('pointerdown',e=>{drag=true;lastX=e.clientX;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(drag){targetTurn+=(e.clientX-lastX)*.008;lastX=e.clientX;request();}});
for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,()=>drag=false);
canvas.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();targetTurn+=(e.key==='ArrowLeft'?-.2:.2);request();}});
new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)request();}).observe($('.stage'));
document.addEventListener('visibilitychange',()=>{last=0;request();});
function draw(now){raf=0;const interval=last?now-last:null;const dt=interval?Math.min(interval/1000,.05):1/60;const moving=Math.abs(opening-target)>.0003||Math.abs(turn-targetTurn)>.0003;last=now;const k=reduced.matches?1:1-Math.exp(-dt*10);opening+=(target-opening)*k;turn+=(targetTurn-turn)*k;
 const eased=opening*opening*(3-2*opening);for(const p of parts)p.mesh.position.copy(p.offset).multiplyScalar(eased);
 pivot.rotation.z=turn-eased*.4;camera.position.set(5.4+eased*1.8,3.5+eased*1.8,-6.5-eased*2).multiplyScalar(Math.max(1,1.2/camera.aspect));camera.lookAt(0,0,0);
 $('h1').style.transform=`translateY(${-eased*60}px)`;$('h1').style.opacity=1-clamp(eased*2);$('.opened-note').style.opacity=clamp((eased-.55)*3);$('.marginal').style.opacity=1-clamp(eased*2);$('.marginal').inert=eased>.5;renderer.render(scene,camera);
 if(moving&&interval!==null){frameTimes.push(interval);if(frameTimes.length>240)frameTimes.shift();}if(++frames%20===0&&ready){const ordered=[...frameTimes].sort((a,b)=>a-b);$('#metrics').textContent=`Original ORBIT parts: 148\nLossless draw batches: ${parts.length}\nTriangles: ${renderer.info.render.triangles.toLocaleString()}\nDraw calls: ${renderer.info.render.calls}\nMotion frame interval p95: ${ordered.length?ordered[Math.floor((ordered.length-1)*.95)].toFixed(1):'—'} ms (${ordered.length} samples)\nRenders only on interaction; pauses offscreen.\nRaster studio lighting; not path traced.`;}
 if(moving)request();else last=0;
}
document.querySelectorAll('.index details').forEach(item=>item.addEventListener('toggle',()=>{if(item.open)document.querySelectorAll('.index details').forEach(other=>{if(other!==item)other.open=false;});}));
resize();
}
start().catch(error=>{status.textContent='3D UNAVAILABLE — OPEN THE PROJECT INDEX BELOW';$('#metrics').textContent=error.message;});
