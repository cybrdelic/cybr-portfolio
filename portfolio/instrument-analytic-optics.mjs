/** Native CAD optical boundaries. All positions and distances are millimetres.
 * Rounded boxes and lenses use their authored closed primitives; the liquid
 * surface uses the exact OCC cubic coefficients. The cable exclusion is a
 * caller-supplied native triangle boundary, never a distance-field tube.
 * This module does not modify the CAD draw geometry or the default renderer.
 */
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const d=Math.hypot(...a);if(!(d>0))throw Error('Optical direction must be nonzero');return mul(a,1/d);};
const at=(ro,rd,t)=>add(ro,mul(rd,t));
const finiteVec=(v,n=3)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
const horner=(c,u)=>((c[3]*u+c[2])*u+c[1])*u+c[0];
const derivative=(c,u)=>(3*c[3]*u+2*c[2])*u+c[1];
const power=p=>[p[0],3*(p[1]-p[0]),3*(p[2]-2*p[1]+p[0]),p[3]-3*p[2]+3*p[1]-p[0]];
export const OPTICAL_MODULE=Object.freeze({LIGHT:0,ELEMENTS:1});
export const OPTICAL_SOLID=Object.freeze({GLASS:1,WATER:2});

/** Reduce the native extraction to a browser-sized, source-identified recipe. */
export function packNativeOpticalPrimitives(descriptor,{ductBoundsMM}={}){
  if(descriptor?.units!=='mm')throw Error('Native optical recipe must use mm');
  const spans=descriptor.water.freeSurface.bezierSpans.map(s=>{
    if(s.degree!==3||s.rational||s.controlPoints.length!==4)throw Error('Native water requires nonrational cubic spans');
    return {x:power(s.controlPoints.map(p=>p[0])),z:power(s.controlPoints.map(p=>p[2])),xRange:[s.controlPoints[3][0],s.controlPoints[0][0]],zRange:s.zControlBoundsMM};
  });
  if(spans.length!==40||!spans.every(s=>s.xRange[0]<s.xRange[1]))throw Error('Native water span count/monotonicity changed');
  const bounds=ductBoundsMM??descriptor.water.cableExclusion.nativeBoundary.boundsMM;
  if(!bounds||!finiteVec(bounds[0])||!finiteVec(bounds[1]))throw Error('Native duct bounds are required');
  return {schema:1,units:'mm',moduleIds:OPTICAL_MODULE,solidIds:OPTICAL_SOLID,
    sources:Object.fromEntries(Object.entries(descriptor.sources).map(([k,v])=>[k,{partName:v.partName,brepSHA256:v.brepSHA256}])),
    glass:descriptor.glass,lens:descriptor.lens,
    water:{roundedBox:descriptor.water.roundedBox,spans,zRange:descriptor.water.freeSurface.zControlBoundsMM,
      bubbles:descriptor.water.bubbleSpheres.map(s=>({centerMM:s.centerMM,radiusMM:s.radiusMM})),
      duct:{boundsMM:bounds,triangleCount:descriptor.water.cableExclusion.nativeBoundary.triangleCount,
        linearDeflectionMM:descriptor.water.cableExclusion.nativeBoundary.linearDeflectionMM,
        angularDeflectionRad:descriptor.water.cableExclusion.nativeBoundary.angularDeflectionRad,
        sourceBrepSHA256:descriptor.water.cableExclusion.nativeBoundary.sourceBrepSHA256,
        binaryURL:'./native-water-cable-boundary.bin'},glassWaterMinimumGapMM:descriptor.water.glassWaterMinimumGapMM},
    exactness:{primitives:'Native authored planes/cylinders/spheres and OCC nonrational cubic surface',duct:'Native tessellation at recorded deflection; not exact rational BREP intersection'}};
}

/** Real roots in a closed interval, using derivative isolation rather than
 * a cancellation-prone cubic formula. A cubic has at most three such roots. */
