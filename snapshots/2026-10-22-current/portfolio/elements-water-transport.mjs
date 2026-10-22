// Native trilinear water-cell intersection and bounded internal dielectric
// transport. This does not replace the source SDF, smooth its geometry, or
// interpret a numerical failure as a physical perfectly reflecting surface.
export const WATER_TRANSPORT_LIMITS=Object.freeze({totalCells:96,tirBounces:4,rootRefinements:9});

export function trilinearRayPolynomial(v,u,w){
 const [x,y,z]=u,[dx,dy,dz]=w;
 const c=[v[0],v[1]-v[0],v[2]-v[0],v[4]-v[0],v[3]-v[1]-v[2]+v[0],v[5]-v[1]-v[4]+v[0],v[6]-v[2]-v[4]+v[0],v[7]-v[3]-v[5]-v[6]+v[1]+v[2]+v[4]-v[0]];
 return [c[0]+c[1]*x+c[2]*y+c[3]*z+c[4]*x*y+c[5]*x*z+c[6]*y*z+c[7]*x*y*z,
  c[1]*dx+c[2]*dy+c[3]*dz+c[4]*(x*dy+y*dx)+c[5]*(x*dz+z*dx)+c[6]*(y*dz+z*dy)+c[7]*(dx*y*z+x*dy*z+x*y*dz),
  c[4]*dx*dy+c[5]*dx*dz+c[6]*dy*dz+c[7]*(dx*dy*z+dx*y*dz+x*dy*dz),c[7]*dx*dy*dz];
}
export const evaluateWaterPolynomial=(a,t)=>((a[3]*t+a[2])*t+a[1])*t+a[0];
export function firstWaterCrossing(a,{fromInside=true,refinements=28}={}){
 const scale=Math.max(...a.map(Math.abs));if(!Number.isFinite(scale)||scale===0)return null;
 const sign=fromInside?1:-1; a=a.map(value=>value*sign/scale);
 const points=[0,1],A=3*a[3],B=2*a[2],C=a[1],epsilon=1e-12;
 if(Math.abs(A)<epsilon){if(Math.abs(B)>epsilon){const t=-C/B;if(t>0&&t<1)points.push(t);}}
 else{const discriminant=B*B-4*A*C;if(discriminant>=0){const d=Math.sqrt(discriminant),q=-.5*(B+(B>=0?d:-d));const roots=q===0?[-B/(2*A)]:[q/A,C/q];for(const t of roots)if(t>0&&t<1)points.push(t);}}
 points.sort((x,y)=>x-y);
 const crossesAt=t=>{
  const first=(3*a[3]*t+2*a[2])*t+a[1],second=a[2]+3*a[3]*t;
  if(Math.abs(first)>epsilon)return first>0;
  // An even-multiplicity touch is not an exit; a triple root can be one.
  return Math.abs(second)<=epsilon&&a[3]>epsilon;
 };
 for(let i=0;i<points.length-1;i++){
  let low=points[i],high=points[i+1];if(high-low<1e-12)continue;
  const left=evaluateWaterPolynomial(a,low),right=evaluateWaterPolynomial(a,high);
  if(left===0&&crossesAt(low))return {t:low,low,high:low};
  if(left<0&&right>0){
   for(let j=0;j<refinements;j++){const middle=(low+high)*.5;if(evaluateWaterPolynomial(a,middle)<0)low=middle;else high=middle;}
   return {t:(low+high)*.5,low,high};
  }
  if(right===0&&crossesAt(high))return {t:high,low:high,high};
 }
 return null;
}
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
export function dielectricWaterDirection(direction,outward,eta){
 const cosine=dot(direction,outward),k=1-eta*eta*(1-cosine*cosine);
 if(k<0)return {tir:true,direction:direction.map((v,i)=>v-2*cosine*outward[i])};
 const facing=cosine>0?outward.map(v=>-v):outward,c=dot(direction,facing);
 return {tir:false,direction:direction.map((v,i)=>eta*v-(eta*c+Math.sqrt(k))*facing[i])};
}
export function dielectricWaterFresnel(cosine,eta){
 const c=Math.min(1,Math.max(0,Math.abs(cosine))),sin2=eta*eta*(1-c*c);
 if(sin2>=1)return 1;
 const ct=Math.sqrt(1-sin2),rs=(eta*c-ct)/(eta*c+ct),rp=(c-eta*ct)/(c+eta*ct);
 return .5*(rs*rs+rp*rp);
}

