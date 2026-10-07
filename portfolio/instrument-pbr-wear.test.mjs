import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import{configurePbrMetal,bindPbrMetalShader,pbrWearCoordinates,pbrWearResponse,composePbrWearNormal,disposePbrMetal}from './instrument-pbr-materials.mjs';
import{bindRasterCamera}from './instrument-raster-camera.mjs';
import{setupRasterThickness}from './instrument-raster-thickness.mjs';
const close=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const vectorClose=(a,b,t=1e-9)=>a.forEach((value,i)=>close(value,b[i],t));
const unit=v=>v.map(x=>x/Math.hypot(...v));
const texture=()=>new THREE.DataTexture(new Uint8Array(4*4*4).fill(128),4,4,THREE.RGBAFormat);
const fineMaps=()=>{const packed=texture();return{baseColor:texture(),normal:texture(),roughness:packed,metallic:packed};};
const wearMaps=()=>({color:texture(),surface:texture(),normal:texture()});
const shader=()=>({vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.physical.uniforms),defines:{USE_TRANSMISSION:''}});
const disposeMaps=maps=>{for(const map of new Set(Object.values(maps)))map.dispose();};

test('macro wear has seam-closed physical cylinder repeats, bounded part phase and tiny deposit-only rim fades',()=>{
  const length=279,radius=44.4,phase=[.1,.9];
  vectorClose(pbrWearCoordinates({uv:[32,64],localPosition:[0,0,0],chart:[0,0]}).uv,[.75,1]);
  vectorClose(pbrWearCoordinates({uv:[0,0],localPosition:[0,0,0],chart:[0,0]}).uv,[.5,.5]);
  vectorClose(pbrWearCoordinates({uv:[0,0],localPosition:[0,40,0],chart:[1,length],phase}).uv,[40/128+.5-.4*.22,.5+.4*.22]);
  const common={localPosition:[7,0,radius],phase,bounds:[radius,27]};
  const barrel=pbrWearCoordinates({...common,uv:[length/4,7],chart:[2,length]});
  const brush=pbrWearCoordinates({...common,uv:[7,length/4],chart:[3,length]});
  vectorClose(barrel.uv,[.5+.1,7/128+.5+.4*.18]);vectorClose(brush.uv,barrel.uv);
  const at=(angle,reference=angle,kind=2)=>pbrWearCoordinates({uv:kind===3?[7,reference*length/(2*Math.PI)]:[reference*length/(2*Math.PI),7],localPosition:[7,radius*Math.cos(angle),radius*Math.sin(angle)],chart:[kind,length],phase,bounds:[radius,27]});
  const step=1e-5;
  for(const kind of[2,3]){
    vectorClose(at(Math.PI,Math.PI,kind).uv.map((value,i)=>value-at(-Math.PI,-Math.PI,kind).uv[i]),[2,0]);
    for(const angle of[Math.PI,-Math.PI]){
      const a=at(angle-step,angle,kind).uv,b=at(angle+step,angle,kind).uv;
      vectorClose(b.map((value,i)=>(value-a[i])/(2*step)),[1/Math.PI,0],1e-9);
    }
  }
  close(at(2*Math.PI/17).uv[0]-at(0).uv[0],2/17);
  const fingerprintMM=18/128*(2*Math.PI*radius)/2;assert.ok(fingerprintMM>18&&fingerprintMM<20);
  // Wear bounds provide the true circumference even when fine knurl charts
  // use an adjusted circumference to close their unrelated design pitch.
  const overridden=pbrWearCoordinates({...common,uv:[100,7],chart:[2,400]});close(overridden.uv[0],barrel.uv[0]);
  const small=pbrWearCoordinates({uv:[8,7],localPosition:[7,0,4],chart:[2,32],bounds:[4,27],phase});close(small.uv[0],.25+.1);
  const cap=r=>pbrWearCoordinates({uv:[0,r],localPosition:[0,r,0],chart:[1,length],bounds:[radius,27]}).edgeFade;
  close(cap(radius),0);close(cap(radius-.075),.5);close(cap(radius-.15),1);
  close(pbrWearCoordinates({uv:[0,0],localPosition:[26.925,radius,0],chart:[2,length],bounds:[radius,27]}).edgeFade,.5);
  close(pbrWearCoordinates({uv:[0,0],localPosition:[0,.475,0],chart:[1,Math.PI],bounds:[.5,.5]}).edgeFade,.5);
});