export function cubicRootsInInterval(coefficients,minimum=0,maximum=1){
  if(!finiteVec(coefficients,4)||!Number.isFinite(minimum)||!Number.isFinite(maximum)||minimum>maximum)throw Error('Invalid cubic interval');
  const c=coefficients,scale=Math.max(...c.map(Math.abs),1),tol=scale*1e-12;
  if(c.every(v=>Math.abs(v)<=tol))return []; // Coincident ray/surface has no isolated interface.
  const knots=[minimum,maximum],a=3*c[3],b=2*c[2],d=c[1];
  if(Math.abs(a)>tol){const discriminant=b*b-4*a*d;if(discriminant>=0){const root=Math.sqrt(discriminant);for(const u of [(-b-root)/(2*a),(-b+root)/(2*a)])if(u>minimum&&u<maximum)knots.push(u);}}
  else if(Math.abs(b)>tol){const u=-d/b;if(u>minimum&&u<maximum)knots.push(u);}
  knots.sort((x,y)=>x-y);const roots=[];
  const push=u=>{if(!roots.some(v=>Math.abs(v-u)<1e-9))roots.push(u);};
  for(const u of knots)if(Math.abs(horner(c,u))<=tol)push(u);
  for(let i=1;i<knots.length;i++){
    let lo=knots[i-1],hi=knots[i],fl=horner(c,lo),fh=horner(c,hi);if(fl*fh>=0)continue;
    for(let j=0;j<48;j++){const mid=(lo+hi)/2,fm=horner(c,mid);if(fl*fm<=0){hi=mid;fh=fm;}else{lo=mid;fl=fm;}}
    push((lo+hi)/2);
  }
  return roots.sort((x,y)=>x-y);
}
function quadratic(a,b,c){
  if(Math.abs(a)<1e-18)return Math.abs(b)<1e-18?[]:[-c/b];
  const discriminant=b*b-4*a*c;if(discriminant<0)return [];
  const root=Math.sqrt(discriminant),q=-.5*(b+(b<0?-root:root));
  return q===0?[-b/(2*a)]:[q/a,c/q].sort((x,y)=>x-y);
}
function inBounds(p,b,epsilon=0){return p.every((v,i)=>v>=b[0][i]-epsilon&&v<=b[1][i]+epsilon);}
function roundedContains(p,shape){const q=p.map((v,i)=>Math.max(Math.abs(v-(shape.centerMM?.[i]??0))-(shape.halfExtentsMM[i]-shape.filletRadiusMM),0));return dot(q,q)<shape.filletRadiusMM**2;}
function sphereContains(p,s){return dot(sub(p,s.centerMM),sub(p,s.centerMM))<s.radiusMM**2;}
function cylinderContains(p,c){return (p[1]-c.axisPointMM[1])**2+(p[2]-c.axisPointMM[2])**2<c.radiusMM**2;}

export function nativeWaterSurfaceAt(recipe,x){
  const water=recipe.water,spans=water.spans;if(!Number.isFinite(x))throw Error('Water surface X must be finite');
  const span=spans.find(s=>x>=s.xRange[0]-1e-9&&x<=s.xRange[1]+1e-9);if(!span)return null;
  let lo=0,hi=1;for(let i=0;i<48;i++){const u=(lo+hi)/2;if(horner(span.x,u)>x)lo=u;else hi=u;}
  const u=(lo+hi)/2,dx=derivative(span.x,u),dz=derivative(span.z,u);
  return {height:horner(span.z,u),normal:unit([-dz/dx,0,1]),parameter:u,span:spans.indexOf(span)};
}
function waterBelow(p,recipe){const zr=recipe.water.zRange;if(p[2]<zr[0])return true;if(p[2]>zr[1])return false;const s=nativeWaterSurfaceAt(recipe,p[0]);return !!s&&p[2]<s.height;}
function sphereCandidates(ro,rd,s,id,flip=1){const q=sub(ro,s.centerMM);return quadratic(dot(rd,rd),2*dot(q,rd),dot(q,q)-s.radiusMM**2).map(distance=>{const point=at(ro,rd,distance);return{distance,point,normal:mul(unit(sub(point,s.centerMM)),flip),primitiveId:id};});}
function cylinderCandidates(ro,rd,c,id,flip=1){const y=ro[1]-c.axisPointMM[1],z=ro[2]-c.axisPointMM[2];return quadratic(rd[1]**2+rd[2]**2,2*(y*rd[1]+z*rd[2]),y*y+z*z-c.radiusMM**2).map(distance=>{const point=at(ro,rd,distance);return{distance,point,normal:mul(unit([0,point[1]-c.axisPointMM[1],point[2]-c.axisPointMM[2]]),flip),primitiveId:id};});}

/** Exact boundary patches of a filleted box (six planes, twelve cylinders,
 * eight spherical corners). This is the original all-edge CAD fillet. */
