import {IRIS09_MECHANICS,iris09MechanicalBladeContains,iris09MechanicalBladeContour,iris09MechanicalFrame,solveIris09Input} from './iris09-kinematics.mjs';

/**
 * Raster finishes for the recovered IRIS / 09 Revision III geometry.
 *
 * The original shader remains the reference. This adapter retains its finish
 * colors, machining scales, vector inscriptions and studio source positions;
 * it deliberately replaces per-pixel ray traversal with mesh visibility and
 * a once-prefiltered radiance environment. It is not equivalent transport.
 */
export const IRIS09_EMITTERS = Object.freeze([
  Object.freeze({position: [-3.6, 4.1, -3.1], size: [1.45, 2.15], color: [3.4, 3.3, 3.15]}),
  Object.freeze({position: [3.1, 2.9, -2.4], size: [.36, 1.45], color: [3, 3.15, 3.4]}),
  Object.freeze({position: [.2, 1.8, 4.5], size: [2.4, 1], color: [1.3, 1.35, 1.4]}),
]);

export const IRIS09_FINISHES = Object.freeze({
  1: {name: 'IRIS09 / satin black anodizing', color: [.014, .017, .020], roughness: .325, metalness: 0, anisotropy: 0},
  2: {name: 'IRIS09 / turned alloy', color: [.54, .565, .59], roughness: .285, metalness: 1, anisotropy: .71},
  3: {name: 'IRIS09 / turned brass', color: [.79, .535, .254], roughness: .244, metalness: 1, anisotropy: .43},
  4: {name: 'IRIS09 / captive steel', color: [.59, .615, .635], roughness: .235, metalness: 1, anisotropy: .40},
  5: {name: 'IRIS09 / black seals', color: [.005, .006, .007], roughness: .46, metalness: 0, anisotropy: 0},
  8: {name: 'IRIS09 / iris leaves', color: [.055, .059, .065], roughness: .42, metalness: .72, anisotropy: .48},
});
// Union of original radial support: tick start 1.170-.002, outer register
// ending at1.458, and lettering [1.3064,1.3876]. Outside this interval every
// source mask is identically zero regardless of screen-space footprint.
export const IRIS09_ENGRAVING_RADIAL_BOUNDS = Object.freeze([1.168, 1.458]);

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => {const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t);};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalized = a => {const l = Math.hypot(...a); return a.map(x => x / l);};
const lightFrames = IRIS09_EMITTERS.map(light => {
  const n = normalized([-light.position[0], .20 - light.position[1], -light.position[2]]);
  const u = normalized(cross([0, 1, 0], n));
  return {...light, n, u, v: cross(n, u)};
});
const flagDirection = normalized([-.92, .12, .36]);

// Integrate the original diffusion-cloth profile, emitter cosine and inverse
// square falloff once. Using area / center-distance alone over-counted the
// large key, even before the former duplicate diffuse IBL contribution.
export function iris09EmitterIrradiance(index, origin = [0, .20, 0], steps = 24) {
  const light = lightFrames[index], integral = [0, 0, 0];
  if (!light) throw new RangeError('Unknown IRIS emitter');
  const dArea = 4 * light.size[0] * light.size[1] / (steps * steps);
  for (let y = 0; y < steps; y++) for (let x = 0; x < steps; x++) {
    const u = (2 * (x + .5) / steps - 1) * light.size[0], v = (2 * (y + .5) / steps - 1) * light.size[1];
    const delta = light.position.map((value, axis) => value + light.u[axis] * u + light.v[axis] * v - origin[axis]);
    const distance = Math.hypot(...delta), cosLight = Math.max(0, -dot(delta, light.n) / distance);
    const qx = u / light.size[0], qy = v / light.size[1], dx = Math.abs(qx) - .89, dy = Math.abs(qy) - .89;
    const outline = Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - .11;
    const profile = (1 - smooth(-.08, 0, outline)) * (.55 + .45 * Math.exp(-1.65 * (qx * qx + qy * qy))) * (.95 + .05 * qy);
    const measure = dArea * cosLight * profile / (distance * distance);
    for (let channel = 0; channel < 3; channel++) integral[channel] += light.color[channel] * measure;
  }
  return integral;
}

/** Near-face sheet visibility for the authoritative rigid mechanical outline. */
export function iris09MechanicalLeafCovered(point, light, frame, top) {
  const [c,s,hx,hz]=frame,dy=light[1]-point[1];
  if(Math.abs(dy)<1e-8)return false;
  const height=dy>0?top-IRIS09_MECHANICS.thickness:top;
  const t=(height-point[1])/dy;
  if(t<=1e-6||t>=1)return false;
  const wx=point[0]+(light[0]-point[0])*t-hx,wz=point[2]+(light[2]-point[2])*t-hz;
  return iris09MechanicalBladeContains(wx*c+wz*s,-wx*s+wz*c);
}

