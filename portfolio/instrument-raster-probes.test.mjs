import test from 'node:test';
import assert from 'node:assert/strict';
import * as NativeThree from './vendor/three-r180/three.module.min.js';
import { cubePixelDirection, integrateCubeSH, evaluateSHIrradiance, opticalMaterial, chooseProbeAnchor, setupRasterProbes } from './instrument-raster-probes.mjs';

function near(actual, expected, tolerance = 1e-5) {
  actual.forEach((value,index) => assert.ok(Math.abs(value-expected[index])<tolerance, `${value} != ${expected[index]}`));
}
function faces(size, radiance, half = false) {
  return Array.from({length:6},(_,face) => {
    const pixels=half?new Uint16Array(size*size*4):new Float32Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
      const color=radiance(cubePixelDirection(face,x,y,size).direction),at=(y*size+x)*4;
      for(let k=0;k<3;k++) pixels[at+k]=half?NativeThree.DataUtils.toHalfFloat(color[k]):color[k];
      pixels[at+3]=half?NativeThree.DataUtils.toHalfFloat(1):1;
    }
    return pixels;
  });
}
test('captured constant HDR projects to pi times radiance for every surface normal', () => {
  const color=[.4,.8,1.2], coefficients=integrateCubeSH(faces(32,()=>color),32);
  for(const normal of [[1,0,0],[0,1,0],[0,0,1],[-1,-2,3]])
    near(evaluateSHIrradiance(coefficients,normal),color.map(c=>c*Math.PI),1e-6);
  const half=integrateCubeSH(faces(16,()=>color,true),16,{half:true});
  const decoded=color.map(c=>NativeThree.DataUtils.fromHalfFloat(NativeThree.DataUtils.toHalfFloat(c)));
  near(evaluateSHIrradiance(half,[1,2,3]),decoded.map(c=>c*Math.PI),1e-6);
});
test('directional radiance gives the independent analytic cosine integral, including WebGL face orientation', () => {
  const a=[1,2,3].map(v=>v/Math.sqrt(14)),base=[.7,.8,.9],gain=[.1,.2,.3];
  const coeff=integrateCubeSH(faces(32,d=>base.map((v,k)=>v+gain[k]*d.reduce((sum,x,j)=>sum+x*a[j],0))),32);
  for(const normal of [[1,0,0],[0,-1,0],[0,0,1],[-1,-2,3]]) {
    const n=normal.map(v=>v/Math.hypot(...normal)),dot=n.reduce((sum,v,k)=>sum+v*a[k],0);
    near(evaluateSHIrradiance(coeff,normal),base.map((v,k)=>Math.PI*v+2*Math.PI/3*gain[k]*dot),1e-6);
  }
  const centerFaces=Array.from({length:6},(_,face)=>cubePixelDirection(face,0,0,1).direction);
  [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].forEach((expected,index)=>near(centerFaces[index],expected));
});
test('rejects malformed cube readback and nonfinite radiance', () => {
  assert.throws(()=>integrateCubeSH([],1),/six square/);
  const data=faces(2,()=>[1,1,1]);data[0][0]=NaN;
  assert.throws(()=>integrateCubeSH(data,2),/Nonfinite/);
  assert.throws(()=>evaluateSHIrradiance(new Float64Array(27),[0,0,0]),/Zero/);
  assert.equal(opticalMaterial({transmission:0,userData:{cadTransmission:1}}),true);
  assert.equal(opticalMaterial({opacity:.5}),true);
  assert.equal(opticalMaterial({transmission:0,opacity:1}),false);
});