export function roundedBoxCandidates(origin,direction,shape,primitiveBase=0){
  const center=shape.centerMM??[0,0,0],ro=sub(origin,center),rd=direction,h=shape.halfExtentsMM,r=shape.filletRadiusMM,b=h.map(v=>v-r),result=[],epsilon=1e-7;
  const put=(distance,n,id)=>result.push({distance,point:at(origin,rd,distance),normal:n,primitiveId:primitiveBase+id});
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1])if(Math.abs(rd[axis])>1e-15){const t=(sign*h[axis]-ro[axis])/rd[axis],p=at(ro,rd,t);if(p.every((v,i)=>i===axis||Math.abs(v)<=b[i]+epsilon)){const n=[0,0,0];n[axis]=sign;put(t,n,axis*2+(sign>0?1:0));}}
  for(let axis=0;axis<3;axis++){
    const a=(axis+1)%3,c=(axis+2)%3;
    for(const sa of [-1,1])for(const sc of [-1,1]){
      const qa=ro[a]-sa*b[a],qc=ro[c]-sc*b[c];
      for(const t of quadratic(rd[a]**2+rd[c]**2,2*(qa*rd[a]+qc*rd[c]),qa*qa+qc*qc-r*r)){
        const p=at(ro,rd,t),na=p[a]-sa*b[a],nc=p[c]-sc*b[c];if(Math.abs(p[axis])>b[axis]+epsilon||sa*na<-epsilon||sc*nc<-epsilon)continue;
        const n=[0,0,0];n[a]=na/r;n[c]=nc/r;put(t,unit(n),6+axis*4+(sa>0?2:0)+(sc>0?1:0));
      }
    }
  }
  for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){
    const signs=[sx,sy,sz],corner=signs.map((v,i)=>v*b[i]);
    for(const hit of sphereCandidates(ro,rd,{centerMM:corner,radiusMM:r},0))if(hit.point.every((v,i)=>signs[i]*(v-corner[i])>=-epsilon))put(hit.distance,hit.normal,18+(sx>0?4:0)+(sy>0?2:0)+(sz>0?1:0));
  }
  return result;
}
function freeSurfaceCandidates(ro,rd,recipe){
  const result=[];for(let i=0;i<recipe.water.spans.length;i++){
    const span=recipe.water.spans[i],c=span.z.map((v,k)=>v*rd[0]-span.x[k]*rd[2]);c[0]+=ro[0]*rd[2]-ro[2]*rd[0];
    for(const u of cubicRootsInInterval(c)){
      const x=horner(span.x,u),z=horner(span.z,u);let t;
      if(Math.abs(rd[0])>Math.abs(rd[2]))t=(x-ro[0])/rd[0];else if(Math.abs(rd[2])>1e-15)t=(z-ro[2])/rd[2];else continue;
      const dx=derivative(span.x,u),dz=derivative(span.z,u),point=at(ro,rd,t);
      if(Math.abs(point[0]-x)>1e-7||Math.abs(point[2]-z)>1e-7)continue;
      result.push({distance:t,point,normal:unit([-dz/dx,0,1]),primitiveId:300+i});
    }
  }
  return result;
}

/** CPU reference for the exact retained native triangle duct. Production GPU
 * uses the caller's shared tagged BVH; this deliberately small reference uses
 * direct triangles and does not introduce a second browser hierarchy. */
export function createTriangleDuctBoundary({positions,indices,normals}){
  if(!positions||!indices||positions.length%3||indices.length%3)throw Error('Invalid native duct mesh');
  const bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]],triangles=[];
  for(let i=0;i<positions.length;i++)if(!Number.isFinite(positions[i]))throw Error('Nonfinite native duct position');else{bounds[0][i%3]=Math.min(bounds[0][i%3],positions[i]);bounds[1][i%3]=Math.max(bounds[1][i%3],positions[i]);}
  for(let i=0;i<indices.length;i+=3){const ids=[indices[i],indices[i+1],indices[i+2]];if(ids.some(j=>j*3+2>=positions.length))throw Error('Native duct index outside mesh');const p=ids.map(j=>Array.from(positions.slice(j*3,j*3+3))),a=sub(p[1],p[0]),b=sub(p[2],p[0]),n=cross(a,b);if(Math.hypot(...n)>1e-12)triangles.push({p:p[0],a,b,n:unit(n),ids,id:i/3});}
  const intersections=(ro,rd,minimum=.001,maximum=Infinity)=>{
    const found=[];for(const triangle of triangles){const q=cross(rd,triangle.b),det=dot(triangle.a,q);if(Math.abs(det)<1e-12)continue;const v=sub(ro,triangle.p),u=dot(v,q)/det;if(u<-1e-8||u>1+1e-8)continue;const r=cross(v,triangle.a),w=dot(rd,r)/det;if(w<-1e-8||u+w>1+1e-8)continue;const distance=dot(triangle.b,r)/det;if(distance<minimum||distance>maximum)continue;
      let normal=triangle.n;if(normals){normal=unit([0,1,2].map(k=>normals[triangle.ids[0]*3+k]*(1-u-w)+normals[triangle.ids[1]*3+k]*u+normals[triangle.ids[2]*3+k]*w));if(dot(normal,triangle.n)<0)normal=mul(normal,-1);}
      found.push({distance,point:at(ro,rd,distance),normal,geometricNormal:triangle.n,primitiveId:400+triangle.id});
    }
    found.sort((a,b)=>a.distance-b.distance);return found.filter((h,i)=>!i||Math.abs(h.distance-found[i-1].distance)>1e-6);
  };
  const contains=point=>{if(!inBounds(point,bounds))return false;const hit=intersections(point,[0,1,0],1e-7,100)[0];return !!hit&&dot(hit.geometricNormal,[0,1,0])<0;};
  return {bounds,intersections,contains,triangleCount:triangles.length};
}

