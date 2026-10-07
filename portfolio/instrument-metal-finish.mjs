// Authored physical surface detail. Coordinates and heights are millimeters;
// lighting remains entirely in Three's physical material and GGX shader.
export const METAL_FINISH_VERSION='physical-grain-v3';
export const METAL_FINISH_MAX_SLOPE=.45;
export const METAL_FINISH_ROUGHNESS_LIMIT=.08;
export const METAL_FINISH_FILTER_START=.18;
export const METAL_FINISH_FILTER_END=.5;
export const METAL_FINISH_CROSSED_ANISOTROPY_SCALE=.18;
export const METAL_FINISH_PROFILES=Object.freeze({
  1:Object.freeze({name:'brushed',pitch:.12,finePitch:.083,coarsePitch:.48,height:.0024,fineHeight:.0008,coarseHeight:.0012,roughness:.014,coarseRoughness:.015}),
  2:Object.freeze({name:'turned',pitch:.16,finePitch:.103,coarsePitch:.5,height:.0024,fineHeight:.0008,coarseHeight:.0038,roughness:.016,coarseRoughness:.036}),
  3:Object.freeze({name:'diamond knurl',pitch:1,height:.045,roughness:.04}),
  4:Object.freeze({name:'fine etching',pitch:.65,height:.012,roughness:.04})
});
const TAU=2*Math.PI,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const grooveCoefficients=[56/128,28/128,8/128,1/128];
const glslFloat=value=>Number.isInteger(value)?`${value}.0`:String(value);
const brush=METAL_FINISH_PROFILES[1],turned=METAL_FINISH_PROFILES[2],knurl=METAL_FINISH_PROFILES[3],etch=METAL_FINISH_PROFILES[4];
const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
const add=(a,b)=>a.map((value,i)=>value+b[i]);
const scale=(a,f)=>a.map(value=>value*f);
const length=a=>Math.hypot(...a);
const normalize=a=>scale(a,1/Math.max(length(a),1e-12));
const tangent=(axis,n)=>add(axis,scale(n,-dot(axis,n)));
function finiteVector(value,size,label){if(value?.length!==size||!Array.from(value).every(Number.isFinite))throw Error(`Invalid ${label}`);return Array.from(value);}