// Exact bookkeeping for one resolved transmitted branch. exitReflection is
// still INSIDE the water. Sampling a far-field environment for that branch is
// a bounded radiance closure, not a claim that another surface was traced.
export function waterTransportWeights(entryFresnel,exitFresnel,transmittance=1){
 if([entryFresnel,exitFresnel,transmittance].some(value=>!Number.isFinite(value)||value<0||value>1))throw new RangeError('Dielectric weights must be finite in [0,1]');
 const inside=(1-entryFresnel)*transmittance;
 return {entryReflection:entryFresnel,absorption:(1-entryFresnel)*(1-transmittance),exitReflection:inside*exitFresnel,transmission:inside*(1-exitFresnel)};
}

export function centralWaterGradient(sample,position,spacing){
 return spacing.map((step,axis)=>{
  const positive=[...position],negative=[...position];positive[axis]+=step;negative[axis]-=step;
  return (sample(positive)-sample(negative))/(2*step);
 });
}

// The filtered normal describes the resolved optical surface, but it cannot
// send a reflected/transmitted ray onto the wrong side of the exact surface.
export function guardWaterOpticalNormal(filtered,geometric,incident,{exiting=false}={}){
 const length=Math.sqrt(dot(filtered,filtered));if(!(length>1e-9))return [...geometric];
 let normal=filtered.map(v=>v/length);if(dot(normal,geometric)<=0)return [...geometric];
 const eta=exiting?1.333:1/1.333,incidentSide=exiting?1:-1;
 for(let attempt=0;attempt<4;attempt++){
  const cosine=dot(incident,normal),reflected=incident.map((v,i)=>v-2*cosine*normal[i]);
  const transmitted=dielectricWaterDirection(incident,normal,eta);
  if(cosine*incidentSide>0&&dot(reflected,geometric)*(-incidentSide)>0&&(transmitted.tir||dot(transmitted.direction,geometric)*incidentSide>0))return normal;
  normal=normal.map((v,i)=>v+geometric[i]);const magnitude=Math.sqrt(dot(normal,normal));normal=normal.map(v=>v/magnitude);
 }
 return [...geometric];
}

// Float32 reference for the cell ownership/advancement arithmetic used below.
// Integer cell state, not a floating position plus a fixed epsilon, owns faces.
// Optional legacy mode exists only to reproduce the rejected traversal in tests.
export function waterDdaCellsFloat32(origin,direction,{budget=96,maximumTravel=1e20,legacy=false}={}){
 const f=Math.fround,grid=origin.map(f),d=direction.map(f),step=d.map(Math.sign);
 maximumTravel=f(maximumTravel);
 let travel=f(0),cell=grid.map(Math.floor);
 for(let axis=0;axis<3;axis++)if(step[axis]<0&&grid[axis]===cell[axis])cell[axis]--;
 const faceTimes=()=>cell.map((value,axis)=>Math.abs(d[axis])>1e-9?f(f(value+(step[axis]>0?1:0)-grid[axis])/d[axis]):f(1e20));
 let face=faceTimes();const cells=[];
 for(let iteration=0;iteration<budget;iteration++){
  const position=grid.map((v,i)=>f(v+f(d[i]*travel)));
  if(legacy){
   cell=position.map((v,i)=>Math.floor(f(v+f(step[i]*1e-5))));
   face=cell.map((v,i)=>Math.abs(d[i])>1e-9?f(f(v+(step[i]>=0?1:0)-position[i])/d[i]):f(1e20));
   const segment=Math.min(f(maximumTravel-travel),Math.max(f(1e-7),Math.min(...face)));
   if(!(segment>0))return {cells,travel,complete:true};
   cells.push({cell:[...cell],travel,segment});travel=f(travel+segment);
  }else{
   const next=f(Math.min(...face,maximumTravel)),segment=f(next-travel);
   if(segment>0)cells.push({cell:[...cell],travel,segment});
   if(next>=maximumTravel)return {cells,travel:next,complete:true};
   // Every exact tied face advances. Near ties become a tiny subsequent cell,
   // never a repeated one: no arbitrary tolerance can skip a real corner cell.
   for(let axis=0;axis<3;axis++)if(face[axis]<=next)cell[axis]+=step[axis];
   travel=next;face=faceTimes();
  }
 }
 return {cells,travel,complete:false};
}

