import * as THREE from './vendor/three-r180/three.module.min.js';
import {probeGpuSession} from '../cybr-light/browser/gpu-session.mjs';
import {instancedShader} from '../cybr-light/browser/instanced-shader.mjs';
import {updateScene} from './instrument-trace-scene.mjs';
import {createEnvironmentDistribution,environmentSamplingWGSL} from './instrument-trace-environment.mjs';
import {accumulationShader,TEMPORAL_UNIFORM_BYTES} from './instrument-temporal.mjs';
import {createAdaptiveQuality} from './instrument-adaptive.mjs';
import {capturePreviousMatrices,packTemporalMotions} from './instrument-trace-motion.mjs';
import {optimizeInstrumentTraversal} from './instrument-traversal.mjs';

// CYBR LIGHT's RGB transport is shared with its browser laboratory. The
// instrument supplies its real CAD templates and constrained live transforms.
const SCALE=.005,MAX_SAMPLES=128,BOUNCES=10,UNIFORM_BYTES=352;
const shaderURL=name=>new URL(`../cybr-light/browser/${name}`,import.meta.url);
const uniformStruct='struct Uniforms { size:vec4u, eye:vec4f, right:vec4f, up:vec4f, forward:vec4f, previousEye:vec4f, previousRight:vec4f, previousUp:vec4f, previousForward:vec4f, flags:vec4f, inverseProjection:mat4x4f, cameraWorld:mat4x4f, environmentX:vec4f, environmentY:vec4f, environmentZ:vec4f, settings:vec4f }';

function checkedReplace(source,search,replacement){
  if(!source.includes(search))throw new Error(`CYBR LIGHT shader contract changed: ${search.slice(0,65)}`);
  return source.replace(search,replacement);
}