/** Map source narrow-T / wide-B GGX widths onto Three's wide-T / narrow-B. */
export function iris09AnisotropyParameters(roughness, anisotropy) {
  const aspect = Math.sqrt(Math.max(.15, 1 - .88 * anisotropy));
  const narrow = Math.max(.025, roughness * roughness * aspect);
  const wide = Math.max(.025, roughness * roughness / aspect);
  return {sourceAlphaT: narrow, sourceAlphaB: wide, roughness: Math.sqrt(narrow), anisotropy: Math.sqrt(Math.max(0, (wide - narrow) / Math.max(1e-6, 1 - narrow)))};
}
const emitterIrradiances = IRIS09_EMITTERS.map((_, index) => iris09EmitterIrradiance(index));
const emitterPowers = emitterIrradiances.map(rgb => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722);
const visibilityWeights = emitterPowers.map(power => power / emitterPowers.reduce((sum, next) => sum + next, 0));

/** Original finite softbox radiance, evaluated once at the instrument center. */
export function iris09StudioRadiance(direction, origin = [0, .20, 0]) {
  const up = smooth(-.25, .90, direction[1]);
  const flag = Math.pow(Math.max(dot(direction, flagDirection), 0), 6);
  const result = [.010 + .026 * up, .0105 + .0275 * up, .011 + .031 * up].map(c => c * (1 - .72 * flag));
  for (const light of lightFrames) {
    const denominator = dot(direction, light.n);
    if (denominator >= -.00001) continue;
    const relative = light.position.map((c, i) => c - origin[i]);
    const t = dot(relative, light.n) / denominator;
    if (t <= 0) continue;
    const q = direction.map((c, i) => origin[i] + c * t - light.position[i]);
    const x = dot(q, light.u) / light.size[0], y = dot(q, light.v) / light.size[1];
    const dx = Math.abs(x) - .89, dy = Math.abs(y) - .89;
    const outline = Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - .11;
    const weight = (1 - smooth(-.08, 0, outline)) * (.55 + .45 * Math.exp(-1.65 * (x * x + y * y))) * (.95 + .05 * y);
    for (let channel = 0; channel < 3; channel++) result[channel] += light.color[channel] * weight;
  }
  return result;
}

