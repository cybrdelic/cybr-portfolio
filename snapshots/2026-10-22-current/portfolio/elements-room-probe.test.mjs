import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {createElementsRoomProbe} from './elements-room-probe.mjs';

function fixture({throwAt=0,floatExtension=true}={}){
 const scene=new T.Scene(),room=new T.Group(),floor=new T.Mesh(new T.BoxGeometry(8,.3,8),new T.MeshStandardMaterial()),water=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());
 const hidden=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()),lamp=new T.PointLight(0xffd2aa,8),environment=new T.Texture();
 room.add(floor);scene.add(room,water,hidden,lamp);hidden.visible=false;scene.background=new T.Color(0x987654);scene.environment=environment;
 scene.overrideMaterial=new T.MeshBasicMaterial();
 let target={name:'caller'},face=2,mip=3,viewport=new T.Vector4(4,5,600,400),scissor=new T.Vector4(6,7,200,100),scissorTest=true,clear=new T.Color(.2,.3,.4),alpha=.7;
 const records=[],listeners=new Map();
 const renderer={coordinateSystem:T.WebGLCoordinateSystem,xr:{enabled:true},shadowMap:{autoUpdate:true,needsUpdate:true},
  extensions:{has:name=>name==='EXT_color_buffer_float'?floatExtension:false},
  toneMapping:T.ACESFilmicToneMapping,toneMappingExposure:1.8,outputColorSpace:T.SRGBColorSpace,
  autoClear:false,autoClearColor:false,autoClearDepth:false,autoClearStencil:true,
  domElement:{addEventListener:(name,cb)=>listeners.set(name,cb),removeEventListener:(name,cb)=>{if(listeners.get(name)===cb)listeners.delete(name);}},
  info:{autoReset:true,render:{calls:10,triangles:100}},
  getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,setRenderTarget(t,f=0,m=0){target=t;face=f;mip=m;},
  getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>scissorTest,getClearColor:c=>c.copy(clear),getClearAlpha:()=>alpha,
  setViewport:v=>{viewport=v.clone();},setScissor:v=>{scissor=v.clone();},setScissorTest:v=>{scissorTest=v;},setClearColor(c,a){clear=new T.Color(c);alpha=a;},
  render(s,camera){
   s.updateMatrixWorld(true);const meshes=[],lights=[];s.traverseVisible(o=>{if(o.layers.test(camera.layers)){if(o.isMesh)meshes.push(o);if(o.isLight)lights.push(o);}});
   records.push({target,face,meshes,lights,background:s.background,environment:s.environment,override:s.overrideMaterial,clear:clear.clone(),alpha,
    toneMapping:this.toneMapping,exposure:this.toneMappingExposure,output:this.outputColorSpace,autoClear:this.autoClear,scissorTest,shadowAutoUpdate:this.shadowMap.autoUpdate,shadowNeedsUpdate:this.shadowMap.needsUpdate,
    cameraPosition:camera.getWorldPosition(new T.Vector3()),cameraDirection:camera.getWorldDirection(new T.Vector3())});
   this.info.render.calls+=meshes.length;this.info.render.triangles+=12*meshes.length;
   if(records.length===throwAt)throw new Error('Cube render failed.');
  },
 };
 const state=()=>({target,face,mip,viewport:viewport.toArray(),scissor:scissor.toArray(),scissorTest,clear:clear.toArray(),alpha,
  tone:renderer.toneMapping,exposure:renderer.toneMappingExposure,output:renderer.outputColorSpace,autoClear:renderer.autoClear,autoClearColor:renderer.autoClearColor,
  autoClearDepth:renderer.autoClearDepth,autoClearStencil:renderer.autoClearStencil,xr:renderer.xr.enabled,shadowAutoUpdate:renderer.shadowMap.autoUpdate,shadowNeedsUpdate:renderer.shadowMap.needsUpdate,infoAutoReset:renderer.info.autoReset});
 return {scene,room,floor,water,hidden,lamp,environment,renderer,records,listeners,state};
}