export function instrumentTraceShader(source,traversal,{optimizeTraversal=true,cacheDistances=false}={}){
  let text=instancedShader(source.replaceAll('\r\n','\n'),optimizeTraversal?optimizeInstrumentTraversal(traversal,{cacheDistances}):traversal.replaceAll('\r\n','\n'));
  text=checkedReplace(text,text.slice(0,text.indexOf('\n')),uniformStruct);
  text=checkedReplace(text,'secondaryNormal:vec4f }','secondaryNormal:vec4f,reflection:vec4f,reflectionNormal:vec4f }');
  text=checkedReplace(text,'u.size.z*6271u','u32(u.settings.w)*6271u');
  text=text.replace('@group(0) @binding(7) var<storage,read> lighting:Lighting;','@group(0) @binding(7) var<storage,read> lighting:Lighting;\n@group(0) @binding(8) var environmentTexture:texture_2d<f32>;');
  const envStart=text.indexOf('fn environment(d:vec3f)'),envEnd=text.indexOf('fn basis(',envStart);
  if(envStart<0||envEnd<0)throw new Error('CYBR LIGHT environment contract changed.');
  text=text.slice(0,envStart)+`fn environment(d:vec3f)->vec3f{
    let q=normalize(vec3f(dot(u.environmentX.xyz,d),dot(u.environmentY.xyz,d),dot(u.environmentZ.xyz,d)));
    let uv=vec2f(atan2(q.z,q.x)/(2.*PI)+.5,asin(clamp(q.y,-1.,1.))/PI+.5);
    let size=vec2i(textureDimensions(environmentTexture));let p=uv*vec2f(size)-.5;let cell=vec2i(floor(p));let t=fract(p);
    let x0=((cell.x%size.x)+size.x)%size.x;let x1=(x0+1)%size.x;let y0=clamp(cell.y,0,size.y-1);let y1=clamp(cell.y+1,0,size.y-1);
    return mix(mix(textureLoad(environmentTexture,vec2i(x0,y0),0).rgb,textureLoad(environmentTexture,vec2i(x1,y0),0).rgb,t.x),mix(textureLoad(environmentTexture,vec2i(x0,y1),0).rgb,textureLoad(environmentTexture,vec2i(x1,y1),0).rgb,t.x),t.y)*u.settings.x;
  }
  `+text.slice(envEnd);
  // The original HDR is sampled by luminance and exact cell solid angle.
  // A full-sphere component keeps directions with zero quantized CDF mass.
  const pdfStart=text.indexOf('fn environmentPDF('),pdfEnd=text.indexOf('fn sourceLightPDF(',pdfStart);
  if(pdfStart<0||pdfEnd<0)throw new Error('CYBR LIGHT environment sampling contract changed.');
  text=text.slice(0,pdfStart)+environmentSamplingWGSL+text.slice(pdfEnd);
  // info.x disables the laboratory's floor/lamp. With no source area lights,
  // the ordinary NEE branch must still sample the real HDR environment.
  text=checkedReplace(text,'if(lighting.info.x>.5){\n    let count=u32(lighting.info.y);','if(lighting.info.x>.5&&lighting.info.y>0.){\n    let count=u32(lighting.info.y);');
  // Imported part finish affects authored albedo and roughness. Geometric
  // visibility is traced, so the old raster AO attribute is never consulted.
  const oldMaterial='return materials[u32(triangles[h.id].p.w)];';
  text=checkedReplace(text,oldMaterial,'var m=materials[u32(triangles[h.id].p.w)];let a=attributes[h.id];m.base.w*=a.c0.w*(1.-h.bary.x-h.bary.y)+a.c1.w*h.bary.x+a.c2.w*h.bary.y;return m;');
  const camStart=text.indexOf('fn camera(xy:vec2f)'),camEnd=text.indexOf('@compute',camStart);
  if(camStart<0||camEnd<0)throw new Error('CYBR LIGHT camera contract changed.');
  text=text.slice(0,camStart)+`struct PrimaryRay { origin:vec3f,direction:vec3f }
  fn primaryRay(xy:vec2f)->PrimaryRay{
    let ndc=vec2f(xy.x/f32(u.size.x)*2.-1.,1.-xy.y/f32(u.size.y)*2.);
    let a=u.inverseProjection*vec4f(ndc,-1.,1.);let b=u.inverseProjection*vec4f(ndc,1.,1.);
    let nearPoint=u.cameraWorld*vec4f(a.xyz/a.w,1.);let farPoint=u.cameraWorld*vec4f(b.xyz/b.w,1.);
    return PrimaryRay(nearPoint.xyz*u.settings.y,normalize(farPoint.xyz-nearPoint.xyz));
  }
  `+text.slice(camEnd);
  text=checkedReplace(text,'let pathDirection=camera(vec2f(gid.xy)+vec2f(random(&seed),random(&seed)));','let pathRay=primaryRay(vec2f(gid.xy)+vec2f(random(&seed),random(&seed)));let pathDirection=pathRay.direction;');
  text=checkedReplace(text,'let guideDirection=select(camera(vec2f(gid.xy)+.5),pathDirection,u.previousEye.w>.5);let guide=trace(u.eye.xyz,guideDirection,1e20,false);','let guideDirection=pathDirection;let guideOrigin=pathRay.origin;let guide=trace(guideOrigin,guideDirection,1e20,false);var stableGuide=guide;var stableOrigin=guideOrigin;var stableDirection=guideDirection;if(u.size.z==0u){let centerRay=primaryRay(vec2f(gid.xy)+.5);stableOrigin=centerRay.origin;stableDirection=centerRay.direction;stableGuide=trace(stableOrigin,stableDirection,1e20,false);}');
  text=checkedReplace(text,'if(guide.id!=-1){let m=material(guide);var surface=-2.;if(guide.id>=0){surface=f32(instanceIdentity(guide))+3.;}guidePos=vec4f(u.eye.xyz+guideDirection*guide.t,surface);guideNormal=vec4f(normal(guide),select(m.base.w,0.,m.physical.y>.5));}',`if(u.size.z>0u){guidePos=samples[index].position;guideNormal=samples[index].normal;}else if(stableGuide.id!=-1){let m=material(stableGuide);var surface=-2.;if(stableGuide.id>=0){surface=f32(instanceIdentity(stableGuide))+3.;}guidePos=vec4f(stableOrigin+stableDirection*stableGuide.t,surface);guideNormal=vec4f(normal(stableGuide),select(m.base.w,0.,m.physical.y>.5));}`);
  text=checkedReplace(text,'var origin=u.eye.xyz;var direction=pathDirection;','if(guide.id==-1){samples[index]=Pixel(vec4f(0),guidePos,guideNormal,vec4f(0),vec4f(0,0,0,-1),vec4f(0));return;}\n var origin=pathRay.origin;var direction=pathDirection;var cameraBackdrop=true;');
  text=checkedReplace(text,'if(stableReflection&&guide.id>=0){\n  let gm=material(guide);','if(stableReflection&&stableGuide.id>=0&&u.size.z==0u){\n  let gm=material(stableGuide);');
  text=checkedReplace(text,'var gn=geometric(guide);if(dot(gn,guideDirection)>0.){gn=-gn;}\n   var n=normal(guide);','var gn=geometric(stableGuide);if(dot(gn,stableDirection)>0.){gn=-gn;}\n   var n=normal(stableGuide);');
  text=checkedReplace(text,'var reflected=reflect(guideDirection,n);if(dot(reflected,gn)<=0.){reflected=reflect(guideDirection,gn);}','var reflected=reflect(stableDirection,n);if(dot(reflected,gn)<=0.){reflected=reflect(stableDirection,gn);}');
  text=checkedReplace(text,'var go=u.eye.xyz;var gd=guideDirection;','var go=stableOrigin;var gd=stableDirection;');
  text=checkedReplace(text,'var hit=guide;if(depth>0u){hit=trace(go,gd,1e20,false);}','var hit=stableGuide;if(depth>0u){hit=trace(go,gd,1e20,false);}');
  text=checkedReplace(text,'secondaryNormal=vec4f(n,1);break;','secondaryNormal=vec4f(n,m.base.w);break;');
  // Stable reflected and transmitted guides are independent of the random
  // transport sample. Sky guides retain their direction, including through
  // nested water/glass; both are checked when accepting temporal history.
  text=checkedReplace(text,'if(gm.physical.x>.99&&gm.physical.y<.5&&gm.base.w<.3){','if((gm.physical.x>.1&&gm.base.w<.3)||gm.physical.y>.5){');
  text=checkedReplace(text,'reflectionDistance=min(min(rh.t,lightHit(start,reflected)),50.);reflectionGuide=1.;',`reflection=vec4f(reflected,-1.);reflectionNormal=vec4f(0,0,0,gm.base.w);if(rh.id>=0){reflection=vec4f(start+reflected*rh.t,f32(instanceIdentity(rh))+3.);reflectionNormal=vec4f(normal(rh),material(rh).base.w);}reflectionDistance=min(rh.t,50.);reflectionGuide=1.;`);
  text=checkedReplace(text,'var trackReflection=false;var reflectionDistance=0.;var reflectionGuide=0.;','var reflection=vec4f(0,0,0,-2);var reflectionNormal=vec4f(0);var trackReflection=false;var reflectionDistance=0.;var reflectionGuide=0.;');
  text=checkedReplace(text,'if(hit.id==-1){break;}','if(hit.id==-1){secondary=vec4f(gd,-1.);break;}');
  text=checkedReplace(text,'for(var depth=0u;depth<min(u.size.w,16u);depth++){','for(var depth=0u;depth<16u;depth++){');
  text=checkedReplace(text,'if(dot(rd,rd)<.01){break;}','if(dot(rd,rd)<.01){gd=normalize(reflect(gd,geometricNormal));go=point+geometricNormal*.0001;continue;}');
  text=checkedReplace(text,'var startDepth=0u;',`if(u.size.z>0u){secondary=samples[index].secondary;secondaryNormal=samples[index].secondaryNormal;reflection=samples[index].reflection;reflectionNormal=samples[index].reflectionNormal;}
 var startDepth=0u;`);
  text=checkedReplace(text,'samples[index]=Pixel(vec4f(0),guidePos,guideNormal,vec4f(0),vec4f(0,0,0,-1),vec4f(0));','samples[index]=Pixel(vec4f(0),guidePos,guideNormal,vec4f(0),vec4f(0,0,0,-1),vec4f(0),vec4f(0,0,0,-2),vec4f(0));');
  text=checkedReplace(text,'vec4f(luminance,luminance*luminance,reflectionDistance,reflectionGuide),secondary,secondaryNormal);','vec4f(luminance,luminance*luminance,select(encodeDirection(stableDirection),samples[index].moments.zw,u.size.z>0u)),secondary,secondaryNormal,reflection,reflectionNormal);');
  const guideDirectionFunction=`fn encodeDirection(direction:vec3f)->vec2f{let d=direction/(abs(direction.x)+abs(direction.y)+abs(direction.z));if(d.z>=0.){return d.xy;}return (1.-abs(d.yx))*select(vec2f(-1),vec2f(1),d.xy>=vec2f(0));}\n`;
  text=text.replace('struct PrimaryRay',guideDirectionFunction+'struct PrimaryRay');
  // Inverse ACES + exposure preserves the visible CSS paper after display.
  // This is a visible backdrop; actual indirect/reflected lighting stays HDR.
  text=checkedReplace(text,'radiance+=throughput*environment(direction)*weight;break;','radiance+=throughput*select(environment(direction),vec3f(1.766763272,1.766763272,1.557227765),cameraBackdrop&&delta)*weight;break;');
  text=checkedReplace(text,'direction=reflectedDirection;transmissionChain=false;','direction=reflectedDirection;transmissionChain=false;cameraBackdrop=false;');
  text=checkedReplace(text,'// Ideal directional daylight. Delta source: no BSDF-hit MIS term.','cameraBackdrop=false;\n   // Ideal directional daylight. Delta source: no BSDF-hit MIS term.');
  text=checkedReplace(text,'pending=false;origin=pendingOrigin;','pending=false;cameraBackdrop=false;origin=pendingOrigin;');
  return text;
}

