import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {SHADOW_STUDIO} from './direction11-studio-rig.mjs';
import {createShadowSet} from './direction11-set.mjs';
import {createShadowChoreography} from './direction11-choreography.mjs';

test('reflection key and actual finite source share the same origin at every indoor pose',()=>{
 const group=()=>new T.Group();
 const inputs={width:1059,height:930,mechanism:null,splash:{root:group(),update(){}},score:{root:group(),update(){}},projects:null,
  set:{root:group(),material:{color:new T.Color()},update(){},transitionToScene(){}},ground:group(),sun:new T.DirectionalLight(),
  studioKey:new T.SpotLight(),fireSpill:new T.PointLight(),fill:new T.DirectionalLight(),hemi:new T.HemisphereLight(),scene:new T.Scene()};
 const director=createShadowChoreography();
 for(const progress of [0,.1,.2,.3,.4,3.4/7,4.2/7,5.5/7]){
  director.apply(progress,inputs);
  assert.deepEqual(inputs.studioKey.position.toArray(),SHADOW_STUDIO.cards[0].position);
  assert.equal(inputs.set.material.color.getHex(),SHADOW_STUDIO.floorColor);
 }
 director.apply(3.4/7,inputs);assert.equal(inputs.fireSpill.intensity,12);
 director.apply(4.1/7,inputs);assert.equal(inputs.fireSpill.intensity,0);
 director.apply(3.4/7,inputs);assert.equal(inputs.fireSpill.intensity,12,'reverse scroll restores the same static emitter');
 assert.equal(inputs.fireSpill.castShadow,false,'proxy adds no extra shadow pass');
});

test('plaster preserves pigment albedo and compiles no unused clearcoat',()=>{
 const set=createShadowSet(),material=set.material,data=material.map.image.data;
 let minimum=255;
 for(let i=0;i<data.length;i+=4)minimum=Math.min(minimum,data[i]);
 assert.ok(minimum>=239,'texture variation must not multiply the pigment by a second gray albedo');
 assert.equal(material.clearcoat,0);
 assert.equal(material.roughnessMap,material.bumpMap,'packing reuses the existing texture');
 const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <aomap_fragment>\n#include <lights_physical_fragment>'};
 material.onBeforeCompile(shader);
 assert.match(shader.fragmentShader,/reflectedLight\.indirectDiffuse\*=cornerVisibility/);
 assert.doesNotMatch(shader.fragmentShader,/reflectedLight\.directDiffuse\*=/);
 assert.match(shader.vertexShader,/modelMatrix\*vec4\(position,1\.\)/);
 set.dispose();
});
