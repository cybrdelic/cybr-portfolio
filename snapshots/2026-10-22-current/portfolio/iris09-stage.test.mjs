import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from './vendor/three-r180/three.module.min.js';
import {createIris09Stage,iris09Pose,IRIS09_SOURCE_SHA256,IRIS09_LOOP_COUNTS} from './iris09-stage.mjs';

const source=await readFile(new URL('./assets/iris09/IRIS-09.glsl',import.meta.url),'utf8');
const components=pose=>[pose.time,pose.az,pose.elevation,pose.distance,...pose.target,pose.focal,...pose.shift];
const expectedCounts={sampleAxis:2,opticalSteps:24,channels:3,lightCount:3,quadratureAxis:5,marchSteps:104,shadowSteps:28};
const countUniforms={sampleAxis:'u_irisSampleAxis',opticalSteps:'u_irisOpticalSteps',channels:'u_irisChannels',lightCount:'u_irisLightCount',quadratureAxis:'u_irisQuadratureAxis',marchSteps:'u_irisMarchSteps',shadowSteps:'u_irisShadowSteps'};
const assertCounts=uniforms=>{for(const [key,name]of Object.entries(countUniforms))assert.equal(uniforms[name].value,expectedCounts[key],`${name} must retain the recovered source budget`);};

function rendererStub(){
 const capture={compiles:0,draws:0,mesh:null};
 const previousHandler=()=>{};
 const renderer={autoClear:true,debug:{checkShaderErrors:false,onShaderError:previousHandler},
  async compileAsync(scene){capture.compiles++;capture.mesh=scene.children[0];},
  render(scene){assert.equal(this.autoClear,false);assert.equal(scene.children[0],capture.mesh);capture.draws++;}
 };
 return {renderer,capture,previousHandler};
}

function scissorRendererStub({ratio=1,scissor=[0,0,1059,917],scissorTest=false,device='ANGLE (Intel, Intel(R) UHD Graphics)',rounding='round'}={}){
 const base=rendererStub(),{renderer,capture}=base;
 const rectangle=new T.Vector4(...scissor),initialRectangle=rectangle.clone();
 let enabled=scissorTest;
 const physicalRectangle=()=>rectangle.toArray().map(value=>Math[rounding](value*ratio));
 const gl={SCISSOR_BOX:3088,getExtension:()=>({UNMASKED_RENDERER_WEBGL:37446}),getParameter:parameter=>parameter===3088?Int32Array.from(physicalRectangle()):device,flush(){capture.flushes++;}};
 capture.tiles=[];capture.inputs=[];capture.flushes=0;capture.viewportChanges=0;
 renderer.getContext=()=>gl;
 renderer.getPixelRatio=()=>ratio;
 renderer.getScissor=target=>target.copy(rectangle);
 renderer.getScissorTest=()=>enabled;
 renderer.setScissor=(x,y,w,h)=>{if(x?.isVector4)rectangle.copy(x);else rectangle.set(x,y,w,h);};
 renderer.setScissorTest=value=>{enabled=value;};
 renderer.setViewport=()=>{capture.viewportChanges++;throw new Error('Tiling must not change the viewport');};
 renderer.render=function(scene){
  assert.equal(this.autoClear,false);assert.equal(scene.children[0],capture.mesh);
  capture.draws++;
  capture.tiles.push(enabled?physicalRectangle():null);
  const u=capture.mesh.material.uniforms;
  capture.inputs.push({resolution:u.u_resolution.value.toArray(),camera:u.u_irisCamera.value.toArray(),target:u.u_irisTarget.value.toArray(),shift:u.u_irisShift.value.toArray(),time:u.u_time.value,opacity:u.u_irisOpacity.value});
 };
 return {...base,initialRectangle,assertRestored(){
  assert.deepEqual(rectangle.toArray(),initialRectangle.toArray());
  assert.equal(enabled,scissorTest);assert.equal(capture.viewportChanges,0);
 }};
}

