import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as THREE from './vendor/three-r180/three.module.min.js';
import{deriveRefractedThickness,transmissionSampleBehindEntry,setupRasterThickness,waterOuterBoundaryIndices,resolveInteriorTransmission,octEncodeNormal,octDecodeNormal,refineTransmissionExit}from './instrument-raster-thickness.mjs';
import{dielectricTransmission}from './instrument-raster-optics.mjs';
const close=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const sample={exitDepth:42,entryDepth:40,viewDirection:[0,0,1],normal:[0,0,1],ior:1.52,fieldId:3,materialId:3,authoredThickness:12,maxDistance:100};

test('actual slab chord becomes the analytic refracted path for glass and water at oblique camera angles',()=>{
 for(const ior of[1.333,1.47,1.52])for(const angle of[0,.2,.5,1,1.3]){const view=[Math.sin(angle),0,Math.cos(angle)],expected=2/Math.cos(Math.asin(Math.sin(angle)/ior));close(deriveRefractedThickness({...sample,viewDirection:view,ior}),expected);}
 const normal=new THREE.Vector3(.3,-.5,.8).normalize(),view=new THREE.Vector3(.4,.1,.9).normalize(),cos=normal.dot(view),cameraChord=2/cos,depthDifference=cameraChord*view.z,expected=2/Math.sqrt(1-(1-cos*cos)/(1.52**2));close(deriveRefractedThickness({...sample,exitDepth:40+depthDifference,viewDirection:view.toArray(),normal:normal.toArray()}),expected);
});
test('unmatched, missing, invalid, clipped and implausible exits retain the authored thickness',()=>{
 for(const change of[{fieldId:0},{fieldId:4},{exitDepth:40},{exitDepth:39},{exitDepth:NaN},{exitDepth:Infinity},{uv:[-0.1,.5]},{uv:[.5,1.1]},{viewDirection:[0,0,-1]},{normal:[0,0,0]},{viewDirection:[0,0,0]},{maxDistance:1},{ior:.5,viewDirection:[.9,0,Math.sqrt(.19)]}])assert.equal(deriveRefractedThickness({...sample,...change}),12);
 assert.throws(()=>deriveRefractedThickness({...sample,authoredThickness:NaN}));
});
class FakeRenderer{
 constructor(){this.target=new THREE.WebGLRenderTarget(17,19);this.viewport=new THREE.Vector4(2,4,15,13);this.scissor=new THREE.Vector4(3,5,11,9);this.scissorTest=true;this.clearColor=new THREE.Color(.2,.3,.4);this.clearAlpha=.7;this.autoClear=true;this.shadowMap={enabled:true,autoUpdate:true,needsUpdate:true};this.xr={enabled:true};this.info={render:{calls:0,triangles:0}};this.frames=[];this.clears=0;this.face=2;this.mip=1;}
 getRenderTarget(){return this.target;}getActiveCubeFace(){return this.face;}getActiveMipmapLevel(){return this.mip;}
 setRenderTarget(target,face=0,mip=0){this.target=target;this.face=face;this.mip=mip;this.viewport.set(0,0,target?.width??101,target?.height??103);this.scissor.copy(this.viewport);this.scissorTest=false;}
 getViewport(out){return out.copy(this.viewport);}setViewport(value){this.viewport.copy(value);}
 getScissor(out){return out.copy(this.scissor);}setScissor(value){this.scissor.copy(value);}
 getScissorTest(){return this.scissorTest;}setScissorTest(value){this.scissorTest=value;}
 getClearColor(out){return out.copy(this.clearColor);}getClearAlpha(){return this.clearAlpha;}setClearColor(value,alpha){this.clearColor.copy(value?.isColor?value:new THREE.Color(value));if(alpha!==undefined)this.clearAlpha=alpha;}
 clear(){this.clears++;}
 render(scene){assert.equal(this.shadowMap.enabled,false);assert.equal(this.shadowMap.needsUpdate,false);assert.equal(this.xr.enabled,false);assert.equal(scene.background,null);assert.equal(scene.overrideMaterial,null);const meshes=[];scene.traverseVisible(object=>{if(object.isMesh)meshes.push(object);});this.frames.push({target:this.target,meshes:meshes.map(object=>({object,geometry:object.geometry,material:object.material,id:object.material.uniforms.cadExitId.value}))});if(this.frames.length===this.throwAt)throw Error('field draw failed');this.info.render.calls=meshes.length;this.info.render.triangles=meshes.length*12;}
 state(){return{target:this.target,face:this.face,mip:this.mip,viewport:this.viewport.toArray(),scissor:this.scissor.toArray(),scissorTest:this.scissorTest,color:this.clearColor.toArray(),alpha:this.clearAlpha,autoClear:this.autoClear,shadow:{...this.shadowMap},xr:this.xr.enabled};}
}
function fixture(options={}){
 const scene=new THREE.Scene(),glassMaterial=new THREE.MeshPhysicalMaterial({ior:1.52}),waterMaterial=new THREE.MeshPhysicalMaterial({ior:1.333});glassMaterial.userData.cadTransmission=1;waterMaterial.userData.cadTransmission=1;
 const glass=new THREE.Mesh(new THREE.BoxGeometry(6,6,6),glassMaterial),secondGlass=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),glassMaterial),water=new THREE.Mesh(new THREE.BoxGeometry(4,4,4),waterMaterial),opaque=new THREE.Mesh(new THREE.BoxGeometry(8,8,8),new THREE.MeshStandardMaterial());secondGlass.position.x=15;water.userData.staticWater=true;scene.add(glass,secondGlass,water,opaque);
 const light=new THREE.DirectionalLight();light.castShadow=true;light.shadow.autoUpdate=true;light.shadow.needsUpdate=true;scene.add(light);scene.background=new THREE.Color(.3,.4,.5);scene.overrideMaterial=new THREE.MeshBasicMaterial();const camera=new THREE.PerspectiveCamera(40,1,.1,1000);camera.position.z=20;camera.updateMatrixWorld();const renderer=new FakeRenderer(),fullSize={value:new THREE.Vector2(600,600)},objects=[glass,secondGlass,water,opaque];
 const helper=setupRasterThickness({THREE,renderer,scene,objects,fullSize,...options});return{scene,objects,glass,water,secondGlass,opaque,light,camera,renderer,helper,fullSize};
}

