import test from 'node:test';
import assert from 'node:assert/strict';
import {TEMPORAL_UNIFORM_BYTES,accumulationShader,rotateQuaternion,encodeOctahedral,decodeOctahedral,rigidPreviousPoint,rigidPreviousNormal,reprojectPoint,candidateCoordinates,temporalCandidateMatches,blendTemporalSample,movingHistoryCap} from './instrument-temporal.mjs';

const close=(a,b,tolerance=1e-10)=>{assert.equal(a.length,b.length);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<tolerance,`${a} != ${b}`));};
const identityQuaternion=[0,0,0,1],identityMatrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const motion=()=>({valid:true,currentQuaternion:identityQuaternion,currentTranslation:[0,0,0],previousQuaternion:identityQuaternion,previousTranslation:[0,0,0]});
const motions=()=>[null,motion(),motion(),motion(),motion()];
const sample=(roughness=.7)=>({color:[.2,.2,.2,1],position:[0,0,0,4],normal:[0,0,1,roughness],moments:[.2,.04,...encodeOctahedral([0,0,-1])],secondary:[0,0,0,-1],secondaryNormal:[0,0,0,0],reflection:[0,0,0,-2],reflectionNormal:[0,0,0,0]});
const history=(count=8)=>({radiance:[.2,.2,.2,1],moments:[.2,.04,0,count]});
const clone=value=>structuredClone(value);

test('rigid reprojection and its reverse recover original local geometry and normals',()=>{
 const s=Math.SQRT1_2,m={...motion(),currentQuaternion:[0,0,s,s],currentTranslation:[10,-3,1],previousTranslation:[-4,5,2]};
 const local=[2,3,4],current=rotateQuaternion(local,m.currentQuaternion).map((v,i)=>v+m.currentTranslation[i]);
 close(current,[7,-1,5]);const previous=rigidPreviousPoint(current,m);close(previous,[-2,8,6]);
 close(rigidPreviousNormal([-1,0,0],m),[0,1,0]);
 const reverse={valid:true,currentQuaternion:m.previousQuaternion,currentTranslation:m.previousTranslation,previousQuaternion:m.currentQuaternion,previousTranslation:m.currentTranslation};
 close(rigidPreviousPoint(previous,reverse),current);assert.equal(rigidPreviousPoint(current,{...m,valid:false}),null);
});

test('exact primary direction encoding covers the octahedron seams and both hemispheres',()=>{
 for(const direction of [[0,0,-1],[0,0,1],[1,0,0],[0,-1,0],[1,2,-3],[-2,-3,-4],[.001,1,-.002]]){
  const norm=Math.hypot(...direction);close(decodeOctahedral(encodeOctahedral(direction)),direction.map(v=>v/norm));
 }
 assert.throws(()=>encodeOctahedral([0,0,0]),/nonzero/);
});

test('previous projection maps pixel centres correctly across resolution changes and rejects behind-camera points',()=>{
 close(reprojectPoint([0,0,0],identityMatrix,[1280,720]).pixel,[639.5,359.5]);
 const projection=[1,0,0,0,0,1,0,0,0,0,-1,-1,0,0,-2,0];
 const large=reprojectPoint([1,0,-2],projection,[1280,720]),small=reprojectPoint([1,0,-2],projection,[640,360]);
 close(large.pixel,[959.5,359.5]);close(small.pixel,[479.5,179.5]);
 close(small.pixel,large.pixel.map(v=>(v+.5)/2-.5));
 assert.equal(reprojectPoint([0,0,2],projection,[1280,720]),null);
 assert.deepEqual(candidateCoordinates([-0.2,0.4],[4,4]),[[0,0],[0,1]]);
 assert.deepEqual(candidateCoordinates([2.7,2.9],[4,4]),[[2,2],[3,2],[2,3],[3,3]]);
});

