// Nominal geometry, in scene units: 1 unit = 20 mm. No force solver is implied.
export const SPEC=Object.freeze({mm:20,teeth:120,pinionTeeth:24,module:.05,pressure:Math.PI/9,pivot:1.55,stroke:-60*Math.PI/180,bladeStroke:35*Math.PI/180,bladeThickness:.018,bladePitch:.032,pinRadius:.035,slotRadius:.045,leafEnvelope:2.12,pinionAngle:-Math.PI/6,motorTorqueNm:.025,efficiency:.85});
export const rotate=([x,y],a)=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)];
export const add=(a,b)=>[a[0]+b[0],a[1]+b[1]];
const clamp=x=>Math.max(0,Math.min(1,x));
export function pose(u){u=clamp(u);const ring=u===0?0:u*SPEC.stroke;return {ring,pinion:-ring*SPEC.teeth/SPEC.pinionTeeth,blade:-u*SPEC.bladeStroke,encoder:(Math.round(ring/(2*Math.PI)*4096)+4096)%4096,home:u<.025};}
export function pivot(i){return rotate([SPEC.pivot,0],i*Math.PI/3);}
export function follower(i,u){return rotate(add([SPEC.pivot,0],rotate([.1,1.5],pose(u).blade)),i*Math.PI/3);}
export function camPoint(i,u){return rotate(follower(i,u),-pose(u).ring);}
export function camPath(i,samples=96){return Array.from({length:samples+1},(_,j)=>camPoint(i,j/samples));}
function clip(poly,n,d){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=a[0]*n[0]+a[1]*n[1]-d,db=b[0]*n[0]+b[1]*n[1]-d;if(da<=1e-10)out.push(a);if((da<0)!==(db<0)){const t=da/(da-db);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}return out;}
export function bladeOutline(){
  let p=[[-3,-3],[3,-3],[3,3],[-3,3]];
  const beta=80*Math.PI/180;p=clip(p,[-Math.cos(beta),-Math.sin(beta)],.015);
  // Intersect inverse-transformed outer envelopes: a single RIGID blank fits
  // the circular cavity throughout the prescribed pivot stroke.
  for(let step=0;step<=64;step++){const a=-SPEC.bladeStroke*step/64;for(let j=0;j<128;j++){const n=rotate([1,0],j*Math.PI/64),local=rotate(n,-a),shift=add([SPEC.pivot,0],rotate([-SPEC.pivot,0],a));p=clip(p,local,SPEC.leafEnvelope*Math.cos(Math.PI/128)-n[0]*shift[0]-n[1]*shift[1]);}
    for(let k=1;k<6;k++){const v=pivot(k),q=add([SPEC.pivot,0],rotate([v[0]-SPEC.pivot,v[1]],-a)),length=Math.hypot(...q);p=clip(p,[q[0]/length,q[1]/length],length-.065);}}
  return p.map(v=>[v[0]-SPEC.pivot,v[1]]);
}
export function posedBlade(points,i,u){return points.map(p=>rotate(add([SPEC.pivot,0],rotate(p,pose(u).blade)),i*Math.PI/3));}
export function contains(poly,p){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function gearOutline(teeth){
  const r=SPEC.module*teeth/2,rb=r*Math.cos(SPEC.pressure),ra=r+SPEC.module,rf=r-1.25*SPEC.module;
  const inv=a=>Math.tan(a)-a,half=Math.PI/(2*teeth)-.001/r; // 0.04 mm total pitch backlash
  const width=radius=>half+inv(SPEC.pressure)-inv(Math.acos(Math.min(1,rb/radius)));
  const points=[];for(let i=0;i<teeth;i++){const a=i*2*Math.PI/teeth,base=Math.max(rb,rf);points.push(rotate([rf,0],a-width(base)));for(let k=0;k<=7;k++){const rr=base+(ra-base)*k/7;points.push(rotate([rr,0],a-width(rr)));}for(let k=7;k>=0;k--){const rr=base+(ra-base)*k/7;points.push(rotate([rr,0],a+width(rr)));}points.push(rotate([rf,0],a+width(base)));}return points;
}
export function gearMetrics(){const r1=SPEC.module*SPEC.pinionTeeth/2,r2=SPEC.module*SPEC.teeth/2,a=r1+r2,pa=SPEC.pressure;const contact=(Math.sqrt((r1+SPEC.module)**2-(r1*Math.cos(pa))**2)+Math.sqrt((r2+SPEC.module)**2-(r2*Math.cos(pa))**2)-a*Math.sin(pa))/(Math.PI*SPEC.module*Math.cos(pa));const ft=SPEC.motorTorqueNm/(r1*SPEC.mm/1000);return {ratio:SPEC.teeth/SPEC.pinionTeeth,centerDistanceMm:a*SPEC.mm,contactRatio:contact,tangentialForceN:ft,radialForceN:ft*Math.tan(pa),idealOutputTorqueNm:SPEC.motorTorqueNm*SPEC.teeth/SPEC.pinionTeeth*SPEC.efficiency,bladeGapMm:(SPEC.bladePitch-SPEC.bladeThickness)*SPEC.mm,slotDiametralClearanceMm:2*(SPEC.slotRadius-SPEC.pinRadius)*SPEC.mm};}
export function loadCase(u){
  const a=camPoint(0,Math.max(0,u-1e-5)),b=camPoint(0,Math.min(1,u+1e-5));
  const tangent=[b[0]-a[0],b[1]-a[1]],length=Math.hypot(...tangent);
  const normal=rotate([-tangent[1]/length,tangent[0]/length],pose(u).ring),q=follower(0,u),lever=Math.abs(q[0]*normal[1]-q[1]*normal[0])*SPEC.mm/1000;
  const v=rotate([-1.5,.1],pose(u).blade),pressure=Math.acos(Math.min(1,Math.abs(v[0]*normal[0]+v[1]*normal[1])/Math.hypot(...v)));
  const diameter=.19*SPEC.mm/1000;
  return {rollerForceN:gearMetrics().idealOutputTorqueNm/(6*lever),pressureAngleDegrees:pressure*180/Math.PI,shaftTorsionalStressMPa:16*SPEC.motorTorqueNm/(Math.PI*diameter**3)/1e6};
}
