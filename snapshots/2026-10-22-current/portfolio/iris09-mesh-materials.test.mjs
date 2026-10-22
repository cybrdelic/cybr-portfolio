import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {IRIS09_EMITTERS, IRIS09_FINISHES, IRIS09_ENGRAVING_RADIAL_BOUNDS, IRIS09_MECHANICAL_SHADOW_BOUNDS, iris09StudioRadiance, iris09EmitterIrradiance, iris09MechanicalLeafCovered, iris09AnisotropyParameters, createIris09StudioTexture, createIris09Materials} from './iris09-mesh-materials.mjs';
import {IRIS09_MECHANICS,iris09MechanicalBladeContains,iris09MechanicalFrame,solveIris09Input} from './iris09-kinematics.mjs';
import {createIris09Geometry} from './iris09-mesh-geometry.mjs';

test('studio retains the three original finite sources and their HDR colors', () => {
  assert.deepEqual(IRIS09_EMITTERS.map(light => light.position), [[-3.6, 4.1, -3.1], [3.1, 2.9, -2.4], [.2, 1.8, 4.5]]);
  for (const light of IRIS09_EMITTERS) {
    const relative = [light.position[0], light.position[1] - .2, light.position[2]];
    const direction = relative.map(value => value / Math.hypot(...relative));
    const value = iris09StudioRadiance(direction);
    assert.ok(value.every(Number.isFinite));
    assert.ok(Math.max(...value) > 1, 'source remains HDR rather than being display-clamped');
  }
  assert.ok(Math.max(...iris09StudioRadiance([0, -1, 0])) < .02);
});

test('procedural studio is a bounded linear half-float texture without external assets', () => {
  const texture = createIris09StudioTexture(T, 64, 32);
  assert.equal(texture.image.width, 64);
  assert.equal(texture.image.height, 32);
  assert.equal(texture.image.data.byteLength, 64 * 32 * 8);
  assert.equal(texture.type, T.HalfFloatType);
  assert.equal(texture.colorSpace, T.LinearSRGBColorSpace);
  assert.equal(texture.mapping, T.EquirectangularReflectionMapping);
  assert.equal(texture.generateMipmaps, false);
  assert.throws(() => createIris09StudioTexture(T, 2048, 256), RangeError);
  texture.dispose();
});

test('shared materials retain distinct finishes and require no screen transmission pass', () => {
  const result = createIris09Materials(T);
  assert.deepEqual(Object.keys(result.materials).sort(), ['1', '2', '3', '4', '5', '8', 'glass']);
  for (const [id, finish] of Object.entries(IRIS09_FINISHES)) {
    const material = result.materials[id];
    assert.equal(material.roughness, finish.roughness);
    assert.equal(material.metalness, finish.metalness);
    assert.equal(material.anisotropy, finish.anisotropy);
    assert.equal(material.envMap, result.environment);
    assert.ok(material.isMeshPhysicalMaterial);
  }
  assert.equal(result.materials.glass.transmission, 0);
  assert.equal(result.materials.glass.depthWrite, false);
  assert.equal(result.materials[8].side, T.DoubleSide);
  assert.equal(result.lights.length, 3);
  assert.ok(result.lights.every(light => !light.castShadow));
  assert.equal(result.metadata.perFrameRayMarching, false);
  assert.equal(result.metadata.environmentBuilds, 0);
  assert.equal(result.metadata.environmentBytes, 1024 * 1024);
  assert.ok(result.metadata.approximations.some(value => value.includes('nested refraction')));
  result.dispose();
});

test('visible-fragment finish contains source vector engraving and filtered feed without ray traversal', () => {
  const result = createIris09Materials(T);
  for (const id of ['1', '2', '3', '4', '5', '8']) {
    const shader = {uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader};
    result.materials[id].onBeforeCompile(shader);
    assert.match(shader.vertexShader, /vIrisPosition=position/);
    assert.match(shader.fragmentShader, /irisTangentDirection-normal\*dot/);
    assert.doesNotMatch(shader.fragmentShader, /bodyMap|opticalTransport|shadeRay|marchScene/);
    if (id === '2') {
      assert.match(shader.fragmentShader, /irisStamp\(vIrisPosition,irisFootprint\)\*irisFace/);
      assert.match(shader.fragmentShader, /irisR\*6\.28318530718\*94\./);
      assert.match(shader.fragmentShader, /irisR\*6\.28318530718\*211\./);
      assert.match(shader.fragmentShader, /irisHeight=-\.00045\*irisEngraving/);
      assert.ok(shader.fragmentShader.indexOf('float irisEngraving=') < shader.fragmentShader.indexOf('float irisSlope='));
    }
  }
  result.dispose();
});

