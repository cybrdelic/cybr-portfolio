/** Evidence for the current rigid mechanism, not manufacturing certification.
 * Run: node portfolio/iris09-mechanics-audit.mjs
 * Scene dimensions have no assigned physical scale. */
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {IRIS09_MECHANICS as M,solveIris09Input,iris09MechanicalFrame,iris09MechanicalFollower,iris09MechanicalBladeContour,iris09MechanicalBladeContains} from './iris09-kinematics.mjs';

const TAU=2*Math.PI;
const localPoint=(frame,x,z)=>{const dx=x-frame.hx,dz=z-frame.hz;return [frame.c*dx+frame.s*dz,-frame.s*dx+frame.c*dz];};
const outlineDistanceLowerBound=([x,z])=>Math.max(
 ...M.bladeCircles.map(([cx,cz,r])=>Math.hypot(x-cx,z-cz)-r),
 (M.bladeHalfPlane[0]*x+M.bladeHalfPlane[1]*z-M.bladeHalfPlane[2])/Math.hypot(...M.bladeHalfPlane.slice(0,2)));

/** Exact angular extrema for every vertex of the actual convex polygon.
 * Norm is convex on each edge/triangle, so the maximum is attained at a vertex. */
export function iris09RigidEnvelopeAudit(){
 let maximum=0,witness=null;
 for(const [x,z]of iris09MechanicalBladeContour()){
  const critical=-Math.atan2(z,x),angles=[0,M.maximumBladeAngle];
  for(let k=-1;k<=1;k++){const a=critical+k*TAU;if(a>0&&a<M.maximumBladeAngle)angles.push(a);}
  for(const angle of angles){
   const radius=Math.hypot(M.pivotRadius+x*Math.cos(angle)-z*Math.sin(angle),x*Math.sin(angle)+z*Math.cos(angle));
   if(radius>maximum){maximum=radius;witness={local:[x,z],bladeAngle:angle};}
  }
 }
 return {maximumRadius:maximum,wallRadius:M.cavityInner,minimumWallGap:M.cavityInner-maximum,witness,scope:'Continuous stroke, fixed tessellated convex outline; no elastic deformation'};
}

/** Constraint and foreign attachment checks; pose sampled, not general CCD. */
export function iris09ConstraintAudit(poseCount=181){
 if(!Number.isInteger(poseCount)||poseCount<2)throw new RangeError('At least two poses required');
 let maximumSlotResidual=0,minimumJacobian=Infinity,minimumSlotClearance=Infinity,minimumWrongBranchSeparation=Infinity;
 let minimumForeignPivotGap=Infinity,minimumForeignFollowerGap=Infinity,derivativeMin=Infinity,derivativeMax=0;
 for(let i=0;i<poseCount;i++){
  const s=solveIris09Input(M.inputMin+(M.inputMax-M.inputMin)*i/(poseCount-1));
  minimumJacobian=Math.min(minimumJacobian,s.constraintJacobian);derivativeMin=Math.min(derivativeMin,s.angleDerivative);derivativeMax=Math.max(derivativeMax,s.angleDerivative);
  const other=M.pivotRadius*Math.cos(s.slotAngle)-Math.sqrt(M.followerOffset**2-M.pivotRadius**2*Math.sin(s.slotAngle)**2);
  minimumWrongBranchSeparation=Math.min(minimumWrongBranchSeparation,M.slotInner-M.slotHalfWidth-other);
  const frames=Array.from({length:M.blades},(_,j)=>iris09MechanicalFrame(j,s));
  const followers=frames.map((_,j)=>iris09MechanicalFollower(j,s));
  for(let j=0;j<M.blades;j++){
   const a=j*TAU/M.blades+s.slotAngle,c=Math.cos(a),sin=Math.sin(a),[x,,z]=followers[j];
   const axial=x*c+z*sin,cross=-x*sin+z*c;
   maximumSlotResidual=Math.max(maximumSlotResidual,Math.abs(cross));
   const endDistance=Math.max(M.slotInner-axial,axial-M.slotOuter,0);
   minimumSlotClearance=Math.min(minimumSlotClearance,M.slotHalfWidth-M.followerPinRadius-Math.hypot(cross,endDistance));
   for(let k=0;k<M.blades;k++)if(k!==j){
    minimumForeignPivotGap=Math.min(minimumForeignPivotGap,outlineDistanceLowerBound(localPoint(frames[j],frames[k].hx,frames[k].hz))-M.pivotCapRadius);
    minimumForeignFollowerGap=Math.min(minimumForeignFollowerGap,outlineDistanceLowerBound(localPoint(frames[j],followers[k][0],followers[k][2]))-M.followerAttachmentRadius);
   }
  }
 }
 return {poseCount,maximumSlotResidual,minimumSlotClearance,minimumWrongBranchSeparation,minimumJacobian,
  bladeAngleDerivative:[derivativeMin,derivativeMax],minimumForeignPivotGap,minimumForeignFollowerGap,
  minimumBladeFaceGap:M.axialClearance,scope:'Nine blades over sampled stroke; analytic convex-outline distance lower bounds. Face gap exact for parallel slabs. No general continuous collision certification'};
}