function harness({failRender=false,failRead=false,captureDelayMs=0,asyncReadback=false,reflectionWeight,diffuseWeight,sliceCapture=false,captureTriangles=0,captureWakeDelayMs=32}={}) {
  let clockNow=0;
  const THREE={...NativeThree}, scene=new THREE.Scene(),groups=new Map(),objects=[];
  for(const [name,x,size] of [['geo',0,20],['elements',40,30],['combat',90,20]]) {
    const group=new THREE.Group(), material=new THREE.MeshPhysicalMaterial({metalness:.8,roughness:.25});
    group.position.x=x;scene.add(group);groups.set(name,group);
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(size,size,size),material);group.add(mesh);objects.push(mesh);
  }
  const optical=new THREE.Mesh(new THREE.BoxGeometry(3,3,3),new THREE.MeshPhysicalMaterial());
  optical.material.userData.cadTransmission=1;groups.get('geo').add(optical);objects.push(optical);
  const helper=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshBasicMaterial());scene.add(helper);
  const light=new THREE.DirectionalLight();light.shadow.autoUpdate=true;light.shadow.needsUpdate=true;scene.add(light);
  const originalEnv=new THREE.Texture();originalEnv.mapping=THREE.CubeUVReflectionMapping;scene.environment=originalEnv;
  const environment=new THREE.Texture(),background=new THREE.Color(.5,.4,.3);scene.background=background;
  scene.environmentIntensity=.7;scene.backgroundIntensity=.6;scene.backgroundBlurriness=.3;
  scene.environmentRotation.set(.2,.3,.4);scene.backgroundRotation.set(.1,.2,.3);
  const customEnv=new THREE.Texture();objects[0].material.envMap=customEnv;
  const originalTarget={name:'main'},viewport=new THREE.Vector4(1,2,3,4),scissor=new THREE.Vector4(5,6,7,8);
  const renderer={coordinateSystem:THREE.WebGLCoordinateSystem,xr:{enabled:true},shadowMap:{autoUpdate:true,needsUpdate:true},
    autoClear:false,toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:1.04,outputColorSpace:THREE.SRGBColorSpace,
    target:originalTarget,face:3,mip:2,viewport,scissor,scissorTest:true,renderCalls:0,
    getRenderTarget(){return this.target;},getActiveCubeFace(){return this.face;},getActiveMipmapLevel(){return this.mip;},
    setRenderTarget(target,face=0,mip=0){this.target=target;this.face=face;this.mip=mip;},
    getViewport(out){return out.copy(this.viewport);},setViewport(out){this.viewport.copy(out);},
    getScissor(out){return out.copy(this.scissor);},setScissor(out){this.scissor.copy(out);},
    getScissorTest(){return this.scissorTest;},setScissorTest(value){this.scissorTest=value;},
    render(){
      this.renderCalls++;
      assert.equal(groups.get(probes.snapshot().receiverModule).visible,false);
      assert.equal(optical.visible,false);assert.equal(helper.visible,false);
      assert.equal(objects[0].material.envMap,null);
      assert.ok(scene.background===environment||captureTriangles>0&&scene.background===null);assert.equal(scene.environment,originalEnv);
      assert.equal(this.toneMapping,THREE.NoToneMapping);assert.equal(this.xr.enabled,false);
      assert.equal(light.shadow.autoUpdate,false);
      if(failRender && this.renderCalls===2)throw Error('Injected second face failure');
    },
    readRenderTargetPixels(target,x,y,width,height,buffer,face){
      assert.equal(asyncReadback,false,'supported async API must not use the blocking fallback');
      if(failRead && face===3)throw Error('Injected readback failure');
      const values=[.4,.7,.9,1].map(v=>THREE.DataUtils.toHalfFloat(v));
      for(let i=0;i<buffer.length;i+=4)buffer.set(values,i);
      clockNow+=captureDelayMs/6;
    }};
  const reads=[], originalPack={name:'original pixel pack buffer'}, context={PIXEL_PACK_BUFFER:1,PIXEL_PACK_BUFFER_BINDING:2,
    pack:originalPack,lost:false,getParameter(){return this.pack;},bindBuffer(target,buffer){assert.equal(target,this.PIXEL_PACK_BUFFER);this.pack=buffer;},
    isContextLost(){return this.lost;}};
  if(asyncReadback){
    renderer.getContext=()=>context;
    renderer.readRenderTargetPixelsAsync=function(target,x,y,width,height,buffer,face,textureIndex=0){
      assert.equal(width,128);assert.equal(height,128);assert.equal(textureIndex,0);
      assert.equal(target.isWebGLCubeRenderTarget,true);assert.equal(buffer.length,128*128*4);
      assert.equal(this.target,originalTarget,'readback starts only after restoring the scene capture target');
      context.bindBuffer(context.PIXEL_PACK_BUFFER,{face});
      return new Promise((resolve,reject)=>reads.push({face,buffer,resolve:()=>{
        const values=[.4,.7,.9,1].map(v=>THREE.DataUtils.toHalfFloat(v));
        for(let i=0;i<buffer.length;i+=4)buffer.set(values,i);
        resolve(buffer);
      },reject}));
    };
  }
  let pmremDisposed=0,cubeDisposed=0,schedules=0;const convolved=[];
  THREE.PMREMGenerator=class {
    fromCubemap(){const target={width:384,height:512,texture:new THREE.Texture(),disposes:0,dispose(){this.disposes++;}};convolved.push(target);return target;}
    dispose(){pmremDisposed++;}
  };
  THREE.WebGLCubeRenderTarget=class extends NativeThree.WebGLCubeRenderTarget {dispose(){cubeDisposed++;super.dispose();}};
  const camera=new THREE.PerspectiveCamera();camera.position.set(-15,-80,40);camera.lookAt(40,0,0);camera.updateMatrixWorld();
  const probes=setupRasterProbes({THREE,renderer,scene,objects,groups,environment,reflectionWeight,diffuseWeight,sliceCapture,captureTriangles,captureDelayMs:captureWakeDelayMs,
    schedule:()=>schedules++,clock:()=>clockNow});
  function assertRestored() {
    assert.equal(renderer.target,originalTarget);assert.equal(renderer.face,3);assert.equal(renderer.mip,2);
    near(renderer.viewport.toArray(),[1,2,3,4]);near(renderer.scissor.toArray(),[5,6,7,8]);
    assert.equal(renderer.scissorTest,true);assert.equal(renderer.autoClear,false);
    assert.equal(renderer.toneMapping,THREE.ACESFilmicToneMapping);assert.equal(renderer.outputColorSpace,THREE.SRGBColorSpace);
    assert.equal(renderer.toneMappingExposure,1.04);assert.equal(renderer.xr.enabled,true);
    assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(renderer.shadowMap.needsUpdate,true);
    assert.equal(light.shadow.autoUpdate,true);assert.equal(light.shadow.needsUpdate,true);
    assert.equal(groups.get('elements').visible,true);assert.equal(optical.visible,true);assert.equal(helper.visible,true);
    assert.equal(objects[0].material.envMap,customEnv);assert.equal(scene.background,background);assert.equal(scene.environment,originalEnv);
    assert.equal(scene.backgroundIntensity,.6);assert.equal(scene.backgroundBlurriness,.3);
    near(scene.backgroundRotation.toArray().slice(0,3),[.1,.2,.3]);
  }
  return {THREE,probes,renderer,scene,groups,objects,camera,assertRestored,convolved,reads,context,originalPack,setClock:value=>clockNow=value,
    counts:()=>({pmremDisposed,cubeDisposed,schedules})};
}
test('exterior probe anchor avoids every opaque and optical world geometry bound', () => {
  const h=harness();
  const blocker=new h.THREE.Mesh(new h.THREE.BoxGeometry(10,10,80),new h.THREE.MeshBasicMaterial());
  blocker.position.set(40,0,50);h.scene.add(blocker);h.scene.updateMatrixWorld(true);
  const anchor=chooseProbeAnchor(h.THREE,h.groups.get('elements'),[...h.objects,blocker]);
  for(const mesh of [...h.objects,blocker])assert.equal(new h.THREE.Box3().setFromObject(mesh,true).containsPoint(anchor),false);
  assert.ok(anchor.z>90);
  h.probes.dispose();
});
test('probe selection and invalidation use cached conservative bounds rather than scanning CAD vertices each frame', () => {
  const h=harness();
  for(const object of h.objects){
    object.geometry.computeBoundingBox();
    for(const component of ['getX','getY','getZ'])object.geometry.attributes.position[component]=()=>{throw Error('Unexpected per-frame CAD vertex scan');};
  }
  for(let i=0;i<20;i++){
    h.groups.get('geo').position.x+=.25;
    h.probes.update(h.camera,{progress:.6,now:i*16,moving:true,geometryChanged:true});
  }
  const anchor=chooseProbeAnchor(h.THREE,h.groups.get('elements'),h.objects);
  assert.ok(anchor.toArray().every(Number.isFinite));
  assert.equal(h.probes.snapshot().captures,0);
  h.probes.update(h.camera,{progress:.6,now:600});
  assert.equal(h.probes.snapshot().captures,1,'settled capture also reuses cached CAD bounds');
  h.probes.dispose();
});
test('one six-face capture per settled epoch, smooth influence, original HDR through motion', () => {
  const h=harness(),{probes,camera}=h;
  probes.update(camera,{progress:0,now:0,geometryChanged:true});
  assert.equal(probes.snapshot().captures,0);assert.equal(probes.needsFrame(),true);
  probes.update(camera,{progress:0,now:100});assert.equal(probes.snapshot().captures,0);
  probes.update(camera,{progress:0,now:200});
  assert.equal(probes.snapshot().captures,1);assert.equal(probes.snapshot().faceRenders,6);
  assert.equal(probes.snapshot().pixelReads,6);assert.equal(probes.snapshot().irradianceReady,true);
  assert.equal(probes.snapshot().blend,0);h.assertRestored();
  probes.update(camera,{progress:0,now:325});assert.ok(Math.abs(probes.snapshot().blend-.2)<1e-9);
  probes.update(camera,{progress:0,now:450});assert.equal(probes.snapshot().blend,.4);
  probes.update(camera,{progress:0,now:1000});assert.equal(probes.snapshot().captures,1);assert.equal(probes.needsFrame(),false);
  for(let i=1;i<=5;i++)probes.update(camera,{progress:0,now:1000+i*50,moving:true,geometryChanged:true});
  assert.equal(probes.snapshot().captures,1);assert.equal(probes.snapshot().blend,0);
  probes.update(camera,{progress:0,now:1350});assert.equal(probes.snapshot().captures,1);
  probes.update(camera,{progress:0,now:1450});assert.equal(probes.snapshot().captures,2);
  assert.equal(probes.snapshot().faceRenders,12);h.assertRestored();
  probes.dispose();probes.dispose();
  assert.equal(probes.needsFrame(),false);
  assert.deepEqual(h.counts(),{pmremDisposed:1,cubeDisposed:1,schedules:h.counts().schedules});
  assert.equal(h.convolved[0].disposes,1);assert.equal(h.convolved[1].disposes,1);
});
test('camera receiver selection and large pose changes invalidate previous local geometry immediately', () => {
  const h=harness();h.probes.update(h.camera,{progress:0,now:0});h.probes.update(h.camera,{progress:0,now:200});
  h.probes.update(h.camera,{progress:0,now:500});assert.equal(h.probes.snapshot().blend,.4);
  h.groups.get('combat').position.x+=100;
  h.probes.update(h.camera,{progress:0,now:510,moving:true,geometryChanged:true});
  assert.equal(h.probes.snapshot().blend,0);assert.equal(h.probes.snapshot().largePoseInvalidations,1);
  h.camera.position.set(135,-80,40);h.camera.lookAt(190,0,0);h.camera.updateMatrixWorld();
  h.probes.update(h.camera,{progress:.9,now:520,moving:true});
  assert.equal(h.probes.snapshot().receiverModule,'combat');assert.equal(h.probes.snapshot().blend,0);
  h.probes.dispose();
});

