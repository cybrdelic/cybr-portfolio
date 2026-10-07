import {createNativeHitGeometry,nativeHitGeometryGLSL} from './instrument-native-hit-geometry.mjs';
import {analyticOpticsGLSL,createNativeOpticalKernel,nativeDielectric} from './instrument-analytic-optics.mjs';
import {hitPbrGLSL,packHitPbrMaterialTable,bindHitPbrUniforms} from './instrument-hit-pbr.mjs';

const transmission=m=>(m?.userData?.cadTransmission??m?.transmission??0)>0;
const moduleName=o=>o.userData.meshRecord?.module??o.name.split('/')[0];
const vec=value=>value?.toArray?.()??Array.from(value??[0,0,0]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,s)=>a.map(v=>v*s);
const unit=a=>{const n=Math.hypot(...a);if(!n)throw Error('Zero transport direction');return mul(a,1/n);};
const transform=(m,p,w=1)=>[0,1,2].map(row=>p.reduce((s,v,k)=>s+v*m.elements[k*4+row],0)+w*m.elements[12+row]);
const sigma=m=>{const c=vec(m?.attenuationColor??[1,1,1]),d=m?.attenuationDistance;return c.map(v=>Number.isFinite(d)&&d>0?-Math.log(Math.max(v,1e-6))/d:0);};
const params=['n','v','roughness','diffuseColor','specularColor','specularF90','position','modelMatrix','viewMatrix','projMatrix','dispersion','ior','thickness','attenuationColor','attenuationDistance'];
const NATIVE_KERNEL_ITERATIONS=Object.freeze({cadNativeInterfaceCount:16,cadNativeSpanCount:40,cadNativeBubbleCount:18,cadNativeCubicIterations:24,cadNativeRawEventLimit:8192});
export function nativeKernelIterationUniforms(){return Object.fromEntries(Object.entries(NATIVE_KERNEL_ITERATIONS).map(([name,value])=>[name,Object.freeze({value})]));}

export function removeOpticalPrimaryShadowCalls(source,lightsChunk){
 if(source.includes('#include <lights_fragment_begin>'))source=source.replace('#include <lights_fragment_begin>',lightsChunk);
 let count=0;source=source.replace(/directLight\.color\s*\*=\s*\(\s*directLight\.visible\s*&&\s*receiveShadow\s*\)\s*\?\s*get(?:Point)?Shadow\([^;]+\)\s*:\s*1\.0\s*;/g,()=>{count++;return '// Authored optical primary materials have receiveShadow=false.';});
 if(count!==3)throw Error('Native optical primary shadow ABI changed');return source;
}

/** PMREM stores its roughness levels as tiles in one non-mipmapped atlas.
 * Sampling atlas LOD 0 preserves the existing tile interpolation and avoids
 * implicit derivatives that can force ANGLE to unroll the transport loop.
 */
export function explicitNativePmremGLSL(source,cubeUVChunk){
 if(source.includes('#include <cube_uv_reflection_fragment>'))source=source.replace('#include <cube_uv_reflection_fragment>',cubeUVChunk);
 const branch=/#ifdef texture2DGradEXT\s+return texture2DGradEXT\( envMap, uv, vec2\( 0\.0 \), vec2\( 0\.0 \) \)\.rgb;\s+#else\s+return texture2D\( envMap, uv \)\.rgb;\s+#endif/g;
 if([...source.matchAll(branch)].length!==1)throw Error('Native explicit PMREM sampling ABI changed');
 return source.replace(branch,'return textureLod( envMap, uv, 0.0 ).rgb;');
}

