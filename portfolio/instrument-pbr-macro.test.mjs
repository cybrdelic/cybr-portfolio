import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {configurePbrMetal,pbrMacroRoughness,bindPbrMetalShader} from './instrument-pbr-materials.mjs';
import {packHitPbrMaterialTable,evaluateHitPbrSamples,hitPbrChartFrame,hitPbrGLSL} from './instrument-hit-pbr.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<3e-8,`${a} != ${b}`);
const shader=()=>({vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.physical.uniforms)});
test('macro compression retains fine residual and authored reference without changing identity profiles',()=>{
 const reference=.33775884,contrast=.45;
 close(pbrMacroRoughness({sample:.36,macro:.35,contrast,reference}),.36+.55*(reference-.35));
 close(pbrMacroRoughness({sample:.37,macro:.35,contrast,reference})-pbrMacroRoughness({sample:.36,macro:.35,contrast,reference}),.01);
 close(pbrMacroRoughness({sample:.37,macro:.35,contrast:1,reference}),.37);
 close(pbrMacroRoughness({sample:reference,macro:reference,contrast,reference}),reference);
 assert.throws(()=>pbrMacroRoughness({sample:.3,macro:.3,contrast:-1}),/macro roughness/);
});
test('primary macro sampling reuses the existing RM sampler and changes base roughness before independent wear',()=>{
 const clean=shader(),macro=shader();bindPbrMetalShader(clean,{THREE,tileMM:[128,128]});bindPbrMetalShader(macro,{THREE,tileMM:[128,128],roughnessMacroContrast:.45,roughnessMacroReference:.33775884});
 assert.ok(!clean.fragmentShader.includes('pbrMacroSample'));assert.ok(macro.fragmentShader.includes('textureLod(roughnessMap,pbrMapUv,max(pbrMacroLod,pbrRoughnessPixelLod))'));
 assert.ok(macro.fragmentShader.includes('*2.8,1.'));assert.deepEqual(macro.uniforms.pbrRoughnessMacro.value.toArray(),[.45,.33775884]);
 assert.equal((macro.fragmentShader.match(/uniform sampler2D/g)||[]).length,(clean.fragmentShader.match(/uniform sampler2D/g)||[]).length);
});
test('secondary material table retains nine texels and matches primary coarse contrast while wear still overrides deposits',()=>{
 const packed=new THREE.DataTexture(new Uint8Array(4),1,1),color=new THREE.DataTexture(new Uint8Array(4),1,1),normalMap=new THREE.DataTexture(new Uint8Array(4),1,1),material=new THREE.MeshPhysicalMaterial();
 configurePbrMetal(material,{THREE,maps:{baseColor:color,normal:normalMap,roughness:packed,metallic:packed},tileMM:[128,128],roughnessMacroContrast:.45,roughnessMacroReference:.33775884});
 const table=packHitPbrMaterialTable({THREE,materials:[material],layerLookup:new Map([[color,0]])});
 try{
  assert.equal(table.texture.image.width,9);close(table.data[31],.45);close(table.data[35],.33775884);assert.equal(table.profiles[0].roughnessMacroContrast,.45);
  const frame=hitPbrChartFrame({uv:[0,0],chart:[0,0],localPosition:[0,0,0],tileMM:[128,128],positionDx:[1,0,0],positionDy:[0,1,0],localDx:[1,0,0],localDy:[0,1,0],uvDx:[1,0],uvDy:[0,1],normal:[0,0,1]}),fine={color:[1,1,1],surface:[1,.36,1],normal:[.5,.5,1],macroRoughness:.35},profile={...table.profiles[0],wearStrength:1};
  close(evaluateHitPbrSamples({profile,frame,fine,normal:[0,0,1]}).roughness,pbrMacroRoughness({sample:.36,macro:.35,contrast:.45,reference:.33775884}));
  const worn=evaluateHitPbrSamples({profile,frame,fine,wear:{color:[.1,.1,.1,1],surface:[.8,1,0,0],normal:[.5,.5,1]},normal:[0,0,1]});close(worn.roughness,.8);close(worn.metallic,0);
  assert.ok(hitPbrGLSL.includes('p.macroContrast=h.w;p.macroReference=i.w'));assert.ok(hitPbrGLSL.includes('/min(p.tile.x,p.tile.y)*2.8'));
 }finally{table.dispose();material.dispose();packed.dispose();color.dispose();normalMap.dispose();}
});

test('constant conductor F0 ablation preserves alloy multiplier, normal/RM maps and independent contaminant color',()=>{
 const texture=()=>new THREE.DataTexture(new Uint8Array(4),1,1),packed=texture(),color=texture(),normal=texture(),wear={color:texture(),surface:texture(),normal:texture()},materials=[];
 try{
  for(const constantBaseReflectance of[undefined,[.69,.72,.76]]){
   const material=new THREE.MeshPhysicalMaterial();material.customProgramCacheKey=()=> 'same-base';materials.push(material);
   configurePbrMetal(material,{THREE,maps:{baseColor:color,normal,roughness:packed,metallic:packed},tileMM:[128,128],colorMultiplier:[1,.67,.35],wearMaps:wear,heightNormals:true,constantBaseReflectance});
   assert.deepEqual(material.color.toArray(),[1,.67,.35]);assert.equal(material.normalMap,normal);assert.equal(material.roughnessMap,packed);assert.equal(material.metalnessMap,packed);close(material.roughness,1);close(material.metalness,1);
  }
  assert.notEqual(materials[0].customProgramCacheKey(),materials[1].customProgramCacheKey());
  const output=shader();materials[1].onBeforeCompile(output,{});assert.deepEqual(output.uniforms.pbrMetalConstantF0.value.toArray(),[.69,.72,.76]);
  const clean=output.fragmentShader.indexOf('diffuseColor.rgb=diffuse*pbrMetalConstantF0'),deposit=output.fragmentShader.indexOf('diffuseColor.rgb=mix(diffuseColor.rgb,pbrWearColor.rgb');assert.ok(clean>0&&deposit>clean);
  assert.deepEqual(materials[1].userData.pbrMetal.constantBaseReflectance.linearRGB,[.69,.72,.76]);
  assert.throws(()=>bindPbrMetalShader(shader(),{THREE,tileMM:[128,128],constantBaseReflectance:[1.01,.7,.7]}),/conductor reflectance/);
 }finally{for(const material of materials)material.dispose();for(const item of[packed,color,normal,...Object.values(wear)])item.dispose();}
});
