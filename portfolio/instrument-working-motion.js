import * as THREE from './vendor/three-r180/three.module.min.js';

// Geometry, route and rig coordinates are millimetres in the CAD Z-up frame.
// This controller never reads a photograph, old beauty bake, or fluid phase.
const TAU=Math.PI*2, names=['geo','light','elements','song','combat','scenes'];
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10);};
const mix=(a,b,t)=>a+(b-a)*t;
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const d=Math.hypot(...a);return d?a.map(v=>v/d):[1,0,0];};
const radians=d=>d*Math.PI/180;
export const workingLength=points=>points.slice(1).reduce((s,p,i)=>s+dist(p,points[i]),0);

// Shared by the browser and numerical mesh audit. The transported frame is
// right handed (tangent, normal, binormal); triangle winding points outward.
export function createWorkingTubeBuffers(segments,sides=16){
  const capBase=(segments+1)*(sides+1),count=capBase+2*(sides+2),positions=new Float32Array(count*3),normals=new Float32Array(count*3),uv=new Float32Array(count*2),indices=[];
  for(let i=0;i<=segments;i++)for(let j=0;j<=sides;j++){
    const k=i*(sides+1)+j;uv[k*2]=i/segments;uv[k*2+1]=j/sides;
    if(i<segments&&j<sides){const a=k,b=k+sides+1;indices.push(a,a+1,b,b,a+1,b+1);}
  }
  for(let end=0;end<2;end++){
    const base=capBase+end*(sides+2),center=base+sides+1;
    for(let j=0;j<=sides;j++){uv[(base+j)*2]=.5+.5*Math.cos(j/sides*TAU);uv[(base+j)*2+1]=.5+.5*Math.sin(j/sides*TAU);}
    uv[center*2]=uv[center*2+1]=.5;
    for(let j=0;j<sides;j++)if(end===0)indices.push(center,base+j+1,base+j);else indices.push(center,base+j,base+j+1);
  }
  return {positions,normals,uv,indices,capBase,segments,sides};
}

function curvatureRadius(v,a){const c=Math.hypot(...cross(v,a));return c>1e-12?Math.hypot(...v)**3/c:Infinity;}
function spanAt(a,b,t){
  const d=sub(b,a),s=t*t*(3-2*t),sag=Math.min(3,d[0]*.035);
  return {point:[a[0]+d[0]*t,a[1]+d[1]*s,a[2]+d[2]*s-sag*Math.sin(Math.PI*t)**2],
    tangent:[d[0],d[1]*6*t*(1-t),d[2]*6*t*(1-t)-sag*Math.PI*Math.sin(TAU*t)],
    acceleration:[0,d[1]*(6-12*t),d[2]*(6-12*t)-2*sag*Math.PI**2*Math.cos(TAU*t)]};
}
export function workingSpan(a,b,count=96){
  if(b[0]<=a[0])throw new Error('A working connector must advance along +X.');
  return Array.from({length:count+1},(_,i)=>spanAt(a,b,i/count).point);
}
export function workingSpanRadius(a,b,count=256){
  let radius=Infinity;
  for(let i=0;i<=count;i++){const s=spanAt(a,b,i/count);radius=Math.min(radius,curvatureRadius(s.tangent,s.acceleration));}
  return radius;
}
export function requiredPortGap(a,b,minimumRadius){
  const end=[0,b[1]-a[1],b[2]-a[2]],start=[0,0,0];
  let lo=8,hi=8;
  while(workingSpanRadius(start,[hi,end[1],end[2]])<minimumRadius*1.015&&hi<2000)hi*=1.5;
  if(hi>=2000)throw new Error('The port offset cannot be routed within the supported assembly envelope.');
  for(let i=0;i<36;i++){const mid=(lo+hi)/2;if(workingSpanRadius(start,[mid,end[1],end[2]])<minimumRadius*1.015)lo=mid;else hi=mid;}
  return hi;
}

