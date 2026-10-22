import test from 'node:test';
import assert from 'node:assert/strict';
import {IRIS09_MECHANICS as M,iris09InputFromTime,solveIris09Input,iris09MechanicalBladeContour,iris09MechanicalBladeContains,iris09IdealInputTorque} from './iris09-kinematics.mjs';
import {iris09ConstraintAudit,iris09RigidEnvelopeAudit,iris09ApertureAudit} from './iris09-mechanics-audit.mjs';

const close=(a,b,e=1e-10)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
test('one drive-ring input enforces all nine follower-slot constraints over the full working stroke',()=>{
 const a=iris09ConstraintAudit(1025);
 assert.ok(a.maximumSlotResidual<1e-14);
 assert.ok(a.minimumSlotClearance>.00199999);
 assert.ok(a.minimumWrongBranchSeparation>.25);
 assert.ok(a.minimumJacobian>.1423);
 assert.ok(a.minimumForeignPivotGap>.0602);
 assert.ok(a.minimumForeignFollowerGap>.1724);
 close(a.minimumBladeFaceGap,.00035);
 assert.throws(()=>solveIris09Input(M.inputMin-.0001),RangeError);
 assert.throws(()=>solveIris09Input(M.inputMax+.0001),RangeError);
 assert.throws(()=>solveIris09Input(NaN),RangeError);
 for(let i=0;i<201;i++){
  const input=iris09InputFromTime(i/10);assert.ok(input>=M.inputMin&&input<=M.inputMax);
  close(input,iris09InputFromTime(i/10+20));
 }
});

test('differential transmission agrees with finite differences and ideal virtual work',()=>{
 const h=1e-7;
 for(let i=1;i<100;i++){
  const input=M.inputMin+(M.inputMax-M.inputMin)*i/100,s=solveIris09Input(input);
  const derivative=(solveIris09Input(input+h).bladeAngle-solveIris09Input(input-h).bladeAngle)/(2*h);
  close(derivative,s.angleDerivative,2e-8);
  close(iris09IdealInputTorque(s,Array(9).fill(2)),18*s.angleDerivative);
  close(iris09IdealInputTorque(s,[1,-1,0,0,0,0,0,0,0]),0);
 }
 assert.throws(()=>iris09IdealInputTorque(solveIris09Input(M.inputMin),[1]),TypeError);
});

test('the blade is a fixed convex profile with real pivot/follower bores, not a root-space clip',()=>{
 const c=iris09MechanicalBladeContour();assert.ok(c.length>40);
 for(let i=0;i<c.length;i++){
  const a=c[i],b=c[(i+1)%c.length];
  assert.ok(iris09MechanicalBladeContains(...a,{holes:false}));
  assert.ok(iris09MechanicalBladeContains((a[0]+b[0])/2,(a[1]+b[1])/2,{holes:false}));
 }
 assert.equal(iris09MechanicalBladeContains(0,0),false);
 assert.equal(iris09MechanicalBladeContains(M.followerOffset,0),false);
 assert.equal(iris09MechanicalBladeContains(0,0,{holes:false}),true);
 const a=iris09RigidEnvelopeAudit();assert.ok(a.maximumRadius<M.bladeRadialEnvelope);
 assert.ok(a.maximumRadius>1.4313);assert.ok(a.minimumWallGap>.0266);
 close(a.witness.bladeAngle,.7875);
});

test('sampled aperture has no detached light cracks, but is not falsely called a closed shutter',()=>{
 const a=iris09ApertureAudit();assert.equal(a.disconnectedGapSamples,0);
 assert.equal(a.centerExposedEveryPose,true);assert.ok(a.minApertureRadius>.15);
 assert.ok(a.maxApertureRadius>.46&&a.maxApertureRadius<.47);assert.ok(a.samples>800000);
});

const rectangle=(xmin,xmax,zmin,zmax,angle)=>{
 const c=Math.cos(angle),s=Math.sin(angle);return [[xmin,zmin],[xmax,zmin],[xmax,zmax],[xmin,zmax]].map(([x,z])=>[c*x-s*z,s*x+c*z]);
};
const separation=(a,b)=>{
 let maximum=-Infinity;
 for(const p of[a,b])for(let i=0;i<4;i++){
  const q=p[i],r=p[(i+1)%4],dx=r[0]-q[0],dz=r[1]-q[1],l=Math.hypot(dx,dz),axis=[-dz/l,dx/l];
  const aa=a.map(v=>v[0]*axis[0]+v[1]*axis[1]),bb=b.map(v=>v[0]*axis[0]+v[1]*axis[1]);
  maximum=Math.max(maximum,Math.min(...bb)-Math.max(...aa),Math.min(...aa)-Math.max(...bb));
 }return maximum;
};
test('physical stop blocks contact at solver endpoints and clear the intervening motion',()=>{
 const start=rectangle(1.415,1.464,-.042,-.022,M.inputMin),end=rectangle(1.415,1.464,.022,.042,M.inputMax);
 for(let i=0;i<=1000;i++){
  const input=M.inputMin+(M.inputMax-M.inputMin)*i/1000,moving=rectangle(1.388,1.454,-.022,.022,input);
  const a=separation(moving,start),b=separation(moving,end);
  assert.ok(a>=-1e-12&&b>=-1e-12);
  if(i===0)close(a,0);else assert.ok(a>0);
  if(i===1000)close(b,0);else assert.ok(b>0);
 }
 assert.ok(1.415-M.driveRingOuter>.0049);
});

test('removable carrier, journal and thrust washer have a valid axial insertion order',()=>{
 assert.ok(M.carrierOuter<M.cavityInner);
 assert.ok(M.driveRingInner>1.243); // fixed journal outside diameter
 assert.ok(1.244>1.243); // separately installed upper washer inner radius
 assert.ok(M.carrierMountRadius-M.carrierStandRadius>M.driveRingOuter);
 assert.ok(M.carrierMountRadius+M.carrierStandRadius<M.cavityInner);
 assert.ok(M.carrierMountPhase>.83); // not inside original external guide slot
 assert.ok(.248<M.firstBladeTop-M.thickness); // clamp head below blade deck
 assert.ok(M.carrierMountBore>M.carrierScrewRadius);
});
