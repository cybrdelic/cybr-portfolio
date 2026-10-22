import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {nativeHitGeometryGLSL} from './instrument-native-hit-geometry.mjs';
import {analyticOpticsGLSL} from './instrument-analytic-optics.mjs';
import {nativeTransportGLSL,nativeTransportPathGLSL,uniformNativeKernelGLSL,minimalNativeCaptureGLSL} from './instrument-native-geometry-transport.mjs';
import {hitPbrGLSL} from './instrument-hit-pbr.mjs';
import {nativeStagedShaderSources,createNativeStagedInitialState,advanceNativeStagedState,setupNativeStagedTransport} from './instrument-native-staged-transport.mjs';
const recipe=JSON.parse(await readFile(new URL('./assets/instrument-optical-primitives-v1/primitives.json',import.meta.url),'utf8'));
const source=minimalNativeCaptureGLSL(THREE,nativeHitGeometryGLSL({tlasOffset:1,maxDepth:2,tlasDepth:1})+nativeTransportGLSL()+uniformNativeKernelGLSL(analyticOpticsGLSL(recipe))+hitPbrGLSL+nativeTransportPathGLSL());
const shaders=nativeStagedShaderSources(THREE,source);

test('separate event, geometry query and PBR programs never retain the monolithic interface shader',()=>{
 for(const name of Object.keys(shaders))assert.ok(!shaders[name].includes('cadNativeTrace('),name);
 assert.ok(!shaders.event.includes('cadShadeOpaque'));
 assert.ok(!shaders.opaque.includes('cadNativeSolidContains'));
 assert.ok(!shaders.advance.includes('cadQueryGeometry'));
 assert.ok(!shaders.advance.includes('cadPbrEvaluate'));
 assert.ok(!shaders.shade.includes('cadQueryGeometry'));
 assert.ok(!shaders.shade.includes('cadNativeSolidContains'));
 assert.match(shaders.event,/struct CadWorldOpticalHit/);
 assert.match(shaders.opaque,/\.00025,maximum,0,hit/);
 assert.match(shaders.shade,/uvec3\(h2.xyz\)/);
 assert.ok(!shaders.shade.includes('cadState3'));
 assert.match(shaders.shade,/inverseTransformDirection\( normal, cadStagedViewMatrix \)/);
});