function exactShaderFunction(source,name){
 const pattern=new RegExp('\\b(?:float|vec2|vec3|vec4)\\s+'+name+'\\s*\\('),match=source.match(pattern);
 if(!match)throw Error('Minimal native helper ABI changed: '+name);
 const open=source.indexOf('{',match.index);let end=open+1,depth=1;
 for(;end<source.length&&depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
 if(depth)throw Error('Unbalanced minimal native helper: '+name);return source.slice(match.index,end);
}

/** Dedicated raw optical capture. Primary stock physical shading is retained
 * in the main material, but is absent from this transmission-only fragment.
 * Native hit PBR uses only four exact scalar/vector physical helper functions.
 */
export function minimalNativeCaptureGLSL(THREE,pars){
 const physical=THREE.ShaderChunk.lights_physical_pars_fragment;
 const helpers=['V_GGX_SmithCorrelated','D_GGX','DFGApprox','computeSpecularOcclusion'].map(name=>exactShaderFunction(physical,name)).join('\n');
 const stock=exactShaderFunction(THREE.ShaderChunk.transmission_pars_fragment,'getIBLVolumeRefraction');
 const signature=stock.slice(0,stock.indexOf('{'));
 const fragment=`
uniform mat4 projectionMatrix;uniform float ior,dispersion;
varying vec3 vViewPosition;varying vec3 vWorldPosition;
#include <common>
#include <envmap_common_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_physical_pars_fragment>
${helpers}
${signature}{return vec4(0.);}
void main(){
 vec3 viewDir=normalize(vViewPosition*(-projectionMatrix[2][3])+vec3(0.,0.,projectionMatrix[3][3]));
 vec3 worldView=inverseTransformDirection(viewDir,viewMatrix);
 vec4 rawTransport=getIBLVolumeRefraction(vec3(0),worldView,0.,vec3(0),vec3(0),0.,vWorldPosition,mat4(1),viewMatrix,projectionMatrix,dispersion,ior,0.,vec3(1),0.);
 #include <opaque_fragment>
}
`;
 return replaceNativeRefraction(explicitNativePmremGLSL(fragment,THREE.ShaderChunk.cube_uv_reflection_fragment),pars);
}

/** Preserve every authored iteration while preventing static HLSL unroll. */
export function uniformNativeKernelGLSL(source){
 const contracts=[['for(int i=0;i<40;i++)','for(int i=0;i<cadNativeSpanCount;i++)',1],['for(int span=0;span<40;span++)','for(int span=0;span<cadNativeSpanCount;span++)',1],['for(int i=0;i<18;i++)','for(int i=0;i<cadNativeBubbleCount;i++)',2],['for(int step=0;step<24;step++)','for(int step=0;step<cadNativeCubicIterations;step++)',2]];
 for(const[from,to,count]of contracts){if(source.split(from).length-1!==count)throw Error('Native compiler loop ABI changed: '+from);source=source.replaceAll(from,to);}return 'uniform int cadNativeSpanCount,cadNativeBubbleCount,cadNativeCubicIterations;\n'+hoistNativeKernelMembershipGLSL(source);
}

/** Keep the native CSG predicate at one call site. ANGLE otherwise inlines its
 * water inversion, bubbles and duct BVH at every rounded-box boundary patch.
 * Search distance and primitive identity form a cursor: rejecting a patch
 * cannot discard a coincident, valid patch belonging to another primitive.
 * 8,192 exceeds all 6,032 possible raw ELEMENTS roots, including every retained
 * duct triangle. The uniform bound prevents driver expansion of that budget.
 */
export function hoistNativeKernelMembershipGLSL(source){
 const membership=' // Normal-side membership avoids ray-angle-dependent slivers at tangencies.\n if(!cadNativeSolidContains(point-normal*.0005,module,solidId)||cadNativeSolidContains(point+normal*.0005,module,solidId))return;';
 if(!source.includes(membership)||source.split('bool nextOpticalEvent(').length!==2)throw Error('Native membership hoist ABI changed');
 source=source.replace(membership,` // Select raw legal patches first; complete CSG membership is evaluated once
 // in nextOpticalEvent, outside all primitive and rounded-patch call sites.
 if(distance==minimum&&primitiveId<=rejectedPrimitiveId)return;
 if(distance==best.distance&&best.solidId!=0&&primitiveId>=best.primitiveId)return;`);
 source=source.replaceAll('float minimum,inout CadOpticalHit best','float minimum,int rejectedPrimitiveId,inout CadOpticalHit best')
  .replaceAll('minimum,best)','minimum,rejectedPrimitiveId,best)')
  .replaceAll('minimum,hit)','minimum,rejectedPrimitiveId,hit)')
  .replace('bool nextOpticalEvent(vec3 ro,vec3 rd,int module,float minimum,float maximum,out CadOpticalHit hit)',
   'bool cadNativeRawEvent(vec3 ro,vec3 rd,int module,float minimum,float maximum,int rejectedPrimitiveId,out CadOpticalHit hit)');
 const duct='CadDuctHit duct;if(cadNativeRayBounds(ro,rd,cadNativeDuctMin,cadNativeDuctMax,minimum,hit.distance)&&cadDuctEvent(ro,rd,module,minimum,hit.distance,duct))';
 if(!source.includes(duct))throw Error('Native duct cursor ABI changed');
 source=source.replace(duct,`// Shared BVH accepts distance strictly above its minimum. Re-open a
  // coincident duct only after rejecting a different primitive at the cursor.
  float ductMinimum=rejectedPrimitiveId>=0&&rejectedPrimitiveId<400?uintBitsToFloat(floatBitsToUint(minimum)-1u):minimum;
  CadDuctHit duct;if(cadNativeRayBounds(ro,rd,cadNativeDuctMin,cadNativeDuctMax,ductMinimum,hit.distance)&&cadDuctEvent(ro,rd,module,ductMinimum,hit.distance,duct))`);
 const wrapper=`
bool nextOpticalEvent(vec3 ro,vec3 rd,int module,float minimum,float maximum,out CadOpticalHit hit){
 float cursor=minimum;int rejectedPrimitiveId=-1;
 for(int rejection=0;rejection<cadNativeRawEventLimit;rejection++){
  if(!cadNativeRawEvent(ro,rd,module,cursor,maximum,rejectedPrimitiveId,hit))return false;
  if(cadNativeSolidContains(hit.point-hit.normal*.0005,module,hit.solidId)&&!cadNativeSolidContains(hit.point+hit.normal*.0005,module,hit.solidId))return true;
  cursor=hit.distance;rejectedPrimitiveId=hit.primitiveId;
 }
 cadNativeRawBudgetExhausted=true;hit=CadOpticalHit(maximum,vec3(0),vec3(0),0,0,false);return false;
}
`;
 return 'uniform int cadNativeRawEventLimit;\nbool cadNativeRawBudgetExhausted=false;\n'+source.replace('bool cadNativeDielectric(',wrapper+'\nbool cadNativeDielectric(');
}

export function replaceNativeRefraction(source,pars){
 const found=[...source.matchAll(/\bvec4\s+getIBLVolumeRefraction\s*\(/g)];if(found.length!==1)throw Error('Native transport requires one expanded refraction function');
 const start=found[0].index,open=source.indexOf('{',start),signature=source.slice(start,open),names=signature.slice(signature.indexOf('(')+1,signature.lastIndexOf(')')).split(',').map(arg=>arg.trim().match(/\b(\w+)\s*$/)?.[1]);
 if(names.length!==params.length||names.some((name,i)=>name!==params[i]))throw Error('Native refraction ABI changed');
 let end=open+1,depth=1;for(;end<source.length&&depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}if(depth)throw Error('Unbalanced refraction function');
 const body=`${signature}{ vec3 direction=-normalize(v);vec3 origin=cadPrimaryOrigin(position,direction,cadPrimaryModule);vec3 result;bool exhausted=false;
 #ifdef USE_DISPERSION
 float spread=(ior-1.)*.025*dispersion;int channelCount=dispersion>0.?3:1;result=vec3(0.);for(int channel=0;channel<channelCount;channel++){if(channel>=3)break;float offset=channelCount>1?float(channel-1)*spread:0.;vec3 radiance=cadNativeTransport(origin,direction,offset);exhausted=exhausted||cadNativeRawBudgetExhausted;if(channelCount==1)result=radiance;else result[channel]=radiance[channel];}
 #else
 result=cadNativeTransport(origin,direction,0.);exhausted=cadNativeRawBudgetExhausted;
 #endif
 return vec4(result,exhausted?0.:1.); }`;
 return source.slice(0,start)+pars+'\n'+body+source.slice(end);
}

export function nativeTransportGLSL(){return`
uniform mat4 cadModuleWorld[2],cadModuleInverse[2];
uniform vec4 cadNativeMedia[4];uniform vec3 cadNativeSigma[4];
uniform int cadPrimaryModule,cadNativeInterfaceCount;uniform vec3 cadPaperRadiance;uniform vec2 cadOpticalSize;
uniform sampler2D cadNativeShadowMap;uniform mat4 cadNativeShadowMatrix;uniform vec2 cadNativeShadowSize;
uniform float cadNativeShadowBias,cadNativeShadowNormalBias,cadNativeShadowIntensity;uniform bool cadNativeHasShadow;
struct CadDuctHit{float distance;vec3 point;vec3 normal;};
bool cadDuctEvent(vec3 ro,vec3 rd,int module,float minimum,float maximum,out CadDuctHit hit){if(module!=1)return false;vec3 worldO=(cadModuleWorld[1]*vec4(ro,1)).xyz,worldD=(cadModuleWorld[1]*vec4(rd,0)).xyz;CadGeometryHit candidate;if(!cadQueryGeometry(worldO,worldD,minimum,maximum,1,candidate))return false;hit=CadDuctHit(candidate.distance,(cadModuleInverse[1]*vec4(candidate.point,1)).xyz,normalize(transpose(mat3(cadModuleWorld[1]))*candidate.normal));return true;}
bool cadDuctContains(vec3 point,int module){if(module!=1)return false;vec3 origin=(cadModuleWorld[1]*vec4(point,1)).xyz,direction=(cadModuleWorld[1]*vec4(0,1,0,0)).xyz;CadGeometryHit hit;if(!cadQueryGeometry(origin,direction,.0000001,100.,1,hit))return false;return dot(hit.geometricNormal,direction)<0.;}
float cadShadowCompare(vec2 uv,float depth){vec4 rgba=textureLod(cadNativeShadowMap,uv,0.);float unpacked=dot(rgba,vec4(255./256.,255./65536.,255./16777216.,1./16777216.));return step(depth,unpacked);}
float cadPbrKeyVisibility(vec3 position,vec3 normal){if(!cadNativeHasShadow)return 1.;vec4 projected=cadNativeShadowMatrix*vec4(position+normal*cadNativeShadowNormalBias,1.);vec3 coord=projected.xyz/projected.w;coord.z+=cadNativeShadowBias;if(any(lessThan(coord.xy,vec2(0)))||any(greaterThan(coord.xy,vec2(1)))||coord.z>1.)return 1.;vec2 texel=1./cadNativeShadowSize,f=fract(coord.xy*cadNativeShadowSize+.5),uv=coord.xy-f*texel;
 float shadow=(cadShadowCompare(uv,coord.z)+cadShadowCompare(uv+vec2(texel.x,0),coord.z)+cadShadowCompare(uv+vec2(0,texel.y),coord.z)+cadShadowCompare(uv+texel,coord.z)
 +mix(cadShadowCompare(uv+vec2(-texel.x,0),coord.z),cadShadowCompare(uv+vec2(2.*texel.x,0),coord.z),f.x)
 +mix(cadShadowCompare(uv+vec2(-texel.x,texel.y),coord.z),cadShadowCompare(uv+vec2(2.*texel.x,texel.y),coord.z),f.x)
 +mix(cadShadowCompare(uv+vec2(0,-texel.y),coord.z),cadShadowCompare(uv+vec2(0,2.*texel.y),coord.z),f.y)
 +mix(cadShadowCompare(uv+vec2(texel.x,-texel.y),coord.z),cadShadowCompare(uv+vec2(texel.x,2.*texel.y),coord.z),f.y)
 +mix(mix(cadShadowCompare(uv-texel,coord.z),cadShadowCompare(uv+vec2(2.*texel.x,-texel.y),coord.z),f.x),mix(cadShadowCompare(uv+vec2(-texel.x,2.*texel.y),coord.z),cadShadowCompare(uv+2.*texel,coord.z),f.x),f.y))/9.;return mix(1.,shadow,cadNativeShadowIntensity);}
`;}

export function nativeTransportPathGLSL(){return`
struct CadWorldOpticalHit{float distance;vec3 point;vec3 normal;int id;bool entering;};
bool cadWorldOpticalEvent(vec3 origin,vec3 direction,float maximum,out CadWorldOpticalHit result){bool found=false;for(int module=0;module<2;module++){vec3 ro=(cadModuleInverse[module]*vec4(origin,1)).xyz,rd=(cadModuleInverse[module]*vec4(direction,0)).xyz;CadOpticalHit localHit;if(nextOpticalEvent(ro,rd,module,.00025,maximum,localHit)){maximum=localHit.distance;found=true;result=CadWorldOpticalHit(localHit.distance,origin+direction*localHit.distance,normalize(transpose(mat3(cadModuleInverse[module]))*localHit.normal),module*2+localHit.solidId,localHit.entering);}}return found;}
vec3 cadPrimaryOrigin(vec3 position,vec3 direction,int module){vec3 p=(cadModuleInverse[module]*vec4(position,1)).xyz,d=(cadModuleInverse[module]*vec4(-direction,0)).xyz,halfSize=module==0?vec3(7.65,40.15,40.15):vec3(30.1,31.1,33.1);float distance=1e20;for(int axis=0;axis<3;axis++)if(abs(d[axis])>1e-10){float t=((d[axis]>0.?halfSize[axis]:-halfSize[axis])-p[axis])/d[axis];if(t>=0.)distance=min(distance,t);}if(distance>1e10)distance=0.;return position-direction*(distance+.01);}
// Trace only optical boundaries and opaque visibility. Actual hit PBR is
// evaluated once by the wrapper, after the variable interface loop returns.
vec3 cadNativeTrace(vec3 origin,vec3 direction,float glassIorOffset,out bool opaqueFound,out CadGeometryHit opaqueResult,out vec3 viewResult,out vec3 weightResult){
 opaqueFound=false;opaqueResult=CadGeometryHit(0.,vec3(0),vec3(0),vec3(0),vec3(0),vec3(0),uvec3(0),0u,0);viewResult=vec3(0);weightResult=vec3(0);
 cadNativeRawBudgetExhausted=false;int stack[4];int count=0;for(int module=0;module<2;module++){vec3 p=(cadModuleInverse[module]*vec4(origin,1)).xyz;if(cadNativeSolidContains(p,module,1))stack[count++]=module*2+1;if(module==1&&cadNativeSolidContains(p,module,2))stack[count++]=4;}vec3 weight=vec3(1.);
 for(int step=0;step<cadNativeInterfaceCount;step++){CadWorldOpticalHit optical;bool hasOptical=cadWorldOpticalEvent(origin,direction,1500.,optical);if(cadNativeRawBudgetExhausted)return vec3(0.);float limit=hasOptical?optical.distance:1500.;CadGeometryHit opaque;bool hasOpaque=cadQueryGeometry(origin,direction,.00025,limit,0,opaque);int current=count>0?stack[count-1]:0;vec3 absorption=current>0?cadNativeSigma[current-1]:vec3(0);if(hasOpaque){opaqueFound=true;opaqueResult=opaque;viewResult=-direction;weightResult=weight*exp(-absorption*opaque.distance);return vec3(0.);}if(!hasOptical)return count>0?vec3(0.):weight*cadPaperRadiance;weight*=exp(-absorption*optical.distance);
  int tentative[4];for(int i=0;i<4;i++)if(i<count)tentative[i]=stack[i];int next=count;if(optical.entering){if(next>=4)return vec3(0.);tentative[next++]=optical.id;}else{int index=-1;for(int i=0;i<4;i++)if(i<count&&tentative[i]==optical.id)index=i;if(index>=0){for(int i=0;i<3;i++)if(i>=index&&i+1<count)tentative[i]=tentative[i+1];next--;}}
  int target=next>0?tentative[next-1]:0;float nI=current>0?cadNativeMedia[current-1].x:1.,nT=target>0?cadNativeMedia[target-1].x:1.;if(current==1||current==3)nI+=glassIorOffset;if(target==1||target==3)nT+=glassIorOffset;vec3 normal=optical.entering?optical.normal:-optical.normal,outgoing;float fresnel;
  bool transmitted=cadNativeDielectric(direction,normal,nI,nT,outgoing,fresnel);if(transmitted){count=next;for(int i=0;i<4;i++)if(i<count)stack[i]=tentative[i];weight*=1.-fresnel;}
  direction=normalize(outgoing);origin=optical.point+direction*.001;int currentMediumId=count>0?stack[count-1]:0;if(currentMediumId>0)weight*=exp(-cadNativeSigma[currentMediumId-1]*.001);if(max(max(weight.r,weight.g),weight.b)<1e-6)return vec3(0.);
 }return vec3(0.);}
vec3 cadNativeTransport(vec3 origin,vec3 direction,float glassIorOffset){bool opaqueFound;CadGeometryHit opaque;vec3 view,weight;vec3 terminal=cadNativeTrace(origin,direction,glassIorOffset,opaqueFound,opaque,view,weight);if(opaqueFound)return weight*cadShadeOpaque(opaque,view);return terminal;}
`;}

function binaryDuct(THREE,buffer){const header=new Uint32Array(buffer,0,4);if(header[0]!==0x43594454||header[3]!==1||buffer.byteLength!==16+header[1]*24+header[2]*12)throw Error('Native duct asset layout changed');const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(buffer,16,header[1]*3).slice(),3));geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(buffer,16+header[1]*12,header[1]*3).slice(),3));geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer,16+header[1]*24,header[2]*3).slice(),1));return geometry;}

