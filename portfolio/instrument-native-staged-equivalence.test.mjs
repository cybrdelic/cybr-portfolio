import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {createNativeStagedInitialState,advanceNativeStagedState} from './instrument-native-staged-transport.mjs';
import {traceNativeGeometryRay} from './instrument-native-geometry-transport.mjs';

// Independent closed-form fixtures, in native millimetres. They deliberately
// supply opaque candidates beyond the next dielectric so ordering is tested.
const glass={ior:1.5,sigma:[.1,.2,.3]},water={ior:4/3,sigma:[.4,.5,.6]};
const media=[glass,{ior:1,sigma:[0,0,0]},glass,water],paper=[.8,.7,.6];
const zeroMedia=media.map(m=>({...m,sigma:[0,0,0]}));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),unit=p=>p.map(v=>v/Math.hypot(...p));
const close=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`),vecClose=(a,b,t=1e-9)=>a.forEach((v,i)=>close(v,b[i],t));
const point=(ro,rd,d)=>ro.map((v,i)=>v+rd[i]*d);
function nearestOptical(slabs,ro,rd,min=.00025,max=10000){
 let hit=null;for(const s of slabs)for(const [z,normal]of[[s.lo,[0,0,-1]],[s.hi,[0,0,1]]]){
  const distance=(z-ro[2])/rd[2];if(!Number.isFinite(distance)||distance<=min||distance>=max||hit&&distance>=hit.distance)continue;
  hit={distance,point:point(ro,rd,distance),normal,id:s.id,entering:dot(normal,rd)<0};
 }return hit;
}
function nearestOpaque(planes,ro,rd,min=.00025,max=10000){
 let hit=null;for(const p of planes){const distance=(p.value-ro[p.axis])/rd[p.axis];if(!Number.isFinite(distance)||distance<=min||distance>=max||hit&&distance>=hit.distance)continue;
  hit={distance,point:point(ro,rd,distance),object:{name:p.name},materialId:p.materialId??17,triangleId:p.triangleId??31};
 }return hit;
}
function seededStack(slabs,origin){return slabs.filter(s=>origin[2]>s.lo&&origin[2]<s.hi).map(s=>s.id);}
function run({slabs,planes=[],origin=[0,0,-1],direction=[0,0,1],properties=media,stack=seededStack(slabs,origin),glassIorOffset=0}){
 let state=createNativeStagedInitialState({origin,direction,stack});const identities=[];
 for(let i=0;i<20&&state.status==='active';i++){
  const optical=nearestOptical(slabs,state.origin,state.direction),opaque=nearestOpaque(planes,state.origin,state.direction),previous=state.interfaceCount;
  state=advanceNativeStagedState({state,optical,opaque,media:properties,paperRadiance:paper,glassIorOffset});
  if(state.interfaceCount!==previous)identities.push(optical.id);
 }return{state,identities};
}
const gapSlabs=[{id:1,lo:0,hi:2},{id:4,lo:2.2,hi:5.2}];
const nestedSlabs=[{id:1,lo:0,hi:10},{id:4,lo:2,hi:8}];
const tGlass=24/25,tWater=48/49,tGlassWater=288/289;
const expectedWeight=(factor,g,w)=>glass.sigma.map((sigma,i)=>factor*Math.exp(-sigma*g-water.sigma[i]*w));

test('one-interface staging preserves independent Fresnel and full Beer lengths across a real .2 mm air gap',()=>{
 const {state,identities}=run({slabs:gapSlabs,planes:[{axis:2,value:8,name:'terminal native plate'}]});
 assert.equal(state.status,'opaque');assert.deepEqual(identities,[1,1,4,4]);assert.equal(state.interfaceCount,4);assert.deepEqual(state.stack,[]);assert.equal(state.opaqueHit.object.name,'terminal native plate');
 vecClose(state.opaqueHit.point,[0,0,8]);vecClose(state.weight,expectedWeight(tGlass**2*tWater**2,2,3));assert.equal(state.radiance,null);
});

test('nested water exit restores enclosing glass instead of silently replacing it with air',()=>{
 const {state,identities}=run({slabs:nestedSlabs,planes:[{axis:2,value:12,name:'outside native plate'}]});
 assert.equal(state.status,'opaque');assert.deepEqual(identities,[1,4,4,1]);assert.deepEqual(state.stack,[]);
 vecClose(state.weight,expectedWeight(tGlass**2*tGlassWater**2,4,6));vecClose(state.opaqueHit.point,[0,0,12]);
});

test('a source inside nested water has no invented entrance losses and stops at the nearest opaque native hit',()=>{
 const {state,identities}=run({slabs:nestedSlabs,origin:[0,0,5],planes:[{axis:2,value:9.5,name:'farther plate'},{axis:2,value:9,name:'nearest interior plate'}]});
 assert.equal(state.status,'opaque');assert.deepEqual(identities,[4]);assert.deepEqual(state.stack,[1]);assert.equal(state.opaqueHit.object.name,'nearest interior plate');vecClose(state.opaqueHit.point,[0,0,9]);
 vecClose(state.weight,expectedWeight(tGlassWater,1,3));
});

test('TIR retains glass and all reflection energy before an actual opaque terminal after 10 mm',()=>{
 const {state,identities}=run({slabs:[{id:1,lo:0,hi:10}],origin:[0,0,5],direction:[.8,0,.6],planes:[{axis:0,value:8,name:'plate after reflection'}]});
 assert.equal(state.status,'opaque');assert.deepEqual(identities,[1]);assert.deepEqual(state.stack,[1]);vecClose(state.direction,[.8,0,-.6]);vecClose(state.opaqueHit.point,[8,0,9]);
 vecClose(state.weight,[Math.exp(-1),Math.exp(-2),Math.exp(-3)]);assert.equal(state.interfaceCount,1);
});

test('oblique secant lengths and reciprocal Fresnel agree with closed-form parallel slabs',()=>{
 // Incident sin=.6: transmitted sin=.4 in glass, .45 in water.
 const cosAir=.8,cosGlass=Math.sqrt(1-.4**2),cosWater=Math.sqrt(1-.45**2);
 const fresnel=(n,ci,ct)=>.5*(((ci-n*ct)/(ci+n*ct))**2+((n*ci-ct)/(n*ci+ct))**2);
 const factor=(1-fresnel(1.5,cosAir,cosGlass))**2*(1-fresnel(4/3,cosAir,cosWater))**2;
 const {state}=run({slabs:gapSlabs,direction:[.6,0,.8],planes:[{axis:2,value:8,name:'oblique terminal'}]});
 assert.equal(state.status,'opaque');vecClose(state.direction,[.6,0,.8]);vecClose(state.weight,expectedWeight(factor,2/cosGlass,3/cosWater));
 const airZ=9-2-3,x=airZ*.6/.8+2*.4/cosGlass+3*.45/cosWater;vecClose(state.opaqueHit.point,[x,0,8]);
});

test('staged and retained monolithic CPU paths agree across seeded, oblique, nested and reflected rays',()=>{
 const cases=[{slabs:gapSlabs,origin:[0,0,-1],direction:[0,0,1],planes:[{axis:2,value:8,name:'normal'}]},
  {slabs:gapSlabs,origin:[0,0,-1],direction:[.6,0,.8],planes:[{axis:2,value:8,name:'oblique'}]},
  {slabs:nestedSlabs,origin:[0,0,-1],direction:[0,0,1],planes:[{axis:2,value:12,name:'nested'}]},
  {slabs:nestedSlabs,origin:[0,0,5],direction:[0,0,1],planes:[{axis:2,value:9,name:'inside'}]},
  {slabs:[{id:1,lo:0,hi:10}],origin:[0,0,5],direction:[.8,0,.6],planes:[{axis:0,value:8,name:'TIR'}]}];
 for(const c of cases){
  const localSlabs=c.slabs.map(s=>({...s,module:s.id===1?0:1,solidId:s.id===1?1:2}));
  const kernel={contains:(p,module,id)=>localSlabs.some(s=>s.module===module&&s.solidId===id&&p[2]>s.lo&&p[2]<s.hi),nextOpticalEvent(ro,rd,{module,minDistance,maxDistance}){
   const hit=nearestOptical(localSlabs.filter(s=>s.module===module),ro,rd,minDistance,maxDistance);return hit?{...hit,solidId:hit.id===1?1:2}:null;
  }};
  const atlas={intersectRay:(ro,rd,{minDistance,maxDistance})=>nearestOpaque(c.planes,ro,rd,minDistance,maxDistance)},identity=new THREE.Matrix4();
  const reference=traceNativeGeometryRay({kernel,atlas,world:[identity,identity],inverse:[identity,identity],media,origin:c.origin,direction:c.direction}),{state}=run(c);
  assert.equal(state.status,'opaque');assert.equal(reference.exhausted,false);assert.equal(state.interfaceCount,reference.events.length);vecClose(state.weight,reference.weight);vecClose(state.direction,reference.direction);vecClose(state.opaqueHit.point,reference.point);
 }
});

test('exact opaque records survive early termination and new states do not mutate their inputs',()=>{
 const state=createNativeStagedInitialState({origin:[0,0,1],direction:[0,0,1],stack:[1]});for(const k of['origin','direction','weight','stack'])Object.freeze(state[k]);Object.freeze(state);
 const optical={distance:9,point:[0,0,10],normal:[0,0,1],id:1,entering:false},opaque={distance:2,point:[0,0,3],object:{name:'exact CAD object'},materialId:27,triangleId:114,bary:[.2,.3,.5]};
 const next=advanceNativeStagedState({state,optical,opaque,media,paperRadiance:paper});assert.notEqual(next,state);assert.equal(next.status,'opaque');assert.equal(next.opaqueHit,opaque);assert.equal(next.interfaceCount,0);assert.equal(next.radiance,null);
 vecClose(next.weight,glass.sigma.map(s=>Math.exp(-2*s)));assert.deepEqual(state.weight,[1,1,1]);assert.deepEqual(state.origin,[0,0,1]);
 const terminal=advanceNativeStagedState({state:next,optical,opaque,media,paperRadiance:paper});assert.deepEqual(terminal,next);
});

test('strict native atlas distance convention gives a coincident optical/opaque tie to the interface',()=>{
 const state=createNativeStagedInitialState({origin:[0,0,1],direction:[0,0,1],stack:[1]}),optical={distance:1,point:[0,0,2],normal:[0,0,1],id:1,entering:false},opaque={distance:1,point:[0,0,2],materialId:8};
 const next=advanceNativeStagedState({state,optical,opaque,media,paperRadiance:paper});assert.equal(next.status,'active');assert.equal(next.opaqueHit,null);assert.equal(next.interfaceCount,1);assert.deepEqual(next.stack,[]);vecClose(next.weight,glass.sigma.map(s=>tGlass*Math.exp(-s)));
});

test('exterior paper, missing closed boundary, raw event exhaustion and interface budget stay distinct',()=>{
 const air=createNativeStagedInitialState({origin:[0,0,-1],direction:[0,0,1]}),finished=advanceNativeStagedState({state:air,optical:null,opaque:null,media,paperRadiance:paper});assert.equal(finished.status,'paper');vecClose(finished.radiance,paper);
 const inside=createNativeStagedInitialState({origin:[0,0,5],direction:[0,0,1],stack:[1]}),missing=advanceNativeStagedState({state:inside,optical:null,opaque:null,media,paperRadiance:paper});assert.equal(missing.status,'black');assert.equal(missing.reason,'missing-closed-boundary');assert.deepEqual(missing.radiance,[0,0,0]);
 const raw=advanceNativeStagedState({state:air,optical:{budgetExhausted:true},opaque:null,media,paperRadiance:paper});assert.equal(raw.status,'exhausted');assert.equal(raw.reason,'raw-event-budget');assert.deepEqual(raw.radiance,[0,0,0]);
 const {state}=run({slabs:[{id:1,lo:0,hi:10}],origin:[0,0,5],direction:[.8,0,.6],properties:zeroMedia});assert.equal(state.status,'exhausted');assert.equal(state.interfaceCount,16);assert.equal(state.reason,'interface-budget');assert.deepEqual(state.stack,[1]);assert.deepEqual(state.weight,[1,1,1]);assert.deepEqual(state.radiance,[0,0,0]);
});

test('removing a non-top medium preserves the active medium, and dispersion offsets only glass',()=>{
 const state=createNativeStagedInitialState({origin:[0,0,0],direction:[0,0,1],stack:[1,4]}),optical={distance:1,point:[0,0,1],normal:[0,0,1],id:1,entering:false};
 const next=advanceNativeStagedState({state,optical,opaque:null,media,paperRadiance:paper});assert.deepEqual(next.stack,[4]);vecClose(next.direction,[0,0,1]);vecClose(next.weight,water.sigma.map(s=>Math.exp(-s*1.001)));
 const glassEnter={distance:1,point:[0,0,0],normal:[0,0,-1],id:1,entering:true},air=createNativeStagedInitialState({origin:[0,0,-1],direction:[0,0,1]}),offset=.025;
 const dispersed=advanceNativeStagedState({state:air,optical:glassEnter,opaque:null,media:zeroMedia,paperRadiance:paper,glassIorOffset:offset});const transmission=1-((1.5+offset-1)/(1.5+offset+1))**2;vecClose(dispersed.weight,[transmission,transmission,transmission]);
 const waterEnter={...glassEnter,id:4},w=advanceNativeStagedState({state:air,optical:waterEnter,opaque:null,media:zeroMedia,paperRadiance:paper,glassIorOffset:offset});vecClose(w.weight,[tWater,tWater,tWater]);
});
