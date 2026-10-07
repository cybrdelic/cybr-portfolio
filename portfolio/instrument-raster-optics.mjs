const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),unit=a=>mul(a,1/Math.hypot(...a));
const transmission=m=>m.userData?.cadTransmission??m.transmission??0;
export function dielectricTransmission(direction,normal,incidentIor,targetIor){
  const d=unit(direction),n=unit(normal),eta=incidentIor/targetIor,cos=-dot(d,n),k=1-eta*eta*(1-cos*cos);
  return k<0?{tir:true,direction:unit(sub(d,mul(n,2*dot(d,n))))}:{tir:false,direction:unit(add(mul(d,eta),mul(n,eta*cos-Math.sqrt(k))))};
}
export function traceCadTransmission({origin,direction,intersect,opaqueIntersect,maxInterfaces=12,maxMedia=8,epsilon=.005}){
  let point=[...origin],ray=unit(direction),weight=[1,1,1],stack=[],interfaces=0,lastExit=null,offset=0;
  for(let depth=0;depth<maxInterfaces;depth++){
    const hit=intersect(point,ray),opaque=opaqueIntersect?.(point,ray,hit?.distance??750);
    if(opaque&&opaque.distance>=0&&opaque.distance<=(hit?.distance??750)){
      const sigma=stack.at(-1)?.sigma??(!hit?.entering?hit?.sigma:[0,0,0])??[0,0,0];
      weight=weight.map((v,i)=>v*Math.exp(-sigma[i]*(opaque.distance+offset)));
      return{point:opaque.point??add(point,mul(ray,opaque.distance)),direction:ray,weight,interfaces,exhausted:false,opaqueHit:true,opaqueUv:opaque.uv};
    }
    if(!hit)return{point:lastExit??point,direction:ray,weight,interfaces,exhausted:stack.length>0,opaqueHit:false};
    const index=stack.findIndex(m=>m.id===hit.id),incident=stack.at(-1),etaI=incident?.ior??(!hit.entering?hit.ior:1);
    const next=hit.entering?[...stack,{id:hit.id,ior:hit.ior,sigma:hit.sigma}]:stack.filter((_,i)=>i!==index),etaT=next.at(-1)?.ior??1;
    const sigma=incident?.sigma??(!hit.entering?hit.sigma:[0,0,0]);weight=weight.map((v,i)=>v*Math.exp(-sigma[i]*(hit.distance+offset)));
    const refracted=dielectricTransmission(ray,hit.normal,etaI,etaT);interfaces++;
    ray=refracted.direction;if(!refracted.tir){if(next.length>maxMedia)return{point:hit.point,direction:ray,weight,interfaces,exhausted:true,opaqueHit:false};stack=next;lastExit=hit.point;}
    point=add(hit.point,mul(ray,epsilon));offset=epsilon;
  }
  return{point:lastExit??point,direction:ray,weight,interfaces,exhausted:true};
}
function matrixPoint(matrix,p){const q=[...p,1],v=[0,1,2,3].map(r=>q.reduce((s,x,c)=>s+matrix[c*4+r]*x,0));return v.slice(0,3).map(x=>x/v[3]);}
export function inverseProjectionRay(camera,pixel,size){
  const ndc=[pixel[0]/size[0]*2-1,pixel[1]/size[1]*2-1],inverse=camera.projectionMatrixInverse.elements??camera.projectionMatrixInverse,world=camera.matrixWorld.elements??camera.matrixWorld;
  const near=matrixPoint(world,matrixPoint(inverse,[...ndc,-1])),far=matrixPoint(world,matrixPoint(inverse,[...ndc,1]));return{origin:near,direction:unit(sub(far,near))};
}
export function reconstructDepthPoint(inverseViewProjection,uv,depth){return matrixPoint(inverseViewProjection,[uv[0]*2-1,uv[1]*2-1,depth*2-1]);}
export function marchScreenDepth({exitPoint,direction,viewProjection,inverseViewProjection,viewMatrix,sampleDepth,maxDistance=750,steps=16}){
  const ray=unit(direction);let low=0,clear=false,lowGap=0,lowValid=false;
  const evaluate=distance=>{const point=add(exitPoint,mul(ray,distance)),clipW=viewProjection[3]*point[0]+viewProjection[7]*point[1]+viewProjection[11]*point[2]+viewProjection[15];if(clipW<=0)return null;const ndc=matrixPoint(viewProjection,point),uv=[ndc[0]*.5+.5,ndc[1]*.5+.5];if(uv.some(v=>v<0||v>1))return null;const depth=sampleDepth(uv);if(!Number.isFinite(depth)||depth>=.999999)return null;const surface=reconstructDepthPoint(inverseViewProjection,uv,depth);return{uv,point,surface,distance,gap:matrixPoint(viewMatrix,surface)[2]-matrixPoint(viewMatrix,point)[2]};};
  const start=evaluate(0);if(start&&Math.abs(start.gap)<=.00001)return start;if(start&&start.gap<0){clear=true;lowGap=start.gap;lowValid=true;}
  for(let i=0;i<steps;i++){const distance=.1*(Math.pow(maxDistance/.1+1,(i+1)/steps)-1),hit=evaluate(distance);if(hit&&hit.gap>=0&&clear){let high=distance,highGap=hit.gap;for(let j=0;j<3;j++){const middle=(low+high)/2,q=evaluate(middle);if(q&&q.gap>=0){high=middle;highGap=q.gap;}else{low=middle;lowValid=!!q;lowGap=q?.gap??0;}}const refined=lowValid?low+(high-low)*Math.max(0,Math.min(1,-lowGap/(highGap-lowGap))):high;return evaluate(refined);}if(hit&&hit.gap<0)clear=true;low=distance;lowValid=!!hit&&hit.gap<0;lowGap=hit?.gap??0;}
  return null;
}

