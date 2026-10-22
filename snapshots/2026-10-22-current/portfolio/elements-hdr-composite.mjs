import * as T from './vendor/three-r180/three.module.min.js';

// One reusable linear HDR stage target, then one display transform. Transparent
// emitters must write linear radiance (premultiplied when their material says
// premultipliedAlpha=true). ACES on each emitter before blending is not equivalent
// to ACES on the combined scene and destroys low-opacity, high-radiance flames.
// This is the portfolio's opaque presentation surface, not an export format for
// compositing additive zero-opacity emission over an unknown external background.
export const ELEMENTS_HDR_VERTEX=`
varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}
`;
export const ELEMENTS_HDR_FRAGMENT=`
uniform sampler2D tLinearStage;
varying vec2 vUv;
void main(){
 gl_FragColor=vec4(texture2D(tLinearStage,vUv).rgb,1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}
`;

function supportedSamples(renderer,requested){
 const maximum=Math.max(0,Math.floor(Math.min(requested,renderer.capabilities?.maxSamples??0)));
 if(maximum<1)return 0;
 const gl=renderer.getContext?.();
 // MAX_SAMPLES alone does not guarantee RGBA16F multisampling. Intersect the
 // actual floating-point colour/depth renderbuffer sample counts instead.
 if(!gl?.getInternalformatParameter)return 0;
 try{
  const colour=Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA16F,gl.SAMPLES)||[]);
  const depth=Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,gl.SAMPLES)||[]);
  return Math.max(0,...colour.filter(n=>Number.isInteger(n)&&n<=maximum&&depth.includes(n)));
 }catch{return 0;}
}

function copyCounters(renderer){
 const render=renderer.info?.render||{};
 return {calls:render.calls||0,triangles:render.triangles||0,lines:render.lines||0,points:render.points||0};
}
function subtract(a,b){return Object.fromEntries(Object.keys(a).map(key=>[key,a[key]-b[key]]));}

// Bottom-left drawing-buffer pixel coordinates, not CSS pixels. The caller's
// rectangle must cover every changing pixel, including transparent/shadow
// support. Invalid/offscreen projections deliberately request a full redraw.
function rectangle(value,width,height){
 if(!value||typeof value!=='object')return null;
 const x=Array.isArray(value)?value[0]:value.x,y=Array.isArray(value)?value[1]:value.y;
 const w=Array.isArray(value)?value[2]:value.width,h=Array.isArray(value)?value[3]:value.height;
 if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)return null;
 const left=Math.max(0,Math.floor(x)),bottom=Math.max(0,Math.floor(y));
 const right=Math.min(width,Math.ceil(x+w)),top=Math.min(height,Math.ceil(y+h));
 return right>left&&top>bottom?[left,bottom,right-left,top-bottom]:null;
}
function unionGuard(a,b,width,height){
 const left=Math.max(0,Math.min(a[0],b[0])-2),bottom=Math.max(0,Math.min(a[1],b[1])-2);
 const right=Math.min(width,Math.max(a[0]+a[2],b[0]+b[2])+2),top=Math.min(height,Math.max(a[1]+a[3],b[1]+b[3])+2);
 return [left,bottom,right-left,top-bottom];
}
function stableKey(value){return typeof value==='string'&&value.length>0||typeof value==='number'&&Number.isFinite(value);}
function cameraSignature(camera){
 return [...(camera.matrixWorld?.elements||[]),...(camera.projectionMatrix?.elements||[]),camera.near,camera.far];
}
function sameCamera(a,b){return a?.length===b.length&&b.every((value,index)=>Object.is(value,a[index]));}

