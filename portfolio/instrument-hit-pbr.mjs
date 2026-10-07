import {pbrUvFromMillimeters,pbrWearCoordinates,pbrTangentFrame,applyPbrHeightNormal,applyPbrNormal,pbrWearResponse,pbrCavityResponse,pbrMacroRoughness,PBR_ROUGHNESS_MACRO_FOOTPRINT_MM} from './instrument-pbr-materials.mjs';

// Secondary opaque hits use original source maps and the same physical charts
// as primary v9 materials. The returned radiance is linear HDR, before ACES.
export const HIT_PBR_VERSION='secondary-native-pbr-v3';
export const HIT_PBR_MATERIAL_TEXELS=9;
const clamp=x=>Math.min(1,Math.max(0,x)),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),add=(a,b)=>a.map((x,i)=>x+b[i]),mul=(a,s)=>a.map(x=>x*s),sub=(a,b)=>a.map((x,i)=>x-b[i]);
const unit=a=>{const n=Math.hypot(...a);return n>1e-12?mul(a,1/n):[0,0,1];};
const finite=(a,n,name)=>{if(a?.length!==n||!Array.from(a).every(Number.isFinite))throw Error(`Invalid hit PBR ${name}`);return Array.from(a);};
const linear=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
const srgb=x=>x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055;
const linearByte=Float64Array.from({length:256},(_,i)=>linear(i/255));
const closed=desired=>{const v=desired.map(x=>Math.floor(x+.5));if(!v.some(Boolean)){const i=Math.abs(desired[0])>=Math.abs(desired[1])?0:1;v[i]=desired[i]<0?-1:1;}return v;};

function imagePixels(texture){
  const image=texture?.image;
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height))throw Error('Hit PBR array requires decoded source images');
  if(image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray){
    if(image.data.length!==image.width*image.height*4)throw Error('Hit PBR source must be RGBA8');
    return{data:image.data,width:image.width,height:image.height};
  }
  const canvas=globalThis.OffscreenCanvas?new OffscreenCanvas(image.width,image.height):globalThis.document?.createElement('canvas');
  if(!canvas)throw Error('Hit PBR image decoding requires canvas or a readPixels callback');
  canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(image,0,0);return{data:context.getImageData(0,0,image.width,image.height).data,width:image.width,height:image.height};
}

// Area downfilter in linear reflectance for RGB color, independently linear
// alpha/data. No source image, texture, or primary material is changed.
export function downfilterHitPbrRGBA({data,width,height,size,color=false,flipY=false}){
  if(!(data instanceof Uint8Array||data instanceof Uint8ClampedArray)||data.length!==width*height*4||![width,height,size].every(x=>Number.isInteger(x)&&x>0)||size>width||size>height)throw Error('Invalid hit PBR downfilter');
  const result=new Uint8Array(size*size*4),sx=width/size,sy=height/size;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sum=[0,0,0,0],x0=x*sx,x1=(x+1)*sx,y0=y*sy,y1=(y+1)*sy;
    for(let iy=Math.floor(y0);iy<Math.ceil(y1);iy++)for(let ix=Math.floor(x0);ix<Math.ceil(x1);ix++){
      const weight=(Math.min(x1,ix+1)-Math.max(x0,ix))*(Math.min(y1,iy+1)-Math.max(y0,iy)),row=flipY?height-1-iy:iy,at=(row*width+ix)*4;
      for(let k=0;k<4;k++){const value=data[at+k]/255;sum[k]+=(color&&k<3?linearByte[data[at+k]]:value)*weight;}
    }
    const at=(y*size+x)*4;for(let k=0;k<4;k++){const value=sum[k]/(sx*sy);result[at+k]=Math.round(clamp(color&&k<3?srgb(value):value)*255);}
  }
  return result;
}

/** layers: {name,kind:'fine'|'wear'|'source',color,normal,surface} source Textures. */
export async function buildHitPbrTextureArrays({THREE,layers,size=1024,maxAnisotropy=8,readPixels=imagePixels}){
  if(!THREE?.DataArrayTexture||!layers?.length||!Number.isInteger(size)||size<1||!Number.isFinite(maxAnisotropy)||maxAnisotropy<1)throw Error('Invalid hit PBR texture array descriptor');
  const names=new Map(),layerLookup=new Map(),wearLayerLookup=new Map(),textures={},owned=[];
  try{
    for(let i=0;i<layers.length;i++){
      const layer=layers[i];if(!layer||typeof layer.name!=='string'||names.has(layer.name)||!['fine','wear','source'].includes(layer.kind)||!['color','normal','surface'].every(key=>layer[key]?.isTexture))throw Error('Invalid hit PBR array layer');
      names.set(layer.name,i);layerLookup.set(layer.color,i);if(layer.kind==='wear')wearLayerLookup.set(layer.alloy??layer.name,i);
    }
    for(const key of['color','normal','surface']){
      const pixels=new Uint8Array(size*size*4*layers.length);
      for(let layer=0;layer<layers.length;layer++){
        const texture=layers[layer][key],source=await readPixels(texture);
        const rgba=downfilterHitPbrRGBA({...source,size,color:key==='color',flipY:texture.flipY===true});pixels.set(rgba,layer*size*size*4);
      }
      const texture=new THREE.DataArrayTexture(pixels,size,size,layers.length);owned.push(texture);texture.name=`CYBR secondary PBR ${key}`;
      texture.format=THREE.RGBAFormat;texture.type=THREE.UnsignedByteType;texture.colorSpace=key==='color'?THREE.SRGBColorSpace:THREE.NoColorSpace;
      texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=true;
      texture.anisotropy=Math.min(8,maxAnisotropy);texture.flipY=false;texture.needsUpdate=true;textures[key]=texture;
    }
  }catch(error){for(const texture of owned)texture.dispose();throw error;}
  let disposed=false;return{textures,names,layerLookup,wearLayerLookup,size,depth:layers.length,
    snapshot:()=>({version:HIT_PBR_VERSION,size,depth:layers.length,samplers:3,colorSpace:'sRGB RGB / linear alpha',dataSpace:'linear',baseBytes:size*size*4*layers.length*3,sourceTexturesRetained:true}),
    dispose(){if(disposed)return;disposed=true;for(const texture of owned)texture.dispose();}};
}