const opticsGLSL=(library,stackDepth,sampleMode)=>`
#define BVH_STACK_DEPTH ${stackDepth}
${library.BVHShaderGLSL.common_functions}
${library.BVHShaderGLSL.bvh_struct_definitions}
${library.BVHShaderGLSL.bvh_ray_functions}
uniform BVH cadGlassTree;uniform BVH cadWaterTree;
uniform sampler2D cadGlassMeta,cadWaterMeta;uniform float cadGlassIor,cadWaterIor;
uniform vec3 cadGlassSigma,cadWaterSigma,cadPaperRadiance;uniform int cadOpticalDebug;
uniform mat4 cadGlassInverse,cadGlassWorld,cadWaterInverse,cadWaterWorld,cadCameraWorld,cadInverseProjection,cadViewProjection,cadInverseViewProjection,cadView;
${sampleMode==='screen-ray'?'uniform sampler2D cadOpaqueDepth;':''}
uniform mat3 cadGlassNormal,cadWaterNormal;
uniform bool cadHasGlass,cadHasWater;uniform vec2 cadOpticalSize;
struct CadHit {float distance;vec3 point;vec3 normal;float identity;float ior;vec3 sigma;bool entering;};
struct CadPath {vec3 exitPoint;vec3 direction;vec3 weight;bool exhausted;bool opaqueHit;vec2 opaqueUv;};
vec4 cadBoundaryMeta(sampler2D tex,vec3 bary,uvec3 indices){
 vec4 a=texelFetch1D(tex,indices.x),b=texelFetch1D(tex,indices.y),c=texelFetch1D(tex,indices.z);
 // Boundary identity is discrete: interpolation can perturb an integer ID
 // and prevent its exit interface from matching the medium stack.
 return vec4(a.x,a.yzw*bary.x+b.yzw*bary.y+c.yzw*bary.z);
}
${sampleMode==='screen-ray'?`bool cadDepthGap(vec3 point,out float gap,out vec2 uv){
 vec4 clip=cadViewProjection*vec4(point,1);if(clip.w<=0.)return false;uv=clip.xy/clip.w*.5+.5;
 if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return false;
 float depth=texture(cadOpaqueDepth,uv).x;if(depth>=.999999)return false;
 vec4 surface=cadInverseViewProjection*vec4(uv*2.-1.,depth*2.-1.,1);vec3 world=surface.xyz/surface.w;
 gap=(cadView*vec4(world,1)).z-(cadView*vec4(point,1)).z;return true;
}
bool cadOpaqueInterval(vec3 ro,vec3 rd,float maximum,bool bounded,out float hitDistance,out vec2 hitUv){
 float low=0.,gap;vec2 uv;bool valid=cadDepthGap(ro,gap,uv),clearance=valid&&gap<0.;bool lowValid=clearance;float lowGap=valid?gap:0.;
 if(valid&&abs(gap)<=.00001){hitDistance=0.;hitUv=uv;return true;}
 // Short refracted segments use four samples; final air rays use sixteen.
 for(int step=0;step<16;step++){
  if(bounded&&step>=4)break;
  float samples=bounded?4.:16.;float distance=.1*(pow(maximum/.1+1.,float(step+1)/samples)-1.);
  valid=cadDepthGap(ro+rd*distance,gap,uv);
  if(valid&&gap>=0.&&clearance){float high=distance,highGap=gap;
   for(int refine=0;refine<3;refine++){float middle=(low+high)*.5;float middleGap;vec2 middleUv;bool middleValid=cadDepthGap(ro+rd*middle,middleGap,middleUv);if(middleValid&&middleGap>=0.){high=middle;highGap=middleGap;}else{low=middle;lowValid=middleValid;lowGap=middleValid?middleGap:0.;}}
   float refined=lowValid?mix(low,high,clamp(-lowGap/(highGap-lowGap),0.,1.)):high;
   float finalGap;vec2 finalUv;if(cadDepthGap(ro+rd*refined,finalGap,finalUv)){hitDistance=refined;hitUv=finalUv;return true;}return false;
  }
  if(valid&&gap<0.)clearance=true;low=distance;lowValid=valid&&gap<0.;lowGap=valid?gap:0.;
 }
 return false;
}`:''}
bool cadBoundary(vec3 ro,vec3 rd,bool water,out CadHit hit){
 vec3 localO,localD;mat4 world;mat3 normalMatrix;
 if(water){if(!cadHasWater)return false;localO=(cadWaterInverse*vec4(ro,1)).xyz;localD=(cadWaterInverse*vec4(rd,0)).xyz;world=cadWaterWorld;normalMatrix=cadWaterNormal;}
 else{if(!cadHasGlass)return false;localO=(cadGlassInverse*vec4(ro,1)).xyz;localD=(cadGlassInverse*vec4(rd,0)).xyz;world=cadGlassWorld;normalMatrix=cadGlassNormal;}
 uvec4 fi=uvec4(0);vec3 fn=vec3(0),bary=vec3(0);float side=1.,distance=1e20;bool found=false;
 if(water){found=bvhIntersectFirstHit(cadWaterTree,localO,normalize(localD),fi,fn,bary,side,distance);}
 else{found=bvhIntersectFirstHit(cadGlassTree,localO,normalize(localD),fi,fn,bary,side,distance);}
 if(!found)return false;
 hit.point=(world*vec4(localO+normalize(localD)*distance,1)).xyz;hit.distance=dot(hit.point-ro,rd);if(hit.distance<=.00001)return false;
 vec4 meta;if(water){meta=cadBoundaryMeta(cadWaterMeta,bary,fi.xyz);hit.ior=cadWaterIor;hit.sigma=cadWaterSigma;}else{meta=cadBoundaryMeta(cadGlassMeta,bary,fi.xyz);hit.ior=cadGlassIor;hit.sigma=cadGlassSigma;}
 vec3 smoothNormal=normalize(meta.yzw);if(dot(smoothNormal,fn)*side<0.)smoothNormal=-smoothNormal;
 hit.normal=normalize(normalMatrix*(smoothNormal*side));if(dot(hit.normal,rd)>0.)hit.normal=-hit.normal;hit.entering=side>0.;
 hit.identity=meta.x;return true;
}
bool cadNearest(vec3 ro,vec3 rd,out CadHit hit){CadHit a,b;bool glass=cadBoundary(ro,rd,false,a),water=cadBoundary(ro,rd,true,b);if(!glass&&!water)return false;if(glass&&(!water||a.distance<b.distance)){hit=a;}else{hit=b;}return true;}
CadPath cadTrace(vec3 ro,vec3 rd,float spread){
 float ids[8];float iors[8];vec3 absorption[8];int count=0;vec3 weight=vec3(1),exitPoint=ro;float offset=0.;
 for(int depth=0;depth<12;depth++){
  CadHit hit;bool boundary=cadNearest(ro,rd,hit);float opaqueDistance;vec2 opaqueUv;
  vec3 sigma=count>0?absorption[count-1]:(boundary&&!hit.entering?hit.sigma:vec3(0));
  ${sampleMode==='screen-ray'?'if(cadOpaqueInterval(ro,rd,boundary?hit.distance:750.,boundary,opaqueDistance,opaqueUv))return CadPath(ro+rd*opaqueDistance,rd,weight*exp(-sigma*(opaqueDistance+offset)),false,true,opaqueUv);':''}
  if(!boundary)return CadPath(exitPoint,rd,weight,count>0,false,vec2(0));
  int index=-1;for(int i=0;i<8;i++){if(i<count&&ids[i]==hit.identity)index=i;}
  float boundaryIor=hit.ior+(hit.ior-1.)*.025*spread;
  float etaI=count>0?iors[count-1]:(!hit.entering?boundaryIor:1.);float etaT=1.;
  if(hit.entering){etaT=boundaryIor;}else if(index>=0&&count>1){etaT=index==count-1?iors[count-2]:iors[count-1];}
  weight*=exp(-sigma*(hit.distance+offset));vec3 next=refract(rd,hit.normal,etaI/etaT);offset=.005;
  if(dot(next,next)<.00001){rd=normalize(reflect(rd,hit.normal));ro=hit.point+rd*.005;continue;}
  if(hit.entering){if(count>=8)return CadPath(hit.point,rd,weight,true,false,vec2(0));ids[count]=hit.identity;iors[count]=boundaryIor;absorption[count]=hit.sigma;count++;}
  else if(index>=0){for(int i=0;i<7;i++){if(i>=index&&i<count-1){ids[i]=ids[i+1];iors[i]=iors[i+1];absorption[i]=absorption[i+1];}}count--;}
  rd=normalize(next);exitPoint=hit.point;ro=hit.point+rd*.005;
 }
 return CadPath(exitPoint,rd,weight,true,false,vec2(0));
}
void cadPrimaryRay(out vec3 nearPoint,out vec3 direction){
 vec2 ndc=gl_FragCoord.xy/cadOpticalSize*2.-1.;vec4 a=cadInverseProjection*vec4(ndc,-1,1),b=cadInverseProjection*vec4(ndc,1,1);
 nearPoint=(cadCameraWorld*vec4(a.xyz/a.w,1)).xyz;vec3 farPoint=(cadCameraWorld*vec4(b.xyz/b.w,1)).xyz;direction=normalize(farPoint-nearPoint);
}
vec4 cadScreenSample(CadPath path,float roughness,float ior){
 // Exact optical boundaries determine displacement and absorption. The
 // selected opaque sampling method only reads the current live HDR render.
 if(cadOpticalDebug==1)return vec4(path.exhausted?vec3(1,0,0):path.opaqueHit?vec3(0,1,0):vec3(0,0,1),1);
 vec4 paper=vec4(cadPaperRadiance,1);if(path.exhausted)return paper;
 ${sampleMode==='boundary'?`vec4 clip=cadViewProjection*vec4(path.exitPoint,1);if(clip.w<=0.)return paper;
 vec3 ndc=clip.xyz/clip.w;if(any(lessThan(ndc,vec3(-1)))||any(greaterThan(ndc,vec3(1))))return paper;
 vec2 uv=ndc.xy*.5+.5;
 return getTransmissionSample(clamp(uv,vec2(.5)/cadOpticalSize,vec2(1)-vec2(.5)/cadOpticalSize),roughness,ior);`:`if(path.opaqueHit)return getTransmissionSample(clamp(path.opaqueUv,vec2(.5)/cadOpticalSize,vec2(1)-vec2(.5)/cadOpticalSize),roughness,ior);
 return paper;`}
}
`;
const replacement=`vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
 const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
 const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
 const in vec3 attenuationColor, const in float attenuationDistance ) {
 vec4 light=vec4(0);vec3 transmittance,primaryOrigin,primaryDirection;cadPrimaryRay(primaryOrigin,primaryDirection);primaryOrigin=position-primaryDirection*.01;
 #ifdef USE_DISPERSION
 for(int channel=0;channel<3;channel++){CadPath path=cadTrace(primaryOrigin,primaryDirection,float(channel-1)*dispersion);vec4 sampleValue=cadScreenSample(path,roughness,ior);light[channel]=sampleValue[channel];light.a+=sampleValue.a/3.;transmittance[channel]=diffuseColor[channel]*path.weight[channel];}
 #else
 CadPath path=cadTrace(primaryOrigin,primaryDirection,0.);light=cadScreenSample(path,roughness,ior);transmittance=diffuseColor*path.weight;
 #endif
 vec3 F=EnvironmentBRDF(n,-primaryDirection,specularColor,specularF90,roughness);float factor=(transmittance.r+transmittance.g+transmittance.b)/3.;
 return vec4((1.-F)*transmittance*light.rgb,1.-(1.-light.a)*factor);
}`;
function replaceFunction(source,name,body){const start=source.indexOf(`vec4 ${name}(`);if(start<0)throw Error(`CAD optics shader contract changed: ${name}`);const open=source.indexOf('{',start);let depth=1,end=open+1;for(;end<source.length&&depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}if(depth)throw Error('Unbalanced CAD optics shader function');return source.slice(0,start)+body+source.slice(end);}