test('opaque contamination is dielectric while oil retains metalness and contaminant color bypasses bronze tint',()=>{
  const clean={baseColor:[.7*.90,.72*.69,.76*.40],roughness:.32,metallic:1,anisotropy:.45};
  const rust=[.12,.055,.017,1];
  const opaque=pbrWearResponse({...clean,color:rust,surface:[.83,1,0,0]});
  vectorClose(opaque.color,rust.slice(0,3));close(opaque.roughness,.83);close(opaque.metallic,0);close(opaque.anisotropy,0);close(opaque.alphaT,.83**2);
  for(const wearStrength of[.01,.25,.5]){
    const core=pbrWearResponse({...clean,color:[...rust.slice(0,3),.02],surface:[.83,1,0,0],wearStrength});
    vectorClose(core.color,rust.slice(0,3));close(core.metallic,0);close(core.anisotropy,0);close(core.roughness,.83);close(core.colorBlend,1);
  }
  const oil=pbrWearResponse({...clean,color:[.2,.2,.2,.25],surface:[.17,0,1,0]});
  close(oil.metallic,1);close(oil.anisotropy,.45);close(oil.roughness,.17);
  const combined=pbrWearResponse({...clean,color:rust,surface:[.8,.3,.4,0],edgeFade:.5,wearStrength:.8});
  close(combined.coverage,1-(1-.3*.5)*(1-.4*.8));close(combined.roughness,.32+(.8-.32)*combined.coverage);close(combined.metallic,.85);close(combined.anisotropy,.45*.85);
  const rimFilm=pbrWearResponse({...clean,color:[.2,.2,.2,.06],surface:[.17,0,1,0],edgeFade:0,wearStrength:.25});
  close(rimFilm.roughness,.32+(.17-.32)*.25);close(rimFilm.colorBlend,.015);close(rimFilm.metallic,1);close(rimFilm.anisotropy,.45);
  const clearedDeposit=pbrWearResponse({...clean,color:rust,surface:[.83,1,0,0],edgeFade:0,wearStrength:.25});
  vectorClose(clearedDeposit.color,clean.baseColor);close(clearedDeposit.metallic,1);close(clearedDeposit.roughness,.32);
  const zero=pbrWearResponse({...clean,color:rust,surface:[.8,1,1,0],wearStrength:0});
  vectorClose(zero.color,clean.baseColor);close(zero.roughness,clean.roughness);close(zero.metallic,1);close(zero.anisotropy,.45);
});

test('pit and fine height gradients compose physically, retain neutral samples and preserve backside parity',()=>{
  const fineNormal=unit([-.03,.015,1]),pitNormal=unit([-.02,-.01,1]),sample=pitNormal.map(value=>(value+1)/2);
  const derivative={positionDx:[.1,0,0],positionDy:[0,.1,0],uvDx:[.1/128,0],uvDy:[0,.1/128]};
  const common={fineNormal,baseNormal:[0,0,1],sample,...derivative};
  const composed=composePbrWearNormal(common);
  // Independent finite differences of summed millimetre height fields.
  const height=(x,y)=>.03*x-.015*y+.02*x+.01*y,e=1e-4;
  vectorClose(composed,unit([-(height(e,0)-height(-e,0))/(2*e),-(height(0,e)-height(0,-e))/(2*e),1]));
  vectorClose(composePbrWearNormal({...common,uvDx:[.1/256,0]}),unit([-.04,.005,1]));
  for(const center of[127/255,128/255])vectorClose(composePbrWearNormal({...common,sample:[center,center,1]}),fineNormal);
  vectorClose(composePbrWearNormal({...common,wearStrength:0}),fineNormal);
  vectorClose(composePbrWearNormal({...common,edgeFade:0}),fineNormal);
  vectorClose(composePbrWearNormal({...common,positionDx:[0,0,0],positionDy:[0,0,0]}),fineNormal);
  vectorClose(composePbrWearNormal({...common,fineNormal:fineNormal.map(value=>-value),baseNormal:[0,0,-1],faceDirection:-1}),composed.map(value=>-value));
});

