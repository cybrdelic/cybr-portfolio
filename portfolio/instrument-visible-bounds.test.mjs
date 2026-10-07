import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {opticalGeometryInView} from './instrument-visible-bounds.mjs';
import {elementsInView} from './instrument-elements-bake.mjs';

function setup(){
  const camera=new THREE.PerspectiveCamera(50,1,1,1000);camera.position.set(0,0,150);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(20,20,20),new THREE.MeshPhysicalMaterial({transmission:1}));
  mesh.updateMatrixWorld();return {camera,mesh};
}
test('optical read targets remain enabled for visible native bounds and material arrays',()=>{
  const {camera,mesh}=setup();const check=()=>opticalGeometryInView({THREE,objects:[mesh],camera});
  assert.equal(check(),true);
  mesh.material=[new THREE.MeshPhysicalMaterial(),mesh.material];assert.equal(check(),true);
  mesh.position.x=1000;mesh.updateMatrixWorld();assert.equal(check(),false);
  mesh.position.x=65;mesh.updateMatrixWorld();assert.equal(check(),true,'partly visible native geometry must not be culled');
  mesh.visible=false;assert.equal(check(),false);
});
test('authored external transmission participates even when Three transmission is zero',()=>{
  const {camera,mesh}=setup();mesh.material.transmission=0;mesh.material.userData.cadTransmission=1;
  assert.equal(opticalGeometryInView({THREE,objects:[mesh],camera}),true);
  mesh.material.userData.cadTransmission=0;assert.equal(opticalGeometryInView({THREE,objects:[mesh],camera}),false);
});
test('ELEMENTS playback requires both whole-component and flame/light bounds outside the camera',()=>{
  const {camera,mesh}=setup(),group=new THREE.Group();group.add(mesh);
  mesh.geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),16);
  group.updateMatrixWorld(true);assert.equal(elementsInView(camera,group,mesh),true);
  group.position.x=1000;group.updateMatrixWorld(true);assert.equal(elementsInView(camera,group,mesh),false);
  group.position.x=100;group.updateMatrixWorld(true);assert.equal(elementsInView(camera,group,mesh),true,'a light affecting the visible edge must keep playing');
});
