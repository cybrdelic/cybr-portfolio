import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as NativeThree from './vendor/three-r180/three.module.min.js';
import {createGeoStarter} from './instrument-geo-starter.mjs';

test('starter draws all original GEO geometry, rotates on input and releases only its own resources',async()=>{
  const base=new URL('./assets/instrument-working-v1/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',base)));
  const raw=gunzipSync(readFileSync(new URL('instrument.bin.gz',base))).subarray(0,manifest.progressiveGeo.decodedBytes);
  const buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),events=()=>({listeners:new Map(),
    addEventListener(name,fn){this.listeners.set(name,fn);},removeEventListener(name){this.listeners.delete(name);}});
  const previous={document:globalThis.document,window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  const frames=new Map();let nextFrame=0,draws=0,lastScene,lastCamera,forgotten=0,pmremDisposes=0;
  globalThis.document={...events(),hidden:false};globalThis.window={...events(),instrumentStartup:{}};
  globalThis.requestAnimationFrame=fn=>{frames.set(++nextFrame,fn);return nextFrame;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
  const canvas={...events(),style:{removeProperty(name){delete this[name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())];}},setPointerCapture(){}};
  const renderer={domElement:canvas,capabilities:{getMaxAnisotropy:()=>16},shadowMap:{enabled:false,type:NativeThree.BasicShadowMap,autoUpdate:true,needsUpdate:false},
    setPixelRatio(){},setClearColor(){},setSize(){},setRenderTarget(){},async compileAsync(){},render(scene,camera){
      draws++;lastScene=scene;lastCamera=camera;this.shadowMap.needsUpdate=false;
      scene.traverse(object=>{if(object.shadow)object.shadow.needsUpdate=false;});}};
  const THREE={...NativeThree,PMREMGenerator:class{fromEquirectangular(){return{texture:new NativeThree.Texture(),dispose(){pmremDisposes++;}};}dispose(){}}};
  const slider={...events(),value:0,disabled:true,attributes:new Map(),setAttribute(k,v){this.attributes.set(k,v);},removeAttribute(k){this.attributes.delete(k);}};
  const texture=new THREE.Texture();let textureDisposed=false;texture.addEventListener('dispose',()=>textureDisposed=true);
  try{
    const starter=await createGeoStarter({THREE,renderer,surface:{clientWidth:390,clientHeight:363,append(){}},manifest,buffer,
      environment:new ArrayBuffer(1024*512*16),texture,slider,reduced:{matches:false},
      makeMaterial:()=>new THREE.MeshPhysicalMaterial(),forgetMaterial:()=>forgotten++});
    assert.equal(draws,1);assert.equal(slider.disabled,false);assert.equal(starter.snapshot().meshes,6);
    const meshes=[];lastScene.traverse(object=>{if(object.isMesh)meshes.push(object);});
    const records=manifest.meshes.filter(mesh=>mesh.module==='geo');assert.equal(meshes.length,records.length);
    meshes.forEach((mesh,i)=>{
      assert.equal(mesh.geometry.attributes.position.count,records[i].positions.count/3);
      assert.equal(mesh.geometry.index.count,records[i].indices.count);
      assert.equal(mesh.geometry.attributes.position.array.buffer,buffer);
      assert.equal(mesh.geometry.attributes.normal.array.buffer,buffer);
      assert.ok(mesh.material.customProgramCacheKey().endsWith('-geo-starter-v1'));
    });
    const before=lastCamera.position.clone();slider.value=70;slider.listeners.get('input')();
    for(const [id,fn] of [...frames]){frames.delete(id);fn();}
    assert.equal(draws,2);assert.ok(lastCamera.position.distanceTo(before)>1);assert.equal(starter.snapshot().target,.7);
    const materialCount=new Set(meshes.map(mesh=>mesh.material)).size;
    starter.dispose();starter.dispose();assert.equal(forgotten,materialCount);assert.equal(pmremDisposes,1);
    assert.equal(textureDisposed,false,'the shared original roughness texture belongs to the full instrument');
    assert.equal(canvas.listeners.size,0);assert.equal(slider.listeners.size,0);assert.equal(frames.size,0);
    assert.equal(renderer.shadowMap.enabled,false);assert.equal(renderer.shadowMap.autoUpdate,true);
  }finally{Object.assign(globalThis,previous);}
});