function assertPixelCoverage(tiles,width,height,clip=[0,0,width,height]){
 const coverage=new Uint8Array(width*height);
 for(const [x,y,w,h]of tiles){
  assert.ok([x,y,w,h].every(Number.isInteger));
  assert.ok(w>0&&w<=256&&h>0&&h<=256);
  assert.ok(x>=0&&y>=0&&x+w<=width&&y+h<=height);
  for(let row=y;row<y+h;row++)for(let column=x;column<x+w;column++)coverage[row*width+column]++;
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const expected=Number(x>=clip[0]&&y>=clip[1]&&x<clip[0]+clip[2]&&y<clip[1]+clip[3]);
  if(coverage[y*width+x]!==expected)assert.fail(`pixel ${x},${y} drawn ${coverage[y*width+x]} times, expected ${expected}`);
 }
}

test('scroll poses stay finite, deterministic and continuous at chapter boundaries',()=>{
 for(const [width,height]of [[1920,1080],[1059,930],[390,844]]){
  for(let i=0;i<=300;i++){
   const progress=i/300,pose=iris09Pose(progress,width,height);
   assert.ok(components(pose).every(Number.isFinite));
   assert.ok(pose.distance>0);assert.equal(pose.focal,4.2);
   assert.deepEqual(iris09Pose(progress,width,height),pose);
  }
  for(const boundary of [0,1/7,2/7,2.5/7,3/7,1]){
   const center=components(iris09Pose(boundary,width,height));
   for(const delta of [-1e-8,1e-8]){
    const adjacent=components(iris09Pose(boundary+delta,width,height));
    assert.ok(center.every((v,i)=>Math.abs(v-adjacent[i])<1e-5),`pose jumped at ${boundary} for ${width}×${height}`);
   }
  }
  const before=iris09Pose(.21,width,height);iris09Pose(.4,width,height);iris09Pose(.01,width,height);
  assert.deepEqual(iris09Pose(.21,width,height),before,'reverse scroll must not depend on retained tween state');
 }
 for(const args of [[NaN,1920,1080],[Infinity,1920,1080],[0,0,1080],[0,1920,0],[0,-1,1080],[0,1920,Infinity]])assert.throws(()=>iris09Pose(...args),TypeError);
});

test('stage pins every original sampling and traversal budget across poses',async()=>{
 assert.equal(Object.isFrozen(IRIS09_LOOP_COUNTS),true);
 assert.deepEqual(IRIS09_LOOP_COUNTS,expectedCounts);
 const {renderer,capture,previousHandler}=rendererStub(),stage=createIris09Stage(T,{source});
 await stage.compile(renderer);await stage.compile(renderer);
 assert.equal(capture.compiles,1);
 assert.equal(stage.metadata.sourceIdentityVerified,true);
 assert.equal(stage.metadata.sourceSha256,IRIS09_SOURCE_SHA256);
 assert.equal(stage.metadata.samplesPerPixel,4);
 assert.equal(renderer.debug.onShaderError,previousHandler);
 assert.equal(renderer.debug.checkShaderErrors,false);
 const material=capture.mesh.material,uniforms=material.uniforms;
 capture.mesh.geometry.computeBoundingSphere();
 assert.equal(capture.mesh.geometry.attributes.position.itemSize,3);
 assert.ok(Number.isFinite(capture.mesh.geometry.boundingSphere.radius),'Three transparent sorting requires finite 3D bounds');
 assert.equal(material.isRawShaderMaterial,true);
 assert.equal(material.vertexShader,'precision highp float;in vec2 position;void main(){gl_Position=vec4(position,0.,1.);}','retain the already compiled vertex program with the finite vec3 buffer');
 assert.equal(material.toneMapped,false,'source owns its display transform');
 assert.equal(material.depthWrite,false,'full shader scene must not claim raster mesh depth');
 assertCounts(uniforms);
 for(const progress of [0,.08,1/7,.24,2/7,3/7,0]){
  for(const name of Object.values(countUniforms))uniforms[name].value=1;
  assert.equal(stage.render(renderer,{progress,width:1280,height:720}),true);
  assertCounts(uniforms);
  assert.deepEqual(uniforms.u_resolution.value.toArray(),[1280,720]);
 }
 assert.equal(capture.draws,7);assert.equal(stage.status.draws,7);
 assert.equal(renderer.autoClear,true);
 await assert.rejects(stage.compile(rendererStub().renderer),/one existing renderer/);
 stage.dispose();
});