function coilAt(t,turns,spec){
  const r=spec.radius*Math.sin(Math.PI*t)**2,r1=spec.radius*Math.PI*Math.sin(TAU*t),r2=2*spec.radius*Math.PI**2*Math.cos(TAU*t);
  const angle=TAU*turns*t,w=TAU*turns,c=Math.cos(angle),s=Math.sin(angle),dx=spec.x1-spec.x0;
  return {point:[spec.x0+dx*t,r*c,r*s],tangent:[dx,r1*c-r*w*s,r1*s+r*w*c],
    acceleration:[0,(r2-r*w*w)*c-2*r1*w*s,(r2-r*w*w)*s+2*r1*w*c]};
}
export function workingTakeup(turns,spec,count=640){
  const points=[spec.entry.slice(),[spec.x0-5,0,0]];
  for(let i=0;i<=count;i++)points.push(coilAt(i/count,turns,spec).point);
  points.push([spec.x1+7,0,0],spec.exit.slice());return points;
}
export function workingTakeupRadius(turns,spec){let radius=Infinity;for(let i=0;i<=1024;i++){const p=coilAt(i/1024,turns,spec);radius=Math.min(radius,curvatureRadius(p.tangent,p.acceleration));}return radius;}
const coilRadius=workingTakeupRadius;
function sweptBoreMargin(points,radius,zones){
  let margin=Infinity,worst=null;
  for(const zone of zones){let outer=0;for(const p of points)if(p[0]>=zone.x[0]-radius&&p[0]<=zone.x[1]+radius)outer=Math.max(outer,Math.hypot(p[1],p[2])+radius);
    const clearance=zone.innerRadiusMM-outer;if(clearance<margin){margin=clearance;worst=zone.name;}}
  return {margin,worst};
}
function segmentDistance(a,b,c,d){
  const u=sub(b,a),v=sub(d,c),w=sub(a,c),A=dot(u,u),B=dot(u,v),C=dot(v,v),D=dot(u,w),E=dot(v,w),den=A*C-B*B;
  let s=den>1e-18?clamp((B*E-C*D)/den):0,t=C>1e-18?clamp((B*s+E)/C):0;
  if(A>1e-18)s=clamp((B*t-D)/A);if(C>1e-18)t=clamp((B*s+E)/C);
  return Math.hypot(...w.map((x,i)=>x+s*u[i]-t*v[i]));
}
export function nonlocalRouteDistance(points,excludedArcMM=15){
  const arc=[0];for(let i=1;i<points.length;i++)arc.push(arc[i-1]+dist(points[i-1],points[i]));
  const monotonic=points.every((p,i)=>!i||p[0]>=points[i-1][0]-1e-9);
  let separation=Infinity;
  for(let i=0;i<points.length-1;i++)for(let j=i+2;j<points.length-1;j++)if(arc[j]-arc[i+1]>=excludedArcMM){
    // Cheap bounding sphere lower bound before the exact segment distance.
    const a=points[i],b=points[i+1],c=points[j],d=points[j+1];
    if(monotonic&&c[0]-b[0]>=separation)break;
    if(dist(a,c)-dist(a,b)-dist(c,d)<separation)separation=Math.min(separation,segmentDistance(a,b,c,d));
  }
  return separation;
}

// The inspection camera follows these exact sampled CAD wires and connectors.
// Arc-length lookup avoids refitting a global spline which could overshoot ports.
class SampledRoute extends THREE.Curve{
  constructor(points){super();this.points=points.map(p=>new THREE.Vector3(...p));this.arc=[0];for(let i=1;i<points.length;i++)this.arc.push(this.arc.at(-1)+dist(points[i-1],points[i]));this.total=this.arc.at(-1);}
  getPoint(t,target=new THREE.Vector3()){return this.getPointAt(t,target);}
  getPointAt(t,target=new THREE.Vector3()){
    const distance=clamp(t)*this.total;let lo=0,hi=this.arc.length-1;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(this.arc[mid]<=distance)lo=mid;else hi=mid;}
    const span=this.arc[hi]-this.arc[lo];return target.copy(this.points[lo]).lerp(this.points[hi],span?(distance-this.arc[lo])/span:0);
  }
  getTangentAt(t,target=new THREE.Vector3()){
    const distance=clamp(t)*this.total;let lo=0,hi=this.arc.length-1;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(this.arc[mid]<=distance)lo=mid;else hi=mid;}
    return target.copy(this.points[hi]).sub(this.points[lo]).normalize();
  }
}

