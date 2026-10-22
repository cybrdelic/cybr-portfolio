import * as T from './vendor/three-r180/three.module.min.js';
import {createElementsVolumeTexture,createElementsOccupancyTexture} from './elements-volume-data.mjs';
import {nativeWaterTransportGLSL,WATER_TRANSPORT_LIMITS} from './elements-water-transport.mjs';

// Ray-dependent control flow has no valid implicit screen derivatives. The
// PMREM atlas already stores its filtering explicitly in atlas coordinates.
const studioCubeUVGLSL=T.ShaderChunk.cube_uv_reflection_fragment
 .replace('texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) )','textureLod( envMap, uv, 0.0 )')
 .replace('texture2D( envMap, uv )','textureLod( envMap, uv, 0.0 )');

// A single bounded shader, with optional native simulation volumes. Recorded
// fields retain their geometry/coefficients; rigid staging is not live physics.
export const ELEMENTS_LIMITS=Object.freeze({primarySteps:96,previewPrimarySteps:64,volumeSamplesPerInterval:64,nativeWaterCells:WATER_TRANSPORT_LIMITS.totalCells,waterTirBounces:WATER_TRANSPORT_LIMITS.tirBounces,waterRootRefinements:WATER_TRANSPORT_LIMITS.rootRefinements,waterBodies:4,normalSamples:4,stoneCandidates:3,backdropBoxes:8,maxStep:.16,proxyTriangles:12,drawCalls:1});
export const ELEMENTS_BOUNDS=Object.freeze({min:Object.freeze([-2.15,.012,-1.85]),max:Object.freeze([2.15,4.88,1.85])});
export const ELEMENTS_TRANSPORT_DIAGNOSTICS=Object.freeze([
 Object.freeze({severity:1,label:'entry search missed surface',color:'yellow',linearRGB:Object.freeze([2,2,0]),waterStatuses:Object.freeze([1])}),
 Object.freeze({severity:2,label:'primary surface-event budget exhausted',color:'blue',linearRGB:Object.freeze([0,0,2]),waterStatuses:Object.freeze([])}),
 Object.freeze({severity:3,label:'native volume interval budget exhausted',color:'orange',linearRGB:Object.freeze([2,.3,0]),waterStatuses:Object.freeze([])}),
 Object.freeze({severity:4,label:'internal TIR bounce budget exhausted',color:'cyan',linearRGB:Object.freeze([0,2,2]),waterStatuses:Object.freeze([3])}),
 Object.freeze({severity:5,label:'native water cell budget exhausted',color:'magenta',linearRGB:Object.freeze([2,0,2]),waterStatuses:Object.freeze([2])}),
 Object.freeze({severity:6,label:'invalid sampled domain or boundary gradient',color:'red',linearRGB:Object.freeze([2,0,0]),waterStatuses:Object.freeze([4,5])}),
]);
export const ELEMENTS_BACKDROP_DIAGNOSTICS=Object.freeze([
 Object.freeze({status:1,label:'validated opaque backdrop sample',color:'green',linearRGB:Object.freeze([0,2,0])}),
 Object.freeze({status:2,label:'no actual receiver intersection',color:'red',linearRGB:Object.freeze([2,0,0])}),
 Object.freeze({status:3,label:'receiver projects offscreen or behind camera',color:'blue',linearRGB:Object.freeze([0,0,2])}),
 Object.freeze({status:4,label:'cached depth missing or mismatched',color:'magenta',linearRGB:Object.freeze([2,0,2])}),
 Object.freeze({status:5,label:'backdrop unavailable or receiver bound exceeded',color:'yellow',linearRGB:Object.freeze([2,2,0])}),
]);
const diagnosticGLSL=/* glsl */`
int waterDiagnosticSeverity(int status){
 ${ELEMENTS_TRANSPORT_DIAGNOSTICS.filter(item=>item.waterStatuses.length).map(item=>`if(${item.waterStatuses.map(status=>`status==${status}`).join('||')})return ${item.severity};`).join('\n ')}
 return 0;
}
vec3 transportDiagnosticColor(int severity){
 ${ELEMENTS_TRANSPORT_DIAGNOSTICS.map(item=>`if(severity==${item.severity})return vec3(${item.linearRGB.map(value=>Number.isInteger(value)?`${value}.0`:`${value}`).join(',')});`).join('\n ')}
 return vec3(0.0);
}
vec3 backdropDiagnosticColor(int status){
 ${ELEMENTS_BACKDROP_DIAGNOSTICS.map(item=>`if(status==${item.status})return vec3(${item.linearRGB.map(value=>`${value}.0`).join(',')});`).join('\n ')}
 return vec3(0.0);
}`;

export function fitElementsVolume(volume,{height=4.4,radius=1.46,floor=.014}={}){
 const minimum=new T.Vector3(...volume.domain.minimum),maximum=minimum.clone().add(new T.Vector3(...volume.domain.extent));
 const active=volume.kind==='fire'?volume.manifest.statistics?.activeBounds:null;
 if(active&&Array.isArray(active.min)&&Array.isArray(active.maxInclusive)&&active.min.length===3&&active.maxInclusive.length===3){
  for(let i=0;i<3;i++){
   const lo=active.min[i],hi=active.maxInclusive[i];
   if(!Number.isInteger(lo)||!Number.isInteger(hi)||lo<0||hi<lo||hi>=volume.dimensions[i])throw new Error('Invalid active source-volume index bounds');
   minimum.setComponent(i,Math.max(minimum.getComponent(i),volume.sampling.origin[i]+(lo-1)*volume.sampling.spacing[i]));
   maximum.setComponent(i,Math.min(maximum.getComponent(i),volume.sampling.origin[i]+(hi+1)*volume.sampling.spacing[i]));
  }
 }
 const up=volume.manifest.coordinates?.upAxis||'y',sourceUp=new T.Vector3(up==='x'?1:0,up==='y'?1:0,up==='z'?1:0);
 const rotation=new T.Quaternion().setFromUnitVectors(sourceUp,new T.Vector3(0,1,0)),rotationMatrix=new T.Matrix4().makeRotationFromQuaternion(rotation);
 const rotatedBounds=new T.Box3(minimum.clone(),maximum.clone()).applyMatrix4(rotationMatrix),size=rotatedBounds.getSize(new T.Vector3()),center=rotatedBounds.getCenter(new T.Vector3());
 const scale=Math.min(height/size.y,radius/Math.hypot(size.x*.5,size.z*.5));
 if(!(scale>0&&Number.isFinite(scale)))throw new Error('Cannot fit a degenerate source-volume domain');
 const translation=center.clone().multiplyScalar(-scale);translation.y+=floor+size.y*scale*.5;
 return {matrix:new T.Matrix4().compose(translation,rotation,new T.Vector3(scale,scale,scale)),scale,minimum,maximum,sourceUpAxis:up,stagedHeight:size.y*scale};
}
const atmosphereIntervalGLSL=/* glsl */`
float integrateAtmosphereInterval(vec3 ro,vec3 rd,float start,float finish,vec3 fireRo,vec3 fireRd,vec2 fireRange,float fireStride,inout vec3 color,inout float opacity,inout vec3 frontPoint,inout float firstDepth,out bool exhausted){
 // Geometry proves this entire <=.16-local-unit segment surface-free. Native
 // fire voxel samples have a separate budget, so a refracted crossing cannot
 // consume the outer geometry/event allowance before reaching later surfaces.
 float segmentLength=max(0.0,finish-start),cursor=0.0;
 vec3 segmentOrigin=ro+rd*start,fireOrigin=fireRo+fireRd*start;
 vec2 localFireRange=fireRange-vec2(start);
 #if ELEMENTS_OPTIMIZED_VOLUME == 1
 vec3 fireGridOrigin=(fireOrigin-uFireSampleOrigin)/uFireSpacing;
 vec3 fireGridDirection=fireRd/uFireSpacing;
 float occupancyEnd=-1.0;bool cachedOccupied=true;
 #endif
 for(int volumeIndex=0;volumeIndex<64;volumeIndex++){
  if(cursor>=segmentLength||opacity>.985)break;
  float stride=segmentLength-cursor;bool knownZeroFire=true;
  if(useFire()&&hasNativeFire()&&cursor<localFireRange.x)stride=min(stride,localFireRange.x-cursor);
  if(useFire()&&hasNativeFire()&&cursor>=localFireRange.x&&cursor<localFireRange.y){
   bool occupied=true;
   if(uHasFireOccupancy>.5){
    #if ELEMENTS_OPTIMIZED_VOLUME == 1
    if(cursor>=occupancyEnd){
     vec3 grid=fireGridOrigin+fireGridDirection*cursor;
     vec3 cell=clamp(floor(grid/uFireBlockSize),vec3(0.0),uFireOccupancyDimensions-1.0);
     cachedOccupied=textureLod(uFireOccupancy,(cell+.5)/uFireOccupancyDimensions,0.0).r>.5;
     vec3 boundary=(cell+step(vec3(0.0),fireGridDirection))*uFireBlockSize;
     vec3 faceDistance=vec3(1e5);
     if(abs(fireGridDirection.x)>.00001)faceDistance.x=max(0.0,(boundary.x-grid.x)/fireGridDirection.x);
     if(abs(fireGridDirection.y)>.00001)faceDistance.y=max(0.0,(boundary.y-grid.y)/fireGridDirection.y);
     if(abs(fireGridDirection.z)>.00001)faceDistance.z=max(0.0,(boundary.z-grid.z)/fireGridDirection.z);
     occupancyEnd=cursor+min(faceDistance.x,min(faceDistance.y,faceDistance.z));
    }
    occupied=cachedOccupied;
    if(!occupied)stride=min(stride,max(0.0,occupancyEnd-cursor)+min(.00001,fireStride*.005));
    #else
    vec3 grid=(fireOrigin+fireRd*cursor-uFireSampleOrigin)/uFireSpacing;
    vec3 cell=clamp(floor(grid/uFireBlockSize),vec3(0.0),uFireOccupancyDimensions-1.0);
    occupied=textureLod(uFireOccupancy,(cell+.5)/uFireOccupancyDimensions,0.0).r>.5;
    if(!occupied){
     vec3 gridDirection=fireRd/uFireSpacing;
     vec3 boundary=(cell+step(vec3(0.0),gridDirection))*uFireBlockSize;
     vec3 faceDistance=vec3(1e5);
     if(abs(gridDirection.x)>.00001)faceDistance.x=max(0.0,(boundary.x-grid.x)/gridDirection.x);
     if(abs(gridDirection.y)>.00001)faceDistance.y=max(0.0,(boundary.y-grid.y)/gridDirection.y);
     if(abs(gridDirection.z)>.00001)faceDistance.z=max(0.0,(boundary.z-grid.z)/gridDirection.z);
     // Only exact-zero cells with a native one-voxel interpolation halo skip.
     float toFace=min(faceDistance.x,min(faceDistance.y,faceDistance.z));
     stride=min(stride,toFace+min(.00001,fireStride*.005));
    }
    #endif
   }
   knownZeroFire=!occupied;
   if(occupied)stride=min(stride,fireStride);
   stride=min(stride,localFireRange.y-cursor);
  }
  stride=min(stride,segmentLength-cursor);
  vec3 p=segmentOrigin+rd*cursor;
  vec4 volume=atmosphere(p+rd*(stride*.5),fireOrigin+fireRd*(cursor+stride*.5),knownZeroFire,rd,stride);
  float alpha=1.0-exp(-volume.a*stride);
  float integratedLength=volume.a>.0001?alpha/volume.a:stride;
  if((alpha>.001||max(max(volume.r,volume.g),volume.b)*integratedLength>.00001)&&firstDepth<0.0){firstDepth=start+cursor;frontPoint=p;}
  color+=(1.0-opacity)*volume.rgb*integratedLength;opacity+=(1.0-opacity)*alpha;
  // Accumulate a short interval-local coordinate, not repeated tiny additions
  // to a camera-distance t. This keeps native-boundary steps moving in f32.
  cursor=min(segmentLength,cursor+stride);
 }
 exhausted=cursor<segmentLength&&opacity<.985;
 return cursor>=segmentLength?finish:start+cursor;
}
`;