test('anisotropic GGX maps both source widths rather than reusing incompatible strength', () => {
  for (const finish of Object.values(IRIS09_FINISHES).filter(finish => finish.anisotropy)) {
    const mapped = iris09AnisotropyParameters(finish.roughness, finish.anisotropy);
    const alphaB = mapped.roughness ** 2;
    const alphaT = alphaB + (1 - alphaB) * mapped.anisotropy ** 2;
    assert.ok(Math.abs(alphaB - mapped.sourceAlphaT) < 1e-12);
    assert.ok(Math.abs(alphaT - mapped.sourceAlphaB) < 1e-12);
    assert.ok(mapped.anisotropy < finish.anisotropy);
  }
  const metal = iris09AnisotropyParameters(.285, .71);
  assert.ok(metal.anisotropy < .30 && metal.anisotropy > .29);
  const result = createIris09Materials(T);
  const shader = {uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader};
  result.materials[2].onBeforeCompile(shader);
  assert.match(shader.vertexShader, /vIrisRadialView=normalMatrix\*vec3\(1\.,0\.,0\.\)/);
  assert.match(shader.fragmentShader, /material.anisotropyB=irisT/);
  assert.match(shader.fragmentShader, /material.alphaT=irisWide/);
  result.dispose();
});

test('environment lookup preserves the physical normal rather than bending it with anisotropy', () => {
  const result = createIris09Materials(T);
  for (const id of [2, 3, 4, 8]) {
    const shader = {uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader};
    result.materials[id].onBeforeCompile(shader);
    assert.match(shader.fragmentShader, /float irisSourceRoughness=material.roughness/);
    assert.match(shader.fragmentShader, /getIBLRadiance\( geometryViewDir, geometryNormal, irisSourceRoughness \)/);
    assert.match(shader.fragmentShader, /EnvironmentBRDF\(geometryNormal,geometryViewDir,material.specularColor,material.specularF90,irisSourceRoughness\)/);
    assert.doesNotMatch(shader.fragmentShader, /EnvironmentBRDF\(geometryNormal,geometryViewDir,material.specularColor,material.specularF90,material.roughness\)/);
    assert.doesNotMatch(shader.fragmentShader, /getIBLAnisotropyRadiance\( geometryViewDir/);
    assert.match(shader.fragmentShader, /material.alphaT=irisWide/);
  }
  assert.ok(result.metadata.approximations.some(value => value.includes('isotropic PMREM')));
  result.dispose();
});

test('opaque specialization removes zeroed contributions and matches the PMREM lobe width', () => {
  const result = createIris09Materials(T);
  for (const id of [1, 2, 3, 4, 5, 8]) {
    const shader = {uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader};
    result.materials[id].onBeforeCompile(shader);
    assert.doesNotMatch(shader.fragmentShader, /iblIrradiance \+= getIBLIrradiance/);
    assert.match(shader.fragmentShader, /radiance \* EnvironmentBRDF\(geometryNormal,geometryViewDir,material.specularColor,material.specularF90,irisSourceRoughness\)/);
    assert.doesNotMatch(shader.fragmentShader, /#include <lights_fragment_end>/);
    if ([2, 3, 4].includes(id)) {
      assert.equal(IRIS09_FINISHES[id].metalness, 1);
      assert.equal((shader.fragmentShader.match(/#if 0 \/\/ IRIS source pure-metal diffuse is zero/g) ?? []).length, 4);
    } else {
      assert.doesNotMatch(shader.fragmentShader, /RE_Direct\( directLight/);
      assert.match(shader.fragmentShader, /directLight.color\*BRDF_Lambert\(material.diffuseColor\)/);
    }
  }
  // The retained single-scatter expression equals computeMultiscattering's
  // FssEss for arbitrary DFG values and F0. Its other terms multiply zero IBL.
  for (let n = 0; n <= 50; n++) {
    const fab = [n / 50, (50 - n) / 500], f0 = [.04, .54, .83], f90 = 1;
    for (const f of f0) {
      const singleScatter = f * fab[0] + f90 * fab[1];
      const eMs = 1 - fab[0] - fab[1], fAvg = f + (1 - f) * .047619;
      const multiScatter = singleScatter * fAvg / (1 - eMs * fAvg) * eMs;
      const oldContribution = 1.73 * singleScatter + multiScatter * 0;
      const specialized = 1.73 * (f * fab[0] + f90 * fab[1]);
      assert.equal(specialized, oldContribution);
    }
  }
  result.dispose();
});

test('engraving radius rejection covers only identically zero original masks', () => {
  const smoothstep = (a, b, value) => {const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t);};
  const [minimum, maximum] = IRIS09_ENGRAVING_RADIAL_BOUNDS;
  for (let sample = 0; sample <= 30000; sample++) {
    const radius = sample / 10000;
    if (radius >= minimum && radius <= maximum) continue;
    for (const start of [1.210, 1.170]) {
      const sourceTickRadial = smoothstep(start - .002, start + .002, radius) * (1 - smoothstep(1.265, 1.270, radius));
      assert.equal(sourceTickRadial, 0);
    }
    const sourceRegister = smoothstep(1.405, 1.414, radius) * (1 - smoothstep(1.451, 1.458, radius));
    assert.equal(sourceRegister, 0);
    const sourceLetterY = (1.347 - radius) / .058 + .5;
    assert.ok(sourceLetterY < -.2 || sourceLetterY > 1.2);
  }
  const result = createIris09Materials(T);
  for (const id of [2, 3]) {
    const shader = {uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader};
    result.materials[id].onBeforeCompile(shader);
    assert.match(shader.fragmentShader, /if\(r<1\.168 \|\| r>1\.458\) return 0\./);
    assert.match(shader.fragmentShader, /float irisSlope=0\.;\s*if\(irisFace>0\.\)/);
    // Footprint derivatives remain outside nonuniform branches; filtering is
    // unchanged wherever the original contribution is nonzero.
    assert.ok(shader.fragmentShader.indexOf('float irisFootprint=') < shader.fragmentShader.indexOf('if(irisFace>0.)'));
    assert.match(shader.fragmentShader, /exp\(-\.22\*pow\(6\.28318530718\*/);
    if (id === 2) assert.match(shader.fragmentShader, /if\(irisFace>0\.\) irisEngraving=irisStamp/);
  }
  result.dispose();
});

test('clearcoat, sheen, iridescence and transmission retain the generic layer path', () => {
  const result = createIris09Materials(T);
  for (const property of ['clearcoat', 'sheen', 'iridescence', 'transmission']) {
    const material = result.materials[2].clone();
    material.onBeforeCompile = result.materials[2].onBeforeCompile;
    material.customProgramCacheKey = result.materials[2].customProgramCacheKey;
    const baselineKey = material.customProgramCacheKey();
    material[property] = .5;
    const shader = {uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader};
    material.onBeforeCompile(shader);
    assert.match(shader.fragmentShader, /#include <lights_fragment_end>/);
    assert.match(shader.fragmentShader, /iblIrradiance \+= getIBLIrradiance/);
    assert.doesNotMatch(shader.fragmentShader, /#if 0 \/\/ IRIS source pure-metal diffuse is zero/);
    assert.notEqual(material.customProgramCacheKey(), baselineKey);
    material.dispose();
  }
  result.dispose();
});

test('diffusion-cloth integration corrects centroid energy without an arbitrary exposure multiplier', () => {
  for (let index = 0; index < 3; index++) {
    const emitter = IRIS09_EMITTERS[index], integrated = iris09EmitterIrradiance(index);
    const d2 = emitter.position[0] ** 2 + (emitter.position[1] - .2) ** 2 + emitter.position[2] ** 2;
    const oldCenter = emitter.color.map(value => value * 4 * emitter.size[0] * emitter.size[1] / d2);
    assert.ok(integrated.every((value, channel) => value > 0 && value < oldCenter[channel]));
  }
});

test('direct diffuse, PMREM specular and source ambient are separate energy terms', () => {
  const result = createIris09Materials(T);
  const shader = {uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader};
  result.floorMaterial.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /reflectedLight.directSpecular=vec3\(0\.\)/);
  assert.match(shader.fragmentShader, /iblIrradiance=vec3\(0\.\)/);
  assert.match(shader.fragmentShader, /\.037\+\.028\*max/);
  assert.deepEqual(result.floorMaterial.color.toArray(), [.034, .032, .029]);
  assert.ok(Math.abs(((result.floorMaterial.ior - 1) / (result.floorMaterial.ior + 1)) ** 2 - .026) < 1e-12);
  result.dispose();
});

test('mechanical leaf visibility uses the actual rigid stack, contours and bores', () => {
  const result = createIris09Materials(T);
  const leaf = result.materials[8].clone(),state=solveIris09Input(IRIS09_MECHANICS.inputCenter);
  const frames=Array.from({length:9},(_,i)=>iris09MechanicalFrame(i,state));
  const transforms={value:frames.map(f=>new T.Vector4(f.c,f.s,f.hx,f.hz))},heights={value:new Float32Array(frames.map(f=>f.top))},index={value:4};
  leaf.userData.iris09MechanicalFrames=transforms;leaf.userData.iris09MechanicalHeights=heights;leaf.userData.iris09LeafIndex=index;
  const shader = {uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader};
  result.materials[8].onBeforeCompile.call(leaf, shader);
  assert.equal(shader.uniforms.uIrisMechanicalFrames,transforms);
  assert.equal(shader.uniforms.uIrisMechanicalHeights,heights);
  assert.equal(shader.uniforms.uIrisLeafIndex,index);
  assert.equal((shader.fragmentShader.match(/irisLeafSourceVisibility\(vIrisSurfaceRootPosition/g) ?? []).length, 1);
  assert.equal((shader.fragmentShader.match(/irisMechanicalLeavesCover\(p,/g) ?? []).length, 3);
  assert.match(shader.fragmentShader,/leaf<uIrisLeafCount;leaf\+\+/);
  assert.match(shader.fragmentShader,/leaf=uIrisLeafIndex\+1/);
  assert.match(shader.fragmentShader,/if\(t<=\.000001 \|\| t>=1\.\)continue/);
  assert.match(shader.fragmentShader,/if\(cover>=1\.\)return 1\./);
  assert.equal(shader.uniforms.uIrisBladeDiscCount.value,IRIS09_MECHANICS.bladeCircles.length);
  assert.deepEqual(shader.uniforms.uIrisBladeDiscs.value.map(v=>v.toArray()),IRIS09_MECHANICS.bladeCircles);
  assert.equal(shader.uniforms.uIrisSourceCount.value,IRIS09_EMITTERS.length);
  assert.equal(shader.uniforms.uIrisLeafCount.value,IRIS09_MECHANICS.blades);
  assert.match(shader.fragmentShader,/disc<uIrisBladeDiscCount/);
  assert.match(shader.fragmentShader,/source<uIrisSourceCount/);
  assert.match(shader.fragmentShader, /material.diffuseColor=vec3\(\.006,\.007,\.008\)\*\.28/);
  assert.doesNotMatch(shader.fragmentShader,/hitIris|irisClipArc|uIrisPreviousLeaf|dot\(world,world\)-\.9801|\.260\+\.008/);
  assert.equal(iris09MechanicalLeafCovered([-.2,.25,.2],[-.2,3,.2],[1,0,0,0],.260),true);
  assert.equal(iris09MechanicalLeafCovered([-.2,.27,.2],[-.2,3,.2],[1,0,0,0],.260),false);
  assert.equal(iris09MechanicalLeafCovered([0,.25,0],[0,3,0],[1,0,0,0],.260),false,'real pivot bore is transparent to the sheet test');
  assert.equal(iris09MechanicalLeafCovered([.2,.25,0],[.2,3,0],[1,0,0,0],.260),false,'real follower hole is transparent to the sheet test');
  assert.equal(iris09MechanicalLeafCovered([9.8,.25,.2],[9.8,3,.2],[1,0,10,0],.260),true,'no invented root-space radius clip');
  assert.match(result.metadata.leafVisibility,/all potentially intervening leaves/);
  leaf.dispose(); result.dispose();
});

test('rigid visibility follows all mechanical frame transforms and both light hemispheres',()=>{
 const m=IRIS09_MECHANICS;
 for(let pose=0;pose<=8;pose++){
  const state=solveIris09Input(m.inputMin+(m.inputMax-m.inputMin)*pose/8);
  for(let leaf=0;leaf<m.blades;leaf++){
   const f=iris09MechanicalFrame(leaf,state),frame=[f.c,f.s,f.hx,f.hz];
   for(let x=-.8;x<=.3;x+=.07)for(let z=-.4;z<=.95;z+=.07){
    const wx=f.hx+f.c*x-f.s*z,wz=f.hz+f.s*x+f.c*z,inside=iris09MechanicalBladeContains(x,z);
    assert.equal(iris09MechanicalLeafCovered([wx,f.bottom-.01,wz],[wx,3,wz],frame,f.top),inside);
    assert.equal(iris09MechanicalLeafCovered([wx,f.top+.01,wz],[wx,-3,wz],frame,f.top),inside);
    assert.equal(iris09MechanicalLeafCovered([wx,f.top+.01,wz],[wx+1,f.top+.01,wz],frame,f.top),false,'parallel ray cannot hit a sheet');
   }
  }
 }
});

test('shared leaf program skips only layers incapable of blocking the authored emitters',()=>{
 const m=IRIS09_MECHANICS,result=createIris09Materials(T),keys=new Set();
 const lastHeight=m.firstBladeTop+(m.blades-1)*(m.thickness+m.axialClearance);
 assert.ok(IRIS09_EMITTERS.every(light=>light.position[1]>lastHeight));
 for(let index=0;index<m.blades;index++){
  const material=result.materials[8].clone();
  material.onBeforeCompile=result.materials[8].onBeforeCompile;
  material.customProgramCacheKey=result.materials[8].customProgramCacheKey;
  material.userData.iris09LeafIndex={value:index};keys.add(material.customProgramCacheKey());
  const shader={uniforms:{},vertexShader:T.ShaderLib.physical.vertexShader,fragmentShader:T.ShaderLib.physical.fragmentShader};material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uIrisLeafIndex.value,index);
  assert.match(shader.fragmentShader,/for\(int leaf=uIrisLeafIndex\+1;leaf<uIrisLeafCount;leaf\+\+\)/);
  // Even the bottom face of this blade is above every skipped layer's top.
  const ownerBottom=m.firstBladeTop+index*(m.thickness+m.axialClearance)-m.thickness;
  for(let skipped=0;skipped<index;skipped++)assert.ok(m.firstBladeTop+skipped*(m.thickness+m.axialClearance)<ownerBottom);
  material.dispose();
 }
 assert.equal(keys.size,1,'all blade owners share one compiled program, not nine unrolled variants');
 result.dispose();
});

test('projected contour support bounds conservatively include every filtered constraint',()=>{
 const m=IRIS09_MECHANICS,[nx,nz,d]=m.bladeHalfPlane;
 let accepted=0;
 for(const width of [0,.00002,.001,.01,.1,.4]){
  for(let ix=0;ix<=200;ix++)for(let iz=0;iz<=200;iz++){
   const x=-1.2+ix*.01,z=-.8+iz*.012;
   const valid=nx*x+nz*z<=d+Math.hypot(nx,nz)*width&&m.bladeCircles.every(([cx,cz,r])=>Math.hypot(x-cx,z-cz)<=r+width);
   if(!valid)continue;
   for(const {axis,offset,footprintScale}of IRIS09_MECHANICAL_SHADOW_BOUNDS){
    assert.ok(axis[0]*x+axis[1]*z<=offset+width*footprintScale+1e-9,'filtered shadow coverage must survive early rejection');
    assert.ok(footprintScale>=1-1e-10&&Number.isFinite(footprintScale));
   }
   accepted++;
  }
 }
 assert.ok(accepted>40000);
 const upperZ=IRIS09_MECHANICAL_SHADOW_BOUNDS.find(bound=>bound.axis[1]===1);
 assert.ok(upperZ.offset<.885&&upperZ.offset>.884);
 assert.ok(upperZ.footprintScale>1.5,'corner needs more than naive AABB + one footprint');
});

test('analytic shadow footprint agrees with the real rigid leaf mesh away from tessellated edge bands',()=>{
 const m=IRIS09_MECHANICS,materials=Object.fromEntries([1,2,3,4,5,8].map(id=>[id,new T.MeshStandardMaterial({side:T.DoubleSide})]));
 const model=createIris09Geometry(T,{materials}),ray=new T.Raycaster(),target=new T.Vector3();
 let compared=0,blocked=0,clear=0;
 try{
  for(let pose=0;pose<=4;pose++){
   const state=model.setInput(m.inputMin+(m.inputMax-m.inputMin)*pose/4);model.root.updateMatrixWorld(true);
   for(let index=0;index<m.blades;index++){
    const f=iris09MechanicalFrame(index,state),frame=[f.c,f.s,f.hx,f.hz],mesh=model.leaves[index];
    for(let ix=0;ix<=12;ix++)for(let iz=0;iz<=13;iz++)for(const {position:light}of IRIS09_EMITTERS){
     const lx=-.84+ix*.10,lz=-.46+iz*.11,p=[f.hx+f.c*lx-f.s*lz,f.bottom-.008,f.hz+f.s*lx+f.c*lz];
     const t=(f.bottom-p[1])/(light[1]-p[1]),wx=p[0]+(light[0]-p[0])*t-f.hx,wz=p[2]+(light[2]-p[2])*t-f.hz;
     const x=wx*f.c+wz*f.s,z=-wx*f.s+wz*f.c,[nx,nz,d]=m.bladeHalfPlane;
     const edgeDistances=[Math.abs(nx*x+nz*z-d)/Math.hypot(nx,nz),...m.bladeCircles.map(([cx,cz,r])=>Math.abs(Math.hypot(x-cx,z-cz)-r)),Math.abs(Math.hypot(x,z)-m.pivotBoreRadius),Math.abs(Math.hypot(x-m.followerOffset,z)-m.followerPinRadius)];
     // Thin side walls and finite arc tessellation occupy this narrow band;
     // do not mislabel the documented near-face approximation as exact CSG.
     if(Math.min(...edgeDistances)<.002)continue;
     ray.ray.origin.fromArray(p);target.fromArray(light);ray.ray.direction.copy(target).sub(ray.ray.origin).normalize();ray.near=0;ray.far=target.distanceTo(ray.ray.origin);
     const actual=ray.intersectObject(mesh,false).length>0,analytic=iris09MechanicalLeafCovered(p,light,frame,f.top);
     assert.equal(analytic,actual,`pose ${pose}, blade ${index}, local ${x},${z}`);
     compared++;if(actual)blocked++;else clear++;
    }
   }
  }
  assert.ok(compared>20000);assert.ok(blocked>5000&&clear>5000);
 }finally{model.dispose();Object.values(materials).forEach(material=>material.dispose());}
});

test('PMREM is built exactly once and owned resources are disposed only once', () => {
  const calls = {builds: 0, generators: 0, targets: 0, source: 0, materials: 0};
  class FakePMREM {
    constructor(renderer) { assert.equal(renderer, marker); }
    fromEquirectangular(source) {
      calls.builds++;
      source.addEventListener('dispose', () => calls.source++);
      return {texture: new T.Texture(), dispose() { calls.targets++; }};
    }
    dispose() { calls.generators++; }
  }
  const marker = {};
  const result = createIris09Materials({...T, PMREMGenerator: FakePMREM}, marker);
  for (const material of [...Object.values(result.materials), result.floorMaterial]) material.addEventListener('dispose', () => calls.materials++);
  assert.equal(result.metadata.environmentBuilds, 1);
  assert.deepEqual(calls, {builds: 1, generators: 1, targets: 0, source: 0, materials: 0});
  result.dispose(); result.dispose();
  assert.deepEqual(calls, {builds: 1, generators: 1, targets: 1, source: 1, materials: 8});
});

test('all IRIS materials use source tone curve once and retain one output encoding', () => {
  const result = createIris09Materials(T);
  for (const material of [...Object.values(result.materials), result.floorMaterial]) {
    const shader = {uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader};
    material.onBeforeCompile(shader);
    assert.equal((shader.fragmentShader.match(/vec3 irisSceneLinear=/g) ?? []).length, 1);
    assert.match(shader.fragmentShader, /2\.51\*irisSceneLinear\+\.03/);
    assert.match(shader.fragmentShader, /2\.43\*irisSceneLinear\+\.59\)\+\.14/);
    assert.doesNotMatch(shader.fragmentShader, /#include <tonemapping_fragment>/);
    assert.equal((shader.fragmentShader.match(/#include <colorspace_fragment>/g) ?? []).length, 1);
    assert.doesNotMatch(shader.fragmentShader, /1\.0\s*\/\s*2\.2|1\.\s*\/\s*2\.2|toneMappingExposure/);
  }
  assert.match(result.metadata.display, /Original standalone uses approximate gamma 2\.2/);
  result.dispose();
});