/** Visible opening coverage. This is an aperture, NOT a light-tight shutter. */
export function iris09ApertureAudit({poseCount=19,azimuthCount=180,radialCount=240,radius=1.017}={}){
 let disconnectedGapSamples=0,centerExposedEveryPose=true,minApertureRadius=Infinity,maxApertureRadius=0,samples=0;
 for(let p=0;p<poseCount;p++){
  const s=solveIris09Input(M.inputMin+(M.inputMax-M.inputMin)*p/(poseCount-1));
  const frames=Array.from({length:M.blades},(_,i)=>iris09MechanicalFrame(i,s));
  const covered=(x,z)=>frames.some(f=>iris09MechanicalBladeContains(...localPoint(f,x,z)));
  centerExposedEveryPose&&=!covered(0,0);
  for(let k=0;k<azimuthCount;k++){
   const a=k*TAU/azimuthCount,c=Math.cos(a),sin=Math.sin(a);let started=false;
   for(let q=0;q<=radialCount;q++){
    const r=radius*q/radialCount,hit=covered(r*c,r*sin);samples++;
    if(hit&&!started){started=true;minApertureRadius=Math.min(minApertureRadius,r);maxApertureRadius=Math.max(maxApertureRadius,r);}
    else if(started&&!hit)disconnectedGapSamples++;
   }
  }
 }
 return {poseCount,azimuthCount,radialCount,visibleRadius:radius,samples,disconnectedGapSamples,centerExposedEveryPose,minApertureRadius,maxApertureRadius,
  scope:'Sampled normal-incidence coverage of analytic rigid outlines; finite tessellation reviewed separately. No shutter/full light-closure claim'};
}

export async function auditIris09Mechanics({poseCount=181}={}){
 const source=await readFile(new URL('./assets/iris09/IRIS-09.glsl',import.meta.url));
 const sourceHash=createHash('sha256').update(source).digest('hex');
 if(sourceHash!=='455e1ba9b0740a6ab925f9c022eea5f217fd3bbfc08ffec3177fb3b1d925843b')throw new Error('Recovered source changed; reference inventory needs re-audit');
 return {
  constructionRevision:'single-input-radial-slot-1',units:'Unscaled source units',certification:false,
  sourceReference:{name:'Recovered IRIS09 Revision III, unchanged',sha256:sourceHash,notCurrentMechanics:true,
   replacedDefects:['Independent prescribed leaf/lever time functions','Missing pivot/follower/drive-ring construction','Changing world-clipped rigid outline','Mounting bores cut only into ears, obstructed by housing']},
  implemented:{singleInputConstraintSolver:true,rigidPermanentLeafOutlines:true,bladePivotBearings:true,bladeFollowerPins:true,driveRingCamSlots:true,physicalStops:true,removableCarrier:true,
   forceDynamics:false,friction:false,stressOrDeflection:false,manufacturingTolerances:false},
  motion:{inputInterval:[M.inputMin,M.inputMax],ringStrokeDegrees:(M.inputMax-M.inputMin)*180/Math.PI,bladeStrokeRadians:[0,M.maximumBladeAngle],
   constraint:'cross(R*[cos(az),sin(az)]+L*[cos(az+theta),sin(az+theta)], slotAxis(az+input-inputMin))=0',
   branch:'Outer circle/radial-slot intersection; wrong branch cannot reach finite manufactured slots',
   virtualWork:'Ideal input torque = sum(signed blade resisting torques) * d(theta)/d(input); not a dynamic load simulation'},
  constraints:iris09ConstraintAudit(poseCount),rigidEnvelope:iris09RigidEnvelopeAudit(),aperture:iris09ApertureAudit(),
  construction:{pivotPosts:'Integral carrier bosses/shoulders with separately fitted retaining caps',carrier:'Removable annulus on three floor-supported standoffs with through-bores and screw shafts',
   followers:'Lower retained shafts installed into cam ring before carrier; upper heads attached after blades; ideal fixed riveted blade joint',
   ringSupport:'Fixed inner journal, lower thrust shoulder, removable upper washer captured beneath carrier',
   inspection:'Internal linkage is largely hidden beneath the source face cover in the normal presentation'},
  limitations:[
   'The leaves modulate an open aperture; they are not a fully closing light-tight shutter.',
   'Carrier screw thread engagement, pivot cap retention and fixed follower riveting are idealized; helical threads, fit tolerances and clamp preload are not modeled.',
   'Original exterior screw heads remain appearance details rather than complete modeled fasteners.',
   'No mass, inertia, force/contact integration, friction, elastic material, fatigue or stress model; unspecified physical scale.',
   'Numerical and mesh tests validate the authored rigid kinematic arrangement, not a manufactured mechanism.'
  ]
 };
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const report=JSON.stringify(await auditIris09Mechanics(),null,2),outputIndex=process.argv.indexOf('--output');
 if(outputIndex>=0){
  const path=process.argv[outputIndex+1];if(!path)throw new Error('--output requires a path');
  await writeFile(path,report+'\n','utf8');console.log(path);
 }else console.log(report);
}
