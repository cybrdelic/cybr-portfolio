// IRIS09 exterior, with a real single-input radial-slot mechanical layout.
// The recovered shader remains an unchanged visual reference, not this solver.
import {IRIS09_MECHANICS as M,iris09InputFromTime,solveIris09Input,iris09MechanicalFrame,iris09MechanicalBladeContour} from './iris09-kinematics.mjs';
// Reference-only source helpers below support comparisons; the live mechanism
// uses the rigid profile and constrained solver from iris09-kinematics.mjs.
export const IRIS09_GEOMETRY = Object.freeze({
  radius: .99, hingeRadius: .86, thickness: .00065, cant: .008, height: .260,
  frontArc: Object.freeze([.69, .17, 1.15]), trailingArc: Object.freeze([.25, 1.20, 1.60]),
  leaves: 9, flutes: 120, sourceRevision: 3,
});
const TAU = Math.PI * 2;
export const iris09HingeAngle = time => .45 + .45 * Math.cos(time * Math.PI / 10);
export const iris09ActuatorAngle = time => -.38 + .54 * (1 - Math.cos(time * Math.PI / 10));

// Every contour vertex lies on one source circle and inside the other. Chords
// stay inside their convex intersection. No invented straight blade envelope.
export function iris09LeafContour(segments = 160) {
  const circles = [IRIS09_GEOMETRY.frontArc, IRIS09_GEOMETRY.trailingArc], points = [];
  const [a, b] = circles, dx = b[0] - a[0], dz = b[1] - a[1], distance = Math.hypot(dx, dz);
  const along = (a[2] ** 2 - b[2] ** 2 + distance ** 2) / (2 * distance);
  const rise = Math.sqrt(a[2] ** 2 - along ** 2), mx = a[0] + dx * along / distance, mz = a[1] + dz * along / distance;
  points.push([mx - dz * rise / distance, mz + dx * rise / distance], [mx + dz * rise / distance, mz - dx * rise / distance]);
  for (let c = 0; c < 2; c++) {
    const circle = circles[c], other = circles[1 - c];
    for (let i = 0; i < segments; i++) {
      const angle = TAU * i / segments, x = circle[0] + circle[2] * Math.cos(angle), z = circle[1] + circle[2] * Math.sin(angle);
      if (Math.hypot(x - other[0], z - other[1]) <= other[2] + 1e-10) points.push([x, z]);
    }
  }
  const center = points.reduce((p, q) => [p[0] + q[0] / points.length, p[1] + q[1] / points.length], [0, 0]);
  return points.sort((p, q) => Math.atan2(p[1] - center[1], p[0] - center[0]) - Math.atan2(q[1] - center[1], q[0] - center[0]));
}

export function iris09LeafPoint(index, time, x, z, underside = false) {
  const azimuth = index * TAU / 9, angle = azimuth + iris09HingeAngle(time);
  return [
    .86 * Math.cos(azimuth) + Math.cos(angle) * x - Math.sin(angle) * z,
    .260 + .008 * z - (underside ? .00065 : 0),
    .86 * Math.sin(azimuth) + Math.sin(angle) * x + Math.cos(angle) * z,
  ];
}

function roundedProfile(T, radius, y, halfWidth, halfHeight, bevel, steps = 3) {
  const points = [];
  for (let corner = 0; corner < 4; corner++) {
    const a0 = corner * Math.PI / 2;
    const cx = radius + (corner === 0 || corner === 3 ? 1 : -1) * (halfWidth - bevel);
    const cy = y + (corner < 2 ? 1 : -1) * (halfHeight - bevel);
    for (let j = 0; j <= steps; j++) {
      const angle = a0 + j / steps * Math.PI / 2;
      points.push(new T.Vector2(Math.max(0, cx + bevel * Math.cos(angle)), cy + bevel * Math.sin(angle)));
    }
  }
  points.push(points[0].clone());
  return points;
}

function lathe(T, profile, segments = 192) {
  const geometry = new T.LatheGeometry(profile, segments);
  // Three's lathe uses (sin(phi), cos(phi)); the shape is rotationally symmetric.
  return geometry;
}