/** Small, deterministic HDR texture. No image/network/decode dependency. */
export function createIris09StudioTexture(T, width = 512, height = 256) {
  if (width > 1024 || height > 1024 || width < 2 || height < 2) throw new RangeError('IRIS studio dimensions must be 2..1024');
  const data = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const latitude = ((y + .5) / height - .5) * Math.PI;
    const cosine = Math.cos(latitude), vertical = Math.sin(latitude);
    for (let x = 0; x < width; x++) {
      const longitude = ((x + .5) / width - .5) * Math.PI * 2;
      const radiance = iris09StudioRadiance([cosine * Math.cos(longitude), vertical, cosine * Math.sin(longitude)]);
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) data[offset + channel] = T.DataUtils.toHalfFloat(radiance[channel]);
      data[offset + 3] = T.DataUtils.toHalfFloat(1);
    }
  }
  const texture = new T.DataTexture(data, width, height, T.RGBAFormat, T.HalfFloatType);
  texture.name = 'IRIS09 / finite softbox radiance';
  texture.mapping = T.EquirectangularReflectionMapping;
  texture.colorSpace = T.LinearSRGBColorSpace;
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// Vector engraving is the recovered source's ringScale/engravingText, not a
// texture decal. Derivative footprint follows actual rendered pixel coverage.
const surfaceGLSL = /* glsl */`
varying vec3 vIrisPosition;
varying vec3 vIrisObjectNormal;
varying vec3 vIrisRadialView;
varying vec3 vIrisTangentView;
varying vec3 vIrisSurfaceRootPosition;
varying vec3 vIrisSurfaceRootNormal;
float irisHash(vec2 p) {
  vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
  q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z);
}
float irisNoise(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(irisHash(i),irisHash(i+vec2(1,0)),f.x),mix(irisHash(i+vec2(0,1)),irisHash(i+vec2(1,1)),f.x),f.y);
}
float irisRoundBox(vec2 p,vec2 b,float r) {
  vec2 d=abs(p)-b+r; return min(max(d.x,d.y),0.)+length(max(d,0.))-r;
}
float irisStroke(vec2 p,vec2 a,vec2 b) {
  vec2 d=b-a; return length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.,1.));
}
float irisLetter(int id,vec2 p) {
  float d=10.;
  if(id==0) {
    d=abs(irisRoundBox(p-vec2(.48,.5),vec2(.36,.44),.15));
    d=max(d,-max(.62-p.x,abs(p.y-.50)-.25));
  } else if(id==1) {
    d=min(irisStroke(p,vec2(.10,.94),vec2(.48,.51)),irisStroke(p,vec2(.86,.94),vec2(.48,.51)));
    d=min(d,irisStroke(p,vec2(.48,.51),vec2(.48,.06)));
  } else if(id==2 || id==3) {
    d=irisStroke(p,vec2(.14,.06),vec2(.14,.94));
    d=min(d,irisStroke(p,vec2(.14,.94),vec2(.59,.94)));
    d=min(d,irisStroke(p,vec2(.59,.94),vec2(.80,.80)));
    d=min(d,irisStroke(p,vec2(.80,.80),vec2(.80,.66)));
    d=min(d,irisStroke(p,vec2(.80,.66),vec2(.59,.52)));
    d=min(d,irisStroke(p,vec2(.59,.52),vec2(.14,.52)));
    if(id==3) d=min(d,irisStroke(p,vec2(.46,.52),vec2(.84,.06)));
    else {
      d=min(d,irisStroke(p,vec2(.59,.52),vec2(.83,.37)));
      d=min(d,irisStroke(p,vec2(.83,.37),vec2(.83,.22)));
      d=min(d,irisStroke(p,vec2(.83,.22),vec2(.59,.06)));
      d=min(d,irisStroke(p,vec2(.59,.06),vec2(.14,.06)));
    }
  } else if(id==5) d=abs(irisRoundBox(p-vec2(.48,.5),vec2(.34,.44),.20));
  else if(id==6) {
    d=abs(irisRoundBox(p-vec2(.47,.70),vec2(.33,.24),.17));
    d=min(d,irisStroke(p,vec2(.80,.69),vec2(.73,.20)));
    d=min(d,irisStroke(p,vec2(.73,.20),vec2(.49,.06)));
    d=min(d,irisStroke(p,vec2(.49,.06),vec2(.21,.06)));
  }
  return d;
}
float irisLine(float distance,float width,float footprint) {
  float fw=max(footprint*.6,.00024);
  return 1.-smoothstep(width-fw,width+fw,abs(distance));
}
float irisStamp(vec3 p,float footprint) {
  float r=length(p.xz);
  if(r<${IRIS09_ENGRAVING_RADIAL_BOUNDS[0]} || r>${IRIS09_ENGRAVING_RADIAL_BOUNDS[1]}) return 0.;
  float a=atan(p.z,p.x);
  float k=(a/6.28318530718+.5)*90.;
  float dk=abs(fract(k+.5)-.5)*6.28318530718*r/90.;
  float major=1.-step(.5,mod(floor(k+.5),5.));
  float start=mix(1.210,1.170,major);
  float radial=smoothstep(start-.002,start+.002,r)*(1.-smoothstep(1.265,1.270,r));
  float stamp=irisLine(dk,.0017+major*.0007,footprint)*radial;
  stamp=max(stamp,irisLine(a-.93,.004,footprint)*smoothstep(1.405,1.414,r)*(1.-smoothstep(1.451,1.458,r)));
  vec2 uv=vec2((1.57-a)*1.36,1.347-r)/.058+vec2(4.15,.5);
  int ch=int(floor(uv.x/1.20));
  if(ch>=0 && ch<=6 && uv.y>=-.2 && uv.y<=1.2) {
    float fw=max(footprint/.058*.7,.008);
    float letter=1.-smoothstep(.050-fw,.050+fw,irisLetter(ch,vec2(uv.x-float(ch)*1.20,uv.y)));
    stamp=max(stamp,letter);
  }
  return stamp;
}
`;