test('slow compilation is diagnosed as pending, never misreported as a shader failure',async()=>{
 const {renderer,capture}=rendererStub(),stage=createIris09Stage(T,{source});
 let releaseCompile,notifyCompile,settled=false;
 const enteredCompile=new Promise(resolve=>{notifyCompile=resolve;});
 renderer.compileAsync=async scene=>{
  capture.compiles++;capture.mesh=scene.children[0];
  await new Promise(resolve=>{releaseCompile=resolve;notifyCompile();});
 };
 const compilation=stage.compile(renderer,{timeoutMs:5});
 compilation.then(()=>{settled=true;});
 try{
  await enteredCompile;
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(stage.status.timedOut,true);
  assert.equal(stage.status.phase,'compiling');
  assert.equal(stage.status.error,null);
  assert.equal(settled,false);
  assert.match(stage.status.diagnostic,/still pending/);
  assert.ok(stage.status.elapsedMs>=5);
  assert.equal(capture.compiles,1);
 }finally{
  releaseCompile?.();await compilation;stage.dispose();
 }
 assert.equal(settled,true);
 assert.equal(stage.status.error,null);
 assert.equal(stage.status.diagnostic,null);
});

test('opacity changes composition only and restores renderer state on failure',async()=>{
 const {renderer,capture,previousHandler}=rendererStub(),stage=createIris09Stage(T,{source});
 await stage.compile(renderer);
 const args={progress:.4,width:1280,height:720},uniforms=capture.mesh.material.uniforms;
 for(const opacity of [0,-1])assert.equal(stage.render(renderer,{...args,opacity}),false);
 assert.equal(capture.draws,0);
 assert.equal(stage.render(renderer,{...args,opacity:.37}),true);
 assert.equal(uniforms.u_irisOpacity.value,.37);
 const pose=uniforms.u_irisCamera.value.toArray();
 stage.render(renderer,{...args,opacity:2,originalCamera:true});
 assert.equal(uniforms.u_irisOpacity.value,1);
 assert.equal(uniforms.u_irisOriginalCamera.value,true);
 assert.deepEqual(uniforms.u_irisCamera.value.toArray(),pose);
 for(const opacity of [NaN,Infinity])assert.throws(()=>stage.render(renderer,{...args,opacity}),TypeError);
 renderer.render=()=>{throw new Error('Synthetic render failure');};
 assert.throws(()=>stage.render(renderer,{...args,opacity:.5}),/Synthetic render failure/);
 assert.equal(renderer.autoClear,true);
 assert.equal(renderer.debug.onShaderError,previousHandler);
 assert.equal(renderer.debug.checkShaderErrors,false);
 stage.dispose();assert.equal(stage.render(renderer,args),false);
});

test('source mismatch fails before any shader compilation without substitute media',async()=>{
 const {renderer,capture}=rendererStub(),stage=createIris09Stage(T,{source:source+'\n'});
 await assert.rejects(stage.compile(renderer),/source hash differs/);
 assert.equal(capture.compiles,0);
 assert.equal(stage.status.phase,'error');
 assert.equal(stage.metadata.sourceIdentityVerified,false);
 stage.dispose();
});