// Spatial reconstruction follows validated temporal accumulation.
export const filterShader=`
struct Pixel {color:vec4f,position:vec4f,normal:vec4f,moments:vec4f,secondary:vec4f,secondaryNormal:vec4f,reflection:vec4f,reflectionNormal:vec4f}
struct Accumulator {radiance:vec4f,moments:vec4f}
@group(0) @binding(0) var<uniform> config:vec4u;
@group(0) @binding(1) var<storage,read> guide:array<Pixel>;
@group(0) @binding(2) var<storage,read> history:array<Accumulator>;
@group(0) @binding(3) var<storage,read> input:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> output:array<vec4f>;
fn luminance(c:vec3f)->f32{return dot(c,vec3f(.2126,.7152,.0722));}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=config.xy)){return;}let i=gid.y*config.x+gid.x;let center=guide[i];let value=input[i];let alpha=history[i].radiance.w;
 let optical=center.normal.w<.06;let transmitted=optical&&center.secondary.w>=0.;let contentRoughness=select(center.normal.w,center.secondaryNormal.w,transmitted);let roughTransmission=transmitted&&contentRoughness>=.15;let glossy=contentRoughness<.3&&!roughTransmission;let step=max(1u,config.w);
 if(center.position.w<0.||alpha<.999||(optical&&!transmitted&&step>1u)||(glossy&&step>2u)){output[i]=value;return;}
 let radius=select(2,1,glossy);var sum=vec3f(0);var total=0.;var variance=0.;
 // A low temporal estimate is not evidence that an isolated dark sample
 // under several optical interfaces is a sharp material boundary. Obtain a
 // bounded uncertainty floor from covered pixels on the SAME refracted
 // surface. Only the first pass reads raw colours for this estimate.
 var spatialVariance=0.;
 if(roughTransmission&&step==1u){
  var first=0.;var second=0.;var count=0.;
  for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
   let p=vec2i(gid.xy)+vec2i(x,y);if(any(p<vec2i(0))||any(p>=vec2i(config.xy))){continue;}
   let j=u32(p.y)*config.x+u32(p.x);let other=guide[j];
   if(abs(center.position.w-other.position.w)>.1||history[j].radiance.w<.999||abs(center.secondary.w-other.secondary.w)>.1){continue;}
   if(dot(center.normal.xyz,other.normal.xyz)<.995||dot(center.secondaryNormal.xyz,other.secondaryNormal.xyz)<.95){continue;}
   let delta=other.secondary.xyz-center.secondary.xyz;
   if(max(abs(dot(delta,center.secondaryNormal.xyz)),abs(dot(delta,other.secondaryNormal.xyz)))>max(.0005,length(delta)*.025)){continue;}
   let l=luminance(input[j].rgb);first+=l;second+=l*l;count+=1.;
  }}if(count>2.){let mean=first/count;spatialVariance=max(0.,second/count-mean*mean)/min(16.,f32(config.z+1u));}
 }
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
  if(abs(x)>radius||abs(y)>radius){continue;}
  let p=vec2i(gid.xy)+vec2i(x,y)*i32(step);if(any(p<vec2i(0))||any(p>=vec2i(config.xy))){continue;}let j=u32(p.y)*config.x+u32(p.x);let other=guide[j];
  if(abs(center.position.w-other.position.w)>.1||history[j].radiance.w<.999){continue;}
  // A glass surface's primary normal cannot locate the opaque scene seen
  // through it. Restrict support to matching native transmission guides.
  if(optical){
   if(abs(center.secondary.w-other.secondary.w)>.1){continue;}
   if(center.secondary.w>=0.){
    if(dot(center.secondaryNormal.xyz,other.secondaryNormal.xyz)<.95){continue;}
    let contentDelta=other.secondary.xyz-center.secondary.xyz;
    // Curvature allowance grows with world footprint, never across a
    // separate transmitted instance or a material-normal discontinuity.
    let contentPlane=max(abs(dot(contentDelta,center.secondaryNormal.xyz)),abs(dot(contentDelta,other.secondaryNormal.xyz)));
    if(contentPlane>max(.0005*f32(step),length(contentDelta)*.025)){continue;}
   }
  }
  let normalWeight=pow(max(0.,dot(center.normal.xyz,other.normal.xyz)),select(32.,96.,glossy||optical));let delta=other.position.xyz-center.position.xyz;
  let plane=max(abs(dot(delta,center.normal.xyz)),abs(dot(delta,other.normal.xyz)));
  // Use the accumulated estimator's uncertainty in every pass. Tightening
  // from already-filtered variance freezes isolated bright/dark samples.
  let sigma=max(.005,4.*sqrt(max(spatialVariance,history[i].moments.z+history[j].moments.z)));
  let kernel=f32((3-abs(x))*(3-abs(y)));let w=kernel*normalWeight*exp(-plane/(.001*f32(step)))*exp(-abs(luminance(value.rgb)-luminance(input[j].rgb))/sigma);
  sum+=input[j].rgb*w;variance+=input[j].w*w*w;total+=w;
 }}output[i]=vec4f(sum/max(total,1e-10),variance/max(total*total,1e-10));
}`;