test('state records retain all exact medium, direction, hit identity, barycentric and diagnostic information',()=>{
 assert.match(shaders.seed,/float\(count\)\+dispersed/);
 assert.match(shaders.advance,/float\(count\)\+floor\(s0.w\/8\.\)\*8\./);
 assert.match(shaders.opaque,/vec3\(hit.vertices\),float\(hit.instanceId\)/);
 assert.match(shaders.opaque,/hit.bary,hit.distance/);
 assert.match(shaders.event,/cadOut1.w=1000\./);
 assert.match(shaders.advance,/cadOut1.w=4\./);
 assert.match(shaders.shade,/s1.w==4\.\?0\.:1\./);
 assert.match(shaders.advance,/if\(cadStagedIteration==cadStagedInterfaceLimit-1\)/);
 // GLES requires fragment output indexes to be compile-time constants. TIR
 // chooses the retained local stack before the post-step Beer interval.
 for(const [name,fragment]of Object.entries(shaders))assert.ok(!/cadOut\d\s*\[/.test(fragment),name);
 assert.match(shaders.advance,/vec4 acceptedStack=transmitted\?tentative:s3/);
 assert.match(shaders.advance,/current=count>0\?int\(acceptedStack\[count-1\]\):0/);
 assert.match(shaders.advance,/cadOut3=acceptedStack/);
});

test('native triangle seed and events include no analytic CSG, cubic surface or raw event search',()=>{
 const triangles=nativeStagedShaderSources(THREE,source,{boundaryMode:'triangles'});
 for(const name of['seed','event']){
  for(const forbidden of['cadNativeSolidContains','cadNativePolynomial','cadNativeCubic','cadNativeRawEvent','cadNativeWaterBelow','cadDuctContains'])assert.ok(!triangles[name].includes(forbidden),name+': '+forbidden);
  assert.match(triangles[name],/cadQueryGeometry/);
 }
 assert.match(triangles.seed,/dot\(hit.geometricNormal,direction\)>0\./);
 assert.match(triangles.event,/\.00025,1500\.,2,hit/);
 assert.match(triangles.event,/id=classTag-2/);
 assert.match(triangles.event,/entering=dot\(hit.geometricNormal,s1.xyz\)<0\./);
 assert.match(triangles.event,/hit.normal,float\(entering\?id:-id\)/);
 assert.equal(triangles.opaque,shaders.opaque);
 assert.equal(triangles.advance,shaders.advance);
 assert.equal(triangles.shade,shaders.shade);
});

test('opaque equality follows the exact native atlas strict upper-distance bound',()=>{
 const state=createNativeStagedInitialState({origin:[0,0,0],direction:[0,0,1]}),media=[{ior:1.52,sigma:[0,0,0]}];
 const optical={distance:2,point:[0,0,2],normal:[0,0,-1],id:1,entering:true};
 const result=advanceNativeStagedState({state,optical,opaque:{distance:2,point:[0,0,2]},media,paperRadiance:[1,1,1]});
 assert.equal(result.status,'active');assert.equal(result.opaqueHit,null);assert.deepEqual(result.stack,[1]);
});

async function stagedHostFixture({auditSamples=[],interfaceLimit=16}={}){
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-2,2,1,-1,.1,100);camera.position.z=10;scene.environment={mapping:THREE.CubeUVReflectionMapping,image:{width:768,height:256}};
 const waterMat=new THREE.MeshPhysicalMaterial({transmission:1,ior:1.33}),glassMat=new THREE.MeshPhysicalMaterial({transmission:1,ior:1.52,dispersion:.2});
 const water=new THREE.Mesh(new THREE.BoxGeometry(.7,.7,.7),waterMat),glass=new THREE.Mesh(new THREE.BoxGeometry(.7,.7,.7),glassMat);water.name='elements/water';glass.name='light/lens';water.position.x=-1;glass.position.x=1;scene.add(water,glass);
 const originalTarget={viewport:new THREE.Vector4(13,17,100,80),scissor:new THREE.Vector4(14,18,90,70),scissorTest:true},draws=[],clears=[],reads=[];
 const renderer={target:originalTarget,face:3,mip:2,viewport:new THREE.Vector4(1,2,3,4),scissor:new THREE.Vector4(5,6,7,8),scissorTest:true,actualViewport:originalTarget.viewport.clone(),actualScissor:originalTarget.scissor.clone(),actualScissorTest:true,
  shadowMap:{enabled:true,autoUpdate:true,needsUpdate:true},xr:{enabled:true},autoClear:true,clearColor:new THREE.Color(.2,.3,.4),clearAlpha:.6,
  getRenderTarget(){return this.target;},getActiveCubeFace(){return this.face;},getActiveMipmapLevel(){return this.mip;},getViewport(out){return out.copy(this.viewport);},setViewport(out){this.viewport.copy(out);this.actualViewport.copy(out).multiplyScalar(2);},getScissor(out){return out.copy(this.scissor);},setScissor(out){this.scissor.copy(out);this.actualScissor.copy(out).multiplyScalar(2);},getScissorTest(){return this.scissorTest;},setScissorTest(value){this.scissorTest=this.actualScissorTest=value;},getClearColor(out){return out.copy(this.clearColor);},getClearAlpha(){return this.clearAlpha;},setClearColor(color,alpha){this.clearColor.set(color);this.clearAlpha=alpha;},
  setRenderTarget(target,face=0,mip=0){this.target=target;this.face=face;this.mip=mip;this.actualViewport.copy(target?.viewport??this.viewport.clone().multiplyScalar(2));this.actualScissor.copy(target?.scissor??this.scissor.clone().multiplyScalar(2));this.actualScissorTest=target?.scissorTest??this.scissorTest;},
  readRenderTargetPixels(target,x,y,w,h,value,face,index){const channel=draws.at(-1).material.uniforms.cadStagedChannel.value;reads.push({target,x,y,channel,index});value.set([index,x,y,channel]);},
  clear(color,depth,stencil){clears.push({target:this.target,scissor:this.actualScissorTest,depth,alpha:this.clearAlpha});},
  render(drawScene){assert.equal(this.autoClear,false);assert.equal(this.shadowMap.enabled,false);assert.equal(this.xr.enabled,false);draws.push({target:this.target,region:this.actualScissor.toArray(),scissor:this.actualScissorTest,material:drawScene.children[0].material});if(this.fail)throw Error('Injected staged draw failure');}
 };
 const nativeTransport={bindShader(shader){shader.fragmentShader=source;Object.assign(shader.uniforms,{cadPbrKeyColor:{value:new THREE.Color(1,1,1)},cadPbrFillColor:{value:new THREE.Color(.2,.2,.2)}});},snapshot(){return{geometry:{vertices:100,opticalTriangles:24},limitations:[]};}};
 const transport=await setupNativeStagedTransport({THREE,renderer,scene,objects:[water,glass],camera,fullSize:new THREE.Vector2(200,100),nativeTransport,boundaryMode:'triangles',auditSamples,interfaceLimit});
 const restored=()=>{assert.equal(renderer.target,originalTarget);assert.equal(renderer.face,3);assert.equal(renderer.mip,2);assert.deepEqual(renderer.viewport.toArray(),[1,2,3,4]);assert.deepEqual(renderer.scissor.toArray(),[5,6,7,8]);assert.deepEqual(renderer.actualViewport.toArray(),[13,17,100,80]);assert.deepEqual(renderer.actualScissor.toArray(),[14,18,90,70]);assert.equal(renderer.actualScissorTest,true);assert.equal(renderer.scissorTest,true);assert.equal(renderer.autoClear,true);assert.equal(renderer.xr.enabled,true);assert.deepEqual(renderer.clearColor.toArray(),[.2,.3,.4]);assert.equal(renderer.clearAlpha,.6);assert.deepEqual(renderer.shadowMap,{enabled:true,autoUpdate:true,needsUpdate:true});};
 return{transport,renderer,water,glass,draws,clears,reads,restored};
}