function descriptorFor(mesh,manifest){
  if(mesh.motion)return mesh.motion;
  const rigs=manifest.partRig||manifest.metadata?.partRig;
  if(rigs&&mesh.partNames?.length){const descriptors=mesh.partNames.map(n=>rigs[n]).filter(Boolean);if(descriptors.length)return descriptors[0];}
  return null;
}
function thetaForProgress(p,rig){
  const t=clamp((p-.46)/.44),mid=(rig.minAngleDeg+rig.maxAngleDeg)/2,amplitude=(rig.maxAngleDeg-rig.minAngleDeg)/2;
  // One bounded exercise, returning to the reference pose at both ends.
  return p>.46&&p<.9?mid+amplitude*Math.sin(TAU*t):rig.referenceAngleDeg;
}
export function workingRigMatrix(motion,theta,rig,shift=0){
  const matrix=new THREE.Matrix4();
  if(motion?.rig==='combat'&&motion.kind==='rocker'){
    const pivot=new THREE.Vector3(...motion.pivot),axis=new THREE.Vector3(...(motion.axis||[0,1,0])).normalize();
    matrix.makeTranslation(pivot.x,pivot.y,pivot.z).multiply(new THREE.Matrix4().makeRotationAxis(axis,radians(rig.referenceAngleDeg-theta))).multiply(new THREE.Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z));
  }else if(motion?.rig==='combat'&&motion.kind==='deck'){
    const a=radians(theta),r=radians(rig.referenceAngleDeg),L=rig.linkLengthMM;
    matrix.makeTranslation(L*(Math.cos(a)-Math.cos(r)),0,L*(Math.sin(a)-Math.sin(r)));
  }
  matrix.elements[12]+=shift;return matrix;
}
function exactCoordinateRange(a,b,c,lo,hi){
  let minimum=Math.min(a*Math.cos(lo)+b*Math.sin(lo)+c,a*Math.cos(hi)+b*Math.sin(hi)+c),maximum=Math.max(a*Math.cos(lo)+b*Math.sin(lo)+c,a*Math.cos(hi)+b*Math.sin(hi)+c);
  const phase=Math.atan2(b,a);for(let k=-3;k<=3;k++){const angle=phase+k*Math.PI;if(angle>=lo&&angle<=hi){const v=a*Math.cos(angle)+b*Math.sin(angle)+c;minimum=Math.min(minimum,v);maximum=Math.max(maximum,v);}}
  return [minimum,maximum];
}
function corners(box){const p=[];for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z])p.push([x,y,z]);return p;}
function motionBounds(object,motion,rig,assemblyShift){
  const result=new THREE.Box3();object.geometry.computeBoundingBox();
  for(const p of corners(object.geometry.boundingBox)){
    let low=p.slice(),high=p.slice();
    if(motion?.rig==='combat'&&motion.kind==='rocker'){
      const axis=norm(motion.axis||[0,1,0]),q=sub(p,motion.pivot),parallel=axis.map(v=>v*dot(axis,q)),perpendicular=sub(q,parallel),turn=cross(axis,q);
      const angles=[radians(rig.referenceAngleDeg-rig.maxAngleDeg),radians(rig.referenceAngleDeg-rig.minAngleDeg)];
      for(let i=0;i<3;i++)[low[i],high[i]]=exactCoordinateRange(perpendicular[i],turn[i],motion.pivot[i]+parallel[i],angles[0],angles[1]);
    }else if(motion?.rig==='combat'&&motion.kind==='deck'){
      const ref=radians(rig.referenceAngleDeg),L=rig.linkLengthMM,angles=[radians(rig.minAngleDeg),radians(rig.maxAngleDeg)];
      [low[0],high[0]]=exactCoordinateRange(L,0,p[0]-L*Math.cos(ref),...angles);
      [low[2],high[2]]=exactCoordinateRange(0,L,p[2]-L*Math.sin(ref),...angles);
    }
    low[0]+=Math.min(0,assemblyShift);high[0]+=Math.max(0,assemblyShift);
    result.expandByPoint(new THREE.Vector3(...low));result.expandByPoint(new THREE.Vector3(...high));
  }
  return result;
}
function routeTable(manifest,route){
  const records=manifest.routes||manifest.metadata?.routes||route.routes||[];
  const map=new Map(records.map(record=>[record.module||names.find(n=>record.name===n||record.name?.startsWith(n+'_'))||record.name,record]));
  for(const name of names){if(name==='geo')continue;
    if(!map.has(name)&&route.internalRoutes?.[name])map.set(name,{name,points:route.internalRoutes[name],interpolation:route.internalInterpolation||'sampled-linear',entryTangent:[1,0,0],exitTangent:[1,0,0]});
    const record=map.get(name);if(!record?.points?.length)throw new Error(`Working CAD package is missing the authoritative ${name} wire.`);
    if((record.interpolation||record.mode)!=='sampled-linear')throw new Error(`${name}: working wire must use the exported CAD samples.`);
    if(dist(record.points[0],route.ports[name][0])>1e-4||dist(record.points.at(-1),route.ports[name][1])>1e-4)throw new Error(`${name}: CAD wire endpoints differ from its ports.`);
  }
  return map;
}

