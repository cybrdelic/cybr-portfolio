/** Single-input radial-slot iris. Dimensions are unscaled source units. */
const TAU=2*Math.PI;
const pivotRadius=1.16,followerOffset=.20,maximumBladeAngle=.9;
const maximumSlotAngle=Math.atan2(followerOffset*Math.sin(maximumBladeAngle),pivotRadius+followerOffset*Math.cos(maximumBladeAngle));
export const IRIS09_MECHANICS=Object.freeze({
 blades:9,pivotRadius,followerOffset,maximumBladeAngle,maximumSlotAngle,inputCenter:.16,
 inputMin:.16-maximumSlotAngle/2,inputMax:.16+maximumSlotAngle/2,
 thickness:.00065,axialClearance:.00035,firstBladeTop:.260,
 pivotPinRadius:.018,pivotBoreRadius:.020,pivotCapRadius:.030,
 followerPinRadius:.014,followerAttachmentRadius:.021,
 slotHalfWidth:.016,slotInner:1.283,slotOuter:1.372,
 driveRingInner:1.245,driveRingOuter:1.410,driveRingBottom:.208,driveRingTop:.220,
 carrierInner:1.100,carrierOuter:1.454,carrierBottom:.233,carrierTop:.243,
 carrierMountRadius:1.435,carrierMountPhase:1.05,carrierMountBore:.013,
 carrierStandRadius:.019,carrierScrewRadius:.012,
 carrierFollowerClearance:.019,bladeRadialEnvelope:1.432,
 cavityInner:1.458,cavityBottom:.195,cavityTop:.510,
 bladeCircles:Object.freeze([
  Object.freeze([.69,.17,1.44]),Object.freeze([.25,1.20,1.60]),
  ...[0,.225,.45,.675,.9].map(a=>Object.freeze([-pivotRadius*Math.cos(a),pivotRadius*Math.sin(a),1.430]))
 ]),
 // Fixed blade-local straight root relief, not a changing world-space clip.
 bladeHalfPlane:Object.freeze([.9,1,.38]),
 assumptions:Object.freeze(['Rigid blades and pins; no elastic deformation','Parallel blade stack with .00035 axial face clearance','Follower pin/slot nominal radial clearance .002','Follower-to-blade joint is an ideal fixed riveted attachment, not a clearance bearing','Removable carrier on three clamped standoffs; screw thread engagement is idealized','No friction, dynamic torque, load or stress simulation','Unspecified physical scale and fabrication tolerances'])
});

export function iris09InputFromTime(time){
 if(!Number.isFinite(time))throw new TypeError('IRIS time must be finite');
 const m=IRIS09_MECHANICS;
 return m.inputMin+(m.inputMax-m.inputMin)*(.5+.5*Math.cos(time*Math.PI/10));
}

/** Solve cross(follower, rotating radial slot axis)=0 on the unique 0..0.9 branch. */
export function solveIris09Input(input){
 const m=IRIS09_MECHANICS;
 if(!Number.isFinite(input)||input<m.inputMin-1e-12||input>m.inputMax+1e-12)throw new RangeError('IRIS drive ring outside hard-stop interval');
 const slotAngle=Math.max(0,Math.min(m.maximumSlotAngle,input-m.inputMin));
 const ratio=m.pivotRadius/m.followerOffset*Math.sin(slotAngle);
 const bladeAngle=slotAngle+Math.asin(Math.max(-1,Math.min(1,ratio)));
 const followerRadius=m.pivotRadius*Math.cos(slotAngle)+m.followerOffset*Math.cos(bladeAngle-slotAngle);
 const constraintJacobian=m.followerOffset*Math.cos(bladeAngle-slotAngle);
 return {input,slotAngle,bladeAngle,followerRadius,constraintJacobian,
  angleDerivative:1+m.pivotRadius*Math.cos(slotAngle)/constraintJacobian};
}

export function iris09MechanicalFrame(index,state){
 const m=IRIS09_MECHANICS,azimuth=index*TAU/m.blades,angle=azimuth+state.bladeAngle;
 return {index,azimuth,angle,c:Math.cos(angle),s:Math.sin(angle),hx:m.pivotRadius*Math.cos(azimuth),hz:m.pivotRadius*Math.sin(azimuth),
  top:m.firstBladeTop+index*(m.thickness+m.axialClearance),bottom:m.firstBladeTop+index*(m.thickness+m.axialClearance)-m.thickness};
}

export function iris09MechanicalBladeContains(x,z,{holes=true}={}){
 const m=IRIS09_MECHANICS;
 if(m.bladeHalfPlane[0]*x+m.bladeHalfPlane[1]*z>m.bladeHalfPlane[2]+1e-10)return false;
 if(!m.bladeCircles.every(([cx,cz,r])=>(x-cx)**2+(z-cz)**2<=r*r+1e-10))return false;
 if(holes&&(x*x+z*z<m.pivotBoreRadius**2||(x-m.followerOffset)**2+z*z<m.followerPinRadius**2))return false;
 return true;
}

export function iris09MechanicalBladeContour(segments=192){
 const m=IRIS09_MECHANICS,points=[],circles=m.bladeCircles,[nx,nz,d]=m.bladeHalfPlane;
 const accept=p=>{if(iris09MechanicalBladeContains(p[0],p[1],{holes:false})&&!points.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<1e-9))points.push(p);};
 for(const [x,z,r]of circles){
  for(let i=0;i<segments;i++){const a=i*TAU/segments;accept([x+r*Math.cos(a),z+r*Math.sin(a)]);}
  const nn=nx*nx+nz*nz,t=(d-nx*x-nz*z)/nn,fx=x+nx*t,fz=z+nz*t,h2=r*r-t*t*nn;
  if(h2>=0){const h=Math.sqrt(h2/nn);accept([fx-nz*h,fz+nx*h]);accept([fx+nz*h,fz-nx*h]);}
 }
 for(let i=0;i<circles.length;i++)for(let j=i+1;j<circles.length;j++){
  const [x,z,r]=circles[i],[xx,zz,rr]=circles[j],dx=xx-x,dz=zz-z,l=Math.hypot(dx,dz);
  if(l<1e-10||l>r+rr||l<Math.abs(r-rr))continue;
  const u=(r*r-rr*rr+l*l)/(2*l),v=Math.sqrt(Math.max(0,r*r-u*u)),mx=x+dx*u/l,mz=z+dz*u/l;
  accept([mx-dz*v/l,mz+dx*v/l]);accept([mx+dz*v/l,mz-dx*v/l]);
 }
 const cx=points.reduce((v,p)=>v+p[0],0)/points.length,cz=points.reduce((v,p)=>v+p[1],0)/points.length;
 return points.sort((a,b)=>Math.atan2(a[1]-cz,a[0]-cx)-Math.atan2(b[1]-cz,b[0]-cx));
}

export function iris09MechanicalFollower(index,state){
 const f=iris09MechanicalFrame(index,state),l=IRIS09_MECHANICS.followerOffset;
 return [f.hx+l*f.c,f.top,f.hz+l*f.s];
}

/** Ideal virtual work only: no friction, inertia or structural strength model. */
export function iris09IdealInputTorque(state,bladeResistingTorques){
 if(bladeResistingTorques.length!==IRIS09_MECHANICS.blades||bladeResistingTorques.some(t=>!Number.isFinite(t)))throw new TypeError('Provide nine finite signed blade torques');
 return bladeResistingTorques.reduce((sum,t)=>sum+t,0)*state.angleDerivative;
}
