import{reconstructMetalFinishCoordinates}from './instrument-metal-finish.mjs';

// Source texture provenance and physical authoring scale belong to the caller.
// This helper makes no claim that a procedural source is a scan or measurement.
export const PBR_METAL_VERSION='native-pbr-mm-v9';
export const PBR_ROUGHNESS_MACRO_FOOTPRINT_MM=2.8;
const finite=(value,size,label)=>{
  if(value?.length!==size||!Array.from(value).every(Number.isFinite))throw Error(`Invalid ${label}`);
  return Array.from(value);
};
const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
const add=(a,b)=>a.map((value,i)=>value+b[i]);
const scale=(a,f)=>a.map(value=>value*f);
const length=a=>Math.hypot(...a);
const unit=a=>scale(a,1/Math.max(length(a),1e-12));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const project=(a,n)=>add(a,scale(n,-dot(a,n)));
const saturate=value=>Math.min(1,Math.max(0,value));
const mix=(a,b,t)=>a+(b-a)*t;
const smoothstep=(a,b,x)=>{const t=saturate((x-a)/(b-a));return t*t*(3-2*t);};
function descriptor({tileMM,rotationRadians=0,offset=[0,0],normalScale=[1,1],anisotropy=0,anisotropyRotation=Math.PI/2,maxAnisotropy=8,colorMultiplier=[1,1,1],mapping='chart',chartKind,wearMaps,wearTileMM=[128,128],wearAlloy='unspecified',wearStrength=1,packedRoughMetal=false,heightNormals=false,cavity=false,cavityStrength=1,roughnessMacroContrast=1,roughnessMacroReference=.33,constantBaseReflectance}){
  tileMM=finite(tileMM,2,'PBR tile size');offset=finite(offset,2,'PBR UV offset');normalScale=finite(normalScale,2,'PBR normal scale');colorMultiplier=finite(colorMultiplier,3,'PBR color multiplier');
  if(tileMM.some(x=>x<=0)||![rotationRadians,anisotropy,anisotropyRotation,maxAnisotropy,cavityStrength].every(Number.isFinite)||anisotropy<0||anisotropy>1||maxAnisotropy<1||normalScale.some(x=>x<0)||colorMultiplier.some(x=>x<0)||typeof heightNormals!=='boolean'||typeof cavity!=='boolean'||cavityStrength<0||cavityStrength>1||!['chart','radialFace'].includes(mapping)||(chartKind!==undefined&&(!Number.isInteger(chartKind)||chartKind<0||chartKind>3)))throw Error('Invalid PBR metal descriptor');
  wearTileMM=finite(wearTileMM,2,'wear tile size');
  if(wearTileMM.some(value=>value<=0)||typeof wearAlloy!=='string'||!Number.isFinite(wearStrength)||wearStrength<0||wearStrength>1||(wearMaps!==undefined&&(!wearMaps||!['color','surface','normal'].every(key=>wearMaps[key]?.isTexture))))throw Error('Invalid PBR wear descriptor');
  if(![roughnessMacroContrast,roughnessMacroReference].every(x=>Number.isFinite(x)&&x>=0&&x<=1))throw Error('Invalid PBR macro roughness descriptor');
  if(constantBaseReflectance!==undefined){constantBaseReflectance=finite(constantBaseReflectance,3,'constant conductor reflectance');if(constantBaseReflectance.some(x=>x<0||x>1))throw Error('Invalid constant conductor reflectance');}
  return{tileMM,rotationRadians,offset,normalScale,anisotropy,anisotropyRotation,maxAnisotropy,colorMultiplier,mapping,chartKind,wearMaps,wearTileMM,wearAlloy,wearStrength,packedRoughMetal:packedRoughMetal===true,heightNormals,cavity,cavityStrength,roughnessMacroContrast,roughnessMacroReference,constantBaseReflectance};
}

/** Preserve the fine residual while reducing only the filtered macro field. */
export function pbrMacroRoughness({sample,macro,contrast=1,reference=.33}){
  if(![sample,macro,contrast,reference].every(Number.isFinite)||contrast<0||contrast>1||reference<0||reference>1)throw Error('Invalid PBR macro roughness response');
  return saturate(sample+(1-contrast)*(reference-macro));
}

function physicalMillimeters({uv,localPosition,chart,chartKind}){
  // Validate the native chart, then retain its original angular branch axis
  // even when the material group chooses a different chart reconstruction.
  const native=reconstructMetalFinishCoordinates({uv,localPosition,chart}),kind=chartKind??chart[0];
  let mm=native;
  if(chartKind!==undefined){
    const angular=uv[chart[0]===3?1:0],referenceUv=kind===3?[uv[0],angular]:[angular,uv[1]];
    mm=reconstructMetalFinishCoordinates({uv:kind===0?uv:referenceUv,localPosition,chart:[kind,chart[1]]});
  }
  return{mm,kind};
}
export function pbrUvFromMillimeters({uv,localPosition,chart,tileMM,rotationRadians=0,offset=[0,0],mapping='chart',chartKind}){
  const settings=descriptor({tileMM,rotationRadians,offset,mapping,chartKind});
  const {mm,kind}=physicalMillimeters({uv,localPosition,chart,chartKind}),c=Math.cos(rotationRadians),s=Math.sin(rotationRadians);
  if(mapping==='radialFace'&&kind===1)return[localPosition[1]/settings.tileMM[0]+.5+settings.offset[0],localPosition[2]/settings.tileMM[1]+.5+settings.offset[1]];
  const mapped=[(c*mm[0]+s*mm[1])/settings.tileMM[0],(-s*mm[0]+c*mm[1])/settings.tileMM[1]];
  if(kind>0){
    const angularLength=Math.max(chart[1],1e-8),angularAxis=kind===3?[s,c]:[c,-s];
    const desired=angularAxis.map((value,i)=>value*angularLength/settings.tileMM[i]);
    const closed=closedPolarRepeats(desired),turn=mm[kind===3?1:0]/angularLength;
    for(let i=0;i<2;i++)mapped[i]+=(closed[i]-desired[i])*turn;
  }
  return mapped.map((value,i)=>value+settings.offset[i]);
}

