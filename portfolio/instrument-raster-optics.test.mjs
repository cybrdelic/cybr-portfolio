import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {setupRasterOptics,traceCadTransmission,dielectricTransmission,inverseProjectionRay,reconstructDepthPoint,marchScreenDepth} from './instrument-raster-optics.mjs';
import {createRasterPaper} from './instrument-raster-paper.mjs';
// The browser resolves "three" through the page import map. For Node tests,
// supply that same library with its one bare import resolved to the same file.
const librarySource=(await readFile(new URL('./vendor/three-mesh-bvh-0.9.5/index.module.js',import.meta.url),'utf8')).replace("from 'three'",`from '${new URL('./vendor/three-r180/three.module.min.js',import.meta.url).href}'`);
const library=await import('data:text/javascript;base64,'+Buffer.from(librarySource).toString('base64'));
const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
async function fixture(options={}){
 const scene=new THREE.Scene(),group=new THREE.Group();scene.add(group);
 const glass=new THREE.Mesh(new THREE.BoxGeometry(6,6,6),new THREE.MeshPhysicalMaterial({ior:1.52,transmission:1}));
 const water=new THREE.Mesh(new THREE.BoxGeometry(4,4,4),new THREE.MeshPhysicalMaterial({ior:1.333,transmission:1,attenuationColor:new THREE.Color(.5,.8,.9),attenuationDistance:10}));
 for(const [name,object]of[['glass',glass],['water',water]]){object.name=`elements/${name}`;object.userData.meshRecord={module:'elements'};object.material.userData.cadTransmission=1;object.material.transmission=0;group.add(object);}water.userData.staticWater=true;
 const camera=new THREE.PerspectiveCamera(40,1,.1,1000);camera.position.z=10;camera.updateMatrixWorld();
 const original=[...glass.geometry.attributes.position.array];
 const optics=await setupRasterOptics({THREE,objects:[glass,water],camera,scene,innerMap:{value:new THREE.Texture()},outerMap:{value:new THREE.Texture()},size:{value:new THREE.Vector2(600,600)},opaqueDepth:{value:new THREE.DepthTexture(600,600)},bvhLibrary:library,...options});
 return{scene,group,glass,water,camera,optics,original};
}
test('actual nested cube BVHs restore surrounding glass IOR and apply water Beer attenuation over exact segments',async()=>{
 const f=await fixture(),result=f.optics.traceRay('elements',[0,0,10],[0,0,-1]);
 assert.equal(result.interfaces,4);assert.equal(result.exhausted,false);near(result.point[2],-3);near(result.direction[2],-1);
 [.5,.8,.9].forEach((color,i)=>near(result.weight[i],color**.4,1e-6));
 const surfaceOrigin=f.optics.traceRay('elements',[0,0,3.01],[0,0,-1]);assert.equal(surfaceOrigin.interfaces,4);near(surfaceOrigin.weight[0],.5**.4,1e-6);
 assert.deepEqual([...f.glass.geometry.attributes.position.array],f.original);assert.equal(f.optics.snapshot().boundaryTriangles,24);
 f.optics.dispose();
});