/** Material IDs are the caller's exact triangle material IDs, with no remap. */
export function packHitPbrMaterialTable({THREE,materials,layerLookup=new Map(),wearLayerLookup=new Map(),diffuseIBLScale=.3,sourceFinish=false}){
  if(!THREE?.DataTexture||!materials?.length||!Number.isFinite(diffuseIBLScale)||diffuseIBLScale<0||typeof sourceFinish!=='boolean')throw Error('Invalid hit PBR material table');
  const data=new Float32Array(materials.length*HIT_PBR_MATERIAL_TEXELS*4),profiles=[];
  for(let id=0;id<materials.length;id++){
    const material=materials[id],metal=material?.userData?.pbrMetal,wear=metal?.wear;
    if(!material?.isMaterial||!material.color?.isColor||![material.roughness,material.metalness,material.ior??1.5].every(Number.isFinite))throw Error('Invalid secondary source material');
    const layer=material.map?layerLookup.get(material.map):-1;
    if(material.map&&layer===undefined)throw Error('Secondary source color map is missing from texture arrays');
    const wearLayer=wear?wearLayerLookup.get(wear.alloy):-1;if(wear&&wearLayer===undefined)throw Error('Secondary wear alloy is missing from texture arrays');
    const p={fineLayer:layer??-1,wearLayer:wearLayer??-1,chartKind:metal?.chartKind??-1,radialFace:metal?.mapping==='radialFace',tileMM:metal?.tileMM??[1,1],rotation:metal?.rotationRadians??0,
      anisotropy:material.anisotropy??0,anisotropyRotation:material.anisotropyRotation??0,color:material.color.toArray(),normalScale:material.normalScale?.toArray()??[1,1],heightNormals:metal?.heightNormals===true,
      cavityStrength:metal?.cavity?.strength??0,roughness:material.roughness,metallic:material.metalness,ior:material.ior??1.5,specularIntensity:material.specularIntensity??1,
      vertexColors:material.vertexColors===true,envIntensity:material.envMapIntensity??1,diffuseIBLScale,wearStrength:wear?.strength??0,wearTileMM:wear?.tileMM??[128,128],pbr:!!metal,sourceFinish:material.userData?.secondarySourceFinish??sourceFinish,
      emissive:material.emissive?.toArray().map(x=>x*(material.emissiveIntensity??1))??[0,0,0],specularColor:material.specularColor?.toArray()??[1,1,1],roughnessMacroContrast:metal?.roughnessMacro?.contrast??1,roughnessMacroReference:metal?.roughnessMacro?.reference??.33};
    const record=[p.fineLayer,p.wearLayer,p.chartKind,+p.radialFace,...p.tileMM,p.rotation,p.anisotropy,...p.color,p.anisotropyRotation,...p.normalScale,+p.heightNormals,p.cavityStrength,
      p.roughness,p.metallic,p.ior,p.specularIntensity,+p.vertexColors,p.envIntensity,p.diffuseIBLScale,p.wearStrength,...p.wearTileMM,+p.pbr,+p.sourceFinish,...p.emissive,p.roughnessMacroContrast,...p.specularColor,p.roughnessMacroReference];
    if(record.length!==36||record.some(x=>!Number.isFinite(x)))throw Error('Nonfinite secondary material record');data.set(record,id*36);profiles.push(p);
  }
  const texture=new THREE.DataTexture(data,9,materials.length,THREE.RGBAFormat,THREE.FloatType);texture.name='CYBR secondary native PBR materials';texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.colorSpace=THREE.NoColorSpace;texture.needsUpdate=true;
  return{texture,profiles,data,dispose:()=>texture.dispose()};
}

