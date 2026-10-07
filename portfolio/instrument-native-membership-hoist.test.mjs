import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {analyticOpticsGLSL,createNativeOpticalKernel,createTriangleDuctBoundary} from './instrument-analytic-optics.mjs';
import {hoistNativeKernelMembershipGLSL,uniformNativeKernelGLSL,nativeTransportPathGLSL,nativeTransportGLSL,replaceNativeRefraction,explicitNativePmremGLSL,minimalNativeCaptureGLSL,nativeKernelIterationUniforms} from './instrument-native-geometry-transport.mjs';
import {hitPbrGLSL} from './instrument-hit-pbr.mjs';
import {setupRasterTransport} from './instrument-raster-transport.mjs';
import * as THREE from './vendor/three-r180/three.module.min.js';

const recipe=JSON.parse(await readFile(new URL('./assets/instrument-optical-primitives-v1/primitives.json',import.meta.url),'utf8'));
const reference=JSON.parse(await readFile(new URL('./tests/fixtures/native-optics/native-optical-ray-reference.json',import.meta.url),'utf8'));
const bytes=await readFile(new URL('./assets/instrument-optical-primitives-v1/native-water-cable-boundary.bin',import.meta.url));
const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),header=new Uint32Array(buffer,0,4);
const duct=createTriangleDuctBoundary({positions:new Float32Array(buffer,16,header[1]*3),normals:new Float32Array(buffer,16+header[1]*12,header[1]*3),indices:new Uint32Array(buffer,16+header[1]*24,header[2]*3)});
const kernel=createNativeOpticalKernel(recipe,{ductBoundary:duct});

// Expose the exact CPU primitive candidates without modifying production CAD.
// This isolates the changed selection order from every primitive/root formula.
const original=await readFile(new URL('./instrument-analytic-optics.mjs',import.meta.url),'utf8');
const contract='candidates.sort((a,b)=>a.distance-b.distance);const result=[];';
assert.equal(original.split(contract).length,2);
const rawModule=await import('data:text/javascript;base64,'+Buffer.from(original.replace(contract,'return candidates; const result=[];')).toString('base64'));
const rawKernel=rawModule.createNativeOpticalKernel(recipe,{ductBoundary:duct});
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);

function select(candidates,contains,module,minimum,maximum,rejectedPrimitiveId=-1,budget=8192){
 let rejected=0,cursor=minimum,id=rejectedPrimitiveId;
 while(rejected<budget){
  const raw=candidates.filter(h=>h.distance>=cursor&&h.distance<=maximum&&!(h.distance===cursor&&h.primitiveId<=id)&&Math.abs(dot(h.normal,h.direction??[1,0,0]))>=1e-7)
   .sort((a,b)=>a.distance-b.distance||a.primitiveId-b.primitiveId)[0];
  if(!raw)return{hit:null,rejected,exhausted:false};
  const before=raw.point.map((v,i)=>v-raw.normal[i]*.0005),after=raw.point.map((v,i)=>v+raw.normal[i]*.0005);
  if(contains(before,module,raw.solidId)&&!contains(after,module,raw.solidId))return{hit:raw,rejected,exhausted:false};
  cursor=raw.distance;id=raw.primitiveId;rejected++;
 }
 return{hit:null,rejected,exhausted:true};
}

