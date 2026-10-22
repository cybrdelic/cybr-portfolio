import * as T from './vendor/three-r180/three.module.min.js';

/** A keyed, linear-HDR capture of the actual opaque room, not another studio map.
 * The explicit key owns all room/light changes and the capture position. Reusing
 * a key never follows animation or the view camera. Read .position for the
 * position that actually generated .texture. Capture after room shadows exist;
 * this helper reads those shadow maps and never overwrites them while hiding
 * unrelated renderables. Open room rays have alpha zero for environment fallback.
 */
export function createElementsRoomProbe(renderer,{size=256,resolution=size,near=.05,far=200}={}){
 if(!renderer?.render||!renderer?.setRenderTarget)throw new TypeError('The room probe requires the existing WebGL renderer');
 if(![256,512].includes(resolution))throw new RangeError('Room probe resolution must be 256 or 512');
 if(!Number.isFinite(near)||!Number.isFinite(far)||near<=0||far<=near)throw new RangeError('Room probe clipping distances must be finite and ordered');
 if(renderer.extensions?.has&&!renderer.extensions.has('EXT_color_buffer_float'))throw new Error('Room probe requires linear floating-point render targets');
 const target=new T.WebGLCubeRenderTarget(resolution,{type:T.HalfFloatType,format:T.RGBAFormat,
  minFilter:T.LinearFilter,magFilter:T.LinearFilter,generateMipmaps:false,depthBuffer:true,stencilBuffer:false});
 target.texture.name='ELEMENTS / actual opaque room';target.texture.colorSpace=T.LinearSRGBColorSpace;
 target.texture.mapping=T.CubeReflectionMapping;
 const camera=new T.CubeCamera(near,far,target),position=new T.Vector3(),requestedPosition=new T.Vector3();
 const viewport=new T.Vector4(),scissor=new T.Vector4(),clearColor=new T.Color();
 let disposed=false,capturing=false,cachedScene=null,cachedRoots=[];
 const stats={valid:false,captures:0,reuses:0,faces:0,resolution,key:null,calls:0,triangles:0,cpuSubmissionMs:0,lastError:null};
 const invalidate=()=>{stats.valid=false;};
 renderer.domElement?.addEventListener?.('webglcontextlost',invalidate);
 renderer.domElement?.addEventListener?.('webglcontextrestored',invalidate);
 function save(){
  renderer.getViewport(viewport);renderer.getScissor(scissor);renderer.getClearColor(clearColor);
  return {target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace?.()??0,mip:renderer.getActiveMipmapLevel?.()??0,
   viewport:viewport.clone(),scissor:scissor.clone(),scissorTest:renderer.getScissorTest(),clearColor:clearColor.clone(),clearAlpha:renderer.getClearAlpha(),
   autoClear:renderer.autoClear,autoClearColor:renderer.autoClearColor,autoClearDepth:renderer.autoClearDepth,autoClearStencil:renderer.autoClearStencil,
   toneMapping:renderer.toneMapping,exposure:renderer.toneMappingExposure,outputColorSpace:renderer.outputColorSpace,
   xrEnabled:renderer.xr?.enabled,shadowAutoUpdate:renderer.shadowMap?.autoUpdate,shadowNeedsUpdate:renderer.shadowMap?.needsUpdate,infoAutoReset:renderer.info?.autoReset};
 }
 function restore(saved){
  renderer.autoClear=saved.autoClear;renderer.autoClearColor=saved.autoClearColor;renderer.autoClearDepth=saved.autoClearDepth;renderer.autoClearStencil=saved.autoClearStencil;
  renderer.toneMapping=saved.toneMapping;renderer.toneMappingExposure=saved.exposure;renderer.outputColorSpace=saved.outputColorSpace;
  if(renderer.xr)renderer.xr.enabled=saved.xrEnabled;
  if(renderer.shadowMap){renderer.shadowMap.autoUpdate=saved.shadowAutoUpdate;renderer.shadowMap.needsUpdate=saved.shadowNeedsUpdate;}
  if(renderer.info)renderer.info.autoReset=saved.infoAutoReset;
  renderer.setClearColor(saved.clearColor,saved.clearAlpha);renderer.setRenderTarget(saved.target,saved.face,saved.mip);
  renderer.setViewport(saved.viewport);renderer.setScissor(saved.scissor);renderer.setScissorTest(saved.scissorTest);
 }
 function update({scene,receivers,position:nextPosition,key}={}){
  if(disposed)throw new Error('Room probe has been disposed');
  if(capturing)throw new Error('Room probe cannot recursively capture itself');
  if(!scene?.isScene)throw new TypeError('Room probe requires the actual scene');
  if(!(typeof key==='string'&&key.length||typeof key==='number'&&Number.isFinite(key)))throw new TypeError('Room probe requires an explicit stable room/light key');
  const roots=Array.isArray(receivers)?receivers:[receivers];
  if(!roots.length||roots.some(root=>!root?.isObject3D))throw new TypeError('Room probe receivers must be actual scene objects');
  const xyz=Array.isArray(nextPosition)?nextPosition:[nextPosition?.x,nextPosition?.y,nextPosition?.z];
  if(xyz.length!==3||!xyz.every(Number.isFinite))throw new TypeError('Room probe position must be a finite world-space point');
  if(stats.valid&&stats.key===key&&cachedScene===scene&&roots.length===cachedRoots.length&&roots.every((root,i)=>root===cachedRoots[i])){
   stats.reuses++;return false;
  }
  const allowed=new Set();
  for(const root of roots){
   let attached=false,visible=true;for(let object=root;object;object=object.parent){if(object===scene)attached=true;if(!object.visible)visible=false;}
   if(!attached)throw new Error('A room receiver is not attached to the captured scene');
   if(visible)root.traverseVisible(object=>{if(object.isMesh)allowed.add(object);});
  }
  if(!allowed.size)throw new Error('Room probe has no visible receiver meshes');
  const allowedAncestors=new Set();for(const object of allowed)for(let parent=object.parent;parent;parent=parent.parent)allowedAncestors.add(parent);
  const saved=save(),hidden=[],masked=[],background=scene.background,overrideMaterial=scene.overrideMaterial;
  const started=performance.now(),beforeCalls=renderer.info?.render?.calls||0,beforeTriangles=renderer.info?.render?.triangles||0;
  stats.valid=false;capturing=true;
  try{
   scene.traverse(object=>{
    if(object.visible&&(object.isMesh||object.isLine||object.isPoints||object.isSprite)&&!allowed.has(object)){
     // A non-receiver mesh can still parent a receiver. Suppress only that
     // parent's draw, not the child's entire traversal branch.
     if(allowedAncestors.has(object)){masked.push([object,object.layers.mask]);object.layers.mask=0;}
     else{hidden.push(object);object.visible=false;}
    }
   });
   scene.background=null;scene.overrideMaterial=null;
   renderer.autoClear=true;renderer.autoClearColor=true;renderer.autoClearDepth=true;renderer.autoClearStencil=false;
   renderer.toneMapping=T.NoToneMapping;renderer.toneMappingExposure=1;renderer.outputColorSpace=T.LinearSRGBColorSpace;
   if(renderer.xr)renderer.xr.enabled=false;
   // Do not rewrite the main scene's shadow maps with a temporary subset of
   // objects. Existing room shadows are shared lighting, not a separate bake.
   if(renderer.shadowMap){renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;}
   if(renderer.info)renderer.info.autoReset=false;
   renderer.setClearColor(0x000000,0);target.viewport.set(0,0,resolution,resolution);target.scissorTest=false;renderer.setScissorTest(false);
   requestedPosition.fromArray(xyz);camera.position.copy(requestedPosition);camera.updateMatrixWorld(true);
   camera.update(renderer,scene);
   position.copy(requestedPosition);cachedScene=scene;cachedRoots=[...roots];stats.key=key;stats.valid=true;
   stats.captures++;stats.faces+=6;stats.calls=(renderer.info?.render?.calls||0)-beforeCalls;stats.triangles=(renderer.info?.render?.triangles||0)-beforeTriangles;
   stats.cpuSubmissionMs=performance.now()-started;stats.lastError=null;
  }catch(error){stats.lastError=String(error?.message||error).slice(0,240);throw error;}
  finally{
   for(const object of hidden)object.visible=true;for(const[object,mask]of masked)object.layers.mask=mask;scene.background=background;scene.overrideMaterial=overrideMaterial;
   try{restore(saved);}catch(error){stats.valid=false;stats.lastError=String(error?.message||error).slice(0,240);throw error;}finally{capturing=false;}
  }
  return true;
 }
 function dispose(){
  if(disposed)return;disposed=true;stats.valid=false;
  renderer.domElement?.removeEventListener?.('webglcontextlost',invalidate);renderer.domElement?.removeEventListener?.('webglcontextrestored',invalidate);target.dispose();
 }
 return {update,dispose,invalidate,texture:target.texture,target,position,stats,get ready(){return stats.valid;}};
}
