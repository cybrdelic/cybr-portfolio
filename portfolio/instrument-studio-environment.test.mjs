import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import{createStudioEnvironment,sampleStudioRadiance,studioDirectionFromUv,studioUvFromDirection,STUDIO_ENVIRONMENT_METADATA as metadata}from './instrument-studio-environment.mjs';
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const magnitude=direction=>Math.hypot(...direction);

test('studio cards have bounded neutral radiance with the key brightest and a distinct negative fill',()=>{
 for(const panel of metadata.panels){const value=sampleStudioRadiance(panel.direction);value.forEach(channel=>close(channel,panel.radiance));}
 const key=sampleStudioRadiance(metadata.panels[0].direction)[0];
 for(let y=0;y<=100;y++)for(let x=0;x<=200;x++){
  const value=sampleStudioRadiance(studioDirectionFromUv(x/200,y/100));assert.ok(value.every(channel=>Number.isFinite(channel)&&channel>=0&&channel<=key+1e-9));close(value[0],value[1]);close(value[1],value[2]);
 }
 const negative=sampleStudioRadiance(metadata.negativeFill.direction)[0],neutral=sampleStudioRadiance([1,0,-.375])[0];assert.ok(negative<neutral*.6);
 assert.throws(()=>sampleStudioRadiance([0,0,0]));assert.throws(()=>sampleStudioRadiance([1,NaN,0]));
});
test('room gradient is world Z-up while latitude follows Three world Y',()=>{
 close(sampleStudioRadiance([0,0,-1])[0],metadata.room.floor);
 close(sampleStudioRadiance([0,0,1])[0],metadata.room.ceiling);
 close(sampleStudioRadiance([0,1,0])[0],metadata.room.horizon);
 for(const[direction,uv]of[[[1,0,0],[.5,.5]],[[0,0,1],[.75,.5]],[[0,0,-1],[.25,.5]],[[0,1,0],[.5,1]],[[0,-1,0],[.5,0]]]){
  const actual=studioUvFromDirection(direction);actual.forEach((component,i)=>close(component,uv[i]));const restored=studioDirectionFromUv(...uv);restored.forEach((component,i)=>close(component,direction[i]));
 }
 for(const panel of metadata.panels){const restored=studioDirectionFromUv(...studioUvFromDirection(panel.direction)),length=magnitude(panel.direction);restored.forEach((component,i)=>close(component,panel.direction[i]/length));}
});
test('panorama seam and softened rectangle boundaries remain continuous without narrow point spikes',()=>{
 for(const v of[.1,.3,.5,.7,.9]){const left=sampleStudioRadiance(studioDirectionFromUv(1e-7,v)),right=sampleStudioRadiance(studioDirectionFromUv(1-1e-7,v));close(left[0],right[0],.00001);}
 let largestStep=0;for(let x=0;x<1024;x++){const a=sampleStudioRadiance(studioDirectionFromUv(x/1024,.66))[0],b=sampleStudioRadiance(studioDirectionFromUv((x+1)/1024,.66))[0];largestStep=Math.max(largestStep,Math.abs(a-b));}
 assert.ok(largestStep<.55,`adjacent angular samples jumped by ${largestStep}`);
 const brightKeySamples=Array.from({length:11},(_,i)=>{const direction=metadata.panels[0].direction,offset=(i-5)*.006;return sampleStudioRadiance([direction[0]+offset,direction[1],direction[2]])[0];});assert.ok(brightKeySamples.every(value=>value===metadata.panels[0].radiance));
});
test('RGBA32F texture is bottom-up and reproduces the numeric radiance at actual pixel-center world directions',()=>{
 const texture=createStudioEnvironment(THREE),{width,height,data}=texture.image;assert.equal(width,1024);assert.equal(height,512);assert.ok(data instanceof Float32Array);assert.equal(data.length,width*height*4);
 assert.equal(texture.mapping,THREE.EquirectangularReflectionMapping);assert.equal(texture.colorSpace,THREE.LinearSRGBColorSpace);assert.equal(texture.flipY,false);
 assert.equal(texture.minFilter,THREE.LinearMipmapLinearFilter);assert.equal(texture.magFilter,THREE.LinearFilter);assert.equal(texture.generateMipmaps,true);assert.equal(texture.type,THREE.FloatType);
 for(const[x,y]of[[0,0],[1023,511],[768,256],[256,256],[512,511],[180,380]]){const expected=sampleStudioRadiance(studioDirectionFromUv((x+.5)/width,(y+.5)/height)),offset=(y*width+x)*4;expected.forEach((value,i)=>close(data[offset+i],value,1e-6));assert.equal(data[offset+3],1);}
 let count=0;for(let i=0;i<data.length;i+=4){assert.ok(Number.isFinite(data[i])&&data[i]>=0&&data[i]<=metadata.panels[0].radiance);assert.equal(data[i],data[i+1]);assert.equal(data[i],data[i+2]);assert.equal(data[i+3],1);count++;}assert.equal(count,width*height);texture.dispose();
});