// Drill the mounting bores through the COMPLETE housing, not just the ears.
// The .0013 relief allowance covers the .001 front-plate bevel and the finite
// polygon's chord sag. The ear itself retains the nominal .076 through bore.
const mountingBore={radius:.0773,center:1.57};
function boreRadiusAt(angle,radius){
 const sector=TAU/3,delta=angle-Math.round(angle/sector)*sector;
 const side=mountingBore.center*Math.sin(delta),disc=mountingBore.radius**2-side**2;
 return disc>=0?Math.min(radius,mountingBore.center*Math.cos(delta)-Math.sqrt(disc)):radius;
}
function mountingBoundary(radius,segments=192){
 const points=[];
 for(let i=0;i<segments;i++){
  const a=i*TAU/segments,r=boreRadiusAt(a,radius);points.push([r*Math.cos(a),r*Math.sin(a)]);
 }
 if(radius>mountingBore.center-mountingBore.radius)for(let k=0;k<3;k++){
  const az=k*TAU/3,c=Math.cos(az),s=Math.sin(az);
  const d=(radius*radius+mountingBore.center**2-mountingBore.radius**2)/(2*radius*mountingBore.center);
  if(Math.abs(d)<=1)for(const sign of[-1,1]){const a=az+sign*Math.acos(d);points.push([radius*Math.cos(a),radius*Math.sin(a)]);}
  for(let i=0;i<=128;i++){
   const a=i*TAU/128,x=mountingBore.center+mountingBore.radius*Math.cos(a),z=mountingBore.radius*Math.sin(a);
   if(x*x+z*z<=radius*radius+1e-12)points.push([c*x-s*z,s*x+c*z]);
  }
 }
 return points.sort((a,b)=>Math.atan2(a[1],a[0])-Math.atan2(b[1],b[0]));
}
function housingLathe(T,profile,segments=192){
 if(Math.max(...profile.map(p=>p.x))<=mountingBore.center-mountingBore.radius)return lathe(T,profile,segments);
 const angles=[];
 const offsets=[0,.007/1.51,.012/1.51,TAU/240,TAU/120-.012/1.51,TAU/120-.007/1.51];
 for(let i=0;i<segments;i++)angles.push(segments===720?Math.floor(i/6)*TAU/120+offsets[i%6]:i*TAU/segments);
 for(const r of new Set(profile.map(p=>p.x)))for(const p of mountingBoundary(r,0))angles.push((Math.atan2(p[1],p[0])+TAU)%TAU);
 const sorted=angles.sort((a,b)=>a-b).filter((a,i,all)=>!i||a-all[i-1]>1e-9);sorted.push(sorted[0]+TAU);
 const g=lathe(T,profile,sorted.length-1),p=g.attributes.position;
 for(let i=0;i<sorted.length;i++)for(let j=0;j<profile.length;j++){
  const a=sorted[i],r=boreRadiusAt(a,profile[j].x);p.setXYZ(i*profile.length+j,r*Math.cos(a),profile[j].y,r*Math.sin(a));
 }
 // Three's native lathe advances (sin(phi),cos(phi)). Our bore coordinates
 // advance (cos(phi),sin(phi)), reversing its angular orientation. Reverse
 // winding before recomputing normals; merely recomputing keeps it inside-out.
 const indices=g.index.array;for(let i=0;i<indices.length;i+=3){const v=indices[i+1];indices[i+1]=indices[i+2];indices[i+2]=v;}
 g.computeVertexNormals();return g;
}

function millFlutes(geometry,preserveAngles=false) {
  const p=geometry.attributes.position,sector=TAU/120;
  // Redistribute six vertices per flute around its actual straight floor and
  // rounded corner, rather than uniform sampling that turns slots triangular.
  const offsets=[0,.007/1.51,.012/1.51,sector/2,sector-.012/1.51,sector-.007/1.51];
  for(let i=0;i<p.count;i++){
    let x=p.getX(i),y=p.getY(i),z=p.getZ(i),r=Math.hypot(x,z);
    const phi=(Math.atan2(x,z)+TAU)%TAU,sample=Math.round(phi/sector*6),warped=Math.floor(sample/6)*sector+offsets[sample%6];
    if(!preserveAngles){x=r*Math.sin(warped);z=r*Math.cos(warped);}
    if(r>1.4879&&y>.153&&y<.343){
      const angle=Math.atan2(z,x),center=Math.round(angle/sector)*sector,tangent=r*Math.sin(angle-center),shoulder=Math.min(y-.153,.343-y,.005);
      const half=.007+Math.sqrt(Math.max(0,.005**2-(.005-shoulder)**2));
      if(Math.abs(tangent)<half){
        const round=Math.sqrt(Math.max(0,.005**2-Math.max(0,Math.abs(tangent)-.007)**2)),cut=1.493-round;
        if(cut<r){x*=cut/r;z*=cut/r;}
      }
    }
    p.setXYZ(i,x,y,z);
  }
  geometry.computeVertexNormals();return geometry;
}