test('boundary sampling traces actual nested Snell/Beer intervals without opaque-depth hits or authored geometry changes',async()=>{
 const paper=createRasterPaper(THREE),f=await fixture({sampleMode:'boundary',paperColor:paper});
 const waterOriginal=[...f.water.geometry.attributes.position.array],direction=new THREE.Vector3(.1,0,-1).normalize(),sin=direction.x;
 const result=f.optics.traceRay('elements',[0,0,10],direction.toArray(),()=>{throw Error('Boundary sampling must not inspect opaque depth');});
 // Parallel interfaces conserve n*sin(theta). Two 1 mm glass intervals and
 // one 4 mm water interval give independent analytic lateral displacement.
 const glassTangent=sin/Math.sqrt(1.52**2-sin**2),waterTangent=sin/Math.sqrt(1.333**2-sin**2);
 near(result.point[0],.7+2*glassTangent+4*waterTangent);near(result.point[2],-3);
 result.direction.forEach((value,index)=>near(value,direction.toArray()[index]));
 const waterDistance=4/Math.sqrt(1-(sin/1.333)**2);
 [.5,.8,.9].forEach((color,index)=>near(result.weight[index],color**(waterDistance/10)));
 assert.equal(result.interfaces,4);assert.equal(result.exhausted,false);assert.equal(result.opaqueHit,false);
 assert.deepEqual([...f.glass.geometry.attributes.position.array],f.original);
 assert.deepEqual([...f.water.geometry.attributes.position.array],waterOriginal);
 // Ensure this mode's compiled shader also omits the depth-march path and
 // receives the calibrated fallback in linear HDR rather than CSS RGB.
 const shader={uniforms:{},fragmentShader:'#include <transmission_pars_fragment>'};
 f.optics.bindShader(shader,f.glass.material,'elements');
 assert.doesNotMatch(shader.fragmentShader,/cadOpaqueInterval|cadDepthGap|texture\(cadOpaqueDepth/);
 assert.match(shader.fragmentShader,/cadViewProjection\*vec4\(path.exitPoint,1\)/);
 assert.deepEqual(shader.uniforms.cadPaperRadiance.value.toArray(),paper.toArray());
 assert.equal(f.optics.snapshot().sampleMode,'boundary');f.optics.dispose();
});
test('rigid module motion updates world intersections while relative optical motion refits only cloned boundaries',async()=>{
 const f=await fixture();f.group.position.set(20,0,0);f.group.rotation.y=.2;f.optics.update(f.camera);
 const ro=new THREE.Vector3(0,0,10).applyMatrix4(f.group.matrixWorld),rd=new THREE.Vector3(0,0,-1).transformDirection(f.group.matrixWorld);
 const moved=f.optics.traceRay('elements',ro.toArray(),rd.toArray());assert.equal(moved.interfaces,4);near(moved.weight[0],.5**.4,1e-6);
 const refits=f.optics.snapshot().refits;f.optics.update(f.camera);assert.equal(f.optics.snapshot().refits,refits);
 assert.deepEqual([...f.glass.geometry.attributes.position.array],f.original);f.optics.dispose();
});
test('boundary normals retain Snell transmission and total internal reflection',()=>{
 const angle=.5,input=[Math.sin(angle),0,-Math.cos(angle)],transmitted=dielectricTransmission(input,[0,0,1],1,1.52);
 assert.equal(transmitted.tir,false);near(transmitted.direction[0],Math.sin(angle)/1.52);
 const tir=dielectricTransmission([Math.sin(1),0,Math.cos(1)],[0,0,-1],1.52,1);assert.equal(tir.tir,true);assert.ok(tir.direction[2]<0);near(Math.hypot(...tir.direction),1);
});
test('shader replacement keeps physical reflection/alpha/uniforms and uses bounded depth-aware outgoing rays',async()=>{
 const f=await fixture(),shader={uniforms:{transmission:{value:1},workingTransmissionMap:{value:null}},fragmentShader:'void preservedCoating(){}\n#include <transmission_pars_fragment>\nvoid main(){}'};
 assert.equal(f.optics.bindShader(shader,f.glass.material,'elements'),true);
 assert.match(shader.fragmentShader,/void preservedCoating/);assert.match(shader.fragmentShader,/EnvironmentBRDF\(n,-primaryDirection,specularColor,specularF90,roughness\)/);
 assert.match(shader.fragmentShader,/1\.-\(1\.-light.a\)\*factor/);assert.equal(shader.uniforms.transmission.value,1);
 assert.match(shader.fragmentShader,/step<16/);assert.match(shader.fragmentShader,/refine<3/);assert.match(shader.fragmentShader,/cadOpaqueInterval\(ro,rd,boundary\?hit.distance:750\./);
 assert.match(shader.fragmentShader,/float ids\[8\]/);assert.match(shader.fragmentShader,/#define BVH_STACK_DEPTH 8/);assert.ok(f.optics.snapshot().bvhStackDepth>f.optics.snapshot().maxBvhDepth);
 assert.match(shader.fragmentShader,/primaryOrigin=position-primaryDirection\*\.01/);assert.match(shader.fragmentShader,/ro=hit.point\+rd\*\.005/);assert.equal(f.optics.snapshot().rayAdvanceMM,.005);
 assert.match(shader.fragmentShader,/cadInverseViewProjection\*vec4\(uv\*2\.-1\.,depth\*2\.-1\.,1\)/);
 assert.equal((shader.fragmentShader.match(/vec4 getIBLVolumeRefraction\(/g)||[]).length,1);assert.equal(f.optics.snapshot().boundShaders,1);f.optics.dispose();
});
let nativeAssets;
async function nativeFixture(module,material){
 nativeAssets??=Promise.all([readFile(new URL('./assets/instrument-working-v1/manifest.json',import.meta.url),'utf8').then(JSON.parse),readFile(new URL('./assets/instrument-working-v1/instrument.bin.gz',import.meta.url)).then(gunzipSync)]);
 const[manifest,raw]=await nativeAssets,record=manifest.meshes.find(mesh=>mesh.module===module&&mesh.material===material),buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),geometry=new THREE.BufferGeometry();
 const attribute=(spec,itemSize)=>{const Type=spec.dtype==='float32'?Float32Array:spec.dtype==='int16'?Int16Array:Uint32Array;return new THREE.BufferAttribute(new Type(buffer,spec.offset,spec.count),itemSize,Type===Int16Array);};
 geometry.setAttribute('position',attribute(record.positions,3));geometry.setAttribute('normal',attribute(record.normals,3));geometry.setIndex(attribute(record.indices,1));geometry.computeBoundingBox();
 const object=new THREE.Mesh(geometry,new THREE.MeshPhysicalMaterial({ior:material===7?1.333:1.52,transmission:1}));object.name=module+'/native';object.userData.meshRecord=record;object.userData.staticWater=material===7;
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,1000);scene.add(object);camera.position.z=100;camera.updateMatrixWorld();
 const optics=await setupRasterOptics({THREE,objects:[object],camera,scene,innerMap:{value:new THREE.Texture()},size:{value:new THREE.Vector2(600,600)},opaqueDepth:{value:new THREE.DepthTexture(600,600)},bvhLibrary:library,debugMode:1});return{object,optics,camera,scene};
}
test('native CAD curved lens uses authored barycentric normals and discrete identity, including inverse-transpose motion',async()=>{
 const f=await nativeFixture('light',3),geometry=f.object.geometry,bvh=new library.MeshBVH(geometry.clone(),{strategy:library.SAH}),box=geometry.boundingBox,center=box.getCenter(new THREE.Vector3()),extent=box.getSize(new THREE.Vector3());let nonFaceted=0;
 for(const offset of[.12,.23,.37]){const origin=center.clone().add(new THREE.Vector3(extent.x+20,extent.y*offset,extent.z*.13)),direction=new THREE.Vector3(-1,0,0),localHit=bvh.raycastFirst(new THREE.Ray(origin,direction),THREE.DoubleSide);assert.ok(localHit);
  const result=f.optics.intersectRay('light',origin.toArray(),direction.toArray()),normal=new THREE.Vector3();for(const[index,weight]of[[localHit.face.a,localHit.barycoord.x],[localHit.face.b,localHit.barycoord.y],[localHit.face.c,localHit.barycoord.z]])normal.addScaledVector(new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal,index),weight);normal.normalize();if(normal.dot(localHit.face.normal)<0)normal.negate();if(normal.dot(direction)>0)normal.negate();
  near(new THREE.Vector3(...result.normal).distanceTo(normal),0,1e-6);assert.equal(Number.isInteger(result.id),true);if(normal.angleTo(localHit.face.normal)>.0001)nonFaceted++;
  f.object.scale.set(1,1.2,.8);f.object.rotation.x=.2;f.optics.update(f.camera);const worldOrigin=origin.clone().applyMatrix4(f.object.matrixWorld),worldDirection=direction.clone().transformDirection(f.object.matrixWorld),moved=f.optics.intersectRay('light',worldOrigin.toArray(),worldDirection.toArray()),worldNormal=normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(f.object.matrixWorld)).normalize();near(new THREE.Vector3(...moved.normal).distanceTo(worldNormal),0,1e-6);f.object.scale.set(1,1,1);f.object.rotation.x=0;f.optics.update(f.camera);
 }
 assert.ok(nonFaceted>0);assert.equal(f.optics.snapshot().bvhStrategy,'SAH');assert.ok(f.optics.snapshot().moduleDepths.light.stack>f.optics.snapshot().moduleDepths.light.glass);
 const shader={uniforms:{},fragmentShader:'#include <transmission_pars_fragment>'};f.optics.bindShader(shader,f.object.material,'light');assert.equal(shader.uniforms.cadOpticalDebug.value,1);assert.match(shader.fragmentShader,/return vec4\(a.x,a.yzw\*bary.x/);assert.match(shader.fragmentShader,/path.exhausted\?vec3\(1,0,0\):path.opaqueHit\?vec3\(0,1,0\):vec3\(0,0,1\)/);f.optics.dispose();geometry.dispose();
});
test('native CAD water with closed air bubbles returns to air without unmatched medium identities',async()=>{
 const f=await nativeFixture('elements',7),box=f.object.geometry.boundingBox,center=box.getCenter(new THREE.Vector3()),extent=box.getSize(new THREE.Vector3());let crossed=0;
 for(const y of[-.2,-.1,0,.1,.2])for(const z of[-.2,0,.2]){const origin=center.clone().add(new THREE.Vector3(extent.x+20,extent.y*y,extent.z*z)),events=[],result=traceCadTransmission({origin:origin.toArray(),direction:[-1,0,0],intersect:(ro,rd)=>{const hit=f.optics.intersectRay('elements',ro,rd);if(hit)events.push(hit);return hit;}});assert.equal(result.exhausted,false,`native bubble ray ${y},${z} exhausted after ${result.interfaces} interfaces`);if(events.filter(hit=>hit.entering).length>1)crossed++;}
 assert.ok(crossed>0,'rays must exercise the actual enclosed bubble boundaries');f.optics.dispose();f.object.geometry.dispose();
});
test('inverse projection and opaque depth reconstruction work for perspective, orthographic and mixed cameras',()=>{
 const ortho=new THREE.OrthographicCamera(-10,10,10,-10,.1,1000),perspective=new THREE.PerspectiveCamera(40,1,.1,1000),camera=new THREE.Camera();camera.position.set(2,3,30);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 for(const blend of[0,.4,1]){
  for(let i=0;i<16;i++)camera.projectionMatrix.elements[i]=ortho.projectionMatrix.elements[i]*(1-blend)+perspective.projectionMatrix.elements[i]*blend/30;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();const vp=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),inverse=vp.clone().invert();
  for(const pixel of[[100,220],[300,300],[480,410]]){const ray=inverseProjectionRay(camera,pixel,[600,600]),point=new THREE.Vector3(...ray.origin).addScaledVector(new THREE.Vector3(...ray.direction),20),ndc=point.clone().applyMatrix4(vp),reconstructed=reconstructDepthPoint(inverse.elements,[ndc.x*.5+.5,ndc.y*.5+.5],ndc.z*.5+.5);near(new THREE.Vector3(...reconstructed).distanceTo(point),0,1e-6);}
 }
});
test('outgoing depth march intersects a visible plane along the refracted ray and rejects background',()=>{
 const camera=new THREE.PerspectiveCamera(50,1,.1,1000);camera.position.z=20;camera.updateMatrixWorld();
 const vp=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),inverse=vp.clone().invert(),view=camera.matrixWorldInverse;
 const sampleDepth=uv=>{const r=inverseProjectionRay(camera,[uv[0]*600,uv[1]*600],[600,600]),t=-r.origin[2]/r.direction[2];return new THREE.Vector3(...r.origin).addScaledVector(new THREE.Vector3(...r.direction),t).applyMatrix4(vp).z*.5+.5;};
 const parameters={exitPoint:[0,0,5],direction:[.15,0,-1],viewProjection:vp.elements,inverseViewProjection:inverse.elements,viewMatrix:view.elements,sampleDepth};
 const hit=marchScreenDepth(parameters);assert.ok(hit);near(hit.surface[2],0,1e-6);near(hit.surface[0],.75,.07);assert.ok(hit.uv[0]>.5);
 assert.equal(marchScreenDepth({...parameters,sampleDepth:()=>1}),null);
});
function planeDepth(camera,z){
 const vp=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),inverse=vp.clone().invert();
 return{viewProjection:vp.elements,inverseViewProjection:inverse.elements,viewMatrix:camera.matrixWorldInverse.elements,sampleDepth:uv=>{const ray=inverseProjectionRay(camera,[uv[0]*600,uv[1]*600],[600,600]),distance=(z-ray.origin[2])/ray.direction[2];return new THREE.Vector3(...ray.origin).addScaledVector(new THREE.Vector3(...ray.direction),distance).applyMatrix4(vp).z*.5+.5;}};
}
test('depth march checks interval origin so opaque floors 0.01–0.05 mm after a boundary remain visible',()=>{
 const camera=new THREE.PerspectiveCamera(50,1,.1,1000);camera.position.z=20;camera.updateMatrixWorld();
 for(const distance of[.01,.03,.05]){const hit=marchScreenDepth({...planeDepth(camera,0),exitPoint:[0,0,distance],direction:[0,0,-1],maxDistance:1,steps:4});assert.ok(hit,`missed floor at ${distance} mm`);near(hit.surface[2],0,1e-6);assert.ok(hit.distance>=distance&&hit.distance<distance+.03);}
});
test('opaque-depth rays intersect an oblique plane under orthographic, mixed and perspective projections',()=>{
 const ortho=new THREE.OrthographicCamera(-10,10,10,-10,.1,1000),perspective=new THREE.PerspectiveCamera(40,1,.1,1000),camera=new THREE.Camera();camera.position.set(2,3,30);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const normal=new THREE.Vector3(.2,.1,1),exit=new THREE.Vector3(0,0,5),direction=new THREE.Vector3(.1,.03,-1).normalize(),expected=exit.clone().addScaledVector(direction,-normal.dot(exit)/normal.dot(direction));
 for(const blend of[0,.4,1]){
  for(let i=0;i<16;i++)camera.projectionMatrix.elements[i]=ortho.projectionMatrix.elements[i]*(1-blend)+perspective.projectionMatrix.elements[i]*blend/30;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();const vp=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),inverse=vp.clone().invert();
  const sampleDepth=uv=>{const ray=inverseProjectionRay(camera,[uv[0]*600,uv[1]*600],[600,600]),origin=new THREE.Vector3(...ray.origin),rd=new THREE.Vector3(...ray.direction),distance=-normal.dot(origin)/normal.dot(rd);return origin.addScaledVector(rd,distance).applyMatrix4(vp).z*.5+.5;};
  const hit=marchScreenDepth({exitPoint:exit.toArray(),direction:direction.toArray(),viewProjection:vp.elements,inverseViewProjection:inverse.elements,viewMatrix:camera.matrixWorldInverse.elements,sampleDepth});assert.ok(hit);near(new THREE.Vector3(...hit.surface).distanceTo(expected),0,.03);
 }
});
test('opaque soil inside actual nested glass/water BVHs terminates before far boundaries and absorbs only the water interval',async()=>{
 const f=await fixture(),depth=planeDepth(f.camera,0);
 const opaqueIntersect=(point,direction,maxDistance)=>marchScreenDepth({...depth,exitPoint:point,direction,maxDistance,steps:maxDistance===750?16:4});
 const result=f.optics.traceRay('elements',[0,0,10],[0,0,-1],opaqueIntersect);
 assert.equal(result.interfaces,2);assert.equal(result.opaqueHit,true);assert.equal(result.exhausted,false);near(result.point[2],0,.1);
 [.5,.8,.9].forEach((color,i)=>near(result.weight[i],color**.2,.005));
 const justAfterWaterExit=planeDepth(f.camera,-2.03),floor=f.optics.traceRay('elements',[0,0,10],[0,0,-1],(point,direction,maxDistance)=>marchScreenDepth({...justAfterWaterExit,exitPoint:point,direction,maxDistance,steps:4}));
 assert.equal(floor.interfaces,3);assert.equal(floor.opaqueHit,true);near(floor.point[2],-2.03,.03);near(floor.weight[0],.5**.4,1e-6);f.optics.dispose();
});
test('bounded medium identities reject overflow without discarding ordinary nested media',()=>{
 let index=0;const result=traceCadTransmission({origin:[0,0,0],direction:[0,0,-1],intersect:(point)=>({distance:1,point:[point[0],point[1],point[2]-1],normal:[0,0,1],entering:true,id:++index,ior:1.5,sigma:[0,0,0]})});
 assert.equal(result.exhausted,true);assert.equal(result.interfaces,9);assert.equal(index,9);
});
