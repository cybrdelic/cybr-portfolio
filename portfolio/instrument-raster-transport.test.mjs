import test from 'node:test';
import assert from 'node:assert/strict';
import * as NativeThree from './vendor/three-r180/three.module.min.js';
import {setupRasterTransport,transportDimensions,transportRegion} from './instrument-raster-transport.mjs';

const signature = `vec4 getIBLVolumeRefraction(const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior,
const in float thickness, const in vec3 attenuationColor, const in float attenuationDistance)`;
function sourceShader(fullSize) {
  return {uniforms:{cadOpticalSize:fullSize,workingTransmissionSize:fullSize},fragmentShader:signature + ` {
    if (roughness > .5) { return vec4(2.0,3.0,5.0,.7); }
    return vec4(1.0);
  }
  void main() {
    vec3 outgoingLight=vec3(4.0);vec4 diffuseColor=vec4(1.0);
    #include <transmission_fragment>
    #include <opaque_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <dithering_fragment>
  }`};
}
function fixture({fail=false,sourceRevision=()=>0,specializeCapture=false}={}) {
  const THREE={...NativeThree},scene=new THREE.Scene(),objects=[],cables=[],fullSize={value:new THREE.Vector2(1265,720)};
  const opticalMaterial=new THREE.MeshPhysicalMaterial();opticalMaterial.userData.cadTransmission=1;
  const optical=new THREE.Mesh(new THREE.BoxGeometry(4,4,4),opticalMaterial);
  const hiddenOptical=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),opticalMaterial);hiddenOptical.visible=false;
  const opaque=new THREE.Mesh(new THREE.BoxGeometry(6,6,6),new THREE.MeshPhysicalMaterial());
  const cable=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshPhysicalMaterial());
  const helper=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());
  scene.add(optical,hiddenOptical,opaque,cable,helper);objects.push(optical,hiddenOptical,opaque);cables.push(cable);
  const light=new THREE.DirectionalLight();light.shadow.autoUpdate=true;light.shadow.needsUpdate=true;scene.add(light);
  const background=new THREE.Color(.9,.9,.8);scene.background=background;
  let targetDisposes=0,textureDisposes=0;
  THREE.WebGLRenderTarget=class extends NativeThree.WebGLRenderTarget {dispose(){targetDisposes++;super.dispose();}};
  THREE.DataTexture=class extends NativeThree.DataTexture {dispose(){textureDisposes++;super.dispose();}};
  const originalTarget={viewport:new THREE.Vector4(13,17,100,80)},viewport=new THREE.Vector4(1,2,3,4),scissor=new THREE.Vector4(5,6,7,8);
  const renderer={target:originalTarget,face:3,mip:2,viewport,scissor,scissorTest:true,actualViewport:originalTarget.viewport.clone(),
    shadowMap:{enabled:true,autoUpdate:true,needsUpdate:true},xr:{enabled:true},autoClear:true,clearColor:new THREE.Color(.2,.3,.4),clearAlpha:.6,
    info:{render:{calls:0,triangles:0}},renderCalls:0,clearCalls:0,afterCheck:null,
    getRenderTarget(){return this.target;},getActiveCubeFace(){return this.face;},getActiveMipmapLevel(){return this.mip;},
    getViewport(out){return out.copy(this.viewport);},setViewport(out){this.viewport.copy(out);this.actualViewport.copy(out).multiplyScalar(2);},
    getScissor(out){return out.copy(this.scissor);},setScissor(out){this.scissor.copy(out);},getScissorTest(){return this.scissorTest;},setScissorTest(value){this.scissorTest=value;},
    getClearColor(out){return out.copy(this.clearColor);},getClearAlpha(){return this.clearAlpha;},setClearColor(color,alpha){this.clearColor.set(color);this.clearAlpha=alpha;},
    setRenderTarget(target,face=0,mip=0){this.target=target;this.face=face;this.mip=mip;this.actualViewport.copy(target?.viewport??this.viewport.clone().multiplyScalar(2));},
    clear(color,depth,stencil){assert.equal(color,true);assert.equal(depth,true);assert.equal(stencil,false);this.clearCalls++;},
    render(renderScene,camera){
      this.renderCalls++;
      assert.equal(renderScene,scene);assert.equal(camera,h.camera);
      assert.equal(optical.visible,true);assert.equal(hiddenOptical.visible,false);assert.equal(opaque.visible,false);assert.equal(cable.visible,false);assert.equal(helper.visible,false);
      assert.equal(scene.background,null);assert.equal(this.shadowMap.enabled,false);assert.equal(this.shadowMap.autoUpdate,false);assert.equal(this.shadowMap.needsUpdate,false);
      assert.equal(light.shadow.autoUpdate,false);assert.equal(light.shadow.needsUpdate,false);assert.equal(this.xr.enabled,false);
      assert.equal(this.autoClear,false);assert.equal(this.scissorTest,false);assert.equal(this.clearAlpha,0);
      assert.equal(h.shader.uniforms.cadTransportCapture.value,true);
      assert.notEqual(h.shader.uniforms.cadTransportMap.value,this.target.texture,'No active sampler may read its current framebuffer attachment');
      assert.equal(h.shader.uniforms.cadTransportMap.value.isDataTexture,true);
      assert.deepEqual(h.shader.uniforms.cadOpticalSize.value.toArray(),[this.target.width,this.target.height]);
      assert.equal(h.shader.uniforms.workingTransmissionSize,fullSize);
      assert.deepEqual(this.actualViewport.toArray(),[0,0,this.target.width,this.target.height]);
      assert.deepEqual(fullSize.value.toArray(),h.expectedFull);
      this.afterCheck?.();
      if(fail)throw Error('Injected transport failure');
      this.info.render={calls:1,triangles:12};
    }};
  const transport=setupRasterTransport({THREE,renderer,scene,objects,cableMeshes:cables,fullSize,sourceRevision,specializeCapture});
  const camera=new THREE.PerspectiveCamera(40,1265/720,.1,1000),shader=sourceShader(fullSize);camera.position.z=20;camera.updateMatrixWorld();transport.bindShader(shader,opticalMaterial);
  const h={THREE,scene,objects,cables,optical,opaque,light,renderer,transport,camera,shader,fullSize,expectedFull:[1265,720]};
  h.restored=()=>{
    assert.equal(renderer.target,originalTarget);assert.equal(renderer.face,3);assert.equal(renderer.mip,2);
    assert.deepEqual(renderer.viewport.toArray(),[1,2,3,4]);assert.deepEqual(renderer.actualViewport.toArray(),[13,17,100,80]);
    assert.deepEqual(renderer.scissor.toArray(),[5,6,7,8]);assert.equal(renderer.scissorTest,true);assert.equal(renderer.autoClear,true);
    assert.deepEqual(renderer.clearColor.toArray(),[.2,.3,.4]);assert.equal(renderer.clearAlpha,.6);assert.equal(renderer.xr.enabled,true);
    assert.equal(scene.background,background);assert.equal(optical.visible,true);assert.equal(hiddenOptical.visible,false);assert.equal(opaque.visible,true);assert.equal(cable.visible,true);assert.equal(helper.visible,true);
    assert.equal(renderer.shadowMap.enabled,true);assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(renderer.shadowMap.needsUpdate,true);assert.equal(light.shadow.autoUpdate,true);assert.equal(light.shadow.needsUpdate,true);
    assert.equal(shader.uniforms.cadTransportCapture.value,false);assert.equal(shader.uniforms.cadTransportMap.value.isRenderTargetTexture,true);
    assert.deepEqual(shader.uniforms.cadOpticalSize.value.toArray(),h.expectedFull);
  };
  h.disposals=()=>({targetDisposes,textureDisposes});return h;
}

