import * as THREE from './vendor/three-r180/three.module.min.js';
import {PROJECT_STOPS} from './instrument-interface.mjs';

const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{value=clamp(value);return value*value*(3-2*value);};
const mix=(a,b,t)=>a+(b-a)*t;
// Equal page space for each project, with a shorter assembly/approach prelude.
// The physical CAD coordinate and existing chapter destinations stay intact.
export const MOBILE_PAGE_STOPS=[
  {page:0,pose:0},{page:.07,pose:.035},{page:.19,pose:.28},
  ...PROJECT_STOPS.map((project,index)=>({page:.27+.12*index,pose:project.at})),
  {page:.94,pose:.90},{page:1,pose:1}
];
function remap(value,from,to){
  value=clamp(value);
  const next=MOBILE_PAGE_STOPS.findIndex(stop=>stop[from]>=value);
  if(next<=0)return MOBILE_PAGE_STOPS[0][to];
  const a=MOBILE_PAGE_STOPS[next-1],b=MOBILE_PAGE_STOPS[next];
  return mix(a[to],b[to],(value-a[from])/(b[from]-a[from]));
}
export const mobilePageToPose=value=>remap(value,'page','pose');
export const mobilePoseToPage=value=>remap(value,'pose','page');

export function mobileCameraFrame(motion,progress,aspect){
  const p=clamp(progress),whole=motion.cameraFrame();
  const views=PROJECT_STOPS.map(project=>({...motion.cameraFrame(project.name),name:project.name,at:project.at}));
  const stops=[{...whole,name:null,at:.28},...views,{...views.at(-1),at:.90},{...whole,name:null,at:1}];
  let index=stops.findIndex(stop=>stop.at>=p);if(index<0)index=stops.length-1;
  const a=stops[Math.max(0,index-1)],b=stops[index];
  const t=a===b?0:smooth((p-a.at)/(b.at-a.at));
  const bounds=new THREE.Box3(a.bounds.min.clone().lerp(b.bounds.min,t),a.bounds.max.clone().lerp(b.bounds.max,t));
  const center=bounds.getCenter(new THREE.Vector3()),span=bounds.getSize(new THREE.Vector3());
  const overview=p<=.28?1:p<.49?1-smooth((p-.28)/.21):p>.90?smooth((p-.90)/.10):0;
  const portrait=clamp((1.05-aspect)/.48);
  const direction=new THREE.Vector3(50,-80,50).normalize();
  const distance=Math.max(220,span.length()*3);
  const active=PROJECT_STOPS.reduce((best,project,i)=>Math.abs(project.at-p)<Math.abs(PROJECT_STOPS[best].at-p)?i:best,0);
  return {bounds,look:center,eye:center.clone().addScaledVector(direction,distance),
    roll:-Math.PI*.32*portrait*overview||0,perspectiveBlend:1-overview,occupancy:mix(.80,.86,overview),active,overview};
}

// Fit the actual conservative CAD envelope in the current rolled camera.
// This is camera framing, with the original mesh and pixel density retained.
export function fitMobileView(camera,bounds,aspect,perspectiveBlend,distance,occupancy=.80){
  if(!(aspect>0&&distance>0&&occupancy>0&&occupancy<1))throw Error('Invalid mobile camera fit');
  camera.updateMatrixWorld();let required=1;
  for(const x of[bounds.min.x,bounds.max.x])for(const y of[bounds.min.y,bounds.max.y])for(const z of[bounds.min.z,bounds.max.z]){
    const point=new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse);
    const denominator=1-perspectiveBlend+perspectiveBlend*Math.max(.001,-point.z)/distance;
    required=Math.max(required,2*Math.abs(point.y)/denominator/occupancy,2*Math.abs(point.x)/denominator/aspect/occupancy);
  }
  return required;
}