export function createNativeOpticalKernel(recipe,{ductBoundary}={}){
  if(recipe?.schema!==1||recipe.units!=='mm'||recipe.water?.spans?.length!==40)throw Error('Invalid native optical runtime recipe');
  const waterContains=p=>roundedContains(p,recipe.water.roundedBox)&&waterBelow(p,recipe)&&!recipe.water.bubbles.some(s=>sphereContains(p,s))&&(!inBounds(p,recipe.water.duct.boundsMM)||!ductBoundary.contains(p));
  const contains=(p,module,solidId=1)=>{
    if(module===0)return solidId===1&&recipe.lens.spheres.every(s=>sphereContains(p,s))&&!cylinderContains(p,recipe.lens.centralCylinder);
    if(module!==1)throw Error('Unknown native optical module');
    if(solidId===1)return roundedContains(p,recipe.glass.outerRoundedBox)&&!roundedContains(p,recipe.glass.innerRoundedBox)&&!cylinderContains(p,recipe.glass.portCylinder);
    if(solidId!==2)throw Error('Unknown native optical solid');
    if(!ductBoundary)throw Error('ELEMENTS water requires the native duct boundary');return waterContains(p);
  };
  const allEvents=(origin,direction,{module=1,minDistance=.001,maxDistance=1000}={})=>{
    if(!finiteVec(origin)||!finiteVec(direction)||!(minDistance>=0)||!Number.isFinite(maxDistance)||maxDistance<=minDistance)throw Error('Invalid native optical ray');
    const rd=unit(direction),candidates=[];
    const push=(hits,solidId)=>candidates.push(...hits.map(h=>({...h,solidId})));
    if(module===0){recipe.lens.spheres.forEach((s,i)=>push(sphereCandidates(origin,rd,s,10+i),1));push(cylinderCandidates(origin,rd,recipe.lens.centralCylinder,12,-1),1);}
    else if(module===1){
      if(!ductBoundary)throw Error('ELEMENTS water requires the native duct boundary');
      push(roundedBoxCandidates(origin,rd,recipe.glass.outerRoundedBox,100),1);push(roundedBoxCandidates(origin,rd,recipe.glass.innerRoundedBox,150).map(h=>({...h,normal:mul(h.normal,-1)})),1);push(cylinderCandidates(origin,rd,recipe.glass.portCylinder,180,-1),1);
      push(roundedBoxCandidates(origin,rd,recipe.water.roundedBox,200),2);push(freeSurfaceCandidates(origin,rd,recipe),2);recipe.water.bubbles.forEach((s,i)=>push(sphereCandidates(origin,rd,s,350+i,-1),2));push(ductBoundary.intersections(origin,rd,minDistance,maxDistance),2);
    }else throw Error('Unknown native optical module');
    candidates.sort((a,b)=>a.distance-b.distance);const result=[];
    for(const hit of candidates){if(!(hit.distance>=minDistance&&hit.distance<=maxDistance)||Math.abs(dot(hit.normal,rd))<1e-9)continue;
      const epsilon=.00002,before=contains(sub(hit.point,mul(hit.normal,epsilon)),module,hit.solidId),after=contains(add(hit.point,mul(hit.normal,epsilon)),module,hit.solidId);
      if(!before||after)continue; // Outward native face must separate this CSG solid.
      if(result.some(h=>h.solidId===hit.solidId&&Math.abs(h.distance-hit.distance)<1e-6))continue;
      result.push({...hit,entering:dot(hit.normal,rd)<0,nextMedium:dot(hit.normal,rd)<0?hit.solidId:0});
    }
    return result;
  };
  return {contains,allEvents,nextOpticalEvent:(ro,rd,options)=>allEvents(ro,rd,options)[0]??null,
    snapshot:()=>({units:'mm',modules:2,waterCubicSpans:40,bubbleSpheres:18,ductTriangles:ductBoundary?.triangleCount??0,sourceHashes:recipe.sources,exactness:recipe.exactness})};
}

/** Exact dielectric Snell direction and unpolarized Fresnel energy. The normal
 * passed here faces the incident ray; no artistic IOR or thin-shell hack. */
export function nativeDielectric(direction,incidentNormal,incidentIor,targetIor){
  const d=unit(direction),n=unit(incidentNormal);if(!(incidentIor>0&&targetIor>0)||dot(d,n)>1e-8)throw Error('Invalid dielectric orientation/IOR');
  if(incidentIor===targetIor)return {tir:false,direction:d,fresnel:0};
  const cosI=Math.max(0,Math.min(1,-dot(d,n))),eta=incidentIor/targetIor,k=1-eta*eta*(1-cosI*cosI);
  if(k<0)return {tir:true,direction:unit(sub(d,mul(n,2*dot(d,n)))),fresnel:1};
  const cosT=Math.sqrt(Math.max(0,k)),rs=(incidentIor*cosI-targetIor*cosT)/(incidentIor*cosI+targetIor*cosT),rp=(targetIor*cosI-incidentIor*cosT)/(targetIor*cosI+incidentIor*cosT);
  return {tir:false,direction:unit(add(mul(d,eta),mul(n,eta*cosI-cosT))),fresnel:(rs*rs+rp*rp)*.5};
}

/** CPU transport reference. Opaque intersections are true native 3D hits.
 * Returned weight follows the transmitted path (Fresnel branches are not
 * recursively split); TIR follows the reflected ray. Exhaustion is explicit. */