export function createElementsHDRComposite(renderer,{samples=4}={}){
 if(!renderer?.render||!renderer?.setRenderTarget)throw new TypeError('HDR composition requires the existing WebGL renderer');
 if(!Number.isFinite(samples)||samples<0)throw new TypeError('HDR samples must be a finite nonnegative number');
 if(renderer.extensions?.has&&!renderer.extensions.has('EXT_color_buffer_float'))throw new Error('Linear HDR composition requires EXT_color_buffer_float; refusing an LDR quality downgrade');
 const actualSamples=supportedSamples(renderer,Math.floor(samples));
 // Implicit multisampled-render-to-texture storage may be discarded during
 // resolve. Three also explicitly invalidates MSAA colour on OculusBrowser.
 // Neither path can promise retained per-sample data, so keep full redraws.
 const retainSamples=actualSamples===0||(!renderer.extensions?.has?.('WEBGL_multisampled_render_to_texture')&&!/OculusBrowser/.test(globalThis.navigator?.userAgent||''));
 const target=new T.WebGLRenderTarget(1,1,{format:T.RGBAFormat,type:T.HalfFloatType,
  minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:true,stencilBuffer:false,samples:actualSamples});
 target.texture.name='ELEMENTS / linear HDR stage';target.texture.colorSpace=T.LinearSRGBColorSpace;
 target.texture.generateMipmaps=false;
 // Refraction reads a distinct resolved texture. Never sample the final target
 // while it is attached for drawing, or replace its per-sample coverage with a
 // resolved fullscreen copy. The final scene still retains its original MSAA.
 const opaqueTarget=new T.WebGLRenderTarget(1,1,{format:T.RGBAFormat,type:T.HalfFloatType,
  minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:true,stencilBuffer:false,samples:actualSamples});
 opaqueTarget.texture.name='ELEMENTS / opaque linear backdrop';opaqueTarget.texture.colorSpace=T.LinearSRGBColorSpace;
 opaqueTarget.texture.generateMipmaps=false;
 opaqueTarget.depthTexture=new T.DepthTexture(1,1,T.UnsignedIntType);
 opaqueTarget.depthTexture.name='ELEMENTS / resolved opaque depth';
 opaqueTarget.depthTexture.minFilter=opaqueTarget.depthTexture.magFilter=T.NearestFilter;
 opaqueTarget.depthTexture.generateMipmaps=false;
 opaqueTarget.resolveDepthBuffer=true;
 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
 geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,2,0,0,2],2));
 const material=new T.ShaderMaterial({name:'ELEMENTS / single display transform',
  uniforms:{tLinearStage:{value:target.texture}},vertexShader:ELEMENTS_HDR_VERTEX,fragmentShader:ELEMENTS_HDR_FRAGMENT,
  depthTest:false,depthWrite:false,transparent:false,blending:T.NoBlending,toneMapped:true});
 const displayScene=new T.Scene(),displayCamera=new T.Camera(),triangle=new T.Mesh(geometry,material);
 triangle.frustumCulled=false;displayScene.add(triangle);
 const bufferSize=new T.Vector2(),viewport=new T.Vector4(),scissor=new T.Vector4(),clearColour=new T.Color();
 let disposed=false,rendering=false;
 const cache={valid:false,key:null,scene:null,camera:null,signature:null,overlay:null,rect:null};
 const opaqueCache={valid:false,key:null,scene:null,camera:null,overlay:null,signature:null};
 const invalidate=()=>{cache.valid=false;opaqueCache.valid=false;};
 renderer.domElement?.addEventListener?.('webglcontextlost',invalidate);
 renderer.domElement?.addEventListener?.('webglcontextrestored',invalidate);
 const stats={frames:0,resizes:0,width:1,height:1,samples:actualSamples,requestedSamples:Math.floor(samples),
  partialFrames:0,fullFrames:0,opaqueCaptures:0,opaqueReuses:0,retainedSamplesSupported:retainSamples,redraw:{mode:'full',rect:[0,0,1,1],reason:'initial'},
  opaque:{calls:0,triangles:0,lines:0,points:0},opaqueBackdrop:{enabled:false,reused:false},
  scene:{calls:0,triangles:0,lines:0,points:0},display:{calls:0,triangles:0,lines:0,points:0},total:{calls:0,triangles:0,lines:0,points:0}};

 function resize(width,height){
  if(disposed)throw new Error('HDR compositor has been disposed');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new TypeError('HDR target dimensions must be positive drawing-buffer pixel integers');
  if(target.width===width&&target.height===height)return false;
  target.setSize(width,height);opaqueTarget.setSize(width,height);invalidate();stats.width=width;stats.height=height;stats.resizes++;return true;
 }

 function save(){
  renderer.getViewport(viewport);renderer.getScissor(scissor);renderer.getClearColor(clearColour);
  return {target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace?.()??0,mip:renderer.getActiveMipmapLevel?.()??0,
   viewport:viewport.clone(),scissor:scissor.clone(),scissorTest:renderer.getScissorTest(),
   clearColour:clearColour.clone(),clearAlpha:renderer.getClearAlpha(),autoClear:renderer.autoClear,
   autoClearColor:renderer.autoClearColor,autoClearDepth:renderer.autoClearDepth,autoClearStencil:renderer.autoClearStencil,
   toneMapping:renderer.toneMapping,exposure:renderer.toneMappingExposure,outputColorSpace:renderer.outputColorSpace,
   infoAutoReset:renderer.info?.autoReset};
 }
 function restore(saved){
  renderer.toneMapping=saved.toneMapping;renderer.toneMappingExposure=saved.exposure;renderer.outputColorSpace=saved.outputColorSpace;
  renderer.autoClear=saved.autoClear;renderer.autoClearColor=saved.autoClearColor;
  renderer.autoClearDepth=saved.autoClearDepth;renderer.autoClearStencil=saved.autoClearStencil;
  if(renderer.info)renderer.info.autoReset=saved.infoAutoReset;
  renderer.setClearColor(saved.clearColour,saved.clearAlpha);
  renderer.setRenderTarget(saved.target,saved.face,saved.mip);
  renderer.setViewport(saved.viewport);renderer.setScissor(saved.scissor);renderer.setScissorTest(saved.scissorTest);
 }

 function render(scene,camera,{backgroundKey=null,dirtyRect=null,overlay=null}={}){
  if(disposed)throw new Error('HDR compositor has been disposed');
  if(rendering)throw new Error('HDR composition cannot recursively render into its own target');
  if(overlay&&(overlay===scene||typeof overlay.visible!=='boolean'))throw new TypeError('The refraction overlay must be a scene object with a boolean visible property, not the entire scene');
  renderer.getDrawingBufferSize(bufferSize);
  resize(Math.max(1,Math.round(bufferSize.x)),Math.max(1,Math.round(bufferSize.y)));
  camera.updateWorldMatrix?.(true,false);
  const signature=cameraSignature(camera);
  const currentRect=rectangle(dirtyRect,target.width,target.height),validKey=stableKey(backgroundKey);
  const reuse=retainSamples&&validKey&&currentRect&&cache.valid&&cache.key===backgroundKey&&cache.scene===scene&&cache.camera===camera&&cache.overlay===overlay&&sameCamera(cache.signature,signature);
  const reuseOpaque=Boolean(overlay&&validKey&&opaqueCache.valid&&opaqueCache.key===backgroundKey&&opaqueCache.scene===scene&&opaqueCache.camera===camera&&opaqueCache.overlay===overlay&&sameCamera(opaqueCache.signature,signature));
  const drawRect=reuse?unionGuard(cache.rect,currentRect,target.width,target.height):[0,0,target.width,target.height];
  const reason=reuse?'stable background; redraw previous/current overlay union':!retainSamples?'multisample storage retention unavailable':!validKey?'no stable background key':!currentRect?'invalid overlay projection':'background invalidated';
  const saved=save();rendering=true;
  // A failed scene or display pass must never leave a reusable partial frame.
  cache.valid=false;
  try{
   if(renderer.info){if(saved.infoAutoReset)renderer.info.reset();renderer.info.autoReset=false;}
   const before=copyCounters(renderer);
   renderer.autoClear=false;
   renderer.toneMapping=T.NoToneMapping;renderer.toneMappingExposure=1;renderer.outputColorSpace=T.LinearSRGBColorSpace;
   if(overlay&&!reuseOpaque){
    opaqueCache.valid=false;
    opaqueTarget.viewport.set(0,0,opaqueTarget.width,opaqueTarget.height);opaqueTarget.scissorTest=false;
    renderer.setRenderTarget(opaqueTarget);renderer.setScissorTest(false);renderer.clear(true,true,false);
    const visible=overlay.visible;
    try{overlay.visible=false;renderer.render(scene,camera);}
    finally{overlay.visible=visible;}
    // WebGLRenderer resolves a multisampled render target's color and depth at
    // the end of render(). The next scene pass binds another target entirely.
    opaqueCache.valid=Boolean(validKey);opaqueCache.key=backgroundKey;opaqueCache.scene=scene;opaqueCache.camera=camera;opaqueCache.overlay=overlay;opaqueCache.signature=cameraSignature(camera);
    stats.opaqueCaptures++;
   }else if(reuseOpaque){stats.opaqueReuses++;}
   else{opaqueCache.valid=false;}
   const afterOpaque=copyCounters(renderer);
   target.viewport.set(0,0,target.width,target.height);target.scissor.fromArray(drawRect);target.scissorTest=Boolean(reuse);
   // RenderTarget scissor is already in drawing-buffer pixels. Calling
   // renderer.setScissor here would multiply it by the canvas pixel ratio.
   renderer.setRenderTarget(target);renderer.setScissorTest(Boolean(reuse));renderer.clear(true,true,false);
   renderer.render(scene,camera);
   const afterScene=copyCounters(renderer);
   renderer.toneMapping=saved.toneMapping;renderer.toneMappingExposure=saved.exposure;renderer.outputColorSpace=saved.outputColorSpace;
   renderer.setRenderTarget(null);
   const ratio=renderer.getPixelRatio?.()||1;
   renderer.setViewport(0,0,target.width/ratio,target.height/ratio);renderer.setScissorTest(false);
   renderer.render(displayScene,displayCamera);
   const afterDisplay=copyCounters(renderer);
   stats.opaque=subtract(afterOpaque,before);stats.opaqueBackdrop={enabled:Boolean(overlay),reused:reuseOpaque};
   stats.scene=subtract(afterScene,afterOpaque);stats.display=subtract(afterDisplay,afterScene);stats.total=subtract(afterDisplay,before);stats.frames++;
   stats.redraw={mode:reuse?'partial':'full',rect:[...drawRect],reason};
   if(reuse)stats.partialFrames++;else stats.fullFrames++;
   cache.valid=Boolean(retainSamples&&validKey&&currentRect);cache.key=backgroundKey;cache.scene=scene;cache.camera=camera;cache.signature=cameraSignature(camera);cache.overlay=overlay;cache.rect=currentRect;
  }catch(error){invalidate();throw error;}
  finally{try{restore(saved);}catch(error){invalidate();throw error;}finally{rendering=false;}}
  return stats;
 }

 function prepareDisplay(){
  if(disposed)throw new Error('HDR compositor has been disposed');
  // Synchronous compile does not leave renderer state changed across an await.
  const saved=save();
  try{renderer.setRenderTarget(null);renderer.compile(displayScene,displayCamera);}
  finally{restore(saved);}
 }
 function dispose(){if(disposed)return;disposed=true;invalidate();renderer.domElement?.removeEventListener?.('webglcontextlost',invalidate);renderer.domElement?.removeEventListener?.('webglcontextrestored',invalidate);target.dispose();opaqueTarget.dispose();geometry.dispose();material.dispose();}
 return {render,resize,prepareDisplay,dispose,invalidate,stats,target,opaqueTarget};
}
