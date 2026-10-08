import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {prepareShaderVariants,visibleShaderObjects} from './instrument-shader-preparation.mjs';
import {createHdrComposite} from './instrument-hdr-composite.mjs';

function fixture(){
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),material=new THREE.MeshPhysicalMaterial(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);
  mesh.receiveShadow=true;scene.add(mesh);scene.background=new THREE.Color(.2,.3,.4);const light=new THREE.DirectionalLight();scene.add(light);
  const original=new THREE.WebGLRenderTarget(10,11),target=new THREE.WebGLRenderTarget(390,688),calls=[],viewport=new THREE.Vector4(2,3,40,50),scissor=new THREE.Vector4(4,5,60,70);
  const renderer={target:original,face:2,mip:1,viewport,scissor,scissorTest:true,shadowMap:{enabled:true,autoUpdate:true,needsUpdate:true},xr:{enabled:true},autoClear:true,toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:1.2,outputColorSpace:THREE.SRGBColorSpace,info:{programs:[]},
    getRenderTarget(){return this.target;},getActiveCubeFace(){return this.face;},getActiveMipmapLevel(){return this.mip;},getViewport(out){return out.copy(this.viewport);},getScissor(out){return out.copy(this.scissor);},getScissorTest(){return this.scissorTest;},
    setViewport(value){this.viewport.copy(value);},setScissor(value){this.scissor.copy(value);},setScissorTest(value){this.scissorTest=value;},setRenderTarget(value,face=0,mip=0){this.target=value;this.face=face;this.mip=mip;this.viewport.set(0,0,1,1);this.scissor.set(0,0,1,1);this.scissorTest=false;},
    render(){throw Error('preparation must not render');},compileAsync(root,view,actualScene){calls.push({root,view,scene:actualScene,target:this.target,background:actualScene.background,shadow:this.shadowMap.enabled,xr:this.xr.enabled});return Promise.resolve();}};
  const state=()=>({target:renderer.target,face:renderer.face,mip:renderer.mip,viewport:renderer.viewport.toArray(),scissor:renderer.scissor.toArray(),scissorTest:renderer.scissorTest,shadow:{...renderer.shadowMap},xr:renderer.xr.enabled,background:scene.background,override:scene.overrideMaterial,toneMapping:renderer.toneMapping,exposure:renderer.toneMappingExposure,colorSpace:renderer.outputColorSpace});
  return {scene,camera,mesh,material,target,renderer,calls,state};
}
test('exact target/material variants restore live state before waiting and finalize lazily reflected programs only after completion',async()=>{
  const f=fixture(),before=f.state(),paper=new THREE.Color(.8,.8,.8),field=new THREE.ShaderMaterial(),geometry=new THREE.BoxGeometry(2,3,4);let release,ready=false,uniforms=0,attributes=0;
  const originalCompile=f.renderer.compileAsync;
  f.renderer.compileAsync=function(...args){originalCompile.apply(this,args);return new Promise(resolve=>release=()=>{ready=true;resolve();});};
  f.renderer.info.programs=[{getUniforms(){assert.equal(ready,true);assert.deepEqual(f.state(),before);uniforms++;},getAttributes(){attributes++;}}];
  const pending=prepareShaderVariants({THREE,renderer:f.renderer,variants:[{name:'field',scene:f.scene,camera:f.camera,target:f.target,background:paper,field:true,objects:[{object:f.mesh,material:field,geometry}]}],yieldTask:async()=>{}});
  assert.deepEqual(f.state(),before);assert.equal(uniforms,0);assert.equal(f.calls.length,1);
  const call=f.calls[0],proxy=call.root.children[0];assert.equal(call.scene,f.scene);assert.equal(call.view,f.camera);assert.equal(call.target,f.target);assert.equal(call.background,paper);assert.equal(call.shadow,false);assert.equal(call.xr,false);
  assert.equal(proxy.geometry,geometry);assert.equal(proxy.material,field);assert.equal(proxy.receiveShadow,f.mesh.receiveShadow);assert.equal(f.mesh.material,f.material);assert.notEqual(proxy,f.mesh);assert.equal(f.mesh.parent,f.scene);
  release();const result=await pending;assert.equal(uniforms,1);assert.equal(attributes,1);assert.equal(result.variants[0].name,'field');assert.deepEqual(f.state(),before);
});
test('synchronous/async compilation failures and cancellation preserve target, scene and original objects',async()=>{
  for(const asynchronous of [false,true]){
    const f=fixture(),before=f.state();f.renderer.compileAsync=()=>{if(asynchronous)return Promise.reject(Error('compile failed'));throw Error('compile failed');};
    await assert.rejects(prepareShaderVariants({THREE,renderer:f.renderer,variants:[{name:'opaque',scene:f.scene,camera:f.camera,target:f.target,background:null,objects:[f.mesh]}]}),/compile failed/);assert.deepEqual(f.state(),before);assert.equal(f.mesh.parent,f.scene);
  }
  const f=fixture();await assert.rejects(prepareShaderVariants({THREE,renderer:f.renderer,variants:[{}],cancelled:()=>true}),/cancelled/);assert.equal(f.calls.length,0);
});
test('HDR startup descriptors use actual retained scene/display resources and never mark an unrendered frame ready',()=>{
  const f=fixture(),composite=createHdrComposite(THREE);f.renderer.getDrawingBufferSize=out=>out.set(390,688);
  const hidden=new THREE.Mesh(new THREE.BoxGeometry(),f.material);hidden.visible=false;f.scene.add(hidden);
  const visible=visibleShaderObjects(f.scene,f.camera);assert.deepEqual(visible,[f.mesh]);
  const descriptors=composite.startupVariants(f.renderer,f.scene,f.camera,f.scene.background,visible);
  assert.equal(descriptors[0].scene,f.scene);assert.equal(descriptors[0].target.width,390);assert.equal(descriptors[0].target.height,688);assert.equal(descriptors[0].target.samples,4);
  assert.equal(descriptors[1].target,f.renderer.target);assert.equal(descriptors[1].objects[0].material.uniforms.source.value,descriptors[0].target.texture);
  assert.equal(composite.present(f.renderer),false);assert.equal(f.calls.length,0);composite.dispose();
});