// Contract: existing uWaterVolume/uWaterTextureScale/uWaterTextureOffset,
// uLocalToWater/uWaterMetric/uWaterVoxelSize uniforms. Distance samples are
// source millimetres; ray t and returned pathLength are presentation units.
// Status 0=escaped, 1=entry not resolved, 2=cell budget, 3=TIR budget,
// 4=left sampled domain unexpectedly, 5=degenerate boundary gradient.
export const nativeWaterTransportGLSL=`
struct NativeWaterCell { vec4 a; vec4 b; vec2 range; };
struct NativeWaterBoundary { int status; int cells; vec3 point; vec3 normal; float travel; float margin; };
struct NativeWaterPath { int status; int cells; int tirBounces; vec3 entryPoint; vec3 entryNormal; vec3 entryGeometricNormal; vec3 exitPoint; vec3 exitNormal; vec3 exitGeometricNormal; vec3 direction; vec3 exitReflectionPoint; vec3 exitReflectionDirection; float pathLength; float entryFresnel; float exitFresnel; };
NativeWaterCell nativeWaterCell(ivec3 q){
 float v000=texelFetch(uWaterVolume,q,0).r,v100=texelFetch(uWaterVolume,q+ivec3(1,0,0),0).r;
 float v010=texelFetch(uWaterVolume,q+ivec3(0,1,0),0).r,v110=texelFetch(uWaterVolume,q+ivec3(1,1,0),0).r;
 float v001=texelFetch(uWaterVolume,q+ivec3(0,0,1),0).r,v101=texelFetch(uWaterVolume,q+ivec3(1,0,1),0).r;
 float v011=texelFetch(uWaterVolume,q+ivec3(0,1,1),0).r,v111=texelFetch(uWaterVolume,q+ivec3(1,1,1),0).r;
 NativeWaterCell c;c.a=vec4(v000,v100-v000,v010-v000,v001-v000);
 c.b=vec4(v110-v100-v010+v000,v101-v100-v001+v000,v011-v010-v001+v000,v111-v110-v101-v011+v100+v010+v001-v000);
 c.range=vec2(min(min(min(v000,v100),min(v010,v110)),min(min(v001,v101),min(v011,v111))),max(max(max(v000,v100),max(v010,v110)),max(max(v001,v101),max(v011,v111))));return c;
}
vec4 nativeWaterPolynomial(NativeWaterCell c,vec3 u,vec3 w){
 float a0=c.a.x+dot(c.a.yzw,u)+c.b.x*u.x*u.y+c.b.y*u.x*u.z+c.b.z*u.y*u.z+c.b.w*u.x*u.y*u.z;
 float a1=dot(c.a.yzw,w)+c.b.x*(u.x*w.y+u.y*w.x)+c.b.y*(u.x*w.z+u.z*w.x)+c.b.z*(u.y*w.z+u.z*w.y)+c.b.w*(w.x*u.y*u.z+u.x*w.y*u.z+u.x*u.y*w.z);
 float a2=c.b.x*w.x*w.y+c.b.y*w.x*w.z+c.b.z*w.y*w.z+c.b.w*(w.x*w.y*u.z+w.x*u.y*w.z+u.x*w.y*w.z);
 return vec4(a0,a1,a2,c.b.w*w.x*w.y*w.z);
}
float nativeWaterPoly(vec4 a,float t){return ((a.w*t+a.z)*t+a.y)*t+a.x;}
vec3 nativeWaterCellGradient(NativeWaterCell c,vec3 u){return c.a.yzw+vec3(c.b.x*u.y+c.b.y*u.z+c.b.w*u.y*u.z,c.b.x*u.x+c.b.z*u.z+c.b.w*u.x*u.z,c.b.y*u.x+c.b.z*u.y+c.b.w*u.x*u.y);}
bool nativeWaterCrossesAt(vec4 a,float t){
 float first=(3.0*a.w*t+2.0*a.z)*t+a.y,second=a.z+3.0*a.w*t;
 if(abs(first)>1e-7)return first>0.0;
 return abs(second)<=1e-7&&a.w>1e-7;
}
vec2 nativeWaterCrossing(vec4 a,bool fromInside){
 float scale=max(max(abs(a.x),abs(a.y)),max(abs(a.z),abs(a.w)));if(scale==0.0)return vec2(-1.0);
 a*=((fromInside?1.0:-1.0)/scale);float A=3.0*a.w,B=2.0*a.z,C=a.y,r0=1.0,r1=1.0;
 float e=1e-7;
 if(abs(A)<e){if(abs(B)>e){float r=-C/B;if(r>0.0&&r<1.0)r0=r;}}
 else{float discriminant=B*B-4.0*A*C;if(discriminant>=0.0){float rootD=sqrt(discriminant),q=-.5*(B+(B>=0.0?rootD:-rootD));float x=q==0.0?-B/(2.0*A):q/A,y=q==0.0?x:C/q;if(x>0.0&&x<1.0)r0=x;if(y>0.0&&y<1.0)r1=y;}}
 vec4 partitions=vec4(0.0,min(r0,r1),max(r0,r1),1.0);
 for(int intervalIndex=0;intervalIndex<3;intervalIndex++){
  float low=partitions[intervalIndex],high=partitions[intervalIndex+1];if(high-low<1e-7)continue;
  float left=nativeWaterPoly(a,low),right=nativeWaterPoly(a,high);
  if(left==0.0&&nativeWaterCrossesAt(a,low))return vec2(low);
  if(left<0.0&&right>0.0){
   for(int refine=0;refine<9;refine++){float mid=(low+high)*.5;if(nativeWaterPoly(a,mid)<0.0)low=mid;else high=mid;}
   return vec2(low,high);
  }
  if(right==0.0&&nativeWaterCrossesAt(a,high))return vec2(high);
 }
 return vec2(-1.0);
}
NativeWaterBoundary nativeWaterBoundary(vec3 ro,vec3 rd,bool fromInside,int budget,float maximumTravel){
 NativeWaterBoundary result;result.status=2;result.cells=0;result.point=ro;result.normal=vec3(0.0);result.travel=0.0;result.margin=0.0;
 vec3 dimensions=vec3(textureSize(uWaterVolume,0));vec3 source=(uLocalToWater*vec4(ro,1.0)).xyz;
 vec3 grid=source*uWaterTextureScale*dimensions+uWaterTextureOffset*dimensions-.5;
 vec3 gridDirection=(mat3(uLocalToWater)*rd)*uWaterTextureScale*dimensions;
 ivec3 cell=ivec3(floor(grid)),cellStep=ivec3(sign(gridDirection));
 // A negative ray starting exactly on a face belongs to the cell below it.
 if(cellStep.x<0&&grid.x==float(cell.x))cell.x--;
 if(cellStep.y<0&&grid.y==float(cell.y))cell.y--;
 if(cellStep.z<0&&grid.z==float(cell.z))cell.z--;
 vec3 faceTimes=vec3(1e20),forward=step(vec3(0.0),gridDirection);
 if(abs(gridDirection.x)>1e-9)faceTimes.x=(float(cell.x)+forward.x-grid.x)/gridDirection.x;
 if(abs(gridDirection.y)>1e-9)faceTimes.y=(float(cell.y)+forward.y-grid.y)/gridDirection.y;
 if(abs(gridDirection.z)>1e-9)faceTimes.z=(float(cell.z)+forward.z-grid.z)/gridDirection.z;
 float travel=0.0;
 for(int cellIndex=0;cellIndex<96;cellIndex++){
  if(cellIndex>=budget)break;
  result.travel=travel;result.point=ro+rd*travel;
  if(any(lessThan(cell,ivec3(0)))||any(greaterThanEqual(cell,ivec3(dimensions)-1))){result.status=4;return result;}
  float next=min(min(faceTimes.x,faceTimes.y),faceTimes.z),finish=min(next,maximumTravel),segment=finish-travel;
  if(segment<=0.0){
   if(finish>=maximumTravel){result.status=1;return result;}
   // Roundoff can collapse a corner segment. Advance its integer face owner;
   // never manufacture a tiny world step that may leave the cell unchanged.
   if(faceTimes.x<=next){cell.x+=cellStep.x;faceTimes.x=(float(cell.x)+forward.x-grid.x)/gridDirection.x;}
   if(faceTimes.y<=next){cell.y+=cellStep.y;faceTimes.y=(float(cell.y)+forward.y-grid.y)/gridDirection.y;}
   if(faceTimes.z<=next){cell.z+=cellStep.z;faceTimes.z=(float(cell.z)+forward.z-grid.z)/gridDirection.z;}
   travel=finish;continue;
  }
  vec3 location=grid+gridDirection*travel;
  vec3 u=clamp(location-vec3(cell),0.0,1.0),w=gridDirection*segment;
  NativeWaterCell c=nativeWaterCell(cell);result.cells++;
  // Trilinear interpolation is a convex combination of the cell corners.
  // A cell with no sign range cannot contain any zero, irrespective of ray.
  vec2 root=vec2(-1.0);
  if(c.range.x<=0.0&&c.range.y>=0.0)root=nativeWaterCrossing(nativeWaterPolynomial(c,u,w),fromInside);
  if(root.x>=0.0){
   float fraction=(root.x+root.y)*.5;vec3 gradient=nativeWaterCellGradient(c,u+w*fraction)*uWaterTextureScale*dimensions;
   gradient=transpose(mat3(uLocalToWater))*gradient;
   if(dot(gradient,gradient)<1e-12){result.status=5;return result;}
   result.status=0;result.travel=travel+fraction*segment;result.point=ro+rd*result.travel;result.normal=normalize(gradient);
   result.margin=max(uWaterVoxelSize*.004,(root.y-root.x)*segment*2.0);return result;
  }
  travel=finish;
  if(finish>=maximumTravel){result.status=1;result.travel=travel;result.point=ro+rd*travel;return result;}
  // Absolute face times are recomputed from the original ray, avoiding both
  // accumulated tMax drift and floor(position + epsilon) float32 stalls.
  if(faceTimes.x<=next){cell.x+=cellStep.x;faceTimes.x=(float(cell.x)+forward.x-grid.x)/gridDirection.x;}
  if(faceTimes.y<=next){cell.y+=cellStep.y;faceTimes.y=(float(cell.y)+forward.y-grid.y)/gridDirection.y;}
  if(faceTimes.z<=next){cell.z+=cellStep.z;faceTimes.z=(float(cell.z)+forward.z-grid.z)/gridDirection.z;}
 }
 result.travel=travel;return result;
}
float nativeWaterFresnel(float cosine,float eta){
 float c=clamp(abs(cosine),0.0,1.0),sin2=eta*eta*(1.0-c*c);if(sin2>=1.0)return 1.0;
 float ct=sqrt(1.0-sin2),rs=(eta*c-ct)/(eta*c+ct),rp=(c-eta*ct)/(c+eta*ct);return .5*(rs*rs+rp*rp);
}
vec3 nativeWaterOpticalNormal(vec3 point,vec3 geometric,vec3 incident,bool exiting){
 // Trilinear value reconstruction is C0; its per-cell derivative jumps at
 // every cell face. A centred derivative over one SOURCE voxel reconstructs
 // the optical normal at the stored field's resolution. Geometry and all
 // offsets continue to use the exact unfiltered trilinear zero surface.
 vec3 dimensions=vec3(textureSize(uWaterVolume,0)),delta=1.0/dimensions;
 vec3 source=(uLocalToWater*vec4(point,1.0)).xyz,uv=source*uWaterTextureScale+uWaterTextureOffset;
 vec3 gradient=vec3(
  textureLod(uWaterVolume,uv+vec3(delta.x,0.0,0.0),0.0).r-textureLod(uWaterVolume,uv-vec3(delta.x,0.0,0.0),0.0).r,
  textureLod(uWaterVolume,uv+vec3(0.0,delta.y,0.0),0.0).r-textureLod(uWaterVolume,uv-vec3(0.0,delta.y,0.0),0.0).r,
  textureLod(uWaterVolume,uv+vec3(0.0,0.0,delta.z),0.0).r-textureLod(uWaterVolume,uv-vec3(0.0,0.0,delta.z),0.0).r);
 gradient=transpose(mat3(uLocalToWater))*(gradient*uWaterTextureScale*dimensions*.5);
 if(dot(gradient,gradient)<1e-12)return geometric;
 vec3 normal=normalize(gradient);if(dot(normal,geometric)<=0.0)return geometric;
 float eta=exiting?1.333:1.0/1.333,incidentSide=exiting?1.0:-1.0;
 for(int guardIndex=0;guardIndex<4;guardIndex++){
  float cosine=dot(incident,normal),discriminant=1.0-eta*eta*(1.0-cosine*cosine);
  vec3 reflected=reflect(incident,normal),transmitted=discriminant>=0.0?refract(incident,exiting?-normal:normal,eta):vec3(0.0);
  if(cosine*incidentSide>0.0&&dot(reflected,geometric)*(-incidentSide)>0.0&&(discriminant<0.0||dot(transmitted,geometric)*incidentSide>0.0))return normal;
  // Blend toward the exact geometry only when an optical ray would cross
 // the wrong geometric hemisphere. This is not an arbitrary normal clamp.
  normal=normalize(normal+geometric);
 }
 return geometric;
}
NativeWaterPath traceNativeWaterTransport(vec3 estimatedEntry,vec3 incident,float maximumEntryBacktrack){
 NativeWaterPath result;result.status=1;result.cells=0;result.tirBounces=0;result.entryPoint=estimatedEntry;result.entryNormal=vec3(0.0);result.entryGeometricNormal=vec3(0.0);result.exitPoint=estimatedEntry;result.exitNormal=vec3(0.0);result.exitGeometricNormal=vec3(0.0);result.direction=incident;result.exitReflectionPoint=estimatedEntry;result.exitReflectionDirection=vec3(0.0);result.pathLength=0.0;result.entryFresnel=0.0;result.exitFresnel=0.0;
 // Locate the actual entering cubic root; a normal offset from a merely close
 // primary sample can jump completely through a thin native liquid fragment.
 // Cap refinement at the current ray origin. Otherwise a nearby subsequent
 // body can rediscover a thin fragment that this ray has already traversed.
 float pad=min(uWaterVoxelSize*2.0,max(0.0,maximumEntryBacktrack));
 NativeWaterBoundary entry=nativeWaterBoundary(estimatedEntry-incident*pad,incident,false,16,pad+uWaterVoxelSize*6.0);
 result.cells=entry.cells;if(entry.status!=0){result.status=entry.status;return result;}
 result.entryPoint=entry.point;result.entryGeometricNormal=entry.normal;result.entryNormal=nativeWaterOpticalNormal(entry.point,entry.normal,incident,false);result.entryFresnel=nativeWaterFresnel(dot(incident,result.entryNormal),1.0/1.333);
 vec3 direction=normalize(refract(incident,result.entryNormal,1.0/1.333));
 vec3 ro=entry.point-entry.normal*entry.margin;
 for(int boundaryIndex=0;boundaryIndex<5;boundaryIndex++){
  NativeWaterBoundary boundary=nativeWaterBoundary(ro,direction,true,96-result.cells,20.0);
  result.cells+=boundary.cells;if(boundary.status!=0){result.status=boundary.status;return result;}
  result.pathLength+=boundary.travel;result.exitPoint=boundary.point;result.exitGeometricNormal=boundary.normal;result.exitNormal=nativeWaterOpticalNormal(boundary.point,boundary.normal,direction,true);
  float eta=1.333,cosine=clamp(dot(direction,result.exitNormal),0.0,1.0),discriminant=1.0-eta*eta*(1.0-cosine*cosine);
  if(discriminant>=0.0){
   result.status=0;result.exitFresnel=nativeWaterFresnel(cosine,eta);result.direction=normalize(refract(direction,-result.exitNormal,eta));
   // Keep the omitted non-TIR branch explicit. It has NOT escaped: the point
   // is just inside the exact boundary, and its direction is inward. A caller
   // can trace it, or use a labelled environment closure with weight Fexit.
   result.exitReflectionPoint=boundary.point-boundary.normal*boundary.margin;
   result.exitReflectionDirection=normalize(reflect(direction,result.exitNormal));
   result.exitPoint+=boundary.normal*boundary.margin;return result;
  }
  // Total internal reflection is at this internal EXIT boundary, not at the
  // entry surface. It preserves remaining ray energy and stays in the water.
  if(boundaryIndex>=4){result.status=3;return result;}
  result.tirBounces++;direction=normalize(reflect(direction,result.exitNormal));ro=boundary.point-boundary.normal*boundary.margin;
 }
 result.status=3;return result;
}
`;
