import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import * as T from './vendor/three-r180/three.module.min.js';
import {applyCybrSurfacesThree} from '../cybr-light/browser/cybr-surfaces-three.mjs';
import {prepareVisiblePrograms,preparationSnapshot} from './prepare-visible-programs.mjs';
import {installTransmissionRegion} from './transmission-region.mjs';
import {sourceGeometry} from './source-geometry.mjs';

test('cooperative physical mapping preserves every UV and material value',async()=>{
 const originalFetch=globalThis.fetch,bytes=new Uint16Array([15360,15360,15360,15360]);
 globalThis.fetch=async url=>String(url).endsWith('manifest.json')?Response.json({materials:[{id:'test',runtimeSize:1,tile_m:.2,runtimeMaps:[0,1,2].map(i=>({file:i+'.gz',bytes:8}))}]}):new Response(gzipSync(bytes));
 const make=()=>{const root=new T.Group(),g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0, 0,0,0,0,1,0,0,0,1, 0,0,0,1,0,1,0,1,1],3));const m=new T.MeshStandardMaterial();m.userData.cybrMaterial='test';root.add(new T.Mesh(g,m));return root;};
 const a=make(),b=make();let uploaded=0;
 try{const x=await applyCybrSurfacesThree(T,a),y=await applyCybrSurfacesThree(T,b,{cooperative:true,prepareTexture:()=>uploaded++});assert.deepEqual(a.children[0].geometry.attributes.uv.array,b.children[0].geometry.attributes.uv.array);assert.equal(uploaded,3);assert.equal(a.children[0].material.roughness,b.children[0].material.roughness);x.dispose();y.dispose();}finally{globalThis.fetch=originalFetch;}
});

test('program preparation excludes hidden chapters and deduplicates equivalent meshes',async()=>{
 const scene=new T.Scene(),m=new T.MeshStandardMaterial(),g=new T.BoxGeometry();
 const a=new T.Mesh(g,m),b=new T.Mesh(g,m),hidden=new T.Mesh(g,new T.MeshStandardMaterial());hidden.visible=false;scene.add(a,b,hidden);
 const compiled=[];await prepareVisiblePrograms(T,{async compileAsync(view,camera,target){assert.equal(target,scene);view.traverse(o=>compiled.push(o));}},scene,new T.Camera());
 assert.deepEqual(compiled,[a]);assert.equal(a.parent,scene);assert.equal(b.parent,scene);g.dispose();m.dispose();hidden.material.dispose();
});

test('preparation retains chapter lighting and visibility across rapid navigation',()=>{
 const source=new T.Scene(),mesh=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial()),light=new T.DirectionalLight(0xffffff,3),camera=new T.PerspectiveCamera();
 mesh.position.x=4;mesh.frustumCulled=false;source.add(mesh,light);camera.position.z=8;
 const frozen=preparationSnapshot(T,source,camera);mesh.visible=false;mesh.position.x=9;light.intensity=0;camera.position.z=2;
 assert.equal(frozen.scene.children[0].visible,true);assert.equal(frozen.scene.children[0].matrixWorld.elements[12],4);assert.equal(frozen.scene.children[1].intensity,3);assert.equal(frozen.camera.position.z,8);
 assert.equal(frozen.scene.children[0].geometry,mesh.geometry);mesh.geometry.dispose();mesh.material.dispose();
});

test('preparation omits off-camera cells without changing source visibility',()=>{
 const source=new T.Scene(),camera=new T.PerspectiveCamera(50,1,.1,100);camera.position.z=8;
 const inside=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()),outside=inside.clone();outside.position.x=100;source.add(inside,outside);
 const snapshot=preparationSnapshot(T,source,camera);assert.equal(snapshot.scene.children.length,1);assert.equal(outside.visible,true);assert.equal(outside.parent,source);inside.geometry.dispose();inside.material.dispose();
});

test('warm chapter discovery cannot move the live cached shadow projection',()=>{
 for(const light of [new T.DirectionalLight(),new T.SpotLight(),new T.PointLight()]){
  const source=new T.Scene(),camera=new T.PerspectiveCamera(50,1,.1,100);
  camera.position.z=12;light.castShadow=true;light.position.set(4,8,3);source.add(light);
  if(light.target)source.add(light.target);
  source.updateMatrixWorld(true);light.shadow.updateMatrices(light,0);
  const map={name:'already rendered depth map'};light.shadow.map=map;
  const describe=shadow=>({matrix:shadow.matrix.toArray(),position:shadow.camera.position.toArray(),
   quaternion:shadow.camera.quaternion.toArray(),projection:shadow.camera.projectionMatrix.toArray(),
   view:shadow.camera.matrixWorldInverse.toArray(),frustum:shadow.getFrustum().planes.map(p=>[...p.normal.toArray(),p.constant])});
  const cached=describe(light.shadow);
  // Simulate background prewarm changing the light to a later chapter while
  // its cached depth texture still contains the current Elements pose.
  light.position.set(-12,6,-8);
  if(light.target)light.target.position.set(2,-3,-5);
  const snapshot=preparationSnapshot(T,source,camera),copy=snapshot.scene.children.find(o=>o.isLight);
  assert.deepEqual(describe(light.shadow),cached,'Snapshot mutated the live depth-map projection');
  assert.notEqual(copy.shadow,light.shadow);assert.notEqual(copy.shadow.camera,light.shadow.camera);
  assert.notEqual(copy.shadow.matrix,light.shadow.matrix);assert.equal(copy.shadow.map,map);
  assert.equal(copy.shadow.autoUpdate,false);assert.equal(copy.shadow.needsUpdate,false);
  copy.shadow.updateMatrices(copy,0);
  assert.deepEqual(describe(light.shadow),cached,'Snapshot shadow state still aliases the live light');
 }
});

