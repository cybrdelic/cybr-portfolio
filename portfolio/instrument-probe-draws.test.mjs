import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {planProbeDraws,createProbeBackground} from './instrument-probe-draws.mjs';

test('probe slices preserve every original grouped triangle once, in native opaque material order',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,.1,100);
  camera.position.z=10;camera.updateMatrixWorld();
  const materials=[new THREE.MeshPhysicalMaterial(),new THREE.MeshPhysicalMaterial()];
  const geometry=new THREE.BoxGeometry(2,2,2);geometry.clearGroups();geometry.addGroup(0,18,1);geometry.addGroup(18,18,0);
  const mesh=new THREE.Mesh(geometry,materials);scene.add(mesh);scene.updateMatrixWorld();
  const draws=planProbeDraws({THREE,scene,meshes:[mesh],camera,maxTriangles:2});
  assert.deepEqual(draws.map(draw=>[draw.material.id,draw.start,draw.count]),[
    [materials[0].id,18,6],[materials[0].id,24,6],[materials[0].id,30,6],
    [materials[1].id,0,6],[materials[1].id,6,6],[materials[1].id,12,6]]);
  assert.equal(draws.reduce((n,draw)=>n+draw.count,0),geometry.index.count);
  assert.deepEqual(geometry.drawRange,{start:0,count:Infinity});assert.equal(mesh.material,materials);
});
test('probe draws retain native group/render/depth ordering, clipping and ancestor visibility',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,.1,100),material=new THREE.MeshPhysicalMaterial();
  camera.position.z=10;camera.updateMatrixWorld();
  const first=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material),second=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);
  first.position.z=2;second.position.z=-2;scene.add(second,first);scene.updateMatrixWorld();
  let draws=planProbeDraws({THREE,scene,meshes:[first,second],camera});assert.equal(draws[0].object,first);
  first.renderOrder=1;draws=planProbeDraws({THREE,scene,meshes:[first,second],camera});assert.equal(draws[0].object,second);
  second.position.x=1000;scene.updateMatrixWorld();assert.ok(planProbeDraws({THREE,scene,meshes:[first,second],camera}).every(draw=>draw.object===first));
  const group=new THREE.Group();scene.add(group);group.add(first);group.visible=false;scene.updateMatrixWorld();
  assert.equal(planProbeDraws({THREE,scene,meshes:[first,second],camera}).length,0);
  group.visible=true;first.geometry.setDrawRange(6,6);scene.updateMatrixWorld();
  draws=planProbeDraws({THREE,scene,meshes:[first],camera});assert.equal(draws.length,1);assert.equal(draws[0].start,6);assert.equal(draws[0].count,6);
});
test('background conversion retains original float cube size, filters and six native face directions',async()=>{
  const environment=new THREE.DataTexture(new Float32Array(16*8*4),16,8,THREE.RGBAFormat,THREE.FloatType);
  environment.mapping=THREE.EquirectangularReflectionMapping;environment.minFilter=THREE.LinearMipmapLinearFilter;
  environment.generateMipmaps=true;environment.colorSpace=THREE.LinearSRGBColorSpace;
  const faces=[],renderer={coordinateSystem:THREE.WebGLCoordinateSystem,async compileAsync(){},
    setRenderTarget(target,face){assert.equal(target.width,4);assert.equal(target.texture.type,THREE.FloatType);faces.push(face);},
    render(mesh,camera){assert.equal(mesh.material.uniforms.tEquirect.value,environment);assert.equal(mesh.material.blending,THREE.NoBlending);
      assert.equal(environment.minFilter,THREE.LinearFilter);assert.ok(camera.isPerspectiveCamera);}};
  const background=createProbeBackground(THREE,renderer,environment);await background.prepare();
  for(let i=0;i<6;i++){assert.equal(background.ready,false);assert.equal(background.step(),true);assert.equal(environment.minFilter,THREE.LinearMipmapLinearFilter);}
  assert.deepEqual(faces,[0,1,2,3,4,5]);assert.equal(background.ready,true);assert.equal(background.step(),false);
  assert.equal(background.texture.mapping,THREE.CubeReflectionMapping);assert.equal(background.texture.generateMipmaps,true);background.dispose();background.dispose();
});