export const elementsVertexShader=/* glsl */`
varying vec3 vLocalPosition;
void main(){
 vLocalPosition=position;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;

export const elementsFragmentShader=/* glsl */`
precision highp float;
precision highp sampler3D;
varying vec3 vLocalPosition;
uniform vec3 uCameraLocal;
uniform vec3 uViewDirection;
uniform vec3 uKeyLocal;
uniform float uOrthographic;
uniform float uProgress;
uniform float uTime;
uniform mat4 uLocalToClip;
uniform mat4 uLocalToWorld;
uniform sampler2D uStudioEnvironment;
uniform float uHasStudioEnvironment;
uniform float uStudioEnvironmentIntensity;
uniform float uStudioEnvironmentMaxMip;
uniform vec2 uStudioEnvironmentTexel;
uniform mat3 uStudioEnvironmentRotation;
uniform samplerCube uRoomProbe;
uniform float uHasRoomProbe;
uniform vec3 uRoomProbePosition;
uniform sampler2D uBackdropColor;
uniform sampler2D uBackdropDepth;
uniform float uHasBackdrop;
uniform mat4 uBackdropWorldToClip;
uniform mat4 uBackdropClipToWorld;
uniform vec3 uBackdropCamera;
uniform float uBackdropPixelSpan;
uniform float uBackdropOrthographic;
uniform vec2 uBackdropTexel;
uniform int uBackdropBoxCount;
uniform mat4 uBackdropBoxInverse[8];
uniform vec3 uBackdropBoxMinimum[8];
uniform vec3 uBackdropBoxMaximum[8];
uniform vec3 uStoneCenters[9];
uniform vec4 uStoneRotations[9];
uniform vec3 uStoneSizes[9];
uniform float uStoneBounds[9];
uniform vec3 uWaterTip;
uniform sampler3D uFireVolume;
uniform sampler3D uWaterVolume;
uniform sampler3D uFireOccupancy;
uniform float uHasFireOccupancy;
uniform vec3 uFireOccupancyDimensions;
uniform vec3 uFireBlockSize;
uniform vec3 uFireSampleOrigin;
uniform float uHasFireVolume;
uniform float uHasWaterVolume;
uniform mat4 uLocalToFire;
uniform mat4 uLocalToWater;
uniform vec3 uFireMinimum;
uniform vec3 uFireMaximum;
uniform vec3 uFireTextureScale;
uniform vec3 uFireTextureOffset;
uniform vec3 uFireSpacing;
uniform float uFireMetric;
uniform vec3 uWaterMinimum;
uniform vec3 uWaterMaximum;
uniform vec3 uWaterTextureScale;
uniform vec3 uWaterTextureOffset;
uniform float uWaterMetric;
uniform float uWaterVoxelSize;
uniform float uStoneSpacing;
uniform float uStoneBase;
uniform float uCompositionHeight;
uniform float uDebugBudget;
uniform int uDebugMode;
uniform vec3 uBoundsMaximum;
uniform float uPixelAngle;
uniform float uOrthographicPixel;
const vec3 BMIN=vec3(-2.15,.012,-1.85);
const vec3 BMAX=vec3(2.15,4.88,1.85);
const float TAU=6.28318530718;