/** Independent macro coordinates and physical rim attenuation; no screen/time input. */
export function pbrWearCoordinates({uv,localPosition,chart,chartKind,tileMM=[128,128],phase=[.5,.5],bounds=[0,0]}){
  descriptor({tileMM,chartKind});phase=finite(phase,2,'wear phase');bounds=finite(bounds,2,'wear bounds');
  if(bounds.some(value=>value<0))throw Error('Invalid wear bounds');
  const {mm,kind}=physicalMillimeters({uv,localPosition,chart,chartKind});
  let mapped=mm.map((value,i)=>value/tileMM[i]+.5),edgeFade=1;
  if(kind===1)mapped=[localPosition[1]/tileMM[0]+.5,localPosition[2]/tileMM[1]+.5];
  else if(kind>1){
    const circumference=bounds[0]>0?2*Math.PI*bounds[0]:chart[1],repeats=Math.max(1,Math.floor(circumference/tileMM[0]+.5));
    mapped=[mm[kind===3?1:0]/Math.max(chart[1],1e-8)*repeats,localPosition[0]/tileMM[1]+.5];
  }
  const dimension=kind===1?bounds[0]:kind>1?bounds[1]:0;
  if(dimension>0){
    const distance=dimension-(kind===1?Math.hypot(localPosition[1],localPosition[2]):Math.abs(localPosition[0]));
    const width=Math.min(.15,Math.max(.05,dimension*.01));edgeFade=smoothstep(0,width,distance);
  }
  return{uv:kind>1?[mapped[0]+phase[0],mapped[1]+(phase[1]-.5)*.18]:mapped.map((value,i)=>value+(phase[i]-.5)*.22),edgeFade};
}

/** CPU mirror: samples are already linear, with color alpha independent of tint. */
export function pbrWearResponse({baseColor,roughness,metallic,anisotropy=0,color,surface,edgeFade=1,wearStrength=1}){
  baseColor=finite(baseColor,3,'clean linear reflectance');color=finite(color,4,'wear linear color');surface=finite(surface,4,'wear surface');
  if(![roughness,metallic,anisotropy,edgeFade,wearStrength].every(Number.isFinite)||wearStrength<0||wearStrength>1)throw Error('Invalid wear response');
  // Asset coverage controls opaque deposit area. Any enabled deposit core has
  // its full coating response; overall strength controls the thin films/pits.
  const rawOpaque=saturate(surface[1]),opaque=rawOpaque*saturate(edgeFade)*Number(wearStrength>0),film=saturate(surface[2])*wearStrength;
  const coverage=1-(1-opaque)*(1-film),colorBlend=Math.max(opaque,saturate(color[3])*(1-rawOpaque)*wearStrength);
  const resolvedRoughness=mix(roughness,saturate(surface[0]),coverage),resolvedAnisotropy=anisotropy*(1-opaque);
  return{color:baseColor.map((value,i)=>mix(value,color[i],colorBlend)),roughness:resolvedRoughness,metallic:metallic*(1-opaque),anisotropy:resolvedAnisotropy,coverage,colorBlend,alphaT:resolvedRoughness**2+(1-resolvedRoughness**2)*resolvedAnisotropy**2};
}

// A complete circle must traverse an integer texture-repeat vector. Keep the
// transverse scale exact and make the smallest angular scale/orientation change.
// A source tile wider than the circle still receives one dominant-axis repeat.
function closedPolarRepeats(desired){
  const closed=desired.map(value=>Math.floor(value+.5));
  if(closed[0]===0&&closed[1]===0){const axis=Math.abs(desired[0])>=Math.abs(desired[1])?0:1;closed[axis]=desired[axis]<0?-1:1;}
  return closed;
}

