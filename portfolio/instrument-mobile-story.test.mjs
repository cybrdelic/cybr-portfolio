import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {PROJECT_STOPS} from './instrument-interface.mjs';
import {MOBILE_PAGE_STOPS,mobilePageToPose,mobilePoseToPage,mobileCameraFrame,fitMobileView} from './instrument-mobile-story.mjs';
import {createScrollTour} from './instrument-scroll-tour.mjs';

test('opening copy retains its sentence separator when the wide layout hides its line break',()=>{
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  const heading=html.match(/<div class="mobile-intro">[\s\S]*?<h2>(.*?)<\/h2>/)?.[1];
  assert.ok(heading,'the mobile opening heading exists');
  assert.equal(heading.replace(/<br\s*\/?\s*>/gi,'').replace(/\s+/g,' ').trim(),'Six systems. One instrument.');
});

test('runtime prelude updates preserve word separators for wide layouts after loading and scroll changes',()=>{
  const source=readFileSync(new URL('./instrument-3d.js',import.meta.url),'utf8');
  const expression=source.match(/mobileIntro\.querySelector\('h2'\)\.innerHTML=(.*?);/)?.[1];
  assert.ok(expression,'the actual runtime heading assignment exists');
  for(const [p,preview,expected]of[[0,false,'Six systems. One instrument.'],[.35,false,'Follow the cable.'],[.8,false,'One connected instrument.'],[0,true,'GEO']]){
    const rendered=runInNewContext(expression,{p,preview}).replace(/<br\s*\/?\s*>/gi,'').replace(/\s+/g,' ').trim();
    assert.equal(rendered,expected);
  }
});

test('mobile pacing is continuous, monotone, reversible and preserves all six physical destinations',()=>{
  let previous=-1;
  for(let i=0;i<=1000;i++){
    const page=i/1000,pose=mobilePageToPose(page);
    assert.ok(pose>previous);previous=pose;
    assert.ok(Math.abs(mobilePoseToPage(pose)-page)<1e-12);
  }
  PROJECT_STOPS.forEach((project,index)=>assert.ok(Math.abs(mobilePageToPose(.27+.12*index)-project.at)<1e-12));
  assert.equal(mobilePageToPose(-1),0);assert.equal(mobilePageToPose(2),1);
  assert.equal(MOBILE_PAGE_STOPS.at(-1).pose,1);
});

test('native reduced-motion jumps and orientation reanchoring use the inverse mobile pace',()=>{
  const viewport={scrollY:0,scrollTo({top}){this.scrollY=top;}};
  const root={offsetHeight:8200,getBoundingClientRect:()=>({top:-viewport.scrollY})},stage={offsetHeight:1000},seen=[];
  const tour=createScrollTour({root,stage,viewport,onProgress:p=>seen.push(p),isReduced:()=>true,allowReducedScroll:()=>true,
    mapProgress:mobilePageToPose,unmapProgress:mobilePoseToPage});
  tour.measure();tour.jump(.60);assert.ok(Math.abs(viewport.scrollY-7200*.51)<1e-9);
  viewport.scrollY-=7200*.02;tour.scroll();assert.ok(seen.at(-1)<.60&&seen.at(-1)>.55);
  const pose=seen.at(-1);root.offsetHeight=3500;stage.offsetHeight=430;tour.resize({preserve:true});
  assert.ok(Math.abs(tour.progress()-pose)<1e-12);
});

const boxes=PROJECT_STOPS.map((project,index)=>new THREE.Box3(new THREE.Vector3(index*125-50,-40,-40),new THREE.Vector3(index*125+50,40,40)));
const whole=new THREE.Box3();boxes.forEach(box=>whole.union(box));
const motion={cameraFrame(name){const box=name?boxes[PROJECT_STOPS.findIndex(project=>project.name===name)]:whole;
  return{bounds:box.clone(),center:box.getCenter(new THREE.Vector3()),span:box.getSize(new THREE.Vector3())};}};
function project(progress,aspect){
  const view=mobileCameraFrame(motion,progress,aspect),camera=new THREE.Camera();camera.position.copy(view.eye);camera.up.set(0,0,1);
  camera.lookAt(view.look);camera.rotateZ(view.roll);camera.updateMatrixWorld();
  const distance=view.eye.distanceTo(view.look),height=fitMobileView(camera,view.bounds,aspect,view.perspectiveBlend,distance,view.occupancy);
  const ortho=new THREE.OrthographicCamera(-height*aspect/2,height*aspect/2,height/2,-height/2,.2,distance+1000);
  const perspective=new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2*Math.atan(height/2/distance)),aspect,.2,distance+1000);
  for(let i=0;i<16;i++)camera.projectionMatrix.elements[i]=ortho.projectionMatrix.elements[i]*(1-view.perspectiveBlend)+perspective.projectionMatrix.elements[i]/distance*view.perspectiveBlend;
  const points=[];
  for(const x of[view.bounds.min.x,view.bounds.max.x])for(const y of[view.bounds.min.y,view.bounds.max.y])for(const z of[view.bounds.min.z,view.bounds.max.z])points.push(new THREE.Vector3(x,y,z).project(camera));
  return{view,height,points};
}
test('overview and every focused envelope fit portrait, narrow phones and wide touch landscape',()=>{
  for(const aspect of[320/568,390/692,430/820,980/332])for(const progress of[0,.12,.28,.40,.49,.52,.55,.60,.65,.70,.78,.86,.94,1]){
    const {view,points}=project(progress,aspect);
    points.forEach(point=>assert.ok(Math.abs(point.x)<=view.occupancy+1e-9&&Math.abs(point.y)<=view.occupancy+1e-9,`${aspect} / ${progress}`));
  }
  const portrait=project(0,390/692);assert.ok(Math.abs(portrait.view.roll)>.8,'portrait assembly uses its tall available space');
  assert.equal(project(.78,390/692).view.roll,0,'upright project mechanisms are not tilted during inspection');
  assert.equal(project(0,980/332).view.roll,0,'wide assembly keeps its horizontal presentation');
});
