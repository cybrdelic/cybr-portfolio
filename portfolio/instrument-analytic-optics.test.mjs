import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createNativeOpticalKernel,createTriangleDuctBoundary,nativeWaterSurfaceAt,cubicRootsInInterval,nativeDielectric,traceNativeOpticalRay,analyticOpticsGLSL,packNativeOpticalPrimitives} from './instrument-analytic-optics.mjs';
const base=new URL('./',import.meta.url),load=p=>readFileSync(new URL(p,base)),json=p=>JSON.parse(load(p));
const recipe=json('assets/instrument-optical-primitives-v1/primitives.json'),reference=json('tests/fixtures/native-optics/native-optical-ray-reference.json');
const descriptorBytes=load('tests/fixtures/native-optics/native-optical-primitives.json'),descriptor=JSON.parse(descriptorBytes);
const binary=load('assets/instrument-optical-primitives-v1/native-water-cable-boundary.bin'),data=new DataView(binary.buffer,binary.byteOffset,binary.byteLength),vertices=data.getUint32(4,true),triangles=data.getUint32(8,true),positions=new Float32Array(vertices*3),normals=new Float32Array(vertices*3),indices=new Uint32Array(triangles*3);
for(let i=0;i<vertices*3;i++){positions[i]=data.getFloat32(16+i*4,true);normals[i]=data.getFloat32(16+vertices*12+i*4,true);}for(let i=0;i<triangles*3;i++)indices[i]=data.getUint32(16+vertices*24+i*4,true);
const duct=createTriangleDuctBoundary({positions,indices,normals}),kernel=createNativeOpticalKernel(recipe,{ductBoundary:duct});
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} vs ${b}`),vecNear=(a,b,tol=1e-7)=>a.forEach((v,i)=>near(v,b[i],tol)),unit=p=>p.map(v=>v/Math.hypot(...p));

test('runtime recipe and unchanged duct binary identify the exact native extraction',()=>{
  assert.equal(createHash('sha256').update(descriptorBytes).digest('hex'),recipe.sourceDescriptorSHA256);
  assert.equal(reference.sourceDescriptorSHA256,recipe.sourceDescriptorSHA256);
  assert.equal(createHash('sha256').update(binary).digest('hex'),recipe.water.duct.binary.sha256);
  assert.equal(data.getUint32(0,true),0x43594454);assert.equal(vertices,2962);assert.equal(triangles,5736);
  assert.equal(recipe.water.spans.length,40);assert.equal(recipe.water.bubbles.length,18);
  const packed=packNativeOpticalPrimitives(descriptor,{ductBoundsMM:recipe.water.duct.boundsMM});assert.deepEqual(packed.water.spans,recipe.water.spans);assert.deepEqual(packed.sources,recipe.sources);
});

test('all 60 exact native BREP events retain identities, order, normals and real cavities',()=>{
  let matched=0,primitiveMaximum=0,ductMaximum=0;
  for(const ray of reference.rays){
    const actual=kernel.allEvents(ray.originMM,ray.directionUnit,{module:ray.moduleCoordinateFrame==='light'?0:1,maxDistance:ray.maximumDistanceMM});
    assert.equal(actual.length,ray.hits.length,ray.name);
    for(let i=0;i<actual.length;i++){
      const a=actual[i],b=ray.hits[i],isDuct=b.surfaceKinds.includes('BSPLINE');
      const difference=Math.abs(a.distance-b.distanceMM);if(isDuct)ductMaximum=Math.max(ductMaximum,difference);else primitiveMaximum=Math.max(primitiveMaximum,difference);
      assert.equal(a.solidId,b.solid==='lens'?1:b.solidId,ray.name);assert.equal(a.entering,b.transition==='enter',ray.name);
      near(a.distance,b.distanceMM,isDuct?.075:1e-6);assert.ok(dot(a.normal,b.outwardNormal)>(isDuct?.99:.999999),`${ray.name}: normal`);matched++;
    }
  }
  assert.equal(matched,60);assert.ok(primitiveMaximum<1e-6);assert.ok(ductMaximum>.04&&ductMaximum<.075,'Measured sweep error must be reported rather than asserting requested deflection is a bound');
});

test('the native .2 mm air gap separates water from both glass walls',()=>{
  const events=kernel.allEvents([60,0,0],[-1,0,0],{module:1,maxDistance:140});
  near(events[2].distance-events[1].distance,.2);near(events[4].distance-events[3].distance,.2);
  assert.equal(kernel.contains([26.4,0,0],1,1),false);assert.equal(kernel.contains([26.4,0,0],1,2),false);
});

test('native bubble and swept duct create air intervals, with geometric containment at tangencies',()=>{
  const bubble=recipe.water.bubbles[0];assert.equal(kernel.contains(bubble.centerMM,1,2),false);
  assert.equal(duct.contains([0,-13,-9.5]),true);assert.equal(kernel.contains([0,-13,-9.5],1,2),false);
  const hits=duct.intersections([0,-13,60],[0,0,-1]);assert.equal(hits.length,2);
  for(const hit of hits){const outside=hit.point.map((p,i)=>p-hit.normal[i]*.00002),inside=hit.point.map((p,i)=>p+hit.normal[i]*.00002);assert.equal(duct.contains(outside),false);assert.equal(duct.contains(inside),true);}
});

test('exact cubic free surface differs from a flat cap and retains multiple real intervals',()=>{
  const at0=nativeWaterSurfaceAt(recipe,0),at12=nativeWaterSurfaceAt(recipe,12);near(at0.height,13.35);assert.ok(Math.abs(at12.height-at0.height)>.5);assert.ok(at0.normal[2]>0);
  const ray=reference.rays.find(r=>r.name==='elements-waterline-multiple-intervals');const hits=kernel.allEvents(ray.originMM,ray.directionUnit,{module:1,maxDistance:ray.maximumDistanceMM}).filter(h=>h.solidId===2);assert.equal(hits.length,4);
  assert.deepEqual(hits.map(h=>h.entering),[true,false,true,false]);
});

test('cubic root isolation retains three crossings and tangency without fabricated coincident events',()=>{
  const roots=cubicRootsInInterval([-.08,.66,-1.5,1]);assert.equal(roots.length,3);vecNear(roots,[.2,.5,.8],1e-9);
  vecNear(cubicRootsInInterval([.25,-1,1,0]),[.5]);assert.deepEqual(cubicRootsInInterval([0,0,0,0]),[]);
});

test('true biconvex sphere intersection preserves native variable chord and open bore',()=>{
  const inner=kernel.allEvents([60,5,0],[-1,0,0],{module:0}),outer=kernel.allEvents([60,39,0],[-1,0,0],{module:0});
  assert.equal(inner.length,2);assert.equal(outer.length,2);assert.ok(inner[1].distance-inner[0].distance>14);assert.ok(outer[1].distance-outer[0].distance<1);
  assert.equal(kernel.nextOpticalEvent([60,0,0],[-1,0,0],{module:0}),null);
});

test('curved boundary Snell refraction is reciprocal and Fresnel is physical',()=>{
  const ray=reference.rays.find(r=>r.name==='light-oblique-curved-lens'),hit=kernel.nextOpticalEvent(ray.originMM,ray.directionUnit,{module:0}),result=nativeDielectric(ray.directionUnit,hit.normal,1,1.46);
  assert.equal(result.tir,false);assert.ok(result.fresnel>0&&result.fresnel<1);assert.ok(Math.abs(dot(result.direction,hit.normal))>Math.abs(dot(ray.directionUnit,hit.normal)));
  const reverse=nativeDielectric(result.direction.map(v=>-v),hit.normal.map(v=>-v),1.46,1);vecNear(reverse.direction,ray.directionUnit.map(v=>-v),1e-10);near(reverse.fresnel,result.fresnel,1e-10);
  const normal=nativeDielectric([-1,0,0],[1,0,0],1,1.46);near(normal.fresnel,((1.46-1)/(1.46+1))**2);
});

test('water-air TIR reflects without changing medium or inventing transmitted energy',()=>{
  const result=nativeDielectric(unit([.8,0,.6]),[0,0,-1],1.333,1);assert.equal(result.tir,true);assert.equal(result.fresnel,1);assert.ok(result.direction[2]<0);
  const noContrast=nativeDielectric([1,0,0],[0,0,-1],1,1);assert.equal(noContrast.fresnel,0);vecNear(noContrast.direction,[1,0,0]);
});

test('reference transport respects actual water/glass/air sequence and Beer/Fresnel',()=>{
  const result=traceNativeOpticalRay({kernel,origin:[60,0,0],direction:[-1,0,0],module:1,media:{1:{ior:1.46,sigma:[0,0,0]},2:{ior:1.333,sigma:[.01,.02,.03]}}});
  assert.equal(result.exhausted,false);assert.equal(result.events.length,6);assert.deepEqual(result.events.map(e=>[e.incidentMedium,e.targetMedium]),[[0,1],[1,0],[0,2],[2,0],[0,1],[1,0]]);
  const expected=((1-((1.46-1)/(1.46+1))**2)**4)*((1-((1.333-1)/(1.333+1))**2)**2);result.weight.forEach((w,i)=>near(w,expected*Math.exp(-(.01*(i+1))*52.6),2e-7));vecNear(result.direction,[-1,0,0]);
});

test('true opaque interval stops transport inside water before its outer exit',()=>{
  const opaqueIntersect=(ro,rd,maximum)=>{const distance=-ro[0]/rd[0];return distance>=0&&distance<=maximum?{distance,identity:'interior-reference-plane'}:null;};
  const result=traceNativeOpticalRay({kernel,origin:[60,0,0],direction:[-1,0,0],module:1,opaqueIntersect});assert.equal(result.opaqueHit.identity,'interior-reference-plane');assert.equal(result.events.length,3);near(result.point[0],0);assert.equal(result.exhausted,false);
});

test('explicit interface exhaustion and missing native duct cannot look like valid transport',()=>{
  assert.throws(()=>createNativeOpticalKernel(recipe).nextOpticalEvent([60,0,0],[-1,0,0],{module:1}),/native duct/);
  assert.equal(traceNativeOpticalRay({kernel,origin:[60,0,0],direction:[-1,0,0],maxInterfaces:2}).exhausted,true);
  assert.throws(()=>kernel.nextOpticalEvent([0,0,0],[0,0,0]),/nonzero/);
});

test('generated GLSL keeps the agreed native-mm API and contains no screen transport or invented duct',()=>{
  const shader=analyticOpticsGLSL(recipe);assert.ok(shader.includes('bool nextOpticalEvent(vec3 ro,vec3 rd,int module,float minimum,float maximum,out CadOpticalHit hit)'));
  assert.ok(shader.includes('cadDuctEvent('));assert.ok(shader.includes('cadDuctContains('));assert.ok(shader.includes('cadNativeDielectric('));assert.ok(!/sampler2D|gl_FragCoord|capsule|screenDepth/.test(shader));assert.ok(!/#endif#|#ifdef#/.test(shader));
  assert.equal((shader.match(/const vec4 cadNativeX\[40\]/g)??[]).length,1);
});