// Recover an orthonormal tangent frame while retaining the UV chart's handedness.
// This is also the CPU mirror used to verify rotated maps and polar end faces.
export function pbrTangentFrame({positionDx,positionDy,uvDx,uvDy,normal,axisX=[1,0,0],axisY=[0,1,0]}){
  const px=finite(positionDx,3,'surface X derivatives'),py=finite(positionDy,3,'surface Y derivatives'),ux=finite(uvDx,2,'texture X derivatives'),uy=finite(uvDy,2,'texture Y derivatives');
  const n=unit(finite(normal,3,'surface normal'));axisX=finite(axisX,3,'fallback X axis');axisY=finite(axisY,3,'fallback Y axis');
  if(length(n)<.5)throw Error('Invalid zero surface normal');
  const metricScale=Math.max(length(px),length(py),1e-8),q0=scale(px,1/metricScale),q1=scale(py,1/metricScale);
  const g00=dot(q0,q0),g01=dot(q0,q1),g11=dot(q1,q1),det=g00*g11-g01*g01;
  let t=[0,0,0],b=[0,0,0];
  if(g00*g11>1e-12&&det>1e-6*g00*g11){
    t=project(scale(add(scale(q0,g11*ux[0]-g01*uy[0]),scale(q1,g00*uy[0]-g01*ux[0])),1/(det*metricScale)),n);
    b=project(scale(add(scale(q0,g11*ux[1]-g01*uy[1]),scale(q1,g00*uy[1]-g01*ux[1])),1/(det*metricScale)),n);
  }
  const gradientU=t.slice(),gradientV=b.slice();
  if(dot(t,t)<1e-12){const x=project(axisX,n),y=project(axisY,n);t=dot(x,x)>dot(y,y)?x:y;}
  t=unit(t);
  const canonicalB=cross(n,t),handedness=dot(b,canonicalB)<0?-1:1;
  return{tangent:t,bitangent:scale(canonicalB,handedness),normal:n,handedness,gradientU,gradientV};
}
export function applyPbrNormal({sample,frame,normalScale=[1,1],faceDirection=1}){
  sample=finite(sample,3,'OpenGL normal sample');normalScale=finite(normalScale,2,'normal scale');
  if(![-1,1].includes(faceDirection))throw Error('Invalid face direction');
  const local=[(sample[0]*2-1)*normalScale[0],(sample[1]*2-1)*normalScale[1],sample[2]*2-1];
  // Match Three's DoubleSide handling: both tangent columns flip after its
  // surface normal has already flipped in normal_fragment_begin.
  return unit(add(add(scale(frame.tangent,local[0]*faceDirection),scale(frame.bitangent,local[1]*faceDirection)),scale(frame.normal,local[2])));
}

/** Height-derived map slopes live in source millimetres, not unit UV axes. */
export function applyPbrHeightNormal({sample,frame,tileMM,normalScale=[1,1],faceDirection=1}){
  sample=finite(sample,3,'height normal sample');tileMM=finite(tileMM,2,'height normal tile');normalScale=finite(normalScale,2,'height normal scale');
  if(![-1,1].includes(faceDirection)||tileMM.some(value=>value<=0)||normalScale.some(value=>value<0))throw Error('Invalid height normal descriptor');
  const u=finite(frame?.gradientU,3,'height U gradient'),v=finite(frame?.gradientV,3,'height V gradient'),n=finite(frame?.normal,3,'height surface normal');
  // Both RGB8 centre codes represent a flat height derivative. Retain this
  // neutral interval after mip filtering instead of tilting every flat sample.
  const slope=sample.slice(0,2).map(value=>{const decoded=value*2-1;return Math.abs(decoded)<=1/255+1e-6?0:decoded;});
  return unit(add(add(scale(u,slope[0]*normalScale[0]*tileMM[0]*faceDirection),scale(v,slope[1]*normalScale[1]*tileMM[1]*faceDirection)),scale(n,sample[2]*2-1)));
}

/** Match Three's native AO and GGX specular-occlusion response. */
export function pbrCavityResponse({sample,strength=1,dotNV,roughness}){
  if(![sample,strength,dotNV,roughness].every(Number.isFinite)||strength<0||strength>1||roughness<0||roughness>1)throw Error('Invalid PBR cavity descriptor');
  const ambientOcclusion=mix(1,saturate(sample),strength);
  return{ambientOcclusion,specularOcclusion:saturate((saturate(dotNV)+ambientOcclusion)**(2**(-16*roughness-1))-1+ambientOcclusion)};
}

/** Add physical pit and fine-height slopes in the same CAD tangent plane. */
export function composePbrWearNormal({fineNormal,baseNormal,sample,tileMM=[128,128],edgeFade=1,faceDirection=1,wearStrength=1,...derivatives}){
  fineNormal=unit(finite(fineNormal,3,'fine normal'));sample=finite(sample,3,'wear normal');tileMM=finite(tileMM,2,'wear tile size');
  if(![-1,1].includes(faceDirection)||![edgeFade,wearStrength].every(Number.isFinite)||wearStrength<0||wearStrength>1||tileMM.some(value=>value<=0)||length(fineNormal)<.5)throw Error('Invalid wear normal');
  const frame=pbrTangentFrame({...derivatives,normal:baseNormal}),base=frame.normal,fineSlope=scale(project(fineNormal,base),1/Math.max(dot(fineNormal,base),1e-5));
  const xy=sample.slice(0,2).map(value=>{const decoded=value*2-1;return Math.abs(decoded)<=1/255+1e-6?0:decoded;});
  const pitSlope=add(scale(frame.gradientU,xy[0]*tileMM[0]),scale(frame.gradientV,xy[1]*tileMM[1]));
  return unit(add(add(base,fineSlope),scale(pitSlope,faceDirection*saturate(edgeFade)*wearStrength/Math.max(sample[2]*2-1,.05))));
}