export function metalFinishResolution(footprint){
  if(!Number.isFinite(footprint)||footprint<0)throw Error('Invalid finish footprint');
  const t=clamp((footprint-METAL_FINISH_FILTER_START)/(METAL_FINISH_FILTER_END-METAL_FINISH_FILTER_START),0,1);
  return 1-t*t*(3-2*t);
}
// Radius and angle are nonlinear fields. Reconstruct them after Cartesian
// interpolation so a large flat CAD triangle keeps truly concentric rings.
export function reconstructMetalFinishCoordinates({uv,localPosition,chart}){
  uv=finiteVector(uv,2,'finish coordinates');
  const position=finiteVector(localPosition,3,'local finish position'),[kind,angularLength]=finiteVector(chart,2,'finish chart');
  if(!Number.isInteger(kind)||kind<0||kind>3||angularLength<0||(kind>0&&angularLength<=0))throw Error('Invalid analytic finish chart');
  if(kind===0)return uv;
  const radius=Math.hypot(position[1],position[2]);
  let turn=radius>1e-8?Math.atan2(position[2],position[1])/TAU:0;
  const reference=uv[kind===3?1:0]/angularLength;
  turn+=Math.floor(reference-turn+.5);
  return kind===3?[position[0],turn*angularLength]:[turn*angularLength,kind===1?radius:position[0]];
}
export function metalFinishAnisotropy({style,anisotropy,roughness}){
  if(!Number.isInteger(style)||style<0||style>4||![anisotropy,roughness].every(Number.isFinite)||anisotropy<0||anisotropy>1||roughness<0||roughness>1)throw Error('Invalid finish anisotropy');
  const amount=style===0?0:anisotropy*(style>=3?METAL_FINISH_CROSSED_ANISOTROPY_SCALE:1);
  return{anisotropy:amount,alphaT:roughness*roughness+(1-roughness*roughness)*amount*amount};
}
function sampleBand({coordinate,gradient,pitch,height,roughness=0,phase=0,dx,dy,groove=false}){
  const footprint=(Math.abs(dot(gradient,dx))+Math.abs(dot(gradient,dy)))/pitch,angle=TAU*coordinate/pitch+phase;
  let h=0,slope=0,variation=0;
  if(groove){
    // Fourier form of ((1+cos(x))/2)^4 minus its exact mean. Each harmonic
    // has its own low-pass weight, including the sharp incised channel sides.
    for(let i=0;i<grooveCoefficients.length;i++){
      const harmonic=i+1,coefficient=grooveCoefficients[i],resolved=metalFinishResolution(footprint*harmonic);
      h-=height*coefficient*Math.cos(angle*harmonic)*resolved;
      slope+=height*coefficient*harmonic*TAU/pitch*Math.sin(angle*harmonic)*resolved;
      variation+=roughness*coefficient*Math.cos(angle*harmonic)*resolved;
    }
  }else{
    const resolved=metalFinishResolution(footprint);
    h=height*Math.sin(angle)*resolved;slope=height*TAU/pitch*Math.cos(angle)*resolved;
    variation=roughness*Math.sin(angle)*resolved;
  }
  return{height:h,slope:scale(gradient,slope),variation};
}
// CPU mirror: hold local filter weights constant when taking analytic slopes,
// so changing pixel resolution itself cannot create false surface ridges.
export function evaluateMetalFinish({u,v,style,dx=[0,0],dy=[0,0],roughness=.3}){
  if(![u,v,roughness].every(Number.isFinite)||roughness<0||roughness>1||!Number.isInteger(style)||style<0||style>4)throw Error('Invalid physical metal finish sample');
  dx=finiteVector(dx,2,'finish X derivatives');dy=finiteVector(dy,2,'finish Y derivatives');
  if(style===0)return{height:0,slope:[0,0],variation:0,roughness};
  const profile=METAL_FINISH_PROFILES[style];let bands;
  if(style>=3){
    bands=[[u+v,[1,1]],[u-v,[1,-1]]].map(([coordinate,gradient])=>sampleBand({coordinate,gradient,...profile,dx,dy,groove:true}));
  }else{
    // Turned height and roughness depend only on V, even at an angular seam.
    const warp=style===1?.0065*Math.sin(TAU*u/3.7)+.003*Math.sin(TAU*u/1.31):0;
    const warpSlope=style===1?.0065*TAU/3.7*Math.cos(TAU*u/3.7)+.003*TAU/1.31*Math.cos(TAU*u/1.31):0;
    bands=[
      sampleBand({coordinate:v+warp,gradient:[warpSlope,1],pitch:profile.pitch,height:profile.height,roughness:profile.roughness,dx,dy}),
      sampleBand({coordinate:v+warp*.5,gradient:[warpSlope*.5,1],pitch:profile.finePitch,height:profile.fineHeight,phase:1.71,dx,dy}),
      sampleBand({coordinate:v+warp,gradient:[warpSlope,1],pitch:profile.coarsePitch,height:profile.coarseHeight,roughness:profile.coarseRoughness,phase:.37,dx,dy})
    ];
  }
  const slope=bands.reduce((a,band)=>add(a,band.slope),[0,0]);
  const variation=clamp(bands.reduce((sum,band)=>sum+band.variation,0),-METAL_FINISH_ROUGHNESS_LIMIT,METAL_FINISH_ROUGHNESS_LIMIT);
  return{height:bands.reduce((sum,band)=>sum+band.height,0),slope,variation,roughness:clamp(roughness*(1+variation),0,1)};
}
export function metalFinishMetric({positionDx,positionDy,uvDx,uvDy,normal}){
  const px=finiteVector(positionDx,3,'surface X derivatives'),py=finiteVector(positionDy,3,'surface Y derivatives');
  const ux=finiteVector(uvDx,2,'finish X derivatives'),uy=finiteVector(uvDy,2,'finish Y derivatives');
  const n=normalize(finiteVector(normal,3,'surface normal'));if(length(n)<.5)throw Error('Invalid zero surface normal');
  const metricScale=Math.max(length(px),length(py),1e-8),q0=scale(px,1/metricScale),q1=scale(py,1/metricScale);
  const g00=dot(q0,q0),g01=dot(q0,q1),g11=dot(q1,q1),det=g00*g11-g01*g01;
  const valid=g00*g11>1e-12&&det>1e-6*g00*g11;
  const gradients=valid?[0,1].map(i=>tangent(scale(add(scale(q0,g11*ux[i]-g01*uy[i]),scale(q1,g00*uy[i]-g01*ux[i])),1/(det*metricScale)),n)):[[0,0,0],[0,0,0]];
  return{gradientU:gradients[0],gradientV:gradients[1],valid};
}
export function perturbMetalFinishNormal({normal,slope,gradientU,gradientV,faceDirection=1}){
  const n=normalize(finiteVector(normal,3,'surface normal')),s=finiteVector(slope,2,'height slope');
  const u=finiteVector(gradientU,3,'U gradient'),v=finiteVector(gradientV,3,'V gradient');
  if(length(n)<.5||![-1,1].includes(faceDirection))throw Error('Invalid finish normal orientation');
  let offset=add(scale(u,s[0]),scale(v,s[1]));offset=scale(offset,Math.min(1,METAL_FINISH_MAX_SLOPE/Math.max(length(offset),1e-8)));
  return normalize(add(n,scale(offset,-faceDirection)));
}