// Every cardinal extremum and circle/line intersection is in this contour.
// At an extremum, a nonnegative combination of active supporting normals
// equals its axis. Expanding each source constraint by the filter footprint
// therefore expands that support bound by sum(weights)*footprint. Unlike a
// naive tight AABB + width, this cannot clip antialiasing at acute corners.
const mechanicalContour=iris09MechanicalBladeContour(192);
export const IRIS09_MECHANICAL_SHADOW_BOUNDS=Object.freeze([[1,0],[-1,0],[0,1],[0,-1]].map(axis=>{
  const point=mechanicalContour.reduce((a,b)=>a[0]*axis[0]+a[1]*axis[1]>b[0]*axis[0]+b[1]*axis[1]?a:b);
  const normals=[];
  for(const [cx,cz,r]of IRIS09_MECHANICS.bladeCircles){
    if(Math.abs(Math.hypot(point[0]-cx,point[1]-cz)-r)<1e-8)normals.push([(point[0]-cx)/r,(point[1]-cz)/r]);
  }
  const [nx,nz,d]=IRIS09_MECHANICS.bladeHalfPlane,length=Math.hypot(nx,nz);
  if(Math.abs(nx*point[0]+nz*point[1]-d)<1e-8)normals.push([nx/length,nz/length]);
  let footprintScale=Infinity;
  for(const a of normals){
    if(Math.hypot(a[0]-axis[0],a[1]-axis[1])<1e-8)footprintScale=1;
    for(const b of normals){
      const det=a[0]*b[1]-a[1]*b[0];if(Math.abs(det)<1e-10)continue;
      const wa=(axis[0]*b[1]-axis[1]*b[0])/det,wb=(a[0]*axis[1]-a[1]*axis[0])/det;
      if(wa>=-1e-10&&wb>=-1e-10)footprintScale=Math.min(footprintScale,Math.max(0,wa)+Math.max(0,wb));
    }
  }
  if(!Number.isFinite(footprintScale))throw new Error('Mechanical blade support bound must have a valid dual certificate');
  return Object.freeze({axis:Object.freeze(axis),offset:point[0]*axis[0]+point[1]*axis[1],footprintScale});
}));
const glslNumber=value=>Number(value).toPrecision(12);
const leafOcclusionGLSL = /* glsl */`
uniform vec4 uIrisMechanicalFrames[${IRIS09_MECHANICS.blades}];
uniform float uIrisMechanicalHeights[${IRIS09_MECHANICS.blades}];
uniform int uIrisLeafIndex;
uniform int uIrisLeafCount;
uniform vec3 uIrisBladeDiscs[${IRIS09_MECHANICS.bladeCircles.length}];
uniform int uIrisBladeDiscCount;
uniform vec3 uIrisSourcePositions[${IRIS09_EMITTERS.length}];
uniform vec3 uIrisSourceHorizontals[${IRIS09_EMITTERS.length}];
uniform int uIrisSourceCount;
float irisMechanicalContourCover(vec2 q,float width) {
  ${IRIS09_MECHANICAL_SHADOW_BOUNDS.map(({axis,offset,footprintScale})=>`if(dot(q,vec2(${axis[0]}.0,${axis[1]}.0))>${glslNumber(offset)}+width*${glslNumber(footprintScale)}+.00000001)return 0.;`).join('\n  ')}
  float edge=${glslNumber(IRIS09_MECHANICS.bladeHalfPlane[0])}*q.x+${glslNumber(IRIS09_MECHANICS.bladeHalfPlane[1])}*q.y-${glslNumber(IRIS09_MECHANICS.bladeHalfPlane[2])};
  float band=width*${glslNumber(Math.hypot(...IRIS09_MECHANICS.bladeHalfPlane.slice(0,2)))};
  if(edge>=band)return 0.;
  float cover=1.-smoothstep(-band,band,edge);
  // Uniform-bounded loops prevent the Windows driver from expanding the
  // source × leaf × contour tests into an enormous static branch tree.
  for(int disc=0;disc<uIrisBladeDiscCount;disc++) {
    vec3 circle=uIrisBladeDiscs[disc];
    vec2 local=q-circle.xy;
    float distance=dot(local,local)-circle.z*circle.z;
    float radiusBand=width*(2.*circle.z+width);
    if(distance>=radiusBand)return 0.;
    cover*=1.-smoothstep(-radiusBand,radiusBand,distance);
  }
  cover*=smoothstep(-width*${glslNumber(2*IRIS09_MECHANICS.pivotBoreRadius)},width*${glslNumber(2*IRIS09_MECHANICS.pivotBoreRadius)},dot(q,q)-${glslNumber(IRIS09_MECHANICS.pivotBoreRadius**2)});
  vec2 follower=q-vec2(${glslNumber(IRIS09_MECHANICS.followerOffset)},0.);
  cover*=smoothstep(-width*${glslNumber(2*IRIS09_MECHANICS.followerPinRadius)},width*${glslNumber(2*IRIS09_MECHANICS.followerPinRadius)},dot(follower,follower)-${glslNumber(IRIS09_MECHANICS.followerPinRadius**2)});
  return cover;
}
float irisMechanicalLeavesCover(vec3 p,vec3 light,float footprint) {
  vec3 ray=light-p;
  if(abs(ray.y)<.00000001)return 0.;
  float cover=0.,width=max(footprint,.00002);
  // All authored emitter samples are above the entire horizontal stack.
  // A uniform loop start skips self/lower layers without generating nine
  // separate heavily unrolled shader programs. Highest leaf has zero tests.
  for(int leaf=uIrisLeafIndex+1;leaf<uIrisLeafCount;leaf++) {
    float height=uIrisMechanicalHeights[leaf]-(ray.y>0.?${glslNumber(IRIS09_MECHANICS.thickness)}:0.);
    float t=(height-p.y)/ray.y;
    // The parallel stack's lower layers are rejected before any contour work.
    if(t<=.000001 || t>=1.)continue;
    vec4 frame=uIrisMechanicalFrames[leaf];
    vec2 offset=p.xz+ray.xz*t-frame.zw;
    vec2 q=vec2(dot(offset,frame.xy),dot(offset,vec2(-frame.y,frame.x)));
    cover=max(cover,irisMechanicalContourCover(q,width));
    if(cover>=1.)return 1.;
  }
  return cover;
}
float irisHousingVisibility(vec3 p,vec3 light) {
  vec3 ray=light-p;
  // Inside-to-outside rays meet the original concentric seal/retainer/face
  // aperture walls. Rounded top shoulders are filtered rather than raymarched.
  vec2 seal=p.xz+ray.xz*((.436-p.y)/max(ray.y,.00001));
  vec2 brass=p.xz+ray.xz*((.532-p.y)/max(ray.y,.00001));
  vec2 face=p.xz+ray.xz*((.544-p.y)/max(ray.y,.00001));
  float v=(1.-smoothstep(.994,1.002,length(seal)));
  v*=1.-smoothstep(1.017,1.031,length(brass));
  v*=1.-smoothstep(1.083,1.089,length(face));
  return mix(.025,1.,v);
}
float irisLeafSourceVisibility(vec3 p,vec3 light,vec3 horizontal,float footprint) {
  vec3 left=light-horizontal, right=light+horizontal;
  float a=irisHousingVisibility(p,left)*(1.-.945*irisMechanicalLeavesCover(p,left,footprint));
  float b=irisHousingVisibility(p,light)*(1.-.945*irisMechanicalLeavesCover(p,light,footprint));
  float c=irisHousingVisibility(p,right)*(1.-.945*irisMechanicalLeavesCover(p,right,footprint));
  return (a+b+c)/3.;
}
`;