function notchedRetainer(T) {
  const profile=roundedProfile(T,1.054,.472,.037,.060,.014),angles=[];
  const center=Math.PI/2-.31,delta=Math.asin(.018/1.054);
  for(let i=0;i<=128;i++)angles.push({angle:i*TAU/128});
  for(const c of[center,center+Math.PI])for(const sign of[-1,1])for(const edge of[-1,1])angles.push({angle:c+sign*delta+edge*1e-5,center:c,sign,edge});
  angles.sort((a,b)=>a.angle-b.angle);
  const geometry=lathe(T,profile,angles.length-1),p=geometry.attributes.position;
  for(let i=0;i<angles.length;i++)for(let j=0;j<profile.length;j++){
    const radius=profile[j].x,row=angles[i];
    const angle=row.center===undefined?row.angle:row.center+row.sign*Math.asin(.018/radius)+row.edge*1e-5;
    const x=radius*Math.sin(angle),z=radius*Math.cos(angle),nx=Math.cos(.31)*x+Math.sin(.31)*z,nz=-Math.sin(.31)*x+Math.cos(.31)*z;
    const cut=Math.abs(Math.abs(nx)-1.054)<.041&&Math.abs(nz)<.018;
    p.setXYZ(i*profile.length+j,x,cut?Math.min(profile[j].y,.514):profile[j].y,z);
  }
  geometry.computeVertexNormals();return geometry;
}

function mergeGeometries(T, geometries) {
  // Preserve already-indexed lathe inputs while batching; expanding them to
  // triangle soup before welding wastes both build time and peak memory.
  const count = geometries.reduce((sum, g) => sum + g.attributes.position.count, 0);
  const elementCount=geometries.reduce((sum,g)=>sum+(g.index?.count??g.attributes.position.count),0);
  const position = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const elements=new Uint32Array(elementCount);
  let offset = 0,elementOffset=0;
  for (const geometry of geometries) {
    const length = geometry.attributes.position.count;
    position.set(geometry.attributes.position.array, offset * 3);
    normal.set(geometry.attributes.normal.array, offset * 3);
    if (geometry.attributes.uv) uv.set(geometry.attributes.uv.array, offset * 2);
    const indices=geometry.index?.array;
    if(indices){for(let i=0;i<indices.length;i++)elements[elementOffset++]=indices[i]+offset;}
    else{for(let i=0;i<length;i++)elements[elementOffset++]=i+offset;}
    offset += length;
  }
  // Attribute-bit-exact indexing. A position-only weld would smooth hard edges
  // or erase UV seams; a tolerance-based weld would alter source dimensions.
  // Open addressing avoids allocating hundreds of thousands of string keys.
  const pBits=new Uint32Array(position.buffer),nBits=new Uint32Array(normal.buffer),uBits=new Uint32Array(uv.buffer);
  let capacity=1;while(capacity<count*2)capacity*=2;
  const table=new Uint32Array(capacity),mask=capacity-1,indices=new Uint32Array(count),originals=new Uint32Array(count);
  let unique=0;
  for(let i=0;i<count;i++){
    const p=i*3,u=i*2;
    let hash=2166136261;
    hash=Math.imul(hash^pBits[p],16777619);hash=Math.imul(hash^pBits[p+1],16777619);hash=Math.imul(hash^pBits[p+2],16777619);
    hash=Math.imul(hash^nBits[p],16777619);hash=Math.imul(hash^nBits[p+1],16777619);hash=Math.imul(hash^nBits[p+2],16777619);
    hash=Math.imul(hash^uBits[u],16777619);hash=Math.imul(hash^uBits[u+1],16777619);
    // The final avalanche also mixes mantissa bits into the table's low bits.
    hash^=hash>>>16;hash=Math.imul(hash,0x85ebca6b);hash^=hash>>>13;
    let slot=hash&mask;
    while(table[slot]){
      const other=table[slot]-1,q=other*3,v=other*2;
      if(pBits[p]===pBits[q]&&pBits[p+1]===pBits[q+1]&&pBits[p+2]===pBits[q+2]&&nBits[p]===nBits[q]&&nBits[p+1]===nBits[q+1]&&nBits[p+2]===nBits[q+2]&&uBits[u]===uBits[v]&&uBits[u+1]===uBits[v+1]){indices[i]=indices[other];break;}
      slot=(slot+1)&mask;
    }
    if(!table[slot]){table[slot]=i+1;indices[i]=unique;originals[unique++]=i;}
  }
  const compactPosition=new Float32Array(unique*3),compactNormal=new Float32Array(unique*3),compactUv=new Float32Array(unique*2);
  for(let i=0;i<unique;i++){
    const old=originals[i];
    for(let j=0;j<3;j++){compactPosition[i*3+j]=position[old*3+j];compactNormal[i*3+j]=normal[old*3+j];}
    compactUv[i*2]=uv[old*2];compactUv[i*2+1]=uv[old*2+1];
  }
  const merged = new T.BufferGeometry();
  merged.setAttribute('position', new T.BufferAttribute(compactPosition, 3));
  merged.setAttribute('normal', new T.BufferAttribute(compactNormal, 3));
  merged.setAttribute('uv', new T.BufferAttribute(compactUv, 2));
  for(let i=0;i<elements.length;i++)elements[i]=indices[elements[i]];
  merged.setIndex(new T.BufferAttribute(unique<=65535?new Uint16Array(elements):elements,1));
  merged.computeBoundingSphere();
  for (const geometry of new Set(geometries)) geometry.dispose();
  return merged;
}