test('translated and rotated real geometry reuses matching history in both traversal directions',()=>{
 const current=sample(),previous=sample(),s=Math.SQRT1_2;
 const records=motions();records[1]={...motion(),currentQuaternion:[0,0,s,s],currentTranslation:[1,0,0]};
 current.position=[.5,.25,0,4];previous.position=[.25,.5,0,4];
 assert.equal(temporalCandidateMatches(current,previous,history(),records),true);
 records[1]={...records[1],currentQuaternion:identityQuaternion,currentTranslation:[0,0,0],previousQuaternion:[0,0,s,s],previousTranslation:[1,0,0]};
 assert.equal(temporalCandidateMatches(previous,current,history(),records),true);
});

test('disoccluded instances, separated planes, flipped normals, finish changes and deformed cables reject history',()=>{
 const current=sample(),original=sample(),records=motions();
 assert.equal(temporalCandidateMatches(current,original,history(),records),true);
 for(const change of [s=>s.position[3]=5,s=>s.position[2]=.001,s=>s.position[0]=.004,s=>s.normal[2]=-1,s=>s.normal[3]=.2]){
  const previous=clone(original);change(previous);assert.equal(temporalCandidateMatches(current,previous,history(),records),false);
 }
 records[1].valid=false;assert.equal(temporalCandidateMatches(current,original,history(),records),false);
 assert.equal(temporalCandidateMatches(current,original,history(),records,{stationary:true}),false);
});

function opticalSample(){const s=sample(0);s.secondary=[0,0,-.04,5];s.secondaryNormal=[0,0,1,.8];s.reflection=[Math.SQRT1_2,0,Math.SQRT1_2,-1];return s;}
test('glass primary matches cannot hide refraction disocclusions or sky-direction changes',()=>{
 const current=opticalSample(),original=opticalSample(),records=motions();
 assert.equal(temporalCandidateMatches(current,original,history(),records),true);
 for(const change of [s=>s.secondary[3]=6,s=>s.secondary[2]=-.05,s=>s.secondaryNormal[2]=-1]){
  const previous=clone(original);change(previous);assert.equal(temporalCandidateMatches(current,previous,history(),records),false);
 }
 current.secondary=[0,0,-1,-1];const previous=clone(current);previous.secondary=[.01,0,-Math.sqrt(1-.01**2),-1];
 assert.equal(temporalCandidateMatches(current,previous,history(),records),false);
 previous.secondary=current.secondary.slice();assert.equal(temporalCandidateMatches(current,previous,history(),records),true);
 previous.secondary=[0,0,0,-1];assert.equal(temporalCandidateMatches(current,previous,history(),records),false);
});
test('undefined bounded optical guides reject motion but cannot prevent stationary convergence',()=>{
 const current=opticalSample();current.secondary=[0,0,0,-1];current.reflection=[0,0,0,-1];
 const previous=clone(current),h=history(63),records=motions();
 assert.equal(temporalCandidateMatches(current,previous,h,records),false);
 assert.equal(temporalCandidateMatches(current,previous,h,records,{stationary:true}),true);
 assert.equal(blendTemporalSample(current,h,{stationary:true}).moments[3],64);
});

test('reflected image motion and exact orthographic view directions independently guard mirror history',()=>{
 const current=sample(.18);current.reflection=[.1,.1,.05,6];current.reflectionNormal=[0,0,1,.7];
 const original=clone(current),records=motions();assert.equal(temporalCandidateMatches(current,original,history(),records),true);
 for(const change of [s=>s.reflection[0]+=.01,s=>s.reflection[3]=7,s=>s.moments.splice(2,2,...encodeOctahedral([.02,0,-1]))]){
  const previous=clone(original);change(previous);assert.equal(temporalCandidateMatches(current,previous,history(),records),false);
 }
 current.reflection=[0,0,1,-1];const previous=clone(current);previous.reflection=[.002,0,Math.sqrt(1-.002**2),-1];
 assert.equal(temporalCandidateMatches(current,previous,history(),records),true);
 previous.reflection=[.02,0,Math.sqrt(1-.02**2),-1];assert.equal(temporalCandidateMatches(current,previous,history(),records),false);
});