test('shader warm-up never submits a draw to the presentation framebuffer',async()=>{
 const scene=new T.Scene(),g=new T.BoxGeometry(),m=new T.MeshStandardMaterial();scene.add(new T.Mesh(g,m));
 let target=null,draws=0,displayDraws=0,scissor=new T.Vector4(0,0,320,200),scissorTest=false;
 const renderer={outputColorSpace:T.SRGBColorSpace,autoClear:true,toneMapping:T.ACESFilmicToneMapping,shadowMap:{enabled:true,needsUpdate:true},
  getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},getDrawingBufferSize:v=>v.set(320,200),compileAsync:async()=>{},
  getScissor:v=>v.copy(scissor),setScissor:(...a)=>{scissor=a[0]?.isVector4?a[0].clone():new T.Vector4(...a);},getScissorTest:()=>scissorTest,setScissorTest:v=>{scissorTest=v;},
  render(){assert.notEqual(target,null,'Warm-up discarded the visible chapter');if(target.texture.colorSpace===T.SRGBColorSpace){assert.equal(target.isXRRenderTarget,true,'Display warm-up compiled a linear-output variant');displayDraws++;}draws++;}
 };
 await prepareVisiblePrograms(T,renderer,scene,new T.Camera());assert.ok(draws>=3);assert.equal(displayDraws,1);assert.equal(target,null);assert.equal(g.drawRange.count,Infinity);g.dispose();m.dispose();
});

test('an asset arrival during asynchronous compilation retains its pending live shadow update',async()=>{
 const scene=new T.Scene(),g=new T.BoxGeometry(),m=new T.MeshStandardMaterial(),mesh=new T.Mesh(g,m);mesh.castShadow=true;scene.add(mesh);
 let target=null,scissor=new T.Vector4(0,0,320,200),scissorTest=false,arrival=false;
 const renderer={outputColorSpace:T.SRGBColorSpace,autoClear:true,toneMapping:T.ACESFilmicToneMapping,shadowMap:{enabled:true,needsUpdate:false},
  getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},getDrawingBufferSize:v=>v.set(320,200),
  async compileAsync(view){if(view.isScene){await Promise.resolve();renderer.shadowMap.needsUpdate=true;arrival=true;}},
  getScissor:v=>v.copy(scissor),setScissor:(...a)=>{scissor=a[0]?.isVector4?a[0].clone():new T.Vector4(...a);},getScissorTest:()=>scissorTest,setScissorTest:v=>{scissorTest=v;},render(){}
 };
 try{await prepareVisiblePrograms(T,renderer,scene,new T.Camera());assert.equal(arrival,true);assert.equal(renderer.shadowMap.needsUpdate,true,'Warm-up erased a newer asset-arrival invalidation');}
 finally{g.dispose();m.dispose();}
});

test('transmission region retains full texture dimensions and restores target state',()=>{
 const scene=new T.Scene(),camera=new T.OrthographicCamera(-10,10,10,-10,.1,100);camera.position.z=20;camera.updateMatrixWorld();
 const mesh=new T.Mesh(new T.SphereGeometry(1),new T.MeshPhysicalMaterial({transmission:1,thickness:.2,roughness:.015}));scene.add(mesh);
 const target=new T.WebGLRenderTarget(1000,1000,{type:T.HalfFloatType,samples:4});let observed;
 const renderer={setRenderTarget(t){observed={test:t.scissorTest,box:t.scissor.clone(),width:t.width};},render(){this.setRenderTarget(target);}};
 const original=target.scissor.clone(),region=installTransmissionRegion(T,renderer);renderer.render(scene,camera);
 assert.equal(observed.width,1000);assert.equal(observed.test,true);assert.ok(observed.box.z<200&&observed.box.z>120);assert.deepEqual(target.scissor,original);assert.equal(target.scissorTest,false);
 mesh.material.roughness=.5;renderer.render(scene,camera);assert.equal(observed.test,false);region.dispose();target.dispose();mesh.geometry.dispose();mesh.material.dispose();
});

test('source geometry accepts conservative offline bounds without scanning vertices',()=>{
 const values=new Float32Array([0,0,0,1,0,0,0,1,0]);const g=sourceGeometry(T,values.buffer,{position:{offset:0,count:9,size:3},bounds:{min:[0,0,0],max:[1,1,0]}});
 assert.equal(g.boundingSphere.radius,Math.SQRT1_2);assert.deepEqual(g.attributes.position.array,values);g.dispose();
});

test('packed indices preserve exact triangle connectivity',()=>{
 const bytes=new ArrayBuffer(44);new Float32Array(bytes,0,9).set([0,0,0,1,0,0,0,1,0]);new Uint16Array(bytes,36,3).set([0,1,2]);
 const g=sourceGeometry(T,bytes,{position:{offset:0,count:9,size:3},index:{offset:36,count:3,size:1,componentType:'uint16'},bounds:{min:[0,0,0],max:[1,1,0]}});
 assert.ok(g.index.array instanceof Uint16Array);assert.deepEqual([...g.index.array],[0,1,2]);g.dispose();
});
