// Immutable temporal inputs: every dispatch reads the previous pose's guides
// and history, then writes a separate current history. No RGB clamping.
export const TEMPORAL_UNIFORM_BYTES=160;
export const TEMPORAL_POLICY=Object.freeze({normalCos:.97,roughnessTolerance:.035,opticalViewCos:.99995,skyDirectionCos:.999995,opticalMaxSamples:8,glossyMaxSamples:4,mirrorRoughness:.3,moderatelyRoughMaxSamples:8,roughMaxSamples:16});
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k),length=a=>Math.hypot(...a);
const unit=a=>{const n=length(a);return n>1e-12?mul(a,1/n):[0,0,0];};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function rotateQuaternion(vector,q){const t=mul(cross(q.slice(0,3),vector),2);return add(vector,add(mul(t,q[3]),cross(q.slice(0,3),t)));}
export function encodeOctahedral(direction){const v=unit(direction),d=Math.abs(v[0])+Math.abs(v[1])+Math.abs(v[2]);if(!d)throw Error('Direction must be nonzero');let x=v[0]/d,y=v[1]/d;if(v[2]<0){const old=x;x=(1-Math.abs(y))*(x>=0?1:-1);y=(1-Math.abs(old))*(y>=0?1:-1);}return[x,y];}
export function decodeOctahedral(encoded){let x=encoded[0],y=encoded[1],z=1-Math.abs(x)-Math.abs(y);if(z<0){const old=x;x=(1-Math.abs(y))*(x>=0?1:-1);y=(1-Math.abs(old))*(y>=0?1:-1);}return unit([x,y,z]);}
export function rigidPreviousPoint(point,motion){if(!motion?.valid)return null;const local=rotateQuaternion(sub(point,motion.currentTranslation),[...motion.currentQuaternion.slice(0,3).map(v=>-v),motion.currentQuaternion[3]]);return add(rotateQuaternion(local,motion.previousQuaternion),motion.previousTranslation);}
export function rigidPreviousNormal(normal,motion){if(!motion?.valid)return null;return unit(rotateQuaternion(rotateQuaternion(normal,[...motion.currentQuaternion.slice(0,3).map(v=>-v),motion.currentQuaternion[3]]),motion.previousQuaternion));}
export function reprojectPoint(point,matrix,dimensions){const p=[...point,1],clip=[0,1,2,3].map(row=>p.reduce((s,v,col)=>s+matrix[col*4+row]*v,0));if(!(clip[3]>1e-8)||dimensions.some(d=>d<1))return null;const ndc=clip.slice(0,3).map(v=>v/clip[3]);const pixel=[(ndc[0]*.5+.5)*dimensions[0]-.5,(.5-ndc[1]*.5)*dimensions[1]-.5];if(pixel[0]<-1||pixel[1]<-1||pixel[0]>=dimensions[0]||pixel[1]>=dimensions[1])return null;return{pixel,ndc};}
export function candidateCoordinates(pixel,dimensions){const low=pixel.map(Math.floor),result=[];for(let y=0;y<2;y++)for(let x=0;x<2;x++){const p=[low[0]+x,low[1]+y];if(p[0]>=0&&p[1]>=0&&p[0]<dimensions[0]&&p[1]<dimensions[1])result.push(p);}return result;}
export function movingHistoryCap(sample,maxSamples=128){const optical=sample.normal[3]<.06;return Math.max(1,Math.min(maxSamples,optical?TEMPORAL_POLICY.opticalMaxSamples:sample.normal[3]<TEMPORAL_POLICY.mirrorRoughness?TEMPORAL_POLICY.glossyMaxSamples:sample.normal[3]<.4?TEMPORAL_POLICY.moderatelyRoughMaxSamples:TEMPORAL_POLICY.roughMaxSamples));}
function motionFor(guide,motions){return guide[3]>=4?motions[Math.round(guide[3]-3)]:null;}
function guideMatches(current,previous,currentNormal,previousNormal,motions,footprint,scale){
 if(current[3]!==previous[3])return false;
 if(current[3]===-1)return dot(unit(current.slice(0,3)),unit(previous.slice(0,3)))>=TEMPORAL_POLICY.skyDirectionCos&&length(current.slice(0,3))>.5&&length(previous.slice(0,3))>.5;
 if(current[3]<4)return false;
 const motion=motionFor(current,motions),point=rigidPreviousPoint(current.slice(0,3),motion),normal=rigidPreviousNormal(currentNormal.slice(0,3),motion);if(!point||!normal)return false;
 const delta=sub(previous.slice(0,3),point),epsilon=Math.max(1e-6,scale*.01);
 return Math.abs(currentNormal[3]-previousNormal[3])<=TEMPORAL_POLICY.roughnessTolerance&&dot(normal,previousNormal.slice(0,3))>=TEMPORAL_POLICY.normalCos&&length(delta)<=Math.max(epsilon*3,footprint*1.75)&&Math.max(Math.abs(dot(delta,normal)),Math.abs(dot(delta,previousNormal.slice(0,3))))<=Math.max(epsilon,footprint*.12);
}
export function temporalCandidateMatches(current,previous,history,motions,{stationary=false,scale=.005,primaryFootprint=.001,secondaryFootprint=primaryFootprint,reflectionFootprint=primaryFootprint}={}){
 if(!history||history.moments[3]<.5)return false;
 if(!stationary&&(current.color[3]<.999||previous.color[3]<.999||history.radiance[3]<.999))return false;
 if(!guideMatches(current.position,previous.position,current.normal,previous.normal,motions,primaryFootprint,scale))return false;
 // The caller guarantees unchanged camera, geometry AND dimensions. A
 // bounded deterministic optical guide can end at TIR/depth exhaustion;
 // that uncertainty must reject moved history, not stationary averaging.
 if(stationary)return true;
 // A single ideal reflected ray describes a sharp mirror image, not the
 // angular average of a rough GGX lobe. Rough opaque metal is validated by
 // its real primary geometry and a short history; optical guides stay strict.
 const optical=current.normal[3]<.06,reflective=current.normal[3]<TEMPORAL_POLICY.mirrorRoughness&&current.reflection[3]!==-2;
 if((optical||reflective)&&dot(decodeOctahedral(current.moments.slice(2,4)),decodeOctahedral(previous.moments.slice(2,4)))<TEMPORAL_POLICY.opticalViewCos)return false;
 if(optical&&!guideMatches(current.secondary,previous.secondary,current.secondaryNormal,previous.secondaryNormal,motions,secondaryFootprint,scale))return false;
 if(optical||reflective){if(!guideMatches(current.reflection,previous.reflection,current.reflectionNormal,previous.reflectionNormal,motions,reflectionFootprint,scale))return false;}
 return true;
}
export function blendTemporalSample(sample,previousHistory,{accepted=true,stationary=false,maxSamples=128}={}){
 const cap=stationary?Math.max(1,maxSamples):movingHistoryCap(sample,maxSamples),oldCount=accepted&&previousHistory?Math.min(Math.max(0,previousHistory.moments[3]),cap-1):0,count=oldCount+1,amount=1/count;
 const color=sample.color.map((v,i)=>v*amount+(oldCount?previousHistory.radiance[i]*(1-amount):0));
 const moments=sample.moments.slice(0,2).map((v,i)=>v*amount+(oldCount?previousHistory.moments[i]*(1-amount):0));
 return{radiance:color,moments:[...moments,Math.max(0,moments[1]-moments[0]**2)/count,count]};
}