/** Analytic UV derivatives at a ray hit, rather than derivatives of wrapped atan. */
export function hitPbrChartFrame({uv,chart,chartKind,localPosition,tileMM,rotationRadians=0,mapping='chart',positionDx,positionDy,localDx,localDy,uvDx,uvDy,normal,wearTileMM=[128,128],wearPhase=[.5,.5],wearBounds=[0,0]}){
  uv=finite(uv,2,'chart UV');chart=finite(chart,2,'chart');localPosition=finite(localPosition,3,'local position');localDx=finite(localDx,3,'local X edge');localDy=finite(localDy,3,'local Y edge');uvDx=finite(uvDx,2,'UV X edge');uvDy=finite(uvDy,2,'UV Y edge');
  const kind=chartKind??Math.round(chart[0]),r2=localPosition[1]**2+localPosition[2]**2,r=Math.sqrt(r2),angularLength=Math.max(chart[1],1e-8);
  const mmDerivative=(localEdge,uvEdge)=>{
    const turn=(localPosition[1]*localEdge[2]-localPosition[2]*localEdge[1])/(Math.max(r2,1e-12)*2*Math.PI),radial=(localPosition[1]*localEdge[1]+localPosition[2]*localEdge[2])/Math.max(r,1e-8);
    return kind===0?uvEdge:kind===1?[turn*angularLength,radial]:kind===2?[turn*angularLength,localEdge[0]]:[localEdge[0],turn*angularLength];
  };
  const mdx=mmDerivative(localDx,uvDx),mdy=mmDerivative(localDy,uvDy),c=Math.cos(rotationRadians),s=Math.sin(rotationRadians);
  const desired=(kind===3?[s,c]:[c,-s]).map((x,i)=>x*angularLength/tileMM[i]),repeats=closed(desired);
  const mapDerivative=(mm,localEdge)=>{
    if(mapping==='radialFace'&&kind===1)return[localEdge[1]/tileMM[0],localEdge[2]/tileMM[1]];
    const derivative=[(c*mm[0]+s*mm[1])/tileMM[0],(-s*mm[0]+c*mm[1])/tileMM[1]];
    if(kind>0)for(let i=0;i<2;i++)derivative[i]+=(repeats[i]-desired[i])*mm[kind===3?1:0]/angularLength;return derivative;
  };
  const fineDx=mapDerivative(mdx,localDx),fineDy=mapDerivative(mdy,localDy),macroRepeats=Math.max(1,Math.floor((wearBounds[0]>0?2*Math.PI*wearBounds[0]:chart[1])/wearTileMM[0]+.5));
  const wearDerivative=(mm,edge)=>kind===0?mm.map((x,i)=>x/wearTileMM[i]):kind===1?[edge[1]/wearTileMM[0],edge[2]/wearTileMM[1]]:[mm[kind===3?1:0]/angularLength*macroRepeats,edge[0]/wearTileMM[1]];
  const fineFrame=pbrTangentFrame({positionDx,positionDy,uvDx:fineDx,uvDy:fineDy,normal}),wearDx=wearDerivative(mdx,localDx),wearDy=wearDerivative(mdy,localDy);
  return{fineUv:pbrUvFromMillimeters({uv,chart,chartKind,localPosition,tileMM,rotationRadians,mapping}),fineDx,fineDy,fineFrame,
    grainFrame:pbrTangentFrame({positionDx,positionDy,uvDx:mdx,uvDy:mdy,normal}),wear:pbrWearCoordinates({uv,chart,chartKind,localPosition,tileMM:wearTileMM,phase:wearPhase,bounds:wearBounds}),wearDx,wearDy,
    wearFrame:pbrTangentFrame({positionDx,positionDy,uvDx:wearDx,uvDy:wearDy,normal})};
}

export function evaluateHitPbrSamples({profile,frame,fine,wear,normal,faceDirection=1}){
  let color=profile.color.map((x,i)=>x*(fine?.color[i]??1)),roughness=profile.roughness*(fine?.surface[1]??1),metallic=profile.metallic*(fine?.surface[2]??1),anisotropy=profile.anisotropy;
  if(fine&&profile.roughnessMacroContrast<1)roughness=pbrMacroRoughness({sample:roughness,macro:fine.macroRoughness??fine.surface[1],contrast:profile.roughnessMacroContrast,reference:profile.roughnessMacroReference});
  let resolvedNormal=fine?(profile.heightNormals?applyPbrHeightNormal({sample:fine.normal,frame:frame.fineFrame,tileMM:profile.tileMM,normalScale:profile.normalScale,faceDirection}):applyPbrNormal({sample:fine.normal,frame:frame.fineFrame,normalScale:profile.normalScale,faceDirection})):unit(normal);
  if(wear){const response=pbrWearResponse({baseColor:color,roughness,metallic,anisotropy,color:wear.color,surface:wear.surface,edgeFade:frame.wear.edgeFade,wearStrength:profile.wearStrength});({color,roughness,metallic,anisotropy}=response);
    const base=frame.wearFrame.normal,slope=mul(sub(resolvedNormal,mul(base,dot(resolvedNormal,base))),1/Math.max(dot(resolvedNormal,base),1e-5));
    const xy=wear.normal.slice(0,2).map(x=>{const q=2*x-1;return Math.abs(q)<=1/255+1e-6?0:q;});
    const pit=add(mul(frame.wearFrame.gradientU,xy[0]*profile.wearTileMM[0]),mul(frame.wearFrame.gradientV,xy[1]*profile.wearTileMM[1]));
    resolvedNormal=unit(add(add(base,slope),mul(pit,faceDirection*frame.wear.edgeFade*profile.wearStrength/Math.max(wear.normal[2]*2-1,.05))));
  }
  return{color,roughness:Math.min(1,Math.max(.0525,roughness)),metallic:clamp(metallic),anisotropy:clamp(anisotropy),normal:resolvedNormal,cavity:1+(clamp(fine?.surface[0]??1)-1)*profile.cavityStrength};
}

