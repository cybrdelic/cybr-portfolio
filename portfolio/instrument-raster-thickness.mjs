const optical=material=>(material?.userData?.cadTransmission??material?.transmission??0)>0;
const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
function unit(value){if(!value||value.length!==3||Array.from(value).some(component=>!Number.isFinite(component)))return null;const length=Math.hypot(...value);return length>0&&Number.isFinite(length)?Array.from(value,component=>component/length):null;}

/** Capture the exterior liquid boundary, never the closed bubble-void shells.
 * Native CAD duplicates vertices at face seams. Connectivity is welded only
 * for classification; all retained triangle indices and attributes stay exact.
 */
export function waterOuterBoundaryIndices(position,index,{quantizationMM=.0001}={}){
 if(!position?.array||position.itemSize!==3||!index?.array||index.itemSize!==1||index.count%3||!(quantizationMM>0)||!Number.isFinite(quantizationMM))throw Error('Invalid native water boundary');
 const requestedQuantizationMM=quantizationMM,triangleCount=index.count/3,parent=Uint32Array.from({length:triangleCount},(_,i)=>i),welded=new Uint32Array(position.count),active=new Uint8Array(triangleCount),edges=new Map();
 const find=value=>{let root=value;while(parent[root]!==root)root=parent[root];while(parent[value]!==value){const next=parent[value];parent[value]=root;value=next;}return root;};
 const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);};
 const bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
 for(let i=0;i<position.count;i++){
  const p=[position.getX(i),position.getY(i),position.getZ(i)];if(p.some(value=>!Number.isFinite(value)))throw Error('Nonfinite native water position');
  for(let axis=0;axis<3;axis++){bounds[0][axis]=Math.min(bounds[0][axis],p[axis]);bounds[1][axis]=Math.max(bounds[1][axis],p[axis]);}
 }
 let rawZeroAreaTriangles=0;
 for(let triangle=0;triangle<triangleCount;triangle++){
  const ids=[index.getX(triangle*3),index.getX(triangle*3+1),index.getX(triangle*3+2)];if(ids.some(value=>!Number.isInteger(value)||value<0||value>=position.count))throw Error('Native water index outside positions');
  const p=ids.map(i=>[position.getX(i),position.getY(i),position.getZ(i)]),a=p[1].map((v,i)=>v-p[0][i]),b=p[2].map((v,i)=>v-p[0][i]);
  // Only exactly zero-area source faces can be discarded. Small native faces
  // are real geometry; a rounded classification grid must not erase them.
  if(a[1]*b[2]-a[2]*b[1]===0&&a[2]*b[0]-a[0]*b[2]===0&&a[0]*b[1]-a[1]*b[0]===0)rawZeroAreaTriangles++;else active[triangle]=1;
 }
 let weldedDegenerateTriangles=0,quantizationRefinements=0;
 for(;;){
  const vertices=new Map();
  for(let i=0;i<position.count;i++){
   const key=[position.getX(i),position.getY(i),position.getZ(i)].map(value=>Math.round(value/quantizationMM)).join(',');let vertex=vertices.get(key);if(vertex===undefined){vertex=vertices.size;vertices.set(key,vertex);}welded[i]=vertex;
  }
  weldedDegenerateTriangles=0;
  for(let triangle=0;triangle<triangleCount;triangle++)if(active[triangle]){const a=welded[index.getX(triangle*3)],b=welded[index.getX(triangle*3+1)],c=welded[index.getX(triangle*3+2)];if(a===b||b===c||a===c)weldedDegenerateTriangles++;}
  if(!weldedDegenerateTriangles||quantizationRefinements===8)break;
  // Refining connectivity changes no source position, normal or triangle.
  // Closed-shell validation below remains mandatory before deleting cavities.
  quantizationMM*=.1;quantizationRefinements++;
 }
 for(let triangle=0;triangle<triangleCount;triangle++)if(active[triangle]){
  const w=[0,1,2].map(corner=>welded[index.getX(triangle*3+corner)]);if(w[0]===w[1]||w[1]===w[2]||w[0]===w[2])continue;
  for(let side=0;side<3;side++){const a=w[side],b=w[(side+1)%3],key=Math.min(a,b)+','+Math.max(a,b),orientation=a<b?1:-1;let edge=edges.get(key);if(!edge){edge={triangle,count:0,orientation:0};edges.set(key,edge);}else join(triangle,edge.triangle);edge.count++;edge.orientation+=orientation;}
 }
 const center=bounds[0].map((value,axis)=>(value+bounds[1][axis])*.5),components=new Map();
 for(let triangle=0;triangle<triangleCount;triangle++)if(active[triangle]){
  const root=find(triangle);let component=components.get(root);if(!component){component={root,triangles:0,signedVolumeMM3:0,closed:true};components.set(root,component);}component.triangles++;
  const p=[0,1,2].map(corner=>{const i=index.getX(triangle*3+corner);return[position.getX(i)-center[0],position.getY(i)-center[1],position.getZ(i)-center[2]];});
  component.signedVolumeMM3+=dot(p[0],[p[1][1]*p[2][2]-p[1][2]*p[2][1],p[1][2]*p[2][0]-p[1][0]*p[2][2],p[1][0]*p[2][1]-p[1][1]*p[2][0]])/6;
 }
 for(const edge of edges.values())if(edge.count!==2||edge.orientation!==0)components.get(find(edge.triangle)).closed=false;
 const volumeTolerance=Math.max(1e-10,Math.hypot(...bounds[1].map((value,axis)=>value-bounds[0][axis]))**3*1e-12),list=[...components.values()],outer=list.filter(component=>component.signedVolumeMM3>volumeTolerance),cavities=list.filter(component=>component.signedVolumeMM3 < -volumeTolerance);
 const validated=weldedDegenerateTriangles===0&&list.every(component=>component.closed&&Math.abs(component.signedVolumeMM3)>volumeTolerance)&&outer.length>0;
 const removed=validated?new Set(cavities.map(component=>component.root)):new Set(),kept=[];
 const filtered=validated&&(removed.size>0||rawZeroAreaTriangles>0);
 if(filtered)for(let triangle=0;triangle<triangleCount;triangle++)if(active[triangle]&&!removed.has(find(triangle)))kept.push(index.getX(triangle*3),index.getX(triangle*3+1),index.getX(triangle*3+2));
 const indices=filtered?new index.array.constructor(kept):index.array;
 return{indices,audit:{method:'Adaptive seam connectivity preserving nonzero native faces and signed closed-shell volume; positive exterior shells only',requestedQuantizationMM,quantizationMM,quantizationRefinements,rawZeroAreaTriangles,discardedZeroAreaTriangles:validated?rawZeroAreaTriangles:0,weldedDegenerateTriangles,validated,reason:validated?'closed consistently oriented components':weldedDegenerateTriangles?'welded degenerate triangle':'open, nonmanifold or ambiguously oriented component',componentCount:list.length,outerComponents:outer.length,cavityComponents:cavities.length,removedCavities:removed.size,sourceTriangles:triangleCount,fieldTriangles:indices.length/3,componentDetailsTruncated:list.length>32,components:list.slice(0,32).map(({triangles,signedVolumeMM3,closed})=>({triangles,signedVolumeMM3,closed,kind:signedVolumeMM3>volumeTolerance?'exterior':signedVolumeMM3 < -volumeTolerance?'cavity':'ambiguous'}))}};
}
export function deriveRefractedThickness({exitDepth,entryDepth,viewDirection,normal,ior,fieldId,materialId,authoredThickness,maxDistance=Infinity,uv=[.5,.5]}){
 if(!Number.isFinite(authoredThickness)||authoredThickness<0)throw Error('Invalid authored optical thickness');
 const view=unit(viewDirection),n=unit(normal);
 if(!view||!n||!Number.isFinite(exitDepth)||!Number.isFinite(entryDepth)||!Number.isFinite(ior)||ior<=0||!(materialId>0)||fieldId!==materialId||uv?.length!==2||uv.some(value=>!Number.isFinite(value)||value<0||value>1)||view[2]<=.00001)return authoredThickness;
 const chord=(exitDepth-entryDepth)/view[2],cosI=Math.abs(dot(view,n)),cosTSquared=1-(1-cosI*cosI)/(ior*ior);
 if(!(chord>0)||chord>maxDistance||cosTSquared<=.0000000001)return authoredThickness;
 const distance=chord*cosI/Math.sqrt(cosTSquared);
 return Number.isFinite(distance)&&distance>0&&distance<=maxDistance?distance:authoredThickness;
}
export function transmissionSampleBehindEntry({uv,depth,entryDepth,inverseProjection,tolerance=.1}){
 if(uv?.length!==2||Array.from(uv).some(value=>!Number.isFinite(value)||value<0||value>1)||!Number.isFinite(depth)||depth<0||depth>1)return false;
 if(depth>=.999999)return true;
 const matrix=inverseProjection?.elements??inverseProjection;if(!matrix||matrix.length!==16||Array.from(matrix).some(value=>!Number.isFinite(value))||!Number.isFinite(entryDepth)||!Number.isFinite(tolerance)||tolerance<0)return false;
 const clip=[uv[0]*2-1,uv[1]*2-1,depth*2-1,1],z=clip.reduce((sum,value,i)=>sum+matrix[i*4+2]*value,0),w=clip.reduce((sum,value,i)=>sum+matrix[i*4+3]*value,0);
 const sampledDepth=-z/w;return Math.abs(w)>1e-10&&Number.isFinite(sampledDepth)&&sampledDepth>=entryDepth-tolerance;
}
// Fixed-point intersections with the visible opaque depth field. This is a
// bounded screen-space interior-hit correction, not nested volume transport.
export function resolveInteriorTransmission({entryView,rayView,projection,inverseProjection,sampleDepth,toleranceMM=.2}){
 const valid=value=>value?.length===3&&Array.from(value).every(Number.isFinite),p=projection?.elements??projection,ip=inverseProjection?.elements??inverseProjection;
 if(!valid(entryView)||!valid(rayView)||!p||p.length!==16||!ip||ip.length!==16||![...p,...ip].every(Number.isFinite)||typeof sampleDepth!=='function'||!Number.isFinite(toleranceMM)||toleranceMM<0)throw Error('Invalid interior transmission path');
 const original=Array.from(rayView),reject=reason=>({ray:original,resolved:false,reason}),entryDepth=-entryView[2],depthLength=-rayView[2];
 if(!(depthLength>.00001))return reject('ray does not enter increasing view depth');
 const uvAt=fraction=>{const q=entryView.map((value,i)=>value+rayView[i]*fraction),clip=[0,1,3].map(row=>q.reduce((sum,value,i)=>sum+p[i*4+row]*value,p[12+row]));if(!(clip[2]>.0000000001))return null;const uv=[clip[0]/clip[2]*.5+.5,clip[1]/clip[2]*.5+.5];return uv.every(value=>value>=0&&value<=1)?uv:null;};
 const depthAt=uv=>{if(!uv)return null;const depth=sampleDepth(uv);if(!Number.isFinite(depth)||depth<0||depth>=.999999)return null;const clip=[uv[0]*2-1,uv[1]*2-1,depth*2-1,1],z=clip.reduce((sum,value,i)=>sum+ip[i*4+2]*value,0),w=clip.reduce((sum,value,i)=>sum+ip[i*4+3]*value,0);return Math.abs(w)>.0000000001?-z/w:null;};
 const inside=depth=>Number.isFinite(depth)&&depth>entryDepth+.1&&depth<entryDepth+depthLength-.1;
 let depth=depthAt(uvAt(0));if(!inside(depth))return reject('no visible opaque seed inside the medium');let fraction=(depth-entryDepth)/depthLength;
 for(let step=0;step<4;step++){depth=depthAt(uvAt(fraction));if(!inside(depth))return reject('refined source left the medium or viewport');fraction=(depth-entryDepth)/depthLength;}
 depth=depthAt(uvAt(fraction));if(!inside(depth)||Math.abs(depth-(entryDepth+depthLength*fraction))>toleranceMM)return reject('opaque intersection did not converge');
 return{ray:rayView.map(value=>value*fraction),resolved:true,reason:'visible opaque hit before exit',fraction};
}
export function octEncodeNormal(value){
 const n=unit(value);if(!n)throw Error('Invalid exit normal');const divisor=n.reduce((sum,value)=>sum+Math.abs(value),0),q=n.map(value=>value/divisor),sign=value=>value>=0?1:-1;
 return(q[2]>=0?q.slice(0,2):[(1-Math.abs(q[1]))*sign(q[0]),(1-Math.abs(q[0]))*sign(q[1])]).map(value=>value*.5+.5);
}
export function octDecodeNormal(value){
 if(value?.length!==2||!Array.from(value).every(Number.isFinite))throw Error('Invalid encoded exit normal');const p=Array.from(value,x=>x*2-1),n=[p[0],p[1],1-Math.abs(p[0])-Math.abs(p[1])],fold=Math.max(0,-n[2]);n[0]+=n[0]>=0?-fold:fold;n[1]+=n[1]>=0?-fold:fold;return unit(n);
}
/** CPU reference for three local-plane exit refinements, with final depth guard. */
export function refineTransmissionExit({entryView,rayView,projection,inverseProjection,sampleExit,materialId,maxDistance=Infinity,toleranceMM=.3}){
 const p=projection?.elements??projection,ip=inverseProjection?.elements??inverseProjection,direction=unit(rayView),original=Array.from(rayView),reject=reason=>({valid:false,ray:original,reason});
 if(!direction||entryView?.length!==3||!Array.from(entryView).every(Number.isFinite)||!p||p.length!==16||!ip||ip.length!==16||typeof sampleExit!=='function'||!(materialId>0)||!(maxDistance>0))throw Error('Invalid refracted exit refinement');
 const project=point=>{const q=[...point,1],x=q.reduce((s,v,i)=>s+p[i*4]*v,0),y=q.reduce((s,v,i)=>s+p[i*4+1]*v,0),w=q.reduce((s,v,i)=>s+p[i*4+3]*v,0);if(w<=1e-10)return null;const uv=[x/w*.5+.5,y/w*.5+.5];return uv.every(value=>value>=0&&value<=1)?uv:null;};
 const pointAtDepth=(uv,depth)=>{const unproject=z=>{const q=[uv[0]*2-1,uv[1]*2-1,z,1],v=[0,1,2,3].map(row=>q.reduce((s,x,i)=>s+ip[i*4+row]*x,0));return v.slice(0,3).map(x=>x/v[3]);},a=unproject(-1),b=unproject(1),fraction=(-depth-a[2])/(b[2]-a[2]);return a.map((value,i)=>value+(b[i]-value)*fraction);};
 let uv=project(entryView),distance=Math.hypot(...rayView),normal;
 for(let step=0;step<3;step++){
  if(!uv)return reject('exit outside viewport');const sample=sampleExit(uv);normal=unit(sample?.normal);if(!sample||sample.id!==materialId||!(sample.depth>0)||!normal)return reject('missing matching exit');const cosine=dot(normal,direction);if(cosine<=.00001)return reject('exit plane faces away from outgoing segment');const exit=pointAtDepth(uv,sample.depth);distance=dot(normal,exit.map((value,i)=>value-entryView[i]))/cosine;if(!(distance>0)||distance>maxDistance)return reject('exit distance outside native bound');uv=project(entryView.map((value,i)=>value+direction[i]*distance));
 }
 if(!uv)return reject('exit outside viewport');const sample=sampleExit(uv);normal=unit(sample?.normal);if(!sample||sample.id!==materialId||!normal||dot(normal,direction)<=.00001||Math.abs(sample.depth+entryView[2]+direction[2]*distance)>toleranceMM)return reject('exit did not converge');
 return{valid:true,ray:direction.map(value=>value*distance),normal,reason:'matching projected exit plane and depth'};
}
const declarations=`
uniform sampler2D cadThicknessField;
uniform vec2 cadThicknessFullSize;
uniform float cadThicknessId,cadThicknessMaximum;
uniform bool cadThicknessEnabled;
uniform sampler2D cadThicknessSourceDepth;
uniform bool cadThicknessDepthReady;
uniform vec3 cadThicknessPaper;
uniform mat4 cadThicknessInverseProjection;
bool cadThicknessValidPath=false;
bool cadThicknessInteriorHit=false;
float cadThicknessExitTransmission=1.;
`;
const interiorPath=`
bool cadTransmissionUv(vec3 viewPoint,mat4 projection,out vec2 uv){
 vec4 clip=projection*vec4(viewPoint,1.);
 if(clip.w<=.0000000001)return false;
 uv=clip.xy/clip.w*.5+.5;
 return all(greaterThanEqual(uv,vec2(0)))&&all(lessThanEqual(uv,vec2(1)));
}
bool cadTransmissionDepth(vec2 uv,out float viewDepth){
 float depth=texture2D(cadThicknessSourceDepth,uv).x;
 if(depth>=.999999)return false;
 vec4 point=cadThicknessInverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);
 if(abs(point.w)<.0000000001)return false;
 viewDepth=-point.z/point.w;return viewDepth>0.;
}
vec3 cadInteriorTransmissionRay(vec3 worldEntry,vec3 worldRay,mat4 worldToView,mat4 projection){
 cadThicknessInteriorHit=false;
 if(!cadThicknessValidPath||!cadThicknessDepthReady)return worldRay;
 vec3 entry=(worldToView*vec4(worldEntry,1.)).xyz,ray=(worldToView*vec4(worldRay,0.)).xyz;
 float entryDepth=-entry.z,depthLength=-ray.z,sourceDepth;vec2 uv;
 if(depthLength<=.00001||!cadTransmissionUv(entry,projection,uv)||!cadTransmissionDepth(uv,sourceDepth))return worldRay;
 if(sourceDepth<=entryDepth+.1||sourceDepth>=entryDepth+depthLength-.1)return worldRay;
 float fraction=(sourceDepth-entryDepth)/depthLength;
 for(int step=0;step<4;step++){
  if(!cadTransmissionUv(entry+fraction*ray,projection,uv)||!cadTransmissionDepth(uv,sourceDepth))return worldRay;
  if(sourceDepth<=entryDepth+.1||sourceDepth>=entryDepth+depthLength-.1)return worldRay;
  fraction=(sourceDepth-entryDepth)/depthLength;
 }
 if(!cadTransmissionUv(entry+fraction*ray,projection,uv)||!cadTransmissionDepth(uv,sourceDepth))return worldRay;
 if(sourceDepth<=entryDepth+.1||sourceDepth>=entryDepth+depthLength-.1||abs(sourceDepth-(entryDepth+depthLength*fraction))>.2)return worldRay;
 cadThicknessInteriorHit=true;return fraction*worldRay;
}
`;
const exitPath=`
vec3 cadDecodeExitNormal(vec2 encoded){
 vec2 p=encoded*2.-1.;vec3 n=vec3(p,1.-abs(p.x)-abs(p.y));float fold=max(-n.z,0.);
 n.xy+=vec2(n.x>=0.?-fold:fold,n.y>=0.?-fold:fold);return normalize(n);
}
bool cadExitPlane(vec2 uv,out vec3 point,out vec3 outward){
 if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return false;
 vec4 exitSample=texture2D(cadThicknessField,uv);
 if(abs(exitSample.y-cadThicknessId)>.25||exitSample.x<=0.)return false;
 vec4 a=cadThicknessInverseProjection*vec4(uv*2.-1.,-1.,1.),b=cadThicknessInverseProjection*vec4(uv*2.-1.,1.,1.);
 if(abs(a.w)<.0000000001||abs(b.w)<.0000000001)return false;
 vec3 nearPoint=a.xyz/a.w,farPoint=b.xyz/b.w;float span=farPoint.z-nearPoint.z;if(abs(span)<.00001)return false;
 point=nearPoint+(farPoint-nearPoint)*((-exitSample.x-nearPoint.z)/span);outward=cadDecodeExitNormal(exitSample.ba);return true;
}
vec3 cadRefineExitRay(vec3 worldEntry,vec3 worldRay,mat4 worldToView,mat4 projection,out vec3 exitNormal,out bool matched){
 matched=false;exitNormal=vec3(0);cadThicknessExitTransmission=1.;
 if(!cadThicknessValidPath)return worldRay;
 vec3 entry=(worldToView*vec4(worldEntry,1.)).xyz,direction=normalize((worldToView*vec4(worldRay,0.)).xyz),point,outward;vec2 uv;
 if(!cadTransmissionUv(entry,projection,uv))return worldRay;float distance=length(worldRay);
 for(int step=0;step<3;step++){
  if(!cadExitPlane(uv,point,outward))return worldRay;float cosine=dot(outward,direction);if(cosine<=.00001)return worldRay;
  distance=dot(outward,point-entry)/cosine;if(distance<=0.||distance>cadThicknessMaximum)return worldRay;
  if(!cadTransmissionUv(entry+direction*distance,projection,uv))return worldRay;
 }
 if(!cadExitPlane(uv,point,outward)||dot(outward,direction)<=.00001||abs(point.z-(entry.z+direction.z*distance))>.3)return worldRay;
 matched=true;exitNormal=outward;return normalize(worldRay)*distance;
}
vec3 cadSourceAfterExit(vec3 worldEntry,vec3 mediumRay,mat4 worldToView,mat4 projection,float ior,vec3 exitNormal,bool matched){
 vec3 exitWorld=worldEntry+mediumRay;if(!matched||cadThicknessInteriorHit)return exitWorld;
 vec3 inside=normalize((worldToView*vec4(mediumRay,0.)).xyz),outside=refract(inside,-exitNormal,ior);
 float transmitted=length(outside);if(transmitted<.00001)return exitWorld; // No unsupported internal bounce or zero-direction lookup.
 outside/=transmitted;float ci=clamp(dot(inside,exitNormal),0.,1.),ct=clamp(dot(outside,exitNormal),0.,1.);
 float rs=(ior*ci-ct)/max(ior*ci+ct,.00001),rp=(ior*ct-ci)/max(ior*ct+ci,.00001);
 cadThicknessExitTransmission=1.-.5*(rs*rs+rp*rp);
 vec3 continuation=cadInteriorTransmissionRay(exitWorld,inverseTransformDirection(outside,worldToView)*750.,worldToView,projection);
 return cadThicknessInteriorHit?exitWorld+continuation:exitWorld;
}
`;
const guardedSample=`
vec4 cadGuardTransmissionSample(vec2 uv,float roughness,float ior,float entryDepth){
 if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec4(cadThicknessPaper,1.);
 if(cadThicknessDepthReady){
  float depth=texture2D(cadThicknessSourceDepth,uv).x;
  if(depth<.999999){
   vec4 view=cadThicknessInverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);
   if(abs(view.w)<.0000000001||-view.z/view.w<entryDepth-.1)return vec4(cadThicknessPaper,1.);
  }
 }
 return getTransmissionSample(uv,roughness,ior);
}
`;
function guardTransmissionFunction(fragment,exitTransport=false){
 const signatures=[...fragment.matchAll(/\bvec4\s+getIBLVolumeRefraction\s*\(/g)];if(signatures.length!==1)throw Error('Missing unique physical volume-refraction function');
 const start=signatures[0].index,open=fragment.indexOf('{',start);let end=open+1,depth=1;for(;end<fragment.length&&depth;end++){if(fragment[end]==='{')depth++;else if(fragment[end]==='}')depth--;}
 if(open<0||depth)throw Error('Unbalanced physical volume-refraction function');let calls=0;
 let body=fragment.slice(open+1,end-1).replace(/\bgetTransmissionSample\s*\(([^()]*)\)/g,(_,args)=>{if(args.split(',').length!==3)throw Error('Unsupported physical transmission sample ABI');calls++;return`cadGuardTransmissionSample(${args},cadVisibleEntryDepth)`;});
 if(calls!==2)throw Error('Unsupported physical volume-refraction sample calls');
 const rays=/vec3\s+transmissionRay\s*=\s*getVolumeTransmissionRay\([^;]+;/g;if([...body.matchAll(rays)].length!==2)throw Error('Unsupported physical refraction ray ABI');
 if(exitTransport){
  body=body.replace(rays,match=>match+'\nfloat cadExitIor='+ (match.includes('iors[ i ]')?'iors[ i ]':'ior') +';\nvec3 cadExitNormal;bool cadExitMatched;\ntransmissionRay=cadRefineExitRay(position,transmissionRay,viewMatrix,projMatrix,cadExitNormal,cadExitMatched);\ntransmissionRay=cadInteriorTransmissionRay(position,transmissionRay,viewMatrix,projMatrix);');
  const exitAssignment='vec3 refractedRayExit = position + transmissionRay;';if(body.split(exitAssignment).length!==3)throw Error('Unsupported physical exit-point ABI');
  body=body.replaceAll(exitAssignment,'vec3 refractedRayExit=cadSourceAfterExit(position,transmissionRay,viewMatrix,projMatrix,cadExitIor,cadExitNormal,cadExitMatched);');
  const attenuationAssignment=/(transmittance(?:\[ i \])?\s*=\s*diffuseColor(?:\[ i \])?\s*\*\s*volumeAttenuation\([^;]+)(;)/g;if([...body.matchAll(attenuationAssignment)].length!==2)throw Error('Unsupported physical attenuation ABI');body=body.replace(attenuationAssignment,'$1 * cadThicknessExitTransmission$2');
 }else body=body.replace(rays,match=>match+'\ntransmissionRay=cadInteriorTransmissionRay(position,transmissionRay,viewMatrix,projMatrix);');
 return fragment.slice(0,start)+interiorPath+(exitTransport?exitPath:'')+guardedSample+fragment.slice(start,open+1)+'\nfloat cadVisibleEntryDepth=-(viewMatrix*vec4(position,1.)).z;\n'+body+fragment.slice(end-1);
}
const thicknessAssignment=/material\.thickness\s*=\s*thickness\s*;/g;
const measureThickness=`
if(cadThicknessEnabled){
 vec2 cadThicknessUv=gl_FragCoord.xy/cadThicknessFullSize;
 if(all(greaterThanEqual(cadThicknessUv,vec2(0)))&&all(lessThanEqual(cadThicknessUv,vec2(1)))){
  vec2 cadExit=texture2D(cadThicknessField,cadThicknessUv).rg;
  float cadDepthDifference=cadExit.x-vViewPosition.z;
  if(abs(cadExit.y-cadThicknessId)<.25&&cadDepthDifference>0.&&geometryViewDir.z>.00001){
   float cadCameraChord=cadDepthDifference/geometryViewDir.z;
   vec3 cadNormal=normalize(normal),cadView=normalize(geometryViewDir);
   vec3 cadRefracted=refract(-cadView,cadNormal,1./material.ior);
   float cadTransmittedCosine=abs(dot(cadRefracted,cadNormal));
   if(cadCameraChord<=cadThicknessMaximum&&cadTransmittedCosine>.00001){
    float cadRefractedChord=cadCameraChord*abs(dot(cadView,cadNormal))/cadTransmittedCosine;
    if(cadRefractedChord>0.&&cadRefractedChord<=cadThicknessMaximum){material.thickness=cadRefractedChord;cadThicknessValidPath=true;}
   }
  }
 }
}
`;

export function setupRasterThickness({THREE,renderer,scene,objects=[],fullSize,innerDepth,outerDepth,paperColor,exitTransport=false,schedule=()=>{}}){
 if(!THREE||!renderer||!scene||!Array.isArray(objects))throw Error('Invalid optical thickness scene');
 if(typeof exitTransport!=='boolean')throw Error('Explicit boolean exit-transport comparison option required');
 const sizeUniform=fullSize?.value!==undefined?fullSize:{value:fullSize},enabled={value:false},records=[],materials=new Map(),shaders=new Set(),inverseProjection={value:new THREE.Matrix4()};
 const uniform=value=>value?.value!==undefined?value:{value},sourceDepths={water:uniform(innerDepth),glass:uniform(outerDepth)},depthReady={water:{value:!!sourceDepths.water.value},glass:{value:!!sourceDepths.glass.value}},paperUniform=paperColor?.value!==undefined?paperColor:{value:paperColor??new THREE.Color(1,1,1)};
 const dimensions=()=>{const value=sizeUniform.value,w=value?.x??value?.[0],h=value?.y??value?.[1];if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1)throw Error('Invalid native optical field dimensions');return[w,h];};
 const targets=Object.fromEntries(['glass','water'].map(name=>[name,new THREE.WebGLRenderTarget(...dimensions(),{format:exitTransport?THREE.RGBAFormat:THREE.RGFormat,type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,generateMipmaps:false,samples:0,depthBuffer:true})]));
 for(const[name,target]of Object.entries(targets)){target.texture.name='CYBR '+name+' CAD exit depth / material ID'+(exitTransport?' / oct outward normal':'');target.texture.colorSpace=THREE.LinearSRGBColorSpace;}
 let nextId=1,disposed=false,rendering=false,updates=0,fieldPasses=0,cacheHits=0,failures=0,lastSignature=null,lastCalls=0,lastTriangles=0;
 for(const object of objects){if(Array.isArray(object.material)){if(object.material.some(optical))throw Error('CAD chord fields require one optical material per mesh');continue;}const material=object.material;if(!optical(material))continue;
  let record=materials.get(material);const field=object.userData.staticWater||material.ior<1.4?'water':'glass';
  if(!record){record={id:nextId++,material,field,maximum:{value:0},objects:[]};materials.set(material,record);}else if(record.field!==field)throw Error('One optical material cannot belong to both chord fields');
  const fieldMaterial=new THREE.ShaderMaterial({uniforms:{cadExitId:{value:record.id}},vertexShader:exitTransport?'varying float cadExitDepth;varying vec3 cadExitOutward;\nvoid main(){vec4 p=modelViewMatrix*vec4(position,1.);cadExitDepth=-p.z;cadExitOutward=normalMatrix*normal;gl_Position=projectionMatrix*p;}':'varying float cadExitDepth;\nvoid main(){vec4 p=modelViewMatrix*vec4(position,1.);cadExitDepth=-p.z;gl_Position=projectionMatrix*p;}',fragmentShader:exitTransport?'uniform float cadExitId;varying float cadExitDepth;varying vec3 cadExitOutward;\nvoid main(){vec3 n=normalize(cadExitOutward);n/=abs(n.x)+abs(n.y)+abs(n.z);vec2 encoded=n.xy;if(n.z<0.)encoded=(1.-abs(encoded.yx))*vec2(encoded.x>=0.?1.:-1.,encoded.y>=0.?1.:-1.);gl_FragColor=vec4(cadExitDepth,cadExitId,encoded*.5+.5);}':'uniform float cadExitId;\nvarying float cadExitDepth;\nvoid main(){gl_FragColor=vec4(cadExitDepth,cadExitId,0.,1.);}',side:THREE.BackSide,depthTest:true,depthWrite:true,blending:THREE.NoBlending,toneMapped:false});
  const entry={object,material,fieldMaterial,record,fieldGeometry:null,boundaryAudit:null,boundarySource:null};record.objects.push(object);records.push(entry);
  if(field==='water')refreshWaterBoundary(entry);
 }
 function refreshWaterBoundary(entry){
  // FLIP frames contain only the reconstructed outer surface; no CAD bubble
  // shells need classifying. Use the current dynamic triangles directly.
  if(entry.object.userData.bakedFluid)return;
  const geometry=entry.object.geometry,position=geometry.getAttribute('position'),index=geometry.getIndex(),previous=entry.boundarySource;
  if(previous&&previous.geometry===geometry&&previous.position===position&&previous.index===index&&previous.positionVersion===position.version&&previous.indexVersion===index.version)return;
  const result=waterOuterBoundaryIndices(position,index),owned=result.indices!==index.array?new THREE.BufferGeometry():null;
  if(owned){for(const[name,attribute]of Object.entries(geometry.attributes))owned.setAttribute(name,attribute);owned.setIndex(new THREE.BufferAttribute(result.indices,1));owned.boundingBox=geometry.boundingBox;owned.boundingSphere=geometry.boundingSphere;}
  entry.fieldGeometry?.dispose();entry.fieldGeometry=owned;entry.boundaryAudit=result.audit;entry.boundarySource={geometry,position,index,positionVersion:position.version,indexVersion:index.version};
 }
 function signature(camera,w,h){scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);const values=[w,h,...camera.projectionMatrix.elements,...camera.matrixWorld.elements];for(const{object}of records){values.push(object.geometry,object.geometry.attributes.position,object.geometry.index,...object.matrixWorld.elements,object.geometry.attributes.position.version,object.geometry.index?.version??-1);for(let ancestor=object;ancestor;ancestor=ancestor.parent)values.push(ancestor.visible?1:0);}return values;}
 function updateMaximums(){const box=new THREE.Box3(),size=new THREE.Vector3();for(const record of materials.values()){let maximum=0;for(const object of record.objects){if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();box.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);maximum=Math.max(maximum,box.getSize(size).length());}record.maximum.value=maximum;}}
 function render(camera){
  if(disposed)return{calls:0,triangles:0,cached:true};if(rendering)throw Error('Reentrant optical thickness fields');
  const[w,h]=dimensions(),currentSignature=signature(camera,w,h);inverseProjection.value.copy(camera.projectionMatrixInverse);for(const field of['glass','water'])depthReady[field].value=!!sourceDepths[field].value;
  if(lastSignature&&currentSignature.length===lastSignature.length&&currentSignature.every((value,i)=>value===lastSignature[i])){cacheHits++;return{calls:0,triangles:0,cached:true};}
  for(const target of Object.values(targets))if(target.width!==w||target.height!==h)target.setSize(w,h);updateMaximums();
  const meshState=new Map(),shadowState=[],state={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace?.()??0,mip:renderer.getActiveMipmapLevel?.()??0,viewport:renderer.getViewport?.(new THREE.Vector4()),scissor:renderer.getScissor?.(new THREE.Vector4()),scissorTest:renderer.getScissorTest?.(),clearColor:renderer.getClearColor?.(new THREE.Color()),clearAlpha:renderer.getClearAlpha?.(),autoClear:renderer.autoClear,background:scene.background,overrideMaterial:scene.overrideMaterial,xr:renderer.xr?.enabled,shadow:renderer.shadowMap?{enabled:renderer.shadowMap.enabled,autoUpdate:renderer.shadowMap.autoUpdate,needsUpdate:renderer.shadowMap.needsUpdate}:null};
  let calls=0,triangles=0;rendering=true;enabled.value=false;
  try{
   for(const entry of records)if(entry.record.field==='water')refreshWaterBoundary(entry);
   scene.traverse(object=>{if(object.isMesh)meshState.set(object,{visible:object.visible,material:object.material,geometry:object.geometry});if(object.isLight&&object.shadow){shadowState.push([object.shadow,object.shadow.autoUpdate,object.shadow.needsUpdate]);object.shadow.autoUpdate=false;object.shadow.needsUpdate=false;}});
   scene.background=null;scene.overrideMaterial=null;renderer.autoClear=false;if(renderer.xr)renderer.xr.enabled=false;if(renderer.shadowMap){renderer.shadowMap.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;}renderer.setClearColor?.(0,0);renderer.setScissorTest?.(false);
   const fieldByObject=new Map(records.map(entry=>[entry.object,entry]));
   for(const field of['glass','water']){
    for(const[object,saved]of meshState){const entry=fieldByObject.get(object);object.visible=saved.visible&&entry?.record.field===field;if(entry){object.material=entry.fieldMaterial;object.geometry=entry.fieldGeometry??saved.geometry;}}
    renderer.setRenderTarget(targets[field]);renderer.clear(true,true,false);renderer.render(scene,camera);calls+=renderer.info?.render?.calls??0;triangles+=renderer.info?.render?.triangles??0;fieldPasses++;
   }
   lastSignature=currentSignature;enabled.value=true;updates++;lastCalls=calls;lastTriangles=triangles;return{calls,triangles,cached:false};
  }catch(error){lastSignature=null;failures++;throw error;}
  finally{
   for(const[object,saved]of meshState){object.visible=saved.visible;object.material=saved.material;object.geometry=saved.geometry;}for(const[shadow,autoUpdate,needsUpdate]of shadowState){shadow.autoUpdate=autoUpdate;shadow.needsUpdate=needsUpdate;}
   scene.background=state.background;scene.overrideMaterial=state.overrideMaterial;renderer.autoClear=state.autoClear;if(renderer.xr)renderer.xr.enabled=state.xr;if(renderer.shadowMap&&state.shadow)Object.assign(renderer.shadowMap,state.shadow);
   if(state.clearColor)renderer.setClearColor(state.clearColor,state.clearAlpha);renderer.setRenderTarget(state.target,state.face,state.mip);if(state.viewport)renderer.setViewport(state.viewport);if(state.scissor)renderer.setScissor(state.scissor);if(state.scissorTest!==undefined)renderer.setScissorTest(state.scissorTest);rendering=false;
  }
 }
 function bindShader(shader,material){
  const record=materials.get(material);if(disposed||!record)return false;if(shaders.has(shader))throw Error('Optical thickness shader already bound');let fragment=shader.fragmentShader;
  const pars='#include <transmission_pars_fragment>';if(fragment.includes(pars)){if(fragment.split(pars).length!==2)throw Error('Ambiguous thickness transmission pars chunk');fragment=fragment.replace(pars,THREE.ShaderChunk.transmission_pars_fragment);}
  const marker='#include <transmission_fragment>';if(fragment.includes(marker)){if(fragment.split(marker).length!==2)throw Error('Ambiguous thickness transmission shader chunk');fragment=fragment.replace(marker,THREE.ShaderChunk.transmission_fragment);}
  if([...fragment.matchAll(thicknessAssignment)].length!==1)throw Error('Missing unique optical thickness assignment');
  shader.fragmentShader=declarations+guardTransmissionFunction(fragment.replace(thicknessAssignment,match=>match+measureThickness),exitTransport);Object.assign(shader.uniforms,{cadThicknessField:{value:targets[record.field].texture},cadThicknessFullSize:sizeUniform,cadThicknessId:{value:record.id},cadThicknessMaximum:record.maximum,cadThicknessEnabled:enabled,cadThicknessSourceDepth:sourceDepths[record.field],cadThicknessDepthReady:depthReady[record.field],cadThicknessPaper:paperUniform,cadThicknessInverseProjection:inverseProjection});shaders.add(shader);return true;
 }
 function snapshot(){return{enabled:!disposed,fieldsReady:enabled.value,backend:'native WebGL2 RG32F CAD BackSide exit fields',mode:'camera chord with parallel-wall Snell length conversion; authored fallback for unmatched or invalid exits',foregroundGuard:{enabled:!disposed&&(depthReady.water.value||depthReady.glass.value),water:depthReady.water.value?'opaque source depth':'unavailable',glass:depthReady.glass.value?'water plus opaque source depth':'unavailable',toleranceMM:.1,outsideViewport:'HDR paper',nestedSnell:false},outerWaterBoundaries:records.filter(entry=>entry.boundaryAudit).map(entry=>({name:entry.object.name,module:entry.material.userData?.module??entry.object.userData.meshRecord?.module,...entry.boundaryAudit,ownedFilteredGeometry:!!entry.fieldGeometry})),fieldPassesPerUpdate:2,fieldPasses,updates,stationaryCacheHits:cacheHits,failures,size:dimensions(),opticalMeshes:records.length,materialIds:[...materials.values()].map(record=>({id:record.id,module:record.material.userData?.module??record.objects[0].userData.meshRecord?.module,field:record.field,maximumMM:record.maximum.value})),boundShaders:shaders.size,lastCalls,lastTriangles,scaling:1,nestedSnell:false,disposed};}
 function dispose(){if(disposed)return;disposed=true;enabled.value=false;for(const target of Object.values(targets))target.dispose();for(const record of records){record.fieldMaterial.dispose();record.fieldGeometry?.dispose();}lastSignature=null;shaders.clear();}
 function transportSnapshot(){return{...snapshot(),
  backend:exitTransport?'native WebGL2 RGBA32F CAD BackSide exit depth, material ID and oct outward view normal':'native WebGL2 RG32F CAD BackSide exit fields',
  fieldMemory:{colorBytes:dimensions()[0]*dimensions()[1]*2*(exitTransport?16:8),previousRGColorBytes:dimensions()[0]*dimensions()[1]*2*8,includesDepthBuffers:false,channels:{R:'linear view exit depth',G:'material ID',BA:exitTransport?'oct outward view normal':'not stored'}},
  interiorSourceTransport:{enabled:!disposed,method:'Four bounded source-depth refinements along measured refracted segment',acceptance:'Opaque hit strictly between entry and exit; final projected depth residual <= 0.2 mm',attenuation:'Measured distance ends at accepted internal opaque hit',sourceDepthReadsMaxPerWavelength:6,additionalPasses:0,nestedSnell:false,invalidPathFallback:'Original measured-chord projected HDR sample'},
  exitTransport:{enabled:exitTransport&&!disposed,comparisonOnly:true,visualGate:'Rejected: dotted boundaries and shredded glass/water; disabled by default',method:'Three local exit-plane refinements with matching ID, depth and outward normal; material-to-air Snell then bounded opaque depth continuation',exitDepthToleranceMM:.3,sourceDepthReadsMaxPerWavelength:exitTransport?12:0,exitFieldReadsMaxPerWavelength:exitTransport?5:0,dispersionWavelengthsMax:3,additionalPasses:0,exactNestedTransport:false,missingExitOrTir:'Existing projected HDR fallback; internal multiple bounces unavailable',screenHiddenGeometry:'Unavailable in foremost opaque source depth'}};
 }
 schedule();return{render,bindShader,snapshot:transportSnapshot,dispose};
}
