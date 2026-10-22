import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {createElementsShader,fitElementsVolume,ELEMENTS_LIMITS,ELEMENTS_BOUNDS,ELEMENTS_TRANSPORT_DIAGNOSTICS,ELEMENTS_BACKDROP_DIAGNOSTICS,elementsVertexShader,elementsFragmentShader} from './direction11-elements-shader.mjs';
import {validateElementsVolumeManifest} from './elements-volume-data.mjs';

test('four elements use one bounded mesh, material, and program with no texture inputs',()=>{
 const event=createElementsShader(),meshes=[];event.root.traverse(o=>{if(o.isMesh)meshes.push(o);});
 assert.equal(meshes.length,1);const mesh=meshes[0];assert.equal(mesh.material.isShaderMaterial,true);
 assert.equal(mesh.geometry.index.count/3,12);assert.equal(mesh.material.side,T.BackSide);
 assert.equal(mesh.material.depthWrite,false);assert.equal(mesh.material.transparent,true);
 assert.equal(mesh.material.premultipliedAlpha,true);assert.equal(mesh.material.toneMapped,false);
 assert.equal(mesh.castShadow,false);assert.equal(event.metadata.textureInputs,0);
 assert.deepEqual(event.metadata.elements,['earth','water','fire','air']);
 mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;
 for(let i=0;i<3;i++){assert.ok(Math.abs(b.min.getComponent(i)-ELEMENTS_BOUNDS.min[i])<1e-6);assert.ok(Math.abs(b.max.getComponent(i)-ELEMENTS_BOUNDS.max[i])<1e-6);}
 assert.deepEqual([...elementsFragmentShader.matchAll(/uniform sampler2D (\w+)/g)].map(m=>m[1]),['uStudioEnvironment','uBackdropColor','uBackdropDepth']);
 assert.equal((elementsFragmentShader.match(/uniform sampler3D/g)||[]).length,3);event.dispose();
});

function decodedFixture(kind){
 const water=kind==='water',channels=water?['signedDistance']:['emission.r','emission.g','emission.b','extinction'];
 const manifest={format:water?'cybr-water-sdf-volume':'cybr-fire-volume',version:1,dimensions:[2,2,2],encoding:{type:'float16',endianness:'little',channels,colorSpace:'linear',order:'zyxc',compression:'gzip'},domain:{minimum:[-3,0,-3],extent:[6,6,6]},sampling:{origin:[-1.5,1.5,-3],spacing:[3,3,6]},source:{kind:'test-only'},payload:{bytes:8*channels.length*2,sha256:'0'.repeat(64)}};
 if(water)manifest.coordinates={units:'mm',upAxis:'z',handedness:'right'};
 const descriptor=validateElementsVolumeManifest(manifest);
 return {...descriptor,data:new Uint16Array(8*channels.length).fill(water?0xbc00:0x3c00),sha256:manifest.payload.sha256,nonzeroComponents:8*channels.length};
}

test('source volumes fit by rigid uniform transforms and preserve optical units',()=>{
 const event=createElementsShader(),material=event.root.children[0].material,u=material.uniforms,version=material.version;
 const fire=decodedFixture('fire'),water=decodedFixture('water');
 const fireTexture=event.setSourceFireVolume(fire),waterTexture=event.setSourceWaterVolume(water);
 assert.equal(fireTexture.isData3DTexture,true);assert.equal(waterTexture.isData3DTexture,true);assert.equal(material.version,version+2,'first source bindings specialize the existing one material');
 assert.deepEqual(material.defines,{ELEMENTS_HAS_NATIVE_FIRE:1,ELEMENTS_HAS_NATIVE_WATER:1,ELEMENTS_OPTIMIZED_VOLUME:1,ELEMENTS_ROOM_REFLECTIONS:0});
 event.update(.3,{time:8});assert.equal(material.version,version+2,'animation must not recompile native programs');
 assert.equal(event.metadata.textureInputs,2);assert.equal(event.metadata.sources.fire.liveSimulation,false);assert.equal(event.metadata.sources.water.status,'source snapshot loaded');
 for(const volume of [fire,water]){
  const fit=fitElementsVolume(volume),s=new T.Vector3();fit.matrix.decompose(new T.Vector3(),new T.Quaternion(),s);
  assert.ok(Math.abs(s.x-s.y)<1e-12&&Math.abs(s.y-s.z)<1e-12);
  const box=new T.Box3(new T.Vector3(...volume.domain.minimum),new T.Vector3(...volume.domain.minimum).add(new T.Vector3(...volume.domain.extent))).applyMatrix4(fit.matrix);
  assert.ok(box.min.y>=.014-1e-9);assert.ok(box.max.y<=4.414+1e-9);
  assert.ok(Math.hypot(Math.max(Math.abs(box.min.x),Math.abs(box.max.x)),Math.max(Math.abs(box.min.z),Math.abs(box.max.z)))<=1.46+1e-9);
 }
 const fit=fitElementsVolume(fire),nativeDistance=.4,localDistance=nativeDistance*fit.scale;
 assert.ok(Math.abs(u.uFireMetric.value*localDistance-nativeDistance)<1e-12);
 assert.ok(Math.abs(u.uWaterMetric.value-fitElementsVolume(water).scale)<1e-12);
 const transformedUp=new T.Vector3(0,0,1).transformDirection(fitElementsVolume(water).matrix);assert.ok(transformedUp.distanceTo(new T.Vector3(0,1,0))<1e-12);
 let disposed=0;fireTexture.addEventListener('dispose',()=>disposed++);waterTexture.addEventListener('dispose',()=>disposed++);event.dispose();assert.equal(disposed,2);
});