/** Native r180 correlated GGX, including its anisotropic visibility clamp. */
export function hitPbrDirectGGX({normal,viewDir,lightDir,tangent=[1,0,0],bitangent=[0,1,0],roughness,anisotropy=0,f0,f90=1}){
  const n=unit(normal),v=unit(viewDir),l=unit(lightDir),h=unit(add(v,l)),nl=clamp(dot(n,l)),nv=clamp(dot(n,v));if(!nl||!nv)return[0,0,0];
  const nh=clamp(dot(n,h)),vh=clamp(dot(v,h)),alpha=Math.max(.0525,roughness)**2,at=alpha+(1-alpha)*anisotropy**2;
  let visibility,distribution;
  if(anisotropy>0){
    const gv=nl*Math.hypot(at*dot(tangent,v),alpha*dot(bitangent,v),nv),gl=nv*Math.hypot(at*dot(tangent,l),alpha*dot(bitangent,l),nl);visibility=clamp(.5/(gv+gl));
    const a2=at*alpha,v2=(alpha*dot(tangent,h))**2+(at*dot(bitangent,h))**2+(a2*nh)**2;distribution=a2*(a2/Math.max(v2,1e-20))**2/Math.PI;
  }else{visibility=.5/Math.max(nl*Math.sqrt(alpha**2+(1-alpha**2)*nv**2)+nv*Math.sqrt(alpha**2+(1-alpha**2)*nl**2),1e-6);distribution=alpha**2/(Math.PI*(nh**2*(alpha**2-1)+1)**2);}
  const fresnel=2**((-5.55473*vh-6.98316)*vh);return f0.map(x=>(x*(1-fresnel)+f90*fresnel)*visibility*distribution);
}

/** Three's split-sum GGX multiscattering; irradiance includes the native PI. */
export function hitPbrIndirect({color,metallic,roughness,dotNV,irradiance=[Math.PI,Math.PI,Math.PI],radiance=[1,1,1],cavity=1,diffuseVisibility=1,diffuseIBLScale=1,ior=1.5,specularIntensity=1,specularColor=[1,1,1]}){
  const r=[-roughness+1,-.0275*roughness+.0425,-.572*roughness+1.04,.022*roughness-.04],a004=Math.min(r[0]**2,2**(-9.28*clamp(dotNV)))*r[0]+r[1],fab=[-1.04*a004+r[2],1.04*a004+r[3]],ems=1-fab[0]-fab[1];
  const f0=color.map((x,i)=>Math.min(((ior-1)/(ior+1))**2*specularColor[i],1)*specularIntensity*(1-metallic)+x*metallic),f90=specularIntensity*(1-metallic)+metallic;
  const single=f0.map(x=>x*fab[0]+f90*fab[1]),multi=f0.map((x,i)=>{const avg=x+(1-x)*.047619;return single[i]*avg/(1-ems*avg)*ems;}),total=single.map((x,i)=>x+multi[i]),diffuse=color.map(x=>x*(1-metallic)*(1-Math.max(...total)));
  const specAO=pbrCavityResponse({sample:cavity,dotNV,roughness}).specularOcclusion;
  return{single,multi,diffuse,radiance:color.map((_,i)=>(radiance[i]*single[i]+multi[i]*irradiance[i]/Math.PI)*specAO+diffuse[i]*irradiance[i]/Math.PI*cavity*diffuseVisibility*diffuseIBLScale)};
}