function shapeExtrusion(T, shape, bottom, top, bevel = 0) {
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: top - bottom - 2 * bevel, bevelEnabled: bevel > 0, bevelSegments: 3,
    bevelThickness: bevel, bevelSize: bevel, steps: 1, curveSegments: 32,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, top - bevel, 0);
  return geometry;
}

function annularShape(T, inner, outer, screwHoles = false, track = false) {
  const shape = new T.Shape();
  if(outer>mountingBore.center-mountingBore.radius){shape.setFromPoints(mountingBoundary(outer).map(p=>new T.Vector2(...p)));shape.closePath();}
  else shape.absarc(0, 0, outer, 0, TAU, false);
  if (inner > 0) { const hole = new T.Path(); hole.absarc(0, 0, inner, 0, TAU, true); shape.holes.push(hole); }
  if (screwHoles) for (let i = 0; i < 6; i++) {
    const hole = new T.Path(), angle = i * TAU / 6;
    hole.absarc(1.348 * Math.cos(angle), 1.348 * Math.sin(angle), .062, 0, TAU, true); shape.holes.push(hole);
  }
  if (track) {
    const hole = new T.Path(), start = -.45, end = .77, r = 1.439, half = .014;
    hole.absarc(0, 0, r + half, start, end, false);
    hole.absarc(r * Math.cos(end), r * Math.sin(end), half, end, end + Math.PI, false);
    hole.absarc(0, 0, r - half, end, start, true);
    hole.absarc(r * Math.cos(start), r * Math.sin(start), half, start + Math.PI, start + TAU, false);
    hole.closePath(); shape.holes.push(hole);
  }
  return shape;
}

function capsulePath(T,x0,z0,x1,z1,r){
 const p=new T.Path(),a=Math.atan2(z1-z0,x1-x0);
 p.absarc(x1,z1,r,a-Math.PI/2,a+Math.PI/2,false);
 p.absarc(x0,z0,r,a+Math.PI/2,a+Math.PI*1.5,false);p.closePath();return p;
}
function followerCarrierSlot(T,azimuth){
 const p=new T.Path(),r=M.followerOffset,w=M.carrierFollowerClearance;
 const hx=M.pivotRadius*Math.cos(azimuth),hz=M.pivotRadius*Math.sin(azimuth),a=azimuth,b=azimuth+M.maximumBladeAngle;
 p.absarc(hx,hz,r+w,a,b,false);
 p.absarc(hx+r*Math.cos(b),hz+r*Math.sin(b),w,b,b+Math.PI,false);
 p.absarc(hx,hz,r-w,b,a,true);
 p.absarc(hx+r*Math.cos(a),hz+r*Math.sin(a),w,a+Math.PI,a+TAU,false);p.closePath();return p;
}
function mechanicalLeafGeometry(T){
 const s=new T.Shape();s.setFromPoints(iris09MechanicalBladeContour().map(p=>new T.Vector2(...p)));s.closePath();
 for(const [x,r]of[[0,M.pivotBoreRadius],[M.followerOffset,M.followerPinRadius]]){
  const h=new T.Path();h.absarc(x,0,r,0,TAU,true);s.holes.push(h);
 }
 return shapeExtrusion(T,s,-M.thickness,0);
}

// Transform lighting samples to the fixed mechanism frame without changing the
// permanent rigid blade boundary. The source's world-radius clip is not used.
function installLeafFrame(material, matrix) {
  const prior = material.onBeforeCompile, priorKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function(shader, renderer) {
    prior.call(this, shader, renderer);
    shader.uniforms.uIrisLeafToRoot = { value: matrix };
    shader.vertexShader = 'uniform mat4 uIrisLeafToRoot;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('vIrisSurfaceRootPosition=position;', 'vIrisSurfaceRootPosition=(uIrisLeafToRoot * vec4(position,1.0)).xyz;');
  };
  material.customProgramCacheKey = () => priorKey() + '|iris09-rigid-mechanical-leaf-v1';
}