/** Return a raster-only index ordering and material groups; never mutate inputs. */
export function buildPbrMaterialGroups(geometry,{styleToMaterialIndex=[0,1,2,3,4],triangleMaterial}={}){
  const positions=geometry?.getAttribute?.('position'),styles=geometry?.getAttribute?.('metalStyle'),index=geometry?.getIndex?.();
  if(!positions||positions.itemSize!==3||!styles||styles.itemSize!==1||styles.count!==positions.count||!index||index.itemSize!==1||index.count%3)throw Error('PBR grouping requires indexed native metal geometry');
  if(![Uint16Array,Uint32Array].includes(index.array.constructor)||styleToMaterialIndex?.length!==5||!Array.from(styleToMaterialIndex).every(x=>Number.isInteger(x)&&x>=0))throw Error('Invalid PBR grouping indices or material map');
  if(triangleMaterial!==undefined&&typeof triangleMaterial!=='function')throw Error('Invalid PBR triangle material selector');
  const charts=geometry.getAttribute('metalChart');
  if(triangleMaterial&&(!charts||charts.itemSize!==2||charts.count!==positions.count))throw Error('PBR chart material selector requires metalChart attributes');
  const buckets=new Map(),styleCounts=Array(5).fill(0);
  for(let i=0;i<index.count;i+=3){
    const triangle=[index.getX(i),index.getX(i+1),index.getX(i+2)],votes=Array(5).fill(0);
    for(const vertex of triangle){
      if(!Number.isInteger(vertex)||vertex<0||vertex>=positions.count)throw Error('PBR triangle index outside native geometry');
      const style=styles.getX(vertex);if(!Number.isInteger(style)||style<0||style>4)throw Error('Invalid per-vertex PBR style');votes[style]++;
    }
    // Majority wins at a chart boundary; ties prefer the lowest style. Every
    // oriented triangle is retained exactly once regardless of classification.
    const selected=votes.indexOf(Math.max(...votes)),chartVotes=Array(4).fill(0),cornerStyles=triangle.map(vertex=>styles.getX(vertex));
    const cornerChartKinds=triangle.map(vertex=>charts?charts.getX(vertex):0);
    for(let corner=0;corner<3;corner++)if(cornerStyles[corner]===selected){
      const kind=cornerChartKinds[corner];if(!Number.isInteger(kind)||kind<0||kind>3)throw Error('Invalid per-vertex PBR chart kind');chartVotes[kind]++;
    }
    const chartKind=chartVotes.indexOf(Math.max(...chartVotes));
    const materialIndex=triangleMaterial?triangleMaterial({style:selected,chartKind,triangleIndex:i/3,indices:triangle.slice(),cornerStyles,cornerChartKinds}):styleToMaterialIndex[selected];
    if(!Number.isInteger(materialIndex)||materialIndex<0)throw Error('Invalid selected PBR triangle material');
    const key=`${selected}:${chartKind}:${materialIndex}`;
    if(!buckets.has(key))buckets.set(key,{style:selected,chartKind,materialIndex,indices:[]});
    buckets.get(key).indices.push(...triangle);styleCounts[selected]++;
  }
  const indices=new index.array.constructor(index.count),groups=[];let cursor=0;
  const ordered=Array.from(buckets.values()).sort((a,b)=>a.style-b.style||a.chartKind-b.chartKind||a.materialIndex-b.materialIndex);
  for(const bucket of ordered){
    indices.set(bucket.indices,cursor);groups.push({start:cursor,count:bucket.indices.length,materialIndex:bucket.materialIndex,style:bucket.style,chartKind:bucket.chartKind});cursor+=bucket.indices.length;
  }
  return{indices,groups,styleCounts,triangleCount:index.count/3};
}