float sat(float x){return clamp(x,0.0,1.0);}
mat2 turn(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
float ellipsoid(vec3 p,vec3 r){
 float k0=length(p/r),k1=length(p/(r*r));
 return k0*(k0-1.0)/max(k1,.0001);
}
vec2 rayBox(vec3 ro,vec3 rd,vec3 boxMin,vec3 boxMax){
 // Signed reciprocal retains slab ordering for reversed reflection rays.
 vec3 safe=vec3(rd.x<0.0?-max(abs(rd.x),1e-6):max(abs(rd.x),1e-6),rd.y<0.0?-max(abs(rd.y),1e-6):max(abs(rd.y),1e-6),rd.z<0.0?-max(abs(rd.z),1e-6):max(abs(rd.z),1e-6));
 vec3 a=(boxMin-ro)/safe,b=(boxMax-ro)/safe;
 vec3 nearPlane=min(a,b),farPlane=max(a,b);
 return vec2(max(max(nearPlane.x,nearPlane.y),nearPlane.z),min(min(farPlane.x,farPlane.y),farPlane.z));
}
vec2 interval(vec3 ro,vec3 rd){return rayBox(ro,rd,BMIN,uBoundsMaximum);}
vec2 cylinderInterval(vec3 ro,vec3 rd){
 float a=dot(rd.xz,rd.xz),b=dot(ro.xz,rd.xz),c=dot(ro.xz,ro.xz)-2.8224;
 if(a<.000001)return c<=0.0?vec2(-1e5,1e5):vec2(1.0,-1.0);
 float discriminant=b*b-a*c;if(discriminant<0.0)return vec2(1.0,-1.0);
 float rootD=sqrt(discriminant);return vec2((-b-rootD)/a,(-b+rootD)/a);
}
float phase(){return uProgress*1.8+uTime*.28;}
int elementMode(){
 #ifdef ELEMENTS_COMPILED_ABLATION
 return ELEMENTS_COMPILED_ABLATION;
 #else
 return uDebugMode;
 #endif
}
bool useFire(){int m=elementMode();return m!=2&&m!=5&&m!=6;}
bool useWater(){int m=elementMode();return m!=1&&m!=5&&m!=6;}
bool useEarth(){int m=elementMode();return m!=1&&m!=2&&m!=4&&m!=6;}
bool useAir(){int m=elementMode();return m!=1&&m!=2&&m!=3&&m!=5;}
bool hasNativeFire(){return ELEMENTS_HAS_NATIVE_FIRE==1;}
bool hasNativeWater(){return ELEMENTS_HAS_NATIVE_WATER==1;}
${diagnosticGLSL}

float waterDistance(vec3 p){
 #if ELEMENTS_HAS_NATIVE_WATER == 1
  vec3 source=(uLocalToWater*vec4(p,1.0)).xyz;
  vec3 bounded=clamp(source,uWaterMinimum,uWaterMaximum);
  float outside=length(source-bounded);
  if(outside*uWaterMetric>.03)return outside*uWaterMetric*.56;
  float distance=textureLod(uWaterVolume,bounded*uWaterTextureScale+uWaterTextureOffset,0.0).r;
  // Distance-to-box alone approaches zero on an empty field boundary and
  // would render a glass box. Use the boundary SDF's Lipschitz lower bound.
  if(outside>.000001)distance=max(outside,distance-outside);
  // Trilinear signed-distance interpolation has componentwise slope bounds,
  // not an exact unit-Lipschitz field. .56 is conservative below1/sqrt(3).
  return distance*uWaterMetric*.56;
 #else
 float h=clamp(p.y,.12,4.64),s=h/4.64;
 float angle=h*1.45+.18*sin(h*2.1)+phase();
 vec2 q=turn(angle)*p.xz;
 float radius=.27+.87*sin(s*3.14159265)+.20*sin(h*2.8+.2)+.08*sin(h*6.0);
 float taper=sqrt(max(sin(s*3.14159265),.02));
 float width=(.045+.28*taper)*(.84+.16*sin(h*6.0+.5));
 // Broad thin billowing liquid sheet, thickening at its free edges.
 float crossCoord=q.y/width;
 float bow=.10*sin(h*4.1+crossCoord*1.7)*max(0.0,1.0-crossCoord*crossCoord);
 vec2 d=vec2(q.x-radius-bow,q.y);
 float edge=sat(abs(crossCoord));edge*=edge;edge=edge*edge*edge;
 vec2 radii=vec2(.024+.009*taper+.026*edge,width);
 float a=length(d/radii),b=length(d/(radii*radii));
 float sheet=a*(a-1.0)/max(b,.0001);
 // The distance is conservative under the helical shear.
 sheet=max(sheet,max(.12-p.y,p.y-4.64))*.48;
 float ripple=.003*sin(p.x*12.0+p.z*4.0)+.003*sin(p.z*15.0-p.x*3.0);
 float pool=ellipsoid(p-vec3(0.0,.055+ripple,0.0),vec3(1.28,.040,.96));
 // Round bead/crown at the end, with no exposed cut on the liquid sheet.
 float crown=length(p-uWaterTip)-.050;
 return min(min(sheet,pool),crown);
 #endif
}

vec3 stoneCoordinates(vec3 p,int i){
 vec4 rot=uStoneRotations[i];vec3 q=p-uStoneCenters[i];
 q.xz=mat2(rot.x,-rot.y,rot.y,rot.x)*q.xz;
 q.xy=mat2(rot.z,-rot.w,rot.w,rot.z)*q.xy;
 return q/uStoneSizes[i];
}
vec3 stoneGradient(vec3 gradient,int i){
 vec4 rot=uStoneRotations[i];gradient/=uStoneSizes[i];
 gradient.xy=mat2(rot.z,rot.w,-rot.w,rot.z)*gradient.xy;
 gradient.xz=mat2(rot.x,rot.y,-rot.y,rot.x)*gradient.xz;
 return gradient;
}
float roundedIntersection(float a,float b,float radius){
 float h=max(radius-abs(a-b),0.0)/radius;
 return max(a,b)+h*h*radius*.25;
}
float rockPiece(vec3 p,float index){
 int i=int(index+.5);
 float sphereDistance=length(p-uStoneCenters[i])-uStoneBounds[i];
 if(sphereDistance>.065)return sphereDistance;
 vec3 q=stoneCoordinates(p,i);float seed=index*1.721;
 // Continuous uneven cooled body with a few weathered fracture faces. The
 // twelve-plane intersection was literally a low-poly polyhedron. These
 // cuts only REMOVE volume, and the radial body's maximum radius is1.068.
 float d=length(q)-1.0+.045*sin(q.x*3.1+seed)*sin(q.y*3.7+q.z*2.2)
                        +.023*sin(dot(q,vec3(-6.4,4.8,3.6))+seed);
 d=roundedIntersection(d,dot(q,vec3(.80,.48,.36))-(.79+.13*fract(index*.414)),.16);
 d=roundedIntersection(d,dot(q,vec3(-.36,.80,-.48))-.91,.13);
 d=roundedIntersection(d,dot(q,vec3(.48,-.36,-.80))-.87,.11);
 // Radial perturbation has gradient norm <=.045*sqrt(3.1²+3.7²+2.2²)
 // +.023*sqrt(6.4²+4.8²+3.6²)<.444. Smooth max preserves that bound.
 // Divide by1.45 BEFORE the minimum-axis scale for safe surface traversal.
 vec3 size=uStoneSizes[i];return d*(min(size.x,min(size.y,size.z))/1.45);
}
vec2 earthDistance(vec3 p){
 float nearest=clamp(floor((p.y-uStoneBase)/uStoneSpacing+.5),0.0,8.0);
 float d=10.0,id=0.0;
 for(int k=0;k<3;k++){
  float candidate=clamp(nearest+float(k)-1.0,0.0,8.0);
  float q=rockPiece(p,candidate);
  if(q<d){d=q;id=candidate;}
 }
 return vec2(d,id);
}
vec2 surface(vec3 p){
 float water=waterDistance(p);vec2 earth=earthDistance(p);
 return water<earth.x?vec2(water,1.0):vec2(earth.x,2.0+earth.y);
}
float selectedDistance(vec3 p,float material){return material<1.5?waterDistance(p):rockPiece(p,material-2.0);}
vec3 surfaceNormal(vec3 p,float material){
 float e=material<1.5&&hasNativeWater()?max(.0001,uWaterVoxelSize*.55):.0025;vec2 k=vec2(1.0,-1.0);
 return normalize(k.xyy*selectedDistance(p+k.xyy*e,material)+k.yyx*selectedDistance(p+k.yyx*e,material)+k.yxy*selectedDistance(p+k.yxy*e,material)+k.xxx*selectedDistance(p+k.xxx*e,material));
}

${nativeWaterTransportGLSL}

#define ENVMAP_TYPE_CUBE_UV
#define CUBEUV_MAX_MIP uStudioEnvironmentMaxMip
#define CUBEUV_TEXEL_WIDTH uStudioEnvironmentTexel.x
#define CUBEUV_TEXEL_HEIGHT uStudioEnvironmentTexel.y
${studioCubeUVGLSL}

vec3 studio(vec3 d){
 if(uHasStudioEnvironment>.5){
  // Match the actual stage PMREM: no equirectangular lookup, x flip, extra
  // exposure or display curve. A rigid local ray is transformed to world.
  vec3 worldDirection=normalize(mat3(uLocalToWorld)*d);
  vec3 environmentDirection=normalize(uStudioEnvironmentRotation*worldDirection);
  return bilinearCubeUV(uStudioEnvironment,environmentDirection,uStudioEnvironmentMaxMip)*uStudioEnvironmentIntensity;
 }
 // Linear radiance of a charcoal studio with broad soft sources. These are
 // analytic emitters, not an HDR image printed onto the water.
 float upper=sat(d.y*.5+.5);
 vec3 radiance=mix(vec3(.055,.060,.057),vec3(.12,.14,.16),upper);
 float key=pow(sat(dot(d,normalize(vec3(-.45,.65,.62)))),22.0);
 float strip=pow(sat(dot(d,normalize(vec3(.72,.30,.64)))),65.0);
 float cool=pow(sat(dot(d,normalize(vec3(-.80,.10,-.3)))),16.0);
 return radiance+vec3(9.8,9.3,8.7)*key+vec3(11.4,11.8,12.1)*strip+vec3(.55,.76,.85)*cool;
}
vec3 roomProbeRadiance(vec3 receiverHit,vec3 localDirection){
 if(uHasRoomProbe<.5)return studio(localDirection);
 // CubeCamera render-target textures use flipEnvMap=+1 in Three, unlike
 // imported cube images. Parallax lookup points from the captured position
 // at the actual room hit, not simply along the water's outgoing ray.
 vec3 direction=receiverHit-uRoomProbePosition;
 if(dot(direction,direction)<.00000001)return studio(localDirection);
 vec4 captured=textureLod(uRoomProbe,normalize(direction),0.0);
 // Transparent clear + opaque room makes this captured RGB premultiplied
 // at filtered silhouette edges. Do not multiply its coverage a second time.
 return captured.rgb+(1.0-clamp(captured.a,0.0,1.0))*studio(localDirection);
}
vec3 directionalRoomReflection(vec3 localDirection){
 // Fast production IBL: one world-direction sample at the captured local
 // probe. No receiver traversal, deferred arrays or screen reconstruction is
 // nested inside transport. This is explicitly not parallax-correct reflection.
 if(uHasRoomProbe<.5)return studio(localDirection);
 vec3 direction=normalize(mat3(uLocalToWorld)*localDirection);
 vec4 captured=textureLod(uRoomProbe,direction,0.0);
 return captured.rgb+(1.0-clamp(captured.a,0.0,1.0))*studio(localDirection);
}
#if ELEMENTS_ROOM_REFLECTIONS == 1
vec3 waterRoomReflections(vec3 entryPoint,vec3 entryDirection,float entryWeight,vec3 exitPoint,vec3 exitDirection,float exitWeight){
 // This function runs only after native transport. Reflections use the cached
 // room cube, and one receiver traversal shares matrix loads for both branches.
 vec3 entryRadiance=studio(entryDirection),exitRadiance=vec3(0.0);
 if(exitWeight>0.0)exitRadiance=studio(exitDirection);
 if(uHasRoomProbe<.5||uBackdropBoxCount==0)return entryRadiance*entryWeight+exitRadiance*exitWeight;
 vec3 entryWorld=(uLocalToWorld*vec4(entryPoint,1.0)).xyz;
 vec3 entryWorldDirection=normalize(mat3(uLocalToWorld)*entryDirection);
 vec3 exitWorld=vec3(0.0),exitWorldDirection=vec3(0.0);
 if(exitWeight>0.0){exitWorld=(uLocalToWorld*vec4(exitPoint,1.0)).xyz;exitWorldDirection=normalize(mat3(uLocalToWorld)*exitDirection);}
 float entryNearest=1e20,exitNearest=1e20;
 for(int reflectionReceiver=0;reflectionReceiver<8;reflectionReceiver++){
  if(reflectionReceiver>=uBackdropBoxCount)break;
  mat4 inverseBox=uBackdropBoxInverse[reflectionReceiver];
  vec3 boxMin=uBackdropBoxMinimum[reflectionReceiver],boxMax=uBackdropBoxMaximum[reflectionReceiver];
  vec2 entryBounds=rayBox((inverseBox*vec4(entryWorld,1.0)).xyz,mat3(inverseBox)*entryWorldDirection,boxMin,boxMax);
  float entryCandidate=entryBounds.x>.00001?entryBounds.x:entryBounds.y;
  if(entryBounds.y>=max(entryBounds.x,0.0)&&entryCandidate>.00001)entryNearest=min(entryNearest,entryCandidate);
  if(exitWeight>0.0){
   vec2 exitBounds=rayBox((inverseBox*vec4(exitWorld,1.0)).xyz,mat3(inverseBox)*exitWorldDirection,boxMin,boxMax);
   float exitCandidate=exitBounds.x>.00001?exitBounds.x:exitBounds.y;
   if(exitBounds.y>=max(exitBounds.x,0.0)&&exitCandidate>.00001)exitNearest=min(exitNearest,exitCandidate);
  }
 }
 if(entryNearest<1e19)entryRadiance=roomProbeRadiance(entryWorld+entryWorldDirection*entryNearest,entryDirection);
 if(exitWeight>0.0&&exitNearest<1e19)exitRadiance=roomProbeRadiance(exitWorld+exitWorldDirection*exitNearest,exitDirection);
 return entryRadiance*entryWeight+exitRadiance*exitWeight;
}
#endif
vec3 terminalBackdrop(vec3 localOrigin,vec3 localDirection,out int status){
 status=5;
 if(uBackdropBoxCount==0)return studio(localDirection);
 vec3 worldOrigin=(uLocalToWorld*vec4(localOrigin,1.0)).xyz;
 vec3 worldDirection=normalize(mat3(uLocalToWorld)*localDirection);
 float nearest=1e20;int receiver=-1;
 for(int receiverIndex=0;receiverIndex<8;receiverIndex++){
  if(receiverIndex>=uBackdropBoxCount)break;
  // Do not normalize the transformed direction: slab t must remain in world
  // distance even for scaled and rotated real studio receiver meshes.
  vec3 boxOrigin=(uBackdropBoxInverse[receiverIndex]*vec4(worldOrigin,1.0)).xyz;
  vec3 boxDirection=mat3(uBackdropBoxInverse[receiverIndex])*worldDirection;
  vec2 bounds=rayBox(boxOrigin,boxDirection,uBackdropBoxMinimum[receiverIndex],uBackdropBoxMaximum[receiverIndex]);
  float candidate=bounds.x>.00001?bounds.x:bounds.y;
  if(bounds.y>=max(bounds.x,0.0)&&candidate>.00001&&candidate<nearest){nearest=candidate;receiver=receiverIndex;}
 }
 status=2;if(nearest>1e19)return studio(localDirection);
 vec3 hit=worldOrigin+worldDirection*nearest;
 status=5;if(uHasBackdrop<.5)return roomProbeRadiance(hit,localDirection);
 vec4 clip=uBackdropWorldToClip*vec4(hit,1.0);
 status=3;if(clip.w<=0.0)return roomProbeRadiance(hit,localDirection);
 vec3 ndc=clip.xyz/clip.w;vec2 uv=ndc.xy*.5+.5;
 if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))||abs(ndc.z)>1.0)return roomProbeRadiance(hit,localDirection);
 // A nearest-depth value belongs to its pixel-center camera ray, not the
 // arbitrary refracted UV. Reconstructing it on the latter ray causes false
 // plane mismatches/checker patterns on grazing floors and walls.
 vec2 depthUV=(clamp(floor(uv/uBackdropTexel),vec2(0.0),1.0/uBackdropTexel-1.0)+.5)*uBackdropTexel;
 status=4;float depth=textureLod(uBackdropDepth,depthUV,0.0).r;
 if(depth>=.999999)return roomProbeRadiance(hit,localDirection);
 // Validate the actual hit face. A resolved MSAA depth can originate at ANY
 // covered subpixel sample, not the pixel center. Project this real plane and
 // derive its exact depth range over the sampled texel's raster footprint.
 vec3 boxHit=(uBackdropBoxInverse[receiver]*vec4(hit,1.0)).xyz;
 vec3 lowDistance=abs(boxHit-uBackdropBoxMinimum[receiver]),highDistance=abs(boxHit-uBackdropBoxMaximum[receiver]);
 vec3 faceDistance=min(lowDistance,highDistance);vec3 boxNormal=vec3(0.0);
 if(faceDistance.x<=faceDistance.y&&faceDistance.x<=faceDistance.z)boxNormal.x=lowDistance.x<highDistance.x?-1.0:1.0;
 else if(faceDistance.y<=faceDistance.z)boxNormal.y=lowDistance.y<highDistance.y?-1.0:1.0;
 else boxNormal.z=lowDistance.z<highDistance.z?-1.0:1.0;
 vec3 worldNormal=normalize(transpose(mat3(uBackdropBoxInverse[receiver]))*boxNormal);
 vec4 clipPlane=transpose(uBackdropClipToWorld)*vec4(worldNormal,-dot(worldNormal,hit));
 if(abs(clipPlane.z)<.0000001)return roomProbeRadiance(hit,localDirection);
 float planeDepth=-(dot(clipPlane.xy,depthUV*2.0-1.0)+clipPlane.w)/clipPlane.z;
 float depthRadius=dot(abs(clipPlane.xy/clipPlane.z),uBackdropTexel);
 // DEPTH_COMPONENT24 stores [0,1]; two quantization steps in NDC plus its
 // exact pixel coverage bound. There is no scene-scale/depth tolerance knob.
 if(abs(depth*2.0-1.0-planeDepth)>depthRadius+.000000238419)return roomProbeRadiance(hit,localDirection);
 status=1;return textureLod(uBackdropColor,uv,0.0).rgb;
}
float mineralHash(vec3 p){
 p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);
}
vec4 mineralNoiseGradient(vec3 p){
 // Quintic value field with its analytic gradient: fixed to each stone,
 // continuous through cell boundaries, never a screen-space grain overlay.
 vec3 cell=floor(p),f=fract(p),u=f*f*f*(f*(f*6.0-15.0)+10.0);
 vec3 du=30.0*f*f*(f*(f-2.0)+1.0);
 float a=mineralHash(cell),b=mineralHash(cell+vec3(1,0,0));
 float c=mineralHash(cell+vec3(0,1,0)),d=mineralHash(cell+vec3(1,1,0));
 float e=mineralHash(cell+vec3(0,0,1)),f1=mineralHash(cell+vec3(1,0,1));
 float g=mineralHash(cell+vec3(0,1,1)),h=mineralHash(cell+vec3(1,1,1));
 float k1=b-a,k2=c-a,k3=e-a,k4=a-b-c+d,k5=a-c-e+g,k6=a-b-e+f1,k7=-a+b+c-d+e-f1-g+h;
 float value=a+k1*u.x+k2*u.y+k3*u.z+k4*u.x*u.y+k5*u.y*u.z+k6*u.z*u.x+k7*u.x*u.y*u.z;
 vec3 gradient=du*vec3(k1+k4*u.y+k6*u.z+k7*u.y*u.z,k2+k4*u.x+k5*u.z+k7*u.z*u.x,k3+k5*u.y+k6*u.x+k7*u.x*u.y);
 return vec4(value,gradient);
}
vec3 roughStudio(vec3 d,float roughness){
 if(uHasStudioEnvironment<.5)return studio(d);
 vec3 worldDirection=normalize(mat3(uLocalToWorld)*d);
 vec3 environmentDirection=normalize(uStudioEnvironmentRotation*worldDirection);
 return textureCubeUV(uStudioEnvironment,environmentDirection,roughness).rgb*uStudioEnvironmentIntensity;
}
vec3 nearbyFireLighting(vec3 p,vec3 normal){
 #if ELEMENTS_HAS_NATIVE_FIRE == 1
 if(!useFire())return vec3(0.0);
 vec3 source=(uLocalToFire*vec4(p,1.0)).xyz,extent=uFireMaximum-uFireMinimum;
 vec3 center=clamp(source,uFireMinimum+extent*.05,uFireMaximum-extent*.05);
 center.z=(uFireMinimum.z+uFireMaximum.z)*.5;
 vec3 irradiance=vec3(0.0);
 // Three fixed native-field lighting taps at the resolved stone hit only.
 // This is unshadowed local fire fill, not a second volume traversal or GI.
 for(int fireLightTap=0;fireLightTap<3;fireLightTap++){
  vec3 lightPosition=center;lightPosition.x+=(float(fireLightTap)-1.0)*extent.x*.045;
  vec4 optical=textureLod(uFireVolume,lightPosition*uFireTextureScale+uFireTextureOffset,0.0);
  float depth=extent.z*.42;
  float integrated=optical.a>.0001?(1.0-exp(-optical.a*depth))/optical.a:depth;
  vec3 difference=lightPosition-source;
  vec3 toLight=normalize(transpose(mat3(uLocalToFire))*difference+vec3(0.0,.00001,0.0));
  float distance=length(difference)/max(uFireMetric,.00001);
  irradiance+=optical.rgb*integrated*sat(dot(normal,toLight))/(1.0+distance*distance*9.0);
 }
 return irradiance*.20;
 #else
 return vec3(0.0);
 #endif
}
vec3 shadeSurface(vec3 p,vec3 rd,float material){
 int index=int(material-1.5);vec3 size=uStoneSizes[index];
 float minimumSize=min(size.x,min(size.y,size.z));
 vec3 q=stoneCoordinates(p,index)+vec3(float(index)*3.71,0.0,0.0);
 float footprint=mix(length(p-uCameraLocal)*uPixelAngle,uOrthographicPixel,uOrthographic)/minimumSize;
 float broadWeight=1.0-smoothstep(.25,.8,footprint*2.7);
 vec4 broad=vec4(.5,0,0,0);
 if(broadWeight>.001){broad=mineralNoiseGradient(q*2.7);broad=vec4(mix(.5,broad.x,broadWeight),broad.yzw*broadWeight);}
 float mesoWeight=1.0-smoothstep(.25,.8,footprint*11.0),fineWeight=1.0-smoothstep(.25,.8,footprint*31.0);
 vec4 meso=vec4(.5,0,0,0),fine=vec4(.5,0,0,0);
 if(mesoWeight>.001)meso=mineralNoiseGradient(q*11.0+vec3(4.1,7.3,2.6));
 if(fineWeight>.001)fine=mineralNoiseGradient(q*31.0+vec3(17.4,3.6,11.2));
 vec3 geometric=surfaceNormal(p,material);if(dot(geometric,rd)>0.0)geometric=-geometric;
 // Macro erosion, small vesicles and grain have distinct scales. Unresolved
 // bands fade to their mean instead of becoming sparkling bump-map noise.
 vec3 gradient=stoneGradient(broad.yzw*.11+meso.yzw*(.070*mesoWeight)+fine.yzw*(.026*fineWeight),index)*minimumSize;
 vec3 n=normalize(geometric-(gradient-geometric*dot(geometric,gradient)));
 float pores=smoothstep(.54,.82,meso.x)*mesoWeight;
 float mineral=smoothstep(.69,.89,broad.x)*(.4+.6*meso.x);
 vec3 basalt=mix(vec3(.026,.030,.032),vec3(.085,.071,.056),broad.x);
 basalt=mix(basalt,vec3(.16,.115,.067),mineral*.32);
 basalt*=1.0-pores*.55;
 float roughness=clamp(.80+pores*.14-(meso.x-.5)*.18,.66,.95);
 vec3 toLight=normalize(uKeyLocal-p),view=-rd;float ndv=sat(dot(n,view)),ndl=sat(dot(n,toLight));
 float fresnel=.045+.955*pow(1.0-ndv,5.0);
 vec3 incident=roughStudio(n,1.0)*.8+vec3(2.15,1.48,.90)*ndl+nearbyFireLighting(p,n);
 vec3 diffuse=basalt*incident*(1.0-fresnel);
 vec3 reflection=roughStudio(reflect(rd,n),roughness)*fresnel*(.64+.36*ndl);
 return diffuse+reflection;
}

