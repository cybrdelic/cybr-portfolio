import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r180/three.module.min.js';
import {createWorkingMotion,createWorkingTubeBuffers,workingRigMatrix,workingSpanRadius} from '../instrument-working-motion.js';
import {auditTubeMesh} from './working-tube-audit.mjs';

const names=['geo','light','elements','song','combat','scenes'];
const rig={referenceAngleDeg:75,minAngleDeg:63,maxAngleDeg:87,linkLengthMM:18,axis:[0,1,0]};
const groups=new Map(names.map(n=>[n,new THREE.Group()])),objects=[];
const ports={geo:[[-47,0,0],[61,0,0]],light:[[-31,0,0],[31,0,0]],elements:[[-35,-8,-2.5],[35,-8,-2.5]],song:[[-35,0,0],[36,0,0]],combat:[[-49,0,-12],[49,0,-12]],scenes:[[-58,0,-24],[58,0,-24]]};
for(const name of names){
  const low=ports[name][0][0],high=ports[name][1][0],g=new THREE.BoxGeometry(high-low,40,40);g.translate((low+high)/2,0,0);
  const mesh=new THREE.Mesh(g);mesh.userData.meshRecord={module:name};objects.push(mesh);groups.get(name).add(mesh);
}
const pivot=[-24,-13,-20.98666487320323],motion={rig:'combat',kind:'rocker',pivot,axis:[0,1,0]};
const rocker=new THREE.Mesh(new THREE.BoxGeometry(10,2,18));rocker.userData.meshRecord={module:'combat',motion};objects.push(rocker);groups.get('combat').add(rocker);
const manifest={workingGeometry:true,stats:{sha256:'fixture'},modules:names.map((name,i)=>({name,explodedX:[-245,-104,9,111,220,345][i]})),kinematics:{combat:rig},
  routes:names.slice(1).map(name=>({module:name,points:[ports[name][0],ports[name][1]],interpolation:'sampled-linear'}))};
const route={ports,cableRadius:2.35,assembled:[-175,-68,18,110,188,308]};
const cables=[{from:['takeup'],to:['takeup'],segments:644},...names.slice(0,-1).map((name,i)=>({from:[name],to:[names[i+1]],segments:96}))].map(c=>{
  const buffers=createWorkingTubeBuffers(c.segments),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(buffers.positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(buffers.normals,3));geometry.setIndex(buffers.indices);
  return {...c,...buffers,geometry};
});
const controller=createWorkingMotion({manifest,route,groups,objects,cables});
for(const theta of[63,66,75,82,87]){
  const L=18,ref=75*Math.PI/180,a=theta*Math.PI/180,upper=new THREE.Vector3(pivot[0]+L*Math.cos(ref),pivot[1],pivot[2]+L*Math.sin(ref));
  const moved=upper.clone().applyMatrix4(workingRigMatrix(motion,theta,rig)),deck=upper.clone().applyMatrix4(workingRigMatrix({rig:'combat',kind:'deck'},theta,rig));
  assert.ok(moved.distanceTo(deck)<1e-12,'rocker upper pivot and translated deck must close exactly');
}
const audit=controller.audit(61);assert.equal(audit.passed,true);assert.ok(audit.measured.minExternalBendRadiusMM>=12);
assert.ok(audit.measured.minHousingGapMM>=8-1e-9);assert.ok(audit.measured.maxCableLengthErrorMM<.001);
controller.setProgress(.65);assert.ok(controller.snapshot().angleDeg>=63&&controller.snapshot().angleDeg<=87);
const a=ports.song[1],b=ports.combat[0];assert.ok(workingSpanRadius([0,...a.slice(1)],[10,...b.slice(1)])<12,'short transverse connector negative control must fail');
const tubeProof=[];
for(const progress of[0,.15,.28,.7]){
  controller.setProgress(progress);
  for(const cable of cables){const result=auditTubeMesh(cable);assert.equal(result.passed,true,JSON.stringify(result));tubeProof.push({progress,cable:cable.from[0],...result});}
}
const reversed=cables[1].geometry.index.array;for(let i=0;i<reversed.length;i+=3)[reversed[i+1],reversed[i+2]]=[reversed[i+2],reversed[i+1]];
assert.equal(auditTubeMesh(cables[1]).passed,false,'inward winding must fail the emitted-mesh negative control');
console.log(JSON.stringify({passed:true,measured:audit.measured,capacityMM:controller.validation.takeup.capacityMM,
  emittedMeshChecks:tubeProof.length,minVolumeMM3:Math.min(...tubeProof.map(r=>r.signedVolumeMM3)),minNormalDot:Math.min(...tubeProof.map(r=>r.minimumFaceNormalAgreement))}));
