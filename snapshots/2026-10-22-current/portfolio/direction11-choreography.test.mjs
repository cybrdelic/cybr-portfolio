import test from 'node:test';
import assert from 'node:assert/strict';
import {choreographyState,chapterPresentation,ease,mechanismDrive,createShadowChoreography} from './direction11-choreography.mjs';
import * as T from './vendor/three-r180/three.module.min.js';
test('each chapter handoff converges to the next camera endpoint',()=>{
 for(let i=0;i<6;i++){
  const before=choreographyState((i+1-1e-7)/7),after=choreographyState((i+1)/7);
  assert.equal(before.next,after.index);assert.ok(before.blend>.999999);assert.equal(after.blend,0);
 }
});

test('caption follows the visible chapter and changes only while fully faded',()=>{
 assert.deepEqual(chapterPresentation({index:5,next:6,blend:0}),{index:5,opacity:1});
 assert.deepEqual(chapterPresentation({index:5,next:6,blend:.499}),{index:5,opacity:0});
 assert.deepEqual(chapterPresentation({index:5,next:6,blend:.501}),{index:6,opacity:0});
 assert.deepEqual(chapterPresentation({index:5,next:6,blend:1}),{index:6,opacity:1});
 assert.deepEqual(chapterPresentation(choreographyState(1)),{index:6,opacity:1});
});
test('render camera is continuous at all six boundaries and reversible',()=>{
 const object=()=>new T.Group();
 const env={width:1059,height:930,mechanism:{root:object(),update(){},whiteprint:{update(){}}},splash:{root:object(),update(){}},score:{root:object(),update(){this.root.position.set(4.6,.6,0);}},projects:null,set:{update(){},transitionToScene(){},material:{color:new T.Color()}},ground:object(),sun:new T.DirectionalLight(),fill:new T.DirectionalLight(),hemi:new T.HemisphereLight(),scene:new T.Scene()};
 env.set.root=object();
 const director=createShadowChoreography();
 const sample=p=>{const {camera}=director.apply(p,env);return [...camera.position.toArray(),...camera.quaternion.toArray(),camera.fov,...camera.projectionMatrix.elements];};
 for(let i=1;i<7;i++){
  const before=sample((i-1e-7)/7),after=sample(i/7);
  assert.ok(before.every((v,k)=>Math.abs(v-after[k])<1e-5),`camera jumped at ${i}`);
 }
 const reference=sample(.684);sample(.92);sample(.14);assert.deepEqual(sample(.684),reference);
});
test('scroll choreography is deterministic and stationary at endpoints',()=>{
 const positions=[0,.1,.2,.4,.8,1,.8,.4,.2,.1,0];
 for(const p of positions)assert.deepEqual(choreographyState(p),choreographyState(p));
 assert.equal(ease(0),0);assert.equal(ease(1),1);assert.ok(ease(.001)<1e-7);assert.ok(1-ease(.999)<1e-7);
});
test('mechanism demonstrates a complete forward and return stroke before inspection',()=>{
 assert.equal(mechanismDrive(0),0);
 assert.equal(mechanismDrive(1/7),1);
 assert.equal(mechanismDrive(2/7),0);
 assert.equal(mechanismDrive(2.5/7),.72);
 assert.equal(mechanismDrive(3/7),.72);
 assert.equal(mechanismDrive(1),.72);
 let forward=0,reverse=1;
 for(let i=0;i<=100;i++){
  const nextForward=mechanismDrive(i/700),nextReverse=mechanismDrive((1+i/100)/7);
  assert.ok(nextForward>=forward,'GEO must advance monotonically');
  assert.ok(nextReverse<=reverse,'LIGHT must return monotonically');
  assert.ok(Math.abs(nextForward+nextReverse-1)<1e-12,'return stroke must retrace the input');
  forward=nextForward;reverse=nextReverse;
 }
});
test('mechanism drive is continuous, reversible, and stationary at every pose boundary',()=>{
 const delta=1e-6;
 for(const boundary of [0,1/7,2/7,2.5/7,3/7]){
  const center=mechanismDrive(boundary),before=mechanismDrive(boundary-delta),after=mechanismDrive(boundary+delta);
  assert.ok(Math.abs(before-center)<1e-11,`input jumped before ${boundary}`);
  assert.ok(Math.abs(after-center)<1e-11,`input jumped after ${boundary}`);
 }
 const positions=[0,.06,.13,.2,.27,.31,.4,1];
 const forward=positions.map(mechanismDrive),reverse=[...positions].reverse().map(mechanismDrive).reverse();
 assert.deepEqual(forward,reverse);
 assert.equal(mechanismDrive(-1),0);assert.equal(mechanismDrive(2),.72);
});
test('director moves the actuator without rotating its fixed housing',()=>{
 const object=()=>new T.Group();let input=null;
 const env={width:1059,height:930,mechanism:{root:object(),update(u){input=u;},whiteprint:{update(){}}},splash:{root:object(),update(){}},score:{root:object(),update(){this.root.position.set(4.6,.6,0);}},projects:null,set:{root:object(),update(){},transitionToScene(){},material:{color:new T.Color()}},ground:object(),sun:new T.DirectionalLight(),fill:new T.DirectionalLight(),hemi:new T.HemisphereLight(),scene:new T.Scene()};
 const director=createShadowChoreography();
 for(const progress of [0,.04,1/7,.20,2/7,.35,3/7,.35,2/7,.20,1/7,0]){
  director.apply(progress,env);
  assert.equal(input,mechanismDrive(progress));
  assert.deepEqual(env.mechanism.root.rotation.toArray(),[0,-.25,0,'XYZ']);
 }
});