export function createIris09Geometry(T, { materials } = {}) {
  const buildStarted=performance.now();
  if (!materials || [1, 2, 3, 4, 5, 8].some(id => !materials[id])) throw new TypeError('IRIS09 requires source material IDs 1,2,3,4,5,8');
  const root = new T.Group(), actuator = new T.Group(), leaves = [], geometries = new Set(), ownedMaterials = new Set();
  root.name = 'IRIS / 09 — single-input pin/slot mechanism'; actuator.name = 'Drive ring and integral actuator'; root.add(actuator);
  const staticParts = new Map(), movingParts = new Map();
  const add = (id, geometry, moving = false) => { const map = moving ? movingParts : staticParts; if (!map.has(id)) map.set(id, []); map.get(id).push(geometry); };
  const ring = (id, r, y, w, h, b, segments = 128) => add(id, housingLathe(T, roundedProfile(T, r, y, w, h, b), segments));

  // Main housing, including actual 120 radial grip cuts (not a normal-map gear).
  const mainProfile = roundedProfile(T, 1.298, .255, .212, .255, .038, 4);
  // A real open internal pocket, not an annulus overlapping the new linkage.
  const upperInner=mainProfile.findIndex(p=>p.x<1.125&&p.y>.50);
  let lowerInner=upperInner;while(lowerInner<mainProfile.length&&mainProfile[lowerInner].y>M.cavityBottom)lowerInner++;
  mainProfile.splice(upperInner,lowerInner-upperInner,new T.Vector2(M.cavityInner,M.cavityTop),new T.Vector2(M.cavityInner,M.cavityBottom),new T.Vector2(1.086,M.cavityBottom));
  // Add straight-side samples at the milling entry/exit shoulders.
  const outer = mainProfile.findIndex((p, i) => p.x > 1.5099 && mainProfile[(i + 1) % mainProfile.length].x > 1.5099);
  if (outer >= 0) {
    const ys = [.153, .158, .163, .333, .338, .343].sort((a, b) => mainProfile[outer + 1].y > mainProfile[outer].y ? a - b : b - a);
    mainProfile.splice(outer + 1, 0, ...ys.map(y => new T.Vector2(1.51, y)));
  }
  add(1,millFlutes(housingLathe(T,mainProfile,720),true));

  // Removable face: actual captive-screw recesses, curved actuator slot and
  // shallow annular assembly gap. The lower plate remains closed beneath them.
  // The actuator post now actually reaches the drive ring. Its guide must be
  // open through the whole cover, not stop at the original decorative pin.
  add(2, shapeExtrusion(T, annularShape(T, 1.083, 1.523, false, true), .482, .522));
  add(2, shapeExtrusion(T, annularShape(T, 1.083, 1.523, true, true), .522, .538));
  add(2, shapeExtrusion(T, annularShape(T, 1.089, 1.4602, true, true), .538, .544, .001));
  add(2, shapeExtrusion(T, annularShape(T, 1.4638, 1.517), .538, .544, .001));
  add(3,notchedRetainer(T));
  ring(2, 1.500, .102, .036, .046, .013);
  // Existing outer bands keep their visible outer radii but respect the same
  // internal cavity; otherwise they intersect the continuous actuator post.
  ring(1,(M.cavityInner+1.523)/2,.385,(1.523-M.cavityInner)/2,.043,.016);
  add(1,millFlutes(housingLathe(T,roundedProfile(T,(M.cavityInner+1.516)/2,.224,(1.516-M.cavityInner)/2,.018,.007),720),true));
  // Split the inner seal around the rigid blade deck; otherwise the seal
  // intersects every leaf between radius.994 and1.044.
  ring(5,1.019,(.114+M.cavityBottom)/2,.025,(M.cavityBottom-.114)/2,.006);
  ring(5,1.019,(.295+.436)/2,.025,(.436-.295)/2,.006);
  for (const [r, y, w, h, b] of [[.530,-.077,.555,.023,.010],[.637,.084,.065,.139,.008],[.548,.211,.026,.015,.004],[.572,.054,.018,.013,.004],[.501,.026,.018,.008,.003],[.457,.003,.018,.008,.003],[.408,-.022,.018,.013,.003]]) ring(5, r, y, w, h, b, 96);
  const sensor = new T.CircleGeometry(.391, 96); sensor.rotateX(-Math.PI/2); sensor.translate(0,-.045,0); add(materials[9]?9:5,sensor);

  // Removable carrier on three floor-supported clamped standoffs. It fits
  // through the open pocket, so the ring can be installed BEFORE the carrier.
  // Each fixed pivot gets its own axial support and retaining cap.
  const carrier=annularShape(T,M.carrierInner,M.carrierOuter,false,true);
  for(let i=0;i<M.blades;i++)carrier.holes.push(followerCarrierSlot(T,i*TAU/M.blades));
  for(let i=0;i<3;i++){
    const a=M.carrierMountPhase+i*TAU/3,x=M.carrierMountRadius*Math.cos(a),z=M.carrierMountRadius*Math.sin(a);
    const hole=new T.Path();hole.absarc(x,z,M.carrierMountBore,0,TAU,true);carrier.holes.push(hole);
    const stand=shapeExtrusion(T,annularShape(T,M.carrierScrewRadius,M.carrierStandRadius),M.cavityBottom,M.carrierBottom);
    stand.translate(x,0,z);add(1,stand);
    const screw=new T.CylinderGeometry(M.carrierScrewRadius,M.carrierScrewRadius,.247-.213,24);screw.translate(x,(.247+.213)/2,z);add(4,screw);
    const head=new T.CylinderGeometry(.021,.021,.004,6);head.translate(x,.245,z);add(4,head);
  }
  add(1,shapeExtrusion(T,carrier,M.carrierBottom,M.carrierTop));
  for(let i=0;i<M.blades;i++){
    const az=i*TAU/M.blades,hx=M.pivotRadius*Math.cos(az),hz=M.pivotRadius*Math.sin(az),top=M.firstBladeTop+i*(M.thickness+M.axialClearance);
    const journal=new T.CylinderGeometry(M.pivotPinRadius,M.pivotPinRadius,top+.003-M.carrierTop,32);
    journal.translate(hx,(top+.003+M.carrierTop)/2,hz);add(4,journal);
    const spacer=shapeExtrusion(T,annularShape(T,M.pivotPinRadius,.029),M.carrierTop,top-M.thickness);
    spacer.translate(hx,0,hz);add(4,spacer);
    const cap=new T.CylinderGeometry(M.pivotCapRadius,M.pivotCapRadius,.0025,32);
    cap.translate(hx,top+.00035+.00125,hz);add(4,cap);
  }
  // A journal and two thrust shoulders locate the ring radially and axially.
  // Their narrow radii leave the follower tips/retainers unobstructed.
  add(4,shapeExtrusion(T,annularShape(T,1.235,1.243),M.cavityBottom,.222));
  add(4,shapeExtrusion(T,annularShape(T,1.235,1.262),M.cavityBottom,M.driveRingBottom));
  add(4,shapeExtrusion(T,annularShape(T,1.244,1.262),M.driveRingTop+.0005,M.carrierBottom));
  const drive=annularShape(T,M.driveRingInner,M.driveRingOuter);
  for(let i=0;i<M.blades;i++){
    const a=i*TAU/M.blades-M.inputMin,c=Math.cos(a),s=Math.sin(a);
    drive.holes.push(capsulePath(T,c*M.slotInner,s*M.slotInner,c*M.slotOuter,s*M.slotOuter,M.slotHalfWidth));
  }
  add(4,shapeExtrusion(T,drive,M.driveRingBottom,M.driveRingTop),true);
  const lug=new T.BoxGeometry(1.454-1.388,M.driveRingTop-M.driveRingBottom,.044);
  lug.translate((1.454+1.388)/2,(M.driveRingTop+M.driveRingBottom)/2,0);add(4,lug,true);
  // Actual mechanical stops: the moving lug contacts these faces at the two
  // solver endpoints. They sit outside the continuous ring and join the wall.
  for(const [angle,sign]of[[M.inputMin,-1],[M.inputMax,1]]){
    const stop=new T.BoxGeometry(1.464-1.415,M.driveRingTop-M.driveRingBottom,.020);
    stop.translate((1.464+1.415)/2,(M.driveRingTop+M.driveRingBottom)/2,sign*.032);stop.rotateY(-angle);add(1,stop);
  }

  // Mounting ears: source .042 shoulder radius and an un-beveled .076 bore.
  // Build the shoulder, two perforated caps and bore separately so beveling
  // cannot accidentally close/enlarge the through-hole.
  for (let i = 0; i < 3; i++) {
    const az = i * TAU / 3, shape = new T.Shape(); shape.absarc(1.40, 0, .280, 0, TAU, false);
    const hole = new T.Path(); hole.absarc(1.57, 0, .076, 0, TAU, true); shape.holes.push(hole);
    const lower = new T.ShapeGeometry(shape,48); lower.rotateX(Math.PI/2); lower.translate(0,-.091,0); lower.rotateY(-az); add(1,lower);
    const upper = new T.ShapeGeometry(shape,48); upper.rotateX(-Math.PI/2); upper.translate(0,.067,0); upper.rotateY(-az); add(1,upper);
    const outerProfile=[];
    for(let j=0;j<=6;j++){const a=-Math.PI/2+j/6*Math.PI/2;outerProfile.push(new T.Vector2(.280+.042*Math.cos(a),-.049+.042*Math.sin(a)));}
    for(let j=0;j<=6;j++){const a=j/6*Math.PI/2;outerProfile.push(new T.Vector2(.280+.042*Math.cos(a),.025+.042*Math.sin(a)));}
    const shoulder=lathe(T,outerProfile,96); shoulder.translate(1.40,0,0); shoulder.rotateY(-az); add(1,shoulder);
    const bore=lathe(T,[new T.Vector2(.076,.067),new T.Vector2(.076,-.091)],48); bore.translate(1.57,0,0); bore.rotateY(-az); add(1,bore);
  }
  for (let i = 0; i < 6; i++) {
    const angle = i * TAU / 6, screwAngle = .48 + angle * 1.7;
    const base = lathe(T, roundedProfile(T, .029, .522, .029, .007, .004), 40); base.translate(1.348, 0, 0); base.rotateY(-angle); add(4, base);
    for (const sign of [-1, 1]) {
      const shape = new T.Shape(), start = Math.asin(.008 / .058), points = [];
      for (let j = 0; j <= 40; j++) { const a = start + (Math.PI - 2 * start) * j / 40; points.push(new T.Vector2(.058 * Math.cos(a), sign * .058 * Math.sin(a))); }
      shape.setFromPoints(points); shape.closePath();
      const cap = shapeExtrusion(T, shape, .529, .543); cap.rotateY(-screwAngle); cap.translate(1.348, 0, 0); cap.rotateY(-angle); add(4, cap);
    }
  }

  // Thin rounded actuator arm, exact source pivot and 28-lobed thumb knob.
  const armShape = new T.Shape();
  const ax = 1.526, aw = .197, ah = .028, ar = .011;
  armShape.moveTo(ax-aw+ar,-ah); armShape.lineTo(ax+aw-ar,-ah); armShape.quadraticCurveTo(ax+aw,-ah,ax+aw,-ah+ar); armShape.lineTo(ax+aw,ah-ar); armShape.quadraticCurveTo(ax+aw,ah,ax+aw-ar,ah); armShape.lineTo(ax-aw+ar,ah); armShape.quadraticCurveTo(ax-aw,ah,ax-aw,ah-ar); armShape.lineTo(ax-aw,-ah+ar); armShape.quadraticCurveTo(ax-aw,-ah,ax-aw+ar,-ah);
  add(4, shapeExtrusion(T, armShape, .558, .588, .003), true);
  // This post is now continuous from drive-ring lug to the visible lever.
  const pivot=new T.CylinderGeometry(.012,.012,.597-M.driveRingBottom,32);
  pivot.translate(1.439,(.597+M.driveRingBottom)/2,0);add(4,pivot,true);
  const knob = lathe(T, roundedProfile(T, .033, .600, .033, .044, .008), 168), kp = knob.attributes.position;
  for (let i = 0; i < kp.count; i++) { const x=kp.getX(i),z=kp.getZ(i),r=Math.hypot(x,z); if(r>.045){const scale=1+.0025*Math.cos(28*Math.atan2(z,x))/.066;kp.setXYZ(i,x*scale,kp.getY(i),z*scale);} }
  knob.computeVertexNormals(); knob.translate(1.726, 0, 0); add(1, knob, true);
  const cap = lathe(T, roundedProfile(T, .0245, .643, .0245, .005, .003), 64); cap.translate(1.726, 0, 0); add(4, cap, true);

  for (const [parts, parent] of [[staticParts, root], [movingParts, actuator]]) for (const [id, list] of parts) {
    const geometry = mergeGeometries(T, list), mesh = new T.Mesh(geometry, materials[id]); geometries.add(geometry);
    mesh.name = `IRIS source material ${id}`; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
  }
  const leafGeometry = mechanicalLeafGeometry(T); geometries.add(leafGeometry);
  const framesUniform={value:Array.from({length:M.blades},()=>new T.Vector4())},heightsUniform={value:new Float32Array(M.blades)};
  for (let i = 0; i < 9; i++) {
    const material = materials[8].clone();
    material.userData.iris09MechanicalFrames=framesUniform;
    material.userData.iris09MechanicalHeights=heightsUniform;
    material.userData.iris09LeafIndex={value:i};
    // Material.clone does not copy customization hooks in Three.
    material.onBeforeCompile = materials[8].onBeforeCompile;
    material.customProgramCacheKey = materials[8].customProgramCacheKey;
    const leaf = new T.Mesh(leafGeometry, material), depth = new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,side:T.DoubleSide});
    leaf.name = `Rigid driven leaf ${i+1}`;
    // Authored cameras stay above the parallel blade deck. Draw the opaque
    // housing first, then highest blade first, so depth rejects hidden lower
    // layers before their analytic overlap shading. No detail is discarded.
    leaf.renderOrder=1+(M.blades-1-i);
    installLeafFrame(material, leaf.matrix);
    leaf.customDepthMaterial = depth; leaf.castShadow = true; leaf.receiveShadow = true;
    ownedMaterials.add(material); ownedMaterials.add(depth); leaves.push(leaf); root.add(leaf);
    const top=M.firstBladeTop+i*(M.thickness+M.axialClearance),bottom=M.driveRingBottom-.004;
    const shaft=new T.CylinderGeometry(M.followerPinRadius,M.followerPinRadius,top+.002-bottom,24);
    shaft.translate(M.followerOffset,(top+.002+bottom)/2-top,0);
    const head=new T.CylinderGeometry(M.followerAttachmentRadius,M.followerAttachmentRadius,.002,24);head.translate(M.followerOffset,.001,0);
    const retainer=new T.CylinderGeometry(M.followerAttachmentRadius,M.followerAttachmentRadius,.003,24);retainer.translate(M.followerOffset,M.driveRingBottom-.0025-top,0);
    const followerGeometry=mergeGeometries(T,[shaft,head,retainer]);geometries.add(followerGeometry);
    const follower=new T.Mesh(followerGeometry,materials[4]);follower.name=`Captured follower ${i+1}`;follower.castShadow=true;follower.receiveShadow=true;leaf.add(follower);
  }
  let lastInput=NaN,lastState=null,disposed=false;
  function setInput(input){
    if(disposed)return lastState;
    const state=solveIris09Input(input);
    if(input===lastInput)return lastState;
    lastInput=input;lastState=state;
    for(let i=0;i<M.blades;i++){
      const f=iris09MechanicalFrame(i,state),leaf=leaves[i];
      leaf.position.set(f.hx,f.top,f.hz);leaf.rotation.y=-f.angle;leaf.updateMatrix();
      framesUniform.value[i].set(f.c,f.s,f.hx,f.hz);heightsUniform.value[i]=f.top;
    }
    actuator.rotation.y=-input;actuator.updateMatrix();return state;
  }
  function update(time) {
    return setInput(iris09InputFromTime(time));
  }
  update(0);
  const triangles = [...geometries].reduce((n,g)=>n+(g.index?.count??g.attributes.position.count)/3,0) + 8*(leafGeometry.index?.count??leafGeometry.attributes.position.count)/3;
  const vertexCount=[...geometries].reduce((n,g)=>n+g.attributes.position.count,0)+8*leafGeometry.attributes.position.count;
  const bufferBytes=[...geometries].reduce((n,g)=>n+Object.values(g.attributes).reduce((sum,a)=>sum+a.array.byteLength,0)+(g.index?.array.byteLength??0),0);
  const metadata = Object.freeze({
    sourceRevision:3,constructionRevision:'single-input-radial-slot-1',source:'assets/iris09/IRIS-09.glsl',geometry:'Preserved source exterior with redesigned constrained internal mechanism',
    triangles,vertexCount,unindexedVertexCount:triangles*3,bufferBytes,attributeIndexing:'bit-exact position/normal/uv; no quantization',buildMs:performance.now()-buildStarted,drawCalls:staticParts.size+movingParts.size+18,leaves:9,flutes:120,
    motion:'One drive-ring input; every blade angle solved from its captured follower and radial slot',
    mechanics:'Rigid kinematics with real pivot bores, journals, thrust supports, retained follower pins, slotted ring and physical stops. Not a dynamics, friction or stress simulation; manufacturability is not certified',
    dimensions:M,
    assembly:Object.freeze(['Install bare follower shafts with lower retainers into the drive ring','Lower ring over fixed journal into open housing','Install separate upper thrust washer over journal','Lower removable carrier over unheaded follower shafts and clamp to three standoffs','Install blades over fixed pivots/follower shafts; attach follower upper heads and pivot caps','Install removable face cover']),
    approximations:Object.freeze(['Finite tessellation of analytic contours and holes','Nominal clearances in unscaled source units; fabrication tolerances and strength unspecified','Follower-to-blade attachment is idealized fixed riveting','Carrier screw thread engagement is idealized; source exterior fastener heads remain without modeled shaft threads or clamp preload']),
  });
  return {root,leaves,actuator,update,setInput,get state(){return lastState;},metadata,dispose(){if(disposed)return;disposed=true;for(const g of geometries)g.dispose();for(const m of ownedMaterials)m.dispose();}};
}