test('captures six actual room views with linear HDR and transparent open rays',()=>{
 const f=fixture(),before=f.state(),background=f.scene.background,override=f.scene.overrideMaterial,p=createElementsRoomProbe(f.renderer);
 assert.equal(p.update({scene:f.scene,receivers:f.room,position:[1,2,3],key:'room-1'}),true);
 assert.equal(f.records.length,6);assert.deepEqual(f.records.map(r=>r.face),[0,1,2,3,4,5]);
 for(const capture of f.records){
  assert.deepEqual(capture.meshes,[f.floor]);assert.deepEqual(capture.lights,[f.lamp]);assert.equal(capture.environment,f.environment);
  assert.equal(capture.background,null);assert.equal(capture.override,null);assert.deepEqual(capture.clear.toArray(),[0,0,0]);assert.equal(capture.alpha,0);
  assert.equal(capture.toneMapping,T.NoToneMapping);assert.equal(capture.exposure,1);assert.equal(capture.output,T.LinearSRGBColorSpace);
  assert.equal(capture.autoClear,true);assert.equal(capture.scissorTest,false);assert.equal(capture.shadowAutoUpdate,false);assert.equal(capture.shadowNeedsUpdate,false);
  assert.deepEqual(capture.cameraPosition.toArray(),[1,2,3]);assert.equal(capture.target.width,256);assert.equal(capture.target.height,256);
 }
 assert.equal(p.texture.isCubeTexture,true);assert.equal(p.texture.isRenderTargetTexture,true);assert.equal(p.texture.type,T.HalfFloatType);
 assert.equal(p.texture.mapping,T.CubeReflectionMapping);assert.equal(p.texture.colorSpace,T.LinearSRGBColorSpace);assert.equal(p.texture.generateMipmaps,false);assert.equal(p.texture.minFilter,T.LinearFilter);
 assert.deepEqual(p.position.toArray(),[1,2,3]);assert.equal(p.stats.valid,true);assert.equal(p.stats.faces,6);assert.equal(p.stats.calls,6);
 assert.equal(f.water.visible,true);assert.equal(f.hidden.visible,false);assert.equal(f.scene.background,background);assert.equal(f.scene.overrideMaterial,override);assert.deepEqual(f.state(),before);p.dispose();
});

test('explicit stable key prevents animated positions and repeated calls from recapturing',()=>{
 const f=fixture(),p=createElementsRoomProbe(f.renderer),options={scene:f.scene,receivers:f.room,position:[1,2,3],key:'room'};
 p.update(options);const texture=p.texture;
 assert.equal(p.update({...options,position:[7,8,9]}),false);assert.equal(p.texture,texture);assert.deepEqual(p.position.toArray(),[1,2,3]);assert.equal(f.records.length,6);
 assert.equal(p.stats.reuses,1);p.update({...options,key:'room-light-change'});assert.equal(f.records.length,12);assert.equal(p.stats.captures,2);p.dispose();
});

test('capture failure restores all state and visibility and disables partial cube',()=>{
 const f=fixture({throwAt:3}),before=f.state(),background=f.scene.background,p=createElementsRoomProbe(f.renderer),options={scene:f.scene,receivers:f.room,position:[0,0,0],key:'room'};
 assert.throws(()=>p.update(options),/Cube render failed/);assert.equal(p.stats.valid,false);assert.equal(p.stats.captures,0);
 assert.equal(f.water.visible,true);assert.equal(f.hidden.visible,false);assert.equal(f.scene.background,background);assert.deepEqual(f.state(),before);
 p.update(options);assert.equal(p.stats.valid,true);assert.equal(p.stats.captures,1);assert.equal(f.records.length,9);p.dispose();
});

test('hiding an unrelated parent mesh does not hide its selected receiver child',()=>{
 const f=fixture();f.scene.remove(f.room);f.water.add(f.room);const mask=f.water.layers.mask,p=createElementsRoomProbe(f.renderer);
 p.update({scene:f.scene,receivers:f.room,position:[0,0,0],key:'nested'});
 for(const capture of f.records)assert.deepEqual(capture.meshes,[f.floor]);assert.equal(f.water.visible,true);assert.equal(f.water.layers.mask,mask);p.dispose();
});

test('context invalidation refreshes an identical key and disposal releases target/listeners',()=>{
 const f=fixture(),p=createElementsRoomProbe(f.renderer),options={scene:f.scene,receivers:f.room,position:[0,0,0],key:1};
 p.update(options);f.listeners.get('webglcontextlost')();assert.equal(p.stats.valid,false);p.update(options);assert.equal(p.stats.captures,2);
 const target=f.records[0].target;let disposed=0;target.addEventListener('dispose',()=>disposed++);p.dispose();p.dispose();
 assert.equal(disposed,1);assert.equal(f.listeners.size,0);assert.equal(p.stats.valid,false);assert.throws(()=>p.update(options),/disposed/);
});

test('invalid inputs cannot cause accidental per-frame capture or unrelated scene traversal',()=>{
 const f=fixture(),p=createElementsRoomProbe(f.renderer),options={scene:f.scene,receivers:f.room,position:[0,0,0],key:'room'};
 assert.throws(()=>p.update({...options,key:null}),/explicit stable/);assert.throws(()=>p.update({...options,position:[NaN,0,0]}),/finite world/);
 assert.throws(()=>p.update({...options,receivers:new T.Group()}),/not attached/);f.room.visible=false;assert.throws(()=>p.update(options),/no visible/);
 assert.equal(f.records.length,0);p.dispose();
 assert.throws(()=>createElementsRoomProbe(f.renderer,{resolution:128}),/256 or 512/);
 assert.throws(()=>createElementsRoomProbe(fixture({floatExtension:false}).renderer),/floating-point/);
});

test('size constructor alias and ready accessor match the parent integration contract',()=>{
 const f=fixture(),p=createElementsRoomProbe(f.renderer,{size:512});assert.equal(p.ready,false);assert.equal(p.target.width,512);assert.equal(p.texture,p.target.texture);
 p.update({scene:f.scene,receivers:f.room,position:new T.Vector3(),key:'room'});assert.equal(p.ready,true);p.invalidate();assert.equal(p.ready,false);p.dispose();
});
