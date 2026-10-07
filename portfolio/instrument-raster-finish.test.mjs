import test from 'node:test';
import assert from 'node:assert/strict';
import{MACHINED_ROUGHNESS_MEAN as mean,MACHINED_TEXTURE_WIDTH as width,MACHINED_ROUGHNESS_SHADER_CHUNK,evaluateMachinedRoughness,machinedTextureFootprint}from './instrument-raster-finish.mjs';
import * as THREE from './vendor/three-r180/three.module.min.js';
const close=(a,b,tolerance=1e-12)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);

test('resolved machining preserves authored mean for a source-range zero-mean texture instead of reducing roughness by 35 percent',()=>{
 for(const roughness of[.17,.18,.24,.32,.34,.48]){
  const samples=Array.from({length:128},(_,i)=>mean+.15*Math.sin(i/128*Math.PI*2));
  for(const footprint of[0,.25,.5,.8,1,12]){const result=samples.map(green=>evaluateMachinedRoughness({roughness,green,footprint}));close(result.reduce((sum,value)=>sum+value,0)/result.length,roughness);}
  close(evaluateMachinedRoughness({roughness,green:mean}),roughness);assert.ok(roughness*mean<roughness*.66);
 }
});
test('known source range remains restrained and all valid samples stay finite within four percent of authored roughness',()=>{
 for(const roughness of[0,.025,.17,.24,.34,.8,1])for(const footprint of[0,.3,.5,.9,1,100])for(let green=0;green<=1;green+=.01){const result=evaluateMachinedRoughness({roughness,green,footprint});assert.ok(Number.isFinite(result)&&result>=roughness*.96-1e-12&&result<=roughness*1.04+1e-12);}
 for(const roughness of[.24,.34]){const low=evaluateMachinedRoughness({roughness,green:128/255}),high=evaluateMachinedRoughness({roughness,green:205/255});assert.ok(low>roughness*.96);assert.ok(high<roughness*1.04);assert.ok(low<roughness&&high>roughness);}
 assert.throws(()=>evaluateMachinedRoughness({roughness:NaN}));assert.throws(()=>evaluateMachinedRoughness({roughness:.3,green:2}));assert.throws(()=>evaluateMachinedRoughness({roughness:.3,footprint:-1}));
});
test('increasing CSS pixel footprint converges monotonically to exact authored roughness and accounts for both UV axes',()=>{
 for(const green of[.5019607843137255,.803921568627451]){let last=Infinity;for(const footprint of[0,.25,.35,.5,.75,.9,1,2,100]){const result=evaluateMachinedRoughness({roughness:.24,green,footprint}),deviation=Math.abs(result-.24);assert.ok(deviation<=last+1e-12);last=deviation;if(footprint>=1)assert.equal(result,.24);}}
 close(machinedTextureFootprint([1/width,0],[0,.5/width]),1);
 close(machinedTextureFootprint([0,.5/width],[.6/width,.8/width]),1);
 const smallTextureCellPerPixel=machinedTextureFootprint([.02,0],[0,.01]);assert.equal(evaluateMachinedRoughness({roughness:.34,green:.8,footprint:smallTextureCellPerPixel}),.34);
 assert.throws(()=>machinedTextureFootprint([NaN,0],[0,0]));
});
test('shared shader accepts the real Three roughness sample ABI and leaves part multipliers to the material',()=>{
 assert.match(THREE.ShaderChunk.roughnessmap_fragment,/vec4 texelRoughness/);
 const source=THREE.ShaderChunk.roughnessmap_fragment+'\n'+MACHINED_ROUGHNESS_SHADER_CHUNK;
 assert.match(source,/roughnessFactor=roughness\*/);assert.match(MACHINED_ROUGHNESS_SHADER_CHUNK,/^\s*#ifdef USE_ROUGHNESSMAP/);assert.ok(!MACHINED_ROUGHNESS_SHADER_CHUNK.includes('vPartFinish'));
 assert.ok(!MACHINED_ROUGHNESS_SHADER_CHUNK.includes('uniform '));
});