/** Opt-in native optical transport. The caller owns texture arrays and capture. */
export async function setupNativeGeometryTransport({THREE,scene,objects=[],cableMeshes=[],camera,size,paperColor,arrays,primitives,ductGeometry,bvhLibrary,yieldBuild,specializeCapture=false,triangleBoundaries=false}){
 if(!THREE||!scene||!camera||!arrays?.textures)throw Error('Invalid native transport setup');
 const base=new URL('./assets/instrument-optical-primitives-v1/',import.meta.url);if(!primitives){const response=await fetch(new URL('primitives.json',base));if(!response.ok)throw Error('Native primitive asset unavailable');primitives=await response.json();}
 const ownsDuct=!ductGeometry;if(!ductGeometry){const response=await fetch(new URL('native-water-cable-boundary.bin',base));if(!response.ok)throw Error('Native duct asset unavailable');ductGeometry=binaryDuct(THREE,await response.arrayBuffer());}
 const selected=objects.filter(object=>transmission(object.material)&&['light','elements'].includes(moduleName(object))),anchors=['light','elements'].map(name=>selected.find(object=>moduleName(object)===name&&object.material.ior>=1.4));if(anchors.some(anchor=>!anchor))throw Error('Native transport requires both authored optical modules');
 const water=selected.find(object=>moduleName(object)==='elements'&&(object.userData.staticWater||object.material.ior<1.4));if(!water)throw Error('Native water material missing');
 const ductObject=new THREE.Mesh(ductGeometry);ductObject.name='native water duct boundary';ductObject.matrixAutoUpdate=false;scene.updateMatrixWorld(true);ductObject.matrixWorld.copy(anchors[1].matrixWorld);
 const opticalObjects=triangleBoundaries?selected.map(object=>({object,classTag:2+(moduleName(object)==='light'?1:object===water?4:3)})):[];
 let atlas,table;try{atlas=await createNativeHitGeometry({THREE,scene,objects,cableMeshes,ductObject,opticalObjects,bvhLibrary,yieldBuild});table=packHitPbrMaterialTable({THREE,materials:atlas.materials,layerLookup:arrays.layerLookup,wearLayerLookup:arrays.wearLayerLookup,diffuseIBLScale:.3,sourceFinish:false});}catch(error){atlas?.dispose();if(ownsDuct)ductGeometry.dispose();throw error;}
 const world=[new THREE.Matrix4(),new THREE.Matrix4()],inverse=[new THREE.Matrix4(),new THREE.Matrix4()],paper=new THREE.Vector3(...vec(paperColor)),shaders=[],mediaMaterials=[anchors[0].material,null,anchors[1].material,water.material],media=mediaMaterials.map(m=>({ior:m?.ior??1,sigma:sigma(m)}));
 const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;const shadowMap={value:white},shadowMatrix={value:new THREE.Matrix4()},shadowSize={value:new THREE.Vector2(1,1)},shadowBias={value:0},shadowNormalBias={value:0},shadowIntensity={value:1},hasShadow={value:false};
 let key,fill,disposed=false,boundShaders=0;const lightDirections=[new THREE.Vector3(),new THREE.Vector3()],lightColors=[new THREE.Vector3(),new THREE.Vector3()];
 const kernel=createNativeOpticalKernel(primitives,{ductBoundary:{triangleCount:ductGeometry.index.count/3,contains(point){const ro=transform(world[1],point),rd=transform(world[1],[0,1,0],0),hit=atlas.intersectRay(ro,rd,{classFilter:1,minDistance:1e-7,maxDistance:100});return!!hit&&dot(hit.geometricNormal,rd)<0;},intersections(ro,rd,min,max){const hit=atlas.intersectRay(transform(world[1],ro),transform(world[1],rd,0),{classFilter:1,minDistance:min,maxDistance:max});return hit?[{...hit,point:transform(inverse[1],hit.point),normal:unit(transform(inverse[1],hit.normal,0)),primitiveId:400}]:[];}}});
 function update(cam=camera){if(disposed)return;scene.updateMatrixWorld(true);cam.updateMatrixWorld(true);for(let i=0;i<2;i++){world[i].copy(anchors[i].matrixWorld);inverse[i].copy(world[i]).invert();}ductObject.matrixWorld.copy(world[1]);atlas.update();const directionals=[];scene.traverse(object=>{if(object.isDirectionalLight&&object.visible)directionals.push(object);});directionals.sort((a,b)=>b.intensity-a.intensity);key=directionals.find(light=>light.castShadow)??directionals[0];fill=directionals.find(light=>light!==key);
  for(let i=0;i<2;i++){const light=i?fill:key;if(light){light.target.updateMatrixWorld(true);lightDirections[i].setFromMatrixPosition(light.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(light.target.matrixWorld)).normalize();lightColors[i].set(light.color.r,light.color.g,light.color.b).multiplyScalar(light.intensity);}else{lightDirections[i].set(0,0,1);lightColors[i].set(0,0,0);}}
  const shadow=key?.shadow,map=shadow?.map?.texture;hasShadow.value=!!map;shadowMap.value=map??white;if(shadow){shadowMatrix.value.copy(shadow.matrix);shadowSize.value.copy(shadow.mapSize);shadowBias.value=shadow.bias;shadowNormalBias.value=shadow.normalBias;shadowIntensity.value=shadow.intensity??1;}
  for(const shader of shaders){shader.uniforms.cadPbrKeyDirection.value.copy(lightDirections[0]);shader.uniforms.cadPbrFillDirection.value.copy(lightDirections[1]);shader.uniforms.cadPbrKeyColor.value.copy(lightColors[0]);shader.uniforms.cadPbrFillColor.value.copy(lightColors[1]);}
 }
 update();
 const pars=nativeHitGeometryGLSL(atlas)+nativeTransportGLSL()+uniformNativeKernelGLSL(analyticOpticsGLSL(primitives))+hitPbrGLSL+nativeTransportPathGLSL();
 function bindShader(shader,material,module){const name=typeof module==='string'?module:module?.name;if(!['light','elements'].includes(name)||!transmission(material))return false;if(shader.fragmentShader.includes('#include <transmission_pars_fragment>'))shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_pars_fragment>',THREE.ShaderChunk.transmission_pars_fragment);
  if(specializeCapture&&!shader.defines?.CAD_TRANSPORT_CAPTURE){shader.uniforms.cadOpticalSize=size?.value!==undefined?size:{value:size};shader.fragmentShader=removeOpticalPrimaryShadowCalls(shader.fragmentShader,THREE.ShaderChunk.lights_fragment_begin);boundShaders++;return true;}
  bindHitPbrUniforms(shader,{THREE,arrays,materialTable:table,keyDirection:lightDirections[0].toArray(),keyColor:lightColors[0].toArray(),fillDirection:lightDirections[1].toArray(),fillColor:lightColors[1].toArray(),footprintMM:.1});Object.assign(shader.uniforms,atlas.uniforms,{cadModuleWorld:{value:world},cadModuleInverse:{value:inverse},cadNativeMedia:{value:media.map(m=>new THREE.Vector4(m.ior,0,0,0))},cadNativeSigma:{value:media.map(m=>new THREE.Vector3(...m.sigma))},cadPrimaryModule:{value:name==='light'?0:1},...nativeKernelIterationUniforms(),cadPaperRadiance:{value:paper},cadOpticalSize:size?.value!==undefined?size:{value:size},cadNativeShadowMap:shadowMap,cadNativeShadowMatrix:shadowMatrix,cadNativeShadowSize:shadowSize,cadNativeShadowBias:shadowBias,cadNativeShadowNormalBias:shadowNormalBias,cadNativeShadowIntensity:shadowIntensity,cadNativeHasShadow:hasShadow});shader.fragmentShader=specializeCapture&&shader.defines?.CAD_TRANSPORT_CAPTURE?minimalNativeCaptureGLSL(THREE,pars):replaceNativeRefraction(removeOpticalPrimaryShadowCalls(explicitNativePmremGLSL(shader.fragmentShader,THREE.ShaderChunk.cube_uv_reflection_fragment),THREE.ShaderChunk.lights_fragment_begin),pars);shaders.push(shader);boundShaders++;return true;
 }
 function traceRay(module,origin,direction){return traceNativeGeometryRay({kernel,atlas,world,inverse,media,origin,direction});}
 function snapshot(){return{ready:!disposed,backend:'native optical CSG + indexed opaque CAD BVH radiance',modules:['light','elements'],opaqueVisibility:'actual nearest opaque geometry before every optical interface; no foreground HDR lookup',boundaryKernel:kernel.snapshot(),geometry:atlas.snapshot(),materialCount:atlas.materials.length,secondaryPbr:arrays.snapshot?.(),textureSamplers:specializeCapture?{capture:15,main:2}:16,specializeCapture,triangleBoundaries,boundShaders,interfaceLimit:16,rawEventLimit:8192,secondaryShadingCompilation:'actual opaque-hit PBR once after interface trace',rawEventBudgetDiagnostic:'exhaustion returns black RGB with capture alpha 0; never paper fallback',membershipCompilation:'raw primitive events first; complete CSG at one validation site; coincident primitive cursor',mediumCapacity:4,fresnel:'once at every transmitted interface; TIR followed; reflected branches not recursively split',primaryOrigin:'visible native surface backed outside its module bound',nativeKeyShadow:hasShadow.value,limitations:['duct tessellation measured native-reference error up to 0.068 mm','secondary cable braid modulation and coating lobes are not reconstructed','SCENES optical boundaries retain raster thickness approximation'],disposed};}
 function dispose(){if(disposed)return;disposed=true;atlas.dispose();table.dispose();white.dispose();if(ownsDuct)ductGeometry.dispose();shaders.length=0;}
 return{bindShader,update,intersectRay:atlas.intersectRay,traceRay,snapshot,dispose,materials:atlas.materials};
}

