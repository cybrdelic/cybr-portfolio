import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {applyReference27Finish} from './reference27-finish.mjs';
import {createPrintStrokes} from '../cybr-geo/browser/print-strokes.mjs';
test('reference finish preserves source maps and restores material ownership',()=>{
 const original=new T.MeshPhysicalMaterial(),map=new T.Texture();original.map=map;
 const part={name:'Rigid iris blade 0',material:original},finish=applyReference27Finish([part]);
 assert.notEqual(part.material,original);assert.equal(part.material.map,map);
 const shader={vertexShader:'#include <begin_vertex>',fragmentShader:'#include <roughnessmap_fragment>'};
 part.material.onBeforeCompile(shader);assert.match(shader.fragmentShader,/footprint/);assert.match(shader.fragmentShader,/roughnessFactor=clamp/);
 finish.dispose();assert.equal(part.material,original);map.dispose();original.dispose();
});
test('CAD stroke instance count and logarithmic depth prerequisites',()=>{
 const s=createPrintStrokes(T,[0,0,0,1,0,0,1,0,0,1,1,0],{color:0x111111,width:1.65});
 assert.equal(s.geometry.instanceCount,2);assert.match(s.material.vertexShader,/#include <common>/);
 assert.match(s.material.fragmentShader,/#include <logdepthbuf_fragment>/);
 assert.equal(s.material.depthWrite,false);assert.equal(s.mesh.frustumCulled,false);
 s.mesh.onBeforeRender({getDrawingBufferSize(v){v.set(1500,840);},getPixelRatio(){return 1.5;}});
 assert.equal(s.material.uniforms.width.value,1.65*1.5);s.geometry.dispose();s.material.dispose();
});
test('radially brushed gear has its own shader cache key',()=>{
 const original=new T.MeshPhysicalMaterial(),blade={name:'Rigid iris blade 0',material:original},gear={name:'32T pinion',material:original};
 const finish=applyReference27Finish([blade,gear]);assert.notEqual(blade.material.customProgramCacheKey(),gear.material.customProgramCacheKey());
 const shader={vertexShader:'#include <beginnormal_vertex>\n#include <begin_vertex>',fragmentShader:'#include <roughnessmap_fragment>\n#include <lights_physical_fragment>'};
 gear.material.onBeforeCompile(shader);assert.match(shader.fragmentShader,/vGearTangent-normal\*dot/);assert.equal(gear.material.metalness,.72);
 finish.dispose();original.dispose();
});