export function createWorkingMotion({manifest,route,groups,objects,cables=[]}){
  if(!manifest.workingGeometry)throw new Error('Working motion requires an explicit CAD workingGeometry package.');
  const rig=manifest.kinematics?.combat||manifest.metadata?.kinematics?.combat;
  if(!rig||!Number.isFinite(rig.linkLengthMM)||rig.minAngleDeg>=rig.maxAngleDeg)throw new Error('Missing working four-bar dimensions.');
  const radius=route.cableRadius,minimumRadius=route.minBendRadiusMM||manifest.routing?.minBendRadiusMM||12,gap=manifest.routing?.minimumHousingGapMM||8;
  const internal=routeTable(manifest,route),records=objects.map(object=>{const mesh=object.userData.meshRecord||{};return {object,mesh,motion:descriptorFor(mesh,manifest),shift:mesh.assemblyShiftX||0};});
  const envelopes=new Map(names.map(n=>[n,new THREE.Box3()]));
  for(const record of records){record.bounds=motionBounds(record.object,record.motion,rig,record.shift);envelopes.get(record.mesh.module).union(record.bounds);record.object.matrixAutoUpdate=false;}
  const sourceAssembled=route.assembled||manifest.modules.map(m=>m.assembledX),assembled=[],minimumSpans=[];
  for(let i=0;i<names.length;i++){
    const name=names[i],box=envelopes.get(name);if(box.isEmpty())throw new Error(`Working module ${name} has no geometry.`);
    if(i===0){assembled.push(sourceAssembled[0]);continue;}
    const previous=names[i-1],previousBox=envelopes.get(previous),spanGap=requiredPortGap(route.ports[previous][1],route.ports[name][0],minimumRadius);minimumSpans.push(spanGap);
    assembled.push(Math.max(sourceAssembled[i],assembled[i-1]+previousBox.max.x-box.min.x+gap,assembled[i-1]+route.ports[previous][1][0]-route.ports[name][0][0]+spanGap));
  }
  const takeupMetadata=manifest.routing?.takeup||route.takeup||{};
  const x0=takeupMetadata.x0??-35,x1=takeupMetadata.x1??35,coilClearance=takeupMetadata.minimumClearanceMM??.2;
  const takeupSpec={x0,x1,entry:route.ports.geo[0],exit:route.ports.geo[1],radius:Math.min(takeupMetadata.maximumRadiusMM??22,(x1-x0)**2/(2*Math.PI**2*minimumRadius*1.035))};
  const zones=takeupMetadata.boreEnvelope||[
    {name:'rear service',x:[-47,-35],innerRadiusMM:2.8},{name:'rear guide',x:[-35.6,-34.4],innerRadiusMM:4},
    {name:'inner barrel',x:[-33,8],innerRadiusMM:29},{name:'bearing',x:[17,31],innerRadiusMM:22},
    {name:'front guide',x:[34.4,35.6],innerRadiusMM:4},{name:'front service',x:[35,61],innerRadiusMM:2.8}];
  const minimumTurns=takeupMetadata.minimumTurns??.25;let low=minimumTurns,high=minimumTurns;
  while(coilRadius(high,takeupSpec)>=minimumRadius*1.01&&high<12){low=high;high+=.25;}
  for(let i=0;i<30;i++){const mid=(low+high)/2;if(coilRadius(mid,takeupSpec)<minimumRadius*1.01)high=mid;else low=mid;}
  const maximumTurns=low,minTakeup=workingLength(workingTakeup(minimumTurns,takeupSpec)),maxTakeup=workingLength(workingTakeup(maximumTurns,takeupSpec));
  const bore=sweptBoreMargin(workingTakeup(maximumTurns,takeupSpec),radius,zones);
  if(bore.margin<coilClearance)throw new Error(`The swept takeup jacket exceeds ${bore.worst} clearance (${bore.margin.toFixed(3)} mm).`);
  const selfDistance=nonlocalRouteDistance(workingTakeup(maximumTurns,takeupSpec));
  if(selfDistance<2*radius+.25)throw new Error('The takeup jacket intersects another turn.');
  const capacity=maxTakeup-minTakeup,seedExploded=manifest.modules.map(m=>m.explodedX),baseExploded=[seedExploded[0]],desired=[];
  for(let i=1;i<names.length;i++)desired.push(Math.max(0,(seedExploded[i]-seedExploded[i-1])-(assembled[i]-assembled[i-1])));
  const desiredTotal=desired.reduce((s,v)=>s+v,0),usableCapacity=capacity*.94,scale=desiredTotal?Math.min(1,usableCapacity/desiredTotal):0;
  for(let i=1;i<names.length;i++)baseExploded.push(baseExploded[i-1]+assembled[i]-assembled[i-1]+desired[i-1]*scale);
  const centersAt=c=>assembled.map((v,i)=>mix(baseExploded[i],v,c));
  const spansAt=centers=>names.slice(0,-1).map((name,i)=>workingSpan(add(route.ports[name][1],[centers[i],0,0]),add(route.ports[names[i+1]][0],[centers[i+1],0,0])));
  const externalLength=centers=>spansAt(centers).reduce((sum,points)=>sum+workingLength(points),0);
  const totalCableLength=externalLength(baseExploded)+minTakeup,assembledTakeup=totalCableLength-externalLength(assembled);
  if(assembledTakeup>maxTakeup+1e-5)throw new Error('Exploded layout exceeds measured takeup capacity.');
  const lookup=Array.from({length:129},(_,i)=>{const turns=mix(minimumTurns,maximumTurns,i/128);return {turns,length:workingLength(workingTakeup(turns,takeupSpec))};});
  function turnsForLength(wanted){
    if(wanted<minTakeup-1e-5||wanted>maxTakeup+1e-5)throw new Error('Working cable length exceeds its physical takeup range.');
    let lo=0,hi=lookup.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(lookup[mid].length<=wanted)lo=mid;else hi=mid;}
    let turns=mix(lookup[lo].turns,lookup[hi].turns,clamp((wanted-lookup[lo].length)/(lookup[hi].length-lookup[lo].length)));
    // One secant correction preserves cable length to sub-micron precision.
    const actual=workingLength(workingTakeup(turns,takeupSpec)),derivative=(lookup[hi].length-lookup[lo].length)/(lookup[hi].turns-lookup[lo].turns);
    turns=Math.max(minimumTurns,Math.min(maximumTurns,turns+(wanted-actual)/derivative));return turns;
  }
  let condense=-1,theta=rig.referenceAngleDeg,progress=0,inspectionRoute,lastRoutes=[],lastCoil=[],currentTakeup=minTakeup,lastLengthError=0;
  const tangent=new THREE.Vector3(),normal=new THREE.Vector3(),previousTangent=new THREE.Vector3(),rotation=new THREE.Quaternion(),binormal=new THREE.Vector3();
  function writeTube(cable,points,coilTurns){
    if(points.length!==cable.segments+1)throw new Error('Cable tube sample count differs from its route.');
    normal.set(0,1,0);previousTangent.set(1,0,0);
    for(let i=0;i<points.length;i++){
      const direction=cable.from[0]==='takeup'
        ?(i>=2&&i<=points.length-3?coilAt((i-2)/(points.length-5),coilTurns,takeupSpec).tangent:[1,0,0])
        :spanAt(points[0],points.at(-1),i/cable.segments).tangent;
      tangent.set(...direction).normalize();
      rotation.setFromUnitVectors(previousTangent,tangent);normal.applyQuaternion(rotation);normal.addScaledVector(tangent,-normal.dot(tangent)).normalize();binormal.crossVectors(tangent,normal).normalize();previousTangent.copy(tangent);
      for(let j=0;j<=cable.sides;j++){
        const angle=j/cable.sides*TAU,c=Math.cos(angle),s=Math.sin(angle),k=(i*(cable.sides+1)+j)*3;
        for(let axis=0;axis<3;axis++){const n=normal.getComponent(axis)*c+binormal.getComponent(axis)*s;cable.normals[k+axis]=n;cable.positions[k+axis]=points[i][axis]+radius*n;}
      }
    }
    if(cable.capBase!==null&&cable.capBase!==undefined)for(let end=0;end<2;end++){
      const base=cable.capBase+end*(cable.sides+2),center=base+cable.sides+1,ring=end?cable.segments*(cable.sides+1):0,point=points[end?points.length-1:0];
      const capTangent=cable.from[0]==='takeup'?[1,0,0]:norm(spanAt(points[0],points.at(-1),end).tangent);
      for(let j=0;j<=cable.sides;j++)for(let axis=0;axis<3;axis++){
        cable.positions[(base+j)*3+axis]=cable.positions[(ring+j)*3+axis];cable.normals[(base+j)*3+axis]=(end?1:-1)*capTangent[axis];
      }
      for(let axis=0;axis<3;axis++){cable.positions[center*3+axis]=point[axis];cable.normals[center*3+axis]=(end?1:-1)*capTangent[axis];}
    }
    cable.geometry.attributes.position.needsUpdate=true;cable.geometry.attributes.normal.needsUpdate=true;cable.geometry.computeBoundingSphere();
  }
  function setProgress(p){
    progress=clamp(p);const next=smooth((progress-.035)/.245);theta=thetaForProgress(progress,rig);
    if(Math.abs(next-condense)>1e-8){
      condense=next;const centers=centersAt(condense);for(let i=0;i<names.length;i++)groups.get(names[i]).position.x=centers[i];
      lastRoutes=spansAt(centers);const external=lastRoutes.reduce((sum,points)=>sum+workingLength(points),0),wanted=totalCableLength-external,turns=turnsForLength(wanted);
      lastCoil=workingTakeup(turns,takeupSpec).map(point=>add(point,[centers[0],0,0]));currentTakeup=workingLength(lastCoil);lastLengthError=Math.abs(currentTakeup+external-totalCableLength);
      let spanIndex=0;for(const cable of cables)writeTube(cable,cable.from[0]==='takeup'?lastCoil:lastRoutes[spanIndex++],turns);
      const path=[add(route.ports.geo[0],[centers[0],0,0]),add(route.ports.geo[1],[centers[0],0,0])];
      for(let i=0;i<lastRoutes.length;i++){path.push(...lastRoutes[i].slice(1));path.push(...internal.get(names[i+1]).points.slice(1).map(point=>add(point,[centers[i+1],0,0])));}
      inspectionRoute=new SampledRoute(path);
    }
    for(const record of records){record.object.matrix.copy(workingRigMatrix(record.motion,theta,rig,record.shift*condense));record.object.matrixWorldNeedsUpdate=true;}
    return inspectionRoute;
  }
  function cameraFrame(moduleName){
    if(moduleName){
      const envelope=envelopes.get(moduleName);if(!envelope)throw Error('Unknown working camera module: '+moduleName);
      const bounds=envelope.clone().translate(groups.get(moduleName).position);
      return {bounds,center:bounds.getCenter(new THREE.Vector3()),span:bounds.getSize(new THREE.Vector3())};
    }
    const box=new THREE.Box3();for(let i=0;i<names.length;i++){const moved=envelopes.get(names[i]).clone().translate(groups.get(names[i]).position);box.union(moved);}return {bounds:box,center:box.getCenter(new THREE.Vector3()),span:box.getSize(new THREE.Vector3())};
  }
  function fitViewHeight(camera,height,p,aspect,perspectiveBlend,distance){
    const weight=p<=.46?1-smooth((p-.28)/.18):smooth((p-.90)/.10);if(!weight)return height;
    camera.updateMatrixWorld();const inverse=camera.matrixWorldInverse;let required=height;
    for(const point of corners(cameraFrame().bounds)){
      const q=new THREE.Vector3(...point).applyMatrix4(inverse),den=1-perspectiveBlend+perspectiveBlend*Math.max(.001,-q.z)/distance;
      required=Math.max(required,2*Math.abs(q.y)/den/.86,2*Math.abs(q.x)/den/aspect/.86);
    }
    return mix(height,required,weight);
  }
  function jointResidual(angle=theta){
    const ref=radians(rig.referenceAngleDeg),a=radians(angle),L=rig.linkLengthMM,delta=[L*(Math.cos(a)-Math.cos(ref)),0,L*(Math.sin(a)-Math.sin(ref))];let worst=0;
    for(const record of records)if(record.motion?.kind==='rocker'){
      const upper=add(record.motion.pivot,[L*Math.cos(ref),0,L*Math.sin(ref)]),actual=new THREE.Vector3(...upper).applyMatrix4(workingRigMatrix(record.motion,angle,rig)).toArray();
      worst=Math.max(worst,dist(actual,add(upper,delta)));
    }
    return worst;
  }
  const wireDiagnostics=Object.fromEntries([...internal].map(([name,record])=>{
    let minBendRadiusMM=Infinity;
    for(let i=1;i<record.points.length-1;i++){
      const a=sub(record.points[i],record.points[i-1]),b=sub(record.points[i+1],record.points[i]),chord=sub(record.points[i+1],record.points[i-1]),area2=Math.hypot(...cross(a,b));
      if(area2>1e-10)minBendRadiusMM=Math.min(minBendRadiusMM,Math.hypot(...a)*Math.hypot(...b)*Math.hypot(...chord)/(2*area2));
    }
    const angle=t=>Math.acos(Math.max(-1,Math.min(1,norm(t)[0])))*180/Math.PI;
    const entry=record.entryTangent||sub(record.points[1],record.points[0]),exit=record.exitTangent||sub(record.points.at(-1),record.points.at(-2));
    minBendRadiusMM=Math.min(minBendRadiusMM,record.minimumCADBendRadiusMM??Infinity);
    return [name,{sampleCount:record.points.length,minBendRadiusMM:Number.isFinite(minBendRadiusMM)?minBendRadiusMM:null,
      entryAxisDeviationDeg:angle(entry),exitAxisDeviationDeg:angle(exit),maxChordErrorMM:record.maxSampledMidpointChordErrorMM??record.maxMidpointChordErrorMM??record.maxChordDeviationMM??null,
      sourceCurveHash:record.sourceCurveSHA256||record.sourceCurveBrepSHA256||null}];
  }));
  const validation={minimumHousingGapMM:gap,minimumExternalAndTakeupBendRadiusMM:minimumRadius,minimumPortSpansMM:minimumSpans,internalWires:wireDiagnostics,
    takeup:{radiusMM:takeupSpec.radius,minimumTurns,maximumTurns,minLengthMM:minTakeup,maxLengthMM:maxTakeup,capacityMM:capacity,
      maximumTurnsBendRadiusMM:coilRadius(maximumTurns,takeupSpec),nonlocalCenterlineDistanceMM:selfDistance,sweptBoreClearanceMM:bore.margin,worstBore:bore.worst,
      boreEnvelope:zones,clearanceScope:'retained axisymmetric bore envelope; CAD solids are validated by the geometry package'},
    originalExplodedSeparationScale:scale,authoritativeWireSamples:Object.fromEntries([...internal].map(([name,r])=>[name,r.points.length])),
    kinematicJointResidualMM:Math.max(jointResidual(rig.minAngleDeg),jointResidual(rig.referenceAngleDeg),jointResidual(rig.maxAngleDeg))};
  setProgress(0);
  return {setProgress,fitViewHeight,cameraFrame,assembled,exploded:baseExploded,validation,
    snapshot:()=>({mode:'working-cad',progress,condense,angleDeg:theta,angleRangeDeg:[rig.minAngleDeg,rig.maxAngleDeg],jointResidualMM:jointResidual(),
      centers:names.map(name=>groups.get(name).position.x),assembled:assembled.slice(),exploded:baseExploded.slice(),
      activeMotionMeshes:records.filter(r=>r.motion?.kind==='rocker'||r.motion?.kind==='deck').length,
      cable:{totalExternalAndTakeupLengthMM:totalCableLength,takeupLengthMM:currentTakeup,lengthErrorMM:lastLengthError,staticInternalRoutes:true,
        dynamicTubeCount:cables.length,closedOutwardDynamicTubes:cables.every(c=>c.capBase!==null&&c.capBase!==undefined)},
      optics:{staticCADWater:true,legacyBeautyProjection:false,scrollFluidPhase:false},validation}),
    audit(requestedSamples=201){
      const progressSamples=Array.isArray(requestedSamples)?requestedSamples:Array.from({length:requestedSamples},(_,i)=>i/(requestedSamples-1)),sampleCount=progressSamples.length;
      let minHousing=Infinity,minPort=Infinity,minSpanRadius=Infinity,maxLengthError=0,maxJoint=0,minBore=Infinity,minSelf=Infinity,minWholeSelf=Infinity;
      const samples=[];
      for(let i=0;i<sampleCount;i++){
        const p=progressSamples[i],c=smooth((p-.035)/.245),centers=centersAt(c),spans=spansAt(centers),external=spans.reduce((sum,points)=>sum+workingLength(points),0),wanted=totalCableLength-external,turns=turnsForLength(wanted),coil=workingTakeup(turns,takeupSpec);
        for(let j=0;j<names.length-1;j++){
          minHousing=Math.min(minHousing,centers[j+1]+envelopes.get(names[j+1]).min.x-centers[j]-envelopes.get(names[j]).max.x);
          const a=add(route.ports[names[j]][1],[centers[j],0,0]),b=add(route.ports[names[j+1]][0],[centers[j+1],0,0]);minPort=Math.min(minPort,b[0]-a[0]);minSpanRadius=Math.min(minSpanRadius,workingSpanRadius(a,b,512));
        }
        maxLengthError=Math.max(maxLengthError,Math.abs(workingLength(coil)+external-totalCableLength));maxJoint=Math.max(maxJoint,jointResidual(thetaForProgress(p,rig)));minBore=Math.min(minBore,sweptBoreMargin(coil,radius,zones).margin);
        if(p<=.28||i===sampleCount-1){
          minSelf=Math.min(minSelf,nonlocalRouteDistance(coil));
          const whole=coil.map(point=>add(point,[centers[0],0,0]));
          for(let j=0;j<spans.length;j++){whole.push(...spans[j].slice(1));whole.push(...internal.get(names[j+1]).points.slice(1).map(point=>add(point,[centers[j+1],0,0])));}
          minWholeSelf=Math.min(minWholeSelf,nonlocalRouteDistance(whole));
        }
        samples.push({progress:p,centers,angleDeg:thetaForProgress(p,rig),turns,externalLengthMM:external,takeupLengthMM:workingLength(coil)});
      }
      const wires=Object.values(wireDiagnostics),internalMin=Math.min(...wires.map(w=>w.minBendRadiusMM??Infinity));
      const maxJoinAngle=Math.max(...wires.flatMap(w=>[w.entryAxisDeviationDeg,w.exitAxisDeviationDeg]));
      const maxJoinGap=Math.max(...[...internal].flatMap(([name,r])=>[dist(r.points[0],route.ports[name][0]),dist(r.points.at(-1),route.ports[name][1])]));
      const measured={sampleCount,minHousingGapMM:minHousing,minPortGapMM:minPort,minExternalBendRadiusMM:minSpanRadius,
        minInternalBendRadiusMM:Number.isFinite(internalMin)?internalMin:null,maxJoinTangentAngleDeg:maxJoinAngle,maxJoinGapMM:maxJoinGap,
        maxCableLengthErrorMM:maxLengthError,maxJointResidualMM:maxJoint,minTakeupBoreClearanceMM:minBore,minTakeupNonlocalDistanceMM:minSelf,
        minCompleteCableNonlocalDistanceMM:minWholeSelf};
      const passed=minHousing>=gap-1e-6&&minPort>0&&minSpanRadius>=minimumRadius&&internalMin>=minimumRadius&&maxJoinAngle<.5&&maxJoinGap<1e-4&&maxLengthError<.001&&maxJoint<1e-8&&minBore>=coilClearance&&minWholeSelf>=2*radius+.25;
      return {passed,sourceGeometryHash:manifest.stats.sha256,measured,validation,samples,
        scope:'Actual CAD bounds and exported wire samples; analytic four-bar envelope; swept tube envelope and centerline checks. Internal solid collisions are reported by the CAD kernel package.'};
    }};
}