test('staged crop retains target pixel coordinates, all four hit bands, seed occlusion and complete result clears',async()=>{
 const h=await stagedHostFixture();h.transport.render();h.restored();const snapshot=h.transport.snapshot();assert.deepEqual(snapshot.targetSize,[100,50]);assert.ok(snapshot.channelFractions[0]<.8);assert.ok(snapshot.channelFractions[1]<.3);assert.deepEqual(snapshot.channelRegions[1],snapshot.channelRegions[2]);assert.equal(snapshot.skippedChannels,0);assert.ok(snapshot.lastWorkPixels<snapshot.fullViewportWorkPixels/2);
 assert.ok(h.draws.every(draw=>draw.scissor));const packed=h.draws.filter(draw=>draw.target.height===200);assert.equal(packed.length,12);for(let channel=0;channel<3;channel++)for(let slot=0;slot<4;slot++){const region=snapshot.channelRegions[channel];assert.deepEqual(packed[channel*4+slot].region,[region[0],region[1]+slot*50,region[2],region[3]]);}
 // Non-dispersive front optics continue to write seed depth in split channels.
 const seeds=h.draws.filter(draw=>draw.material.vertexShader.includes('cadStagedWorldPosition'));assert.equal(seeds.length,3);assert.equal(h.clears.length,4);assert.ok(h.clears.every(clear=>!clear.scissor));assert.equal(h.clears[0].depth,false);assert.equal(h.transport.render().cached,true);h.restored();h.transport.dispose();
});

test('offscreen dispersive geometry skips two channels; an empty optical pose clears the old cache and submits no stages',async()=>{
 const h=await stagedHostFixture();h.glass.position.x=10;h.transport.render();h.restored();assert.equal(h.transport.snapshot().skippedChannels,2);assert.ok(h.transport.snapshot().channelFractions[0]>0);assert.deepEqual(h.transport.snapshot().channelRegions.slice(1),[[0,0,0,0],[0,0,0,0]]);
 h.water.position.x=-10;const previous=h.draws.length,clears=h.clears.length;assert.deepEqual(h.transport.render(),{calls:0,triangles:0,cached:false});h.restored();assert.equal(h.draws.length,previous);assert.equal(h.clears.length,clears+1);assert.equal(h.clears.at(-1).scissor,false);assert.equal(h.transport.snapshot().skippedChannels,3);h.transport.dispose();
});

test('a cropped staged failure restores the previous target, face, mip, physical viewport and external renderer state',async()=>{
 const h=await stagedHostFixture();h.renderer.fail=true;assert.throws(()=>h.transport.render(),/Injected staged draw failure/);h.restored();assert.equal(h.transport.snapshot().renderCount,0);h.renderer.fail=false;h.transport.render();h.restored();assert.equal(h.transport.snapshot().renderCount,1);h.transport.dispose();
});


test('opt-in audit reads exact Float32 channel-zero state before dispersion overwrites and maps top-down display centers to GL pixels',async()=>{
 const h=await stagedHostFixture({auditSamples:[{x:100,y:50},{x:199,y:99}]});h.transport.render();h.restored();const receipt=h.transport.snapshot().auditSampleReceipt;assert.equal(receipt.length,2);assert.deepEqual(receipt[0].statePixelGL,[50,24]);assert.equal(receipt[0].insidePrimaryRegion,true);assert.deepEqual(receipt[0].originCount,[0,50,24,0]);assert.deepEqual(receipt[0].mediumStack,[3,50,24,0]);assert.deepEqual(receipt[0].opaquePointFound,[0,50,24,0]);assert.equal(receipt[1].insidePrimaryRegion,false);assert.equal(h.reads.length,5);assert.ok(h.reads.every(read=>read.channel===0));h.transport.dispose();
});