export function traceNativeOpticalRay({kernel,origin,direction,module=1,opaqueIntersect,media={1:{ior:1.52,sigma:[0,0,0]},2:{ior:1.333,sigma:[0,0,0]}},maxInterfaces=16,epsilonMM=.001,maxDistance=1000}){
  let ro=[...origin],rd=unit(direction),weight=[1,1,1],stack=[1,2].filter(id=>kernel.contains(ro,module,id)),events=[],distance=0;
  for(let step=0;step<maxInterfaces;step++){
    const hit=kernel.nextOpticalEvent(ro,rd,{module,minDistance:epsilonMM*.25,maxDistance}),opaque=opaqueIntersect?.(ro,rd,hit?.distance??maxDistance),current=stack.at(-1)??0,medium=media[current]??{ior:1,sigma:[0,0,0]};
    const segment=opaque&&opaque.distance>=0&&opaque.distance<=(hit?.distance??maxDistance)?opaque.distance:hit?.distance;
    if(segment!==undefined){weight=weight.map((v,i)=>v*Math.exp(-(medium.sigma?.[i]??0)*segment));distance+=segment;}
    if(opaque&&opaque.distance>=0&&opaque.distance<=(hit?.distance??maxDistance))return {opaqueHit:opaque,point:at(ro,rd,opaque.distance),direction:rd,weight,events,distance,exhausted:false};
    if(!hit)return {opaqueHit:null,point:ro,direction:rd,weight,events,distance,exhausted:stack.length>0};
    const next=hit.entering?[...stack.filter(id=>id!==hit.solidId),hit.solidId]:stack.filter(id=>id!==hit.solidId),target=media[next.at(-1)]??{ior:1},normal=hit.entering?hit.normal:mul(hit.normal,-1),snell=nativeDielectric(rd,normal,medium.ior,target.ior);
    events.push({...hit,incidentMedium:current,targetMedium:next.at(-1)??0,fresnel:snell.fresnel,tir:snell.tir});
    if(!snell.tir){weight=weight.map(v=>v*(1-snell.fresnel));stack=next;}
    rd=snell.direction;ro=add(hit.point,mul(rd,epsilonMM));
    const currentAfter=media[stack.at(-1)]??{sigma:[0,0,0]};weight=weight.map((v,i)=>v*Math.exp(-(currentAfter.sigma?.[i]??0)*epsilonMM));distance+=epsilonMM;
  }
  return {opaqueHit:null,point:ro,direction:rd,weight,events,distance,exhausted:true};
}

const glNumber=v=>{if(!Number.isFinite(v))throw Error('Nonfinite GLSL native coefficient');const s=Number(v.toPrecision(12)).toString();return /[.e]/i.test(s)?s:`${s}.0`;};
const glVec=(v,n=v.length)=>`vec${n}(${v.map(glNumber).join(',')})`;

/** Shader ABI (local CAD mm): caller defines CadDuctHit {distance, point,
 * normal}, cadDuctEvent and cadDuctContains before this library. Duct normals
 * point out of liquid into its actual swept air clearance. All primitives
 * use one solid identity, so subtractive cavities are genuine air transitions.
 * No screen depth, hidden-surface estimate or projected HDR lookup is used.
 */
