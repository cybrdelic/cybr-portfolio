import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from './vendor/three-r180/three.module.min.js';
import {createElementsShader} from './direction11-elements-shader.mjs';
import {createShadowChoreography} from './direction11-choreography.mjs';
import {createShadowSet} from './direction11-set.mjs';

function fixture(){
 const splash=createElementsShader(),score={root:new T.Group(),update(){this.root.position.set(4.6,.6,0);}};
 const set={root:new T.Group(),material:{color:new T.Color()},update(){},transitionToScene(){}};
 set.root.userData.wetness={value:1};
 const env={width:1059,height:930,mechanism:null,splash,score,projects:null,set,ground:new T.Group(),
  sun:new T.DirectionalLight(),studioKey:new T.SpotLight(0xffffff,0,0,Math.PI/3,.25,2),
  fill:new T.DirectionalLight(),hemi:new T.HemisphereLight(),scene:new T.Scene(),
  studio:new T.Texture(),splashStudio:new T.Texture(),elementsTime:8};
 return {env,splash,director:createShadowChoreography(),dispose(){splash.dispose();env.studio.dispose();env.splashStudio.dispose();}};
}

test('ELEMENTS phase and camera remain continuous through both adjacent handoffs',()=>{
 const f=fixture(),u=f.splash.root.children[0].material.uniforms;
 const sample=progress=>{
  const {camera}=f.director.apply(progress,f.env);
  return {phase:u.uProgress.value,time:u.uTime.value,view:[...camera.position.toArray(),...camera.quaternion.toArray(),...camera.projectionMatrix.elements]};
 };
 try{
  for(const boundary of [3,4]){
   const a=sample((boundary-1e-7)/7),b=sample(boundary/7),c=sample((boundary+1e-7)/7);
   assert.ok(Math.abs(a.phase-b.phase)<1e-6);assert.ok(Math.abs(c.phase-b.phase)<1e-6);
   for(const other of [a,c])assert.ok(other.view.every((v,i)=>Math.abs(v-b.view[i])<1e-5));
   assert.equal(a.time,8);assert.equal(b.time,8);assert.equal(c.time,8);
  }
  const reference=sample(3.42/7);sample(4.3/7);sample(2.8/7);
  assert.deepEqual(sample(3.42/7),reference,'reversing scroll must not accumulate an independent animation pose');
 }finally{f.dispose();}
});

test('single shader owns its material and does not opt back into wet reflection or transmission',()=>{
 const f=fixture(),mesh=f.splash.root.children[0],material=mesh.material,version=material.version;
 try{
  for(const progress of [2.8/7,3/7,3.4/7,3.9/7,4/7,3.9/7,3/7]){
   f.director.apply(progress,f.env);
   assert.equal(material.version,version,'choreography must not request shader compilation while animating');
   assert.equal(material.envMap,undefined);assert.ok(!(material.transmission>0));
   assert.equal(mesh.castShadow,false);assert.equal(f.env.set.root.userData.wetness.value,0);
  }
  f.director.apply(3.4/7,f.env);
  assert.equal(f.splash.root.visible,true);
  assert.ok(Math.abs(f.splash.root.position.y+.013*f.splash.root.scale.y-(-3.35))<1e-12,'contact extinction must meet the actual stage floor');
 }finally{f.dispose();}
});

test('the new shader receives the current source light in its transformed local space',()=>{
 const f=fixture(),mesh=f.splash.root.children[0],u=mesh.material.uniforms;
 try{
  for(const progress of [2.83/7,3.4/7,3.91/7]){
   const {camera}=f.director.apply(progress,f.env);
   f.splash.root.updateMatrixWorld(true);camera.updateMatrixWorld(true);
   mesh.onBeforeRender(null,f.env.scene,camera);
   const inverse=mesh.matrixWorld.clone().invert();
   const expected=f.env.studioKey.position.clone().applyMatrix4(inverse);
   assert.ok(u.uKeyLocal.value.distanceTo(expected)<1e-10);
   assert.ok(u.uCameraLocal.value.toArray().every(Number.isFinite));
   assert.ok(u.uLocalToClip.value.elements.every(Number.isFinite));
  }
 }finally{f.dispose();}
});

test('a dry studio material does not retain an unused reflection sampler',()=>{
 const set=createShadowSet();
 try{
  const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <lights_physical_fragment>\n#include <roughnessmap_fragment>\n#include <opaque_fragment>'};
  set.material.onBeforeCompile(shader);
  assert.doesNotMatch(shader.fragmentShader,/sampler2D|texture2D|stageReflection/);
  assert.match(shader.fragmentShader,/material\.clearcoat=0\./);
  assert.equal(shader.uniforms.stageReflection,undefined);
 }finally{set.dispose();}
});

test('page integration keeps continuous animation bounded and leaves native scene optics intact',async()=>{
 // directions.mjs is a DOM application. These are wiring contracts rather
 // than a substitute for compiling and viewing the actual GPU program.
 const source=await readFile(new URL('./directions.mjs',import.meta.url),'utf8');
 assert.match(source,/import \{createElementsShader as createShadowSplash\} from '\.\/direction11-elements-shader\.mjs'/);
 assert.doesNotMatch(source,/createWetReflection|wetReflection\?\.|liquidStudio/);
 assert.match(source,/let elementsAnimating=id==='11'&&!reduced&&progress\*7>2\.64&&progress\*7<4/);
 assert.match(source,/elementsFrustum\.intersectsObject\(shadowSplash\.root\.children\[0\]\)/);
 assert.match(source,/if\(disposed\|\|document\.hidden\)return/);
 assert.match(source,/if\(elementsAnimating\)elementsTime\+=dt/);
 assert.match(source,/if\(moving\|\|elementsAnimating\|\|!audio\.paused\)request\(\)/);
 assert.match(source,/const projectKeys=id==='11'\?\['song','combat','scenes'\]/);
 assert.match(source,/id==='11'\|\|s\.key!=='elements'\|\|!projects\?\.fluid\(\)\?\.pending/);
 assert.match(source,/springReflection\?\?=createSpringReflection/);
 assert.match(source,/const transmissionRegion=installTransmissionRegion\(T,renderer\)/);
});