test('cached native refraction retains the stock IOR-scaled roughness response on a mipmapped linear HDR result',async()=>{
 const h=await stagedHostFixture(),shader={uniforms:{},fragmentShader:THREE.ShaderChunk.transmission_pars_fragment};assert.equal(h.transport.bindShader(shader,h.water.material),true);assert.match(shader.fragmentShader,/log2\(mapSize.x\)\*applyIorToRoughness\(roughness,ior\)/);assert.match(shader.fragmentShader,/textureBicubic\(cadStagedOutputMap,uv,lod\)/);assert.match(shader.fragmentShader,/maximumLevel<1\./);h.transport.render();const output=h.draws.at(-1).target;assert.equal(output.texture.generateMipmaps,true);assert.equal(output.texture.minFilter,THREE.LinearMipmapLinearFilter);assert.equal(output.texture.colorSpace,THREE.LinearSRGBColorSpace);assert.equal(h.clears[0].alpha,0);assert.equal(h.draws.at(-1).material.blendEquationAlpha,THREE.MaxEquation);assert.match(shader.fragmentShader,/filtered.rgb\/max\(filtered.a,1.e-8\),1./);h.restored();h.transport.dispose();
});


test('an explicit32-interface native candidate runs the extra exact stages while its default retains16',async()=>{
 const normal=await stagedHostFixture(),extended=await stagedHostFixture({interfaceLimit:32});const a=normal.transport.render(),b=extended.transport.render();normal.restored();extended.restored();assert.equal(normal.transport.snapshot().interfaceLimit,16);assert.equal(extended.transport.snapshot().interfaceLimit,32);assert.equal(b.calls-a.calls,16*3*3);assert.equal(extended.draws.at(-1).material.uniforms.cadStagedInterfaceLimit.value,32);normal.transport.dispose();extended.transport.dispose();
});

test('the CPU32-interface reference follows30 exact TIR boundaries then accepts real opaque geometry;16 remains black at its stated budget',()=>{
 const media=[{ior:1.52,sigma:[0,0,0]}],initial=()=>createNativeStagedInitialState({origin:[0,0,0],direction:[.8,0,.6],stack:[1]});let normal=initial(),extended=initial();const event=state=>({distance:2,point:state.origin.map((v,i)=>v+state.direction[i]*2),normal:[0,0,Math.sign(state.direction[2])],id:1,entering:false});
 for(let i=0;i<30;i++){normal=advanceNativeStagedState({state:normal,optical:event(normal),media,paperRadiance:[1,1,1]});extended=advanceNativeStagedState({state:extended,optical:event(extended),media,paperRadiance:[1,1,1],maxInterfaces:32});}
 assert.equal(normal.status,'exhausted');assert.equal(normal.interfaceCount,16);assert.deepEqual(normal.radiance,[0,0,0]);assert.equal(extended.status,'active');assert.equal(extended.interfaceCount,30);assert.deepEqual(extended.stack,[1]);assert.deepEqual(extended.weight,[1,1,1]);const opaque={distance:1.25,point:extended.origin.map((v,i)=>v+extended.direction[i]*1.25)};extended=advanceNativeStagedState({state:extended,opaque,media,paperRadiance:[1,1,1],maxInterfaces:32});assert.equal(extended.status,'opaque');assert.equal(extended.opaqueHit,opaque);assert.deepEqual(extended.weight,[1,1,1]);
});


test('stage sampler metadata reports actual linked uniform names and array texture-unit counts',async()=>{
 const h=await stagedHostFixture();h.renderer.info={programs:[]};const gl={LINK_STATUS:0x8b82,ACTIVE_UNIFORMS:0x8b86,SAMPLER_2D:0x8b5e,SAMPLER_2D_ARRAY:0x8dc1,isContextLost:()=>false,getProgramParameter:(program,kind)=>kind===0x8b82?true:3,getActiveUniform:(program,index)=>[{name:'stateMap',type:0x8b5e,size:1},{name:'layerMaps[0]',type:0x8dc1,size:2},{name:'matrix',type:0x8b5c,size:1}][index]};h.renderer.getContext=()=>gl;h.renderer.compileAsync=async()=>h.renderer.info.programs.push({id:h.renderer.info.programs.length+1,program:{}});assert.equal(await h.transport.compileCaptureAsync(),true);h.restored();const snapshot=h.transport.snapshot();assert.equal(snapshot.activeSamplerInventory.length,7);assert.equal(snapshot.textureSamplers.event,3);assert.deepEqual(snapshot.activeSamplerInventory.find(program=>program.stage==='event').samplers.map(uniform=>uniform.name),['stateMap','layerMaps[0]']);assert.equal(snapshot.compiled,true);h.transport.dispose();
});