const declarations=`
varying vec2 vPbrMetalUv,vPbrMetalChart;
varying vec3 vPbrMetalLocalPosition,vPbrMetalAxisX,vPbrMetalAxisY;
varying float vPbrMetalAngularReference;
uniform vec2 pbrMetalTileMM,pbrMetalRotation,pbrMetalOffset;
uniform vec2 pbrMetalFixedChartKind;
uniform float pbrMetalRadialFace;
float pbrMetalChartKind(){return pbrMetalFixedChartKind.x>.5?pbrMetalFixedChartKind.y:floor(vPbrMetalChart.x+.5);}
vec2 pbrMetalMillimeters(){
  vec2 mm=vPbrMetalUv;
  float kind=pbrMetalChartKind();
  if(kind>.5){
    float angularLength=max(vPbrMetalChart.y,1.e-8),radius=length(vPbrMetalLocalPosition.yz);
    float turn=radius>1.e-8?atan(vPbrMetalLocalPosition.z,vPbrMetalLocalPosition.y)/6.283185307179586:0.;
    turn+=floor(vPbrMetalAngularReference-turn+.5);
    mm=kind>2.5?vec2(vPbrMetalLocalPosition.x,turn*angularLength):vec2(turn*angularLength,kind<1.5?radius:vPbrMetalLocalPosition.x);
  }
  return mm;
}
vec2 pbrMetalCoordinates(vec2 mm){
  float kind=pbrMetalChartKind();
  if(pbrMetalRadialFace>.5&&kind>.5&&kind<1.5)return vPbrMetalLocalPosition.yz/pbrMetalTileMM+vec2(.5)+pbrMetalOffset;
  vec2 mapped=vec2(dot(mm,pbrMetalRotation),dot(mm,vec2(-pbrMetalRotation.y,pbrMetalRotation.x)))/pbrMetalTileMM;
  if(kind>.5){
    float angularLength=max(vPbrMetalChart.y,1.e-8);
    vec2 angularAxis=kind>2.5?vec2(pbrMetalRotation.y,pbrMetalRotation.x):vec2(pbrMetalRotation.x,-pbrMetalRotation.y);
    vec2 desired=angularAxis*angularLength/pbrMetalTileMM,closed=floor(desired+vec2(.5));
    if(dot(closed,closed)<.5){
      if(abs(desired.x)>=abs(desired.y))closed.x=desired.x<0.?-1.:1.;
      else closed.y=desired.y<0.?-1.:1.;
    }
    float turn=(kind>2.5?mm.y:mm.x)/angularLength;
    mapped+=(closed-desired)*turn;
  }
  return mapped+pbrMetalOffset;
}
vec3 pbrProject(vec3 a,vec3 n){return a-n*dot(a,n);}
mat3 pbrPhysicalTangentFrame(vec3 p,vec3 n,vec2 uv){
  vec3 px=dFdx(p),py=dFdy(p);vec2 ux=dFdx(uv),uy=dFdy(uv);
  float metricScale=max(max(length(px),length(py)),1.e-8);
  vec3 q0=px/metricScale,q1=py/metricScale;
  float g00=dot(q0,q0),g01=dot(q0,q1),g11=dot(q1,q1),det=g00*g11-g01*g01;
  vec3 t=vec3(0.),b=vec3(0.);
  if(g00*g11>1.e-12&&det>1.e-6*g00*g11){
    t=pbrProject(((g11*ux.x-g01*uy.x)*q0+(g00*uy.x-g01*ux.x)*q1)/(det*metricScale),n);
    b=pbrProject(((g11*ux.y-g01*uy.y)*q0+(g00*uy.y-g01*ux.y)*q1)/(det*metricScale),n);
  }
  if(dot(t,t)<1.e-12){vec3 x=pbrProject(vPbrMetalAxisX,n),y=pbrProject(vPbrMetalAxisY,n);t=dot(x,x)>dot(y,y)?x:y;}
  t*=inversesqrt(max(dot(t,t),1.e-12));
  vec3 canonicalB=cross(n,t);float handedness=dot(b,canonicalB)<0.?-1.:1.;
  return mat3(t,canonicalB*handedness,n);
}
`;
const wearDeclarations=`
varying vec2 vPbrWearPhase,vPbrWearBounds;
uniform vec2 pbrWearTileMM;
uniform float pbrWearStrength;
uniform sampler2D pbrWearColorMap,pbrWearSurfaceMap,pbrWearNormalMap;
vec2 pbrMetalWearCoordinates(vec2 mm){
  float kind=pbrMetalChartKind();vec2 uv=mm/pbrWearTileMM+vec2(.5);
  if(kind>.5&&kind<1.5)uv=vPbrMetalLocalPosition.yz/pbrWearTileMM+vec2(.5);
  else if(kind>1.5){
    float circumference=vPbrWearBounds.x>0.?6.283185307179586*vPbrWearBounds.x:vPbrMetalChart.y;
    float repeats=max(1.,floor(circumference/pbrWearTileMM.x+.5));
    uv=vec2((kind>2.5?mm.y:mm.x)/max(vPbrMetalChart.y,1.e-8)*repeats,vPbrMetalLocalPosition.x/pbrWearTileMM.y+.5);
  }
  if(kind>1.5)return uv+vec2(vPbrWearPhase.x,(vPbrWearPhase.y-.5)*.18);
  return uv+(vPbrWearPhase-vec2(.5))*.22;
}
float pbrMetalWearEdgeFade(){
  float kind=pbrMetalChartKind();if(kind<.5)return 1.;
  float dimension=kind<1.5?vPbrWearBounds.x:vPbrWearBounds.y;
  if(dimension<=0.)return 1.;
  float distance=dimension-(kind<1.5?length(vPbrMetalLocalPosition.yz):abs(vPbrMetalLocalPosition.x));
  float width=clamp(dimension*.01,.05,.15);
  return smoothstep(0.,width,distance);
}
`;
const metricGradientDeclarations=`
// Physical UV gradients convert a height-derived normal back to its millimetre
// slope. Closed macro repeats retain near-physical scale on each native part.
mat3 pbrPhysicalMapGradients(vec3 p,vec3 n,vec2 uv){
  vec3 px=dFdx(p),py=dFdy(p);vec2 ux=dFdx(uv),uy=dFdy(uv);
  float metricScale=max(max(length(px),length(py)),1.e-8);
  vec3 q0=px/metricScale,q1=py/metricScale;
  float g00=dot(q0,q0),g01=dot(q0,q1),g11=dot(q1,q1),det=g00*g11-g01*g01;
  vec3 u=vec3(0.),v=vec3(0.);
  if(g00*g11>1.e-12&&det>1.e-6*g00*g11){
    u=pbrProject(((g11*ux.x-g01*uy.x)*q0+(g00*uy.x-g01*ux.x)*q1)/(det*metricScale),n);
    v=pbrProject(((g11*ux.y-g01*uy.y)*q0+(g00*uy.y-g01*ux.y)*q1)/(det*metricScale),n);
  }
  return mat3(u,v,n);
}
`;
const heightNormalDeclarations=`
mat3 pbrPhysicalHeightFrame(vec3 p,vec3 n,vec2 uv){
  mat3 gradients=pbrPhysicalMapGradients(p,n,uv);
  return mat3(gradients[0]*pbrMetalTileMM.x,gradients[1]*pbrMetalTileMM.y,n);
}
`;
const wearInitialize=`
vec2 pbrWearUv=pbrMetalWearCoordinates(pbrGrainUv);
float pbrWearDepositFade=pbrMetalWearEdgeFade();
float pbrWearEdgeFade=pbrWearDepositFade*pbrWearStrength;
vec4 pbrWearColor=texture2D(pbrWearColorMap,pbrWearUv);
vec4 pbrWearSurface=texture2D(pbrWearSurfaceMap,pbrWearUv);
float pbrWearOpaque=clamp(pbrWearSurface.g,0.,1.)*pbrWearDepositFade*(pbrWearStrength>0.?1.:0.);
float pbrWearCoverage=1.-(1.-pbrWearOpaque)*(1.-clamp(pbrWearSurface.b,0.,1.)*pbrWearStrength);
float pbrWearColorBlend=max(pbrWearOpaque,clamp(pbrWearColor.a,0.,1.)*(1.-clamp(pbrWearSurface.g,0.,1.))*pbrWearStrength);
`;
const wearNormal=`
vec3 pbrWearMapN=texture2D(pbrWearNormalMap,pbrWearUv).xyz*2.-1.;
pbrWearMapN.xy*=step(vec2(1./255.+1.e-6),abs(pbrWearMapN.xy));
mat3 pbrWearFrame=pbrPhysicalMapGradients(-vViewPosition,nonPerturbedNormal,pbrWearUv);
#ifdef DOUBLE_SIDED
  pbrWearFrame[0]*=faceDirection;pbrWearFrame[1]*=faceDirection;
#endif
vec3 pbrFineSlope=(normal-nonPerturbedNormal*dot(normal,nonPerturbedNormal))/max(dot(normal,nonPerturbedNormal),1.e-5);
vec3 pbrPitSlope=(pbrWearFrame[0]*pbrWearMapN.x*pbrWearTileMM.x+pbrWearFrame[1]*pbrWearMapN.y*pbrWearTileMM.y)/max(pbrWearMapN.z,.05);
normal=normalize(nonPerturbedNormal+pbrFineSlope+pbrPitSlope*pbrWearEdgeFade);
`;
const cavityResponse=`
#ifdef USE_ROUGHNESSMAP
  // Fine cavity comes from the already filtered packed-RM sample. It affects
  // indirect light only; native CAD shadows continue to govern direct light.
  float pbrCavityOcclusion=mix(1.,clamp(texelRoughness.r,0.,1.),pbrCavityStrength);
  reflectedLight.indirectDiffuse*=pbrCavityOcclusion;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    reflectedLight.indirectSpecular*=computeSpecularOcclusion(saturate(dot(geometryNormal,geometryViewDir)),pbrCavityOcclusion,material.roughness);
  #endif
#endif
`;
const tangentBlock=/#ifdef USE_TANGENT\s+mat3 tbn = mat3\([\s\S]+?#else\s+mat3 tbn = getTangentFrame\([\s\S]+?\);\s+#endif/g;
function replaceChunk(fragment,THREE,name,transform=x=>x){
  const marker=`#include <${name}>`;
  if(fragment.split(marker).length!==2||typeof THREE.ShaderChunk[name]!=='string')throw Error(`Missing unique PBR ${name} hook`);
  return fragment.replace(marker,transform(THREE.ShaderChunk[name]));
}
export function bindPbrMetalShader(shader,{THREE,...options}){
  const settings=descriptor(options);
  if(!shader||typeof shader.vertexShader!=='string'||typeof shader.fragmentShader!=='string'||!shader.uniforms||!THREE?.ShaderChunk)throw Error('Missing native PBR shader contract');
  if(shader.fragmentShader.includes('vPbrMetalUv'))throw Error('PBR metal shader already bound');
  if(shader.fragmentShader.includes('metalFinishSine')||shader.fragmentShader.includes('machiningVariation'))throw Error('Remove procedural finish/roughness normalization before binding PBR maps');
  const vertexMarker='#include <begin_vertex>';if(shader.vertexShader.split(vertexMarker).length!==2)throw Error('Missing unique PBR vertex hook');
  const begin=THREE.ShaderChunk.normal_fragment_begin;
  if(typeof begin!=='string'||[...begin.matchAll(tangentBlock)].length!==1||!begin.includes('vec3 nonPerturbedNormal = normal;'))throw Error('Unsupported Three PBR normal frame ABI');
  let fragment=shader.fragmentShader;
  fragment=replaceChunk(fragment,THREE,'map_fragment',source=>'vec2 pbrGrainUv=pbrMetalMillimeters();\nvec2 pbrMapUv=pbrMetalCoordinates(pbrGrainUv);\n'+(settings.wearMaps?wearInitialize:'')+source.replaceAll('vMapUv','pbrMapUv')+(settings.constantBaseReflectance?'\ndiffuseColor.rgb=diffuse*pbrMetalConstantF0;\n':'')+(settings.wearMaps?'\ndiffuseColor.rgb=mix(diffuseColor.rgb,pbrWearColor.rgb,pbrWearColorBlend);\n':''));
  fragment=replaceChunk(fragment,THREE,'roughnessmap_fragment',source=>source.replaceAll('vRoughnessMapUv','pbrMapUv')+(settings.roughnessMacroContrast<1?`
  #ifdef USE_ROUGHNESSMAP
    vec2 pbrRoughnessResolution=vec2(textureSize(roughnessMap,0));
    float pbrMacroLod=log2(max(max(pbrRoughnessResolution.x/pbrMetalTileMM.x,pbrRoughnessResolution.y/pbrMetalTileMM.y)*${PBR_ROUGHNESS_MACRO_FOOTPRINT_MM.toFixed(1)},1.));
    float pbrRoughnessPixelLod=log2(max(max(length(dFdx(pbrMapUv)*pbrRoughnessResolution),length(dFdy(pbrMapUv)*pbrRoughnessResolution)),1.));
    float pbrMacroSample=textureLod(roughnessMap,pbrMapUv,max(pbrMacroLod,pbrRoughnessPixelLod)).g;
    roughnessFactor=clamp(roughnessFactor+(1.-pbrRoughnessMacro.x)*(pbrRoughnessMacro.y-pbrMacroSample),0.,1.);
  #endif`:'')+(settings.wearMaps?'\nroughnessFactor=mix(roughnessFactor,clamp(pbrWearSurface.r,0.,1.),pbrWearCoverage);\n':''));
  fragment=replaceChunk(fragment,THREE,'metalnessmap_fragment',source=>{
    source=source.replaceAll('vMetalnessMapUv','pbrMapUv');
    if(settings.packedRoughMetal){
      const sample='vec4 texelMetalness = texture2D( metalnessMap, pbrMapUv );';
      if(source.split(sample).length!==2||!THREE.ShaderChunk.roughnessmap_fragment.includes('vec4 texelRoughness = texture2D('))throw Error('Unsupported Three packed PBR map ABI');
      // Both native slots retain their loader-owned texture. The shared UV and
      // filtered RGBA read supply G roughness and B metallic independently.
      source=source.replace(sample,'#ifdef USE_ROUGHNESSMAP\n\tvec4 texelMetalness = texelRoughness;\n#else\n\t'+sample+'\n#endif');
    }
    return source+(settings.wearMaps?'\nmetalnessFactor*=1.-pbrWearOpaque;\n':'');
  });
  fragment=replaceChunk(fragment,THREE,'normal_fragment_begin',source=>source.replace(tangentBlock,`mat3 tbn = ${settings.heightNormals?'pbrPhysicalHeightFrame':'pbrPhysicalTangentFrame'}( - vViewPosition, normal, pbrMapUv );`));
  fragment=replaceChunk(fragment,THREE,'normal_fragment_maps',source=>{
    source=source.replaceAll('vNormalMapUv','pbrMapUv');
    if(settings.heightNormals){
      const scaleMarker='mapN.xy *= normalScale;';
      if(source.split(scaleMarker).length!==2)throw Error('Unsupported Three PBR height-normal decode ABI');
      source=source.replace(scaleMarker,'mapN.xy*=step(vec2(1./255.+1.e-6),abs(mapN.xy));\n\t'+scaleMarker);
    }
    return source+(settings.wearMaps?'\n'+wearNormal:'');
  });
  if(settings.cavity){
    const marker='#include <aomap_fragment>';
    if(fragment.split(marker).length!==2||!THREE.ShaderChunk.aomap_fragment?.includes('computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness )'))throw Error('Unsupported Three PBR cavity ABI');
    fragment=fragment.replace(marker,marker+'\n'+cavityResponse);
  }
  const physicalMarker='#include <lights_physical_fragment>';
  if(fragment.split(physicalMarker).length!==2||!THREE.ShaderChunk.lights_physical_fragment?.includes('material.anisotropyT = tbn'))throw Error('Unsupported Three PBR anisotropy frame ABI');
  fragment=fragment.replace(physicalMarker,`${physicalMarker}
  #ifdef USE_ANISOTROPY
    ${settings.wearMaps?'material.anisotropy*=1.-pbrWearOpaque;\n    material.alphaT=mix(pow2(material.roughness),1.,pow2(material.anisotropy));':''}
    // Source image orientation controls the mapped normal frame. The physical
    // part chart independently supplies the grain direction for GGX lighting.
    mat3 pbrGrainFrame=pbrPhysicalTangentFrame(-vViewPosition,normal,pbrGrainUv);
    material.anisotropyT=pbrGrainFrame[0]*anisotropyV.x+pbrGrainFrame[1]*anisotropyV.y;
    material.anisotropyB=pbrGrainFrame[1]*anisotropyV.x-pbrGrainFrame[0]*anisotropyV.y;
  #endif`);
  const wearVertex=settings.wearMaps?'attribute vec2 metalWearPhase,metalWearBounds;\nvarying vec2 vPbrWearPhase,vPbrWearBounds;\n':'';
  shader.vertexShader='attribute vec2 metalUv,metalChart;\nattribute vec3 metalLocalPosition;\nvarying vec2 vPbrMetalUv,vPbrMetalChart;\nvarying vec3 vPbrMetalLocalPosition,vPbrMetalAxisX,vPbrMetalAxisY;\nvarying float vPbrMetalAngularReference;\n'+wearVertex+shader.vertexShader.replace(vertexMarker,`${vertexMarker}\n vPbrMetalUv=metalUv;vPbrMetalChart=metalChart;vPbrMetalLocalPosition=metalLocalPosition;\n vPbrMetalAngularReference=(metalChart.x>2.5?metalUv.y:metalUv.x)/max(metalChart.y,1.e-8);\n vPbrMetalAxisX=mat3(modelViewMatrix)*vec3(1.,0.,0.);vPbrMetalAxisY=mat3(modelViewMatrix)*vec3(0.,1.,0.);\n${settings.wearMaps?'vPbrWearPhase=metalWearPhase;vPbrWearBounds=metalWearBounds;':''}`);
  shader.fragmentShader=declarations+((settings.heightNormals||settings.wearMaps)?metricGradientDeclarations:'')+(settings.heightNormals?heightNormalDeclarations:'')+(settings.wearMaps?wearDeclarations:'')+(settings.cavity?'uniform float pbrCavityStrength;\n':'')+(settings.roughnessMacroContrast<1?'uniform vec2 pbrRoughnessMacro;\n':'')+(settings.constantBaseReflectance?'uniform vec3 pbrMetalConstantF0;\n':'')+fragment;
  Object.assign(shader.uniforms,{pbrMetalTileMM:{value:new THREE.Vector2(...settings.tileMM)},pbrMetalRotation:{value:new THREE.Vector2(Math.cos(settings.rotationRadians),Math.sin(settings.rotationRadians))},pbrMetalOffset:{value:new THREE.Vector2(...settings.offset)},pbrMetalRadialFace:{value:Number(settings.mapping==='radialFace')},pbrMetalFixedChartKind:{value:new THREE.Vector2(Number(settings.chartKind!==undefined),settings.chartKind??0)}});
  if(settings.wearMaps)Object.assign(shader.uniforms,{pbrWearTileMM:{value:new THREE.Vector2(...settings.wearTileMM)},pbrWearStrength:{value:settings.wearStrength},pbrWearColorMap:{value:settings.wearMaps.color},pbrWearSurfaceMap:{value:settings.wearMaps.surface},pbrWearNormalMap:{value:settings.wearMaps.normal}});
  if(settings.cavity)shader.uniforms.pbrCavityStrength={value:settings.cavityStrength};
  if(settings.roughnessMacroContrast<1)shader.uniforms.pbrRoughnessMacro={value:new THREE.Vector2(settings.roughnessMacroContrast,settings.roughnessMacroReference)};
  if(settings.constantBaseReflectance)shader.uniforms.pbrMetalConstantF0={value:new THREE.Vector3(...settings.constantBaseReflectance)};
  return true;
}