test('foreground source rejection follows view depth for orthographic, mixed and perspective projections',()=>{
 const orthographic=new THREE.OrthographicCamera(-17,17,10,-10,.1,1000),perspective=new THREE.PerspectiveCamera(40,1.7,.1,1000);
 for(const blend of[0,.2,.6,1])for(const scale of[.03,1,7]){
  const projection=new THREE.Matrix4();for(let i=0;i<16;i++)projection.elements[i]=scale*(orthographic.projectionMatrix.elements[i]*(1-blend)+perspective.projectionMatrix.elements[i]*blend/30);
  const inverseProjection=projection.clone().invert();
  for(const [x,y]of[[-4,-2],[0,0],[8,3]])for(const depth of[38,39.8,39.91,40,40.03,42,55]){
   const projected=new THREE.Vector3(x,y,-depth).applyMatrix4(projection),uv=[projected.x*.5+.5,projected.y*.5+.5];
   assert.equal(transmissionSampleBehindEntry({uv,depth:projected.z*.5+.5,entryDepth:40,inverseProjection}),depth>=39.9,`blend ${blend}, projection scale ${scale}, source depth ${depth}`);
  }
 }
});
test('background and actual internal hardware remain sampled while offscreen and invalid source depth fall back',()=>{
 const camera=new THREE.PerspectiveCamera(40,1,.1,1000),inverseProjection=camera.projectionMatrixInverse,entryDepth=40;
 const evaluate=(uv,depth)=>transmissionSampleBehindEntry({uv,depth,entryDepth,inverseProjection});
 assert.equal(evaluate([.5,.5],1),true);
 for(const viewDepth of[40.01,41,80]){const projected=new THREE.Vector3(0,0,-viewDepth).applyMatrix4(camera.projectionMatrix);assert.equal(evaluate([.5,.5],projected.z*.5+.5),true);}
 for(const uv of[[-.01,.5],[1.01,.5],[.5,-.01],[.5,1.01],[NaN,.5]])assert.equal(evaluate(uv,1),false);
 for(const depth of[-.01,1.01,NaN,Infinity])assert.equal(evaluate([.5,.5],depth),false);
 assert.equal(transmissionSampleBehindEntry({uv:[.5,.5],depth:.5,entryDepth,inverseProjection:new Float32Array(16)}),false);
});
test('native field passes use actual optical meshes, isolated material IDs and restore all scene/render/shadow state',()=>{
 const f=fixture(),state=f.renderer.state(),background=f.scene.background,override=f.scene.overrideMaterial,materials=f.objects.map(object=>object.material),flags=f.objects.map(object=>object.visible);
 const result=f.helper.render(f.camera);assert.deepEqual(result,{calls:3,triangles:36,cached:false});assert.deepEqual(f.renderer.state(),state);assert.equal(f.scene.background,background);assert.equal(f.scene.overrideMaterial,override);assert.equal(f.light.shadow.needsUpdate,true);assert.equal(f.light.shadow.autoUpdate,true);
 f.objects.forEach((object,i)=>{assert.equal(object.material,materials[i]);assert.equal(object.visible,flags[i]);});assert.equal(f.renderer.frames.length,2);
 const[glass,water]=f.renderer.frames;assert.equal(glass.target.texture.format,THREE.RGFormat);assert.equal(glass.target.texture.type,THREE.FloatType);assert.deepEqual([glass.target.width,glass.target.height],[600,600]);assert.equal(glass.target.samples,0);assert.deepEqual(glass.meshes.map(record=>record.object),[f.glass,f.secondGlass]);assert.deepEqual(water.meshes.map(record=>record.object),[f.water]);assert.notEqual(glass.meshes[0].material,glass.meshes[1].material);assert.equal(glass.meshes[0].id,glass.meshes[1].id);assert.notEqual(glass.meshes[0].id,water.meshes[0].id);
 for(const frame of f.renderer.frames)for(const record of frame.meshes){assert.equal(record.material.side,THREE.BackSide);assert.equal(record.material.toneMapped,false);assert.equal(record.material.blending,THREE.NoBlending);}
 assert.equal(f.helper.snapshot().fieldPasses,2);f.helper.dispose();
});
test('stationary fields are cached and changes to camera, optical geometry or native size refresh both passes',()=>{
 const f=fixture();f.helper.render(f.camera);assert.deepEqual(f.helper.render(f.camera),{calls:0,triangles:0,cached:true});assert.equal(f.renderer.frames.length,2);f.camera.position.x=1;f.helper.render(f.camera);assert.equal(f.renderer.frames.length,4);
 f.glass.position.x=3;f.helper.render(f.camera);assert.equal(f.renderer.frames.length,6);f.glass.geometry.attributes.position.needsUpdate=true;f.helper.render(f.camera);assert.equal(f.renderer.frames.length,8);f.fullSize.value.set(1265,720);f.helper.render(f.camera);assert.equal(f.renderer.frames.length,10);assert.deepEqual(f.helper.snapshot().size,[1265,720]);assert.equal(f.helper.snapshot().stationaryCacheHits,1);f.helper.dispose();
});