// Dependencies supplied by the geometry tracer, before this block:
// CadGeometryHit, cadAttribute(slot,vertex), cadVertexPoint(vertex,instance),
// cadVertexVisibility(vertex), cadPbrKeyVisibility(worldPosition,worldNormal).
// Insert after <lights_physical_pars_fragment> and before transmission pars.
export const hitPbrGLSL=/* glsl */`
uniform highp sampler2DArray cadPbrColorArray,cadPbrNormalArray,cadPbrSurfaceArray;
uniform sampler2D cadPbrMaterials;
uniform vec3 cadPbrKeyDirection,cadPbrKeyColor,cadPbrFillDirection,cadPbrFillColor;
uniform float cadPbrFootprintMM;
struct CadPbrProfile{float fineLayer,wearLayer,kind,radialFace;vec2 tile;float rotation,anisotropy;vec3 color;float anisotropyRotation;vec2 normalScale;float heightNormals,cavity;float roughness,metallic,ior,specularIntensity;float vertexColors,envIntensity,diffuseScale,wearStrength;vec2 wearTile;float pbr,sourceFinish;vec3 emissive,specularColor;float macroContrast,macroReference;};
struct CadPbrFrame{vec3 u,v,n;};
struct CadPbrSurface{vec3 color,normal,tangent,bitangent;float roughness,metallic,anisotropy,cavity,visibility,envIntensity,diffuseScale,ior,specularIntensity;vec3 emissive,specularColor;};
CadPbrProfile cadPbrProfile(uint id){
 vec4 a=texelFetch(cadPbrMaterials,ivec2(0,int(id)),0),b=texelFetch(cadPbrMaterials,ivec2(1,int(id)),0),c=texelFetch(cadPbrMaterials,ivec2(2,int(id)),0),d=texelFetch(cadPbrMaterials,ivec2(3,int(id)),0),e=texelFetch(cadPbrMaterials,ivec2(4,int(id)),0),f=texelFetch(cadPbrMaterials,ivec2(5,int(id)),0),g=texelFetch(cadPbrMaterials,ivec2(6,int(id)),0);
 vec4 h=texelFetch(cadPbrMaterials,ivec2(7,int(id)),0),i=texelFetch(cadPbrMaterials,ivec2(8,int(id)),0);
 CadPbrProfile p;p.fineLayer=a.x;p.wearLayer=a.y;p.kind=a.z;p.radialFace=a.w;p.tile=b.xy;p.rotation=b.z;p.anisotropy=b.w;p.color=c.rgb;p.anisotropyRotation=c.w;p.normalScale=d.xy;p.heightNormals=d.z;p.cavity=d.w;p.roughness=e.x;p.metallic=e.y;p.ior=e.z;p.specularIntensity=e.w;p.vertexColors=f.x;p.envIntensity=f.y;p.diffuseScale=f.z;p.wearStrength=f.w;p.wearTile=g.xy;p.pbr=g.z;p.sourceFinish=g.w;p.emissive=h.rgb;p.specularColor=i.rgb;p.macroContrast=h.w;p.macroReference=i.w;return p;
}
CadPbrFrame cadPbrMetric(vec3 e0,vec3 e1,vec2 d0,vec2 d1,vec3 n){
 float scale=max(max(length(e0),length(e1)),1.e-8);vec3 a=e0/scale,b=e1/scale;float g00=dot(a,a),g01=dot(a,b),g11=dot(b,b),det=g00*g11-g01*g01;CadPbrFrame f;f.u=vec3(0);f.v=vec3(0);f.n=n;
 if(g00*g11>1.e-12&&det>1.e-6*g00*g11){f.u=(a*(g11*d0.x-g01*d1.x)+b*(g00*d1.x-g01*d0.x))/(det*scale);f.v=(a*(g11*d0.y-g01*d1.y)+b*(g00*d1.y-g01*d0.y))/(det*scale);f.u-=n*dot(n,f.u);f.v-=n*dot(n,f.v);}return f;
}
mat3 cadPbrOrthonormal(CadPbrFrame f){vec3 t=f.u;if(dot(t,t)<1.e-12){vec3 a=vec3(1,0,0)-f.n*f.n.x,b=vec3(0,1,0)-f.n*f.n.y;t=dot(a,a)>dot(b,b)?a:b;}t=normalize(t);vec3 b=cross(f.n,t);if(dot(f.v,b)<0.)b=-b;return mat3(t,b,f.n);}
vec2 cadPbrClosed(vec2 desired){vec2 v=floor(desired+.5);if(dot(v,v)==0.){if(abs(desired.x)>=abs(desired.y))v.x=desired.x<0.?-1.:1.;else v.y=desired.y<0.?-1.:1.;}return v;}
vec2 cadPbrMM(vec3 q,vec2 uv,vec2 chart,float kind){if(kind<.5)return uv;float turn=atan(q.z,q.y)/(2.*PI),reference=uv[chart.x>2.5?1:0]/max(chart.y,1.e-8);turn+=floor(reference-turn+.5);float angle=turn*chart.y;return kind<1.5?vec2(angle,length(q.yz)):kind<2.5?vec2(angle,q.x):vec2(q.x,angle);}
vec2 cadPbrMMDerivative(vec3 q,vec3 edge,vec2 uvEdge,float angularLength,float kind){if(kind<.5)return uvEdge;float r2=max(dot(q.yz,q.yz),1.e-12),dAngle=(q.y*edge.z-q.z*edge.y)/r2/(2.*PI)*angularLength,dR=dot(q.yz,edge.yz)/max(sqrt(r2),1.e-8);return kind<1.5?vec2(dAngle,dR):kind<2.5?vec2(dAngle,edge.x):vec2(edge.x,dAngle);}
vec2 cadPbrFine(vec2 mm,vec3 q,CadPbrProfile p,vec2 chart,float kind,bool derivative){
 if(p.radialFace>.5&&kind>.5&&kind<1.5)return q.yz/p.tile+(derivative?vec2(0):vec2(.5));float c=cos(p.rotation),s=sin(p.rotation);vec2 uv=vec2(c*mm.x+s*mm.y,-s*mm.x+c*mm.y)/p.tile;
 if(kind>.5){vec2 desired=(kind>2.5?vec2(s,c):vec2(c,-s))*max(chart.y,1.e-8)/p.tile;uv+=(cadPbrClosed(desired)-desired)*mm[kind>2.5?1:0]/max(chart.y,1.e-8);}return uv;
}
vec2 cadPbrMacro(vec2 mm,vec3 q,vec2 chart,float kind,vec2 phase,vec2 bounds,vec2 tile,bool derivative){
 if(kind<.5)return mm/tile+(derivative?vec2(0):vec2(.5)+(phase-.5)*.22);
 if(kind<1.5)return q.yz/tile+(derivative?vec2(0):vec2(.5)+(phase-.5)*.22);
 float circumference=bounds.x>0.?2.*PI*bounds.x:chart.y,repeats=max(1.,floor(circumference/tile.x+.5));return vec2(mm[kind>2.5?1:0]/max(chart.y,1.e-8)*repeats,q.x/tile.y)+(derivative?vec2(0):vec2(phase.x,.5+(phase.y-.5)*.18));
}
float cadPbrRim(vec3 q,float kind,vec2 bounds){float dimension=kind>.5&&kind<1.5?bounds.x:kind>1.5?bounds.y:0.;if(dimension<=0.)return 1.;float distance=dimension-(kind<1.5?length(q.yz):abs(q.x));return smoothstep(0.,clamp(dimension*.01,.05,.15),distance);}
float cadPbrLod(CadPbrFrame f,float footprint){float resolution=float(textureSize(cadPbrNormalArray,0).x),rho=max(length(f.u),length(f.v))*max(footprint,1.e-8)*resolution;return max(0.,log2(max(rho,1.e-8)));}
vec3 cadPbrOct(vec2 e){vec3 n=vec3(e,1.-abs(e.x)-abs(e.y));if(n.z<0.)n.xy=(1.-abs(n.yx))*(vec2(step(0.,n.x),step(0.,n.y))*2.-1.);return normalize(n);}
CadPbrSurface cadPbrEvaluate(CadGeometryHit hit,vec3 viewDirWorld){
 CadPbrProfile p=cadPbrProfile(hit.materialId);vec4 a0=cadAttribute(0,hit.vertices.x),a1=cadAttribute(0,hit.vertices.y),a2=cadAttribute(0,hit.vertices.z),b0=cadAttribute(1,hit.vertices.x),b1=cadAttribute(1,hit.vertices.y),b2=cadAttribute(1,hit.vertices.z),c0=cadAttribute(2,hit.vertices.x),c1=cadAttribute(2,hit.vertices.y),c2=cadAttribute(2,hit.vertices.z);
 vec4 a=a0*hit.bary.x+a1*hit.bary.y+a2*hit.bary.z,b=b0*hit.bary.x+b1*hit.bary.y+b2*hit.bary.z,c=c0*hit.bary.x+c1*hit.bary.y+c2*hit.bary.z;
 vec3 q=b.yzw,e0=cadVertexPoint(hit.vertices.y,hit.instanceId)-cadVertexPoint(hit.vertices.x,hit.instanceId),e1=cadVertexPoint(hit.vertices.z,hit.instanceId)-cadVertexPoint(hit.vertices.x,hit.instanceId),l0=b1.yzw-b0.yzw,l1=b2.yzw-b0.yzw;
 vec3 base=normalize(hit.normal);float faceDirection=dot(hit.geometricNormal,viewDirWorld)>=0.?1.:-1.;if(dot(base,viewDirWorld)<0.)base=-base;
 float kind=p.kind<0.?floor(c.z+.5):p.kind;vec2 chart=c.zw,mm=cadPbrMM(q,c.xy,chart,kind),md0=cadPbrMMDerivative(q,l0,c1.xy-c0.xy,chart.y,kind),md1=cadPbrMMDerivative(q,l1,c2.xy-c0.xy,chart.y,kind),mapUV=cadPbrFine(mm,q,p,chart,kind,false);
 CadPbrFrame fineFrame=cadPbrMetric(e0,e1,cadPbrFine(md0,l0,p,chart,kind,true),cadPbrFine(md1,l1,p,chart,kind,true),base);vec4 fineColor=vec4(1),fineSurface=vec4(1);vec3 fineN=vec3(0,0,1);
 if(p.fineLayer>=0.){float lod=cadPbrLod(fineFrame,cadPbrFootprintMM);fineColor=textureLod(cadPbrColorArray,vec3(mapUV,p.fineLayer),lod);fineSurface=textureLod(cadPbrSurfaceArray,vec3(mapUV,p.fineLayer),lod);fineN=textureLod(cadPbrNormalArray,vec3(mapUV,p.fineLayer),lod).xyz*2.-1.;if(p.heightNormals>.5)fineN.xy*=step(vec2(1./255.+1.e-6),abs(fineN.xy));fineN.xy*=p.normalScale;}
 CadPbrSurface r;r.color=p.color*fineColor.rgb;if(p.vertexColors>.5)r.color*=vec3(a.zw,b.x);r.roughness=p.roughness*fineSurface.g;r.metallic=p.metallic*fineSurface.b;r.anisotropy=p.anisotropy;
 if(p.fineLayer>=0.&&p.macroContrast<1.){float macroLod=log2(max(float(textureSize(cadPbrSurfaceArray,0).x)/min(p.tile.x,p.tile.y)*${PBR_ROUGHNESS_MACRO_FOOTPRINT_MM.toFixed(1)},1.));float macroSample=textureLod(cadPbrSurfaceArray,vec3(mapUV,p.fineLayer),max(macroLod,cadPbrLod(fineFrame,cadPbrFootprintMM))).g;r.roughness=clamp(r.roughness+(1.-p.macroContrast)*(p.macroReference-macroSample),0.,1.);}
 if(p.pbr<.5&&p.sourceFinish>.5){r.color*=c.y;r.roughness*=c.x;}
 if(p.heightNormals>.5)r.normal=normalize(base*fineN.z+(fineFrame.u*fineN.x*p.tile.x+fineFrame.v*fineN.y*p.tile.y)*faceDirection);else{mat3 tbn=cadPbrOrthonormal(fineFrame);r.normal=normalize(base*fineN.z+(tbn[0]*fineN.x+tbn[1]*fineN.y)*faceDirection);}
 if(p.wearLayer>=0.&&p.wearStrength>0.){
  vec4 w0=cadAttribute(3,hit.vertices.x),w1=cadAttribute(3,hit.vertices.y),w2=cadAttribute(3,hit.vertices.z),w=w0*hit.bary.x+w1*hit.bary.y+w2*hit.bary.z;vec2 wearUV=cadPbrMacro(mm,q,chart,kind,w.xy,w.zw,p.wearTile,false);
  CadPbrFrame wf=cadPbrMetric(e0,e1,cadPbrMacro(md0,l0,chart,kind,w.xy,w.zw,p.wearTile,true),cadPbrMacro(md1,l1,chart,kind,w.xy,w.zw,p.wearTile,true),base);float lod=cadPbrLod(wf,cadPbrFootprintMM),rim=cadPbrRim(q,kind,w.zw);
  vec4 color=textureLod(cadPbrColorArray,vec3(wearUV,p.wearLayer),lod),surface=textureLod(cadPbrSurfaceArray,vec3(wearUV,p.wearLayer),lod);vec3 mapN=textureLod(cadPbrNormalArray,vec3(wearUV,p.wearLayer),lod).xyz*2.-1.;mapN.xy*=step(vec2(1./255.+1.e-6),abs(mapN.xy));
  float opaque=clamp(surface.g,0.,1.)*rim,coverage=1.-(1.-opaque)*(1.-clamp(surface.b,0.,1.)*p.wearStrength),blend=max(opaque,clamp(color.a,0.,1.)*(1.-clamp(surface.g,0.,1.))*p.wearStrength);
  r.color=mix(r.color,color.rgb,blend);r.roughness=mix(r.roughness,clamp(surface.r,0.,1.),coverage);r.metallic*=1.-opaque;r.anisotropy*=1.-opaque;
  vec3 fineSlope=(r.normal-base*dot(r.normal,base))/max(dot(r.normal,base),1.e-5),pitSlope=(wf.u*mapN.x*p.wearTile.x+wf.v*mapN.y*p.wearTile.y)/max(mapN.z,.05);r.normal=normalize(base+fineSlope+pitSlope*faceDirection*rim*p.wearStrength);
 }
 // Surface curvature broadens the footprint, using decoded source normals,
 // without differentiating a divergent ray trace or spreading vertex AO.
 vec3 n0=cadPbrOct(a0.xy),n1=cadPbrOct(a1.xy),n2=cadPbrOct(a2.xy);float geometryRoughness=0.;
 for(int k=0;k<3;k++){CadPbrFrame nf=cadPbrMetric(e0,e1,vec2(n1[k]-n0[k],0),vec2(n2[k]-n0[k],0),base);geometryRoughness=max(geometryRoughness,length(nf.u)*max(cadPbrFootprintMM,0.));}
 r.roughness=min(1.,max(r.roughness,.0525)+geometryRoughness);r.metallic=clamp(r.metallic,0.,1.);r.cavity=mix(1.,clamp(fineSurface.r,0.,1.),p.cavity);
 CadPbrFrame grain=cadPbrMetric(e0,e1,md0,md1,r.normal);mat3 gf=cadPbrOrthonormal(grain);float cg=cos(p.anisotropyRotation),sg=sin(p.anisotropyRotation);r.tangent=gf[0]*cg+gf[1]*sg;r.bitangent=gf[1]*cg-gf[0]*sg;
 r.visibility=mix(.7,1.,clamp(cadVertexVisibility(hit.vertices.x)*hit.bary.x+cadVertexVisibility(hit.vertices.y)*hit.bary.y+cadVertexVisibility(hit.vertices.z)*hit.bary.z,0.,1.));r.envIntensity=p.envIntensity;r.diffuseScale=p.diffuseScale;r.ior=p.ior;r.specularIntensity=p.specularIntensity;r.specularColor=p.specularColor;r.emissive=p.emissive;return r;
}
vec3 cadPbrGGX(CadPbrSurface s,vec3 v,vec3 l,vec3 f0,float f90){
 vec3 h=normalize(l+v);float nl=clamp(dot(s.normal,l),0.,1.),nv=clamp(dot(s.normal,v),0.,1.),nh=clamp(dot(s.normal,h),0.,1.),vh=clamp(dot(v,h),0.,1.),alpha=s.roughness*s.roughness;
 if(nl<=0.||nv<=0.)return vec3(0);float visibility,distribution;
 if(s.anisotropy>0.){float at=mix(alpha,1.,s.anisotropy*s.anisotropy),gv=nl*length(vec3(at*dot(s.tangent,v),alpha*dot(s.bitangent,v),nv)),gl=nv*length(vec3(at*dot(s.tangent,l),alpha*dot(s.bitangent,l),nl));visibility=clamp(.5/max(gv+gl,1.e-8),0.,1.);float a2=at*alpha;vec3 d=vec3(alpha*dot(s.tangent,h),at*dot(s.bitangent,h),a2*nh);float w2=a2/max(dot(d,d),1.e-20);distribution=RECIPROCAL_PI*a2*w2*w2;}else{visibility=V_GGX_SmithCorrelated(alpha,nl,nv);distribution=D_GGX(alpha,nh);}return F_Schlick(f0,f90,vh)*(visibility*distribution);
}
vec3 cadPbrDirect(CadPbrSurface s,vec3 v,vec3 l,vec3 radiance,vec3 f0,float f90){return clamp(dot(s.normal,l),0.,1.)*radiance*(cadPbrGGX(s,v,l,f0,f90)+s.color*(1.-s.metallic)*RECIPROCAL_PI);}
vec3 cadShadeOpaque(CadGeometryHit hit,vec3 viewDirWorld){
 CadPbrSurface s=cadPbrEvaluate(hit,normalize(viewDirWorld));float shadow=cadPbrKeyVisibility(hit.point,normalize(hit.normal));s.normal=normalize(mat3(viewMatrix)*s.normal);s.tangent=normalize(mat3(viewMatrix)*s.tangent);s.bitangent=normalize(mat3(viewMatrix)*s.bitangent);vec3 v=normalize(mat3(viewMatrix)*viewDirWorld);
 vec3 f0=mix(min(vec3(pow((s.ior-1.)/(s.ior+1.),2.))*s.specularColor,vec3(1))*s.specularIntensity,s.color,s.metallic);float f90=mix(s.specularIntensity,1.,s.metallic);
 vec3 light=cadPbrDirect(s,v,normalize(mat3(viewMatrix)*cadPbrKeyDirection),cadPbrKeyColor*shadow,f0,f90)+cadPbrDirect(s,v,normalize(mat3(viewMatrix)*cadPbrFillDirection),cadPbrFillColor,f0,f90);
 #ifdef USE_ENVMAP
 vec3 bent=s.normal;if(s.anisotropy>0.){vec3 b=cross(s.bitangent,v);if(dot(b,b)>1.e-12){b=normalize(cross(normalize(b),s.bitangent));bent=normalize(mix(b,s.normal,pow(1.-s.anisotropy*(1.-s.roughness),4.)));}}
 vec3 irradiance=getIBLIrradiance(s.normal)*s.envIntensity,radiance=getIBLRadiance(v,bent,s.roughness)*s.envIntensity;vec2 fab=DFGApprox(s.normal,v,s.roughness);vec3 single=f0*fab.x+f90*fab.y;float ems=1.-fab.x-fab.y;vec3 avg=f0+(1.-f0)*.047619,multi=single*avg/(1.-ems*avg)*ems,total=single+multi,diffuse=s.color*(1.-s.metallic)*(1.-max(max(total.r,total.g),total.b));
 light+=(radiance*single+multi*irradiance*RECIPROCAL_PI)*computeSpecularOcclusion(clamp(dot(s.normal,v),0.,1.),s.cavity,s.roughness)+diffuse*irradiance*RECIPROCAL_PI*s.cavity*s.visibility*s.diffuseScale;
 #endif
 return light+s.emissive;
}
`;

export function bindHitPbrUniforms(shader,{arrays,materialTable,keyDirection,keyColor,fillDirection,fillColor,footprintMM=.1,THREE}){
  for(const [name,value]of Object.entries({keyDirection,keyColor,fillDirection,fillColor}))finite(value,3,name);
  if(!Number.isFinite(footprintMM)||footprintMM<=0||!arrays?.textures||!materialTable?.texture||!THREE?.Vector3)throw Error('Invalid secondary PBR uniforms');
  Object.assign(shader.uniforms,{cadPbrColorArray:{value:arrays.textures.color},cadPbrNormalArray:{value:arrays.textures.normal},cadPbrSurfaceArray:{value:arrays.textures.surface},cadPbrMaterials:{value:materialTable.texture},
    cadPbrKeyDirection:{value:new THREE.Vector3(...keyDirection)},cadPbrKeyColor:{value:new THREE.Vector3(...keyColor)},cadPbrFillDirection:{value:new THREE.Vector3(...fillDirection)},cadPbrFillColor:{value:new THREE.Vector3(...fillColor)},cadPbrFootprintMM:{value:footprintMM}});
  return shader;
}