test('wear textures are optional, filtered, loader owned and isolated from clean shader programs',()=>{
  const fine=fineMaps(),wear=wearMaps(),materials=[];let wearDisposals=0;
  for(const map of Object.values(wear))map.addEventListener('dispose',()=>wearDisposals++);
  try{
    const clean=new THREE.MeshPhysicalMaterial(),worn=new THREE.MeshPhysicalMaterial(),other=new THREE.MeshPhysicalMaterial();materials.push(clean,worn,other);
    for(const material of materials)material.customProgramCacheKey=()=> 'native-factory';
    configurePbrMetal(clean,{THREE,maps:fine,tileMM:[32,32],heightNormals:true,cavity:true});
    configurePbrMetal(worn,{THREE,maps:fine,tileMM:[32,32],heightNormals:true,cavity:true,wearMaps:wear,wearTileMM:[128,128],wearAlloy:'bronze',wearStrength:.4,maxAnisotropy:4,anisotropy:.45,colorMultiplier:[.90,.69,.40]});
    configurePbrMetal(other,{THREE,maps:fine,tileMM:[32,32],heightNormals:true,cavity:true,wearMaps:wear,wearAlloy:'steel',wearStrength:1});
    assert.notEqual(clean.customProgramCacheKey(),worn.customProgramCacheKey());assert.equal(worn.customProgramCacheKey(),other.customProgramCacheKey());
    assert.equal(worn.map,fine.baseColor);assert.equal(worn.normalMap,fine.normal);assert.equal(worn.roughnessMap,fine.roughness);assert.equal(worn.metalnessMap,fine.metallic);
    assert.equal(wear.color.colorSpace,THREE.SRGBColorSpace);assert.equal(wear.surface.colorSpace,THREE.NoColorSpace);assert.equal(wear.normal.colorSpace,THREE.NoColorSpace);
    for(const map of Object.values(wear)){assert.equal(map.minFilter,THREE.LinearMipmapLinearFilter);assert.equal(map.wrapS,THREE.RepeatWrapping);assert.equal(map.generateMipmaps,true);}
    const a=shader(),b=shader(),c=shader();clean.onBeforeCompile(a,{});worn.onBeforeCompile(b,{});other.onBeforeCompile(c,{});
    assert.ok(!a.vertexShader.includes('metalWearPhase'));assert.ok(!a.fragmentShader.includes('pbrWearColorMap'));assert.equal(a.uniforms.pbrWearStrength,undefined);
    assert.equal(b.uniforms.pbrWearStrength.value,.4);assert.equal(b.uniforms.pbrWearColorMap.value,wear.color);assert.equal(b.uniforms.pbrWearSurfaceMap.value,wear.surface);assert.equal(b.uniforms.pbrWearNormalMap.value,wear.normal);
    assert.equal(b.fragmentShader,c.fragmentShader);assert.equal(b.vertexShader,c.vertexShader);
    const reads=source=>(source.match(/texture2D\s*\(/g)||[]).length;assert.equal(reads(b.fragmentShader)-reads(a.fragmentShader),3);
    assert.ok(b.fragmentShader.includes('vec2 uv=mm/pbrWearTileMM+vec2(.5)'));assert.ok(b.fragmentShader.includes('vec4 texelMetalness = texelRoughness;'));
    assert.ok(b.fragmentShader.includes('float repeats=max(1.,floor(circumference/pbrWearTileMM.x+.5))'));
    assert.ok(b.fragmentShader.includes('float width=clamp(dimension*.01,.05,.15)'));assert.ok(b.fragmentShader.includes('pbrWearDepositFade*(pbrWearStrength>0.?1.:0.)'));
    assert.deepEqual(worn.userData.pbrMetal.wear.edgeFadeMM,[.05,.15]);assert.match(worn.userData.pbrMetal.wear.coordinates,/integer macro repeats/);
    assert.ok(b.fragmentShader.indexOf('diffuseColor.rgb=mix(diffuseColor.rgb,pbrWearColor.rgb')>b.fragmentShader.indexOf('diffuseColor *= sampledDiffuseColor'));
    assert.ok(b.fragmentShader.includes('material.alphaT=mix(pow2(material.roughness),1.,pow2(material.anisotropy))'));
    assert.ok(b.fragmentShader.includes('vec3 nonPerturbedNormal = normal;'));assert.ok(b.fragmentShader.includes('pbrWearFrame[0]*=faceDirection'));
    assert.equal((b.fragmentShader.match(/mat3 pbrPhysicalMapGradients\(/g)||[]).length,1);assert.ok(b.fragmentShader.includes('mat3 tbn = pbrPhysicalHeightFrame'));
    assert.equal(/^[ \t]*#[^\r\n]*#/m.test(b.fragmentShader),false);
    for(const material of materials)disposePbrMetal(material);assert.equal(wearDisposals,0);
  }finally{disposeMaps(fine);disposeMaps(wear);}
  assert.equal(wearDisposals,3);
});

test('optional wear composes with camera and CAD thickness hooks in either order',()=>{
  const fine=fineMaps(),wear=wearMaps(),material=new THREE.MeshPhysicalMaterial({transmission:1,thickness:1.5}),object=new THREE.Mesh(new THREE.BoxGeometry(),material),scene=new THREE.Scene();scene.add(object);
  const thickness=setupRasterThickness({THREE,renderer:{},scene,objects:[object],fullSize:new THREE.Vector2(16,16)});
  try{
    for(const first of[true,false]){
      const compiled=shader();if(first)bindPbrMetalShader(compiled,{THREE,tileMM:[32,32],wearMaps:wear,heightNormals:true,cavity:true});
      bindRasterCamera(compiled,THREE);thickness.bindShader(compiled,material);
      if(!first)bindPbrMetalShader(compiled,{THREE,tileMM:[32,32],wearMaps:wear,heightNormals:true,cavity:true});
      assert.ok(compiled.uniforms.cadThicknessField);assert.ok(compiled.uniforms.pbrWearNormalMap);assert.ok(compiled.fragmentShader.includes('inverseTransformDirection(geometryViewDir, viewMatrix)'));assert.ok(compiled.fragmentShader.includes('#include <lights_physical_fragment>'));
    }
  }finally{thickness.dispose();material.dispose();object.geometry.dispose();disposeMaps(fine);disposeMaps(wear);}
});

test('wear descriptors reject incomplete textures, invalid strength and nonphysical tile dimensions',()=>{
  const wear=wearMaps();
  try{
    for(const wearStrength of[-.1,1.1,NaN])assert.throws(()=>bindPbrMetalShader(shader(),{THREE,tileMM:[32,32],wearMaps:wear,wearStrength}),/wear descriptor/);
    assert.throws(()=>bindPbrMetalShader(shader(),{THREE,tileMM:[32,32],wearMaps:{color:wear.color,surface:wear.surface}}),/wear descriptor/);
    assert.throws(()=>bindPbrMetalShader(shader(),{THREE,tileMM:[32,32],wearMaps:wear,wearTileMM:[128,0]}),/wear descriptor|wear tile/);
  }finally{disposeMaps(wear);}
});