test('startup field descriptors retain exact original/filtered geometry and material identities without drawing or changing live state',()=>{
 const f=fixture(),state=f.renderer.state(),materials=f.objects.map(o=>o.material),geometries=f.objects.map(o=>o.geometry);
 const variants=f.helper.startupVariants(f.camera);assert.deepEqual(variants.map(v=>v.name),['glass-thickness-field','water-thickness-field']);
 assert.deepEqual(variants[0].objects.map(v=>v.object),[f.glass,f.secondGlass]);assert.deepEqual(variants[1].objects.map(v=>v.object),[f.water]);
 assert.equal(variants[0].objects[0].material.side,THREE.BackSide);assert.equal(variants[0].objects[0].material.toneMapped,false);
 assert.equal(variants[1].objects[0].geometry,f.water.geometry);assert.equal(variants[0].target.width,600);assert.equal(variants[1].target.height,600);
 assert.deepEqual(f.renderer.state(),state);assert.equal(f.renderer.frames.length,0);assert.equal(f.helper.snapshot().fieldsReady,false);
 f.objects.forEach((o,i)=>{assert.equal(o.material,materials[i]);assert.equal(o.geometry,geometries[i]);});f.helper.dispose();
});
test('failed field renders restore pending shadows, materials and target state and leave authored fallback enabled',()=>{
 const f=fixture(),state=f.renderer.state(),materials=f.objects.map(object=>object.material);f.renderer.throwAt=2;assert.throws(()=>f.helper.render(f.camera),/field draw failed/);assert.deepEqual(f.renderer.state(),state);assert.equal(f.light.shadow.needsUpdate,true);f.objects.forEach((object,i)=>assert.equal(object.material,materials[i]));assert.equal(f.helper.snapshot().fieldsReady,false);assert.equal(f.helper.snapshot().failures,1);f.helper.dispose();
});
test('shader binds after the actual thickness assignment and disposal disables measurements exactly once',()=>{
 const f=fixture(),shader={uniforms:{},fragmentShader:THREE.ShaderChunk.transmission_pars_fragment+'\nvoid main(){\n#include <lights_fragment_begin>\n#include <transmission_fragment>\n}'};assert.equal(f.helper.bindShader(shader,f.glass.material),true);assert.ok(shader.fragmentShader.indexOf('if(cadThicknessEnabled)')>shader.fragmentShader.indexOf('material.thickness = thickness;'));assert.ok(shader.fragmentShader.indexOf('vec3 cadNormal=normalize(normal)')<shader.fragmentShader.indexOf('vec3 v = normalize( cameraPosition - pos )'));assert.equal(shader.uniforms.cadThicknessEnabled.value,false);
 f.helper.render(f.camera);assert.equal(shader.uniforms.cadThicknessEnabled.value,true);const targets=new Set(f.renderer.frames.map(frame=>frame.target)),materials=new Set(f.renderer.frames.flatMap(frame=>frame.meshes.map(record=>record.material)));let targetDisposals=0,materialDisposals=0;for(const target of targets)target.addEventListener('dispose',()=>targetDisposals++);for(const material of materials)material.addEventListener('dispose',()=>materialDisposals++);f.helper.dispose();f.helper.dispose();assert.equal(targetDisposals,2);assert.equal(materialDisposals,3);assert.equal(shader.uniforms.cadThicknessEnabled.value,false);assert.equal(f.helper.snapshot().disposed,true);
});