test('a 300 ms blocking capture starts the fade after readback and advances only the next frame interval', () => {
  const h=harness({captureDelayMs:300}),{probes,camera}=h;
  probes.update(camera,{progress:0,now:0,geometryChanged:true});
  probes.update(camera,{progress:0,now:200});
  assert.equal(probes.snapshot().captures,1);
  assert.equal(probes.snapshot().lastCaptureMs,300);
  assert.equal(probes.snapshot().blend,0);
  // Capture finishes at 500 ms; a 516 ms RAF contributes only sixteen ms.
  probes.update(camera,{progress:0,now:516});
  assert.ok(Math.abs(probes.snapshot().blend-.4*16/250)<1e-9);
  assert.equal(probes.needsFrame(),true);
  probes.update(camera,{progress:0,now:625});
  assert.ok(Math.abs(probes.snapshot().blend-.2)<1e-9);
  probes.update(camera,{progress:0,now:750});
  assert.equal(probes.snapshot().blend,.4);
  assert.equal(probes.needsFrame(),false);
  assert.equal(probes.snapshot().captures,1);
  h.assertRestored();probes.dispose();
});
test('capture failures restore visibility, environment, shadow and renderer state without a retry loop', () => {
  for(const options of [{failRender:true},{failRead:true}]) {
    const h=harness(options);
    h.probes.update(h.camera,{progress:0,now:0});h.probes.update(h.camera,{progress:0,now:200});
    h.assertRestored();assert.equal(h.probes.snapshot().failures,1);assert.equal(h.probes.snapshot().captures,0);
    assert.equal(h.probes.snapshot().blend,0);assert.equal(h.probes.needsFrame(),false);
    h.probes.update(h.camera,{progress:0,now:1000});assert.equal(h.probes.snapshot().attempts,1);
    h.probes.dispose();
  }
});

