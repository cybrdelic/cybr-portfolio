import * as THREE from './vendor/three-r180/three.module.min.js';
import {BVHShaderGLSL} from './vendor/three-mesh-bvh-0.9.5/index.module.js';
const base='./assets/instrument-ray/';
async function read(item){
 const response=await fetch(base+item.file+'?v='+item.sha256);if(!response.ok)throw Error('Optics cache unavailable');
 const raw=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),length=new DataView(raw).getUint32(0,true),meta=JSON.parse(new TextDecoder().decode(new Uint8Array(raw,4,length))),start=4+Math.ceil(length/4)*4,result={};
 for(const [name,s] of Object.entries(meta)){
  const Type={Float32Array,Uint32Array,Int32Array,Uint16Array,Uint8Array,Int16Array,Int8Array}[s.dtype];if(!Type)throw Error('Unknown optical texture encoding');
  const texture=new THREE.DataTexture(new Type(raw,start+s.offset,s.length),s.width,s.height,s.format,s.type);texture.internalFormat=s.internalFormat;texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;result[name]=texture;
 }
 return result;
}
function dispose(data){Object.values(data).forEach(t=>t.dispose());}
const functions=`
${BVHShaderGLSL.common_functions}
${BVHShaderGLSL.bvh_struct_definitions}
${BVHShaderGLSL.bvh_ray_functions}
uniform BVH solidTree;uniform BVH waterTree;
uniform sampler2D solidNormals,solidLabels,waterNormals,opticalEnvironment;
uniform mat4 opticalInverse;uniform mat3 opticalEnvironmentRotation;
uniform bool containsWater;uniform float opticalIntensity;
varying vec3 opticalPosition;
vec3 radiance(vec3 d,float rough){
 d=normalize(opticalEnvironmentRotation*d);
 vec2 uv=vec2(atan(d.z,d.x)*.159154943091895+.5,asin(clamp(d.y,-1.,1.))*.318309886183791+.5);
 return textureLod(opticalEnvironment,uv,rough*7.).rgb*opticalIntensity;
}
bool opticalHit(vec3 ro,vec3 rd,out float distance,out vec3 n,out float side,out int mat){
 uvec4 fi=uvec4(0);vec3 fn=vec3(0),bary=vec3(0);float sd=1.,dist=1e20;
 bool found=bvhIntersectFirstHit(solidTree,ro,rd,fi,fn,bary,sd,dist);
 distance=dist;side=sd;mat=0;n=fn;
 if(found){n=normalize(textureSampleBarycoord(solidNormals,bary,fi.xyz).xyz);mat=int(texelFetch1D(solidLabels,fi.x).r+.5);}
 if(containsWater){
  uvec4 wi=uvec4(0);vec3 wn=vec3(0),wb=vec3(0);float ws=1.,wd=1e20;
  bool wet=bvhIntersectFirstHit(waterTree,ro,rd,wi,wn,wb,ws,wd);
  if(wet&&(!found||wd<distance)){found=true;distance=wd;side=ws;mat=7;n=normalize(textureSampleBarycoord(waterNormals,wb,wi.xyz).xyz);}
 }
 if(dot(n,rd)>0.)n=-n;return found;
}
vec3 opaqueRadiance(int mat,vec3 rd,vec3 n){
 vec3 spec=radiance(reflect(rd,n),mat==1?.16:.32);
 if(mat==4)return vec3(.55,.009,.02)*(.24+.76*radiance(n,.9))+.025*spec;
 if(mat==6)return vec3(.009);
 if(mat==2)return vec3(.05,.055,.06)*spec;
 if(mat==5)return vec3(.76,.61,.36)*spec;
 return vec3(.75,.77,.8)*spec;
}
vec3 opticalTrace(vec3 ro,vec3 rd){
 vec3 result=vec3(0),weight=vec3(1);float medium=1.;
 for(int bounce=0;bounce<12;bounce++){
  float distance,side;vec3 n;int mat;
  if(!opticalHit(ro,rd,distance,n,side,mat))return result+weight*vec3(1.3);
  vec3 hit=ro+rd*distance;
  if(mat!=3&&mat!=7)return result+weight*opaqueRadiance(mat,rd,n);
  float nextMedium=side>0.?(mat==3?1.52:1.333):1.;
  float eta=medium/nextMedium;vec3 transmitted=refract(rd,n,eta);
  if(medium>1.3&&medium<1.4)weight*=exp(-vec3(.0012,.00035,.00015)*distance);
  if(dot(transmitted,transmitted)<.001){rd=reflect(rd,n);ro=hit+rd*.025;continue;}
  float f0=pow((medium-nextMedium)/(medium+nextMedium),2.);
  float fresnel=f0+(1.-f0)*pow(1.-clamp(dot(-rd,n),0.,1.),5.);
  vec3 reflected=reflect(rd,n),reflectedLight=radiance(reflected,.045);
  float secondaryDistance,secondarySide;vec3 secondaryNormal;int secondaryMaterial;
  if(opticalHit(hit+reflected*.025,reflected,secondaryDistance,secondaryNormal,secondarySide,secondaryMaterial)&&secondaryMaterial!=3&&secondaryMaterial!=7)reflectedLight=opaqueRadiance(secondaryMaterial,reflected,secondaryNormal);
  vec3 reflectance=vec3(fresnel);
  if(!containsWater&&mat==3&&side>0.){
   // Three-band interference approximation for the optical coating only.
   // Smooth thickness variation is object-space, not a projected beauty map.
   float cosine=clamp(dot(-rd,n),0.,1.);
   float filmCos=sqrt(1.-(1.-cosine*cosine)/(1.38*1.38));
   float thickness=460.+95.*clamp(hit.z/47.,-1.,1.);
   vec3 phase=12.56637061436*1.38*thickness*filmCos/vec3(650.,510.,440.);
   vec3 interference=.5+.5*cos(phase);
   reflectance+= (1.-reflectance)*(.035+.20*interference);
  }
  result+=weight*reflectance*reflectedLight;weight*=1.-reflectance;
  medium=nextMedium;rd=transmitted;ro=hit+rd*.025;
 }
 return result;
}`;
export async function rayOptics(objects,environment,schedule){
 const manifest=await fetch(base+'manifest.json',{cache:'no-store'}).then(r=>r.json());if(!manifest.complete||manifest.frames.length!==72)throw Error('Incomplete optical bake');
 const [elements,light,water]=await Promise.all([read(manifest.static.elements),read(manifest.static.light),read(manifest.frames[0])]);
 const cache=new Map([[0,water]]),sets=[];let wanted=0,displayed=0,busy=false,failed=null;
 for(const [name,mesh] of Object.entries(objects)){
  const solid=name==='elements'?elements:light;
  const uniforms={solidTree:{value:solid},waterTree:{value:water},solidNormals:{value:solid.normal},solidLabels:{value:solid.material},waterNormals:{value:water.normal},opticalEnvironment:{value:environment},opticalInverse:{value:new THREE.Matrix4()},opticalEnvironmentRotation:{value:new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationZ(-195*Math.PI/180))},containsWater:{value:name==='elements'},opticalIntensity:{value:.72}};
  const material=new THREE.MeshBasicMaterial({side:THREE.FrontSide});
  material.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,uniforms);
   shader.vertexShader='varying vec3 opticalPosition;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n opticalPosition=position;');
   shader.fragmentShader=functions+'\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`vec3 localEye=(opticalInverse*vec4(cameraPosition,1.)).xyz;vec3 incident=normalize(opticalPosition-localEye);outgoingLight=opticalTrace(opticalPosition-incident*.04,incident);\n#include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=>`ray-optics-v1-${name}`;mesh.material=material;sets.push({mesh,uniforms});
 }
 async function update(){
  if(busy||wanted===displayed||failed)return;busy=true;
  try{while(wanted!==displayed){const i=wanted;let data=cache.get(i);if(!data){data=await read(manifest.frames[i]);cache.set(i,data);}if(i!==wanted){while(cache.size>3){const key=[...cache.keys()].find(k=>k!==displayed&&k!==wanted);if(key===undefined)break;dispose(cache.get(key));cache.delete(key);}continue;}
   for(const set of sets){set.uniforms.waterTree.value=data;set.uniforms.waterNormals.value=data.normal;}displayed=i;
   while(cache.size>3){const key=[...cache.keys()].find(k=>k!==displayed);dispose(cache.get(key));cache.delete(key);}schedule();
  }}catch(e){failed=e.message;console.error(e);}finally{busy=false;}
 }
 return {setProgress(p){wanted=Math.round(Math.max(0,Math.min(1,p))*71);void update();},prepare(){for(const {mesh,uniforms} of sets){mesh.updateWorldMatrix(true,false);uniforms.opticalInverse.value.copy(mesh.matrixWorld).invert();}},snapshot:()=>({frame:displayed,target:wanted,pending:busy,cachedFrames:cache.size,failed,transport:'actual local mesh intersections, 12 dielectric interfaces, one reflected opaque hit; not full global path tracing'})};
}
