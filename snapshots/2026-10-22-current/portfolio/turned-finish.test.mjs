import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {applyTurnedFinish} from './turned-finish.mjs';

test('turned finish owns only annulus materials and restores originals',()=>{
 const material=new T.MeshPhysicalMaterial(),map=new T.Texture();material.normalMap=map;
 const ring={name:'120T involute cam gear',material},blade={name:'Rigid iris blade 0',material};
 const finish=applyTurnedFinish([ring,blade]);
 assert.notEqual(ring.material,material);assert.equal(blade.material,material);
 assert.equal(ring.material.normalMap,map);assert.equal(ring.material.anisotropy,.85);
 const shader={vertexShader:'#include <beginnormal_vertex>',fragmentShader:'#include <lights_physical_fragment>'};
 ring.material.onBeforeCompile(shader);
 assert.match(shader.vertexShader,/normalMatrix \* vec3\(-position.y, position.x, 0.0\)/);
 assert.match(shader.fragmentShader,/latheT = vLatheTangent - normal \* dot/);
 assert.match(shader.fragmentShader,/dot\(latheT,latheT\)>0.00001/);
 finish.dispose();assert.equal(ring.material,material);material.dispose();map.dispose();
});
