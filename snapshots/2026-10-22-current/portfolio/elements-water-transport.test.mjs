import test from 'node:test';
import assert from 'node:assert/strict';
import {
 trilinearRayPolynomial, evaluateWaterPolynomial, firstWaterCrossing,
 dielectricWaterDirection, dielectricWaterFresnel, nativeWaterTransportGLSL,
 WATER_TRANSPORT_LIMITS,
 waterDdaCellsFloat32,
 centralWaterGradient, guardWaterOpticalNormal,
 waterTransportWeights,
} from './elements-water-transport.mjs';

const near=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const length=v=>Math.sqrt(dot(v,v));
const interpolate=(v,u)=>{
 let result=0;
 for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)result+=v[x+2*y+4*z]*(x?u[0]:1-u[0])*(y?u[1]:1-u[1])*(z?u[2]:1-u[2]);
 return result;
};

test('ray cubic exactly reproduces native trilinear interpolation',()=>{
 let state=12345;const random=()=>((state=(1664525*state+1013904223)>>>0)/4294967296);
 for(let trial=0;trial<200;trial++){
  const v=Array.from({length:8},()=>random()*4-2),u=Array.from({length:3},()=>random()),end=Array.from({length:3},()=>random()),w=end.map((x,i)=>x-u[i]);
  const polynomial=trilinearRayPolynomial(v,u,w);
  for(let step=0;step<=10;step++){
   const t=step/10;near(evaluateWaterPolynomial(polynomial,t),interpolate(v,u.map((x,i)=>x+t*w[i])),3e-14);
  }
 }
});

test('finds first directed crossing when cubic has three real roots',()=>{
 const a=[-.08,.66,-1.5,1];
 near(firstWaterCrossing(a).t,.2);
 near(firstWaterCrossing(a,{fromInside:false}).t,.5);
});

test('rejects negative tangent touch and zero field rather than inventing an exit',()=>{
 assert.equal(firstWaterCrossing([-.25,1,-1,0]),null);
 assert.equal(firstWaterCrossing([0,0,0,0]),null);
 assert.equal(firstWaterCrossing([.25,-1,1,0],{fromInside:false}),null);
});

test('triple zero is a crossing even with zero first derivative',()=>{
 near(firstWaterCrossing([-.125,.75,-1.5,1]).t,.5,1e-5);
 near(firstWaterCrossing([.125,-.75,1.5,-1],{fromInside:false}).t,.5,1e-5);
});

test('initial boundary heading inward is not a false exit',()=>{
 near(firstWaterCrossing([0,-.5,1,0]).t,.5);
 assert.equal(firstWaterCrossing([0,-1,0,0]),null);
});

test('directed cell-face crossings are retained',()=>{
 assert.equal(firstWaterCrossing([-1,1,0,0]).t,1);
 assert.equal(firstWaterCrossing([0,1,0,0]).t,0);
 assert.equal(firstWaterCrossing([1,-1,0,0],{fromInside:false}).t,1);
});

test('coefficient magnitude does not change the represented boundary',()=>{
 for(const scale of [1e-20,1,1e20])near(firstWaterCrossing([-.35*scale,scale,0,0]).t,.35);
});

test('stable derivative quadratic preserves tiny critical point',()=>{
 const crossing=firstWaterCrossing([-1e-10,1,-1e8,1],{refinements:40});
 assert.ok(crossing&&crossing.t>0&&crossing.t<5e-9);
 near(evaluateWaterPolynomial([-1e-10,1,-1e8,1],crossing.t),0,1e-18);
});

test('normal incidence follows exact dielectric Fresnel and unchanged ray',()=>{
 const expected=((1.333-1)/(1.333+1))**2;
 near(dielectricWaterFresnel(1,1.333),expected);
 near(dielectricWaterFresnel(1,1/1.333),expected);
 const result=dielectricWaterDirection([0,1,0],[0,1,0],1.333);
 assert.equal(result.tir,false);assert.deepEqual(result.direction,[0,1,0]);
});

test('subcritical exit obeys Snell and preserves unit direction',()=>{
 const theta=.4,direction=[Math.sin(theta),Math.cos(theta),0];
 const result=dielectricWaterDirection(direction,[0,1,0],1.333);
 assert.equal(result.tir,false);near(length(result.direction),1);
 near(result.direction[0],1.333*Math.sin(theta));assert.ok(result.direction[1]>0);
});

