import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {configurePbrMetal,pbrUvFromMillimeters,pbrWearResponse} from './instrument-pbr-materials.mjs';
import {HIT_PBR_VERSION,downfilterHitPbrRGBA,buildHitPbrTextureArrays,packHitPbrMaterialTable,hitPbrChartFrame,evaluateHitPbrSamples,hitPbrDirectGGX,hitPbrIndirect,hitPbrGLSL,bindHitPbrUniforms} from './instrument-hit-pbr.mjs';
const close=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`),vc=(a,b,t=1e-9)=>a.forEach((x,i)=>close(x,b[i],t));
const add=(a,b)=>a.map((x,i)=>x+b[i]),mul=(a,s)=>a.map(x=>x*s),unit=a=>mul(a,1/Math.hypot(...a)),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const texture=(rgba=[128,128,128,255],size=2)=>new THREE.DataTexture(Uint8Array.from({length:size*size*4},(_,i)=>rgba[i%4]),size,size,THREE.RGBAFormat);
const layer=(name,kind='fine')=>({name,kind,color:texture([180,120,60,170]),normal:texture([128,128,255,255]),surface:texture([230,85,255,255])});
const encodeNormal=n=>unit(n).map(x=>(x+1)/2);
const profile=()=>({color:[.8,.75,.7],tileMM:[32,32],normalScale:[1,1],heightNormals:true,cavityStrength:1,roughness:1,metallic:1,anisotropy:.28,wearStrength:1,wearTileMM:[128,128]});

test('color downfilter averages linear reflectance while data and alpha stay linear, preserving row orientation',()=>{
  const source=Uint8Array.from([0,0,0,0,255,255,255,255,0,0,0,0,255,255,255,255]),copy=source.slice();
  vc(Array.from(downfilterHitPbrRGBA({data:source,width:2,height:2,size:1,color:true})),[188,188,188,128],0);
  vc(Array.from(downfilterHitPbrRGBA({data:source,width:2,height:2,size:1})),[128,128,128,128],0);assert.deepEqual(source,copy);
  const rows=Uint8Array.from([10,20,30,40,10,20,30,40,100,110,120,130,100,110,120,130]);
  vc(Array.from(downfilterHitPbrRGBA({data:rows,width:2,height:2,size:2,flipY:true}).slice(0,4)),[100,110,120,130],0);
  assert.throws(()=>downfilterHitPbrRGBA({data:source,width:2,height:2,size:4}),/downfilter/);
});

test('seven original fine/wear layers share exactly three correctly tagged arrays and retain loader texture ownership',async()=>{
  const layers=[...['BrushedMetal','LatheMetal','DiamondKnurl','DiamondEtch'].map(x=>layer(x)),...['aluminum','steel','bronze'].map(x=>({...layer(x,'wear'),alloy:x}))];
  let sourceDisposals=0;for(const entry of layers)for(const key of['color','normal','surface'])entry[key].addEventListener('dispose',()=>sourceDisposals++);
  const arrays=await buildHitPbrTextureArrays({THREE,layers,size:1,maxAnisotropy:4});
  assert.equal(arrays.depth,7);assert.equal(arrays.layerLookup.get(layers[1].color),1);assert.equal(arrays.wearLayerLookup.get('bronze'),6);
  for(const [key,map]of Object.entries(arrays.textures)){assert.equal(map.image.depth,7);assert.equal(map.image.data.length,28);assert.equal(map.colorSpace,key==='color'?THREE.SRGBColorSpace:THREE.NoColorSpace);assert.equal(map.wrapS,THREE.RepeatWrapping);assert.equal(map.minFilter,THREE.LinearMipmapLinearFilter);assert.equal(map.generateMipmaps,true);assert.equal(map.anisotropy,4);assert.equal(map.flipY,false);}
  let disposed=0;Object.values(arrays.textures).forEach(x=>x.addEventListener('dispose',()=>disposed++));arrays.dispose();arrays.dispose();assert.equal(disposed,3);assert.equal(sourceDisposals,0);
});

test('partial array decode failure disposes newly allocated arrays and never source textures',async()=>{
  let disposed=0;class ArrayTexture extends THREE.DataArrayTexture{constructor(...args){super(...args);this.addEventListener('dispose',()=>disposed++);}}
  const input=layer('test');let sourceDisposals=0;Object.values(input).filter(x=>x?.isTexture).forEach(x=>x.addEventListener('dispose',()=>sourceDisposals++));
  await assert.rejects(buildHitPbrTextureArrays({THREE:{...THREE,DataArrayTexture:ArrayTexture},layers:[input],size:1,readPixels:t=>{if(t===input.normal)throw Error('decode failed');return t.image;}}),/decode failed/);
  assert.equal(disposed,1);assert.equal(sourceDisposals,0);
});

test('nine material texels preserve exact IDs, native tint/factors, chart flags, wear alloy, and protected material isolation',async()=>{
  const fine=layer('LatheMetal'),wear={...layer('bronze','wear'),alloy:'bronze'},arrays=await buildHitPbrTextureArrays({THREE,layers:[fine,wear],size:1});
  const metal=new THREE.MeshPhysicalMaterial(),protectedMaterial=new THREE.MeshPhysicalMaterial({color:new THREE.Color(.03,.04,.05),roughness:.62,metalness:0,vertexColors:true});
  configurePbrMetal(metal,{THREE,maps:{baseColor:fine.color,normal:fine.normal,roughness:fine.surface,metallic:fine.surface},tileMM:[128,128],mapping:'radialFace',chartKind:1,heightNormals:true,cavity:true,anisotropy:.18,colorMultiplier:[1,.67,.35],wearMaps:{color:wear.color,surface:wear.surface,normal:wear.normal},wearAlloy:'bronze'});
  const source={color:metal.color.toArray(),normalScale:metal.normalScale.toArray(),roughness:metal.roughness,metalness:metal.metalness,compile:metal.onBeforeCompile,metadata:JSON.stringify(metal.userData)},beforeProtected=protectedMaterial.toJSON();
  const table=packHitPbrMaterialTable({THREE,materials:[protectedMaterial,metal],layerLookup:arrays.layerLookup,wearLayerLookup:arrays.wearLayerLookup});
  assert.equal(table.texture.image.width,9);assert.equal(table.texture.image.height,2);assert.equal(table.profiles[0].fineLayer,-1);assert.equal(table.profiles[0].sourceFinish,false);assert.equal(table.data[27],0);assert.equal(table.profiles[0].roughness,.62);
  assert.equal(table.profiles[1].fineLayer,0);assert.equal(table.profiles[1].wearLayer,1);assert.equal(table.profiles[1].radialFace,true);assert.equal(table.profiles[1].heightNormals,true);assert.equal(table.profiles[1].chartKind,1);vc(table.profiles[1].color,[1,.67,.35]);close(table.profiles[1].anisotropy,.18);
  vc(metal.color.toArray(),source.color);vc(metal.normalScale.toArray(),source.normalScale);assert.equal(metal.onBeforeCompile,source.compile);assert.equal(JSON.stringify(metal.userData),source.metadata);assert.deepEqual(protectedMaterial.toJSON(),beforeProtected);
  const finish=packHitPbrMaterialTable({THREE,materials:[protectedMaterial],sourceFinish:true});assert.equal(finish.data[27],1);finish.dispose();
  protectedMaterial.userData.secondarySourceFinish=true;const selected=packHitPbrMaterialTable({THREE,materials:[protectedMaterial]});assert.equal(selected.data[27],1);selected.dispose();
  protectedMaterial.userData.secondarySourceFinish=false;const isolated=packHitPbrMaterialTable({THREE,materials:[protectedMaterial],sourceFinish:true});assert.equal(isolated.data[27],0);isolated.dispose();
  assert.throws(()=>packHitPbrMaterialTable({THREE,materials:[metal]}),/missing/);table.dispose();arrays.dispose();metal.dispose();protectedMaterial.dispose();
});

test('analytic angular/radial derivatives agree with independent finite differences on all closed chart modes',()=>{
  for(const kind of[0,1,2,3])for(const rotationRadians of[0,.37,Math.PI/2]){
    const localPosition=[7,30,40],chart=[kind,279],turn=Math.atan2(40,30)/(2*Math.PI),uv=kind===0?[7,40]:kind===3?[7,turn*279]:[turn*279,50];
    const localDx=[1,.3,-.2],localDy=[.2,-.1,.4],uvDx=[.7,.2],uvDy=[-.1,.6],positionDx=localDx,positionDy=localDy,normal=unit(cross(positionDx,positionDy));
    const args={uv,chart,localPosition,tileMM:[32,41],rotationRadians,positionDx,positionDy,localDx,localDy,uvDx,uvDy,normal,wearBounds:[50,20]},frame=hitPbrChartFrame(args),epsilon=1e-4;
    for(const [ld,ud,actual]of[[localDx,uvDx,frame.fineDx],[localDy,uvDy,frame.fineDy]]){
      const sample=sign=>pbrUvFromMillimeters({...args,localPosition:add(localPosition,mul(ld,sign*epsilon)),uv:add(uv,mul(ud,sign*epsilon))}),a=sample(1),b=sample(-1);vc(actual,a.map((x,i)=>(x-b[i])/(2*epsilon)),2e-8);
    }
  }
});

test('closed polar seams keep final UV and physical gradients continuous, including rotated maps and macro repeats',()=>{
  for(const kind of[2,3])for(const rotationRadians of[0,.43]){
    const radius=279/(2*Math.PI),epsilon=1e-9,frames=[Math.PI-epsilon,-Math.PI+epsilon].map(theta=>{
      const turn=theta/(2*Math.PI),localPosition=[7,radius*Math.cos(theta),radius*Math.sin(theta)],localDx=[1,0,0],localDy=[0,-Math.sin(theta),Math.cos(theta)];
      return hitPbrChartFrame({localPosition,uv:kind===2?[turn*279,7]:[7,turn*279],chart:[kind,279],tileMM:[32,40],rotationRadians,positionDx:localDx,positionDy:localDy,localDx,localDy,uvDx:[1,0],uvDy:[0,1],normal:[0,Math.cos(theta),Math.sin(theta)],wearBounds:[radius,20],wearPhase:[.2,.7]});
    });
    for(let i=0;i<2;i++){const delta=frames[0].fineUv[i]-frames[1].fineUv[i];close(delta,Math.round(delta),2e-8);const wearDelta=frames[0].wear.uv[i]-frames[1].wear.uv[i];close(wearDelta,Math.round(wearDelta),2e-8);}
    vc(frames[0].fineFrame.gradientU,frames[1].fineFrame.gradientU,2e-9);vc(frames[0].fineFrame.gradientV,frames[1].fineFrame.gradientV,2e-9);vc(frames[0].wearFrame.gradientU,frames[1].wearFrame.gradientU,2e-9);close(Math.abs(frames[0].wear.uv[0]-frames[1].wear.uv[0]),2,2e-8);
  }
});

test('metric height normals match independent displaced curved surface gradients, with mirrored cap handedness',()=>{
  const tileMM=[128,128],y=18,z=24,curve=.012,point=(dy,dz)=>[curve*((y+dy)**2+(z+dz)**2),y+dy,z+dz],base=point(0,0),edge0=[2*curve*y,1,0],edge1=[2*curve*z,0,1],normal=unit(cross(edge0,edge1));
  const p={...profile(),tileMM},frame=hitPbrChartFrame({uv:[0,30],chart:[1,279],localPosition:base,tileMM,mapping:'radialFace',positionDx:edge0,positionDy:edge1,localDx:edge0,localDy:edge1,uvDx:[0,0],uvDy:[0,0],normal});
  const slopeU=.022,slopeV=-.013,epsilon=1e-4,displaced=(dy,dz)=>add(point(dy,dz),mul(normal,slopeU*dy+slopeV*dz));
  const derivative0=mul(add(displaced(epsilon,0),mul(displaced(-epsilon,0),-1)),1/(2*epsilon)),derivative1=mul(add(displaced(0,epsilon),mul(displaced(0,-epsilon),-1)),1/(2*epsilon)),expected=unit(cross(derivative0,derivative1));
  const result=evaluateHitPbrSamples({profile:p,frame,normal,fine:{color:[1,1,1],surface:[1,.3,1],normal:encodeNormal([-slopeU,-slopeV,1])}});vc(result.normal,expected,1e-9);
  const flat=hitPbrChartFrame({uv:[0,30],chart:[1,279],localPosition:[0,30,0],tileMM:[32,32],positionDx:[0,1,0],positionDy:[0,0,1],localDx:[0,1,0],localDy:[0,0,1],uvDx:[0,0],uvDy:[0,0],normal:[1,0,0]});
  assert.equal(flat.fineFrame.handedness,-1);vc(flat.fineFrame.tangent,[0,0,1]);vc(flat.fineFrame.bitangent,[0,1,0]);
  for(const x of[127/255,.5,128/255])for(const yy of[127/255,.5,128/255]){
    const neutral=evaluateHitPbrSamples({profile:{...profile(),tileMM:[32,32]},frame:flat,normal:[1,0,0],fine:{color:[1,1,1],surface:[1,.3,1],normal:[x,yy,1]}});vc(neutral.normal,[1,0,0]);
  }
  assert.ok(hitPbrGLSL.includes('if(p.heightNormals>.5)fineN.xy*=step(vec2(1./255.+1.e-6),abs(fineN.xy))'));
});

test('secondary wear retains primary v9 opaque/oil semantics and adds physical pit slopes without tinting contaminants',()=>{
  const normal=[1,0,0],args={uv:[0,0],chart:[0,0],localPosition:[0,0,0],tileMM:[32,32],positionDx:[0,1,0],positionDy:[0,0,1],localDx:[0,1,0],localDy:[0,0,1],uvDx:[1,0],uvDy:[0,1],normal},frame=hitPbrChartFrame(args),p={...profile(),color:[1,.67,.35],wearStrength:.3};
  const fine={color:[.7,.7,.7],surface:[.8,.34,1],normal:[.5,.5,1]},wear={color:[.04,.08,.03,1],surface:[.72,1,0,1],normal:[128/255,128/255,1]},result=evaluateHitPbrSamples({profile:p,frame,fine,wear,normal});
  vc(result.color,wear.color.slice(0,3));close(result.metallic,0);close(result.anisotropy,0);close(result.roughness,.72);vc(result.normal,normal);
  const oil={color:[.04,.08,.03,.025],surface:[.18,0,.8,1],normal:encodeNormal([-.008,.012,1])},oily=evaluateHitPbrSamples({profile:p,frame,fine,wear:oil,normal});
  const primary=pbrWearResponse({baseColor:p.color.map(x=>x*.7),roughness:.34,metallic:1,anisotropy:p.anisotropy,color:oil.color,surface:oil.surface,wearStrength:.3});vc(oily.color,primary.color);close(oily.metallic,1);close(oily.roughness,primary.roughness);
  vc(oily.normal,unit([1,-.008*.3,.012*.3]),1e-10);
});

test('native correlated GGX matches known normal incidence, reciprocity, and finite anisotropic grazing response',()=>{
  const args={normal:[0,0,1],viewDir:[0,0,1],lightDir:[0,0,1],roughness:.3,f0:[.8,.6,.3]},fresnel=2**(-5.55473-6.98316),expected=args.f0.map(x=>(x*(1-fresnel)+fresnel)/(4*Math.PI*.3**4));vc(hitPbrDirectGGX(args),expected,1e-10);
  const v=unit([.8,.2,1]),l=unit([-.3,.5,1]);for(const anisotropy of[0,.18,.7]){
    const a={...args,viewDir:v,lightDir:l,anisotropy};vc(hitPbrDirectGGX(a),hitPbrDirectGGX({...a,viewDir:l,lightDir:v}),1e-12);
    for(const roughness of[.0525,.3,1]){const values=hitPbrDirectGGX({...a,roughness,viewDir:unit([1,0,.000001])});assert.ok(values.every(x=>Number.isFinite(x)&&x>=0));}
  }
  vc(hitPbrDirectGGX({...args,lightDir:[0,0,-1]}),[0,0,0]);
});

test('white furnace native split-sum multiscattering conserves white metal/dielectric energy and cavity attenuates only indirect response',()=>{
  for(const roughness of[.0525,.15,.35,.8,1])for(const dotNV of[0,.1,.5,1])for(const metallic of[0,1]){
    const result=hitPbrIndirect({color:[1,1,1],metallic,roughness,dotNV});vc(result.radiance,[1,1,1],1e-12);if(metallic===1)vc(result.diffuse,[0,0,0]);
    const valley=hitPbrIndirect({color:[1,1,1],metallic,roughness,dotNV,cavity:.78});assert.ok(valley.radiance.every(x=>x>=0&&x<=1));
  }
  const bronze=hitPbrIndirect({color:[.76,.58,.34],metallic:1,roughness:.32,dotNV:.5});assert.ok(bronze.radiance[0]>bronze.radiance[1]&&bronze.radiance[1]>bronze.radiance[2]);assert.ok(bronze.radiance.every(x=>x>0&&x<1));
});

test('shader ABI uses three arrays, seven bounded fine/wear/macro reads, native PMREM/GGX and caller-owned geometry/shadow callbacks',async()=>{
  assert.equal((hitPbrGLSL.match(/textureLod\(/g)||[]).length,7);assert.equal((hitPbrGLSL.match(/sampler2DArray/g)||[]).length,1);assert.ok(!/dFdx|dFdy|getTransmissionSample|transmissionSamplerMap/.test(hitPbrGLSL));
  for(const symbol of['cadVertexPoint','cadVertexVisibility','cadPbrKeyVisibility','getIBLIrradiance','getIBLRadiance','V_GGX_SmithCorrelated','D_GGX','DFGApprox','computeSpecularOcclusion'])assert.ok(hitPbrGLSL.includes(symbol));
  const source=THREE.ShaderLib.physical.fragmentShader.replace('#include <transmission_pars_fragment>',hitPbrGLSL+'\n#include <transmission_pars_fragment>');assert.ok(source.indexOf('<lights_physical_pars_fragment>')<source.indexOf('vec3 cadShadeOpaque'));assert.ok(source.indexOf('vec3 cadShadeOpaque')<source.indexOf('<transmission_pars_fragment>'));
  const arrays=await buildHitPbrTextureArrays({THREE,layers:[layer('fine')],size:1}),material=new THREE.MeshPhysicalMaterial({color:new THREE.Color(.7,.6,.5)}),table=packHitPbrMaterialTable({THREE,materials:[material]}),shader={uniforms:{}};
  bindHitPbrUniforms(shader,{THREE,arrays,materialTable:table,keyDirection:[-.55,-.72,1.1],keyColor:[1.45,1.45,1.45],fillDirection:[.75,.4,.65],fillColor:[.075,.075,.075],footprintMM:.1});assert.equal(Object.keys(shader.uniforms).length,9);assert.equal(shader.uniforms.cadPbrColorArray.value,arrays.textures.color);assert.equal(shader.uniforms.cadPbrMaterials.value,table.texture);assert.equal(HIT_PBR_VERSION,'secondary-native-pbr-v3');
  arrays.dispose();table.dispose();material.dispose();
});