export function traceNativeGeometryRay({kernel,atlas,world,inverse,media,origin,direction,maxInterfaces=16,maxDistance=10000}){
 let ro=Array.from(origin),rd=unit(direction),weight=[1,1,1],stack=[],events=[],distance=0;
 for(let module=0;module<2;module++){const p=transform(inverse[module],ro);if(kernel.contains(p,module,1))stack.push(module*2+1);if(module===1&&kernel.contains(p,module,2))stack.push(4);}
 for(let step=0;step<maxInterfaces;step++){let next=null;for(let module=0;module<2;module++){const localO=transform(inverse[module],ro),rawD=transform(inverse[module],rd,0),scale=Math.hypot(...rawD),hit=kernel.nextOpticalEvent(localO,unit(rawD),{module,minDistance:.00025*scale,maxDistance:(next?.distance??maxDistance)*scale});if(hit){const d=hit.distance/scale;next={...hit,distance:d,point:add(ro,mul(rd,d)),normal:unit(transform(world[module],hit.normal,0)),id:module*2+hit.solidId,module};}}
  const opaque=atlas.intersectRay(ro,rd,{minDistance:.00025,maxDistance:next?.distance??maxDistance}),current=stack.at(-1)??0,active=media[current-1]??{ior:1,sigma:[0,0,0]},segment=opaque?.distance??next?.distance;
  if(segment!==undefined){weight=weight.map((v,i)=>v*Math.exp(-active.sigma[i]*segment));distance+=segment;}if(opaque)return{opaqueHit:opaque,point:opaque.point,direction:rd,weight,events,distance,exhausted:false};if(!next)return{opaqueHit:null,point:ro,direction:rd,weight,events,distance,exhausted:stack.length>0};
  const candidate=stack.slice();if(next.entering)candidate.push(next.id);else{const index=candidate.lastIndexOf(next.id);if(index>=0)candidate.splice(index,1);}const target=candidate.at(-1)??0,optics=nativeDielectric(rd,next.entering?next.normal:mul(next.normal,-1),active.ior,media[target-1]?.ior??1);events.push({...next,iorI:active.ior,iorT:media[target-1]?.ior??1,fresnel:optics.fresnel,tir:optics.tir});if(!optics.tir){stack=candidate;weight=weight.map(v=>v*(1-optics.fresnel));}rd=optics.direction;ro=add(next.point,mul(rd,.001));const absorption=media[(stack.at(-1)??0)-1]?.sigma??[0,0,0];weight=weight.map((v,i)=>v*Math.exp(-absorption[i]*.001));
 }return{opaqueHit:null,point:ro,direction:rd,weight,events,distance,exhausted:true};
}