test('finite indoor key preserves target illuminance and hands off to the outdoor sun',()=>{
 const object=()=>new T.Group();
 const env={width:1059,height:917,mechanism:{root:object(),update(){},whiteprint:{update(){}}},splash:{root:object(),update(){}},score:{root:object(),update(){}},projects:null,set:{root:object(),update(){},transitionToScene(){},material:{color:new T.Color()}},ground:object(),sun:new T.DirectionalLight(),studioKey:new T.SpotLight(0xffffff,0,0,Math.PI/3,.25,2),fill:new T.DirectionalLight(),hemi:new T.HemisphereLight(),scene:new T.Scene()};
 const director=createShadowChoreography(),power=[3.8,5.2,4.1,4.3,4.2,3.8];
 for(let i=0;i<6;i++){
  env.scene.environmentRotation.y=.5;director.apply(i/7,env);
  const distanceSquared=env.studioKey.position.distanceToSquared(env.studioKey.target.position);
  assert.ok(Math.abs(env.studioKey.intensity/distanceSquared-power[i])<1e-12);
  assert.equal(env.sun.intensity,0);assert.equal(env.sun.visible,true);assert.equal(env.studioKey.visible,true);
  assert.equal(env.sun.shadow.autoUpdate,false);assert.equal(env.studioKey.shadow.autoUpdate,true);
  assert.equal(env.scene.environmentRotation.y,0,'director owns reflection orientation');
 }
 director.apply(6/7,env);assert.equal(env.studioKey.intensity,0);assert.equal(env.sun.visible,true);assert.equal(env.sun.intensity,3.5);
 assert.equal(env.studioKey.shadow.autoUpdate,false);assert.equal(env.sun.shadow.autoUpdate,true);
 const lamp=env.studioKey.position.toArray(),sun=env.sun.position.toArray();
 director.apply(5.9/7,env);assert.deepEqual(env.studioKey.position.toArray(),lamp);assert.deepEqual(env.sun.position.toArray(),sun);
 const before=6/7-1e-7;director.apply(before,env);assert.ok(env.studioKey.intensity<1e-8);
 assert.ok(Math.abs(env.sun.intensity-3.5)<1e-9);
});
