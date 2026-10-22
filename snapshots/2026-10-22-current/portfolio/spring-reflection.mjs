import * as T from './vendor/three-r180/three.module.min.js';
import {withReflectionPreparation} from './reflection-preparation.mjs';

// A cached planar reflection of the actual landscape. Only the primary pool
// uses this target; the smaller pool retains its own environment reflection.
export function createSpringReflection(renderer,scene,root){
 const water=root.children.find(o=>o.material?.userData.springPool===0);
 if(!water)return null;
 const target=new T.WebGLRenderTarget(768,768,{type:T.HalfFloatType});
 const camera=new T.PerspectiveCamera(),matrix=new T.Matrix4();
 const bias=new T.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
 const forward=new T.Vector3(),look=new T.Vector3(),up=new T.Vector3(),rotation=new T.Quaternion();
 const plane=new T.Plane(new T.Vector3(0,1,0),0);
 const receiverMasks=new WeakMap(),ownedMasks=new Set();
 function receiverMask(original){
  let mask=receiverMasks.get(original);
  if(!mask){
   mask=new T.MeshBasicMaterial({colorWrite:false,depthWrite:false});
   mask.name='Pool reflection receiver / shadow caster only';
   receiverMasks.set(original,mask);ownedMasks.add(mask);
  }
  // WebGLShadowMap derives a depth material from these silhouette properties,
  // not from colour/depth write flags. Keeping the mesh visible preserves its
  // caster geometry when a pending shadow update is consumed by this pass.
  const alpha=original.alphaTest>0||original.alphaToCoverage;
  const properties={visible:original.visible,side:original.side,shadowSide:original.shadowSide,
   alphaTest:original.alphaTest,alphaToCoverage:original.alphaToCoverage,
   map:alpha?original.map:null,alphaMap:alpha?original.alphaMap:null,
   clippingPlanes:original.clippingPlanes,clipIntersection:original.clipIntersection,clipShadows:original.clipShadows,
   displacementMap:original.displacementMap,displacementScale:original.displacementScale,displacementBias:original.displacementBias};
  for(const [key,value] of Object.entries(properties))if(mask[key]!==value){mask[key]=value;mask.needsUpdate=true;}
  return mask;
 }
 const uniforms={springReflection:{value:target.texture},springProjection:{value:matrix},springReady:{value:0}};
 const material=water.material,compile=material.onBeforeCompile;
 material.onBeforeCompile=shader=>{
  compile.call(material,shader);Object.assign(shader.uniforms,uniforms);
  shader.vertexShader='varying vec3 springWorld;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nspringWorld=(modelMatrix*vec4(position,1.)).xyz;');
  shader.fragmentShader='varying vec3 springWorld;uniform sampler2D springReflection;uniform mat4 springProjection;uniform float springReady;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
   vec4 reflected=springProjection*vec4(springWorld,1.);
   vec2 reflectionUV=reflected.xy/reflected.w+(normal-nonPerturbedNormal).xy*.3;
   float valid=step(0.,reflectionUV.x)*step(reflectionUV.x,1.)*step(0.,reflectionUV.y)*step(reflectionUV.y,1.);
   float reflectionWeight=.0204+.9796*pow(1.-abs(dot(normal,geometryViewDir)),5.);
   // Replace the probe reflection rather than adding a second reflected sky
   // over transmission. The transmission shader already attenuates by Fresnel.
   vec3 localReflection=texture2D(springReflection,reflectionUV).rgb*reflectionWeight;
   outgoingLight+=valid*springReady*(localReflection-reflectedLight.indirectSpecular);
   #include <opaque_fragment>`);
 };
 material.customProgramCacheKey=()=> 'native-pool-local-reflection-2';material.needsUpdate=true;
 let signature='',revision=0,disposed=false;
 function update(source,preparing=false){
  if(disposed)return;
  scene.updateMatrixWorld(true);source.updateMatrixWorld();
  const key=[revision,...source.matrixWorld.elements,...source.projectionMatrix.elements,...root.matrixWorld.elements,
   scene.background?.uuid??scene.background?.getHexString?.(),scene.environment?.uuid].join('/');
  // A fixed camera must not cache a frame rendered before the outdoor light's
  // first shadow map allocation, or before a changed source/material arrives.
  if(!preparing&&signature===key&&!renderer.shadowMap.needsUpdate)return;
  const level=new T.Vector3(0,.055,0).applyMatrix4(root.matrixWorld).y;
  camera.copy(source);source.getWorldPosition(camera.position);source.getWorldDirection(forward);look.copy(camera.position).add(forward);
  camera.position.y=2*level-camera.position.y;look.y=2*level-look.y;
  source.getWorldQuaternion(rotation);up.set(0,1,0).applyQuaternion(rotation);up.y=-up.y;camera.up.copy(up);camera.lookAt(look);camera.updateMatrixWorld();
  const previousMatrix=matrix.clone();
  matrix.copy(bias).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
  plane.constant=-level+.015;
  const oldTarget=renderer.getRenderTarget(),oldClip=renderer.clippingPlanes,oldShadow=renderer.shadowMap.needsUpdate;
  const oldFace=renderer.getActiveCubeFace?.()??0,oldMip=renderer.getActiveMipmapLevel?.()??0,oldReady=uniforms.springReady.value;
  const viewport=renderer.getViewport(new T.Vector4()),scissor=renderer.getScissor(new T.Vector4()),scissorTest=renderer.getScissorTest();
  const masked=root.children.filter(o=>o.material?.userData.springPool!==undefined&&o.visible).map(mesh=>({mesh,material:mesh.material}));
  for(const {mesh,material} of masked)mesh.material=receiverMask(material);
  let complete=false,shadowAfterRender=oldShadow;
  try{
   renderer.clippingPlanes=[...(oldClip||[]),plane];
   // Another mesh can share this water shader. Never sample the target while
   // writing it, even when its ready multiplier is zero.
   uniforms.springReflection.value=null;uniforms.springReady.value=0;
   // Do not suppress pending shadows: Three updates/allocates them before the
   // reflected colour pass, and beauty then reuses that same current map.
   // Global reflection clipping is not applied to Three's shadow traversal.
   renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.clear();renderer.render(scene,camera);
   shadowAfterRender=renderer.shadowMap.needsUpdate;complete=true;signature=preparing?'':key;
  }finally{
   for(const {mesh,material} of masked)mesh.material=material;
   renderer.clippingPlanes=oldClip;renderer.shadowMap.needsUpdate=complete?shadowAfterRender:oldShadow;
   uniforms.springReflection.value=target.texture;uniforms.springReady.value=preparing?0:complete?1:oldReady;
   if(!complete||preparing)matrix.copy(previousMatrix);
   if(preparing)signature='';
   renderer.setRenderTarget(oldTarget,oldFace,oldMip);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
  }
 }
 return {update,
  prepare(source){if(!disposed)return withReflectionPreparation(T,renderer,scene,()=>update(source,true));},
  invalidate(){revision++;signature='';uniforms.springReady.value=0;},dispose(){if(disposed)return;disposed=true;target.dispose();for(const mask of ownedMasks)mask.dispose();}};
}