export const accumulationShader=`
struct Pixel {color:vec4f,position:vec4f,normal:vec4f,moments:vec4f,secondary:vec4f,secondaryNormal:vec4f,reflection:vec4f,reflectionNormal:vec4f}
struct Accumulator {radiance:vec4f,moments:vec4f}
struct TemporalConfig {dims:vec4u,state:vec4u,previousVP:mat4x4f,currentEye:vec4f,previousEye:vec4f,policy:vec4f,spare:vec4f}
struct Motion {currentQuaternion:vec4f,currentTranslation:vec4f,previousQuaternion:vec4f,previousTranslation:vec4f}
struct PreviousGuide {point:vec3f,normal:vec3f,valid:u32}
struct Footprints {primary:f32,secondary:f32,reflection:f32}
@group(0) @binding(0) var<uniform> config:TemporalConfig;
@group(0) @binding(1) var<storage,read> samples:array<Pixel>;
@group(0) @binding(2) var<storage,read> previousSamples:array<Pixel>;
@group(0) @binding(3) var<storage,read> previousHistory:array<Accumulator>;
@group(0) @binding(4) var<storage,read_write> history:array<Accumulator>;
@group(0) @binding(5) var<storage,read_write> output:array<vec4f>;
@group(0) @binding(6) var<storage,read> motions:array<Motion>;
@group(0) @binding(7) var<storage,read_write> counters:array<atomic<u32>,8>;
const NORMAL_COS:f32=${TEMPORAL_POLICY.normalCos};
const ROUGHNESS_TOLERANCE:f32=${TEMPORAL_POLICY.roughnessTolerance};
const OPTICAL_VIEW_COS:f32=${TEMPORAL_POLICY.opticalViewCos};
const SKY_DIRECTION_COS:f32=${TEMPORAL_POLICY.skyDirectionCos};
fn unit(v:vec3f)->vec3f {return v*inverseSqrt(max(dot(v,v),1e-20));}
fn rotate(v:vec3f,q:vec4f)->vec3f {let t=2.*cross(q.xyz,v);return v+q.w*t+cross(q.xyz,t);}
fn octDirection(encoded:vec2f)->vec3f {
 var n=vec3f(encoded,1.-abs(encoded.x)-abs(encoded.y));
 if(n.z<0.){n=vec3f((vec2f(1)-abs(n.yx))*select(vec2f(-1),vec2f(1),n.xy>=vec2f(0)),n.z);}return unit(n);
}
fn previousGuide(point:vec4f,normal:vec4f)->PreviousGuide {
 if(point.w<4.){return PreviousGuide(vec3f(0),vec3f(0),0u);}
 let id=u32(round(point.w-3.));if(id>=arrayLength(&motions)){return PreviousGuide(vec3f(0),vec3f(0),0u);}
 let m=motions[id];if(m.currentTranslation.w<.5){return PreviousGuide(vec3f(0),vec3f(0),0u);}
 let inverse=vec4f(-m.currentQuaternion.xyz,m.currentQuaternion.w);
 let p=rotate(rotate(point.xyz-m.currentTranslation.xyz,inverse),m.previousQuaternion)+m.previousTranslation.xyz;
 let n=unit(rotate(rotate(normal.xyz,inverse),m.previousQuaternion));return PreviousGuide(p,n,1u);
}
fn guideMatches(current:vec4f,old:vec4f,currentNormal:vec4f,oldNormal:vec4f,footprint:f32)->bool {
 if(current.w!=old.w){return false;}
 if(current.w==-1.){return dot(current.xyz,current.xyz)>.25&&dot(old.xyz,old.xyz)>.25&&dot(unit(current.xyz),unit(old.xyz))>=SKY_DIRECTION_COS;}
 let prior=previousGuide(current,currentNormal);if(prior.valid==0u){return false;}
 let delta=old.xyz-prior.point;let epsilon=max(1e-6,config.policy.x*.01);
 return abs(currentNormal.w-oldNormal.w)<=ROUGHNESS_TOLERANCE&&dot(prior.normal,oldNormal.xyz)>=NORMAL_COS&&length(delta)<=max(epsilon*3.,footprint*1.75)&&max(abs(dot(delta,prior.normal)),abs(dot(delta,oldNormal.xyz)))<=max(epsilon,footprint*.12);
}
fn currentFootprints(s:Pixel,xy:vec2u)->Footprints {
 let epsilon=max(1e-6,config.policy.x*.01);var result=Footprints(epsilon*2.,epsilon*2.,epsilon*2.);
 for(var axis=0u;axis<2u;axis++){
  var p=xy;if(axis==0u){p.x=min(p.x+1u,config.dims.x-1u);}else{p.y=min(p.y+1u,config.dims.y-1u);}
  let q=samples[p.y*config.dims.x+p.x];
  if(q.position.w==s.position.w&&dot(q.normal.xyz,s.normal.xyz)>.8){result.primary=max(result.primary,length(q.position.xyz-s.position.xyz));}
  if(q.secondary.w==s.secondary.w&&s.secondary.w>=4.&&dot(q.secondaryNormal.xyz,s.secondaryNormal.xyz)>.8){result.secondary=max(result.secondary,length(q.secondary.xyz-s.secondary.xyz));}
  if(q.reflection.w==s.reflection.w&&s.reflection.w>=4.&&dot(q.reflectionNormal.xyz,s.reflectionNormal.xyz)>.8){result.reflection=max(result.reflection,length(q.reflection.xyz-s.reflection.xyz));}
 }
 let resolution=max(f32(config.dims.x)/f32(max(1u,config.dims.z)),f32(config.dims.y)/f32(max(1u,config.dims.w)));
 result.primary*=max(1.,resolution);result.secondary*=max(1.,resolution);result.reflection*=max(1.,resolution);return result;
}
fn candidateMatches(s:Pixel,old:Pixel,h:Accumulator,footprints:Footprints,stationary:bool)->bool {
 if(h.moments.w<.5){return false;}
 if(!stationary&&(s.color.w<.999||old.color.w<.999||h.radiance.w<.999)){return false;}
 if(!guideMatches(s.position,old.position,s.normal,old.normal,footprints.primary)){return false;}
 if(stationary){return true;}
 let optical=s.normal.w<.06;let reflective=s.normal.w<${TEMPORAL_POLICY.mirrorRoughness}&&s.reflection.w!=-2.;
 if((optical||reflective)&&dot(octDirection(s.moments.zw),octDirection(old.moments.zw))<OPTICAL_VIEW_COS){return false;}
 if(optical&&!guideMatches(s.secondary,old.secondary,s.secondaryNormal,old.secondaryNormal,footprints.secondary)){return false;}
 if((optical||reflective)&&!guideMatches(s.reflection,old.reflection,s.reflectionNormal,old.reflectionNormal,footprints.reflection)){return false;}
 return true;
}
fn project(point:vec3f)->vec3f {
 let clip=config.previousVP*vec4f(point,1);if(clip.w<=1e-8||any(config.dims.zw==vec2u(0))){return vec3f(0,0,-1);}
 let ndc=clip.xy/clip.w;let pixel=(ndc*vec2f(.5,-.5)+.5)*vec2f(config.dims.zw)-.5;
 if(any(pixel<vec2f(-1))||any(pixel>=vec2f(config.dims.zw))){return vec3f(0,0,-1);}return vec3f(pixel,1);
}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=config.dims.xy)){return;}let i=gid.y*config.dims.x+gid.x;let s=samples[i];let stationary=config.state.y!=0u;let optical=s.position.w>=4.&&s.normal.w<.06;
 let background=s.position.w<0.;var accepted=false;var old=Accumulator(vec4f(0),vec4f(0));
 if(config.state.x!=0u){
  if(stationary&&all(config.dims.xy==config.dims.zw)){
   let prior=previousSamples[i];let h=previousHistory[i];
   if(background){if(prior.position.w<0.&&h.moments.w>.5){old=h;accepted=true;}}
   else if(candidateMatches(s,prior,h,currentFootprints(s,gid.xy),true)){old=h;accepted=true;}
  }else if(!background){
   let expected=previousGuide(s.position,s.normal);if(expected.valid!=0u){
    atomicAdd(&counters[5],1u);let projected=project(expected.point);
    if(projected.z>0.){
     let low=vec2i(floor(projected.xy));let footprints=currentFootprints(s,gid.xy);var best=1e30;
     for(var y=0;y<2;y++){for(var x=0;x<2;x++){
      let p=low+vec2i(x,y);if(any(p<vec2i(0))||any(p>=vec2i(config.dims.zw))){continue;}
      let j=u32(p.y)*config.dims.z+u32(p.x);let prior=previousSamples[j];let h=previousHistory[j];
      if(!candidateMatches(s,prior,h,footprints,false)){continue;}
      // Select one valid surface sample, avoiding bilinear mixing of distinct
      // reflected images, disocclusions or two independently aged histories.
      let score=length(prior.position.xyz-expected.point)/max(footprints.primary,1e-6)+.05*length(vec2f(p)-projected.xy);
      if(score<best){best=score;old=h;accepted=true;}
     }}
    }
   }
  }
 }
 if(background){atomicAdd(&counters[4],1u);}else{
  if(accepted){atomicAdd(&counters[0],1u);if(optical){atomicAdd(&counters[2],1u);}}
  else{atomicAdd(&counters[1],1u);if(optical){atomicAdd(&counters[3],1u);}}
 }
 let maximum=max(1u,config.state.z);var cap=maximum;
 if(!stationary){cap=min(maximum,select(select(select(${TEMPORAL_POLICY.roughMaxSamples}u,${TEMPORAL_POLICY.moderatelyRoughMaxSamples}u,s.normal.w<.4),${TEMPORAL_POLICY.glossyMaxSamples}u,s.normal.w<${TEMPORAL_POLICY.mirrorRoughness}),${TEMPORAL_POLICY.opticalMaxSamples}u,optical));}
 let oldCount=select(0.,min(max(0.,old.moments.w),f32(cap-1u)),accepted);let count=oldCount+1.;let amount=1./count;
 let color=mix(old.radiance,s.color,amount);let moments=mix(old.moments.xy,s.moments.xy,amount);var variance=max(0.,moments.y-moments.x*moments.x)/count;
 // Preserve the original spatial bootstrap when a disocclusion has too few
 // independent samples for a temporal variance estimate.
 if(oldCount<4.&&s.position.w>=0.&&s.color.w>.999){
  var first=0.;var second=0.;var neighbors=0.;
  for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
   let p=vec2i(gid.xy)+vec2i(x,y);if(any(p<vec2i(0))||any(p>=vec2i(config.dims.xy))){continue;}let q=samples[u32(p.y)*config.dims.x+u32(p.x)];
   if(abs(q.position.w-s.position.w)>.1||q.color.w<.999||dot(q.normal.xyz,s.normal.xyz)<.95){continue;}
   let delta=q.position.xyz-s.position.xyz;if(max(abs(dot(delta,s.normal.xyz)),abs(dot(delta,q.normal.xyz)))>.002){continue;}
   first+=q.moments.x;second+=q.moments.y;neighbors+=1.;
  }}if(neighbors>1.){let localMean=first/neighbors;variance=max(variance,max(0.,second/neighbors-localMean*localMean)/count);}
 }
 history[i]=Accumulator(color,vec4f(moments,variance,count));output[i]=vec4f(color.rgb,variance);
 if(!background){atomicAdd(&counters[6],u32(count));atomicMax(&counters[7],u32(count));}
}
`;