float filteredAirFilament(vec2 q,vec2 velocity,vec2 width,float intervalLength,float footprint){
 // Convolve a thin Gaussian cross-section with the existing ray interval
 // and raster footprint. Rank-one covariance retains integrated mass as a
 // wisp becomes subpixel, with no jitter, extra samples or opaque hose.
 vec2 variance=width*width+vec2(footprint*footprint*.12);
 vec2 travel=velocity*intervalLength*.28867513459;
 float xx=variance.x+travel.x*travel.x,yy=variance.y+travel.y*travel.y,xy=travel.x*travel.y;
 float determinant=max(xx*yy-xy*xy,1e-12);
 float exponent=(yy*q.x*q.x+xx*q.y*q.y-2.0*xy*q.x*q.y)/determinant;
 return exp(-.5*exponent)*width.x*width.y/sqrt(determinant);
}
vec4 atmosphere(vec3 p,vec3 nativeFirePosition,bool knownZeroFire,vec3 rayDirection,float intervalLength){
 float y=p.y,ph=phase();
 float compositionY=y*4.78/uCompositionHeight;
 float envelope=smoothstep(.12,.65,compositionY)*(1.0-smoothstep(3.7,4.78,compositionY));
 float extinction=0.0;vec3 emission=vec3(0.0);
 #if ELEMENTS_HAS_NATIVE_FIRE == 1
 if(useFire()){
  // Native source coefficient (emission + captured soot in-scattering) and
  // extinction. No display radiance or fabricated reaction replaces it.
  #if ELEMENTS_OPTIMIZED_VOLUME == 1
  vec3 source=nativeFirePosition;
  if(!knownZeroFire){
  #else
  vec3 source=(uLocalToFire*vec4(p,1.0)).xyz;
  #endif
  if(all(greaterThanEqual(source,uFireMinimum))&&all(lessThanEqual(source,uFireMaximum))){
   vec4 optical=textureLod(uFireVolume,source*uFireTextureScale+uFireTextureOffset,0.0);
   emission=optical.rgb*uFireMetric;extinction=optical.a*uFireMetric;
  }
  #if ELEMENTS_OPTIMIZED_VOLUME == 1
  }
  #endif
 }
 #else
 if(useFire()){
 // Explicitly marked authored preview while a source capture is unavailable.
 float twist=1.36*y-ph*.91+3.0;
 vec2 q=turn(twist)*p.xz;
 float flameRadius=.36+.48*sin(clamp(y/4.6,0.0,1.0)*3.14159265);
 float wind=.055*sin(y*7.0-uTime*1.7)+.025*sin(y*17.0+uTime*2.3);
 q.x-=flameRadius+wind;
 float pulse=sin(y*10.0-uTime*2.4+q.y*8.0)*sin(y*5.0+q.x*7.0+uTime);
 q.y+=.06*sin(y*12.0-uTime*3.2+q.x*6.0);
 vec2 flameCoord=q/vec2(.30+.075*pulse,.39+.10*sin(y*3.0));
 float shape2=dot(flameCoord,flameCoord);
 float flame=sat(1.0-shape2)*envelope;
 float core=sat(1.0-shape2*9.0)*envelope;
 flame*=flame*(.75+.25*pulse);
 vec3 fireColor=mix(vec3(1.45,.075,.003),vec3(3.0,.60,.025),sat(core*1.35));
 fireColor=mix(fireColor,vec3(4.2,2.0,.32),pow(core,7.0)*.6);
 extinction=flame*7.0;emission=fireColor*flame*7.0;
 }
 #endif
 if(!useAir())return vec4(emission,extinction);
 #if ELEMENTS_OPTIMIZED_VOLUME == 1
 // The authored filaments live on an outer annulus. The central native
 // plume has no air visualization, so skip its trigonometry there.
 if(envelope<=0.0||dot(p.xz,p.xz)<.3025||dot(p.xz,p.xz)>2.7225)return vec4(emission,extinction);
 #endif
 // Two intermittently illuminated tracer filaments, not visible "air"
 // as a gray smoke tube. Their counter-current curl follows the composition.
 float h=compositionY,dh=rayDirection.y*4.78/uCompositionHeight;
 float curlPhase=h*2.2-uTime*.35;
 float angle=h*1.5+ph*.45+1.4+.12*sin(curlPhase);
 float angleDerivative=1.5+.264*cos(curlPhase);
 vec2 a=turn(angle)*p.xz;
 float radius=.99+.13*sin(h*.9+.2),radiusDerivative=.117*cos(h*.9+.2);
 vec2 velocity=turn(angle)*rayDirection.xz+vec2(a.y,-a.x)*angleDerivative*dh;
 float foldPhase=h*3.4-uTime*.55;
 vec2 q=vec2(a.x-radius,a.y+.10*sin(foldPhase));
 velocity+=vec2(-radiusDerivative,.34*cos(foldPhase))*dh;
 float footprint=mix(length(p-uCameraLocal)*uPixelAngle,uOrthographicPixel,uOrthographic);
 float wisp=filteredAirFilament(q,velocity,vec2(.018,.042),intervalLength,footprint);
 vec2 secondQ=q+vec2(.055+.025*sin(h*5.0),-.065);
 vec2 secondVelocity=velocity+vec2(.125*cos(h*5.0)*dh,0.0);
 float fineWisp=filteredAirFilament(secondQ,secondVelocity,vec2(.008,.020),intervalLength,footprint);
 float breaks=smoothstep(-.35,.65,sin(h*3.7-uTime*.42));
 float radial=length(p.xz);
 float annulus=smoothstep(.55,.72,radial)*(1.0-smoothstep(1.48,1.65,radial));
 float air=(wisp*.72+fineWisp*.42)*envelope*breaks*annulus;
 vec3 toLight=normalize(uKeyLocal-p);
 float cosine=dot(rayDirection,toLight),g=.68;
 float phaseFunction=(1.0-g*g)/max(4.0*3.14159265*pow(1.0+g*g-2.0*g*cosine,1.5),.001);
 float scattering=air*.28;
 extinction+=scattering;
 emission+=scattering*(vec3(.17,.23,.30)+vec3(5.2,3.9,2.6)*phaseFunction);
 return vec4(emission,extinction);
}
${atmosphereIntervalGLSL}

