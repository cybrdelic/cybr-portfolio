/** Compile the exact material/target combinations without drawing a frame. */
export async function prepareShaderVariants({THREE,renderer,variants,clock=()=>performance.now(),
  yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0)),cancelled=()=>false}){
  const started=clock(),records=[],finalized=new Set();
  for(const variant of variants){
    if(cancelled())throw Error('Shader preparation cancelled');
    const {scene,camera,target,objects}=variant;
    // Three.compile traverses invisible meshes too. A separate root limits it
    // to this pass's exact original geometry/materials; the real scene supplies
    // unchanged lights, fog and environment via compileAsync's third argument.
    const root=new THREE.Group();
    for(const entry of objects){
      const object=entry.object??entry,proxy=object.clone(false);
      proxy.geometry=entry.geometry??object.geometry;proxy.material=entry.material??object.material;
      root.add(proxy);
    }
    const state={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace?.()??0,mip:renderer.getActiveMipmapLevel?.()??0,
      viewport:renderer.getViewport?.(new THREE.Vector4()),scissor:renderer.getScissor?.(new THREE.Vector4()),
      scissorTest:renderer.getScissorTest?.(),background:scene.background,override:scene.overrideMaterial,
      autoClear:renderer.autoClear,toneMapping:renderer.toneMapping,toneMappingExposure:renderer.toneMappingExposure,
      outputColorSpace:renderer.outputColorSpace,shadow:renderer.shadowMap?{enabled:renderer.shadowMap.enabled,autoUpdate:renderer.shadowMap.autoUpdate,needsUpdate:renderer.shadowMap.needsUpdate}:null,xr:renderer.xr?.enabled};
    const at=clock();let pending;
    try{
      if('background' in variant)scene.background=variant.background;
      if(variant.field){scene.overrideMaterial=null;if(renderer.shadowMap)renderer.shadowMap.enabled=false;if(renderer.xr)renderer.xr.enabled=false;}
      renderer.setRenderTarget(target);
      pending=renderer.compileAsync(root,camera,scene);
    }finally{
      scene.background=state.background;scene.overrideMaterial=state.override;
      renderer.autoClear=state.autoClear;renderer.toneMapping=state.toneMapping;renderer.toneMappingExposure=state.toneMappingExposure;renderer.outputColorSpace=state.outputColorSpace;
      if(renderer.shadowMap&&state.shadow)Object.assign(renderer.shadowMap,state.shadow);if(renderer.xr)renderer.xr.enabled=state.xr;
      renderer.setRenderTarget(state.target,state.face,state.mip);
      if(state.viewport)renderer.setViewport(state.viewport);if(state.scissor)renderer.setScissor(state.scissor);if(state.scissorTest!==undefined)renderer.setScissorTest(state.scissorTest);
    }
    const submitMs=clock()-at,waitingAt=clock();
    // Live state is restored before any asynchronous shader polling begins.
    await pending;
    if(cancelled())throw Error('Shader preparation cancelled');
    const readyWaitMs=clock()-waitingAt;
    let reflectionMs=0,maxProgramFinalizeMs=0,programs=0;
    // r180 exposes these lazily populated program accessors. Compilation alone
    // leaves uniform/attribute reflection to the first render's synchronous R.
    for(const program of renderer.info.programs??[]){
      if(finalized.has(program))continue;
      const before=clock();program.getUniforms();program.getAttributes();
      const duration=clock()-before;reflectionMs+=duration;maxProgramFinalizeMs=Math.max(maxProgramFinalizeMs,duration);programs++;finalized.add(program);
      await yieldTask();if(cancelled())throw Error('Shader preparation cancelled');
    }
    records.push({name:variant.name,elapsedMs:clock()-at,submitMs,readyWaitMs,reflectionMs,maxProgramFinalizeMs,programs});
    await yieldTask();
  }
  return {mode:'exact original pass materials and targets; asynchronous compilation then lazy reflection',elapsedMs:clock()-started,variants:records};
}

export function visibleShaderObjects(scene,camera){
  const objects=[];scene.traverseVisible(object=>{
    if((object.isMesh||object.isPoints||object.isLine||object.isSprite)&&object.layers.test(camera.layers))objects.push(object);
  });return objects;
}