const finishPromises=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
test('async six-face readback restores state immediately, sleeps while pending, and fades from completion time',async()=>{
  const h=harness({asyncReadback:true}),{probes,camera}=h;
  probes.update(camera,{now:0});h.setClock(200);probes.update(camera,{now:200});
  h.assertRestored();assert.equal(h.context.pack,h.originalPack);
  assert.deepEqual(h.reads.map(read=>read.face),[0,1,2,3,4,5]);
  assert.equal(probes.snapshot().asynchronousReadback,true);assert.equal(probes.snapshot().readbackMode,'async-pbo-fence');
  assert.equal(probes.snapshot().readbackPending,true);assert.equal(probes.snapshot().captures,0);
  assert.equal(probes.needsFrame(),false,'GPU wait must not request idle render frames');
  const schedules=h.counts().schedules;
  probes.update(camera,{now:400});assert.equal(probes.snapshot().attempts,1);assert.equal(h.counts().schedules,schedules);
  h.reads.slice(0,3).forEach(read=>read.resolve());await finishPromises();
  assert.equal(probes.snapshot().captures,0);assert.equal(probes.needsFrame(),false);
  h.setClock(500);h.reads.slice(3).forEach(read=>read.resolve());await finishPromises();
  assert.equal(probes.snapshot().readbackPending,false);assert.equal(probes.snapshot().pixelReads,6);
  assert.equal(probes.snapshot().captures,1);assert.equal(probes.snapshot().blend,0);
  assert.equal(probes.snapshot().lastCaptureSubmitMs,0);assert.equal(probes.snapshot().lastCaptureMs,300);
  assert.equal(probes.snapshot().lastReadbackMs,300);assert.equal(probes.snapshot().lastCaptureAt,500);
  assert.equal(h.counts().schedules,schedules+1,'completion wakes the fade once');
  probes.update(camera,{now:516});near([probes.snapshot().blend],[.4*16/250],1e-9);
  probes.update(camera,{now:750});assert.equal(probes.snapshot().blend,.4);assert.equal(probes.needsFrame(),false);
  h.assertRestored();probes.dispose();
});