const glslVec = values => `vec3(${values.map(value => Number(value).toFixed(9)).join(',')})`;

function applySourceToneCurve(shader) {
  // Source exposure is 1.0. Do not also run Three's ACES matrix/RRT or its
  // exposure / .6 gain. Color-space encoding remains Three's single output
  // conversion (sRGB for the page, linear when requested by a render target).
  // The source standalone preview instead uses an approximate gamma 2.2 OETF.
  shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', /* glsl */`
vec3 irisSceneLinear=max(gl_FragColor.rgb,vec3(0.));
gl_FragColor.rgb=clamp((irisSceneLinear*(2.51*irisSceneLinear+.03))/(irisSceneLinear*(2.43*irisSceneLinear+.59)+.14),0.,1.);
`);
}

function addSurfaceFinish(material, id, T) {
  material.onBeforeCompile = function(shader) {
    const simpleOpaque = !this.clearcoat && !this.sheen && !this.iridescence && !this.transmission;
    const pureMetal = simpleOpaque && [2, 3, 4].includes(id) && this.metalness === 1 && !this.metalnessMap;
    if (id === 8) {
      const state=solveIris09Input(IRIS09_MECHANICS.inputCenter);
      const frames=Array.from({length:IRIS09_MECHANICS.blades},(_,i)=>iris09MechanicalFrame(i,state));
      shader.uniforms.uIrisMechanicalFrames=this.userData.iris09MechanicalFrames??{value:frames.map(f=>new T.Vector4(f.c,f.s,f.hx,f.hz))};
      shader.uniforms.uIrisMechanicalHeights=this.userData.iris09MechanicalHeights??{value:new Float32Array(frames.map(f=>f.top))};
      shader.uniforms.uIrisLeafIndex=this.userData.iris09LeafIndex??{value:-1};
      shader.uniforms.uIrisLeafCount={value:IRIS09_MECHANICS.blades};
      shader.uniforms.uIrisBladeDiscs={value:IRIS09_MECHANICS.bladeCircles.map(c=>new T.Vector3(...c))};
      shader.uniforms.uIrisBladeDiscCount={value:IRIS09_MECHANICS.bladeCircles.length};
      shader.uniforms.uIrisSourcePositions={value:lightFrames.map(light=>new T.Vector3(...light.position))};
      shader.uniforms.uIrisSourceHorizontals={value:lightFrames.map(light=>new T.Vector3(...light.u.map(value=>value*light.size[0]*.6)))};
      shader.uniforms.uIrisSourceCount={value:IRIS09_EMITTERS.length};
    }
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vIrisPosition; varying vec3 vIrisObjectNormal;
varying vec3 vIrisRadialView; varying vec3 vIrisTangentView;
varying vec3 vIrisSurfaceRootPosition; varying vec3 vIrisSurfaceRootNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vIrisPosition=position; vIrisObjectNormal=normal;
vIrisSurfaceRootPosition=position;
${id === 6 ? 'vIrisSurfaceRootPosition=(modelMatrix*vec4(position,1.)).xyz;' : ''}
vIrisSurfaceRootNormal=mat3(modelMatrix)*normal;
// Interpolate a linear coordinate basis, not normalized radial directions.
// The latter produces triangle-dependent tangent fields on an annular fan.
vIrisRadialView=normalMatrix*vec3(1.,0.,0.);
vIrisTangentView=normalMatrix*vec3(0.,0.,1.);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${surfaceGLSL}\n${id === 8 ? leafOcclusionGLSL : ''}`);
    const params = /* glsl */`
float irisR=max(length(vIrisPosition.xz),.0001);
float irisA=atan(vIrisPosition.z,vIrisPosition.x);
vec3 irisRadialDirection=normalize(vIrisRadialView*(vIrisPosition.x/irisR)+vIrisTangentView*(vIrisPosition.z/irisR)+vec3(1e-10));
vec3 irisTangentDirection=${id === 8 ? 'normalize(vIrisRadialView)' : 'normalize(-vIrisRadialView*(vIrisPosition.z/irisR)+vIrisTangentView*(vIrisPosition.x/irisR)+vec3(1e-10))'};
float irisFootprint=max(length(dFdx(vIrisPosition)),length(dFdy(vIrisPosition)));
float irisFace=smoothstep(.50,.94,normalize(vIrisObjectNormal).y);
float irisPolish=irisNoise(vec2(irisR*24.,irisA*7.));
float irisResidue=irisNoise(vIrisPosition.xz*5.2+vec2(3.8,17.1));
float irisEngraving=0.;
${id === 2 ? 'if(irisFace>0.) irisEngraving=irisStamp(vIrisPosition,irisFootprint)*irisFace;' : ''}
`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${params}
roughnessFactor+=${id === 2 ? '.040*(irisPolish-.5)+.045*(irisResidue-.5)' : id === 3 ? '.024*(irisPolish-.5)' : id === 8 ? '.010*(irisPolish-.5)' : id === 6 ? '0.' : '.025*(irisPolish-.5)'};
roughnessFactor=mix(roughnessFactor,.51,irisEngraving);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.047,.050,.054),irisEngraving);`);
    // Source tool-feed slopes, filtered before they become subpixel moire.
    const slope = id === 2 ? /* glsl */`