test('heavy CSG is hoisted entirely out of primitive patch selection with checked shader ABI',()=>{
 const shader=uniformNativeKernelGLSL(analyticOpticsGLSL(recipe));
 const consider=shader.slice(shader.indexOf('void cadNativeConsider('),shader.indexOf('int cadNativeQuadratic('));
 assert.ok(!consider.includes('cadNativeSolidContains'));
 assert.match(consider,/distance==minimum&&primitiveId<=rejectedPrimitiveId/);
 assert.match(consider,/distance==best.distance&&best.solidId!=0&&primitiveId>=best.primitiveId/);
 const raw=shader.slice(shader.indexOf('bool cadNativeRawEvent('),shader.indexOf('bool nextOpticalEvent('));
 assert.ok(!raw.includes('cadNativeSolidContains'));
 const wrapper=shader.slice(shader.indexOf('bool nextOpticalEvent('),shader.indexOf('bool cadNativeDielectric('));
 assert.equal((wrapper.match(/cadNativeSolidContains\(/g)??[]).length,2);
 assert.match(wrapper,/cursor=hit.distance;rejectedPrimitiveId=hit.primitiveId/);
 assert.match(wrapper,/cadNativeRawBudgetExhausted=true/);
 assert.match(shader,/rejectedPrimitiveId>=0&&rejectedPrimitiveId<400\?uintBitsToFloat\(floatBitsToUint\(minimum\)-1u\):minimum/);
 assert.match(shader,/rejection<cadNativeRawEventLimit/);
 assert.match(shader,/step<cadNativeCubicIterations/);
 assert.throws(()=>hoistNativeKernelMembershipGLSL('invalid'),/ABI/);
 assert.match(nativeTransportPathGLSL(),/if\(cadNativeRawBudgetExhausted\)return vec3\(0\.\)/);
 const transmission=replaceNativeRefraction(THREE.ShaderChunk.transmission_pars_fragment,'');
 assert.match(transmission,/return vec4\(result,exhausted\?0\.:1\.\)/);
});

test('all secondary optical sampling uses explicit LOD without altering PMREM roughness tile selection',()=>{
 const chunk=THREE.ShaderChunk.cube_uv_reflection_fragment;
 const explicit=explicitNativePmremGLSL('#include <cube_uv_reflection_fragment>',chunk);
 assert.match(explicit,/textureLod\( envMap, uv, 0\.0 \)/);
 assert.ok(!/\btexture2D(?:GradEXT)?\s*\(/.test(explicit));
 // Roughness selection, atlas UV and tile interpolation remain byte identical.
 for(const functionName of['getFace','getUV','roughnessToMip','textureCubeUV']){
  const marker=functionName+'(',index=chunk.indexOf(marker),next=chunk.indexOf('\n\t}',index)+4;
  assert.ok(explicit.includes(chunk.slice(index,next)),functionName);
 }
 assert.match(nativeTransportGLSL(),/textureLod\(cadNativeShadowMap,uv,0\.\)/);
 assert.ok(!/\b(?:texture2D|texture)\s*\(/.test(nativeTransportGLSL()+hitPbrGLSL));
 assert.ok(!/\bdFdx\s*\(|\bdFdy\s*\(/.test(hitPbrGLSL));
 assert.throws(()=>explicitNativePmremGLSL('invalid',chunk),/ABI/);
});

test('native opaque PBR is evaluated once after tracing while terminal, view and absorption semantics are preserved',()=>{
 const path=nativeTransportPathGLSL(),trace=path.slice(path.indexOf('vec3 cadNativeTrace('),path.indexOf('vec3 cadNativeTransport('));
 assert.ok(!trace.includes('cadShadeOpaque'));
 assert.equal((path.match(/cadShadeOpaque\(/g)??[]).length,1);
 assert.match(trace,/opaqueFound=true;opaqueResult=opaque;viewResult=-direction;weightResult=weight\*exp\(-absorption\*opaque.distance\);return vec3\(0\.\);/);
 assert.match(trace,/if\(!hasOptical\)return count>0\?vec3\(0\.\):weight\*cadPaperRadiance/);
 assert.match(trace,/step<cadNativeInterfaceCount/);
 assert.ok(!trace.includes('if(step>=16)break'));
 assert.match(trace,/optical.point\+direction\*\.001/);
 assert.match(path,/if\(opaqueFound\)return weight\*cadShadeOpaque\(opaque,view\);return terminal/);
 // Same left-associated Float32 operations as the previous inline shading.
 const f=Math.fround,weight=[.72,.57,.89],absorption=[.012,.025,.061],distance=23.125,radiance=[3.1,.4,1.78];
 const old=weight.map((w,i)=>f(f(w*f(Math.exp(-absorption[i]*distance)))*radiance[i]));
 const transported=weight.map((w,i)=>f(w*f(Math.exp(-absorption[i]*distance))));
 assert.deepEqual(transported.map((w,i)=>f(w*radiance[i])),old);
});

test('expensive loops have only immutable authored uniform limits and no inferable static cap',()=>{
 const uniforms=nativeKernelIterationUniforms(),shader=uniformNativeKernelGLSL(analyticOpticsGLSL(recipe))+nativeTransportPathGLSL();
 assert.deepEqual(Object.fromEntries(Object.entries(uniforms).map(([name,uniform])=>[name,uniform.value])),{cadNativeInterfaceCount:16,cadNativeSpanCount:40,cadNativeBubbleCount:18,cadNativeCubicIterations:24,cadNativeRawEventLimit:8192});
 for(const [name,uniform]of Object.entries(uniforms)){assert.ok(Object.isFrozen(uniform),name);assert.throws(()=>{uniform.value=1;},TypeError);}
 assert.ok(!/min\(cadNative(?:SpanCount|BubbleCount|CubicIterations)/.test(shader));
 assert.ok(!/(?:step>=16|rejection>=8192)/.test(shader));
 for(const name of Object.keys(uniforms))assert.match(shader,new RegExp('<'+name+';'));
});

test('minimal capture excludes stock primary shading and retains mixed camera rays and raw capture ABI',()=>{
 const fragment=minimalNativeCaptureGLSL(THREE,'// Native geometry and secondary PBR test marker');
 for(const forbidden of['lights_physical_pars_fragment','PhysicalMaterial','BRDF_GGX_Clearcoat','getTransmissionSample','transmissionSamplerMap','ReflectedLight','tonemapping_fragment','colorspace_fragment'])assert.ok(!fragment.includes(forbidden),forbidden);
 for(const helper of['V_GGX_SmithCorrelated','D_GGX','DFGApprox','computeSpecularOcclusion'])assert.match(fragment,new RegExp('\\b'+helper+'\\s*\\('));
 assert.match(fragment,/vViewPosition\*\(-projectionMatrix\[2\]\[3\]\)/);
 assert.match(fragment,/inverseTransformDirection\(viewDir,viewMatrix\)/);
 assert.match(fragment,/vWorldPosition,mat4\(1\),viewMatrix,projectionMatrix,dispersion,ior/);
 assert.equal((fragment.match(/#include <opaque_fragment>/g)??[]).length,1);
 const scene=new THREE.Scene(),material=new THREE.MeshPhysicalMaterial();material.userData.cadTransmission=1;
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);scene.add(mesh);const size={value:new THREE.Vector2(640,360)};
 const capture=setupRasterTransport({THREE,renderer:{},scene,objects:[mesh],fullSize:size,specializeCapture:true});
 const shader={defines:{CAD_TRANSPORT_CAPTURE:1},uniforms:{cadOpticalSize:size},fragmentShader:fragment};
 assert.equal(capture.bindShader(shader,material),true);
 assert.match(shader.fragmentShader,/gl_FragColor=cadTransportResult;return;/);
 assert.match(shader.fragmentShader,/cadExactVolumeRefraction\(/);
 assert.ok(!shader.fragmentShader.includes('cadTransportMap'));
 capture.dispose();mesh.geometry.dispose();material.dispose();
});

test('coincident invalid events cannot hide another valid primitive and later roots remain searchable',()=>{
 const candidates=[{distance:2,primitiveId:100,solidId:1,point:[2,0,0],normal:[1,0,0]},
  {distance:2,primitiveId:150,solidId:2,point:[2,0,0],normal:[1,0,0]},
  {distance:4,primitiveId:100,solidId:1,point:[4,0,0],normal:[1,0,0]}];
 const contains=(p,module,id)=>id===2?p[0]<2:id===1&&p[0]>3&&p[0]<4;
 assert.equal(select(candidates,contains,1,0,10).hit.primitiveId,150);
 assert.equal(select(candidates,contains,1,2,10,150).hit.distance,4);
 assert.equal(select(candidates,()=>false,1,0,10,-1,1).exhausted,true);
});

test('all 60 retained native BREP events are identical after raw-event CSG validation, including cavity, corner and tangent rays',async()=>{
 let matched=0,maxRejected=0,maxCandidates=0;
 for(const ray of reference.rays){
  const module=ray.moduleCoordinateFrame==='light'?0:1;
  const candidates=rawKernel.allEvents(ray.originMM,ray.directionUnit,{module,minDistance:.001,maxDistance:ray.maximumDistanceMM})
   .map(h=>({...h,direction:ray.directionUnit,primitiveId:h.primitiveId>=400?400:h.primitiveId}));
  maxCandidates=Math.max(maxCandidates,candidates.length);
  const expected=kernel.allEvents(ray.originMM,ray.directionUnit,{module,minDistance:.001,maxDistance:ray.maximumDistanceMM});
  let minimum=.001,id=-1;const actual=[];
  for(let i=0;i<8192;i++){
   const result=select(candidates,kernel.contains,module,minimum,ray.maximumDistanceMM,id);maxRejected=Math.max(maxRejected,result.rejected);
   assert.equal(result.exhausted,false,ray.name);if(!result.hit)break;
   const h=result.hit;minimum=h.distance;id=h.primitiveId;
   if(!actual.some(a=>a.solidId===h.solidId&&Math.abs(a.distance-h.distance)<1e-6))actual.push(h);
  }
  assert.equal(actual.length,expected.length,ray.name);
  for(let i=0;i<actual.length;i++){
   const a=actual[i],b=expected[i];assert.equal(a.solidId,b.solidId,ray.name);assert.equal(dot(a.normal,ray.directionUnit)<0,b.entering,ray.name);
   assert.ok(Math.abs(a.distance-b.distance)<1e-10,ray.name);assert.ok(dot(a.normal,b.normal)>.999999999,ray.name);matched++;
  }
 }
 assert.equal(matched,60);
 await writeFile(new URL('./tests/fixtures/native-optics/native-membership-hoist-reference.json',import.meta.url),JSON.stringify({schema:1,matchedNativeEvents:matched,referenceRays:reference.rays.length,maxRejectedBeforeValid:maxRejected,maxRawCandidates:maxCandidates,normalProbeMM:.0005,budget:8192,possibleElementRoots:6032,compilerScope:'complete CSG predicate at one wrapper site; raw primitive roots unchanged',gpuVerified:false},null,2));
});