test('native source presence removes procedural definitions and replacing snapshots does not recompile',()=>{
 const event=createElementsShader(),material=event.root.children[0].material;
 assert.deepEqual(material.defines,{ELEMENTS_HAS_NATIVE_FIRE:0,ELEMENTS_HAS_NATIVE_WATER:0,ELEMENTS_OPTIMIZED_VOLUME:1,ELEMENTS_ROOM_REFLECTIONS:0});
 assert.match(elementsFragmentShader,/#if ELEMENTS_HAS_NATIVE_WATER == 1/);assert.match(elementsFragmentShader,/#if ELEMENTS_HAS_NATIVE_FIRE == 1/);
 event.setSourceFireVolume(decodedFixture('fire'));const afterBinding=material.version;
 event.setSourceFireVolume(decodedFixture('fire'));event.update(.8,{time:55});assert.equal(material.version,afterBinding);
 event.dispose();
});

test('source transmission samples fields, never an opaque image or substituted fake fire',()=>{
 assert.match(elementsFragmentShader,/textureLod\(uFireVolume/);assert.match(elementsFragmentShader,/textureLod\(uWaterVolume/);
 assert.match(elementsFragmentShader,/alpha\/volume\.a:stride/);assert.match(elementsFragmentShader,/fireStride/);
 assert.match(elementsFragmentShader,/distance=max\(outside,distance-outside\)/,'water volume bounds must not become a visible glass box');
 const event=createElementsShader();assert.match(event.metadata.sources.fire.status,/missing/);
 assert.throws(()=>event.setSourceFireVolume({...decodedFixture('fire'),nonzeroComponents:0}),/no optical signal/);
 assert.throws(()=>event.setSourceWaterVolume(decodedFixture('fire')),/Expected decoded water/);event.dispose();
});

test('transport has a fixed primary budget with no recursive trace or extra target',()=>{
 assert.equal(ELEMENTS_LIMITS.primarySteps,96);assert.equal(ELEMENTS_LIMITS.nativeWaterCells,96);
 assert.equal(ELEMENTS_LIMITS.volumeSamplesPerInterval,64);
 assert.equal(ELEMENTS_LIMITS.waterBodies,4);assert.equal(ELEMENTS_LIMITS.waterTirBounces,4);assert.equal(ELEMENTS_LIMITS.waterRootRefinements,9);
 assert.deepEqual([...elementsFragmentShader.matchAll(/for\s*\(([^)]*)\)/g)].map(m=>m[1]),[
  'int k=0;k<3;k++',
  'int intervalIndex=0;intervalIndex<3;intervalIndex++',
  'int refine=0;refine<9;refine++',
  'int cellIndex=0;cellIndex<96;cellIndex++',
  'int guardIndex=0;guardIndex<4;guardIndex++',
  'int boundaryIndex=0;boundaryIndex<5;boundaryIndex++',
  'int reflectionReceiver=0;reflectionReceiver<8;reflectionReceiver++',
  'int receiverIndex=0;receiverIndex<8;receiverIndex++',
  'int volumeIndex=0;volumeIndex<64;volumeIndex++',
  'int stepIndex=0;stepIndex<96;stepIndex++',
  'int reflectionBody=0;reflectionBody<4;reflectionBody++',
 ]);
 assert.match(elementsFragmentShader,/nativeWaterBoundary\(ro,direction,true,96-result\.cells,20\.0\)/,'internal boundaries share one per-body cell budget');
 assert.match(elementsFragmentShader,/waterBodies>=4/);assert.doesNotMatch(elementsFragmentShader,/sourceWaterExit|waterStep<48/);
 assert.match(elementsFragmentShader,/stride=min\(stride,segmentLength-cursor\)/);assert.match(elementsFragmentShader,/gl_FragDepth=/);
 assert.match(elementsFragmentShader,/gl_FragColor=vec4\(color,opacity\)/);assert.doesNotMatch(elementsFragmentShader,/while\s*\(/);
 assert.doesNotMatch(elementsFragmentShader,/<tonemapping_fragment>|<colorspace_fragment>|color\/max\(opacity/);
 assert.match(elementsFragmentShader,/opacity<\.002&&max/,'emission survives a zero-extinction ray');
 assert.match(elementsFragmentShader,/path\.pathLength\/max\(uWaterMetric/,'source thickness is converted back to native physical units');
});

test('stage environment uses the same CubeUV radiance and does not own shared resources',()=>{
 const event=createElementsShader(),mesh=event.root.children[0],u=mesh.material.uniforms;
 const environment=new T.Texture({width:768,height:1024});environment.mapping=T.CubeUVReflectionMapping;
 let disposals=0;environment.addEventListener('dispose',()=>disposals++);
 const rotation=new T.Euler(.2,-.4,.1,'ZYX'),version=mesh.material.version;
 event.setEnvironment(environment,{intensity:.85,rotation});
 assert.equal(u.uStudioEnvironment.value,environment);assert.equal(u.uHasStudioEnvironment.value,1);
 assert.equal(u.uStudioEnvironmentIntensity.value,.85);assert.equal(u.uStudioEnvironmentMaxMip.value,8);
 assert.deepEqual(u.uStudioEnvironmentTexel.value.toArray(),[1/768,1/1024]);
 const expected=new T.Matrix3().setFromMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(-.2,.4,-.1,'ZYX')));
 assert.deepEqual(u.uStudioEnvironmentRotation.value.elements,expected.elements);
 assert.equal(mesh.material.version,version,'lighting updates must not recompile');
 assert.throws(()=>event.setEnvironment(new T.Texture()),/CubeUV/);
 assert.throws(()=>event.setEnvironment(environment,{intensity:-1}),/nonnegative/);
 event.setEnvironment(null);assert.equal(u.uHasStudioEnvironment.value,0);event.dispose();assert.equal(disposals,0);
 assert.match(elementsFragmentShader,/normalize\(mat3\(uLocalToWorld\)\*d\)/);
 assert.match(elementsFragmentShader,/bilinearCubeUV\(uStudioEnvironment,environmentDirection,uStudioEnvironmentMaxMip\)\*uStudioEnvironmentIntensity/);
});

test('room probe uses captured world position, render-target cube orientation, and external ownership',()=>{
 const event=createElementsShader(),material=event.root.children[0].material,u=material.uniforms;
 const cube=new T.WebGLCubeRenderTarget(512,{type:T.HalfFloatType,format:T.RGBAFormat});
 const position=new T.Vector3(1,-1.5,2),version=material.version;let disposed=0;
 cube.texture.addEventListener('dispose',()=>disposed++);
 event.setRoomProbe({texture:cube.texture,position,valid:false});assert.equal(u.uHasRoomProbe.value,0);
 event.setRoomProbe({texture:cube.texture,position,valid:true});assert.equal(u.uHasRoomProbe.value,1);
 assert.equal(u.uRoomProbe.value,cube.texture);assert.deepEqual(u.uRoomProbePosition.value.toArray(),[1,-1.5,2]);
 position.x=100;assert.equal(u.uRoomProbePosition.value.x,1,'probe lookup must retain the captured origin, not a later live position');
 assert.equal(material.version,version);assert.equal(event.metadata.stageTransport.roomProbe,true);
 assert.throws(()=>event.setRoomProbe({texture:new T.CubeTexture(),position:[0,0,0]}),/render-target/);
 assert.throws(()=>event.setRoomProbe({texture:cube.texture,position:[0,NaN,0]}),/captured world/);
 event.setRoomProbe(null);assert.equal(u.uHasRoomProbe.value,0);event.dispose();assert.equal(disposed,0);
 assert.match(elementsFragmentShader,/vec3 direction=receiverHit-uRoomProbePosition/);
 assert.match(elementsFragmentShader,/textureLod\(uRoomProbe,normalize\(direction\),0\.0\)/);
 assert.match(elementsFragmentShader,/captured\.rgb\+\(1\.0-clamp\(captured\.a,0\.0,1\.0\)\)\*studio\(localDirection\)/);
 cube.dispose();
});

test('backdrop derives visible actual box bounds and honors captured camera and validity',()=>{
 const event=createElementsShader(),mesh=event.root.children[0],u=mesh.material.uniforms;
 const stage=new T.Group(),floor=new T.Mesh(new T.BoxGeometry(70,.35,60),new T.MeshBasicMaterial());
 floor.position.set(0,-3.525,12);floor.rotation.y=.14;floor.scale.set(1,.8,1.3);stage.add(floor);
 const hidden=new T.Group();hidden.visible=false;hidden.add(new T.Mesh(new T.BoxGeometry(1,1,1)));stage.add(hidden);
 stage.updateMatrixWorld(true);
 const camera=new T.PerspectiveCamera(39,1.5,.1,100);camera.position.set(0,2,12);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const color=new T.Texture({width:1059,height:930}),depth=new T.DepthTexture(1059,930);
 let valid=false,disposed=0;color.addEventListener('dispose',()=>disposed++);depth.addEventListener('dispose',()=>disposed++);
 event.setBackdrop({texture:color,depthTexture:depth,camera,receivers:stage,isValid:()=>valid});
 mesh.onBeforeRender(null,null,camera);assert.equal(u.uHasBackdrop.value,0);
 valid=true;mesh.onBeforeRender(null,null,camera);assert.equal(u.uHasBackdrop.value,1);assert.equal(u.uBackdropBoxCount.value,1);
 assert.deepEqual(u.uBackdropBoxInverse.value[0].elements,floor.matrixWorld.clone().invert().elements);
 assert.deepEqual(u.uBackdropBoxMinimum.value[0].toArray(),floor.geometry.boundingBox.min.toArray());
 assert.deepEqual(u.uBackdropBoxMaximum.value[0].toArray(),floor.geometry.boundingBox.max.toArray());
 assert.deepEqual(u.uBackdropWorldToClip.value.elements,camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).elements);
 const composed=u.uBackdropWorldToClip.value.clone().multiply(u.uBackdropClipToWorld.value);
 composed.elements.forEach((value,index)=>assert.ok(Math.abs(value-(index%5===0?1:0))<1e-10));
 assert.equal(u.uBackdropPixelSpan.value,2/(camera.projectionMatrix.elements[5]*930));
 assert.equal(event.metadata.stageTransport.visibleReceiverBoxes,1);
 mesh.onBeforeRender(null,null,camera.clone());assert.equal(u.uHasBackdrop.value,0,'another camera cannot sample mismatched cached depth');
 for(let index=0;index<8;index++)stage.add(new T.Mesh(new T.BoxGeometry(1,1,1)));
 stage.updateMatrixWorld(true);mesh.onBeforeRender(null,null,camera);assert.equal(u.uHasBackdrop.value,0,'overflow must not silently omit opaque receivers');
 event.setBackdrop(null);assert.equal(event.metadata.stageTransport.backdropBound,false);event.dispose();assert.equal(disposed,0);
 assert.match(elementsFragmentShader,/if\(receiverIndex>=uBackdropBoxCount\)break/);
 assert.match(elementsFragmentShader,/transpose\(mat3\(uBackdropBoxInverse\[receiver\]\)\)\*boxNormal/,'depth validation must handle actual nonuniformly scaled face normals');
});

test('terminal refraction resolves the opaque backdrop in linear HDR without fake water opacity',()=>{
 assert.match(elementsFragmentShader,/if\(transmittedWater&&opacity<\.985&&t>=end\)/);
 assert.match(elementsFragmentShader,/color\+=\(1\.0-opacity\)\*terminalBackdrop\(ro,rd,backdropDiagnostic\);opacity=1\.0/);
 assert.doesNotMatch(elementsFragmentShader,/contactAlpha/,'detached analytic opacity cannot pretend to be a source cast shadow');
 for(const opacity of [.02,.2,.9]){
  const foreground=.32,backdrop=1.4,expected=foreground+(1-opacity)*backdrop;
  const resolved=foreground+(1-opacity)*backdrop,finalAlpha=1;
  assert.equal(resolved+(1-finalAlpha)*9,expected,'same-pixel background cannot be blended in again');
 }
});

test('backdrop diagnostics preserve transport and distinguish terminal fallback causes',()=>{
 const event=createElementsShader(),material=event.root.children[0].material,version=material.version;
 event.setDebugMode('backdrop');assert.equal(material.uniforms.uDebugMode.value,8);assert.equal(material.version,version);
 assert.deepEqual(ELEMENTS_BACKDROP_DIAGNOSTICS.map(({status,color})=>[status,color]),[[1,'green'],[2,'red'],[3,'blue'],[4,'magenta'],[5,'yellow']]);
 assert.equal(event.metadata.backdropDiagnostics,ELEMENTS_BACKDROP_DIAGNOSTICS);
 assert.match(elementsFragmentShader,/status=2;if\(nearest>1e19\)/);
 assert.match(elementsFragmentShader,/status=3;if\(clip\.w<=0\.0\)/);
 assert.match(elementsFragmentShader,/status=4;float depth=textureLod\(uBackdropDepth,depthUV,0\.0\)/);
 assert.match(elementsFragmentShader,/status=1;return textureLod\(uBackdropColor,uv,0\.0\)\.rgb/);
 assert.match(elementsFragmentShader,/if\(elementMode\(\)==8&&backdropDiagnostic>0\)\{color=backdropDiagnosticColor\(backdropDiagnostic\);opacity=1\.0;\}/);
 event.dispose();
});

test('native integration preserves bounded TIR energy and does not consume bodies for missed entries',()=>{
 assert.match(elementsFragmentShader,/traceNativeWaterTransport\(p,rd,t\)/,'entry refinement cannot rewind before the current ray origin');
 assert.match(elementsFragmentShader,/if\(validEntry\)waterBodies\+\+/);
 assert.match(elementsFragmentShader,/transportDiagnostic=max\(transportDiagnostic,waterDiagnosticSeverity\(path\.status\)\)/);
 assert.match(elementsFragmentShader,/float reflection=validEntry\?path\.entryFresnel:0\.0/);
 assert.match(elementsFragmentShader,/float throughput=\(1\.0-reflection\)\*\(1\.0-absorption\)\*\(transmitted\?1\.0-path\.exitFresnel:1\.0\)/);
 for(const reflected of [0,.02,.7,1])for(const absorbed of [0,.1,.8,1])for(const escaped of [false,true]){
  const exitFresnel=.12,transmitted=(1-reflected)*(1-absorbed)*(escaped?1-exitFresnel:1);
  const retained=reflected+(1-reflected)*absorbed+transmitted;
  assert.ok(retained<=1+1e-12,'known absorption must attenuate unresolved throughput too');
 }
 const event=createElementsShader();assert.match(event.metadata.waterTransport,/internal total-internal-reflection/);
 assert.match(event.metadata.waterTransport,/Non-TIR exit reflection tails use a shared-room\/environment closure/);
 assert.doesNotMatch(event.metadata.waterTransport,/48 exit samples|unfinished exits reflect/);event.dispose();
});

test('nearest cached depth is reconstructed on its sampled texel-center ray',()=>{
 const camera=new T.PerspectiveCamera(39,1059/930,.1,200);camera.position.set(0,.6,12);camera.lookAt(0,-1.3,0);camera.updateMatrixWorld(true);
 const worldToClip=camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse),clipToWorld=worldToClip.clone().invert();
 const floor=new T.Plane(new T.Vector3(0,1,0),3.35),ray=new T.Ray(),centerRay=new T.Vector3(),sampled=new T.Vector3();
 let wrongMaximum=0,correctMaximum=0;
 for(let i=0;i<100;i++){
  const hit=new T.Vector3(-2.7+i*.054,-3.35,-7+i*.083),ndc=hit.clone().applyMatrix4(worldToClip);
  const u=(Math.min(1058,Math.max(0,Math.floor((ndc.x*.5+.5)*1059)))+.5)/1059;
  const v=(Math.min(929,Math.max(0,Math.floor((ndc.y*.5+.5)*930)))+.5)/930;
  centerRay.set(u*2-1,v*2-1,0).applyMatrix4(clipToWorld).sub(camera.position).normalize();
  ray.set(camera.position,centerRay);assert.ok(ray.intersectPlane(floor,sampled));
  const sampledDepth=sampled.clone().applyMatrix4(worldToClip).z;
  const wrong=new T.Vector3(ndc.x,ndc.y,sampledDepth).applyMatrix4(clipToWorld);
  const correct=new T.Vector3(u*2-1,v*2-1,sampledDepth).applyMatrix4(clipToWorld);
  wrongMaximum=Math.max(wrongMaximum,Math.abs(floor.distanceToPoint(wrong)));
  correctMaximum=Math.max(correctMaximum,Math.abs(floor.distanceToPoint(correct)));
 }
 assert.ok(wrongMaximum>.003,'unsnapped reconstruction reproduces real false plane mismatches');
 assert.ok(correctMaximum<1e-10,'texel-center depth reconstructs its actual plane without inflating tolerance');
 assert.match(elementsFragmentShader,/dot\(clipPlane\.xy,depthUV\*2\.0-1\.0\)/);
});

test('resolved MSAA depth validates against the exact planar raster footprint',()=>{
 const camera=new T.PerspectiveCamera(39,1059/930,.1,200);camera.position.set(0,.6,12);camera.lookAt(0,-1.3,0);camera.updateMatrixWorld(true);
 const clipToWorld=camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).invert();
 const plane=new T.Vector4(0,1,0,3.35).applyMatrix4(clipToWorld.clone().transpose());
 const samples=[[.375,.125],[.875,.375],[.125,.625],[.625,.875]],width=1059,height=930;
 const depthAt=(x,y)=>-(plane.x*x+plane.y*y+plane.w)/plane.z;
 const radius=Math.abs(plane.x/plane.z)/width+Math.abs(plane.y/plane.z)/height;
 let offCenterSamples=0;
 for(const pixel of [[420,120],[660,310],[900,210]]){
  const centerX=(pixel[0]+.5)/width*2-1,centerY=(pixel[1]+.5)/height*2-1,centerDepth=depthAt(centerX,centerY);
  for(const sample of samples){
   const sampleDepth=depthAt((pixel[0]+sample[0])/width*2-1,(pixel[1]+sample[1])/height*2-1);
   const quantized=(Math.round((sampleDepth*.5+.5)*16777215)/16777215)*2-1;
   assert.ok(Math.abs(quantized-centerDepth)<=radius+2/16777215,'every legitimate resolved sample must fit the actual plane coverage interval');
   if(Math.abs(sampleDepth-centerDepth)>1e-7)offCenterSamples++;
  }
  assert.ok(Math.abs((centerDepth+radius+.001)-centerDepth)>radius+2/16777215,'different depth cannot pass merely because the floor is grazing');
 }
 assert.ok(offCenterSamples>0);
 assert.match(elementsFragmentShader,/vec4 clipPlane=transpose\(uBackdropClipToWorld\)\*vec4\(worldNormal,-dot\(worldNormal,hit\)\)/);
 assert.match(elementsFragmentShader,/float depthRadius=dot\(abs\(clipPlane\.xy\/clipPlane\.z\),uBackdropTexel\)/);
 assert.doesNotMatch(elementsFragmentShader,/footprint\*\.35|max\(\.003/);
});

test('divergent transport uses explicit LOD and conserves white-environment interface energy',()=>{
 assert.doesNotMatch(elementsFragmentShader,/\btexture\s*\(|\btexture2D\s*\(|\btexture2DGradEXT\s*\(/);
 assert.match(elementsFragmentShader,/float exitReflectionWeight=transmitted\?\(1\.0-reflection\)\*\(1\.0-absorption\)\*path\.exitFresnel:0\.0/);
 assert.match(elementsFragmentShader,/reflectionWeights\[reflectionCount\]=\(1\.0-opacity\)\*vec2\(reflection,exitReflectionWeight\)/);
 for(const entry of [0,.02,.4,.97])for(const exit of [0,.02,.65,.98]){
  const reflected=entry+(1-entry)*exit,transmitted=(1-entry)*(1-exit);
  assert.ok(Math.abs(reflected+transmitted-1)<1e-12);
  let color=0,beta=1;
  for(let body=0;body<4;body++){color+=beta*reflected;beta*=transmitted;}
  assert.ok(Math.abs(color+beta-1)<1e-12,'four near-critical white interfaces cannot erase radiance');
 }
});

test('water reflection branches share one bounded room-only traversal without screen reconstruction',()=>{
 const paired=elementsFragmentShader.slice(elementsFragmentShader.indexOf('vec3 waterRoomReflections('),elementsFragmentShader.indexOf('vec3 terminalBackdrop('));
 assert.equal([...paired.matchAll(/for\s*\(/g)].length,1);
 assert.match(paired,/for\(int reflectionReceiver=0;reflectionReceiver<8;reflectionReceiver\+\+\)/);
 assert.match(paired,/mat4 inverseBox=uBackdropBoxInverse\[reflectionReceiver\]/);
 assert.doesNotMatch(paired,/terminalBackdrop|uBackdropDepth|uBackdropWorldToClip|uBackdropClipToWorld|out int/);
 const main=elementsFragmentShader.slice(elementsFragmentShader.indexOf('void main()'));
 const transport=main.slice(main.indexOf('for(int stepIndex'),main.indexOf('// Receiver intersections'));
 assert.doesNotMatch(transport,/waterRoomReflections\(|terminalBackdrop\(/,'no room intersections may be nested in the 96-event loop');
 assert.equal([...main.matchAll(/waterRoomReflections\(/g)].length,1);
 assert.match(main,/for\(int reflectionBody=0;reflectionBody<4;reflectionBody\+\+\)/);
 assert.equal([...main.matchAll(/terminalBackdrop\(/g)].length,1,'screen-depth lookup runs only once at the final transmitted ray');
});

test('production compiles out deferred reflection arrays and uses only direction-local IBL inside transport',()=>{
 const production=createElementsShader(),experimental=createElementsShader({roomReflections:true});
 assert.equal(production.root.children[0].material.defines.ELEMENTS_ROOM_REFLECTIONS,0);
 assert.equal(experimental.root.children[0].material.defines.ELEMENTS_ROOM_REFLECTIONS,1);
 assert.equal(production.metadata.stageTransport.deferredRoomReflectionsEnabled,false);
 assert.equal(experimental.metadata.stageTransport.deferredRoomReflectionsValidated,false);
 assert.match(production.metadata.waterTransport,/direction-only cached local room IBL, without parallax/);
 assert.match(experimental.metadata.waterTransport,/EXPERIMENTAL/);
 const blocks=[...elementsFragmentShader.matchAll(/#if ELEMENTS_ROOM_REFLECTIONS == 1\n([\s\S]*?)#endif/g)];
 assert.equal(blocks.length,4,'function, record arrays, recording, and evaluation each need a compile-time gate');
 const compiled=elementsFragmentShader.replace(/#if ELEMENTS_ROOM_REFLECTIONS == 1\n([\s\S]*?)#endif/g,(_,body)=>body.includes('#else')?body.split('#else')[1]:'');
 assert.doesNotMatch(compiled,/waterRoomReflections|reflectionCount|reflectionEntryPoints|reflectionExitPoints|reflectionWeights\[|reflectionBody/);
 const fast=compiled.slice(compiled.indexOf('vec3 directionalRoomReflection('),compiled.indexOf('vec3 terminalBackdrop('));
 assert.doesNotMatch(fast,/for\s*\(|uBackdrop|rayBox|screenDepth/);
 assert.match(fast,/textureLod\(uRoomProbe,direction,0\.0\)/);
 assert.match(compiled,/directionalRoomReflection\(path\.exitReflectionDirection\)\*exitReflectionWeight/);
 production.dispose();experimental.dispose();
});

test('deferred room reflections preserve exact saved path weights through later absorption and occlusion',()=>{
 for(let trial=0;trial<160;trial++){
  const direct=[0,0,0],deferred=[0,0,0],records=[];let beta=1;
  for(let body=0;body<4;body++){
   const entryF=((trial*17+body*13)%97)/100,exitF=((trial*11+body*19)%97)/100;
   const absorption=((trial+body*7)%29)/100,escaped=(trial+body)%5!==0;
   const exitWeight=escaped?(1-entryF)*(1-absorption)*exitF:0;
   const entryRadiance=[.4+body*.2,1.1,.05+trial*.01],exitRadiance=[2.3,.12+body*.1,.7];
   const savedEntry=beta*entryF,savedExit=beta*exitWeight;
   for(let channel=0;channel<3;channel++){
    const absorbed=beta*(1-entryF)*absorption*[.04,.12,.13][channel];
    direct[channel]+=savedEntry*entryRadiance[channel]+savedExit*exitRadiance[channel]+absorbed;
    deferred[channel]+=absorbed;
   }
   records.push({savedEntry,savedExit,entryRadiance,exitRadiance});
   beta*=(1-entryF)*(1-absorption)*(escaped?1-exitF:1);
   // Intervening fire emission/extinction must not attenuate an earlier
   // interface's reflection again when that lookup is evaluated later.
   for(let channel=0;channel<3;channel++){const emitted=beta*(body+.1)*[.3,.08,.01][channel];direct[channel]+=emitted;deferred[channel]+=emitted;}
   beta*=.72;
  }
  // A later opaque stone may zero the remaining throughput; saved reflected
  // contributions still survive because their earlier weights were retained.
  if(trial%2===0)beta=0;
  for(const record of records)for(let channel=0;channel<3;channel++)deferred[channel]+=record.savedEntry*record.entryRadiance[channel]+record.savedExit*record.exitRadiance[channel];
  for(let channel=0;channel<3;channel++)assert.ok(Math.abs(direct[channel]-deferred[channel])<1e-12);
 }
 const main=elementsFragmentShader.slice(elementsFragmentShader.indexOf('void main()'));
 assert.ok(main.indexOf('reflectionWeights[reflectionCount]')<main.indexOf('opacity+=(1.0-opacity)*alpha'));
 assert.ok(main.indexOf('for(int reflectionBody')<main.indexOf('if(uDebugBudget>.5){\n  if(t<end'));
});

test('GPU transport diagnostics distinguish statuses and preserve the most severe cause',()=>{
 const expected=[
  [1,'yellow',[1]],
  [2,'blue',[]],
  [3,'orange',[]],
  [4,'cyan',[3]],
  [5,'magenta',[2]],
  [6,'red',[4,5]],
 ];
 assert.deepEqual(ELEMENTS_TRANSPORT_DIAGNOSTICS.map(item=>[item.severity,item.color,item.waterStatuses]),expected);
 for(const item of ELEMENTS_TRANSPORT_DIAGNOSTICS){
  const color=`vec3(${item.linearRGB.map(value=>Number.isInteger(value)?`${value}.0`:`${value}`).join(',')})`;
  assert.ok(elementsFragmentShader.includes(`if(severity==${item.severity})return ${color};`));
  if(item.waterStatuses.length)assert.ok(elementsFragmentShader.includes(`if(${item.waterStatuses.map(status=>`status==${status}`).join('||')})return ${item.severity};`));
 }
 assert.match(elementsFragmentShader,/if\(t<end&&opacity<\.985\)transportDiagnostic=max\(transportDiagnostic,2\)/);
 assert.match(elementsFragmentShader,/if\(volumeExhausted\)\{\s*if\(uDebugBudget>\.5\)transportDiagnostic=max\(transportDiagnostic,3\)/);
 assert.match(elementsFragmentShader,/color=transportDiagnosticColor\(transportDiagnostic\);opacity=1\.0/);
 assert.doesNotMatch(elementsFragmentShader,/waterExitFailure|color=mix\(color,vec3\(2\.0,0\.0,\.8\)/);
 const severity=status=>ELEMENTS_TRANSPORT_DIAGNOSTICS.find(item=>item.waterStatuses.includes(status))?.severity||0;
 for(const sequence of [[2,1],[1,2],[3,1],[4,2,1],[5,3,1]]){
  const observed=sequence.reduce((worst,status)=>Math.max(worst,severity(status)),0);
  assert.equal(observed,Math.max(...sequence.map(severity)));
 }
 const event=createElementsShader(),material=event.root.children[0].material,version=material.version;
 event.setDebugBudget(true);assert.equal(material.uniforms.uDebugBudget.value,1);assert.equal(material.version,version);
 assert.equal(event.metadata.transportDiagnostics.legend,ELEMENTS_TRANSPORT_DIAGNOSTICS);
 event.setDebugBudget(false);assert.equal(material.uniforms.uDebugBudget.value,0);event.dispose();
});

test('native volume quadrature cannot consume the surface-event allowance',()=>{
 const source=elementsFragmentShader.slice(elementsFragmentShader.indexOf('float integrateAtmosphereInterval'),elementsFragmentShader.indexOf('void main()'));
 assert.match(source,/for\(int volumeIndex=0;volumeIndex<64;volumeIndex\+\+\)/);
 assert.doesNotMatch(source,/earthDistance|waterDistance|traceNativeWaterTransport|stepIndex/);
 assert.match(source,/if\(occupied\)stride=min\(stride,fireStride\)/,'full native source stride is retained');
 assert.match(source,/cursor=min\(segmentLength,cursor\+stride\)/,'small samples accumulate in an interval-local coordinate');
 assert.match(source,/return cursor>=segmentLength\?finish:start\+cursor/,'completed intervals return the exact surface endpoint, not a rounded undershoot');
 assert.match(elementsFragmentShader,/t=integrateAtmosphereInterval\(ro,rd,t,min\(surfaceSafeEnd,end\)/,'quadrature never crosses a proven geometry-free interval');
 assert.doesNotMatch(elementsVertexShader,/integrateAtmosphere|volumeIndex/);
 // A refracted long-axis crossing can require >500 native samples. Those
 // samples fit within 96 bounded surface intervals without dropping a tail.
 const f=Math.fround,totalLength=f(2.9),nativeStep=f(.004924),sigma=.07,sourceRadiance=.8;
 let t=0,events=0,totalSamples=0,color=0,transmittance=1;
 for(;events<ELEMENTS_LIMITS.primarySteps&&t<totalLength;events++){
  const finish=f(Math.min(totalLength,f(t+ELEMENTS_LIMITS.maxStep))),length=f(finish-t);
  let cursor=0,count=0;
  for(;count<ELEMENTS_LIMITS.volumeSamplesPerInterval&&cursor<length;count++){
   const stride=f(Math.min(nativeStep,f(length-cursor))),alpha=-Math.expm1(-sigma*stride);
   color+=transmittance*sourceRadiance*alpha/sigma;transmittance*=1-alpha;
   cursor=f(Math.min(length,f(cursor+stride)));totalSamples++;
  }
  assert.equal(cursor,length,'current native spacing must complete each source interval');t=finish;
 }
 assert.equal(t,totalLength);assert.ok(totalSamples>500);assert.ok(events<25);
 assert.ok(Math.abs(color-sourceRadiance*(-Math.expm1(-sigma*totalLength))/sigma)<2e-6);
 assert.ok(Math.abs(transmittance-Math.exp(-sigma*totalLength))<2e-6);
 const event=createElementsShader();assert.equal(event.metadata.volumeQuadrature.sourceResolutionReduced,false);event.dispose();
});

test('native volume optimization preserves an internal full-sampling baseline',()=>{
 const optimized=createElementsShader(),baseline=createElementsShader({optimizedVolume:false});
 assert.equal(optimized.root.children[0].material.defines.ELEMENTS_OPTIMIZED_VOLUME,1);
 assert.equal(baseline.root.children[0].material.defines.ELEMENTS_OPTIMIZED_VOLUME,0);
 assert.equal(baseline.metadata.volumeQuadrature.optimized,false);
 assert.equal(optimized.metadata.volumeQuadrature.samplesPerInterval,baseline.metadata.volumeQuadrature.samplesPerInterval);
 assert.match(elementsFragmentShader,/if\(cursor>=occupancyEnd\)/,'occupancy is reused only until its next exact cell face');
 assert.match(elementsFragmentShader,/knownZeroFire=!occupied/);
 assert.match(elementsFragmentShader,/if\(!knownZeroFire\)/,'exact-zero macroblocks skip native texture reads, not low-intensity samples');
 assert.match(elementsFragmentShader,/vec3 source=\(uLocalToFire\*vec4\(p,1\.0\)\)\.xyz/,'prior native coordinate path remains available for comparison');
 const main=elementsFragmentShader.slice(elementsFragmentShader.indexOf('void main()'));
 const native=main.slice(main.indexOf('if(hasNativeWater())'),main.indexOf('// Both interfaces'));
 const helperAt=native.indexOf('traceNativeWaterTransport');
 assert.ok(helperAt>=0);assert.doesNotMatch(native.slice(0,helperAt),/surfaceNormal/,'native path must not fetch a discarded preview normal first');
 optimized.dispose();baseline.dispose();
});

test('air support culling is conservative for all authored widths and radii',()=>{
 const minimumCenter=.84,maximumHalfWidth=.093/.6,minimumRadius=minimumCenter-maximumHalfWidth;
 assert.ok(Math.abs(minimumRadius-.685)<1e-12);
 for(let i=0;i<128;i++){
  const radius=.68499*i/127;
  for(let direction=0;direction<32;direction++){
   const angle=2*Math.PI*direction/32,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
   const coordinateX=(x-minimumCenter)/.093,coordinateY=z/.35;
   assert.ok(1-(coordinateX*coordinateX+coordinateY*coordinateY)*.36<0);
  }
 }
 assert.match(elementsFragmentShader,/dot\(p\.xz,p\.xz\)<\.469225/);
});

test('camera uniforms use each actual draw camera and full mesh matrix, including reflection',()=>{
 const event=createElementsShader(),mesh=event.root.children[0],u=mesh.material.uniforms;
 event.root.position.set(3,-3.3,1);event.root.rotation.y=.4;event.root.scale.setScalar(1.2);event.root.updateMatrixWorld(true);
 for(const camera of [new T.PerspectiveCamera(39,1,.4,200),new T.OrthographicCamera(-4,4,4,-4,.1,100)]){
  camera.position.set(1,7,11);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);camera.updateProjectionMatrix();
  mesh.onBeforeRender(null,null,camera);
  const inv=mesh.matrixWorld.clone().invert(),expected=camera.position.clone().applyMatrix4(inv);
  assert.ok(u.uCameraLocal.value.distanceTo(expected)<1e-10);assert.equal(u.uOrthographic.value,camera.isOrthographicCamera?1:0);
  const clip=camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).multiply(mesh.matrixWorld);
  assert.deepEqual(u.uLocalToClip.value.elements,clip.elements);
  const trace=event.metadata.traceView;
  assert.deepEqual(trace.localToClip,clip.elements);assert.deepEqual(trace.cameraLocal,expected.toArray());
  assert.deepEqual(trace.localToWater,u.uLocalToWater.value.elements);assert.deepEqual(trace.waterTextureScale,u.uWaterTextureScale.value.toArray());
  assert.deepEqual(trace.waterTextureOffset,u.uWaterTextureOffset.value.toArray());assert.deepEqual(trace.viewDirection,u.uViewDirection.value.toArray());
  assert.equal(trace.voxelSize,u.uWaterVoxelSize.value);assert.equal(trace.metric,u.uWaterMetric.value);assert.equal(trace.orthographic,camera.isOrthographicCamera?1:0);
  trace.cameraLocal[0]=999;assert.notEqual(event.metadata.traceView.cameraLocal[0],999,'diagnostic arrays cannot mutate live uniforms');
  const reflected=camera.clone();reflected.position.y=-10;reflected.lookAt(0,1,0);reflected.updateMatrixWorld(true);
  mesh.onBeforeRender(null,null,reflected);assert.ok(u.uCameraLocal.value.distanceTo(reflected.position.clone().applyMatrix4(inv))<1e-10);
 }
 event.dispose();
});

test('scroll input is deterministic, optional animation time finite and resources dispose once',()=>{
 const event=createElementsShader(),mesh=event.root.children[0],u=mesh.material.uniforms;
 event.update(.4);assert.equal(u.uProgress.value,.4);assert.equal(u.uTime.value,.96);
 event.update(.4,{time:9});assert.equal(u.uTime.value,9);
 event.update(Infinity,{time:NaN});assert.equal(u.uProgress.value,0);assert.equal(u.uTime.value,0);
 event.update(3,2);assert.equal(u.uProgress.value,1);assert.equal(u.uTime.value,2);
 let count=0;mesh.geometry.addEventListener('dispose',()=>count++);mesh.material.addEventListener('dispose',()=>count++);
 event.dispose();event.dispose();assert.equal(count,2);
 assert.equal(event.metadata.fluidSimulation,false);assert.equal(event.metadata.waterIor,1.333);
});

test('ablation can compare runtime skips with compile-time elimination and restores beauty',()=>{
 const event=createElementsShader(),material=event.root.children[0].material,version=material.version;
 event.setDebugMode('fire-only');assert.equal(material.uniforms.uDebugMode.value,1);assert.equal(material.version,version);
 event.setDebugMode('water-only-compiled');assert.equal(material.uniforms.uDebugMode.value,2);assert.equal(material.defines.ELEMENTS_COMPILED_ABLATION,2);assert.equal(material.version,version+1);
 event.setDebugMode('beauty');assert.equal(material.uniforms.uDebugMode.value,0);assert.equal(material.defines.ELEMENTS_COMPILED_ABLATION,undefined);assert.equal(material.version,version+2);
 assert.throws(()=>event.setDebugMode('nonsense'),/Unknown/);event.dispose();
 assert.doesNotMatch(elementsVertexShader,/discard|elementMode|sampler3D/,'fragment diagnostics must never enter vertex code');
 assert.match(elementsFragmentShader,/if\(elementMode\(\)==7\)discard/);
});

test('fracture polyhedra stay inside the conservative sphere and three-neighbor vertical search',()=>{
 const source=elementsFragmentShader.slice(elementsFragmentShader.indexOf('float rockPiece'),elementsFragmentShader.indexOf('vec2 earthDistance'));
 const planes=[...source.matchAll(/dot\(q,vec3\(([\d.-]+),([\d.-]+),([\d.-]+)\)\)-([\d.]+)/g)].map(m=>({n:new T.Vector3(+m[1],+m[2],+m[3]),d:+m[4]}));
 assert.equal(planes.length,12);
 const vertices=[],matrix=new T.Matrix3();
 for(let a=0;a<12;a++)for(let b=a+1;b<12;b++)for(let c=b+1;c<12;c++){
  const x=planes[a],y=planes[b],z=planes[c];matrix.set(x.n.x,x.n.y,x.n.z,y.n.x,y.n.y,y.n.z,z.n.x,z.n.y,z.n.z);
  if(Math.abs(matrix.determinant())<1e-7)continue;
  const v=new T.Vector3(x.d,y.d,z.d).applyMatrix3(matrix.invert());
  if(planes.every(p=>p.n.dot(v)<=p.d+1e-6))vertices.push(v);
 }
 assert.ok(vertices.length>=20);assert.ok(Math.max(...vertices.map(v=>v.length()))<1.65);
 const event=createElementsShader(),u=event.root.children[0].material.uniforms;
 for(let i=0;i<9;i++)for(const v of vertices){
  const size=u.uStoneSizes.value[i],scaled=v.clone().multiply(size);
  assert.ok(scaled.length()<=u.uStoneBounds.value[i]+1e-7);
  const height=Math.abs(Math.sin(i*.78)*scaled.x+Math.cos(i*.78)*scaled.y);
  assert.ok(height+.075<.49*1.5,'a fragment must not reach a y-cell whose three-neighbor search excludes it');
 }
 event.dispose();
});