export function analyticOpticsGLSL(recipe){
  if(recipe?.schema!==1||recipe.units!=='mm'||recipe.water?.spans?.length!==40||recipe.water.bubbles?.length!==18)throw Error('Invalid native optical shader recipe');
  const {glass,lens,water}=recipe,boxes=[glass.outerRoundedBox,glass.innerRoundedBox,water.roundedBox];
  return `
// Native CAD optical primitives; local millimetres, LIGHT=0 / ELEMENTS=1.
struct CadOpticalHit {float distance;vec3 point;vec3 normal;int solidId;int primitiveId;bool entering;};
const vec4 cadNativeX[40]=vec4[40](${water.spans.map(s=>glVec(s.x)).join(',')});
const vec4 cadNativeZ[40]=vec4[40](${water.spans.map(s=>glVec(s.z)).join(',')});
const vec4 cadNativeSpanBounds[40]=vec4[40](${water.spans.map(s=>glVec([...s.xRange,...s.zRange])).join(',')});
const vec4 cadNativeBubbles[18]=vec4[18](${water.bubbles.map(s=>glVec([...s.centerMM,s.radiusMM])).join(',')});
const vec3 cadNativeDuctMin=${glVec(water.duct.boundsMM[0])};
const vec3 cadNativeDuctMax=${glVec(water.duct.boundsMM[1])};
float cadNativePolynomial(vec4 c,float u){return ((c.w*u+c.z)*u+c.y)*u+c.x;}
float cadNativeDerivative(vec4 c,float u){return (3.*c.w*u+2.*c.z)*u+c.y;}
bool cadNativeRoundedContains(vec3 p,vec3 halfExtent,float radius){vec3 q=max(abs(p)-(halfExtent-vec3(radius)),vec3(0));return dot(q,q)<radius*radius;}
bool cadNativeSphereContains(vec3 p,vec4 sphere){vec3 q=p-sphere.xyz;return dot(q,q)<sphere.w*sphere.w;}
bool cadNativeCylinderContains(vec3 p,vec2 yz,float radius){vec2 q=p.yz-yz;return dot(q,q)<radius*radius;}
bool cadNativeDuctBounds(vec3 p){return all(greaterThanEqual(p,cadNativeDuctMin))&&all(lessThanEqual(p,cadNativeDuctMax));}
bool cadNativeWaterBelow(vec3 p){
 if(p.z<${glNumber(water.zRange[0])})return true;if(p.z>${glNumber(water.zRange[1])})return false;
 for(int i=0;i<40;i++){vec4 bounds=cadNativeSpanBounds[i];if(p.x<bounds.x-.00001||p.x>bounds.y+.00001)continue;
  float lo=0.,hi=1.;for(int step=0;step<24;step++){float middle=(lo+hi)*.5;if(cadNativePolynomial(cadNativeX[i],middle)>p.x)lo=middle;else hi=middle;}
  return p.z<cadNativePolynomial(cadNativeZ[i],(lo+hi)*.5);
 }return false;
}
bool cadNativeSolidContains(vec3 p,int module,int solidId){
 if(module==0){return solidId==1&&cadNativeSphereContains(p,${glVec([...lens.spheres[0].centerMM,lens.spheres[0].radiusMM])})&&cadNativeSphereContains(p,${glVec([...lens.spheres[1].centerMM,lens.spheres[1].radiusMM])})&&!cadNativeCylinderContains(p,${glVec(lens.centralCylinder.axisPointMM.slice(1))},${glNumber(lens.centralCylinder.radiusMM)});}
 if(module!=1)return false;
 if(solidId==1)return cadNativeRoundedContains(p,${glVec(boxes[0].halfExtentsMM)},${glNumber(boxes[0].filletRadiusMM)})&&!cadNativeRoundedContains(p,${glVec(boxes[1].halfExtentsMM)},${glNumber(boxes[1].filletRadiusMM)})&&!cadNativeCylinderContains(p,${glVec(glass.portCylinder.axisPointMM.slice(1))},${glNumber(glass.portCylinder.radiusMM)});
 if(solidId!=2||!cadNativeRoundedContains(p,${glVec(boxes[2].halfExtentsMM)},${glNumber(boxes[2].filletRadiusMM)})||!cadNativeWaterBelow(p))return false;
 for(int i=0;i<18;i++)if(cadNativeSphereContains(p,cadNativeBubbles[i]))return false;
 return !cadNativeDuctBounds(p)||!cadDuctContains(p,module);
}
void cadNativeConsider(vec3 ro,vec3 rd,float distance,vec3 normal,int module,int solidId,int primitiveId,float minimum,inout CadOpticalHit best){
 if(distance<minimum||distance>best.distance||abs(dot(normal,rd))<.0000001)return;
 vec3 point=ro+rd*distance;normal=normalize(normal);
 // Normal-side membership avoids ray-angle-dependent slivers at tangencies.
 if(!cadNativeSolidContains(point-normal*.0005,module,solidId)||cadNativeSolidContains(point+normal*.0005,module,solidId))return;
 best=CadOpticalHit(distance,point,normal,solidId,primitiveId,dot(normal,rd)<0.);
}
int cadNativeQuadratic(float a,float b,float c,out vec2 roots){
 roots=vec2(0);if(abs(a)<.000000000001){if(abs(b)<.000000000001)return 0;roots.x=-c/b;return 1;}
 float determinant=b*b-4.*a*c;if(determinant<0.)return 0;
 float root=sqrt(max(0.,determinant)),q=-.5*(b+(b<0.?-root:root));
 if(abs(q)<.000000000001){roots.x=-b/(2.*a);return 1;}roots=vec2(q/a,c/q);return 2;
}
void cadNativeSphere(vec3 ro,vec3 rd,vec4 sphere,int module,int solidId,int primitiveId,float signNormal,float minimum,inout CadOpticalHit best){
 vec3 q=ro-sphere.xyz;vec2 roots;int count=cadNativeQuadratic(dot(rd,rd),2.*dot(q,rd),dot(q,q)-sphere.w*sphere.w,roots);
 for(int i=0;i<2;i++){if(i>=count)break;float distance=roots[i];vec3 p=ro+rd*distance;cadNativeConsider(ro,rd,distance,signNormal*(p-sphere.xyz)/sphere.w,module,solidId,primitiveId,minimum,best);}
}
void cadNativeCylinder(vec3 ro,vec3 rd,vec2 yz,float radius,int module,int solidId,int primitiveId,float signNormal,float minimum,inout CadOpticalHit best){
 vec2 q=ro.yz-yz,roots;int count=cadNativeQuadratic(dot(rd.yz,rd.yz),2.*dot(q,rd.yz),dot(q,q)-radius*radius,roots);
 for(int i=0;i<2;i++){if(i>=count)break;float distance=roots[i];vec3 p=ro+rd*distance;cadNativeConsider(ro,rd,distance,signNormal*vec3(0.,p.yz-yz)/radius,module,solidId,primitiveId,minimum,best);}
}
void cadNativeRoundedBox(vec3 ro,vec3 rd,vec3 halfExtent,float radius,int module,int solidId,int primitiveBase,float signNormal,float minimum,inout CadOpticalHit best){
 vec3 base=halfExtent-vec3(radius);
 for(int axis=0;axis<3;axis++)for(int side=0;side<2;side++){
  float signAxis=side==0?-1.:1.;if(abs(rd[axis])<.000000001)continue;float distance=(signAxis*halfExtent[axis]-ro[axis])/rd[axis];
  if(distance<minimum||distance>best.distance)continue;vec3 p=ro+rd*distance;
  int a=(axis+1)%3,b=(axis+2)%3;if(abs(p[a])>base[a]+.00001||abs(p[b])>base[b]+.00001)continue;
  vec3 n=vec3(0);n[axis]=signAxis;cadNativeConsider(ro,rd,distance,n*signNormal,module,solidId,primitiveBase+axis*2+side,minimum,best);
 }
 for(int axis=0;axis<3;axis++){int a=(axis+1)%3,b=(axis+2)%3;
  for(int sideA=0;sideA<2;sideA++)for(int sideB=0;sideB<2;sideB++){
   float sa=sideA==0?-1.:1.,sb=sideB==0?-1.:1.;vec2 q=vec2(ro[a]-sa*base[a],ro[b]-sb*base[b]),d=vec2(rd[a],rd[b]),roots;
   int count=cadNativeQuadratic(dot(d,d),2.*dot(q,d),dot(q,q)-radius*radius,roots);
   for(int i=0;i<2;i++){if(i>=count)break;float distance=roots[i];if(distance<minimum||distance>best.distance)continue;vec3 p=ro+rd*distance;
    vec2 n=vec2(p[a]-sa*base[a],p[b]-sb*base[b]);if(abs(p[axis])>base[axis]+.00001||sa*n.x<-.00001||sb*n.y<-.00001)continue;
    vec3 normal=vec3(0);normal[a]=n.x/radius;normal[b]=n.y/radius;cadNativeConsider(ro,rd,distance,normal*signNormal,module,solidId,primitiveBase+6+axis*4+sideA*2+sideB,minimum,best);
   }
  }
 }
 for(int ix=0;ix<2;ix++)for(int iy=0;iy<2;iy++)for(int iz=0;iz<2;iz++){
  vec3 signs=vec3(ix==0?-1.:1.,iy==0?-1.:1.,iz==0?-1.:1.),center=signs*base,q=ro-center;vec2 roots;
  int count=cadNativeQuadratic(dot(rd,rd),2.*dot(q,rd),dot(q,q)-radius*radius,roots);
  for(int i=0;i<2;i++){if(i>=count)break;float distance=roots[i];if(distance<minimum||distance>best.distance)continue;vec3 p=ro+rd*distance,n=p-center;
   if(any(lessThan(signs*n,vec3(-.00001))))continue;cadNativeConsider(ro,rd,distance,n/radius*signNormal,module,solidId,primitiveBase+18+ix*4+iy*2+iz,minimum,best);
  }
 }
}
int cadNativeCubicRoots(vec4 c,out vec3 roots){
 float scale=max(1.,max(max(abs(c.x),abs(c.y)),max(abs(c.z),abs(c.w)))),tolerance=scale*.0000001;
 roots=vec3(-1);if(all(lessThanEqual(abs(c),vec4(tolerance))))return 0;
 float cuts[4];cuts[0]=0.;cuts[1]=1.;cuts[2]=1.;cuts[3]=1.;int cutsCount=2;
 vec2 derivativeRoots;int derivativeCount=cadNativeQuadratic(3.*c.w,2.*c.z,c.y,derivativeRoots);
 for(int i=0;i<2;i++){if(i>=derivativeCount)break;float u=derivativeRoots[i];if(u>0.&&u<1.){cuts[cutsCount]=u;cutsCount++;}}
 for(int i=0;i<4;i++)for(int j=0;j<3;j++)if(j+1<cutsCount&&cuts[j]>cuts[j+1]){float temp=cuts[j];cuts[j]=cuts[j+1];cuts[j+1]=temp;}
 int count=0;for(int i=0;i<4;i++){if(i>=cutsCount)break;float u=cuts[i];if(abs(cadNativePolynomial(c,u))<=tolerance){bool duplicate=false;for(int j=0;j<3;j++)if(j<count&&abs(roots[j]-u)<.00001)duplicate=true;if(!duplicate&&count<3){roots[count]=u;count++;}}}
 for(int i=1;i<4;i++){if(i>=cutsCount)break;float lo=cuts[i-1],hi=cuts[i],fl=cadNativePolynomial(c,lo),fh=cadNativePolynomial(c,hi);if(fl*fh>=0.)continue;
  for(int step=0;step<24;step++){float middle=(lo+hi)*.5,fm=cadNativePolynomial(c,middle);if(fl*fm<=0.){hi=middle;fh=fm;}else{lo=middle;fl=fm;}}
  float u=(lo+hi)*.5;bool duplicate=false;for(int j=0;j<3;j++)if(j<count&&abs(roots[j]-u)<.00001)duplicate=true;if(!duplicate&&count<3){roots[count]=u;count++;}
 }return count;
}
bool cadNativeRayBounds(vec3 ro,vec3 rd,vec3 low,vec3 high,float minimum,float maximum){
 float a=minimum,b=maximum;for(int axis=0;axis<3;axis++){if(abs(rd[axis])<.000000001){if(ro[axis]<low[axis]||ro[axis]>high[axis])return false;}else{float t0=(low[axis]-ro[axis])/rd[axis],t1=(high[axis]-ro[axis])/rd[axis];a=max(a,min(t0,t1));b=min(b,max(t0,t1));if(a>b)return false;}}return true;
}
void cadNativeFreeSurface(vec3 ro,vec3 rd,float minimum,inout CadOpticalHit best){
 if(abs(rd.x)+abs(rd.z)<.000000001)return;
 for(int span=0;span<40;span++){
  vec4 bounds=cadNativeSpanBounds[span];if(!cadNativeRayBounds(ro,rd,vec3(bounds.x,-27.3,bounds.z)-vec3(.0001),vec3(bounds.y,27.3,bounds.w)+vec3(.0001),minimum,best.distance))continue;
  vec4 c=cadNativeZ[span]*rd.x-cadNativeX[span]*rd.z;c.x+=ro.x*rd.z-ro.z*rd.x;vec3 roots;int count=cadNativeCubicRoots(c,roots);
  for(int i=0;i<3;i++){if(i>=count)break;float u=roots[i],x=cadNativePolynomial(cadNativeX[span],u),z=cadNativePolynomial(cadNativeZ[span],u);
   float distance=abs(rd.x)>abs(rd.z)?(x-ro.x)/rd.x:(z-ro.z)/rd.z;if(distance<minimum||distance>best.distance)continue;
   vec3 p=ro+rd*distance;if(abs(p.x-x)>.001||abs(p.z-z)>.001)continue;
   float dx=cadNativeDerivative(cadNativeX[span],u),dz=cadNativeDerivative(cadNativeZ[span],u);vec3 normal=normalize(vec3(-dz/dx,0.,1.));
   cadNativeConsider(ro,rd,distance,normal,1,2,300+span,minimum,best);
  }
 }
}
bool nextOpticalEvent(vec3 ro,vec3 rd,int module,float minimum,float maximum,out CadOpticalHit hit){
 hit=CadOpticalHit(maximum,vec3(0),vec3(0),0,0,false);
 if(module==0){
  cadNativeSphere(ro,rd,${glVec([...lens.spheres[0].centerMM,lens.spheres[0].radiusMM])},0,1,10,1.,minimum,hit);
  cadNativeSphere(ro,rd,${glVec([...lens.spheres[1].centerMM,lens.spheres[1].radiusMM])},0,1,11,1.,minimum,hit);
  cadNativeCylinder(ro,rd,${glVec(lens.centralCylinder.axisPointMM.slice(1))},${glNumber(lens.centralCylinder.radiusMM)},0,1,12,-1.,minimum,hit);
 }else if(module==1){
  cadNativeRoundedBox(ro,rd,${glVec(boxes[0].halfExtentsMM)},${glNumber(boxes[0].filletRadiusMM)},1,1,100,1.,minimum,hit);
  cadNativeRoundedBox(ro,rd,${glVec(boxes[1].halfExtentsMM)},${glNumber(boxes[1].filletRadiusMM)},1,1,150,-1.,minimum,hit);
  cadNativeCylinder(ro,rd,${glVec(glass.portCylinder.axisPointMM.slice(1))},${glNumber(glass.portCylinder.radiusMM)},1,1,180,-1.,minimum,hit);
  cadNativeRoundedBox(ro,rd,${glVec(boxes[2].halfExtentsMM)},${glNumber(boxes[2].filletRadiusMM)},1,2,200,1.,minimum,hit);
  cadNativeFreeSurface(ro,rd,minimum,hit);
  for(int i=0;i<18;i++)cadNativeSphere(ro,rd,cadNativeBubbles[i],1,2,350+i,-1.,minimum,hit);
  CadDuctHit duct;if(cadNativeRayBounds(ro,rd,cadNativeDuctMin,cadNativeDuctMax,minimum,hit.distance)&&cadDuctEvent(ro,rd,module,minimum,hit.distance,duct))cadNativeConsider(ro,rd,duct.distance,duct.normal,module,2,400,minimum,hit);
 }return hit.solidId!=0;
}
bool cadNativeDielectric(vec3 direction,vec3 incidentNormal,float incidentIor,float targetIor,out vec3 outgoing,out float fresnel){
 if(incidentIor==targetIor){outgoing=direction;fresnel=0.;return true;}
 float cosine=clamp(-dot(direction,incidentNormal),0.,1.),eta=incidentIor/targetIor,k=1.-eta*eta*(1.-cosine*cosine);
 if(k<0.){outgoing=normalize(reflect(direction,incidentNormal));fresnel=1.;return false;}
 float transmittedCosine=sqrt(max(0.,k));outgoing=normalize(eta*direction+(eta*cosine-transmittedCosine)*incidentNormal);
 float rs=(incidentIor*cosine-targetIor*transmittedCosine)/(incidentIor*cosine+targetIor*transmittedCosine),rp=(targetIor*cosine-incidentIor*transmittedCosine)/(targetIor*cosine+incidentIor*transmittedCosine);fresnel=.5*(rs*rs+rp*rp);return true;
}
`;
}