float irisSlope=0.;
if(irisFace>0.) {
irisSlope=.020*sin(irisR*6.28318530718*94.+.18*sin(irisA*3.))*exp(-.22*pow(6.28318530718*94.*irisFootprint,2.));
irisSlope+=.013*sin(irisR*6.28318530718*211.+.28*irisNoise(vIrisPosition.xz*3.5))*exp(-.22*pow(6.28318530718*211.*irisFootprint,2.));
irisSlope+=.0025*sin(irisR*6.28318530718*24.+.09*sin(irisA*7.))*exp(-.22*pow(6.28318530718*24.*irisFootprint,2.));
}
normal=normalize(normal+irisRadialDirection*irisSlope*irisFace);
// Screen-space surface gradient of the source's .00045 engraving recess.
vec3 irisDX=dFdx(-vViewPosition),irisDY=dFdy(-vViewPosition);
vec3 irisR1=cross(irisDY,normal),irisR2=cross(normal,irisDX);
float irisDet=dot(irisDX,irisR1),irisHeight=-.00045*irisEngraving;
vec3 irisGradient=sign(irisDet)*(dFdx(irisHeight)*irisR1+dFdy(irisHeight)*irisR2);
normal=normalize(max(abs(irisDet),1e-10)*normal-irisGradient);
` : id === 3 ? /* glsl */`
float irisSlope=0.;
if(irisFace>0.) {
irisSlope=.016*sin(irisR*6.28318530718*160.+.12*sin(irisA*5.))*exp(-.22*pow(6.28318530718*160.*irisFootprint,2.));
irisSlope+=.004*sin(irisR*6.28318530718*48.)*exp(-.22*pow(6.28318530718*48.*irisFootprint,2.));
}
normal=normalize(normal+irisRadialDirection*irisSlope*irisFace);
` : '';
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${slope}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
${id === 8 ? 'material.diffuseColor=vec3(.006,.007,.008)*.28; material.specularColor=vec3(.055,.059,.065);' : ''}
float irisSourceRoughness=material.roughness;
#ifdef USE_ANISOTROPY
vec3 irisT=normalize(irisTangentDirection-normal*dot(normal,irisTangentDirection));
float irisAspect=sqrt(max(.15,1.-.88*material.anisotropy));
float irisNarrow=max(.025,material.roughness*material.roughness*irisAspect);
float irisWide=max(.025,material.roughness*material.roughness/irisAspect);
material.roughness=sqrt(irisNarrow);
material.anisotropy=sqrt(max(0.,(irisWide-irisNarrow)/max(.000001,1.-irisNarrow)));
material.alphaT=irisWide;
material.anisotropyT=normalize(cross(normal,irisT));
material.anisotropyB=irisT;
#endif`);
    const visibility = id === 8 ? `vec3 irisVisibility=vec3(1.);
for(int source=0;source<uIrisSourceCount;source++) {
 irisVisibility[source]=irisLeafSourceVisibility(vIrisSurfaceRootPosition,uIrisSourcePositions[source],uIrisSourceHorizontals[source],irisFootprint);
}` : 'vec3 irisVisibility=vec3(1.);';
    let lighting = T.ShaderChunk.lights_fragment_begin;
    if (id === 8) lighting = lighting.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n directLight.color *= irisVisibility[i];');
    if (pureMetal) {
      // r5 discards direct specular, and these source finishes have exactly
      // zero diffuse. Eliminate their light/shadow loops before GPU compilation.
      for (const condition of [
        '#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )',
        '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )',
        '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )',
        '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )',
      ]) lighting = lighting.replace(condition, '#if 0 // IRIS source pure-metal diffuse is zero');
    } else if (simpleOpaque) {
      // Exactly RE_Direct_Physical's surviving term. Do not evaluate its
      // anisotropic GGX specular only to discard the result later in the frame.
      lighting = lighting.replaceAll(
        'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
        'reflectedLight.directDiffuse += saturate(dot(geometryNormal,directLight.direction))*directLight.color*BRDF_Lambert(material.diffuseColor);',
      );
    }
    // PMREM is an isotropic convolution. Three's anisotropic approximation
    // bends the physical surface normal; on this rotating tangent field it
    // invents lobes/black wedges. Use the actual normal and source roughness
    // for this one environment lookup, while preserving the correctly mapped
    // GGX axes for direct BRDF evaluation. No additional texture samples.
    const genericEnvironmentLighting = T.ShaderChunk.lights_fragment_maps.replace(
      'getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy )',
      'getIBLRadiance( geometryViewDir, geometryNormal, irisSourceRoughness )',
    );
    const environmentLighting = simpleOpaque ? /* glsl */`
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
radiance += getIBLRadiance( geometryViewDir, geometryNormal, irisSourceRoughness );
#endif
` : genericEnvironmentLighting;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_fragment_begin>', `${visibility}\n${lighting}`)
      .replace('#include <lights_fragment_maps>', `${environmentLighting}
// The environment already contains the finite source reflections. Directional
// sources supply diffuse visibility only: never count their specular twice.
reflectedLight.directSpecular=vec3(0.);
// Likewise their diffuse energy belongs to direct lights, not a second IBL.
iblIrradiance=vec3(0.);
irradiance=vec3(3.14159265359*(.037+.028*max(normalize(vIrisSurfaceRootNormal).y,0.)));
${id === 8 ? `radiance*=dot(irisVisibility,${glslVec(visibilityWeights)}); irradiance*=.80;` : ''}`);
    if (simpleOpaque) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', /* glsl */`