/** Configure a dedicated active profile material. Keep style 0 on its original. */
export function configurePbrMetal(material,{THREE,maps,sourceMetadata,...options}){
  const settings=descriptor({...options,packedRoughMetal:maps?.roughness?.isTexture&&maps.roughness===maps.metallic});
  if(!material?.isMeshPhysicalMaterial||!THREE?.SRGBColorSpace||!maps||!['baseColor','normal','roughness','metallic'].every(key=>maps[key]?.isTexture))throw Error('PBR metals require a physical material and four native textures');
  if(material.userData?.pbrMetal)throw Error('PBR material already configured');
  for(const [key,texture]of Object.entries(maps))if(['baseColor','normal','roughness','metallic'].includes(key)){
    texture.colorSpace=key==='baseColor'?THREE.SRGBColorSpace:THREE.NoColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
    texture.generateMipmaps=true;texture.anisotropy=Math.min(8,settings.maxAnisotropy);texture.needsUpdate=true;
  }
  if(settings.wearMaps)for(const[key,texture]of Object.entries(settings.wearMaps))if(['color','surface','normal'].includes(key)){
    texture.colorSpace=key==='color'?THREE.SRGBColorSpace:THREE.NoColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
    texture.generateMipmaps=true;texture.anisotropy=Math.min(8,settings.maxAnisotropy);texture.needsUpdate=true;
  }
  material.map=maps.baseColor;material.normalMap=maps.normal;material.roughnessMap=maps.roughness;material.metalnessMap=maps.metallic;
  material.normalMapType=THREE.TangentSpaceNormalMap;material.normalScale.set(...settings.normalScale);
  material.color.setRGB(...settings.colorMultiplier);material.roughness=1;material.metalness=1;
  material.anisotropy=settings.anisotropy;material.anisotropyRotation=settings.anisotropyRotation;
  const previousCompile=material.onBeforeCompile,previousKey=material.customProgramCacheKey.bind(material);
  material.onBeforeCompile=function(shader,renderer){previousCompile.call(this,shader,renderer);bindPbrMetalShader(shader,{THREE,...settings});};
  material.customProgramCacheKey=()=>`${previousKey()}-${PBR_METAL_VERSION}-${settings.wearMaps?'wear':'clean'}-${settings.packedRoughMetal?'packed':'separate'}-${settings.heightNormals?'height':'tangent'}-${settings.cavity?'cavity':'open'}-${settings.roughnessMacroContrast<1?'macro':'full'}-${settings.constantBaseReflectance?'constant-f0':'mapped-f0'}`;
  material.userData.pbrMetal={version:PBR_METAL_VERSION,packedRoughMetal:settings.packedRoughMetal,heightNormals:settings.heightNormals,normalInterpretation:settings.heightNormals?'Height derivatives in source millimetres':'Generic tangent-space direction',tileMM:settings.tileMM,polarScale:'Nearest integer complete-image repeats per circumference',mapping:settings.mapping,chartKind:settings.chartKind??null,rotationRadians:settings.rotationRadians,normalConvention:'OpenGL tangent +Y',mapChannels:{baseColor:'sRGB RGB',normal:'linear RGB',roughness:'linear green',metallic:'linear blue'},sourceMetadata:sourceMetadata??null};
  if(settings.cavity)material.userData.pbrMetal.cavity={channel:'roughnessMap linear red',strength:settings.cavityStrength,scope:'Indirect diffuse and native GGX specular occlusion'};
  if(settings.roughnessMacroContrast<1)material.userData.pbrMetal.roughnessMacro={contrast:settings.roughnessMacroContrast,reference:settings.roughnessMacroReference,footprintMM:PBR_ROUGHNESS_MACRO_FOOTPRINT_MM,fineResidualPreserved:true,scope:'Fine map base roughness before independent wear'};
  if(settings.constantBaseReflectance)material.userData.pbrMetal.constantBaseReflectance={linearRGB:[...settings.constantBaseReflectance],scope:'Clean conductor reflectance before alloy multiplier and independent wear'};
  if(settings.wearMaps)material.userData.pbrMetal.wear={alloy:settings.wearAlloy,tileMM:settings.wearTileMM,strength:settings.wearStrength,coordinates:'part-local mm; nearest integer macro repeats per circumference',mapChannels:{color:'sRGB contaminant RGB; alpha thin-film blend, opaque G controls deposit blend',surface:'linear roughness R; full-response opaque G; thin-film B',normal:'linear OpenGL physical pits'},edgeFadeMM:[.05,.15],strengthSemantics:'Thin-film/pit blend; opaque deposit response retained for nonzero strength; zero disables all wear'};
  material.needsUpdate=true;return material;
}

// Native Material disposal deliberately retains shared texture ownership.
export function disposePbrMetal(material){if(!material?.userData?.pbrMetal)throw Error('Not a configured PBR material');material.dispose();}