test('glass and water guard their existing source buffers without replacing the original physical sampler',()=>{
 const innerDepth={value:new THREE.DepthTexture(600,600,THREE.FloatType)},outerDepth={value:new THREE.DepthTexture(600,600,THREE.FloatType)},paperColor=new THREE.Color(2.3064,2.3091,1.9701),f=fixture({innerDepth,outerDepth,paperColor});
 const makeShader=()=>({uniforms:{workingTransmissionMap:{value:'existing HDR radiance'}},fragmentShader:THREE.ShaderChunk.transmission_pars_fragment.replaceAll('transmissionSamplerMap','workingTransmissionMap')+'\nvec4 unrelatedTransmission(vec2 uv){return getTransmissionSample(uv,.2,1.52);}\nvoid main(){\n#include <lights_fragment_begin>\n#include <transmission_fragment>\n}'});
 const glass=makeShader(),water=makeShader();f.helper.bindShader(glass,f.glass.material);f.helper.bindShader(water,f.water.material);
 assert.equal(glass.uniforms.cadThicknessSourceDepth,outerDepth);assert.equal(water.uniforms.cadThicknessSourceDepth,innerDepth);assert.equal(glass.uniforms.cadThicknessPaper.value,paperColor);assert.equal(glass.uniforms.workingTransmissionMap.value,'existing HDR radiance');
 assert.match(glass.fragmentShader,/textureBicubic\( workingTransmissionMap/);assert.match(glass.fragmentShader,/return getTransmissionSample\(uv,roughness,ior\)/);assert.match(glass.fragmentShader,/return getTransmissionSample\(uv,\.2,1\.52\)/);
 assert.equal((glass.fragmentShader.match(/cadGuardTransmissionSample\([^\n]*cadVisibleEntryDepth\)/g)||[]).length,2);assert.ok(glass.fragmentShader.indexOf('vec4 cadGuardTransmissionSample')<glass.fragmentShader.indexOf('vec4 getIBLVolumeRefraction'));assert.match(glass.fragmentShader,/cadVisibleEntryDepth=-\(viewMatrix\*vec4\(position,1\.\)\)\.z/);
 f.helper.render(f.camera);assert.deepEqual(glass.uniforms.cadThicknessInverseProjection.value.elements,f.camera.projectionMatrixInverse.elements);assert.equal(glass.uniforms.cadThicknessDepthReady.value,true);assert.equal(water.uniforms.cadThicknessDepthReady.value,true);
 innerDepth.value=null;assert.equal(f.helper.render(f.camera).cached,true);assert.equal(water.uniforms.cadThicknessDepthReady.value,false);assert.equal(glass.uniforms.cadThicknessDepthReady.value,true);assert.equal(f.renderer.frames.length,2,'source-depth updates must not add field passes');assert.equal(f.helper.snapshot().foregroundGuard.toleranceMM,.1);assert.equal(f.helper.snapshot().foregroundGuard.enabled,true);f.helper.dispose();assert.equal(f.helper.snapshot().foregroundGuard.enabled,false);
});

function closedShells(shells){
 const positions=[],indices=[];
 for(const{size,center=[0,0,0],cavity=false}of shells){const box=new THREE.BoxGeometry(...size),offset=positions.length/3,p=box.getAttribute('position');for(let i=0;i<p.count;i++)positions.push(p.getX(i)+center[0],p.getY(i)+center[1],p.getZ(i)+center[2]);for(let i=0;i<box.index.count;i+=3){const triangle=[box.index.getX(i),box.index.getX(i+1),box.index.getX(i+2)];if(cavity)triangle.reverse();indices.push(...triangle.map(value=>value+offset));}box.dispose();}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(new THREE.Uint32BufferAttribute(indices,1));return geometry;
}
test('outer-water capture retains every closed positive shell and excludes reversed cavity shells across native face seams',()=>{
 const geometry=closedShells([{size:[8,8,8],center:[30,-12,40]},{size:[2,2,2],center:[30,-12,40],cavity:true},{size:[3,4,5],center:[50,-12,40]}]),position=geometry.getAttribute('position'),index=geometry.index,originalPositions=position.array.slice(),originalIndices=index.array.slice(),filtered=waterOuterBoundaryIndices(position,index);
 assert.equal(filtered.audit.validated,true);assert.equal(filtered.audit.componentCount,3);assert.equal(filtered.audit.outerComponents,2);assert.equal(filtered.audit.removedCavities,1);assert.equal(filtered.audit.sourceTriangles,36);assert.equal(filtered.audit.fieldTriangles,24);assert.deepEqual(Array.from(filtered.indices),[...originalIndices.slice(0,36),...originalIndices.slice(72)]);
 assert.deepEqual(position.array,originalPositions);assert.deepEqual(index.array,originalIndices);close(filtered.audit.components[0].signedVolumeMM3,512);close(filtered.audit.components[1].signedVolumeMM3,-8);close(filtered.audit.components[2].signedVolumeMM3,60);
 // Open or inconsistently oriented shells cannot authorize deleting native triangles.
 const open=new THREE.BufferAttribute(index.array.slice(3),1),invalid=waterOuterBoundaryIndices(position,open);assert.equal(invalid.audit.validated,false);assert.equal(invalid.indices,open.array);assert.equal(invalid.audit.removedCavities,0);
});
test('filtered field geometry shares exact native attributes, restores original drawing geometry on success/failure and is disposed once',()=>{
 for(const fail of[false,true]){
  const f=fixture(),source=closedShells([{size:[4,4,4]},{size:[1,1,1],cavity:true}]);source.setAttribute('normal',new THREE.Float32BufferAttribute(new Float32Array(source.getAttribute('position').count*3),3));f.water.geometry=source;const material=f.water.material;if(fail)f.renderer.throwAt=2;
  if(fail)assert.throws(()=>f.helper.render(f.camera),/field draw failed/);else f.helper.render(f.camera);
  assert.equal(f.water.geometry,source);assert.equal(f.water.material,material);const captured=f.renderer.frames[1].meshes[0].geometry;assert.notEqual(captured,source);for(const[name,attribute]of Object.entries(source.attributes))assert.equal(captured.getAttribute(name),attribute);assert.equal(captured.index.count,36);assert.equal(source.index.count,72);assert.equal(f.renderer.frames.length,2,'outer boundary filtering must not add capture passes');
  const audit=f.helper.snapshot().outerWaterBoundaries[0];assert.equal(audit.removedCavities,1);assert.equal(audit.ownedFilteredGeometry,true);let ownedDisposals=0,sourceDisposals=0;captured.addEventListener('dispose',()=>ownedDisposals++);source.addEventListener('dispose',()=>sourceDisposals++);f.helper.dispose();f.helper.dispose();assert.equal(ownedDisposals,1);assert.equal(sourceDisposals,0);
 }
});
test('replacing a native water geometry refreshes the owned field even when attribute versions match',()=>{
 const f=fixture(),first=closedShells([{size:[4,4,4]},{size:[1,1,1],cavity:true}]);f.water.geometry=first;f.helper.render(f.camera);const firstField=f.renderer.frames[1].meshes[0].geometry;let released=0;firstField.addEventListener('dispose',()=>released++);
 const second=closedShells([{size:[6,6,6]},{size:[2,2,2],cavity:true}]);assert.equal(first.getAttribute('position').version,second.getAttribute('position').version);f.water.geometry=second;assert.equal(f.helper.render(f.camera).cached,false);assert.equal(released,1);assert.equal(f.water.geometry,second);assert.notEqual(f.renderer.frames[3].meshes[0].geometry,firstField);assert.equal(f.helper.snapshot().outerWaterBoundaries[0].removedCavities,1);f.helper.dispose();
});
test('actual ELEMENTS CAD excludes exactly 18 bubble voids and preserves the known outer X-ray exit without changing package geometry',()=>{
 const manifest=JSON.parse(readFileSync(new URL('./assets/instrument-working-v1/manifest.json',import.meta.url))),decoded=gunzipSync(readFileSync(new URL('./assets/instrument-working-v1/instrument.bin.gz',import.meta.url))),buffer=decoded.buffer.slice(decoded.byteOffset,decoded.byteOffset+decoded.byteLength),record=manifest.meshes.find(mesh=>mesh.module==='elements'&&mesh.material===7);assert.ok(record);
 const position=new THREE.BufferAttribute(new Float32Array(buffer,record.positions.offset,record.positions.count),3),index=new THREE.BufferAttribute(new Uint32Array(buffer,record.indices.offset,record.indices.count),1),hash=array=>createHash('sha256').update(new Uint8Array(array.buffer,array.byteOffset,array.byteLength)).digest('hex'),before=[hash(position.array),hash(index.array)],filtered=waterOuterBoundaryIndices(position,index);
 assert.equal(filtered.audit.validated,true);assert.equal(filtered.audit.componentCount,19);assert.equal(filtered.audit.outerComponents,1);assert.equal(filtered.audit.removedCavities,18);assert.equal(filtered.audit.sourceTriangles,28746);assert.equal(filtered.audit.fieldTriangles,9234);
 const ray=new THREE.Ray(new THREE.Vector3(40,15,0),new THREE.Vector3(-1,0,0)),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),hit=new THREE.Vector3();
 function intersections(indices){const values=[];for(let i=0;i<indices.length;i+=3){a.fromBufferAttribute(position,indices[i]);b.fromBufferAttribute(position,indices[i+1]);c.fromBufferAttribute(position,indices[i+2]);if(ray.intersectTriangle(a,b,c,false,hit))values.push(hit.x);}return values.sort((a,b)=>b-a).filter((value,i,list)=>i===0||Math.abs(value-list[i-1])>.0001);}
 const sourceHits=intersections(index.array),outerHits=intersections(filtered.indices);assert.equal(sourceHits.length,4);assert.equal(outerHits.length,2);close(outerHits[0],26.3,.0001);close(outerHits[1],-26.3,.0001);close(sourceHits[1],-.309339,.05);close(sourceHits[2],-3.690661,.05);assert.ok(sourceHits[0]-sourceHits[1]<27);assert.ok(outerHits[0]-outerHits[1]>52.59);
 assert.deepEqual([hash(position.array),hash(index.array)],before);
});
test('opaque interior continuation converges to the actual ray-plane hit for orthographic, mixed and perspective camera depth fields',()=>{
 const ortho=new THREE.OrthographicCamera(-20,20,15,-15,.1,200),perspective=new THREE.PerspectiveCamera(45,4/3,.1,200),entryView=[-2,.4,-40],rayView=[8,-1,-30],normal=new THREE.Vector3(.1,.2,1).normalize(),expectedFraction=.43,hit=new THREE.Vector3(...entryView).addScaledVector(new THREE.Vector3(...rayView),expectedFraction),plane=new THREE.Plane(normal,-normal.dot(hit));
 for(const blend of[0,.25,.7,1]){
  const projection=new THREE.Matrix4();for(let i=0;i<16;i++)projection.elements[i]=ortho.projectionMatrix.elements[i]*(1-blend)+perspective.projectionMatrix.elements[i]*blend/40;const inverseProjection=projection.clone().invert();
  const sampleDepth=uv=>{const near=new THREE.Vector3(uv[0]*2-1,uv[1]*2-1,-1).applyMatrix4(inverseProjection),far=new THREE.Vector3(uv[0]*2-1,uv[1]*2-1,1).applyMatrix4(inverseProjection),point=new THREE.Vector3(),ray=new THREE.Ray(near,far.sub(near).normalize());assert.ok(ray.intersectPlane(plane,point));return point.applyMatrix4(projection).z*.5+.5;};
  const resolved=resolveInteriorTransmission({entryView,rayView,projection,inverseProjection,sampleDepth});assert.equal(resolved.resolved,true);close(resolved.fraction,expectedFraction,.000001);resolved.ray.forEach((value,i)=>close(value,rayView[i]*expectedFraction,.00003));assert.ok(Math.hypot(...resolved.ray)<Math.hypot(...rayView),'Beer attenuation must stop at the opaque internal hit');
 }
});
test('interior-hit correction never accepts foreground, outside-volume, offscreen or unconverged depth samples',()=>{
 const camera=new THREE.OrthographicCamera(-10,10,10,-10,.1,200),projection=camera.projectionMatrix,inverseProjection=camera.projectionMatrixInverse,entryView=[0,0,-40],rayView=[5,0,-30],depthAt=z=>new THREE.Vector3(0,0,-z).applyMatrix4(projection).z*.5+.5,base={entryView,rayView,projection,inverseProjection};
 for(const sampleDepth of[()=>1,()=>depthAt(35),()=>depthAt(80),()=>NaN]){const resolved=resolveInteriorTransmission({...base,sampleDepth});assert.equal(resolved.resolved,false);assert.deepEqual(resolved.ray,rayView);}
 let calls=0;const unstable=resolveInteriorTransmission({...base,sampleDepth:()=>depthAt(++calls%2?45:65)});assert.equal(unstable.resolved,false);assert.match(unstable.reason,/did not converge/);assert.equal(calls,6,'fixed bounded refinement instead of a depth march');
 const offscreen=resolveInteriorTransmission({...base,rayView:[30,0,-30],sampleDepth:()=>depthAt(60)});assert.equal(offscreen.resolved,false);assert.equal(resolveInteriorTransmission({...base,rayView:[1,0,30],sampleDepth:()=>depthAt(45)}).resolved,false);
});
test('physical transmission projects and attenuates the corrected interior ray before sampling the existing HDR source',()=>{
 const f=fixture(),shader={uniforms:{},fragmentShader:THREE.ShaderChunk.transmission_pars_fragment+'\nvoid main(){\n#include <lights_fragment_begin>\n#include <transmission_fragment>\n}'};f.helper.bindShader(shader,f.water.material);
 assert.equal((shader.fragmentShader.match(/transmissionRay=cadInteriorTransmissionRay\(position,transmissionRay,viewMatrix,projMatrix\)/g)||[]).length,2);assert.match(shader.fragmentShader,/for\(int step=0;step<4;step\+\+\)/);assert.match(shader.fragmentShader,/cadThicknessValidPath=true/);assert.ok(shader.fragmentShader.indexOf('transmissionRay=cadInteriorTransmissionRay')<shader.fragmentShader.indexOf('vec3 refractedRayExit'));assert.match(shader.fragmentShader,/volumeAttenuation\( length\( transmissionRay \)/);assert.match(shader.fragmentShader,/abs\(sourceDepth-\(entryDepth\+depthLength\*fraction\)\)>\.2/);f.helper.dispose();
});
test('outward exit normals round-trip through oct encoding including the exact negative pole',()=>{
 for(const value of[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[.2,-.4,-.8],[-.3,.8,.2]]){const expected=new THREE.Vector3(...value).normalize().toArray(),encoded=octEncodeNormal(value),decoded=octDecodeNormal(encoded);assert.ok(encoded.every(value=>value>=0&&value<=1));decoded.forEach((value,i)=>close(value,expected[i]));}
 assert.deepEqual(octEncodeNormal([0,0,-1]),[1,1]);assert.throws(()=>octEncodeNormal([0,0,0]));
});
test('curved sphere exit refinement matches the actual refracted ray and second Snell reaches rear opaque hardware',()=>{
 const orthographic=new THREE.OrthographicCamera(-20,20,15,-15,.1,200),perspective=new THREE.PerspectiveCamera(45,4/3,.1,200),center=new THREE.Vector3(0,0,-55),radius=10;
 for(const blend of[0,.5,1])for(const x of[2,4,6]){
  const projection=new THREE.Matrix4();for(let i=0;i<16;i++)projection.elements[i]=orthographic.projectionMatrix.elements[i]*(1-blend)+perspective.projectionMatrix.elements[i]*blend/40;const inverseProjection=projection.clone().invert(),entry=new THREE.Vector3(x,0,center.z+Math.sqrt(radius*radius-x*x)),entryN=entry.clone().sub(center).normalize();
  const uvOf=point=>{const p=point.clone().applyMatrix4(projection);return[p.x*.5+.5,p.y*.5+.5];},cameraRay=uv=>{const a=new THREE.Vector3(uv[0]*2-1,uv[1]*2-1,-1).applyMatrix4(inverseProjection),b=new THREE.Vector3(uv[0]*2-1,uv[1]*2-1,1).applyMatrix4(inverseProjection);return new THREE.Ray(a,b.sub(a).normalize());};
  const incident=cameraRay(uvOf(entry)).direction.toArray(),inside=dielectricTransmission(incident,entryN.toArray(),1,1.333).direction,insideVector=new THREE.Vector3(...inside),actualDistance=-2*entry.clone().sub(center).dot(insideVector),actualExit=entry.clone().addScaledVector(insideVector,actualDistance),actualNormal=actualExit.clone().sub(center).normalize();
  const sampleExit=uv=>{const ray=cameraRay(uv),q=ray.origin.clone().sub(center),b=q.dot(ray.direction),discriminant=b*b-q.lengthSq()+radius*radius;if(discriminant<0)return null;const far=ray.at(-b+Math.sqrt(discriminant),new THREE.Vector3());return{id:3,depth:-far.z,normal:far.clone().sub(center).normalize().toArray()};};
  const refined=refineTransmissionExit({entryView:entry.toArray(),rayView:inside.map(value=>value*18),projection,inverseProjection,sampleExit,materialId:3,maxDistance:35});assert.equal(refined.valid,true,`blend ${blend}, x ${x}`);close(Math.hypot(...refined.ray),actualDistance,.002);const exit=entry.clone().add(new THREE.Vector3(...refined.ray));assert.ok(exit.distanceTo(actualExit)<.002);
  const expectedOutside=dielectricTransmission(inside,actualNormal.clone().negate().toArray(),1.333,1),outside=dielectricTransmission(inside,refined.normal.map(value=>-value),1.333,1);assert.equal(outside.tir,false);outside.direction.forEach((value,i)=>close(value,expectedOutside.direction[i],.001));
  // The outgoing ray, not just the projected exit, must reach the rear plane.
  const sourceZ=-85,sampleDepth=uv=>{const ray=cameraRay(uv),point=ray.at((sourceZ-ray.origin.z)/ray.direction.z,new THREE.Vector3());return point.applyMatrix4(projection).z*.5+.5;},continued=resolveInteriorTransmission({entryView:exit.toArray(),rayView:outside.direction.map(value=>value*750),projection,inverseProjection,sampleDepth});assert.equal(continued.resolved,true);
  const source=exit.clone().add(new THREE.Vector3(...continued.ray)),actualSource=actualExit.clone().addScaledVector(new THREE.Vector3(...expectedOutside.direction),(sourceZ-actualExit.z)/expectedOutside.direction[2]);assert.ok(source.distanceTo(actualSource)<.04,`rear hardware residual ${source.distanceTo(actualSource)}`);assert.ok(Math.hypot(...refined.ray)<source.distanceTo(entry),'absorption distance excludes the subsequent air segment');
 }
});
test('exit-plane refinement rejects missing IDs, wrong orientation and nonconverged curved discontinuities',()=>{
 const camera=new THREE.OrthographicCamera(-20,20,20,-20,.1,200),base={entryView:[0,0,-40],rayView:[2,0,-20],projection:camera.projectionMatrix,inverseProjection:camera.projectionMatrixInverse,materialId:3,maxDistance:50};
 for(const sampleExit of[()=>null,()=>({id:2,depth:55,normal:[0,0,-1]}),()=>({id:3,depth:55,normal:[0,0,1]})])assert.equal(refineTransmissionExit({...base,sampleExit}).valid,false);
 let reads=0;const unstable=refineTransmissionExit({...base,sampleExit:()=>({id:3,depth:++reads%2?50:60,normal:[0,0,-1]})});assert.equal(unstable.valid,false);assert.match(unstable.reason,/did not converge/);assert.equal(reads,4);
});
test('exit transport reuses two fields and reports color memory and bounded source reads honestly',()=>{
 const f=fixture({exitTransport:true}),shader={uniforms:{},fragmentShader:THREE.ShaderChunk.transmission_pars_fragment+'\nvoid main(){\n#include <lights_fragment_begin>\n#include <transmission_fragment>\n}'};f.helper.bindShader(shader,f.glass.material);f.helper.render(f.camera);const snapshot=f.helper.snapshot();assert.equal(snapshot.fieldPasses,2);assert.equal(snapshot.fieldMemory.colorBytes,600*600*2*16);assert.equal(snapshot.fieldMemory.previousRGColorBytes,600*600*2*8);assert.equal(snapshot.exitTransport.sourceDepthReadsMaxPerWavelength,12);assert.equal(snapshot.exitTransport.exitFieldReadsMaxPerWavelength,5);assert.equal(snapshot.exitTransport.exactNestedTransport,false);
 assert.match(shader.fragmentShader,/outside=refract\(inside,-exitNormal,ior\)/);assert.match(shader.fragmentShader,/cadExitIor=iors\[ i \]/);assert.equal((shader.fragmentShader.match(/\* cadThicknessExitTransmission;/g)||[]).length,2);assert.ok(shader.fragmentShader.indexOf('cadRefineExitRay(position')<shader.fragmentShader.indexOf('cadInteriorTransmissionRay(position'));for(const frame of f.renderer.frames)for(const record of frame.meshes){assert.match(record.material.vertexShader,/cadExitOutward=normalMatrix\*normal/);assert.doesNotMatch(record.material.fragmentShader,/gl_FrontFacing/);}f.helper.dispose();
});
test('rejected exit transport is opt-in and default shaders/fields restore the prior RG32F path',()=>{
 const f=fixture(),shader={uniforms:{},fragmentShader:THREE.ShaderChunk.transmission_pars_fragment+'\nvoid main(){\n#include <lights_fragment_begin>\n#include <transmission_fragment>\n}'};f.helper.bindShader(shader,f.water.material);f.helper.render(f.camera);
 assert.doesNotMatch(shader.fragmentShader,/cadRefineExitRay|cadSourceAfterExit|cadDecodeExitNormal/);assert.match(shader.fragmentShader,/vec3 refractedRayExit = position \+ transmissionRay;/);assert.equal((shader.fragmentShader.match(/transmissionRay=cadInteriorTransmissionRay\(position,transmissionRay,viewMatrix,projMatrix\)/g)||[]).length,2);assert.doesNotMatch(shader.fragmentShader,/\* cadThicknessExitTransmission;/);
 for(const frame of f.renderer.frames){assert.equal(frame.target.texture.format,THREE.RGFormat);for(const record of frame.meshes)assert.doesNotMatch(record.material.vertexShader,/cadExitOutward|normalMatrix/);}
 const snapshot=f.helper.snapshot();assert.equal(snapshot.exitTransport.enabled,false);assert.equal(snapshot.exitTransport.comparisonOnly,true);assert.equal(snapshot.fieldMemory.colorBytes,600*600*2*8);assert.match(snapshot.backend,/RG32F/);assert.equal(snapshot.interiorSourceTransport.enabled,true);f.helper.dispose();assert.throws(()=>fixture({exitTransport:'true'}),/boolean/);
});