const displayShader=`
struct Accumulator {radiance:vec4f,moments:vec4f}
struct Pixel {color:vec4f,position:vec4f,normal:vec4f,moments:vec4f,secondary:vec4f,secondaryNormal:vec4f,reflection:vec4f,reflectionNormal:vec4f}
@group(0) @binding(0) var<uniform> config:vec4u;
@group(0) @binding(1) var<storage,read> pixels:array<vec4f>;
@group(0) @binding(2) var<storage,read> history:array<Accumulator>;
@group(0) @binding(3) var<storage,read> guides:array<Pixel>;
@vertex fn vertex(@builtin(vertex_index) id:u32)->@builtin(position) vec4f{let x=f32((id<<1u)&2u);let y=f32(id&2u);return vec4f(x*2.-1.,y*2.-1.,0,1);}
@fragment fn fragment(@builtin(position) p:vec4f)->@location(0) vec4f{
 let q=p.xy/vec2f(config.zw)*vec2f(config.xy)-.5;let base=vec2i(floor(q));let t=fract(q);
 let nearest=clamp(vec2i(floor(q+.5)),vec2i(0),vec2i(config.xy)-1);let ci=u32(nearest.y)*config.x+u32(nearest.x);let center=guides[ci];
 var color=vec4f(0);var sum=0.;
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let xy=clamp(base+vec2i(x,y),vec2i(0),vec2i(config.xy)-1);let i=u32(xy.y)*config.x+u32(xy.x);let other=guides[i];
  var w=select(1.-t.x,t.x,x==1)*select(1.-t.y,t.y,y==1);
  if(center.position.w>=0.&&other.position.w>=0.){
   if(abs(center.position.w-other.position.w)>.1||dot(center.normal.xyz,other.normal.xyz)<.85){w=0.;}
  }
  color+=vec4f(pixels[i].rgb,history[i].radiance.w)*w;sum+=w;
 }}
 color/=max(sum,1e-8);let alpha=clamp(color.w,0.,1.);if(alpha<.000001){return vec4f(0);}
 let raw=max(color.rgb/alpha*1.04,vec3f(0));let mapped=clamp(raw*(2.51*raw+.03)/(raw*(2.43*raw+.59)+.14),vec3f(0),vec3f(1));
 let srgb=select(12.92*mapped,1.055*pow(mapped,vec3f(1./2.4))-.055,mapped>vec3f(.0031308));return vec4f(srgb*alpha,alpha);
}`;

function mean(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;}
function arraysEqual(a,b){return a?.length===b.length&&b.every((v,i)=>Math.abs(v-a[i])<1e-10);}
function normalizedNormals(attribute){
 if(attribute.array instanceof Float32Array&&!attribute.normalized)return attribute.array;
 const out=new Float32Array(attribute.count*3);for(let i=0;i<attribute.count;i++){out[i*3]=attribute.getX(i);out[i*3+1]=attribute.getY(i);out[i*3+2]=attribute.getZ(i);}return out;
}

