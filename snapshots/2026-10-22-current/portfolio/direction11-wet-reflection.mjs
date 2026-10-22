import * as T from './vendor/three-r180/three.module.min.js';
import {withReflectionPreparation} from './reflection-preparation.mjs';

// One bounded planar reflection of actual geometry, only during the liquid
// chapter. No duplicated mesh, screen-space smear, or animated image asset.
export function createWetReflection(renderer,scene,set){
 if(!Array.isArray(set.reflectionReceivers)||!set.reflectionReceivers.length)throw new Error('Studio reflection requires explicit receiving floor meshes');
 const target=new T.WebGLRenderTarget(768,768,{type:T.HalfFloatType,depthBuffer:true});
 const camera=new T.PerspectiveCamera(),matrix=new T.Matrix4(),bias=new T.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
 const uniforms={texture:{value:target.texture},matrix:{value:matrix},ready:{value:0}};
 set.root.userData.wetReflection=uniforms;
 const forward=new T.Vector3(),look=new T.Vector3(),up=new T.Vector3(),rotation=new T.Quaternion();
 const plane=new T.Plane(new T.Vector3(0,1,0),0);
 const receiverMasks=new WeakMap(),ownedMasks=new Set();
 function receiverMask(original){
  let material=receiverMasks.get(original);
  if(!material){
   material=new T.MeshBasicMaterial({colorWrite:false,depthWrite:false});
   material.name='Reflection receiver / shadow caster only';
   receiverMasks.set(original,material);ownedMasks.add(material);
  }
  // ShadowMap builds its depth material from these properties, not from
  // colorWrite/depthWrite. Preserve alpha/displacement/local-clip silhouettes
  // while the beauty pass writes neither receiver colour nor receiver depth.
  const alpha=original.alphaTest>0||original.alphaToCoverage;
  const properties={visible:original.visible,side:original.side,shadowSide:original.shadowSide,
   alphaTest:original.alphaTest,alphaToCoverage:original.alphaToCoverage,
   map:alpha?original.map:null,alphaMap:alpha?original.alphaMap:null,
   clippingPlanes:original.clippingPlanes,clipIntersection:original.clipIntersection,clipShadows:original.clipShadows,
   displacementMap:original.displacementMap,displacementScale:original.displacementScale,displacementBias:original.displacementBias};
  for(const [key,value] of Object.entries(properties))if(material[key]!==value){material[key]=value;material.needsUpdate=true;}
  return material;
 }
 let signature='',revision=0,disposed=false;
 function update(source,progress,preparing=false){
  if(disposed||(set.root.userData.wetness?.value||0)<.001)return;
  source.updateMatrixWorld();
  const floor=set.reflectionHeight??-3.35;
  const key=[revision,progress,floor,scene.background?.uuid,scene.environment?.uuid,...source.matrixWorld.elements,...source.projectionMatrix.elements].join('/');
  // Geometry/material arrivals call invalidate(). A pending shadow update is
  // also a scene change, even when camera and scroll have stayed stationary.
  if(!preparing&&key===signature&&!renderer.shadowMap.needsUpdate)return;
  camera.copy(source);source.getWorldPosition(camera.position);source.getWorldDirection(forward);look.copy(camera.position).add(forward);
  camera.position.y=2*floor-camera.position.y;look.y=2*floor-look.y;
  source.getWorldQuaternion(rotation);up.set(0,1,0).applyQuaternion(rotation);up.y=-up.y;camera.up.copy(up);camera.lookAt(look);camera.updateMatrixWorld();
  const previousMatrix=matrix.clone();
  matrix.copy(bias).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
  // Keep geometry above the receiver; the epsilon avoids clipping a contact
  // exactly on its surface. Without this plane, below-floor geometry could
  // appear on the wrong side of the planar reflection.
  plane.constant=-floor+.002;
  const previousTarget=renderer.getRenderTarget(),previousShadow=renderer.shadowMap.needsUpdate;
  const previousFace=renderer.getActiveCubeFace?.()??0,previousMip=renderer.getActiveMipmapLevel?.()??0;
  const previousClipping=renderer.clippingPlanes,previousReady=uniforms.ready.value;
  const clearColor=renderer.getClearColor(new T.Color()),clearAlpha=renderer.getClearAlpha();
  // Keep both the walls and the receiving floors in the shadow traversal.
  // Setting visible=false would omit the floor's occluder depth from the
  // shadow map that beauty reuses. Colour/depth-write masks remove the floor
  // only from the reflected colour/transmission buffers, not caster geometry.
  const masked=set.reflectionReceivers.filter(mesh=>mesh.visible).map(mesh=>({mesh,material:mesh.material}));
  for(const {mesh,material} of masked)mesh.material=Array.isArray(material)?material.map(receiverMask):receiverMask(material);
  const viewport=new T.Vector4(),scissor=new T.Vector4();renderer.getViewport(viewport);renderer.getScissor(scissor);const scissorTest=renderer.getScissorTest();
  let complete=false,shadowAfterRender=previousShadow;
  try{
   renderer.clippingPlanes=[...(previousClipping||[]),plane];
   renderer.setClearColor(clearColor,0);
   // A wall may share the receiver's shader. Unbind the reflection texture
   // while writing it, even if that wall's wetness is zero, to avoid a GPU
   // texture/render-target feedback loop from the shader's unconditional fetch.
   uniforms.texture.value=null;uniforms.ready.value=0;
   // Honor a pending current-pose shadow update here. Three consumes it in
   // this pass, and the main pass reuses it rather than tracing shadows twice.
   renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.clear();renderer.render(scene,camera);
   shadowAfterRender=renderer.shadowMap.needsUpdate;complete=true;signature=preparing?'':key;
  }finally{
   for(const {mesh,material} of masked)mesh.material=material;
   renderer.clippingPlanes=previousClipping;
   renderer.shadowMap.needsUpdate=complete?shadowAfterRender:previousShadow;
   uniforms.texture.value=target.texture;uniforms.ready.value=preparing?0:complete?1:previousReady;
   if(!complete||preparing)matrix.copy(previousMatrix);
   if(preparing)signature='';
   renderer.setClearColor(clearColor,clearAlpha);
   renderer.setRenderTarget(previousTarget,previousFace,previousMip);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
  }
 }
 return {update,
  prepare(source,progress){if(!disposed)return withReflectionPreparation(T,renderer,scene,()=>update(source,progress,true));},
  invalidate(){revision++;signature='';uniforms.ready.value=0;},dispose(){if(disposed)return;disposed=true;target.dispose();for(const material of ownedMasks)material.dispose();}};
}