test('TIR reflects at the exit boundary and preserves all internal throughput',()=>{
 const direction=[Math.sqrt(.75),.5,0],outward=[0,1,0];
 const reflected=dielectricWaterDirection(direction,outward,1.333);
 assert.equal(reflected.tir,true);near(length(reflected.direction),1);
 assert.ok(dot(reflected.direction,outward)<0);near(reflected.direction[0],direction[0]);
 assert.equal(dielectricWaterFresnel(.5,1.333),1);
 const entryFresnel=dielectricWaterFresnel(1,1/1.333),sigma=.07,pathBefore=1.7,pathAfter=.3;
 const retained=(1-entryFresnel)*Math.exp(-sigma*pathBefore);
 const next=retained*1*Math.exp(-sigma*pathAfter);
 near(next,(1-entryFresnel)*Math.exp(-sigma*(pathBefore+pathAfter)));
});

test('exact Fresnel reaches one continuously at critical angle',()=>{
 const critical=Math.sqrt(1-1/(1.333**2));
 const almost=dielectricWaterFresnel(critical+1e-10,1.333);
 assert.ok(almost>.9998&&almost<=1);assert.equal(dielectricWaterFresnel(critical-1e-10,1.333),1);
});

test('GLSL transport has bounded, separately diagnosed TIR and numerical failure',()=>{
 assert.equal(WATER_TRANSPORT_LIMITS.totalCells,96);
 assert.equal(WATER_TRANSPORT_LIMITS.tirBounces,4);
 assert.match(nativeWaterTransportGLSL,/if\(boundary\.status!=0\)\{result\.status=boundary\.status;return result;\}/);
 assert.match(nativeWaterTransportGLSL,/reflect\(direction,result\.exitNormal\)/);
 assert.match(nativeWaterTransportGLSL,/ro=boundary\.point-boundary\.normal\*boundary\.margin/);
 assert.match(nativeWaterTransportGLSL,/result\.status=3;return result;/);
 assert.doesNotMatch(nativeWaterTransportGLSL,/studio|reflection\s*=\s*1/);
 assert.match(nativeWaterTransportGLSL,/min\(uWaterVoxelSize\*2\.0,max\(0\.0,maximumEntryBacktrack\)\)/);
 assert.match(nativeWaterTransportGLSL,/c\.range\.x<=0\.0&&c\.range\.y>=0\.0/);
 assert.doesNotMatch(nativeWaterTransportGLSL,/floor\(location\+sign/);
 assert.match(nativeWaterTransportGLSL,/cell\.x\+=cellStep\.x/);
});

test('float32 integer DDA cannot revisit cells across 10,000 stress rays',()=>{
 let state=12345;const random=()=>((state=(1664525*state+1013904223)>>>0)/4294967296);
 let legacyRepeats=0;
 for(let trial=0;trial<10000;trial++){
  const origin=[random()*190,random()*50,random()*103],direction=Array.from({length:3},()=>(random()-.5)*140);
  const maximumTravel=25/Math.max(...direction.map(Math.abs));
  const result=waterDdaCellsFloat32(origin,direction,{maximumTravel});
  assert.ok(result.complete,`budget at trial ${trial}`);
  assert.equal(new Set(result.cells.map(item=>item.cell.join(','))).size,result.cells.length,`repeated cell at trial ${trial}`);
  assert.ok(result.cells.every(item=>item.segment>0));
  const legacy=waterDdaCellsFloat32(origin,direction,{maximumTravel,legacy:true});
  if(new Set(legacy.cells.map(item=>item.cell.join(','))).size!==legacy.cells.length)legacyRepeats++;
 }
 // This asserts the regression actually reproduces the rejected arithmetic,
 // not merely that an unrelated collection of rays happens to pass.
 assert.ok(legacyRepeats>100,`only ${legacyRepeats} legacy failures`);
});

test('exact tied faces advance every axis and negative boundary owns lower cell',()=>{
 const positive=waterDdaCellsFloat32([150,40,60],[1,1,1],{maximumTravel:3.5});
 assert.deepEqual(positive.cells.map(item=>item.cell),[[150,40,60],[151,41,61],[152,42,62],[153,43,63]]);
 const negative=waterDdaCellsFloat32([150,40,60],[-1,-1,-1],{maximumTravel:3.5});
 assert.deepEqual(negative.cells.map(item=>item.cell),[[149,39,59],[148,38,58],[147,37,57],[146,36,56]]);
});

test('parallel grid axes remain finite without fake corner advances',()=>{
 const result=waterDdaCellsFloat32([150,40.5,60.5],[0,-1,0],{maximumTravel:3});
 assert.equal(result.complete,true);
 assert.deepEqual(result.cells.map(item=>item.cell),[[150,40,60],[150,39,60],[150,38,60],[150,37,60]]);
 assert.ok(result.cells.every(item=>Number.isFinite(item.travel)&&Number.isFinite(item.segment)));
});

test('source-voxel gradient reproduces planes with anisotropic spacing',()=>{
 const sample=p=>p[0]+2*p[1]+3*p[2];
 const gradient=centralWaterGradient(sample,[2,3,4],[.1,.4,.9]);
 gradient.forEach((value,axis)=>near(value,axis+1));
});

test('one-voxel derivative removes C0 face-normal jump without changing surface samples',()=>{
 const sample=p=>p[1]-.2*Math.abs(p[0]);
 const left=centralWaterGradient(sample,[-.0001,0,0],[1,1,1]);
 const right=centralWaterGradient(sample,[.0001,0,0],[1,1,1]);
 near(left[0],.00002);near(right[0],-.00002);near(left[1],1);near(right[1],1);
 // Exact one-sided geometric gradients differ by .4; filtered gradients
 // differ by .00004, while both optical and geometric zero surfaces agree.
 near(sample([.5,.1,0]),0);
});

test('optical normal guard never emits rays on incorrect exact geometric side',()=>{
 const geometric=[0,1,0];let seed=2026;
 const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 for(const exiting of [false,true])for(let trial=0;trial<2000;trial++){
  const side=exiting?1:-1,cos=.0001+random()*.9999,sin=Math.sqrt(1-cos*cos),angle=random()*Math.PI*2;
  const incident=[sin*Math.cos(angle),side*cos,sin*Math.sin(angle)],candidate=[random()*2-1,random()*2-1,random()*2-1];
  const normal=guardWaterOpticalNormal(candidate,geometric,incident,{exiting});
  near(length(normal),1);assert.ok(dot(normal,geometric)>0);
  const cosine=dot(incident,normal),reflected=incident.map((v,i)=>v-2*cosine*normal[i]);
  assert.ok(dot(reflected,geometric)*(-side)>-1e-12);
  const transmission=dielectricWaterDirection(incident,normal,exiting?1.333:1/1.333);
  if(!transmission.tir)assert.ok(dot(transmission.direction,geometric)*side>-1e-12);
 }
});

test('degenerate or reversed optical source gradient falls back to exact geometry',()=>{
 const geometric=[0,1,0],incident=[0,-1,0];
 assert.deepEqual(guardWaterOpticalNormal([0,0,0],geometric,incident),geometric);
 assert.deepEqual(guardWaterOpticalNormal([0,-1,0],geometric,incident),geometric);
});

test('dielectric entry/absorption/reflected exit/transmitted exit conserve unit weight',()=>{
 for(const entry of [0,.02,.5,1])for(const exit of [0,.02,.5,.85,1])for(const transmittance of [0,.3,1]){
  const weights=waterTransportWeights(entry,exit,transmittance);
  near(Object.values(weights).reduce((sum,value)=>sum+value,0),1,1e-14);
  assert.ok(Object.values(weights).every(value=>value>=0&&value<=1));
 }
 assert.throws(()=>waterTransportWeights(-.1,.1),RangeError);
});

test('white furnace remains white through four bodies when omitted exit branch is closed once',()=>{
 for(const exitFresnel of [.02,.5,.85]){
  let radiance=0,beta=1,oldRadiance=0,oldBeta=1;
  for(let body=0;body<4;body++){
   const weights=waterTransportWeights(.02,exitFresnel,1);
   radiance+=beta*(weights.entryReflection+weights.exitReflection);beta*=weights.transmission;
   oldRadiance+=oldBeta*weights.entryReflection;oldBeta*=weights.transmission;
  }
  near(radiance+beta,1,1e-14);
  assert.ok(oldRadiance+oldBeta<1);
  if(exitFresnel===.85)assert.ok(oldRadiance+oldBeta<.025);
 }
});

test('exit reflection record stays inside geometry and never duplicates front reflection',()=>{
 assert.match(nativeWaterTransportGLSL,/result\.exitReflectionPoint=boundary\.point-boundary\.normal\*boundary\.margin/);
 assert.match(nativeWaterTransportGLSL,/result\.exitReflectionDirection=normalize\(reflect\(direction,result\.exitNormal\)\)/);
 assert.doesNotMatch(nativeWaterTransportGLSL,/exitReflectionDirection=normalize\(reflect\(incident/);
 const weights=waterTransportWeights(.02,.4,.8);
 near(weights.exitReflection,.98*.8*.4);near(weights.transmission,.98*.8*.6);
});

test('divergent optical traversal uses explicit LOD0 for all filtered source samples',()=>{
 assert.equal((nativeWaterTransportGLSL.match(/textureLod\(uWaterVolume,/g)||[]).length,6);
 assert.doesNotMatch(nativeWaterTransportGLSL,/\btexture\(uWaterVolume/);
 for(const field of ['entryNormal','entryGeometricNormal','exitNormal','exitGeometricNormal','exitReflectionDirection'])assert.match(nativeWaterTransportGLSL,new RegExp(`result\\.${field}=vec3\\(0\\.0\\)`));
});
