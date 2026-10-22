import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {createIris09Geometry} from './iris09-mesh-geometry.mjs';
import {IRIS09_MECHANICS as M,iris09MechanicalFollower} from './iris09-kinematics.mjs';
import {auditIris09Mechanics} from './iris09-mechanics-audit.mjs';

const make=()=>{const materials=Object.fromEntries([1,2,3,4,5,8].map(id=>[id,new T.MeshStandardMaterial({side:T.DoubleSide})]));return {materials,g:createIris09Geometry(T,{materials})};};
const dispose=({g,materials})=>{g.dispose();Object.values(materials).forEach(m=>m.dispose());};

test('long actuator post clears actual stationary solids across181 full-stroke poses',()=>{
 const assembly=make(),{g}=assembly,fixed=g.root.children.filter(m=>m.isMesh&&!g.leaves.includes(m));
 const ray=new T.Raycaster(new T.Vector3(),new T.Vector3(0,1,0),0,.597-.208);let probes=0;
 g.root.updateMatrixWorld(true);
 for(let i=0;i<=180;i++){
  const input=M.inputMin+(M.inputMax-M.inputMin)*i/180,cx=1.439*Math.cos(input),cz=1.439*Math.sin(input);
  for(let j=0;j<8;j++){
   const a=j*2*Math.PI/8;
   ray.ray.origin.set(cx+.0119*Math.cos(a),.208,cz+.0119*Math.sin(a));
   assert.equal(ray.intersectObjects(fixed,false).length,0,`Input ${input}, post rim ${j}`);probes++;
  }
 }
 assert.equal(probes,1448);dispose(assembly);
});

test('full nominal mounting-bore footprints remain open through complete housing and beveled plate',()=>{
 const assembly=make(),{g}=assembly,fixed=g.root.children.filter(m=>m.isMesh&&!g.leaves.includes(m));g.root.updateMatrixWorld(true);
 const ray=new T.Raycaster(new T.Vector3(),new T.Vector3(0,1,0),0,.8);let probes=0;
 for(let bore=0;bore<3;bore++)for(const r of[.04,.0755])for(let i=0;i<32;i++){
  const a=bore*2*Math.PI/3,b=i*2*Math.PI/32;
  ray.ray.origin.set(1.57*Math.cos(a)+r*Math.cos(b),-.10,1.57*Math.sin(a)+r*Math.sin(b));
  assert.equal(ray.intersectObjects(fixed,false).length,0,`Bore ${bore}, radius ${r}, rim ${i}`);probes++;
 }
 assert.equal(probes,192);dispose(assembly);
});

test('actual captured follower shafts clear both carrier windows and rotating cam slots',()=>{
 const assembly=make(),{g}=assembly,fixed=g.root.children.filter(m=>m.isMesh&&!g.leaves.includes(m));
 const ray=new T.Raycaster(new T.Vector3(),new T.Vector3(0,1,0),0,M.carrierTop+.0001-.2079);let probes=0;
 for(let p=0;p<9;p++){
  const state=g.setInput(M.inputMin+(M.inputMax-M.inputMin)*p/8);g.root.updateMatrixWorld(true);
  const solids=[...fixed,...g.actuator.children];
  for(const blade of[0,3,6]){
   const [x,,z]=iris09MechanicalFollower(blade,state);
   for(let j=0;j<8;j++){
    const a=j*2*Math.PI/8;ray.ray.origin.set(x+.0139*Math.cos(a),.2079,z+.0139*Math.sin(a));
    assert.equal(ray.intersectObjects(solids,false).length,0,`Input ${state.input}, blade ${blade}, rim ${j}`);probes++;
   }
  }
 }
 assert.equal(probes,216);dispose(assembly);
});

test('current audit distinguishes repaired source defects from actual current kinematics and unmodeled physics',async()=>{
 const a=await auditIris09Mechanics({poseCount:19});assert.equal(a.certification,false);
 assert.equal(a.sourceReference.notCurrentMechanics,true);
 for(const key of['singleInputConstraintSolver','rigidPermanentLeafOutlines','bladePivotBearings','bladeFollowerPins','driveRingCamSlots','physicalStops','removableCarrier'])assert.equal(a.implemented[key],true);
 for(const key of['forceDynamics','friction','stressOrDeflection','manufacturingTolerances'])assert.equal(a.implemented[key],false);
 assert.ok(a.constraints.maximumSlotResidual<1e-14);
 assert.ok(a.rigidEnvelope.minimumWallGap>.0266);
 assert.equal(a.aperture.disconnectedGapSamples,0);
 assert.ok(a.limitations.some(s=>s.includes('not a fully closing')));
 assert.ok(a.limitations.some(s=>s.includes('helical threads')));
 assert.match(a.construction.pivotPosts,/Integral carrier/);
});
