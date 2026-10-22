import * as T from './vendor/three-r180/three.module.min.js';
import {createSongAsset} from './direction14-song-asset.mjs';
import {createSplashAsset} from './direction14-splash-asset.mjs';
import {createEventStudio} from './event-studio.mjs';
import {loadFluid} from './instrument-fluid.js';
const kind=new URLSearchParams(location.search).get('asset'),fluidMode=kind==='fluid',water=kind==='water'||fluidMode;
const canvas=document.querySelector('canvas'),renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=T.ACESFilmicToneMapping;
const scene=new T.Scene(),camera=new T.OrthographicCamera(),asset=fluidMode?{root:new T.Group()}:water?createSplashAsset():createSongAsset();scene.add(asset.root);
let fluid;
if(water){scene.environment=createEventStudio(T,renderer).texture;const back=new T.Mesh(new T.PlaneGeometry(80,80),new T.MeshBasicMaterial({color:0x7c160c}));back.position.z=-6;scene.add(back);const floor=new T.Mesh(new T.PlaneGeometry(50,50),new T.MeshPhysicalMaterial({color:0x84180e,roughness:.2,metalness:0,clearcoat:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-2.03;scene.add(floor);document.querySelector('h1').innerHTML='Elements<br>move through it.';document.querySelector('.number').textContent='04';}
scene.add(new T.HemisphereLight(0xffffff,0xc88b65,2.4));const light=new T.DirectionalLight(0xffffff,3);light.position.set(-3,8,10);scene.add(light);
camera.position.set(0,0,18);camera.lookAt(0,0,0);camera.near=.1;camera.far=100;
let running=false,raf=0,last=0,count=0,total=0;
function render(time=0){raf=0;asset.root.rotation.y=(water?-.35:0)+(running?Math.sin(time*.0003)*.045:0);asset.root.position.y=(water?-2:0)+(running?Math.sin(time*.0004)*.04:0);if(fluid&&running)fluid.setProgress((time*.00018)%1);const start=performance.now();renderer.render(scene,camera);total+=performance.now()-start;count++;if(time-last>500||!running){document.querySelector('#metrics').textContent=JSON.stringify({...asset.root.userData,fluid:fluid?.snapshot(),drawCalls:renderer.info.render.calls,renderedTriangles:renderer.info.render.triangles,cpuSubmissionMeanMs:+(total/count).toFixed(3),note:'CPU submission only; not GPU duration. Solid meshes, no sprite or image planes.'},null,2);last=time;}if(running&&!raf)raf=requestAnimationFrame(render);}
function resize(){const w=canvas.clientWidth,h=canvas.clientHeight;renderer.setSize(w,h,false);const height=water?6.8:Math.max(9,15*h/w);camera.left=-height*w/h/2;camera.right=height*w/h/2;camera.top=height/2;camera.bottom=-height/2;camera.updateProjectionMatrix();asset.root.position.x=water?1:1.2;render();}
new ResizeObserver(resize).observe(canvas);document.querySelector('#motion').onclick=e=>{running=!running;e.target.textContent=running?'Pause motion':'Play motion';if(!raf)render();};
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else if(running)render();});
document.querySelector('#status').textContent=water?'New crown key-pose mesh · not a fluid simulation':'New solid score · 3 draw calls';
if(fluidMode){const container=new T.Group();container.rotation.x=-Math.PI/2;container.scale.setScalar(.05);asset.root.add(container);loadFluid(container,()=>{if(!raf)raf=requestAnimationFrame(render);},{base:'./assets/direction14-flip-v2/',initialFrame:8,cacheFrames:24}).then(f=>{fluid=f;f.mesh.material.side=T.FrontSide;f.mesh.material.transparent=false;f.mesh.material.depthWrite=true;f.mesh.material.thickness=.1;f.mesh.material.attenuationColor.set(0xffffff);f.mesh.material.attenuationDistance=100;document.querySelector('#status').textContent=`CYBR FLIP · ${f.frameCount} baked mesh frames`;render();}).catch(e=>{document.querySelector('#status').textContent=e.message;});}