test('async candidates cannot commit after pose, receiver, or camera motion changes and never overlap',async()=>{
  for(const change of [{geometryChanged:true},{progress:.6},{moving:true}]){
    const h=harness({asyncReadback:true}),{probes,camera}=h;
    probes.update(camera,{now:0});h.setClock(200);probes.update(camera,{now:200});
    const oldEpoch=probes.snapshot().geometryEpoch;
    if(change.progress){camera.lookAt(90,0,0);camera.updateMatrixWorld();}
    probes.update(camera,{now:220,...change});assert.ok(probes.snapshot().geometryEpoch>oldEpoch);
    probes.update(camera,{now:600,progress:change.progress??0});assert.equal(probes.snapshot().attempts,1,'cube stays owned until every read settles');
    h.setClock(700);h.reads.forEach(read=>read.resolve());await finishPromises();
    assert.equal(probes.snapshot().captures,0);assert.equal(probes.snapshot().discardedCaptures,1);
    assert.equal(probes.snapshot().irradianceReady,false);assert.equal(h.convolved[0].disposes,1);
    assert.equal(probes.snapshot().pending,true);assert.equal(probes.needsFrame(),true);
    probes.update(camera,{now:716,progress:change.progress??0});assert.equal(probes.snapshot().attempts,2);assert.equal(h.reads.length,12);
    h.setClock(720);h.reads.slice(6).forEach(read=>read.resolve());await finishPromises();
    assert.equal(probes.snapshot().captures,1);assert.equal(probes.snapshot().capturedEpoch,probes.snapshot().geometryEpoch);
    h.assertRestored();probes.dispose();
  }
});

test('async failure drains all faces, rejects lost contexts, and stops until a real invalidation',async()=>{
  for(const loseContext of [false,true]){
    const h=harness({asyncReadback:true}),{probes,camera}=h;
    probes.update(camera,{now:0});h.setClock(200);probes.update(camera,{now:200});
    if(!loseContext){h.reads[2].reject(Error('Injected async fence failure'));await finishPromises();
      assert.equal(probes.snapshot().readbackPending,true,'one failed face cannot free the cube before the other fences');}
    else h.context.lost=true;
    h.setClock(500);h.reads.forEach((read,index)=>{if(loseContext||index!==2)read.resolve();});await finishPromises();
    assert.equal(probes.snapshot().failures,1);assert.equal(probes.snapshot().captures,0);
    assert.equal(probes.snapshot().pending,false);assert.equal(probes.needsFrame(),false);
    assert.equal(h.convolved[0].disposes,1);assert.match(probes.snapshot().lastError,loseContext?/context lost/:/fence failure/);
    probes.update(camera,{now:1000});assert.equal(probes.snapshot().attempts,1);
    h.assertRestored();probes.dispose();
  }
});