void main(){
 if(elementMode()==7)discard;
 vec3 rd=normalize(mix(vLocalPosition-uCameraLocal,uViewDirection,uOrthographic));
 vec3 ro=mix(uCameraLocal,vLocalPosition-uViewDirection*20.0,uOrthographic);
 vec2 range=interval(ro,rd);float t=max(range.x,0.0),end=range.y;
 if(end<=t)discard;
 float contactDepth=-1.0;
 if(rd.y<-.0001){
  contactDepth=(.013-ro.y)/rd.y;
  if(contactDepth>t&&contactDepth<end){
   end=contactDepth;
  }
 }
 // The live fields fit a radius 1.68 cylinder. Reject empty proxy pixels and
 // clip their entry/exit analytically; the ground-contact footprint remains.
 vec2 cylinder=cylinderInterval(ro,rd);t=max(t,cylinder.x);end=min(end,cylinder.y);
 vec3 color=vec3(0.0),frontPoint=vec3(0.0);float opacity=0.0,firstDepth=-1.0;
 float waterSkipEnd=-1.0;
 float surfaceSafeEnd=-1.0;
 int transportDiagnostic=0;
 int waterBodies=0;
 #if ELEMENTS_ROOM_REFLECTIONS == 1
 int reflectionCount=0;
 vec3 reflectionEntryPoints[4],reflectionEntryDirections[4];
 vec3 reflectionExitPoints[4],reflectionExitDirections[4];
 vec2 reflectionWeights[4];
 #endif
 bool transmittedWater=false;
 int backdropDiagnostic=0;
 vec3 fireRo=(uLocalToFire*vec4(ro,1.0)).xyz,fireRd=mat3(uLocalToFire)*rd;
 vec2 fireRange=rayBox(fireRo,fireRd,uFireMinimum,uFireMaximum);
 vec3 voxelsPerUnit=abs(fireRd)/uFireSpacing;
 float fireStride=1.0/max(max(voxelsPerUnit.x,voxelsPerUnit.y),max(voxelsPerUnit.z,.0001));
 for(int stepIndex=0;stepIndex<96;stepIndex++){
  if(stepIndex>=64&&!hasNativeWater()&&!hasNativeFire())break;
  if(t>=end||opacity>.985)break;
  vec3 p=ro+rd*t;vec2 hit=vec2(surfaceSafeEnd-t,0.0);
  bool updateSurface=t>=surfaceSafeEnd-.0000001;
  if(updateSurface){
   vec2 earth=useEarth()?earthDistance(p):vec2(10.0,0.0);
   float water=!useWater()||t<waterSkipEnd||waterBodies>=4?10.0:waterDistance(p);
   hit=water<earth.x?vec2(water,1.0):vec2(earth.x,earth.y+2.0);
  }
  float pixelFootprint=mix(length(p-uCameraLocal)*uPixelAngle,uOrthographicPixel,uOrthographic);
  // SDF is conservatively scaled by .56; .25 of the pixel footprint in
  // field units stays below half a physical pixel of surface coverage.
  float waterTolerance=max(.0008,min(uWaterVoxelSize*.20,pixelFootprint*.25));
  float hitThreshold=hit.y<1.5&&hasNativeWater()?waterTolerance:.0045;
  if(updateSurface&&hit.x<hitThreshold){
   if(firstDepth<0.0){firstDepth=t;frontPoint=p;}
   if(useWater()&&hit.y<1.5){
    if(hasNativeWater()){
     NativeWaterPath path=traceNativeWaterTransport(p,rd,t);
     bool transmitted=path.status==0;
     if(uDebugBudget>.5)transportDiagnostic=max(transportDiagnostic,waterDiagnosticSeverity(path.status));
     // Source distance is millimetres. Presentation scale does not change
     // physical absorption, nor replace the actual entry/exit thickness.
     float metres=path.pathLength/max(uWaterMetric,.000001)*.001;
     float absorption=1.0-exp(-.32*metres);
     bool validEntry=dot(path.entryNormal,path.entryNormal)>.5;
     // A near-surface primary estimate need not cross the isosurface. Such
     // coverage misses must not consume one of the four real-body slots.
     if(validEntry)waterBodies++;
     float reflection=validEntry?path.entryFresnel:0.0;
     // Internal TIR follows the next real native boundary. The bounded
     // non-TIR exit follows transmission. Its internal reflected tail uses
     // an explicit shared-environment closure, not a front-mirror duplicate.
     float throughput=(1.0-reflection)*(1.0-absorption)*(transmitted?1.0-path.exitFresnel:1.0);
     float alpha=1.0-throughput;
     float exitReflectionWeight=transmitted?(1.0-reflection)*(1.0-absorption)*path.exitFresnel:0.0;
     #if ELEMENTS_ROOM_REFLECTIONS == 1
     if(validEntry&&reflectionCount<4){
      // Store the exact current path throughput BEFORE updating opacity.
      // Illumination is linear, so its bounded receiver lookup can be deferred
      // outside the 96-event traversal without changing radiance or energy.
      reflectionEntryPoints[reflectionCount]=path.entryPoint;
      reflectionEntryDirections[reflectionCount]=reflect(rd,path.entryNormal);
      reflectionExitPoints[reflectionCount]=path.exitReflectionPoint;
      reflectionExitDirections[reflectionCount]=path.exitReflectionDirection;
      reflectionWeights[reflectionCount]=(1.0-opacity)*vec2(reflection,exitReflectionWeight);
      reflectionCount++;
     }
     #else
     // Production closure: direction-only local room IBL, with shared studio
     // on open/unavailable probe coverage. Native energy weights stay intact.
     vec3 reflectedRadiance=validEntry?directionalRoomReflection(reflect(rd,path.entryNormal))*reflection:vec3(0.0);
     if(transmitted)reflectedRadiance+=directionalRoomReflection(path.exitReflectionDirection)*exitReflectionWeight;
     color+=(1.0-opacity)*reflectedRadiance;
     #endif
     color+=(1.0-opacity)*vec3(.04,.12,.13)*(1.0-reflection)*absorption;
     opacity+=(1.0-opacity)*alpha;
     if(!transmitted){
      // An unresolved tail is explicitly diagnosed. Preserve the known
      // front reflection and skip its unresolved subpixel interval instead
      // of inventing a black or perfectly mirrored water surface.
      t+=uWaterVoxelSize*4.0;waterSkipEnd=t;surfaceSafeEnd=-1.0;continue;
     }
     // A normal offset, not just a grazing-ray offset, really clears the
     // reconstructed surface and avoids re-hitting the same interface.
     ro=path.exitPoint+path.direction*(uWaterVoxelSize*.006);rd=path.direction;
     transmittedWater=true;
     vec2 shifted=interval(ro,rd),shiftedCylinder=cylinderInterval(ro,rd);
     t=max(0.0,max(shifted.x,shiftedCylinder.x));end=min(shifted.y,shiftedCylinder.y);
     if(rd.y<-.0001)end=min(end,(.013-ro.y)/rd.y);
     fireRo=(uLocalToFire*vec4(ro,1.0)).xyz;fireRd=mat3(uLocalToFire)*rd;
     fireRange=rayBox(fireRo,fireRd,uFireMinimum,uFireMaximum);
     voxelsPerUnit=abs(fireRd)/uFireSpacing;
     fireStride=1.0/max(max(voxelsPerUnit.x,voxelsPerUnit.y),max(voxelsPerUnit.z,.0001));
     waterSkipEnd=t+.0015;surfaceSafeEnd=-1.0;continue;
    }
    vec3 n=surfaceNormal(p,1.0);if(dot(n,rd)>0.0)n=-n;
    float ndv=sat(dot(n,-rd));float fresnel=.02037+.97963*pow(1.0-ndv,5.0);
    // Both interfaces of the thin sheet are collapsed analytically. The same
    // primary ray continues through the current: fire and minerals behind
    // water remain visible. There is no opaque studio-colored water fill.
    float path=.075/max(ndv,.22);
    float absorption=1.0-exp(-.20*path);
    float alpha=fresnel+(1.0-fresnel)*absorption;
    vec3 toLight=normalize(uKeyLocal-p);
    float sparkle=pow(sat(dot(reflect(-toLight,n),-rd)),190.0);
    vec3 contribution=studio(reflect(rd,n))*fresnel+vec3(.08,.20,.23)*(1.0-fresnel)*absorption+vec3(1.0,.95,.88)*sparkle*.45;
    color+=(1.0-opacity)*contribution;opacity+=(1.0-opacity)*alpha;
    // Thin-sheet lateral displacement. The exit direction is parallel to
    // entry, but contained stones/fire are visibly displaced through water.
    // This is bounded sheet transport, not recursive multi-interface tracing.
    ro+=(refract(rd,n,1.0/1.333)-rd)*min(path,.24)*.55;
    // Refit ray intervals after displacement; keeping the original clip
    // interval would slice the refracted field along the proxy boundary.
    vec2 shifted=interval(ro,rd),shiftedCylinder=cylinderInterval(ro,rd);
    end=min(shifted.y,shiftedCylinder.y);t=max(t,max(shifted.x,shiftedCylinder.x));
    if(rd.y<-.0001)end=min(end,(.013-ro.y)/rd.y);
    fireRo=(uLocalToFire*vec4(ro,1.0)).xyz;fireRange=rayBox(fireRo,fireRd,uFireMinimum,uFireMaximum);
    waterSkipEnd=t+path+.025;t+=.018;surfaceSafeEnd=-1.0;continue;
   }
   color+=(1.0-opacity)*shadeSurface(p,rd,hit.y);opacity=1.0;break;
  }
  // Source waterDistance already includes .56<1/sqrt(3). Do not apply the
  // procedural helix's extra .72 contraction to this validated field again.
  if(updateSurface){
   float safeStep=clamp(hit.x*(hasNativeWater()?.95:.72),hasNativeWater()?.0007:.018,.16);
   if(useEarth()&&abs(rd.y)>.00001){
    float nearest=clamp(floor((p.y-uStoneBase)/uStoneSpacing+.5+(rd.y>0.0?.00001:-.00001)),0.0,8.0);
    bool nextCell=(rd.y>0.0&&nearest<8.0)||(rd.y<0.0&&nearest>0.0);
    if(nextCell){
     float boundary=uStoneBase+(nearest+(rd.y>0.0?.5:-.5))*uStoneSpacing;
     safeStep=min(safeStep,max(.000001,(boundary-p.y)/rd.y));
    }
   }
   surfaceSafeEnd=t+safeStep;
  }
  bool volumeExhausted;
  t=integrateAtmosphereInterval(ro,rd,t,min(surfaceSafeEnd,end),fireRo,fireRd,fireRange,fireStride,color,opacity,frontPoint,firstDepth,volumeExhausted);
  if(volumeExhausted){
   if(uDebugBudget>.5)transportDiagnostic=max(transportDiagnostic,3);
   break;
  }
 }
 #if ELEMENTS_ROOM_REFLECTIONS == 1
 // Receiver intersections are not nested inside source-volume / native water
 // traversal. Each stored body is evaluated once, with its saved throughput.
 for(int reflectionBody=0;reflectionBody<4;reflectionBody++){
  if(reflectionBody>=reflectionCount)break;
  color+=waterRoomReflections(reflectionEntryPoints[reflectionBody],reflectionEntryDirections[reflectionBody],reflectionWeights[reflectionBody].x,reflectionExitPoints[reflectionBody],reflectionExitDirections[reflectionBody],reflectionWeights[reflectionBody].y);
 }
 #endif
 // No invented screen-space/contact opacity. The actual floor bounds clip
 // the ray; future cast shadows must come from the same source geometry.
 // After actual refraction, resolve the terminal ray against the captured
 // opaque studio. Alpha one represents the resolved opaque composite, NOT
 // increased physical water extinction. Non-water pixels retain normal alpha.
 if(transmittedWater&&opacity<.985&&t>=end){
  color+=(1.0-opacity)*terminalBackdrop(ro,rd,backdropDiagnostic);opacity=1.0;
 }
 if(uDebugBudget>.5){
  if(t<end&&opacity<.985)transportDiagnostic=max(transportDiagnostic,2);
  if(transportDiagnostic>0){
   if(firstDepth<0.0){frontPoint=ro+rd*t;firstDepth=t;}
   // Exact status colors, not a tint over the beauty frame. A higher-severity
   // earlier body must remain visible after a later entry-only miss.
   color=transportDiagnosticColor(transportDiagnostic);opacity=1.0;
  }
 }
 if(elementMode()==8&&backdropDiagnostic>0){color=backdropDiagnosticColor(backdropDiagnostic);opacity=1.0;}
 if(opacity<.002&&max(max(color.r,color.g),color.b)<.00001)discard;
 vec4 clip=uLocalToClip*vec4(frontPoint,1.0);
 gl_FragDepth=clamp(clip.z/clip.w*.5+.5,0.0,1.0);
 // ONE, ONE_MINUS_SRC_ALPHA blends native emission into the linear HDR stage.
 // Nonzero radiance with zero extinction survives, without fake opacity.
 // The entire stage receives its display transform after linear composition.
 gl_FragColor=vec4(color,opacity);
}`;

export function createElementsShader({optimizedVolume=true,roomReflections=false}={}){
 const root=new T.Group();root.name='ELEMENTS / four states in one current';
 const min=new T.Vector3(...ELEMENTS_BOUNDS.min),max=new T.Vector3(...ELEMENTS_BOUNDS.max),size=max.clone().sub(min),center=min.clone().add(max).multiplyScalar(.5);
 let geometry=new T.BoxGeometry(size.x,size.y,size.z);geometry.translate(center.x,center.y,center.z);
 const stoneCenters=Array.from({length:9},()=>new T.Vector3()),stoneRotations=[],stoneSizes=[],stoneBounds=[];
 const emptyFire=new T.Data3DTexture(new Uint16Array(4),1,1,1),emptyWater=new T.Data3DTexture(new Uint16Array([0x5640]),1,1,1),emptyOccupancy=new T.Data3DTexture(new Uint8Array([255]),1,1,1);
 const emptyStage=new T.DataTexture(new Uint8Array([0,0,0,255]),1,1,T.RGBAFormat);emptyStage.needsUpdate=true;
 for(const [texture,format] of [[emptyFire,T.RGBAFormat],[emptyWater,T.RedFormat]]){texture.type=T.HalfFloatType;texture.format=format;texture.minFilter=texture.magFilter=T.LinearFilter;texture.unpackAlignment=1;texture.needsUpdate=true;}
 emptyOccupancy.format=T.RedFormat;emptyOccupancy.type=T.UnsignedByteType;emptyOccupancy.minFilter=emptyOccupancy.magFilter=T.NearestFilter;emptyOccupancy.unpackAlignment=1;emptyOccupancy.needsUpdate=true;
 for(let i=0;i<9;i++){
  stoneRotations.push(new T.Vector4(Math.cos(i*1.76+.7),Math.sin(i*1.76+.7),Math.cos(i*.78),Math.sin(i*.78)));
  const scale=.19+.075*Math.sin(i*2.4+1),size=new T.Vector3(scale*(1.12+.17*Math.sin(i)),scale*.86,scale);stoneSizes.push(size);stoneBounds.push(Math.max(size.x,size.y,size.z)*1.365);
 }
 const uniforms={uCameraLocal:{value:new T.Vector3()},uViewDirection:{value:new T.Vector3(0,0,-1)},uKeyLocal:{value:new T.Vector3(7,12.3,-2)},uOrthographic:{value:0},uProgress:{value:0},uTime:{value:0},uLocalToClip:{value:new T.Matrix4()},uLocalToWorld:{value:new T.Matrix4()},uStoneCenters:{value:stoneCenters},uStoneRotations:{value:stoneRotations},uStoneSizes:{value:stoneSizes},uStoneBounds:{value:stoneBounds},uWaterTip:{value:new T.Vector3()},
  uStudioEnvironment:{value:emptyStage},uHasStudioEnvironment:{value:0},uStudioEnvironmentIntensity:{value:1},uStudioEnvironmentMaxMip:{value:4},uStudioEnvironmentTexel:{value:new T.Vector2(1,1)},uStudioEnvironmentRotation:{value:new T.Matrix3()},
  uRoomProbe:{value:null},uHasRoomProbe:{value:0},uRoomProbePosition:{value:new T.Vector3()},
  uBackdropColor:{value:emptyStage},uBackdropDepth:{value:emptyStage},uHasBackdrop:{value:0},uBackdropWorldToClip:{value:new T.Matrix4()},uBackdropClipToWorld:{value:new T.Matrix4()},uBackdropCamera:{value:new T.Vector3()},uBackdropPixelSpan:{value:.001},uBackdropOrthographic:{value:0},uBackdropTexel:{value:new T.Vector2(1,1)},uBackdropBoxCount:{value:0},uBackdropBoxInverse:{value:Array.from({length:ELEMENTS_LIMITS.backdropBoxes},()=>new T.Matrix4())},uBackdropBoxMinimum:{value:Array.from({length:ELEMENTS_LIMITS.backdropBoxes},()=>new T.Vector3())},uBackdropBoxMaximum:{value:Array.from({length:ELEMENTS_LIMITS.backdropBoxes},()=>new T.Vector3())},
  uFireVolume:{value:emptyFire},uWaterVolume:{value:emptyWater},uHasFireVolume:{value:0},uHasWaterVolume:{value:0},uLocalToFire:{value:new T.Matrix4()},uLocalToWater:{value:new T.Matrix4()},
  uFireOccupancy:{value:emptyOccupancy},uHasFireOccupancy:{value:0},uFireOccupancyDimensions:{value:new T.Vector3(1,1,1)},uFireBlockSize:{value:new T.Vector3(8,8,8)},uFireSampleOrigin:{value:new T.Vector3()},
  uFireMinimum:{value:new T.Vector3(-1,0,-1)},uFireMaximum:{value:new T.Vector3(1,1,1)},uFireTextureScale:{value:new T.Vector3(1,1,1)},uFireTextureOffset:{value:new T.Vector3()},uFireSpacing:{value:new T.Vector3(1,1,1)},uFireMetric:{value:1},
  uWaterMinimum:{value:new T.Vector3(-1,0,-1)},uWaterMaximum:{value:new T.Vector3(1,1,1)},uWaterTextureScale:{value:new T.Vector3(1,1,1)},uWaterTextureOffset:{value:new T.Vector3()},uWaterMetric:{value:1},uWaterVoxelSize:{value:.01},uStoneSpacing:{value:.49},uStoneBase:{value:.29},uCompositionHeight:{value:4.78},uDebugBudget:{value:0},uDebugMode:{value:0},uBoundsMaximum:{value:max.clone()},uPixelAngle:{value:.0007},uOrthographicPixel:{value:.006}};
 const material=new T.ShaderMaterial({name:'ELEMENTS / one source-volume transport program',defines:{ELEMENTS_HAS_NATIVE_FIRE:0,ELEMENTS_HAS_NATIVE_WATER:0,ELEMENTS_OPTIMIZED_VOLUME:optimizedVolume?1:0,ELEMENTS_ROOM_REFLECTIONS:roomReflections?1:0},uniforms,vertexShader:elementsVertexShader,fragmentShader:elementsFragmentShader,transparent:true,premultipliedAlpha:true,depthWrite:false,depthTest:true,side:T.BackSide,toneMapped:false});
 const mesh=new T.Mesh(geometry,material);mesh.name='Bounded four-element shader volume';mesh.castShadow=false;mesh.receiveShadow=false;mesh.renderOrder=3;root.add(mesh);
 const inverse=new T.Matrix4(),viewDirection=new T.Vector3(),worldEye=new T.Vector3(),keyWorld=new T.Vector3(7,9,-2),viewport=new T.Vector4();
 const environmentEuler=new T.Euler(),environmentMatrix=new T.Matrix4();
 let backdrop=null;
 function updateBackdrop(drawCamera){
  uniforms.uHasBackdrop.value=0;uniforms.uBackdropBoxCount.value=0;
  if(!backdrop||backdrop.valid===false||backdrop.isValid&&!backdrop.isValid())return;
  const camera=backdrop.camera||drawCamera;
  if(camera!==drawCamera)return; // Cached depth belongs to this exact camera.
  uniforms.uBackdropWorldToClip.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  uniforms.uBackdropClipToWorld.value.copy(uniforms.uBackdropWorldToClip.value).invert();
  camera.getWorldPosition(uniforms.uBackdropCamera.value);
  uniforms.uBackdropOrthographic.value=camera.isOrthographicCamera?1:0;
  uniforms.uBackdropTexel.value.set(1/Math.max(1,backdrop.depthTexture.image?.width||1),1/Math.max(1,backdrop.depthTexture.image?.height||1));
  uniforms.uBackdropPixelSpan.value=2/(Math.abs(camera.projectionMatrix.elements[5])*Math.max(1,backdrop.texture.image?.height||1));
  let count=0,overflow=false;
  const addReceiver=object=>{
   if(!object.isMesh||object.geometry?.type!=='BoxGeometry')return;
   if(count===ELEMENTS_LIMITS.backdropBoxes){overflow=true;return;}
   if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();
   const box=object.geometry.boundingBox;
   if(!box||box.isEmpty()||Math.abs(object.matrixWorld.determinant())<1e-12)return;
   uniforms.uBackdropBoxInverse.value[count].copy(object.matrixWorld).invert();
   uniforms.uBackdropBoxMinimum.value[count].copy(box.min);uniforms.uBackdropBoxMaximum.value[count].copy(box.max);count++;
  };
  for(const receiver of backdrop.receivers){
   let visible=true;for(let object=receiver;object;object=object.parent)if(!object.visible){visible=false;break;}
   if(visible)receiver.traverseVisible(addReceiver);
  }
  // Never silently omit a nearer opaque receiver when the explicit bound is
  // exceeded. Shared environment fallback remains honest and diagnosable.
  uniforms.uBackdropBoxCount.value=count;uniforms.uHasBackdrop.value=count&&!overflow?1:0;
 }
 mesh.onBeforeRender=function(renderer,scene,camera){
  inverse.copy(this.matrixWorld).invert();camera.getWorldPosition(worldEye);
  uniforms.uCameraLocal.value.copy(worldEye).applyMatrix4(inverse);
  camera.getWorldDirection(viewDirection);uniforms.uViewDirection.value.copy(viewDirection).transformDirection(inverse);
  uniforms.uKeyLocal.value.copy(keyWorld).applyMatrix4(inverse);
  uniforms.uOrthographic.value=camera.isOrthographicCamera?1:0;
  if(renderer?.getCurrentViewport)renderer.getCurrentViewport(viewport);else viewport.set(0,0,1920,1080);
  const pixelSpan=2/(Math.abs(camera.projectionMatrix.elements[5])*Math.max(1,viewport.w));
  const matrixElements=this.matrixWorld.elements,scale=Math.hypot(matrixElements[0],matrixElements[1],matrixElements[2]);
  uniforms.uPixelAngle.value=pixelSpan;uniforms.uOrthographicPixel.value=pixelSpan/Math.max(scale,.00001);
  uniforms.uLocalToClip.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(this.matrixWorld);
  uniforms.uLocalToWorld.value.copy(this.matrixWorld);updateBackdrop(camera);
  this.material.uniformsNeedUpdate=true;
 };
 const sources={fire:{status:'missing / authored preview only'},water:{status:'missing / authored preview only'}};
 const traceView=()=>({localToClip:uniforms.uLocalToClip.value.toArray(),cameraLocal:uniforms.uCameraLocal.value.toArray(),localToWater:uniforms.uLocalToWater.value.toArray(),waterTextureScale:uniforms.uWaterTextureScale.value.toArray(),waterTextureOffset:uniforms.uWaterTextureOffset.value.toArray(),voxelSize:uniforms.uWaterVoxelSize.value,metric:uniforms.uWaterMetric.value,orthographic:uniforms.uOrthographic.value,viewDirection:uniforms.uViewDirection.value.toArray()});
 const metadata=Object.freeze({
  kind:'single shader / bounded object-space transport',elements:Object.freeze(['earth','water','fire','air']),drawCalls:1,materials:1,
  get textureInputs(){return uniforms.uHasFireVolume.value+uniforms.uHasWaterVolume.value;},passes:1,limits:ELEMENTS_LIMITS,fluidSimulation:false,sources,waterIor:1.333,
  transportDiagnostics:Object.freeze({aggregation:'highest severity across all paths in each pixel',legend:ELEMENTS_TRANSPORT_DIAGNOSTICS}),
  waterTransport:'Native trilinear-cell surface roots, internal total-internal-reflection paths, measured physical thickness, and source-voxel-filtered optical normals with exact geometric offsets. '+(roomReflections?'EXPERIMENTAL deferred room reflections are enabled; this path has not passed browser compiler/performance validation. ':'Production reflections use direction-only cached local room IBL, without parallax, and shared studio fallback for open probe coverage; deferred reflection arrays and receiver traversal are compiled out. ')+'Terminal transmission prefers depth-validated screen radiance and uses the parallax-directed cached room probe offscreen. That room probe is a single-viewpoint radiance approximation, not arbitrary recursive scene tracing. At most four water bodies, 96 visited cells per body, four internal TIR bounces, and nine bisections per monotonic cubic interval. Non-TIR exit reflection tails use a shared-room/environment closure, not further water geometry traversal. Unresolved transport is diagnosed and skips the unresolved interval while retaining known entry reflection and absorption; it is not converted to a front mirror. Missing-source preview uses an analytic thin sheet. Recorded source fields are not live fluid simulation.',
  get stageTransport(){return {sharedEnvironment:uniforms.uHasStudioEnvironment.value===1,environmentIntensity:uniforms.uStudioEnvironmentIntensity.value,roomProbe:uniforms.uHasRoomProbe.value===1,roomReflectionMode:roomReflections?'experimental deferred parallax':'direction-only local room IBL',deferredRoomReflectionsEnabled:!!roomReflections,deferredRoomReflectionsValidated:false,roomProbePosition:uniforms.uRoomProbePosition.value.toArray(),backdropBound:!!backdrop,backdropValid:uniforms.uHasBackdrop.value===1,visibleReceiverBoxes:uniforms.uBackdropBoxCount.value,maximumReceiverBoxes:ELEMENTS_LIMITS.backdropBoxes,depthValidation:'exact receiver-plane depth range over the raster pixel footprint, including resolved MSAA samples'};},
  compositing:'premultiplied linear HDR radiance, one stage-wide display transform required',
  earth:'continuous rounded fractured volcanic bodies; object-locked analytic mineral gradients filtered by pixel footprint, rough dielectric studio reflections; three fixed native-fire lighting taps at visible stone hits are an unshadowed local-light approximation, not additional path tracing',
  air:'two sparse backlit counter-current tracer filaments; Gaussian covariance includes the existing ray interval and raster footprint; authored visualization, not simulated air or opaque smoke',
  shadow:'no cast shadow from the native source shader yet; detached analytic contact-opacity approximation removed'
 });
 // Getter snapshots the actual last draw camera rather than a guessed
 // portfolio pose; diagnostics serialize only these small scalar arrays.
 const exposedMetadata=Object.freeze(Object.defineProperties({get traceView(){return traceView();},backdropDiagnostics:ELEMENTS_BACKDROP_DIAGNOSTICS,volumeQuadrature:Object.freeze({surfaceEvents:ELEMENTS_LIMITS.primarySteps,maximumInterval:ELEMENTS_LIMITS.maxStep,samplesPerInterval:ELEMENTS_LIMITS.volumeSamplesPerInterval,stride:'at most one source voxel along the dominant transformed ray axis; exact-zero occupancy skipping',sourceResolutionReduced:false,optimized:!!optimizedVolume})},Object.getOwnPropertyDescriptors(metadata)));
 root.userData.elementsShader=exposedMetadata;
 let disposed=false;
 const sourceTransforms={fire:null,water:null},turnMatrix=new T.Matrix4(),placedMatrix=new T.Matrix4();
 function updateSourceTransforms(){
  // A recorded thin fire field is not a live evolving simulation. Keep its
  // authored orbit bounded so it never presents a 589-voxel edge-on slab.
  const angle=(uniforms.uProgress.value-.5)*.12+Math.sin(uniforms.uTime.value*.18)*.07;
  for(const kind of ['fire','water']){
   const source=sourceTransforms[kind];if(!source)continue;
   turnMatrix.makeRotationY(kind==='fire'?angle:-angle*.55);
   placedMatrix.multiplyMatrices(turnMatrix,source.matrix);
   uniforms[kind==='fire'?'uLocalToFire':'uLocalToWater'].value.copy(placedMatrix).invert();
  }
 }
 function update(progress=0,options={}){
  uniforms.uProgress.value=Number.isFinite(progress)?T.MathUtils.clamp(progress,0,1):0;
  const seconds=typeof options==='number'?options:options?.time;
  if(Number.isFinite(seconds))uniforms.uTime.value=seconds;
  else uniforms.uTime.value=uniforms.uProgress.value*2.4;
  const ph=uniforms.uProgress.value*1.8+uniforms.uTime.value*.28;
  const compositionHeight=sourceTransforms.water?Math.max(1.2,sourceTransforms.fire?.stagedHeight||0,sourceTransforms.water.stagedHeight):4.78;
  const heightScale=compositionHeight/4.78;
  uniforms.uCompositionHeight.value=compositionHeight;
  uniforms.uStoneSpacing.value=.49*heightScale;uniforms.uStoneBase.value=.29*heightScale;
  // Uniform rigid-transform staging avoids recomputing six trigonometric
  // functions for every candidate at every ray step. No per-frame allocation.
  for(let i=0;i<9;i++){
   const angle=i*.92+ph*.62+2.5+.26*Math.sin(i*3.7),radius=.49+.30*Math.sin(i*.91);
   stoneCenters[i].set(Math.cos(angle)*radius,(.29+i*.49+.075*Math.sin(i*2.1))*heightScale,Math.sin(angle)*radius);
   const hero=i===3||i===6?1.32:1.0;
   const scale=(.19+.075*Math.sin(i*2.4+1))*heightScale*hero;
   stoneSizes[i].set(scale*(1.12+.17*Math.sin(i)),scale*.86,scale);stoneBounds[i]=Math.max(stoneSizes[i].x,stoneSizes[i].y,stoneSizes[i].z)*1.365;
  }
  const topAngle=4.64*1.45+.18*Math.sin(4.64*2.1)+ph,topRadius=.27+.20*Math.sin(4.64*2.8+.2)+.08*Math.sin(4.64*6);
  uniforms.uWaterTip.value.set(Math.cos(topAngle)*topRadius,4.64,-Math.sin(topAngle)*topRadius);
  updateSourceTransforms();
 }
 function setSourceVolume(volume,kind,{occupancy}={}){
  if(disposed)throw new Error('ELEMENTS shader is disposed');
  if(volume?.kind!==kind)throw new Error(`Expected decoded ${kind} source volume`);
  if(kind==='fire'&&volume.nonzeroComponents===0)throw new Error('Captured native fire volume contains no optical signal');
  const fit=fitElementsVolume(volume),prefix=kind==='fire'?'uFire':'uWater';
  const occupancyTexture=kind==='fire'&&occupancy?createElementsOccupancyTexture(T,occupancy,volume):null;
  const texture=createElementsVolumeTexture(T,volume);
  const previous=uniforms[`${prefix}Volume`].value;
  uniforms[`${prefix}Volume`].value=texture;uniforms[kind==='fire'?'uHasFireVolume':'uHasWaterVolume'].value=1;
  const sourceDefine=kind==='fire'?'ELEMENTS_HAS_NATIVE_FIRE':'ELEMENTS_HAS_NATIVE_WATER';
  if(material.defines[sourceDefine]!==1){material.defines[sourceDefine]=1;material.needsUpdate=true;}
  uniforms[`${prefix}Minimum`].value.copy(fit.minimum);uniforms[`${prefix}Maximum`].value.copy(fit.maximum);
  uniforms[`${prefix}TextureScale`].value.fromArray(volume.textureScale);uniforms[`${prefix}TextureOffset`].value.fromArray(volume.textureOffset);
  if(kind==='fire'){
   uniforms.uFireMetric.value=1/fit.scale;uniforms.uFireSpacing.value.fromArray(volume.sampling.spacing);
   uniforms.uFireSampleOrigin.value.fromArray(volume.sampling.origin);
   const previousOccupancy=uniforms.uFireOccupancy.value;
   if(occupancy){
    uniforms.uFireOccupancy.value=occupancyTexture;uniforms.uHasFireOccupancy.value=1;
    uniforms.uFireOccupancyDimensions.value.fromArray(occupancy.dimensions);uniforms.uFireBlockSize.value.fromArray(occupancy.blockSize);
    texture.userData.occupancyTexture=occupancyTexture;
   }else{uniforms.uFireOccupancy.value=emptyOccupancy;uniforms.uHasFireOccupancy.value=0;}
   if(previousOccupancy!==emptyOccupancy)previousOccupancy.dispose();
  }else{
   uniforms.uWaterMetric.value=fit.scale;uniforms.uWaterVoxelSize.value=Math.min(...volume.sampling.spacing)*fit.scale;
  }
  sourceTransforms[kind]=fit;update(uniforms.uProgress.value,{time:uniforms.uTime.value});material.uniformsNeedUpdate=true;
  const top=Math.min(ELEMENTS_BOUNDS.max[1],uniforms.uCompositionHeight.value+.14);
  uniforms.uBoundsMaximum.value.y=top;
  const oldGeometry=geometry;
  geometry=new T.BoxGeometry(size.x,top-min.y,size.z);geometry.translate(center.x,(top+min.y)*.5,center.z);
  mesh.geometry=geometry;oldGeometry.dispose();
  sources[kind]={status:'source snapshot loaded',sha256:volume.sha256,dimensions:[...volume.dimensions],gpuBytes:volume.decodedBytes,uniformScale:fit.scale,sourceUpAxis:fit.sourceUpAxis,liveSimulation:false,source:volume.manifest.source,capture:volume.manifest.capture||null};
  if(previous!==emptyFire&&previous!==emptyWater)previous.dispose();
  return texture;
 }
 const setSourceFireVolume=(volume,options)=>setSourceVolume(volume,'fire',options),setSourceWaterVolume=volume=>setSourceVolume(volume,'water');
 function setEnvironment(texture,{intensity=1,rotation=null}={}){
  if(disposed)throw new Error('ELEMENTS shader is disposed');
  if(texture==null){uniforms.uHasStudioEnvironment.value=0;uniforms.uStudioEnvironment.value=emptyStage;return;}
  if(!texture.isTexture||texture.mapping!==T.CubeUVReflectionMapping)throw new TypeError('ELEMENTS requires the shared stage CubeUV PMREM texture');
  const width=texture.image?.width,height=texture.image?.height;
  if(!(width>=48&&height>=64&&Number.isFinite(width)&&Number.isFinite(height)))throw new Error('Invalid shared CubeUV atlas dimensions');
  if(!Number.isFinite(intensity)||intensity<0)throw new Error('Environment intensity must be finite and nonnegative');
  const angles=rotation?.isEuler?[rotation.x,rotation.y,rotation.z,rotation.order]:Array.isArray(rotation)?rotation:[0,0,0,'XYZ'];
  if(!angles.slice(0,3).every(Number.isFinite))throw new Error('Environment rotation must be finite');
  // Match Three's CubeUV environmentRotation convention, including its signs.
  environmentEuler.set(-angles[0],-angles[1],-angles[2],angles[3]||'XYZ');
  environmentMatrix.makeRotationFromEuler(environmentEuler);
  uniforms.uStudioEnvironmentRotation.value.setFromMatrix4(environmentMatrix);
  uniforms.uStudioEnvironment.value=texture;uniforms.uHasStudioEnvironment.value=1;
  uniforms.uStudioEnvironmentIntensity.value=intensity;uniforms.uStudioEnvironmentMaxMip.value=Math.log2(height/4);uniforms.uStudioEnvironmentTexel.value.set(1/width,1/height);
 }
 function setBackdrop(options){
  if(disposed)throw new Error('ELEMENTS shader is disposed');
  if(options==null){backdrop=null;uniforms.uHasBackdrop.value=0;uniforms.uBackdropColor.value=uniforms.uBackdropDepth.value=emptyStage;return;}
  const {texture,depthTexture,camera,receivers,valid=true,isValid}=options;
  if(!texture?.isTexture||!depthTexture?.isDepthTexture)throw new TypeError('Backdrop requires separate linear color and standard depth textures');
  if(texture===depthTexture)throw new Error('Backdrop color and depth must be distinct textures');
  if(camera&&!camera.isCamera)throw new TypeError('Backdrop camera must be the captured camera');
  if(isValid!=null&&typeof isValid!=='function')throw new TypeError('Backdrop validity callback must be a function');
  const roots=Array.isArray(receivers)?receivers:[receivers];
  if(!roots.length||roots.some(root=>!root?.isObject3D))throw new TypeError('Backdrop receivers must be actual room scene objects');
  backdrop={texture,depthTexture,camera,receivers:roots,valid,isValid};
  uniforms.uBackdropColor.value=texture;uniforms.uBackdropDepth.value=depthTexture;
 }
 function setRoomProbe(options){
  if(disposed)throw new Error('ELEMENTS shader is disposed');
  if(options==null){uniforms.uRoomProbe.value=null;uniforms.uHasRoomProbe.value=0;return;}
  const {texture,position,valid=true}=options;
  if(!texture?.isCubeTexture||!texture.isRenderTargetTexture||texture.mapping!==T.CubeReflectionMapping)throw new TypeError('Room probe requires the captured CubeCamera render-target texture');
  const coordinates=position?.isVector3?[position.x,position.y,position.z]:position;
  if(!Array.isArray(coordinates)||coordinates.length!==3||!coordinates.every(Number.isFinite))throw new TypeError('Room probe position must be the finite captured world position');
  uniforms.uRoomProbe.value=texture;uniforms.uRoomProbePosition.value.fromArray(coordinates);uniforms.uHasRoomProbe.value=valid?1:0;
 }
 function setLightWorld(position){if(position?.isVector3)keyWorld.copy(position);else if(Array.isArray(position)&&position.length===3&&position.every(Number.isFinite))keyWorld.fromArray(position);}
 function setDebugBudget(enabled){uniforms.uDebugBudget.value=enabled?1:0;}
 function setDebugMode(mode='beauty'){
  const modes=['beauty','fire-only','water-only','no-air','no-earth','earth-only','air-only','none','backdrop'];
  const compiled=typeof mode==='string'&&mode.endsWith('-compiled');
  const index=typeof mode==='number'?mode:modes.indexOf(compiled?mode.slice(0,-9):mode);
  if(!Number.isInteger(index)||index<0||index>=modes.length)throw new Error(`Unknown ELEMENTS debug mode: ${mode}`);
  uniforms.uDebugMode.value=index;
  // Diagnostic-only specialization proves whether dead component code/register
  // pressure matters. Beauty always returns to the full unspecialized shader.
  const previous=material.defines.ELEMENTS_COMPILED_ABLATION;
  if(compiled)material.defines.ELEMENTS_COMPILED_ABLATION=index;else delete material.defines.ELEMENTS_COMPILED_ABLATION;
  if(previous!==material.defines.ELEMENTS_COMPILED_ABLATION)material.needsUpdate=true;
 }
 function dispose(){if(disposed)return;disposed=true;geometry.dispose();material.dispose();for(const texture of new Set([emptyFire,emptyWater,emptyOccupancy,emptyStage,uniforms.uFireOccupancy.value,uniforms.uFireVolume.value,uniforms.uWaterVolume.value]))texture.dispose();backdrop=null;}
 update(0);return {root,update,dispose,metadata:exposedMetadata,setLightWorld,setEnvironment,setBackdrop,setRoomProbe,setSourceFireVolume,setSourceWaterVolume,setDebugBudget,setDebugMode};
}
