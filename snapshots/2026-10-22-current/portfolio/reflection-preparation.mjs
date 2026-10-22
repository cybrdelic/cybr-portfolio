// Exercise the real reflection scene/camera identities and full-size targets,
// but never present the partial result. Three caches transmission attachments
// by BOTH scene and camera, so a cloned warm-up scene cannot allocate these.
export function withReflectionPreparation(T,renderer,scene,draw){
 const setTarget=renderer.setRenderTarget,setScissor=renderer.setScissor,setScissorTest=renderer.setScissorTest,direct=renderer.renderBufferDirect;
 const previousTarget=renderer.getRenderTarget(),face=renderer.getActiveCubeFace?.()??0,mip=renderer.getActiveMipmapLevel?.()??0;
 const viewport=renderer.getViewport(new T.Vector4()),scissor=renderer.getScissor(new T.Vector4()),scissorTest=renderer.getScissorTest();
 const shadowAuto=renderer.shadowMap.autoUpdate,shadowDirty=renderer.shadowMap.needsUpdate;
 const hadPreparing=Object.hasOwn(scene.userData,'preparingBuffers'),preparing=scene.userData.preparingBuffers;
 const ratio=renderer.getPixelRatio?.()||1;
 const onePixel=()=>{setScissor.call(renderer,0,0,1/ratio,1/ratio);setScissorTest.call(renderer,true);};
 // Preserve shadow-enabled/light counts (shader defines), but never write
 // incomplete caster depth into the maps subsequently used by beauty.
 renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
 scene.userData.preparingBuffers=true;
 renderer.setRenderTarget=function(...args){const result=setTarget.apply(this,args);onePixel();return result;};
 renderer.setScissor=function(){return setScissor.call(this,0,0,1/ratio,1/ratio);};
 renderer.setScissorTest=function(){return setScissorTest.call(this,true);};
 if(typeof direct==='function')renderer.renderBufferDirect=function(camera,scene,geometry,material,object,group){
  if(this.getRenderTarget()===null)throw new Error('Reflection preparation cannot draw to the presentation framebuffer');
  const range={...geometry.drawRange},count=object.isInstancedMesh?object.count:null;
  const start=Math.max(range.start,group?.start??0),end=Math.min(range.start+range.count,group?group.start+group.count:Infinity);
  const primitive=object.isPoints?1:object.isLine?2:3;
  try{
   geometry.setDrawRange(start,Math.max(0,Math.min(primitive,end-start)));
   if(object.isInstancedMesh)object.count=Math.min(1,count);
   return direct.call(this,camera,scene,geometry,material,object,group);
  }finally{geometry.setDrawRange(range.start,range.count);if(object.isInstancedMesh)object.count=count;}
 };
 try{return draw();}
 finally{
  renderer.setRenderTarget=setTarget;renderer.setScissor=setScissor;renderer.setScissorTest=setScissorTest;
  if(typeof direct==='function')renderer.renderBufferDirect=direct;
  renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=shadowDirty;
  if(hadPreparing)scene.userData.preparingBuffers=preparing;else delete scene.userData.preparingBuffers;
  setTarget.call(renderer,previousTarget,face,mip);renderer.setViewport(viewport);setScissor.call(renderer,scissor);setScissorTest.call(renderer,scissorTest);
 }
}