test('disposing during async readback immediately releases its candidate and ignores late completion',async()=>{
  const h=harness({asyncReadback:true}),{probes,camera}=h;
  probes.update(camera,{now:0});h.setClock(200);probes.update(camera,{now:200});
  const schedules=h.counts().schedules;probes.dispose();probes.dispose();
  assert.equal(h.convolved[0].disposes,1);assert.equal(probes.needsFrame(),false);
  h.setClock(500);h.reads.forEach(read=>read.resolve());await finishPromises();
  assert.equal(h.convolved[0].disposes,1);assert.equal(probes.snapshot().captures,0);
  assert.equal(probes.snapshot().disposed,true);assert.equal(probes.snapshot().readbackPending,false);
  assert.equal(h.counts().schedules,schedules);assert.equal(h.counts().cubeDisposed,1);assert.equal(h.counts().pmremDisposed,1);
  h.assertRestored();
});

test('restrained reflection-only probe captures actual neighbors without pixel reads or changing studio diffuse',()=>{
  for(const asyncReadback of [false,true]){
    const h=harness({asyncReadback,reflectionWeight:.15,diffuseWeight:0}),{probes,camera}=h;
    const shader={uniforms:{},fragmentShader:'#include <envmap_physical_pars_fragment>'};
    probes.bindMaterialShader(shader,h.objects[1].material);
    h.renderer.readRenderTargetPixels=()=>assert.fail('reflection-only capture must never block for pixels');
    h.renderer.readRenderTargetPixelsAsync=()=>assert.fail('reflection-only capture must never allocate an async PBO');
    probes.update(camera,{now:0});probes.update(camera,{now:200});
    const captured=probes.snapshot();
    assert.equal(captured.captures,1);assert.equal(captured.faceRenders,6);assert.equal(h.convolved.length,1);
    assert.equal(captured.pixelReads,0);assert.equal(h.reads.length,0);assert.equal(captured.readbackPending,false);
    assert.equal(captured.asynchronousReadback,false);assert.equal(captured.readbackMode,'skipped-reflection-only');
    assert.equal(captured.lastReadbackMs,0);assert.equal(captured.lastSHIntegrationMs,0);assert.equal(captured.irradianceReady,false);
    assert.equal(captured.reflectionWeight,.15);assert.equal(captured.diffuseWeight,0);assert.equal(captured.blendTarget,.15);
    assert.equal(shader.uniforms.cadProbeMap.value,h.convolved[0].texture);
    assert.ok(shader.uniforms.cadProbeSH.value.every(coefficient=>coefficient.lengthSq()===0),'SH remains unmeasured');
    probes.update(camera,{now:325});near([shader.uniforms.cadProbeBlend.value],[.075],1e-12);
    assert.equal(shader.uniforms.cadProbeDiffuseBlend.value,0);assert.equal(probes.snapshot().diffuseBlend,0);
    probes.update(camera,{now:450});assert.equal(shader.uniforms.cadProbeBlend.value,.15);
    assert.equal(probes.needsFrame(),false);const schedules=h.counts().schedules;
    probes.update(camera,{now:1000});assert.equal(h.counts().schedules,schedules);assert.equal(probes.snapshot().captures,1);
    probes.update(camera,{now:1010,moving:true,geometryChanged:true});probes.update(camera,{now:1260,moving:true});
    assert.equal(shader.uniforms.cadProbeBlend.value,0);assert.equal(shader.uniforms.cadProbeDiffuseBlend.value,0);
    h.assertRestored();probes.dispose();assert.equal(h.convolved[0].disposes,1);
  }
});

test('diffuse and reflection weights fade independently, including zero reflection weight',()=>{
  for(const [reflectionWeight,diffuseWeight] of [[.15,.6],[0,.25],[0,0]]){
    const h=harness({reflectionWeight,diffuseWeight}),{probes,camera}=h;
    const shader={uniforms:{},fragmentShader:'#include <envmap_physical_pars_fragment>'};
    probes.bindMaterialShader(shader,h.objects[1].material);
    probes.update(camera,{now:0});probes.update(camera,{now:200});probes.update(camera,{now:325});
    near([shader.uniforms.cadProbeBlend.value,shader.uniforms.cadProbeDiffuseBlend.value],[reflectionWeight/2,diffuseWeight/2],1e-12);
    probes.update(camera,{now:450});near([probes.snapshot().blend,probes.snapshot().diffuseBlend],[reflectionWeight,diffuseWeight],1e-12);
    assert.equal(probes.needsFrame(),false);assert.equal(probes.snapshot().irradianceReady,diffuseWeight>0);
    h.assertRestored();probes.dispose();
  }
});