export async function setupRasterOptics({THREE,objects,environment,camera,scene,innerMap,outerMap,size,opaqueDepth,bvhLibrary,debugMode=0,sampleMode='screen-ray',paperColor}){
  if(!['screen-ray','boundary'].includes(sampleMode))throw Error('Unknown CAD optical sample mode');
  if(paperColor&&(!paperColor.isColor||![paperColor.r,paperColor.g,paperColor.b].every(value=>Number.isFinite(value)&&value>=0)))throw Error('CAD optical paper must be a finite nonnegative Three Color');
  const paperRadiance=paperColor?.clone()??new THREE.Color(1.766763272,1.766763272,1.557227765);
  const library=bvhLibrary??await import('./vendor/three-mesh-bvh-0.9.5/index.module.js');
  const groups=new Map(),resources=[];let boundShaders=0,refits=0,disposed=false,nextIdentity=1;
  scene.updateMatrixWorld(true);
  for(const object of objects){if(transmission(object.material)<=0)continue;const name=object.userData.meshRecord?.module??object.name.split('/')[0];if(!['light','elements','scenes'].includes(name))continue;
    const group=groups.get(name)??{name,glass:[],water:[]};groups.set(name,group);(object.userData.staticWater||object.material.ior<1.4?group.water:group.glass).push(object);}
  function buildBoundary(sources){
    const anchor=sources[0],geometry=new THREE.BufferGeometry(),records=[],position=[],meta=[],ior=anchor?.material.ior??1;let sigma=null;
    for(const object of sources){const source=object.geometry,p=source.attributes.position,n=source.attributes.normal,ix=source.index;const count=ix?.count??p.count,start=position.length/3,m=object.material,normals=[];
      if(Math.abs((m.ior??1.5)-ior)>1e-6)throw Error('A CAD optical boundary class must share one authored IOR');
      const ranges=object.userData.meshRecord?.partRanges??[],identity=nextIdentity++,rangeIds=ranges.map(()=>nextIdentity++),attenuation=m.attenuationColor??new THREE.Color(1,1,1),distance=m.attenuationDistance;
      const coefficient=[attenuation.r,attenuation.g,attenuation.b].map(c=>Number.isFinite(distance)&&distance>0?-Math.log(Math.max(1e-8,c))/distance:0);
      if(sigma&&coefficient.some((value,i)=>Math.abs(value-sigma[i])>1e-9))throw Error('A CAD optical boundary class must share one authored Beer coefficient');sigma??=coefficient;
      const fallback=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
      for(let i=0;i<count;i++){const vertex=ix?ix.getX(i):i,range=ranges.findIndex(r=>i>=(r.firstIndex??r.start)&&i<(r.firstIndex??r.start)+(r.indexCount??r.count));
        if(!n&&i%3===0){const ids=[i,i+1,i+2].map(index=>ix?ix.getX(index):index);a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]);c.fromBufferAttribute(p,ids[2]);THREE.Triangle.getNormal(a,b,c,fallback);}
        const normal=n?[n.getX(vertex),n.getY(vertex),n.getZ(vertex)]:fallback.toArray();position.push(p.getX(vertex),p.getY(vertex),p.getZ(vertex));normals.push(...normal);meta.push(range<0?identity:rangeIds[range],...normal);}
      records.push({object,start,count,positions:Float32Array.from(position.slice(start*3)),normals:Float32Array.from(normals),relative:null});
    }
    if(!sources.length){position.push(0,0,0,.001,0,0,0,.001,0);for(let i=0;i<3;i++)meta.push(0,0,0,1);}
    geometry.setAttribute('position',new THREE.BufferAttribute(Float32Array.from(position),3));geometry.setAttribute('cadMeta',new THREE.BufferAttribute(Float32Array.from(meta),4));
    const boundary={sources,anchor,records,geometry,ior,sigma:new THREE.Vector3(...(sigma??[0,0,0])),inverse:new THREE.Matrix4(),world:new THREE.Matrix4(),normal:new THREE.Matrix3()};
    refreshBoundary(boundary,false);boundary.bvh=new library.MeshBVH(geometry,{maxLeafTris:6,strategy:library.SAH});boundary.maxDepth=Math.max(...library.getBVHExtremes(boundary.bvh).map(root=>root.depth.max));boundary.uniform=new library.MeshBVHUniformStruct();boundary.uniform.updateFrom(boundary.bvh);
    boundary.meta=new library.FloatVertexAttributeTexture();boundary.meta.updateFrom(geometry.attributes.cadMeta);
    resources.push(boundary);return boundary;
  }
  function refreshBoundary(boundary,allowRefit=true){
    if(!boundary.anchor)return;
    boundary.world.copy(boundary.anchor.matrixWorld);boundary.inverse.copy(boundary.world).invert();boundary.normal.getNormalMatrix(boundary.world);let changed=false;
    for(const record of boundary.records){const relative=new THREE.Matrix4().multiplyMatrices(boundary.inverse,record.object.matrixWorld);if(record.relative&&relative.elements.every((v,i)=>Math.abs(v-record.relative[i])<1e-9))continue;
      const p=new THREE.Vector3(),normal=new THREE.Vector3(),normalMatrix=new THREE.Matrix3().getNormalMatrix(relative),meta=boundary.geometry.attributes.cadMeta;
      for(let i=0;i<record.count;i++){p.fromArray(record.positions,i*3).applyMatrix4(relative);boundary.geometry.attributes.position.setXYZ(record.start+i,p.x,p.y,p.z);normal.fromArray(record.normals,i*3).applyMatrix3(normalMatrix).normalize();meta.setXYZW(record.start+i,meta.getX(record.start+i),normal.x,normal.y,normal.z);}record.relative=[...relative.elements];changed=true;}
    if(changed&&allowRefit){boundary.geometry.attributes.position.needsUpdate=true;boundary.bvh.refit();boundary.uniform.updateFrom(boundary.bvh);boundary.meta.updateFrom(boundary.geometry.attributes.cadMeta);refits++;}
  }
  for(const group of groups.values()){group.glassBoundary=buildBoundary(group.glass);group.waterBoundary=buildBoundary(group.water);await new Promise(resolve=>setTimeout(resolve,0));}
  // Depth-first traversal retains at most one deferred sibling per ancestor.
  // Reserve two extra slots beyond the actual deepest node, including refits
  // (which change bounds and positions while preserving tree topology).
  const maxBvhDepth=Math.max(0,...resources.map(boundary=>boundary.maxDepth)),stackDepth=Math.max(8,maxBvhDepth+2);
  for(const group of groups.values())group.stackDepth=Math.max(8,group.glassBoundary.maxDepth+2,group.waterBoundary.maxDepth+2);
  const inverseProjection=new THREE.Matrix4(),cameraWorld=new THREE.Matrix4(),viewProjection=new THREE.Matrix4(),inverseViewProjection=new THREE.Matrix4(),view=new THREE.Matrix4();
  function update(cam=camera){if(disposed)return;scene.updateMatrixWorld(true);cam.updateMatrixWorld(true);inverseProjection.copy(cam.projectionMatrixInverse);cameraWorld.copy(cam.matrixWorld);view.copy(cam.matrixWorldInverse);viewProjection.multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse);inverseViewProjection.multiplyMatrices(cam.matrixWorld,cam.projectionMatrixInverse);for(const boundary of resources)refreshBoundary(boundary);}
  update(camera);
  function bindShader(shader,material,module){
    const group=groups.get(typeof module==='string'?module:module?.name);if(!group||transmission(material)<=0)return false;
    if(shader.fragmentShader.includes('#include <transmission_pars_fragment>'))shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_pars_fragment>',THREE.ShaderChunk.transmission_pars_fragment);
    const glass=group.glassBoundary,water=group.waterBoundary;
    Object.assign(shader.uniforms,{cadGlassTree:{value:glass.uniform},cadWaterTree:{value:water.uniform},cadGlassMeta:{value:glass.meta},cadWaterMeta:{value:water.meta},cadGlassIor:{value:glass.ior},cadWaterIor:{value:water.ior},cadGlassSigma:{value:glass.sigma},cadWaterSigma:{value:water.sigma},cadPaperRadiance:{value:paperRadiance},cadOpticalDebug:{value:Number.isFinite(debugMode)?debugMode:0},
      cadGlassInverse:{value:glass.inverse},cadGlassWorld:{value:glass.world},cadGlassNormal:{value:glass.normal},cadWaterInverse:{value:water.inverse},cadWaterWorld:{value:water.world},cadWaterNormal:{value:water.normal},
      cadHasGlass:{value:group.glass.length>0},cadHasWater:{value:group.water.length>0},cadCameraWorld:{value:cameraWorld},cadInverseProjection:{value:inverseProjection},cadViewProjection:{value:viewProjection},cadInverseViewProjection:{value:inverseViewProjection},cadView:{value:view},cadOpaqueDepth:opaqueDepth?.value!==undefined?opaqueDepth:{value:opaqueDepth},cadOpticalSize:size?.value?size:{value:size}});
    // All optical boundaries have already been traversed. Read the opaque
    // source, preserving the caller's physical transmission/opacity uniforms.
    const sourceMap=innerMap??outerMap;if(shader.uniforms.workingTransmissionMap)shader.uniforms.workingTransmissionMap=sourceMap?.value!==undefined?sourceMap:{value:sourceMap};
    else shader.uniforms.transmissionSamplerMap=sourceMap?.value!==undefined?sourceMap:{value:sourceMap};
    const original=shader.fragmentShader;shader.fragmentShader=replaceFunction(original,'getIBLVolumeRefraction',replacement);
    const marker='vec4 getIBLVolumeRefraction(';shader.fragmentShader=shader.fragmentShader.replace(marker,opticsGLSL(library,group.stackDepth,sampleMode)+'\n'+marker);boundShaders++;return true;
  }
  function intersectRay(module,ro,rd){const group=groups.get(module);if(!group)throw Error('Unknown optical CAD module');
    let nearest=null;for(const boundary of[group.glassBoundary,group.waterBoundary]){if(!boundary.anchor)continue;const worldRay=new THREE.Ray(new THREE.Vector3(...ro),new THREE.Vector3(...rd)),local=worldRay.clone().applyMatrix4(boundary.inverse),hit=boundary.bvh.raycastFirst(local,THREE.DoubleSide);if(!hit)continue;
      const point=hit.point.clone().applyMatrix4(boundary.world),distance=point.clone().sub(worldRay.origin).dot(worldRay.direction);if(distance<=.00001||nearest&&distance>=nearest.distance)continue;
      const m=boundary.geometry.attributes.cadMeta,normal=new THREE.Vector3(),bary=hit.barycoord??new THREE.Vector3(1,0,0);for(const[vertex,weight]of[[hit.face.a,bary.x],[hit.face.b,bary.y],[hit.face.c,bary.z]])normal.addScaledVector(new THREE.Vector3(m.getY(vertex),m.getZ(vertex),m.getW(vertex)),weight);
      if(normal.dot(hit.face.normal)<0)normal.negate();normal.applyMatrix3(boundary.normal).normalize();const entering=hit.face.normal.dot(local.direction)<0;if(!entering)normal.negate();if(normal.dot(worldRay.direction)>0)normal.negate();
      nearest={point:point.toArray(),distance,normal:normal.toArray(),entering,id:m.getX(hit.face.a),ior:boundary.ior,sigma:boundary.sigma.toArray()};}return nearest;}
  function traceRay(module,origin,direction,opaqueIntersect){return traceCadTransmission({origin,direction,opaqueIntersect:sampleMode==='boundary'?undefined:opaqueIntersect,intersect:(ro,rd)=>intersectRay(module,ro,rd)});}
  function snapshot(){return{ready:!disposed,modules:[...groups.keys()],boundaryTriangles:resources.reduce((sum,b)=>sum+(b.anchor?(b.geometry.index?.count??b.geometry.attributes.position.count)/3:0),0),boundShaders,refits,
    maxBvhDepth,bvhStackDepth:stackDepth,moduleDepths:Object.fromEntries([...groups].map(([name,g])=>[name,{glass:g.glassBoundary.maxDepth,water:g.waterBoundary.maxDepth,stack:g.stackDepth}])),bvhStrategy:'SAH',boundaryNormals:'barycentric authored normals transformed with inverse transpose; geometric side determines entry/exit',debugMode,sampleMode,paperRadiance:paperRadiance.toArray(),mediumCapacity:8,rayAdvanceMM:.005,primaryOrigin:'visible raster surface minus primary direction times 0.01 mm',transport:'current CAD triangle BVHs; inverse-projection primary directions; nested glass/water IOR identities; Beer absorption; up to12 interfaces',opaqueVisibility:sampleMode==='boundary'?'actual last boundary exit point projected into live opaque HDR; no depth march; exhausted/offscreen rays use calibrated paper; hidden geometry unavailable; coating/reflections use raster IBL':'opaque depth checked before each optical boundary (4 steps), then along final air ray (16 steps); 3 crossing refinements; hidden/offscreen geometry unavailable; coating/reflections use raster IBL',backend:'WebGL2 raster optical boundary rays'};}
  function dispose(){if(disposed)return;disposed=true;for(const b of resources){b.uniform.dispose();b.meta.dispose();b.geometry.dispose();}}
  return{bindShader,update,intersectRay,traceRay,snapshot,dispose};
}
