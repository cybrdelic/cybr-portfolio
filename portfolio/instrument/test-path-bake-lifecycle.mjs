// Run with: node portfolio/instrument/test-path-bake-lifecycle.mjs
// Exercise the real loader with Three's real materials/matrices and controlled
// asynchronous texture delivery. No browser or production assets are changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three-r180/three.module.min.js';

const source=fs.readFileSync(new URL('../instrument-path-bake.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/,'')
  .replace('export async function loadPathBake','async function loadPathBake');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(){
  const waiting=new Map(),delivered=new Map(),errors=[];
  class Loader{
    loadAsync(url){
      const key=url.match(/\/([cv]\d+)\?/)[1];
      return new Promise((resolve,reject)=>waiting.set(key,{resolve,reject}));
    }
  }
  const identity=new THREE.Matrix4().toArray();
  const manifest={complete:true,sourceGeometry:'test-geometry',surfaces:{'geo/body/0':1},
    frames:Array.from({length:21},(_,index)=>({index,progress:index/20,color:'c'+index,visibility:'v'+index,hash:'fixture',
      groups:[{name:'geo',x:0}],objects:[],world:identity,projection:identity,depthRange:[0,100]}))};
  const finish=new THREE.Texture(),original=new THREE.MeshPhysicalMaterial({transmission:.94,ior:1.47,thickness:8,
    iridescence:.42,iridescenceIOR:2.8,iridescenceThicknessRange:[380,380],anisotropy:.24,anisotropyRotation:.65,
    transparent:true,opacity:.74,depthWrite:false,dispersion:.13,roughness:.087,metalness:.2,vertexColors:true,
    roughnessMap:finish,bumpMap:finish});
  let hookCalls=0;original.onBeforeCompile=shader=>{hookCalls++;shader.fragmentShader+='\n// retained original hook';};
  const object=new THREE.Mesh(new THREE.BufferGeometry(),original);object.name='geo/body/0';
  const group=new THREE.Group();group.add(object);
  const context=vm.createContext({THREE:{...THREE,TextureLoader:Loader},URLSearchParams,location:{search:''},
    fetch:async()=>({ok:true,json:async()=>manifest}),console:{error:error=>errors.push(error.message)}});
  vm.runInContext(source+'\nglobalThis.start=loadPathBake;',context);
  const start=context.start(new Map([['geo',group]]),()=>{},'test-geometry',{base:'./fixture/'});
  function deliver(index,visibilityError=null){
    for(const prefix of ['c','v']){
      const key=prefix+index,request=waiting.get(key);assert.ok(request,'Expected pending texture '+key);waiting.delete(key);
      if(prefix==='v'&&visibilityError){request.reject(Error(visibilityError));continue;}
      const texture=new THREE.Texture();texture.name=key;texture.disposeCount=0;
      texture.addEventListener('dispose',()=>texture.disposeCount++);delivered.set(key,texture);request.resolve(texture);
    }
  }
  return {start,deliver,delivered,errors,object,original,finish,get hookCalls(){return hookCalls;}};
}

async function boot(){const f=fixture();await flush();f.deliver(0);f.api=await f.start;await flush();return f;}

// Reproduce the observed race: one foreground leg is resident; scroll changes
// the request; an older prefetch completes and trims before the other leg.
{
  const f=await boot();f.deliver(1);await flush();f.deliver(2);await flush();
  const material=f.object.material;
  assert.ok(material.isMeshPhysicalMaterial);
  for(const key of ['transmission','ior','thickness','iridescence','iridescenceIOR','anisotropy','anisotropyRotation',
    'transparent','opacity','depthWrite','dispersion','roughness','metalness','vertexColors','roughnessMap','bumpMap'])
    assert.equal(material[key],f.original[key],'Physical fallback retained '+key);
  assert.deepEqual(material.iridescenceThicknessRange,f.original.iridescenceThicknessRange);
  const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'void main() {\n}'};
  material.onBeforeCompile(shader);assert.equal(f.hookCalls,1);
  assert.ok(shader.fragmentShader.includes('// retained original hook'));
  assert.ok(shader.fragmentShader.includes('gl_FragColor=vec4(pathDiagnostic'));
  f.api.requestProgress(.5);f.deliver(9);f.deliver(10);await flush();
  f.deliver(11);await flush();f.deliver(8);await flush();f.deliver(12);await flush();
  f.api.requestProgress(.8);f.deliver(15);await flush();f.api.requestProgress(.2);
  f.deliver(7);await flush();
  assert.equal(f.delivered.get('c15').disposeCount,0,'Pending foreground leg remains pinned');
  assert.equal(shader.uniforms.pathColorA.value.disposeCount,0,'Currently sampled A remains resident');
  assert.equal(shader.uniforms.pathColorB.value.disposeCount,0,'Currently sampled B remains resident');
  f.deliver(16);await flush();f.deliver(3);f.deliver(4);await flush();
  assert.deepEqual(Array.from(f.api.snapshot().shown),[3,4]);assert.equal(f.api.snapshot().failed,null);
  assert.ok(f.api.snapshot().cached<=6);assert.deepEqual(f.errors,[]);
  f.api.setProgress(.2);assert.equal(shader.uniforms.pathColorA.value.name,'c3');
  assert.equal(shader.uniforms.pathColorB.value.name,'c4');f.api.dispose();
}

// Disposing while foreground/prefetch requests are pending must release late
// successful textures, leave the cache empty, and avoid reporting cancellation.
{
  const f=await boot();f.api.requestProgress(.8);f.api.dispose();
  f.deliver(1);f.deliver(15);f.deliver(16);await flush();f.api.dispose();
  assert.equal(f.api.snapshot().cached,0);assert.equal(f.api.snapshot().failed,null);assert.deepEqual(f.errors,[]);
  for(const texture of f.delivered.values())assert.equal(texture.disposeCount,1,'Late/disposed texture released once');
  assert.equal(f.finish.disposeCount,undefined,'Shared physical finish is not owned by the bake cache');
}

// A failed visibility load must not leak the successfully decoded colour leg.
{
  const f=await boot();f.api.requestProgress(.8);f.deliver(15,'fixture visibility failure');f.deliver(16);await flush();
  assert.equal(f.delivered.get('c15').disposeCount,1);assert.equal(f.api.snapshot().failed,'fixture visibility failure');
  assert.deepEqual(f.errors,['fixture visibility failure']);f.api.dispose();f.deliver(1);await flush();
}

console.log('PASS: async foreground/prefetch race, sampled-resource pins, physical fallback/hooks, late disposal, partial-load cleanup.');