test('probe weights reject nonfinite or out-of-range values before allocating capture resources',()=>{
  for(const weight of [-.01,1.01,Infinity,NaN,'0.15']){
    assert.throws(()=>harness({reflectionWeight:weight}),/finite values from zero to one/);
    assert.throws(()=>harness({diffuseWeight:weight}),/finite values from zero to one/);
  }
});
test('IBL hook blends independent CubeUV atlases and measured world-space irradiance without replacing HDR', () => {
  const h=harness(),material=h.objects[1].material;
  const shader={uniforms:{},fragmentShader:'#include <cube_uv_reflection_fragment>\n#include <envmap_physical_pars_fragment>'};
  h.probes.bindMaterialShader(shader,material);
  assert.equal(shader.fragmentShader.includes('#endif#'),false);
  assert.equal(/^[ \t]*#[^\r\n]*#/m.test(shader.fragmentShader),false,'preprocessor directives need standalone lines');
  assert.ok(shader.fragmentShader.includes('cadProbe_textureCubeUV(cadProbeMap, reflectVec, roughness)'));
  assert.ok(shader.fragmentShader.includes('cadProbeIrradiance(worldNormal)'));
  assert.ok(shader.fragmentShader.includes('cadProbeCubeUV.x'));
  assert.ok(shader.fragmentShader.includes('cadProbeMaterialIntensity'));
  assert.equal(material.envMap,null);
  h.probes.update(h.camera,{progress:0,now:0});h.probes.update(h.camera,{progress:0,now:200});h.probes.update(h.camera,{progress:0,now:450});
  assert.equal(shader.uniforms.cadProbeBlend.value,.4);assert.equal(shader.uniforms.cadProbeDiffuseBlend.value,.4);
  near(shader.uniforms.cadProbeCubeUV.value.toArray(),[1/384,1/512,7]);
  h.probes.dispose();assert.equal(shader.uniforms.cadProbeBlend.value,0);
});

test('mobile capture restores native scene state after every face and blends only the complete cube',()=>{
  const h=harness({sliceCapture:true,reflectionWeight:.15,diffuseWeight:0}),{probes,camera}=h;
  probes.update(camera,{now:0});probes.update(camera,{now:749});assert.equal(probes.snapshot().faceRenders,0);
  for(let face=0;face<6;face++){
    probes.update(camera,{now:750+face*16});h.assertRestored();
    assert.equal(probes.snapshot().faceRenders,face+1);assert.equal(probes.snapshot().captures,0);
    assert.equal(probes.snapshot().captureFace,face+1);assert.equal(probes.snapshot().blend,0);
    assert.equal(h.convolved.length,0,'convolution follows all six original 128px faces');
  }
  probes.update(camera,{now:846});h.assertRestored();assert.equal(probes.snapshot().captures,1);
  assert.equal(probes.snapshot().faceRenders,6);assert.equal(h.convolved.length,1);assert.equal(probes.snapshot().pixelReads,0);
  probes.update(camera,{now:1096});assert.equal(probes.snapshot().blend,.15);
  assert.equal(probes.needsFrame(),false);probes.dispose();assert.equal(h.convolved[0].disposes,1);
});
test('navigation cancels a partial mobile cube and starts a new coherent capture epoch',()=>{
  const h=harness({sliceCapture:true,reflectionWeight:.15,diffuseWeight:0}),{probes,camera}=h;
  probes.update(camera,{now:0});probes.update(camera,{now:750});probes.update(camera,{now:766});
  probes.update(camera,{now:780,moving:true,geometryChanged:true});h.assertRestored();
  assert.equal(probes.snapshot().captureFace,null);assert.equal(probes.snapshot().discardedCaptures,1);
  assert.equal(probes.snapshot().captures,0);assert.equal(h.convolved.length,0);
  probes.update(camera,{now:800});
  for(let i=0;i<7;i++)probes.update(camera,{now:1530+i*16});
  assert.equal(probes.snapshot().captures,1);assert.equal(probes.snapshot().faceRenders,8);
  h.assertRestored();probes.dispose();
});
test('partial mobile capture disposal and face failures restore state without publishing an incomplete map',()=>{
  for(const failRender of [false,true]){
    const h=harness({sliceCapture:true,failRender,reflectionWeight:.15,diffuseWeight:0});
    h.probes.update(h.camera,{now:0});h.probes.update(h.camera,{now:750});
    if(failRender){h.probes.update(h.camera,{now:766});assert.equal(h.probes.snapshot().failures,1);}
    h.assertRestored();h.probes.dispose();h.probes.dispose();
    assert.equal(h.probes.snapshot().captures,0);assert.equal(h.probes.needsFrame(),false);
    assert.equal(h.counts().cubeDisposed,1);assert.equal(h.counts().pmremDisposed,1);assert.equal(h.convolved.length,0);
  }
});

test('bounded probe draws yield between submissions and publish only all six original faces',(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness({sliceCapture:true,captureTriangles:2,captureDelayMs:32,reflectionWeight:.15,diffuseWeight:0}),{probes,camera}=h;
  const materials=h.objects.map(object=>object.material),ranges=h.objects.map(object=>({...object.geometry.drawRange}));
  probes.update(camera,{now:0});assert.equal(probes.needsFrame(),false);assert.equal(probes.snapshot().captureWaiting,true);
  let now=750,steps=0;
  while(probes.snapshot().captures===0&&steps<200){
    h.setClock(now);t.mock.timers.tick(steps===0?750:32);
    const before=h.renderer.renderCalls;probes.update(camera,{now});
    assert.ok(h.renderer.renderCalls-before<=1,'one native submission per wake');h.assertRestored();
    h.objects.forEach((object,i)=>{assert.equal(object.material,materials[i]);assert.deepEqual(object.geometry.drawRange,ranges[i]);});
    if(probes.snapshot().captures===0){assert.equal(probes.needsFrame(),false);assert.equal(probes.snapshot().blend,0);}
    steps++;now+=32;
  }
  assert.equal(probes.snapshot().captures,1);assert.equal(probes.snapshot().faceRenders,6);assert.equal(probes.snapshot().triangleBudget,2);
  assert.ok(probes.snapshot().drawSlices>6);assert.equal(probes.snapshot().pixelReads,0);assert.equal(h.convolved.length,1);
  probes.update(camera,{now:now+250});assert.equal(probes.snapshot().blend,.15);probes.dispose();
});
test('navigation and disposal cancel deferred geometry pieces without stale map publication',(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness({sliceCapture:true,captureTriangles:2,reflectionWeight:.15,diffuseWeight:0}),{probes,camera}=h;
  probes.update(camera,{now:0});h.setClock(750);t.mock.timers.tick(750);probes.update(camera,{now:750});
  assert.equal(probes.snapshot().captures,0);assert.equal(probes.snapshot().captureWaiting,true);
  probes.update(camera,{now:760,moving:true,geometryChanged:true});assert.equal(probes.snapshot().discardedCaptures,1);
  const schedules=h.counts().schedules;t.mock.timers.tick(1000);assert.equal(h.counts().schedules,schedules);
  assert.equal(probes.snapshot().captureDraw,null);assert.equal(probes.snapshot().captures,0);h.assertRestored();
  probes.update(camera,{now:1800});assert.equal(probes.snapshot().captureWaiting,true);
  const before=h.counts().schedules;probes.dispose();t.mock.timers.tick(1000);assert.equal(h.counts().schedules,before);
  assert.equal(probes.snapshot().captureWaiting,false);assert.equal(probes.needsFrame(),false);
});

test('capture shader warmup restores live scene before awaiting, including compilation failure',async()=>{
  for(const fail of [false,true]){
    const h=harness({sliceCapture:true,captureTriangles:2,reflectionWeight:.15,diffuseWeight:0});let compiles=0;
    h.renderer.compileAsync=(scene,camera)=>{
      compiles++;assert.equal(scene.background,null);assert.equal(h.objects[0].material.envMap,null);
      assert.equal(h.renderer.toneMapping,h.THREE.NoToneMapping);assert.ok(camera.isPerspectiveCamera);
      return Promise.resolve().then(()=>{h.assertRestored();if(fail)throw Error('shader failure');});
    };
    if(fail)await assert.rejects(h.probes.prepare(),/shader failure/);else await h.probes.prepare();
    h.assertRestored();assert.equal(h.probes.snapshot().captures,0);assert.equal(h.renderer.renderCalls,0);
    assert.equal(compiles,fail?1:3);h.probes.dispose();
  }
});