export async function createInstrumentPathTracer({scene,objects,cableMeshes=[],environment,camera,onError=()=>{},onProgress=()=>{}}){
 const canvas=document.createElement('canvas');canvas.className='instrument-pathtraced-canvas';canvas.setAttribute('aria-hidden','true');
 let disposed=false,failed=false,inFlight=0,width=0,height=0,displayWidth=0,displayHeight=0,sampleCount=0,totalSubmissions=0,resetCount=0,lastCamera=null,lastViewProjection=null,lastEye=null;
 const quality=createAdaptiveQuality({targetMs:33,minScale:.5,maxScale:1});let activeSet=null,previousFrame=null,slot=0,movingNow=false,lastCounters=null,lastCompletion=null,completedCost=null;let temporalReadBusy=false;const phaseTimings={moving:[],stationary:[]},queueTimings={moving:[],stationary:[]};
 let resources=[],frameResources=[],gpuTimes=[],gpuFrameTimes=[],submitTimes=[],worker,device,context,format,querySet,queryResolve,queryRead,queryBusy=false;
 let sceneData,sceneBuffers,uniform,config,temporalConfig,filterConfigs,motions,counters,countersRead;
 const tracked=[...objects,...cableMeshes],materialMap=new Map(),materialValues=[];
 const dynamic=new Set(cableMeshes),normalCache=new WeakMap(),indexCache=new WeakMap();
 function fail(error){if(disposed||failed)return;failed=true;onError(error instanceof Error?error:new Error(error?.message??String(error)));}
 function makeBuffer(data,usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST){
  const size=typeof data==='number'?data:data.byteLength;
  if(size>device.limits.maxBufferSize||((usage&GPUBufferUsage.STORAGE)&&size>device.limits.maxStorageBufferBindingSize))throw new Error(`The complete CAD path-tracing buffer (${Math.round(size/1048576)} MiB) exceeds this GPU's storage limit.`);
  const b=device.createBuffer({size:Math.max(16,Math.ceil(size/4)*4),usage});if(typeof data!=='number')device.queue.writeBuffer(b,0,data);return b;
 }
 function group(pipeline,buffers){return device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:buffers.map((b,binding)=>({binding,resource:{buffer:b}}))});}
 function capture(copy=false){
  scene.updateMatrixWorld(true);
  return tracked.map((object,id)=>{
   const geometry=object.geometry,m=Array.isArray(object.material)?object.material[0]:object.material;
   let materialIndex=materialMap.get(m);
   if(materialIndex===undefined){materialIndex=materialMap.size;materialMap.set(m,materialIndex);materialValues.push(m.color.r,m.color.g,m.color.b,m.roughness??.5,m.metalness??0,(m.transmission??0)>.5?1:0,m.ior??1.5,0,0,0,0,0,m.attenuationColor?.r??1,m.attenuationColor?.g??1,m.attenuationColor?.b??1,Number.isFinite(m.attenuationDistance)?m.attenuationDistance*SCALE:1e10);}
   let normals=normalCache.get(geometry);if(dynamic.has(object)||!normals){normals=normalizedNormals(geometry.attributes.normal);if(!dynamic.has(object))normalCache.set(geometry,normals);}
   let ix=indexCache.get(geometry);if(!ix){ix=geometry.index.array instanceof Uint32Array?geometry.index.array:Uint32Array.from(geometry.index.array);indexCache.set(geometry,ix);}
   const p=geometry.attributes.position.array,c=m.vertexColors?geometry.attributes.color?.array:null,f=geometry.attributes.finish?.array;
   const ranges=object.userData.meshRecord?.partRanges;
   return {name:object.name||`cable-${id}`,positions:copy?Float32Array.from(p):p,normals:copy?Float32Array.from(normals):normals,indices:copy?Uint32Array.from(ix):ix,colors:c?(copy?Float32Array.from(c):c):null,finish:f?(copy?Float32Array.from(f):f):null,matrix:Float32Array.from(object.matrixWorld.elements),materialIndex,dynamic:dynamic.has(object),boundaryRanges:ranges?.map((r,i)=>({start:r.firstIndex??r.start,count:r.indexCount??r.count,id:i+1}))};
  });
 }
 function dispose(){
  if(disposed)return;disposed=true;worker?.terminate();frameResources.forEach(r=>r.destroy());activeSet?.resources.forEach(r=>r.destroy());resources.forEach(r=>r.destroy?.());
  querySet?.destroy();queryResolve?.destroy();queryRead?.destroy();context?.unconfigure();device?.destroy();canvas.remove();
 }
 try{
  onProgress('Starting CYBR LIGHT WebGPU…');
  const session=await probeGpuSession(canvas);context=session.context;format=session.format;
  const features=session.adapter.features.has('timestamp-query')?['timestamp-query']:[];
  const storageLimit=Math.min(session.adapter.limits.maxStorageBufferBindingSize,512*1048576),bufferLimit=Math.min(session.adapter.limits.maxBufferSize,512*1048576);
  device=await session.adapter.requestDevice({requiredFeatures:features,requiredLimits:{maxStorageBufferBindingSize:storageLimit,maxBufferSize:bufferLimit,maxStorageBuffersPerShaderStage:8}});
  device.addEventListener('uncapturederror',event=>fail(event.error));device.lost.then(info=>{if(!disposed)fail(new Error(`CYBR LIGHT GPU device lost: ${info.message||info.reason}`));});
  context.configure({device,format,alphaMode:'premultiplied'});
  device.pushErrorScope('validation');
  const [source,traversal]=await Promise.all(['trace.wgsl','trace-instances.wgsl'].map(async name=>{const r=await fetch(shaderURL(name),{cache:'no-store'});if(!r.ok)throw new Error(`CYBR LIGHT shader ${name}: ${r.status}`);return r.text();}));
  const optimizedTraversal=new URLSearchParams(location.search).get('traversal')!=='original';
  const cachedDistances=new URLSearchParams(location.search).get('traversal')==='cached';
  const traceModule=device.createShaderModule({label:'CYBR instrument / actual LIGHT transport',code:instrumentTraceShader(source,traversal,{optimizeTraversal:optimizedTraversal,cacheDistances:cachedDistances})});
  // RGBA32F is sampled manually. Declaring the unfilterable layout explicitly
  // keeps the original HDR precision on adapters without float32 filtering.
  const traceLayout=device.createBindGroupLayout({entries:[
   {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform',minBindingSize:UNIFORM_BYTES}},
   ...[1,2,3,4,5,6,7].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===4?'storage':'read-only-storage'}})),
   {binding:8,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float',viewDimension:'2d'}},
   {binding:9,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}}
  ]});
  const [tracePipeline,accumulationPipeline,filterPipeline,displayPipeline]=await Promise.all([
   device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[traceLayout]}),compute:{module:traceModule,entryPoint:'main'}}),
   device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code:accumulationShader}),entryPoint:'main'}}),
   device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code:filterShader}),entryPoint:'main'}}),
   device.createRenderPipelineAsync({layout:'auto',vertex:{module:device.createShaderModule({code:displayShader}),entryPoint:'vertex'},fragment:{module:device.createShaderModule({code:displayShader}),entryPoint:'fragment',targets:[{format}]},primitive:{topology:'triangle-list'}})
  ]);
  const pipelineError=await device.popErrorScope();if(pipelineError)throw new Error(pipelineError.message);
  device.pushErrorScope('validation');
  onProgress('Building the complete CAD acceleration structure…');
  const input=capture(true),transfers=[];for(const m of input)for(const key of['positions','normals','indices','colors','finish'])if(m[key])transfers.push(m[key].buffer);
  worker=new Worker(new URL('./instrument-trace-worker.js',import.meta.url),{type:'module'});
  sceneData=await new Promise((resolve,reject)=>{worker.onmessage=event=>{if(event.data.error)reject(new Error(event.data.error));else if(event.data.progress)onProgress(event.data.progress);else resolve(event.data);};worker.onerror=event=>reject(new Error(event.message||'CAD acceleration worker failed.'));worker.postMessage({meshes:input,scale:SCALE},transfers);});worker.terminate();worker=null;
  if(sceneData.stats.maxDepth>62)throw new Error('The full CAD acceleration structure exceeds the supported traversal depth.');
  const geometry=makeBuffer(sceneData.geometry),nodes=makeBuffer(sceneData.nodes),materials=makeBuffer(new Float32Array(materialValues)),portals=makeBuffer(96),attributes=makeBuffer(sceneData.attributes);
  const lighting=makeBuffer(new Float32Array([1,1,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]));
  sceneBuffers={geometry,nodes,materials,portals,attributes,lighting};resources.push(geometry,nodes,materials,portals,attributes,lighting);
  const envData=environment.image?.data,envWidth=environment.image?.width,envHeight=environment.image?.height;
  if(!(envData instanceof Float32Array)||!envWidth||!envHeight)throw new Error('CYBR LIGHT requires the original linear HDR environment pixels.');
  const environmentDistribution=createEnvironmentDistribution(envData,envWidth,envHeight),environmentSamplingBuffer=makeBuffer(environmentDistribution.data);resources.push(environmentSamplingBuffer);
  const environmentTexture=device.createTexture({label:'Original workshop HDR',size:[envWidth,envHeight],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});resources.push(environmentTexture);
  device.queue.writeTexture({texture:environmentTexture},envData,{bytesPerRow:envWidth*16,rowsPerImage:envHeight},[envWidth,envHeight]);
  const envView=environmentTexture.createView();
  const rotation=new THREE.Matrix4().makeRotationFromEuler(scene.environmentRotation).invert(),r=rotation.elements;
  const environmentRows=[[r[0],r[4],r[8],0],[r[1],r[5],r[9],0],[r[2],r[6],r[10],0]];
  const envIntensity=scene.environmentIntensity??1;
  if(features.length){querySet=device.createQuerySet({type:'timestamp',count:4});queryResolve=device.createBuffer({size:32,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});queryRead=device.createBuffer({size:32,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});}
  uniform=makeBuffer(UNIFORM_BYTES,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  config=makeBuffer(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  temporalConfig=makeBuffer(TEMPORAL_UNIFORM_BYTES,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  filterConfigs=[1,2,4].map(()=>makeBuffer(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST));
  motions=makeBuffer((tracked.length+1)*64);
  counters=makeBuffer(32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC);
  countersRead=makeBuffer(32,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
  frameResources=[uniform,config,temporalConfig,...filterConfigs,motions,counters,countersRead];
  function allocateSet(w,h){
   const raw=makeBuffer(w*h*16),filtered=makeBuffer(w*h*16),frames=[];
   for(let i=0;i<2;i++){
    const samples=makeBuffer(w*h*128),history=makeBuffer(w*h*32);
    const traceGroup=device.createBindGroup({layout:tracePipeline.getBindGroupLayout(0),entries:[uniform,geometry,nodes,materials,samples,portals,attributes,lighting].map((b,binding)=>({binding,resource:{buffer:b}})).concat({binding:8,resource:envView},{binding:9,resource:{buffer:environmentSamplingBuffer}})});
    frames.push({width:w,height:h,samples,history,traceGroup,filterGroups:filterConfigs.map((cfg,i)=>group(filterPipeline,[cfg,samples,history,i%2?filtered:raw,i%2?raw:filtered])),displayGroup:group(displayPipeline,[config,filtered,history,samples])});
   }
   return {width:w,height:h,raw,filtered,frames,resources:[raw,filtered,...frames.flatMap(f=>[f.samples,f.history])]};
  }
  function resize(w,h){
   w=Math.max(1,Math.round(w));h=Math.max(1,Math.round(h));if(w===displayWidth&&h===displayHeight)return;
   displayWidth=w;displayHeight=h;canvas.width=w;canvas.height=h;
  }
  function render(cam,{geometryChanged=false,moving=false,now=performance.now()}={}){
   if(disposed||failed||!displayWidth||!displayHeight||inFlight>=2)return false;
   const begin=performance.now();cam.updateMatrixWorld(true);
   const cameraState=[...cam.matrixWorld.elements,...cam.projectionMatrixInverse.elements];const cameraMoved=!arraysEqual(lastCamera,cameraState);
   movingNow=moving||(geometryChanged||cameraMoved)&&lastCamera!==null;
   const targetScale=quality.update({moving:movingNow,now,gpuMs:completedCost?.gpuMs,queueMs:completedCost?.queueMs,queueDepth:completedCost?.queueDepth,scale:completedCost?.scale??1,timingMoving:completedCost?.moving??false,timingId:completedCost?.id});
   const w=Math.max(1,Math.round(displayWidth*targetScale)),h=Math.max(1,Math.round(displayHeight*targetScale));
   let retired=null,resized=false;
   if(!activeSet||w!==width||h!==height){
    // Transition frames can sample the old resolution's immutable history.
    // It is destroyed only after this submitted command has finished.
    retired=activeSet;activeSet=allocateSet(w,h);width=w;height=h;slot=0;resized=true;
   }
   const previousMatrices=capturePreviousMatrices(sceneData),meshes=geometryChanged?capture():sceneData.acceleration.templates.map(t=>({matrix:t.matrix,dynamic:t.dynamic}));
   let changed=false;
   if(geometryChanged){const changes=updateScene(sceneData,meshes,SCALE);for(const key of['nodes','geometry','attributes'])for(const range of changes[key])device.queue.writeBuffer(sceneBuffers[key],range.offset,sceneData[key].buffer||sceneData[key],range.offset,range.size);changed=changes.changed;}
   const poseChanged=cameraMoved||changed||resized;
   if(poseChanged){sampleCount=0;resetCount++;}if(sampleCount>=MAX_SAMPLES){retired?.resources.forEach(b=>b.destroy());return false;}
   const current=activeSet.frames[slot],previous=previousFrame??activeSet.frames[1-slot];
   const stationary=!poseChanged;
   device.queue.writeBuffer(motions,0,packTemporalMotions(previousMatrices,meshes,{scale:SCALE,geometryChanged:changed}));
   const bytes=new ArrayBuffer(UNIFORM_BYTES),f=new Float32Array(bytes),u=new Uint32Array(bytes);
   // Each ping-pong target receives fresh guides for its first pose sample.
   u.set([width,height,sampleCount<2?0:sampleCount,BOUNCES]);
   const e=cam.matrixWorld.elements;f.set([e[12]*SCALE,e[13]*SCALE,e[14]*SCALE,0],4);f[11]=1;f[15]=1;f[23]=1;f[27]=1.04;f[31]=1;f[39]=4;
   f.set(cam.projectionMatrixInverse.elements,40);f.set(e,56);environmentRows.forEach((row,i)=>f.set(row,72+i*4));f.set([envIntensity,SCALE,1.04,totalSubmissions],84);
   const temporalBytes=new ArrayBuffer(TEMPORAL_UNIFORM_BYTES),tf=new Float32Array(temporalBytes),tu=new Uint32Array(temporalBytes);
   tu.set([width,height,previous.width,previous.height]);tu.set([previousFrame?1:0,stationary?1:0,MAX_SAMPLES,totalSubmissions],4);
   const vp=new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse);const scaledVP=vp.clone().multiply(new THREE.Matrix4().makeScale(1/SCALE,1/SCALE,1/SCALE));
   tf.set(lastViewProjection??scaledVP.elements,8);tf.set([e[12]*SCALE,e[13]*SCALE,e[14]*SCALE,0],24);tf.set(lastEye??[e[12]*SCALE,e[13]*SCALE,e[14]*SCALE,0],28);tf.set([SCALE,0,0,0],32);
   device.queue.writeBuffer(uniform,0,bytes);device.queue.writeBuffer(temporalConfig,0,temporalBytes);device.queue.writeBuffer(config,0,new Uint32Array([width,height,displayWidth,displayHeight]));
   filterConfigs.forEach((cfg,i)=>device.queue.writeBuffer(cfg,0,new Uint32Array([width,height,sampleCount,[1,2,4][i]])));
   device.queue.writeBuffer(counters,0,new Uint32Array(8));
   const accumulationGroup=group(accumulationPipeline,[temporalConfig,current.samples,previous.samples,previous.history,current.history,activeSet.raw,motions,counters]);
   const encoder=device.createCommandEncoder();const timed=!!querySet&&!queryBusy;const readCounters=timed&&!temporalReadBusy;
   const dispatch=(pipeline,bindings,timestamps)=>{const pass=encoder.beginComputePass(timestamps?{timestampWrites:timestamps}:{});pass.setPipeline(pipeline);pass.setBindGroup(0,bindings);pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));pass.end();};
   dispatch(tracePipeline,current.traceGroup,timed?{querySet,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}:undefined);
   dispatch(accumulationPipeline,accumulationGroup);current.filterGroups.forEach(bindings=>dispatch(filterPipeline,bindings));
   const pass=encoder.beginRenderPass({...(timed?{timestampWrites:{querySet,beginningOfPassWriteIndex:2,endOfPassWriteIndex:3}}:{}),colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});pass.setPipeline(displayPipeline);pass.setBindGroup(0,current.displayGroup);pass.draw(3);pass.end();
   if(timed){encoder.resolveQuerySet(querySet,0,4,queryResolve,0);encoder.copyBufferToBuffer(queryResolve,0,queryRead,0,32);queryBusy=true;}
   if(readCounters){encoder.copyBufferToBuffer(counters,0,countersRead,0,32);temporalReadBusy=true;}
   if(inFlight===0)lastCompletion=null;
   device.queue.submit([encoder.finish()]);inFlight++;sampleCount++;totalSubmissions++;lastCamera=cameraState;lastViewProjection=Array.from(scaledVP.elements);lastEye=[e[12]*SCALE,e[13]*SCALE,e[14]*SCALE,0];previousFrame=current;slot=1-slot;
   const submit=performance.now()-begin;submitTimes.push(submit);if(submitTimes.length>120)submitTimes.shift();
   const measuredScale=targetScale,phase=movingNow?'moving':'stationary',measuredResolution=[width,height],measuredFrame=totalSubmissions;
   const queuedDepth=inFlight;let frameGpuMs=null;
   device.queue.onSubmittedWorkDone().then(()=>{const done=performance.now(),queueMs=done-begin;completedCost={id:measuredFrame,gpuMs:frameGpuMs,queueMs,queueDepth:queuedDepth,scale:measuredScale,moving:phase==='moving'};queueTimings[phase].push({queueMs,queueDepth:queuedDepth,perSubmissionMs:queueMs/queuedDepth,completionIntervalMs:lastCompletion===null?null:done-lastCompletion,scale:measuredScale});lastCompletion=done;if(queueTimings[phase].length>120)queueTimings[phase].shift();inFlight--;retired?.resources.forEach(b=>b.destroy());}).catch(fail);
   if(timed)queryRead.mapAsync(GPUMapMode.READ).then(()=>{if(disposed)return;const t=new BigUint64Array(queryRead.getMappedRange());const traceMs=Number(t[1]-t[0])/1e6,totalMs=Number(t[3]-t[0])/1e6;gpuTimes.push(traceMs);gpuFrameTimes.push(totalMs);frameGpuMs=totalMs;if(completedCost?.id===measuredFrame)completedCost.gpuMs=totalMs;phaseTimings[phase].push({traceMs,totalMs,scale:measuredScale,resolution:measuredResolution});if(phaseTimings[phase].length>120)phaseTimings[phase].shift();if(gpuTimes.length>120){gpuTimes.shift();gpuFrameTimes.shift();}queryRead.unmap();queryBusy=false;}).catch(error=>{queryBusy=false;fail(error);});
   if(readCounters)countersRead.mapAsync(GPUMapMode.READ).then(()=>{if(disposed)return;const counts=Array.from(new Uint32Array(countersRead.getMappedRange()));lastCounters={frame:measuredFrame,phase,resolution:measuredResolution,counts,acceptedRate:counts[0]/Math.max(1,counts[0]+counts[1]),opticalAcceptedRate:counts[2]/Math.max(1,counts[2]+counts[3]),meanHistorySamples:counts[6]/Math.max(1,counts[0]+counts[1]),maxHistorySamples:counts[7]};countersRead.unmap();temporalReadBusy=false;}).catch(error=>{temporalReadBusy=false;fail(error);});
   return true;
  }
  resize(1,1);
  const initError=await device.popErrorScope();if(initError)throw new Error(initError.message);
  return {canvas,resize,render,needsFrame:()=>!disposed&&!failed&&(sampleCount<MAX_SAMPLES||inFlight>0||queryBusy||temporalReadBusy||quality.snapshot().scale<1),
   snapshot:()=>({ready:!disposed&&!failed,backend:'CYBR LIGHT WebGPU RGB path tracer',bounces:BOUNCES,samples:sampleCount,maxSamples:MAX_SAMPLES,totalSubmissions,resetCount,inFlight,resolution:[width,height],displayResolution:[displayWidth,displayHeight],adaptive:quality.snapshot(),moving:movingNow,temporal:lastCounters,queueTimings:Object.fromEntries(Object.entries(queueTimings).map(([key,values])=>[key,{frames:values.length,queueMs:mean(values.map(v=>v.queueMs)),perSubmissionMs:mean(values.map(v=>v.perSubmissionMs)),completionIntervalMs:mean(values.map(v=>v.completionIntervalMs).filter(Number.isFinite)),latest:values.at(-1)??null}])),phaseTimings:Object.fromEntries(Object.entries(phaseTimings).map(([key,values])=>[key,{frames:values.length,traceMs:mean(values.map(v=>v.traceMs)),totalMs:mean(values.map(v=>v.totalMs)),latest:values.at(-1)??null}])),triangles:sceneData.stats.triangles,templates:sceneData.stats.templates,sceneBufferBytes:sceneData.stats.geometryBytes+sceneData.stats.attributeBytes+sceneData.stats.nodeBytes,frameBufferBytes:width*height*352,environmentImportanceBytes:environmentDistribution.stats.storageBytes,environmentSampling:'original HDR luminance and exact solid angles; 95% importance / 5% full sphere',gpuTraceMs:mean(gpuTimes),gpuTotalMs:mean(gpuFrameTimes),submitMs:mean(submitTimes),timestampQueries:!!querySet,adapter:[session.adapter.info?.vendor,session.adapter.info?.architecture,session.adapter.info?.device].filter(Boolean).join(' / ')||'WebGPU adapter',primaryRays:'exact inverse-projection, per-pixel origins',geometryUpdates:'BLAS cable refit and rigid TLAS transforms',background:'transparent coverage; visible paper, original HDR reflections',reconstruction:'validated immutable temporal history; independent primary/refraction/reflection guides; variance guided a-trous; edge-aware native-canvas reconstruction',temporalReuseAcrossPoses:true,deformedCableHistory:'rejected during deformation; accumulates at rest',geometryReduction:false,traversal:optimizedTraversal?(cachedDistances?'cached child AABB entry distances and hoisted instance mask':'hoisted instance mask; original AABB traversal'):'original CYBR LIGHT traversal'}),dispose};

 }catch(error){dispose();throw error;}
}