test('half-resolution transport integrates one current-pose field using one quarter of native optical ray pixels',()=>{
  assert.deepEqual(transportDimensions(1265,720),[632,360]);assert.deepEqual(transportDimensions(1,1),[1,1]);
  assert.deepEqual(transportDimensions(2048,1024,.25),[512,256]);
  const h=fixture(),result=h.transport.render(h.camera);assert.deepEqual(result,{calls:1,triangles:12,width:632,height:360});h.restored();
  const state=h.transport.snapshot();assert.equal(state.renders,1);assert.equal(state.opticalMeshes,2);assert.equal(state.history,false);
  assert.ok(state.rayPixelFraction<=.25);assert.equal(state.boundShaders,1);assert.equal(h.renderer.clearCalls,1);
  assert.equal(h.transport.render(h.camera).cached,true);h.restored();assert.equal(h.transport.snapshot().renders,1,'An unchanged pose reuses the current field without another draw');assert.equal(h.transport.snapshot().stationaryCacheHits,1);
  h.transport.dispose();h.transport.dispose();assert.deepEqual(h.disposals(),{targetDisposes:1,textureDisposes:1});assert.equal(h.transport.render(h.camera),false);
});

test('shader capture stores raw HDR transmission and alpha, with no specular, tone, dither or framebuffer feedback',()=>{
  const h=fixture(),text=h.shader.fragmentShader;
  assert.equal((text.match(/vec4 getIBLVolumeRefraction\(/g)||[]).length,1);assert.equal((text.match(/vec4 cadExactVolumeRefraction\(/g)||[]).length,1);
  assert.match(text,/return texture2D\(cadTransportMap, uv\);/);assert.match(text,/gl_FragCoord.xy \/ cadTransportFullSize/);
  const output=text.indexOf('gl_FragColor = cadTransportResult;'),earlyReturn=text.indexOf('return;',output),opaqueOutput=text.indexOf('#include <opaque_fragment>'),tone=text.indexOf('#include <tonemapping_fragment>');
  assert.ok(output>=0&&earlyReturn>output&&earlyReturn<opaqueOutput&&opaqueOutput<tone);
  assert.ok(!text.includes('gl_FragColor = vec4(outgoingLight'));
  assert.equal(h.shader.uniforms.workingTransmissionSize,h.fullSize);assert.notEqual(h.shader.uniforms.cadOpticalSize,h.fullSize);
  assert.equal(h.transport.bindShader(sourceShader(h.fullSize),h.opaque.material),false);h.transport.dispose();
});

test('specialized capture uses separate material programs while main shaders contain only the cached transmission lookup',async()=>{
 const h=fixture({specializeCapture:true}),material=h.optical.material,main=h.shader.fragmentShader;assert.ok(!main.includes('cadExactVolumeRefraction'));assert.ok(!main.includes('roughness > .5'));assert.ok(!main.includes('if (cadTransportCapture)'));assert.match(main,/texture2D\(cadTransportMap/);
 let captures=0,captureMaterial,cloneDisposals=0,sourceDisposals=0;material.addEventListener('dispose',()=>sourceDisposals++);material.onBeforeCompile=shader=>{h.transport.bindShader(shader,material);captures++;assert.ok(shader.defines.CAD_TRANSPORT_CAPTURE);assert.match(shader.fragmentShader,/roughness > .5/);assert.ok(!shader.fragmentShader.includes('uniform sampler2D cadTransportMap'));assert.ok(!shader.fragmentShader.includes('if (cadTransportCapture)'));assert.match(shader.fragmentShader,/gl_FragColor=cadTransportResult;return;/);};
 const check=()=>{captureMaterial=h.optical.material;assert.notEqual(captureMaterial,material);assert.equal(captureMaterial.defines.CAD_TRANSPORT_CAPTURE,1);assert.notEqual(captureMaterial.customProgramCacheKey(),material.customProgramCacheKey());assert.equal(h.opaque.visible,false);assert.equal(h.renderer.shadowMap.enabled,false);const shader=sourceShader(h.fullSize);captureMaterial.onBeforeCompile(shader,h.renderer);};
 h.renderer.compileAsync=async(scene,camera)=>{assert.equal(scene,h.scene);assert.equal(camera,h.camera);check();await Promise.resolve();};assert.equal(await h.transport.compileCaptureAsync(h.camera),true);h.restored();assert.equal(h.renderer.renderCalls,0);assert.equal(captures,1);
 captureMaterial.addEventListener('dispose',()=>cloneDisposals++);h.renderer.afterCheck=check;h.transport.render(h.camera);h.restored();assert.equal(captures,2);assert.equal(h.optical.material,material);assert.equal(h.transport.snapshot().capturePrograms,1);h.transport.dispose();h.transport.dispose();assert.equal(cloneDisposals,1);assert.equal(sourceDisposals,0);
});

test('asynchronous capture compilation restores source materials and shadows after rejection and blocks reentrant draws',async()=>{
 const h=fixture({specializeCapture:true}),material=h.optical.material;h.renderer.compileAsync=async()=>{assert.notEqual(h.optical.material,material);assert.equal(h.renderer.shadowMap.enabled,false);throw Error('Injected shader rejection');};await assert.rejects(h.transport.compileCaptureAsync(h.camera),/Injected shader rejection/);h.restored();assert.equal(h.optical.material,material);assert.equal(h.transport.snapshot().capturing,false);
 let release;h.renderer.compileAsync=()=>new Promise(resolve=>release=resolve);const pending=h.transport.compileCaptureAsync(h.camera);assert.throws(()=>h.transport.render(h.camera),/Reentrant/);release();await pending;h.restored();h.transport.dispose();
});

test('capture failures and reentrant attempts restore all scene, shadow, texture and renderer state',()=>{
  const h=fixture({fail:true});assert.throws(()=>h.transport.render(h.camera),/Injected transport/);h.restored();
  assert.equal(h.transport.snapshot().failures,1);assert.equal(h.transport.snapshot().capturing,false);h.transport.dispose();
  const reentrant=fixture();reentrant.renderer.afterCheck=()=>assert.throws(()=>reentrant.transport.render(reentrant.camera),/Reentrant/);
  reentrant.transport.render(reentrant.camera);reentrant.restored();reentrant.transport.dispose();
});

test('resizing changes only transport dimensions and keeps full-resolution source uniforms independent',()=>{
  const h=fixture();h.transport.render(h.camera);h.fullSize.value.set(1600,900);h.expectedFull=[1600,900];
  h.transport.render(h.camera);h.restored();assert.deepEqual(h.transport.snapshot().transportSize,[800,450]);assert.equal(h.transport.snapshot().resizes,1);
  h.transport.render(h.camera);assert.equal(h.transport.snapshot().resizes,1);h.transport.dispose();
});

test('scale changes defer all allocation and rendering until the next capture and reuse the one target',()=>{
  const h=fixture();h.transport.render(h.camera);const texture=h.shader.uniforms.cadTransportMap.value;
  const allocations=h.disposals(),submissions=h.renderer.renderCalls;
  assert.equal(h.transport.setScale(.35),.35);
  assert.equal(h.renderer.renderCalls,submissions);assert.deepEqual(h.disposals(),allocations);
  assert.deepEqual(h.transport.snapshot().transportSize,[632,360]);
  h.transport.render(h.camera);h.restored();assert.deepEqual(h.transport.snapshot().transportSize,[442,252]);
  assert.equal(h.shader.uniforms.cadTransportMap.value,texture);
  h.transport.setScale(.25);h.transport.render(h.camera);h.restored();assert.deepEqual(h.transport.snapshot().transportSize,[316,180]);
  h.transport.setScale(.5);h.transport.render(h.camera);h.restored();assert.deepEqual(h.transport.snapshot().transportSize,[632,360]);
  for(const value of [NaN,0,-.2,1.01])assert.throws(()=>h.transport.setScale(value),/Invalid/);
  assert.equal(h.transport.snapshot().scale,.5);h.transport.dispose();assert.equal(h.transport.setScale(.5),false);
});

test('missing optics hooks, shader ABI changes and invalid sample sizes fail explicitly',()=>{
  for(const values of [[0,100,.5],[100,NaN,.5],[100,100,0],[100,100,1.1]])assert.throws(()=>transportDimensions(...values),/Invalid/);
  const h=fixture(),material=h.optical.material;
  assert.throws(()=>h.transport.bindShader({uniforms:{},fragmentShader:signature+'{}'},material),/Bind CAD optics/);
  const drift=sourceShader(h.fullSize);drift.fragmentShader=drift.fragmentShader.replace('attenuationDistance','distanceChanged');
  assert.throws(()=>h.transport.bindShader(drift,material),/parameter ABI/);
  const missing=sourceShader(h.fullSize);missing.fragmentShader=missing.fragmentShader.replace('#include <opaque_fragment>','');
  assert.throws(()=>h.transport.bindShader(missing,material),/opaque output/);
  assert.throws(()=>h.transport.bindShader(h.shader,material),/already bound/);h.transport.dispose();
});

test('unselected optical materials stay native and are excluded from the selected ray capture',()=>{
 const h=fixture(),material=new NativeThree.MeshPhysicalMaterial(),unselected=new NativeThree.Mesh(new NativeThree.BoxGeometry(5,5,5),material);material.userData.cadTransmission=1;material.userData.module='scenes';h.scene.add(unselected);
 assert.equal(h.transport.bindShader({uniforms:{},fragmentShader:'SCENES keeps raster thickness'},material),false);
 h.renderer.afterCheck=()=>assert.equal(unselected.visible,false);h.transport.render(h.camera);h.restored();assert.equal(unselected.visible,true);assert.equal(unselected.material,material);assert.equal(h.transport.snapshot().opticalMeshes,2);h.transport.dispose();
});

test('idle reuse invalidates on real camera, optical and opaque pose, geometry, lighting and source changes',()=>{
 let revision=1;const h=fixture({sourceRevision:()=>revision});h.transport.render(h.camera);
 const unchanged=()=>{const draws=h.renderer.renderCalls;assert.equal(h.transport.render(h.camera).cached,true);assert.equal(h.renderer.renderCalls,draws);};
 const changed=mutate=>{unchanged();const draws=h.renderer.renderCalls;mutate();h.transport.render(h.camera);assert.equal(h.renderer.renderCalls,draws+1);};
 changed(()=>h.camera.position.x+=1);changed(()=>h.optical.position.x+=1);changed(()=>h.opaque.position.y+=1);changed(()=>h.cables[0].geometry.attributes.position.needsUpdate=true);
 changed(()=>h.optical.geometry.attributes.position.needsUpdate=true);changed(()=>h.light.intensity+=.2);changed(()=>h.opaque.material.color.r+=.1);changed(()=>revision++);
 changed(()=>h.transport.invalidate());changed(()=>h.transport.setScale(.35));unchanged();assert.equal(h.transport.snapshot().sourceRevision,2);
 const draws=h.renderer.renderCalls;h.transport.render(h.camera,{force:true});assert.equal(h.renderer.renderCalls,draws+1);h.transport.dispose();
});

test('projected region contains actual selected CAD bounds across camera rotations and mixed projections',()=>{
 const aspect=16/9,ortho=new NativeThree.OrthographicCamera(-40*aspect,40*aspect,40,-40,.1,1000),perspective=new NativeThree.PerspectiveCamera(45,aspect,.1,1000),camera=new NativeThree.Camera();
 const bounds=[new NativeThree.Box3(new NativeThree.Vector3(-6,-5,-4),new NativeThree.Vector3(5,7,3)),new NativeThree.Box3(new NativeThree.Vector3(8,-2,-1),new NativeThree.Vector3(11,3,4))];
 for(const eye of[[0,0,80],[23,-11,80],[-30,15,70]]){
  camera.position.fromArray(eye);camera.up.set(0,1,0);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  for(const blend of[0,.3,.7,1]){
   for(let i=0;i<16;i++)camera.projectionMatrix.elements[i]=ortho.projectionMatrix.elements[i]*(1-blend)+perspective.projectionMatrix.elements[i]*blend/80;
   const viewProjection=new NativeThree.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),region=transportRegion(bounds,viewProjection,640,360);
   assert.ok(region[2]*region[3]<640*360*.5,'selected capture must avoid most of the body/background target');
   for(const box of bounds)for(let x=0;x<=4;x++)for(let y=0;y<=4;y++)for(let z=0;z<=4;z++){
    const point=new NativeThree.Vector3().lerpVectors(box.min,box.max,0);point.set(box.min.x+(box.max.x-box.min.x)*x/4,box.min.y+(box.max.y-box.min.y)*y/4,box.min.z+(box.max.z-box.min.z)*z/4).applyMatrix4(viewProjection);
    const px=(point.x*.5+.5)*640,py=(point.y*.5+.5)*360;assert.ok(px>=region[0]&&px<=region[0]+region[2]&&py>=region[1]&&py<=region[1]+region[3]);
   }
  }
 }
 const crossing=new NativeThree.Box3(new NativeThree.Vector3(-1,-1,-.2),new NativeThree.Vector3(1,1,.2));assert.deepEqual(transportRegion([crossing],perspective.projectionMatrix,640,360),[0,0,640,360]);
 assert.deepEqual(transportRegion([],perspective.projectionMatrix,640,360),[0,0,0,0]);
});
