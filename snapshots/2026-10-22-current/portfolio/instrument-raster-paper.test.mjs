import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {createRasterPaper,rasterPaperRadiance,rasterPaperDisplay} from './instrument-raster-paper.mjs';

// Independent forward evaluation reads coefficients from the vendored shader.
const shader=THREE.ShaderChunk.tonemapping_pars_fragment;
function shaderMatrix(name){
  const block=shader.match(new RegExp(`const mat3 ${name} = mat3\\(([\\s\\S]*?)\\);`))[1];
  const columns=[...block.matchAll(/vec3\(([^)]*)\)/g)].map(match=>match[1].split(',').map(Number));
  return value=>[0,1,2].map(row=>columns.reduce((sum,column,index)=>sum+column[row]*value[index],0));
}
const input=shaderMatrix('ACESInputMat'),output=shaderMatrix('ACESOutputMat');
const fit=shader.match(/vec3 a = v \* \( v \+ ([\d.]+) \) - ([\d.]+);\s*vec3 b = v \* \( ([\d.]+) \* v \+ ([\d.]+) \) \+ ([\d.]+);/).slice(1).map(Number);
const exposureScale=Number(shader.match(/color \*= toneMappingExposure \/ ([\d.]+);/)[1]);
const transfer=THREE.ShaderChunk.colorspace_pars_fragment;
const exponent=Number(transfer.match(/pow\( value.rgb, vec3\( ([\d.]+) \)/)[1]);
function actualDisplay(radiance,exposure){
  const fitted=input(radiance.map(value=>value*exposure/exposureScale)).map(value=>
    (value*(value+fit[0])-fit[1])/(value*(fit[2]*value+fit[3])+fit[4]));
  return output(fitted).map(value=>{
    value=Math.max(0,Math.min(1,value));return value<=.0031308?value*12.92:Math.pow(value,exponent)*1.055-.055;
  });
}
function near(actual,expected,tolerance=1e-10){
  actual.forEach((value,index)=>assert.ok(Math.abs(value-expected[index])<tolerance,`${value} != ${expected[index]}`));
}

test('calibrated paper exactly roundtrips through the actual local ACES matrices and output transfer',()=>{
  for(const color of [0xf4f4f2,0xfaf9f6,0xdedbd5,0xffffff,0,0x808080]){
    const target=[color>>16&255,color>>8&255,color&255].map(value=>value/255);
    for(const exposure of [.5,1,1.7,3]){
      const radiance=rasterPaperRadiance(color,exposure);
      assert.ok(radiance.every(value=>Number.isFinite(value)&&value>0));
      near(actualDisplay(radiance,exposure),target);near(rasterPaperDisplay(radiance,exposure),target);
      near(radiance.map(value=>value*exposure),rasterPaperRadiance(color,1));
    }
  }
});

test('Three Color stores calibrated HDR radiance and corrects the original dark transmission clear',()=>{
  const paper=createRasterPaper(THREE),radiance=rasterPaperRadiance();
  assert.equal(paper.isColor,true);near(paper.toArray(),radiance);assert.ok(paper.r>1&&paper.g>1&&paper.b>1);
  const wrong=actualDisplay(new THREE.Color(0xf4f4f2).toArray(),1).map(value=>Math.round(value*255));
  assert.deepEqual(wrong,[223,223,223]);
  assert.deepEqual(actualDisplay(paper.toArray(),1).map(value=>Math.round(value*255)),[244,244,242]);
});

test('rejects invalid colors/exposures and physically unrepresentable saturated targets',()=>{
  for(const color of [-1,0x1000000,NaN,1.5,'#f4f4f2'])assert.throws(()=>rasterPaperRadiance(color),/24-bit integer/);
  for(const exposure of [0,-1,NaN,Infinity])assert.throws(()=>rasterPaperRadiance(0xf4f4f2,exposure),/positive and finite/);
  assert.throws(()=>rasterPaperRadiance(0xff0000),/positive ACES HDR gamut/);
  assert.throws(()=>rasterPaperDisplay([1,-1,1]),/finite nonnegative/);
  assert.throws(()=>createRasterPaper({}),/Color factory/);
});