test('Intel tiles cover each physical pixel exactly once with round/floor DPR conversion',async()=>{
 for(const rounding of ['round','floor'])for(const ratio of [1,1.25,1.3,1.5,1.75,2.625]){
  const harness=scissorRendererStub({ratio,rounding,scissor:[17.23,9.51,31.72,83.69]}),{renderer,capture}=harness;
  const stage=createIris09Stage(T,{source});await stage.compile(renderer);
  assert.match(stage.metadata.graphicsDevice,/Intel/);
  assert.equal(stage.render(renderer,{progress:2/7,width:1059,height:917,opacity:.37}),true);
  assert.equal(capture.tiles.length,20);
  assertPixelCoverage(capture.tiles,1059,917);
  for(const input of capture.inputs){assert.deepEqual(input,capture.inputs[0]);assert.deepEqual(input.resolution,[1059,917]);assert.equal(input.opacity,.37);}
  assertCounts(capture.mesh.material.uniforms);
  assert.equal(capture.flushes,20);assert.equal(stage.status.draws,1);assert.equal(stage.status.lastDrawTiles,20);assert.equal(stage.status.submissions,20);
  harness.assertRestored();assert.equal(renderer.autoClear,true);
  stage.dispose();
 }
});

test('Intel tiling respects an existing caller clip, including a partly offscreen scissor',async()=>{
 for(const rounding of ['round','floor'])for(const config of [
  {ratio:1.3,scissor:[13.2,7.7,389.4,320.1]},
  {ratio:1.5,scissor:[-3.2,7.2,301.7,129.4]},
  {ratio:2.625,scissor:[13.2,7.7,389.4,320.1]},
  {ratio:1.3,scissor:[1200,1200,20,20]}
 ]){
  const harness=scissorRendererStub({...config,rounding,scissorTest:true}),{renderer,capture}=harness;
  const stage=createIris09Stage(T,{source});await stage.compile(renderer);
  stage.render(renderer,{progress:.1,width:1059,height:917});
  const clip=config.scissor.map(v=>Math[rounding](v*config.ratio));
  assertPixelCoverage(capture.tiles,1059,917,clip);
  harness.assertRestored();assert.equal(renderer.autoClear,true);
  stage.dispose();
 }
});

test('a failing Intel tile restores caller scissor, test state, autoClear and diagnostics',async()=>{
 for(const enabled of [true,false]){
  const harness=scissorRendererStub({ratio:1.3,scissor:[13.2,7.7,650,600],scissorTest:enabled}),{renderer,capture,previousHandler}=harness;
  const stage=createIris09Stage(T,{source});await stage.compile(renderer);
  renderer.autoClear=false;
  const originalRender=renderer.render;
  renderer.render=function(scene){if(capture.draws===2)throw new Error('Synthetic tile failure');originalRender.call(this,scene);};
  assert.throws(()=>stage.render(renderer,{progress:.3,width:1059,height:917}),/Synthetic tile failure/);
  assert.equal(capture.draws,2);assert.equal(capture.flushes,2);
  assert.equal(stage.status.draws,0);assert.equal(stage.status.lastDrawTiles,2);
  harness.assertRestored();assert.equal(renderer.autoClear,false);
  assert.equal(renderer.debug.onShaderError,previousHandler);assert.equal(renderer.debug.checkShaderErrors,false);
  stage.dispose();
 }
});

test('non-Intel devices retain one draw and do not alter their scissor',async()=>{
 const harness=scissorRendererStub({ratio:1.3,scissor:[13.2,7.7,650,600],scissorTest:true,device:'ANGLE (NVIDIA, RTX)'}),{renderer,capture}=harness;
 const stage=createIris09Stage(T,{source});await stage.compile(renderer);
 stage.render(renderer,{progress:.3,width:1059,height:917});
 assert.equal(capture.draws,1);assert.equal(capture.flushes,0);assert.equal(stage.status.lastDrawTiles,1);
 assert.deepEqual(capture.tiles[0],[13.2,7.7,650,600].map(v=>Math.round(v*1.3)));
 harness.assertRestored();stage.dispose();
});