const vertexDeclarations=`
attribute vec2 metalUv;
attribute float metalStyle;
attribute vec3 metalLocalPosition;
attribute vec2 metalChart;
varying vec2 vMetalFinishUv;
varying float vMetalFinishStyle;
varying vec3 vMetalFinishLocalPosition;
varying vec2 vMetalFinishChart;
varying vec3 vMetalFinishAxisX,vMetalFinishAxisY;
`;
const fragmentDeclarations=`
varying vec2 vMetalFinishUv;
varying float vMetalFinishStyle;
varying vec3 vMetalFinishLocalPosition;
varying vec2 vMetalFinishChart;
varying vec3 vMetalFinishAxisX,vMetalFinishAxisY;
vec2 metalFinishCoordinates(){
  vec2 coordinate=vMetalFinishUv;
  float kind=floor(vMetalFinishChart.x+.5);
  if(kind>.5){
    float angularLength=max(vMetalFinishChart.y,1.e-8);
    vec3 local=vMetalFinishLocalPosition;
    float radius=length(local.yz);
    float turn=radius>1.e-8?atan(local.z,local.y)/6.283185307179586:0.;
    float reference=(kind>2.5?coordinate.y:coordinate.x)/angularLength;
    turn+=floor(reference-turn+.5);
    coordinate=kind>2.5?vec2(local.x,turn*angularLength):vec2(turn*angularLength,kind<1.5?radius:local.x);
  }
  return coordinate;
}
float metalFinishFilter(float footprint){return 1.-smoothstep(${METAL_FINISH_FILTER_START},${METAL_FINISH_FILTER_END},footprint);}
vec4 metalFinishSine(float coordinate,vec2 gradient,float pitch,float height,float variation,float offset){
  float phase=coordinate/pitch,resolved=metalFinishFilter(fwidth(phase));
  float angle=6.283185307179586*phase+offset;
  return vec4(height*sin(angle),height*6.283185307179586/pitch*cos(angle)*gradient,variation*sin(angle))*resolved;
}
vec4 metalFinishGroove(float coordinate,vec2 gradient,float pitch,float height,float variation){
  float phase=coordinate/pitch,footprint=fwidth(phase),angle=6.283185307179586*phase;
  vec4 result=vec4(0.);
  for(int i=0;i<4;i++){
    float k=float(i+1),coefficient=i==0?.4375:i==1?.21875:i==2?.0625:.0078125;
    float resolved=metalFinishFilter(footprint*k);
    result+=vec4(-height*coefficient*cos(k*angle),height*coefficient*k*6.283185307179586/pitch*sin(k*angle)*gradient,variation*coefficient*cos(k*angle))*resolved;
  }
  return result;
}
vec3 metalFinishProject(vec3 axis,vec3 n){return axis-n*dot(axis,n);}
vec3 metalFinishFallback(vec3 n){
  vec3 x=metalFinishProject(vMetalFinishAxisX,n),y=metalFinishProject(vMetalFinishAxisY,n);
  vec3 axis=dot(x,x)>dot(y,y)?x:y;
  return axis*inversesqrt(max(dot(axis,axis),1.e-12));
}
`;
const normalChunk=`
// Radius and angle come from Cartesian position, before any derivatives.
vec2 metalCoordinates=metalFinishCoordinates();
// The normalized Gram matrix recovers true millimeter slopes at any scale.
vec3 metalPx=dFdx(-vViewPosition),metalPy=dFdy(-vViewPosition);
vec2 metalUx=dFdx(metalCoordinates),metalUy=dFdy(metalCoordinates);
float metalMetricScale=max(max(length(metalPx),length(metalPy)),1.e-8);
vec3 metalQ0=metalPx/metalMetricScale,metalQ1=metalPy/metalMetricScale;
float metalG00=dot(metalQ0,metalQ0),metalG01=dot(metalQ0,metalQ1),metalG11=dot(metalQ1,metalQ1);
float metalDet=metalG00*metalG11-metalG01*metalG01;
vec3 metalGradU=vec3(0.),metalGradV=vec3(0.);
if(metalG00*metalG11>1.e-12&&metalDet>1.e-6*metalG00*metalG11){
  metalGradU=((metalG11*metalUx.x-metalG01*metalUy.x)*metalQ0+(metalG00*metalUy.x-metalG01*metalUx.x)*metalQ1)/(metalDet*metalMetricScale);
  metalGradV=((metalG11*metalUx.y-metalG01*metalUy.y)*metalQ0+(metalG00*metalUy.y-metalG01*metalUx.y)*metalQ1)/(metalDet*metalMetricScale);
  metalGradU=metalFinishProject(metalGradU,normal);metalGradV=metalFinishProject(metalGradV,normal);
}
float metalKind=floor(vMetalFinishStyle+.5),metalEnabled=step(.5,metalKind);
float metalTurned=1.-step(.5,abs(metalKind-2.)),metalCrossed=step(2.5,metalKind),metalEtched=step(3.5,metalKind);
float metalU=metalCoordinates.x,metalV=metalCoordinates.y;
float metalWarp=(1.-metalTurned)*(.0065*sin(6.283185307179586*metalU/3.7)+.003*sin(6.283185307179586*metalU/1.31));
float metalWarpSlope=(1.-metalTurned)*(.0065*6.283185307179586/3.7*cos(6.283185307179586*metalU/3.7)+.003*6.283185307179586/1.31*cos(6.283185307179586*metalU/1.31));
vec4 metalGrain=metalFinishSine(metalV+metalWarp,vec2(metalWarpSlope,1.),mix(${glslFloat(brush.pitch)},${glslFloat(turned.pitch)},metalTurned),mix(${glslFloat(brush.height)},${glslFloat(turned.height)},metalTurned),mix(${glslFloat(brush.roughness)},${glslFloat(turned.roughness)},metalTurned),0.);
metalGrain+=metalFinishSine(metalV+.5*metalWarp,vec2(.5*metalWarpSlope,1.),mix(${glslFloat(brush.finePitch)},${glslFloat(turned.finePitch)},metalTurned),mix(${glslFloat(brush.fineHeight)},${glslFloat(turned.fineHeight)},metalTurned),0.,1.71);
metalGrain+=metalFinishSine(metalV+metalWarp,vec2(metalWarpSlope,1.),mix(${glslFloat(brush.coarsePitch)},${glslFloat(turned.coarsePitch)},metalTurned),mix(${glslFloat(brush.coarseHeight)},${glslFloat(turned.coarseHeight)},metalTurned),mix(${glslFloat(brush.coarseRoughness)},${glslFloat(turned.coarseRoughness)},metalTurned),.37);
float metalCrossPitch=mix(${glslFloat(knurl.pitch)},${glslFloat(etch.pitch)},metalEtched),metalCrossHeight=mix(${glslFloat(knurl.height)},${glslFloat(etch.height)},metalEtched),metalCrossVariation=mix(${glslFloat(knurl.roughness)},${glslFloat(etch.roughness)},metalEtched);
vec4 metalChannels=metalFinishGroove(metalU+metalV,vec2(1.,1.),metalCrossPitch,metalCrossHeight,metalCrossVariation);
metalChannels+=metalFinishGroove(metalU-metalV,vec2(1.,-1.),metalCrossPitch,metalCrossHeight,metalCrossVariation);
vec4 metalSample=mix(metalGrain,metalChannels,metalCrossed)*metalEnabled;
vec3 metalHeightGradient=metalGradU*metalSample.y+metalGradV*metalSample.z;
metalHeightGradient*=min(1.,${METAL_FINISH_MAX_SLOPE}/max(length(metalHeightGradient),1.e-8));
normal=normalize(normal-faceDirection*metalHeightGradient);
roughnessFactor=clamp(roughnessFactor*(1.+clamp(metalSample.w,-${METAL_FINISH_ROUGHNESS_LIMIT},${METAL_FINISH_ROUGHNESS_LIMIT})),0.,1.);
vec3 metalFinishAcross=metalFinishProject(metalGradV,normal);
if(dot(metalFinishAcross,metalFinishAcross)<1.e-10)metalFinishAcross=cross(normal,metalFinishFallback(normal));
metalFinishAcross*=inversesqrt(max(dot(metalFinishAcross,metalFinishAcross),1.e-12));
`;
const physicalChunk=`
#ifdef USE_ANISOTROPY
  // Three's alphaT is its broad GGX axis, across the scratch direction.
  material.anisotropyT=metalFinishAcross;
  material.anisotropyB=normalize(cross(normal,metalFinishAcross));
  // Shared batches contain protected seals/felt with style 0. Keep those
  // isotropic; crossed grooves also approach isotropy at unresolved scales.
  material.anisotropy*=metalEnabled*mix(1.,${glslFloat(METAL_FINISH_CROSSED_ANISOTROPY_SCALE)},metalCrossed);
  material.alphaT=mix(pow2(material.roughness),1.,pow2(material.anisotropy));
#endif
`;
function uniqueMarker(source,marker,label){if(source.split(marker).length!==2)throw Error(`Missing unique ${label} shader hook`);}
export function bindMetalFinish(shader,{THREE}={}){
  if(!shader||typeof shader.vertexShader!=='string'||typeof shader.fragmentShader!=='string')throw Error('Missing physical finish shader');
  if(!THREE?.ShaderChunk?.normal_fragment_begin?.includes('vec3 nonPerturbedNormal = normal;')||!THREE.ShaderChunk.lights_physical_fragment?.includes('material.alphaT'))throw Error('Unsupported Three physical finish shader ABI');
  if(shader.fragmentShader.includes('vMetalFinishStyle'))throw Error('Physical finish already bound');
  uniqueMarker(shader.vertexShader,'#include <begin_vertex>','vertex begin');
  uniqueMarker(shader.fragmentShader,'#include <normal_fragment_maps>','normal');
  uniqueMarker(shader.fragmentShader,'#include <lights_physical_fragment>','physical material');
  shader.vertexShader=vertexDeclarations+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    vMetalFinishUv=metalUv;vMetalFinishStyle=metalStyle;
    vMetalFinishLocalPosition=metalLocalPosition;vMetalFinishChart=metalChart;
    vMetalFinishAxisX=mat3(modelViewMatrix)*vec3(1.,0.,0.);
    vMetalFinishAxisY=mat3(modelViewMatrix)*vec3(0.,1.,0.);`);
  shader.fragmentShader=fragmentDeclarations+shader.fragmentShader
    .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>\n${normalChunk}`)
    .replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>\n${physicalChunk}`);
  return true;
}
