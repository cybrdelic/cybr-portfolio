// Compile one visible shader variant per task, not a whole chapter in one
// synchronous driver submission. Meshes keep their original scene ownership.
const uploaded=new WeakSet();
const backgrounds=new WeakMap();
const rendererDepthMaterials=new WeakMap();
export function preparationSnapshot(T,source,camera){
 source.updateMatrixWorld(true);camera.updateMatrixWorld(true);
 const frustum=new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const shadowFrusta=[],shadows=new Map();source.traverseVisible(light=>{if(light.isLight&&light.castShadow&&light.shadow?.updateMatrices){
  // Frustum discovery runs at a temporarily staged chapter pose. Updating
  // the live shadow here changes its sampling matrix without redrawing its
  // depth map. Restoring the light transform alone cannot restore that pair,
  // especially when a held chapter intentionally caches its shadow map.
  const shadow=light.shadow.clone();
  // Reuse only the already allocated textures; all mutable camera/matrix/
  // frustum state belongs to this preparation snapshot, never the live light.
  shadow.map=light.shadow.map;shadow.mapPass=light.shadow.mapPass;
  shadow.autoUpdate=false;shadow.needsUpdate=false;shadows.set(light,shadow);
  const faces=light.isPointLight?6:1;
  for(let face=0;face<faces;face++){shadow.updateMatrices(light,face);shadowFrusta.push(shadow.getFrustum().clone());}
 }});
 const scene=new T.Scene();scene.background=source.background;scene.environment=source.environment;
 scene.backgroundRotation.copy(source.backgroundRotation);scene.environmentRotation.copy(source.environmentRotation);
 scene.backgroundIntensity=source.backgroundIntensity;scene.environmentIntensity=source.environmentIntensity;scene.fog=source.fog;
 source.traverseVisible(object=>{
  if(!(object.isLight||object.isMesh||object.isLine||object.isPoints||object.isSprite))return;
  if(!object.isLight&&object.frustumCulled&&!frustum.intersectsObject(object)&&!(object.castShadow&&shadowFrusta.some(f=>f.intersectsObject(object))))return;
  const copy=object.clone(false);copy.matrixAutoUpdate=false;copy.matrix.copy(object.matrixWorld);
  if(shadows.has(object))copy.shadow=shadows.get(object);
  if(object.target){copy.target=object.target.clone(false);copy.target.position.setFromMatrixPosition(object.target.matrixWorld);copy.target.updateMatrixWorld(true);}
  scene.add(copy);
 });
 scene.updateMatrixWorld(true);return {scene,camera:camera.clone()};
}
export function observeBackgroundPrograms(renderer){
 const direct=renderer.renderBufferDirect;
 renderer.renderBufferDirect=function(camera,scene,geometry,material,object,group){
  if(material.name==='BackgroundCubeMaterial'||material.name==='BackgroundMaterial')backgrounds.set(renderer,object);
  return direct.call(this,camera,scene,geometry,material,object,group);
 };
 return ()=>{renderer.renderBufferDirect=direct;};
}
export async function prepareVisiblePrograms(T,renderer,scene,camera){
 // Let Three construct its actual background material without issuing the
 // first shader draw. Its environment conversion and uniform bindings remain
 // native; both output variants can then use compileAsync below.
 if(scene.background&&renderer.getRenderTarget){
  await new Promise(resolve=>setTimeout(resolve,0));
  const backdrop=new T.Scene();backdrop.background=scene.background;backdrop.backgroundRotation.copy(scene.backgroundRotation);backdrop.backgroundIntensity=scene.backgroundIntensity;backdrop.userData.preparingBuffers=true;
  const target=new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,colorSpace:T.LinearSRGBColorSpace}),previous=renderer.getRenderTarget(),direct=renderer.renderBufferDirect;
  renderer.renderBufferDirect=function(camera,scene,geometry,material,object,group){if(material.name==='BackgroundCubeMaterial'||material.name==='BackgroundMaterial'){backgrounds.set(renderer,object);return;}return direct.call(this,camera,scene,geometry,material,object,group);};
  try{renderer.setRenderTarget(target);renderer.render(backdrop,camera);}finally{renderer.renderBufferDirect=direct;renderer.setRenderTarget(previous);target.dispose();}
 }
 const objects=[],allObjects=[],geometries=[],seen=new Set();
 scene.traverseVisible(object=>{
  if(!(object.isMesh||object.isLine||object.isPoints||object.isSprite))return;
  allObjects.push(object);
  if(object.geometry&&!uploaded.has(object.geometry)&&!geometries.includes(object.geometry))geometries.push(object.geometry);
  const materials=Array.isArray(object.material)?object.material:[object.material];
  const key=[materials.map(m=>m.uuid+':'+m.version).join(','),object.type,Object.keys(object.geometry?.attributes||{}).sort().join(','),!!object.isSkinnedMesh,!!object.isInstancedMesh].join('/');
  if(!seen.has(key)){seen.add(key);objects.push(object);}
 });
 const background=backgrounds.get(renderer);if(scene.background&&background)objects.push(background);
 // Upload buffers separately from the first beauty/shadow draw. A zero draw
 // range still exercises Three's geometry upload path, without shading pixels
 // or changing the authored meshes. This also preallocates the exact buffers.
 if(renderer.getRenderTarget&&geometries.length){
  const staging=new T.Scene(),material=new T.MeshBasicMaterial(),mesh=new T.Mesh(undefined,material),target=new T.WebGLRenderTarget(1,1);
  mesh.frustumCulled=false;staging.userData.preparingBuffers=true;staging.add(mesh);
  try{for(const geometry of geometries){
   await new Promise(resolve=>setTimeout(resolve,0));
   const previous=renderer.getRenderTarget(),shadows=renderer.shadowMap.enabled,range={...geometry.drawRange};
   try{mesh.geometry=geometry;geometry.setDrawRange(0,0);renderer.shadowMap.enabled=false;renderer.setRenderTarget(target);renderer.render(staging,camera);uploaded.add(geometry);}
   finally{geometry.setDrawRange(range.start,range.count);renderer.setRenderTarget(previous);renderer.shadowMap.enabled=shadows;}
  }}finally{target.dispose();material.dispose();}
 }
 const linearTarget=renderer.getRenderTarget?new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,colorSpace:T.LinearSRGBColorSpace}):null;
 if(linearTarget){const size=renderer.getDrawingBufferSize(new T.Vector2());linearTarget.setSize(size.x,size.y);linearTarget.scissor.set(0,0,1,1);linearTarget.scissorTest=true;}
 const displayTarget=linearTarget?new T.WebGLRenderTarget(linearTarget.width,linearTarget.height,{colorSpace:renderer.outputColorSpace}):null;
 if(displayTarget){
  // Three r180 uses this target capability for display-referred offscreen
  // output: otherwise it silently disables tone mapping and compiles a
  // linear variant, leaving the actual presentation shader cold. This does
  // not start an XR session or change the renderer's XR state.
  displayTarget.isXRRenderTarget=true;
  displayTarget.scissor.set(0,0,1,1);displayTarget.scissorTest=true;
 }
 if(!rendererDepthMaterials.has(renderer))rendererDepthMaterials.set(renderer,new Map());
 const depthMaterials=rendererDepthMaterials.get(renderer);
 try{for(const object of objects){
  await new Promise(resolve=>setTimeout(resolve,0));
  const view=new T.Group();view.traverse=visit=>visit(object);
  await renderer.compileAsync(view,camera,scene);
  // The transmission backdrop is a DIFFERENT shader variant: linear output,
  // no display tone curve. Compiling only the beauty variant leaves a large
  // synchronous compiler stall hidden in the first refraction draw.
  if(linearTarget){
   const target=renderer.getRenderTarget(),tone=renderer.toneMapping;let ready;
   try{renderer.setRenderTarget(linearTarget);renderer.toneMapping=T.NoToneMapping;ready=renderer.compileAsync(view,camera,scene);}
   finally{renderer.setRenderTarget(target);renderer.toneMapping=tone;}
   await ready;
   // Drivers may defer executable/VAO finalization until the first draw even
   // after KHR compilation completes. Warm that exact variant with one
   // triangle with a one-pixel scissor, separately from the full landscape draw.
   // An empty scissor lets drivers skip executable finalization completely.
   // Use the final viewport so transmission attachments are not resized again
   // (and synchronously reallocated) on the first presented frame.
   for(const candidate of allObjects.filter(o=>o.material===object.material)){
   if(candidate.isMesh&&!candidate.isInstancedMesh&&candidate!==background){
    await new Promise(resolve=>setTimeout(resolve,0));
    const warmScene=new T.Scene();warmScene.environment=scene.environment;warmScene.environmentRotation.copy(scene.environmentRotation);warmScene.environmentIntensity=scene.environmentIntensity;warmScene.userData.preparingBuffers=true;
    scene.traverseVisible(light=>{if(light.isLight){const copy=light.clone();copy.matrixAutoUpdate=false;copy.matrix.copy(light.matrixWorld);if(light.shadow)copy.shadow=light.shadow;warmScene.add(copy);}});
    const copy=candidate.clone(false);copy.matrixAutoUpdate=false;copy.matrix.copy(candidate.matrixWorld);copy.frustumCulled=false;copy.castShadow=false;warmScene.add(copy);
    const geometry=candidate.geometry,range={...geometry.drawRange},previous=renderer.getRenderTarget(),tone=renderer.toneMapping;
    if(candidate.castShadow&&!candidate.customDepthMaterial&&!candidate.material.alphaTest&&!candidate.material.displacementMap){
     const side=candidate.material.shadowSide??(candidate.material.side===T.FrontSide?T.BackSide:candidate.material.side===T.BackSide?T.FrontSide:T.DoubleSide);
     if(!depthMaterials.has(side))depthMaterials.set(side,new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,side}));
     const original=copy.material;copy.material=depthMaterials.get(side);let depthReady;
     try{renderer.setRenderTarget(linearTarget);renderer.toneMapping=T.NoToneMapping;depthReady=renderer.compileAsync(warmScene,camera,scene);}
     finally{renderer.setRenderTarget(previous);renderer.toneMapping=tone;}
     await depthReady;
     const shadowUpdate=renderer.shadowMap.needsUpdate;
     try{geometry.setDrawRange(range.start,Math.min(3,range.count));renderer.setRenderTarget(linearTarget);renderer.toneMapping=T.NoToneMapping;renderer.shadowMap.needsUpdate=false;renderer.render(warmScene,camera);}
     finally{geometry.setDrawRange(range.start,range.count);renderer.setRenderTarget(previous);renderer.toneMapping=tone;renderer.shadowMap.needsUpdate=shadowUpdate;copy.material=original;}
     await new Promise(resolve=>setTimeout(resolve,0));
    }
    // Asset arrivals may invalidate shadows during any await. Capture only
    // around this synchronous draw, never across asynchronous preparation.
    const linearShadowUpdate=renderer.shadowMap.needsUpdate;
    try{geometry.setDrawRange(range.start,Math.min(3,range.count));renderer.setRenderTarget(linearTarget);renderer.toneMapping=T.NoToneMapping;renderer.shadowMap.needsUpdate=false;renderer.render(warmScene,camera);}
    finally{geometry.setDrawRange(range.start,range.count);renderer.setRenderTarget(previous);renderer.toneMapping=tone;renderer.shadowMap.needsUpdate=linearShadowUpdate;}
    await new Promise(resolve=>setTimeout(resolve,0));
    const autoClear=renderer.autoClear,scissor=renderer.getScissor(new T.Vector4()),scissorTest=renderer.getScissorTest(),displayShadowUpdate=renderer.shadowMap.needsUpdate;
    // Never touch the presentation framebuffer during preparation. With
    // preserveDrawingBuffer=false, even an empty-scissor draw can discard
    // the outgoing chapter and show a blank canvas until compilation ends.
    try{geometry.setDrawRange(range.start,Math.min(3,range.count));renderer.setRenderTarget(displayTarget);renderer.autoClear=false;renderer.setScissor(0,0,1,1);renderer.setScissorTest(true);renderer.shadowMap.needsUpdate=false;renderer.render(warmScene,camera);}
    finally{geometry.setDrawRange(range.start,range.count);renderer.autoClear=autoClear;renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);renderer.setRenderTarget(previous);renderer.shadowMap.needsUpdate=displayShadowUpdate;}
   }
   }
  }
 }}finally{linearTarget?.dispose();displayTarget?.dispose();}
}