// With zero diffuse IBL, r5's multiScatter * irradiance and indirect diffuse
// IBL terms are exactly zero. Its singleScatter is EnvironmentBRDF verbatim.
// The prefiltered lobe and its split-sum BRDF factor must use the same width.
// material.roughness is the converted narrow direct-anisotropy axis; using it
// here mismatches the isotropic PMREM sampled at irisSourceRoughness above.
reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert(material.diffuseColor);
reflectedLight.indirectSpecular += radiance * EnvironmentBRDF(geometryNormal,geometryViewDir,material.specularColor,material.specularF90,irisSourceRoughness);
`);
    applySourceToneCurve(shader);
  };
  material.customProgramCacheKey = function() {
    return `iris09-mesh-finish-r9-consistent-ibl-width-${id}-${this.metalness === 1 && !this.metalnessMap ? 'metal' : 'diffuse'}-${!this.clearcoat && !this.sheen && !this.iridescence && !this.transmission ? 'simple' : 'layered'}`;
  };
}

export function createIris09Materials(T, renderer) {
  const sourceEnvironment = createIris09StudioTexture(T);
  let environmentTarget = null;
  let environment = sourceEnvironment;
  if (renderer) {
    const generator = new T.PMREMGenerator(renderer);
    try { environmentTarget = generator.fromEquirectangular(sourceEnvironment); environment = environmentTarget.texture; }
    catch (error) { sourceEnvironment.dispose(); throw error; }
    finally { generator.dispose(); }
  }
  const materials = {};
  for (const [id, finish] of Object.entries(IRIS09_FINISHES)) {
    const material = new T.MeshPhysicalMaterial({
      color: new T.Color(...finish.color), metalness: finish.metalness,
      roughness: finish.roughness, anisotropy: finish.anisotropy,
      envMap: environment, envMapIntensity: 1, ior: Number(id) === 5 ? (1 + Math.sqrt(.032)) / (1 - Math.sqrt(.032)) : 1.52,
      side: Number(id) === 8 ? T.DoubleSide : T.FrontSide,
    });
    material.name = finish.name;
    addSurfaceFinish(material, Number(id), T);
    materials[id] = material;
  }
  materials.glass = new T.MeshPhysicalMaterial({
    name: 'IRIS09 / coated optical surface (raster approximation)',
    color: new T.Color(.005, .007, .009), metalness: 0, roughness: .035,
    ior: 1.52, envMap: environment, envMapIntensity: 1,
    transparent: true, opacity: .22, depthWrite: false,
    iridescence: .35, iridescenceIOR: 1.38, iridescenceThicknessRange: [290, 340],
    transmission: 0,
  });
  materials.glass.onBeforeCompile = applySourceToneCurve;
  materials.glass.customProgramCacheKey = () => 'iris09-mesh-glass-r3-source-curve';
  const lights = IRIS09_EMITTERS.map((emitter, index) => {
    const irradiance = emitterIrradiances[index];
    const light = new T.DirectionalLight(new T.Color(...irradiance), 1);
    light.name = `IRIS09 / finite-source centroid ${index}`;
    light.position.fromArray(emitter.position);
    light.target.position.set(0, .2, 0); light.target.updateMatrixWorld();
    // Stage chooses which single source owns a cached/static shadow map.
    light.castShadow = false;
    light.userData.iris09Emitter = emitter;
    return light;
  });
  const floorMaterial = new T.MeshPhysicalMaterial({name: 'IRIS09 / studio floor', color: new T.Color(.034, .032, .029), roughness: .58, envMap: environment, envMapIntensity: 1, ior: (1 + Math.sqrt(.026)) / (1 - Math.sqrt(.026))});
  addSurfaceFinish(floorMaterial, 6, T);
  let disposed = false;
  return {
    materials, environment, lights, floorMaterial,
    metadata: {
      source: 'IRIS-09.glsl / Revision 3', adapter: 'mesh-visible-fragment-finishes-r9-consistent-ibl-width',
      sourceEmitterCount: 3, environmentSize: [512, 256], environmentBytes: sourceEnvironment.image.data.byteLength,
      environmentBuilds: environmentTarget ? 1 : 0,
      screenTransmissionPass: false, perFrameRayMarching: false,
      retained: ['source metal reflectance and roughness', 'source finite emitter positions and diffusion profiles', 'analytic CYBR09 engraving and 90 index marks', 'derivative-filtered circumferential tool feed', 'per-finish anisotropy'],
      energyPartition: 'Source-profile-integrated direct diffuse + source ambient; PMREM specular only, no duplicate centroid specular or diffuse IBL',
      display: 'Exact source Narkowicz tone curve at exposure 1.0; single Three output encoding (sRGB on page). Original standalone uses approximate gamma 2.2, so OETF is not pixel-identical.',
      specialization: 'Opaque lighting removes zeroed specular/diffuse-PMREM/pure-metal direct work; isotropic PMREM and its split-sum BRDF factor use the same source roughness; layered materials retain generic path',
      leafVisibility: 'Authoritative rigid mechanical contour/bores and horizontal stack; all potentially intervening leaves, 3 samples per source; shared shader with owner-index uniform loop start and footprint-conservative projected 2D support rejection; near-face thin-sheet and concentric aperture housing approximation',
      approximations: ['PMREM studio radiance is anchored at instrument center', 'environment reflections use isotropic PMREM at source roughness with the physical surface normal; no bent-normal anisotropy heuristic', 'direct illumination uses profile-integrated rectangular-source centroids', 'raster glass surface does not trace nested refraction', 'leaf PMREM visibility uses an energy-weighted blend of source visibilities', 'sparse handling scratches and general local reflection occlusion are not reproduced'],
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of Object.values(materials)) material.dispose();
      floorMaterial.dispose(); environmentTarget?.dispose(); sourceEnvironment.dispose();
    },
  };
}