test('coverage edges reject moving histories while stationary accumulation preserves antialiasing',()=>{
 const current=sample(),previous=sample(),h=history(3);current.color=[0,0,0,0];current.moments[0]=0;current.moments[1]=0;h.radiance=[.2,.2,.2,.5];
 assert.equal(temporalCandidateMatches(current,previous,h,motions()),false);
 assert.equal(temporalCandidateMatches(current,previous,h,motions(),{stationary:true}),true);
 const out=blendTemporalSample(current,h,{stationary:true});close(out.radiance,[.15,.15,.15,.375]);assert.equal(out.moments[3],4);
});

test('moving optical histories stay bounded, stationary reaches128, and rejected HDR samples retain their energy',()=>{
 const current=opticalSample();current.color=[4,4,4,1];current.moments.splice(0,2,4,16);
 const previous={radiance:[2,2,2,1],moments:[2,4,0,128]};
 const moving=blendTemporalSample(current,previous);close(moving.radiance,[2.25,2.25,2.25,1]);assert.equal(moving.moments[3],8);
 const stopped=blendTemporalSample(current,previous,{stationary:true});close(stopped.radiance,[2.015625,2.015625,2.015625,1]);assert.equal(stopped.moments[3],128);
 current.color=[20,10,5,1];const rejected=blendTemporalSample(current,previous,{accepted:false});close(rejected.radiance,current.color);assert.equal(rejected.moments[3],1);
});
test('rough bronze reuses its physical surface while sharp mirrors and glass retain exact view guards',()=>{
 const current=sample(.34),previous=clone(current),records=motions();
 current.moments.splice(2,2,...encodeOctahedral([.04,0,-1]));
 assert.equal(temporalCandidateMatches(current,previous,history(),records),true);
 for(const change of [s=>s.position[3]=5,s=>s.position[2]=.002,s=>s.normal[2]=-1,s=>s.normal[3]=.48]){
  const prior=clone(previous);change(prior);assert.equal(temporalCandidateMatches(current,prior,history(),records),false);
 }
 const mirror=sample(.24);mirror.reflection=[0,0,1,-1];const oldMirror=clone(mirror);
 mirror.moments.splice(2,2,...encodeOctahedral([.04,0,-1]));
 assert.equal(temporalCandidateMatches(mirror,oldMirror,history(),records),false);
 const glass=opticalSample(),oldGlass=clone(glass);glass.moments.splice(2,2,...encodeOctahedral([.04,0,-1]));
 assert.equal(temporalCandidateMatches(glass,oldGlass,history(),records),false);
});
test('roughness-bounded moving histories improve bronze without clamping HDR or increasing stationary limits',()=>{
 assert.equal(movingHistoryCap(sample(.24)),4);
 assert.equal(movingHistoryCap(sample(.299)),4);
 assert.equal(movingHistoryCap(sample(.3)),8);
 assert.equal(movingHistoryCap(sample(.34)),8);
 assert.equal(movingHistoryCap(sample(.399)),8);
 assert.equal(movingHistoryCap(sample(.4)),16);
 assert.equal(movingHistoryCap(opticalSample()),8);
 assert.equal(movingHistoryCap(sample(.34),3),3);
 const bronze=sample(.34);bronze.color=[20,10,5,1];const luminance=20*.2126+10*.7152+5*.0722;bronze.moments.splice(0,2,luminance,luminance*luminance);
 const previous={radiance:[2,2,2,1],moments:[2,4,0,128]};
 const moving=blendTemporalSample(bronze,previous);close(moving.radiance,[4.25,3,2.375,1]);assert.equal(moving.moments[3],8);
 assert.equal(blendTemporalSample(bronze,previous,{stationary:true}).moments[3],128);
});

test('GPU ABI retains immutable guide/history inputs and all eight distinct pixel vectors',()=>{
 assert.equal(TEMPORAL_UNIFORM_BYTES,160);
 assert.match(accumulationShader,/@binding\(2\) var<storage,read> previousSamples:array<Pixel>/);
 assert.match(accumulationShader,/@binding\(3\) var<storage,read> previousHistory:array<Accumulator>/);
 assert.match(accumulationShader,/reflection:vec4f,reflectionNormal:vec4f/);
 assert.match(accumulationShader,/counters:array<atomic<u32>,8>/);
 assert.doesNotMatch(accumulationShader,/clamp\(color|clamp\(radiance|previousHistory\[[^\]]+\]\s*=/);
});
