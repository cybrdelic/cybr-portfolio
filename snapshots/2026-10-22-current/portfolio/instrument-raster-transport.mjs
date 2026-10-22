// Current-pose transmission is evaluated once on a smaller deterministic HDR
// target. Final CAD visibility and physical reflection shading stay native size.
const optical = material => (material?.userData?.cadTransmission ?? 0) > 0;
const parameterNames = ['n','v','roughness','diffuseColor','specularColor','specularF90','position',
  'modelMatrix','viewMatrix','projMatrix','dispersion','ior','thickness','attenuationColor','attenuationDistance'];

export function transportDimensions(width, height, scale = .5) {
  if (![width,height,scale].every(Number.isFinite) || width < 1 || height < 1 || scale <= 0 || scale > 1)
    throw Error('Invalid optical transport dimensions or scale');
  const sampleCount = value => {
    const scaled = value * scale;
    // Preserve exact decimal pixel counts such as 720 * .35 = 252 when their
    // floating representation lands one ulp below the integer.
    return Math.max(1,Math.floor(scaled + Number.EPSILON * Math.max(1,Math.abs(scaled)) * 4));
  };
  return [sampleCount(width),sampleCount(height)];
}

// Conservative clip-space projection of actual optical mesh bounds. A box
// crossing the near plane uses the full target rather than clipping its rays.
export function transportRegion(bounds,viewProjection,width,height,padding=2) {
  transportDimensions(width,height,1);
  const matrix=viewProjection?.elements??viewProjection;
  if(!matrix||matrix.length!==16||!Number.isFinite(padding)||padding<0)throw Error('Invalid optical capture region');
  let left=Infinity,bottom=Infinity,right=-Infinity,top=-Infinity;
  for(const box of bounds){const minimum=box.min?.toArray?.()??box.min,maximum=box.max?.toArray?.()??box.max;
    if(!minimum||!maximum||minimum.length!==3||maximum.length!==3||[...minimum,...maximum].some(value=>!Number.isFinite(value)))continue;
    for(let i=0;i<8;i++){
      const point=[i&1?maximum[0]:minimum[0],i&2?maximum[1]:minimum[1],i&4?maximum[2]:minimum[2],1];
      const clip=[0,1,2,3].map(row=>point.reduce((sum,value,column)=>sum+matrix[column*4+row]*value,0));
      if(clip[3]<=0||clip[2]<-clip[3])return[0,0,width,height];
      const x=(clip[0]/clip[3]*.5+.5)*width,y=(clip[1]/clip[3]*.5+.5)*height;
      left=Math.min(left,x);bottom=Math.min(bottom,y);right=Math.max(right,x);top=Math.max(top,y);
    }
  }
  if(left===Infinity)return[0,0,0,0];
  const x=Math.max(0,Math.min(width,Math.floor(left-padding))),y=Math.max(0,Math.min(height,Math.floor(bottom-padding)));
  const endX=Math.max(x,Math.min(width,Math.ceil(right+padding))),endY=Math.max(y,Math.min(height,Math.ceil(top+padding)));
  return[x,y,endX-x,endY-y];
}

function wrapRefraction(fragment,{specializeCapture=false,capture=false}={}) {
  const matches = [...fragment.matchAll(/\bvec4\s+getIBLVolumeRefraction\s*\(/g)];
  if (matches.length !== 1) throw Error('Transport requires one expanded CAD refraction function');
  const start = matches[0].index, open = fragment.indexOf('{', start);
  if (open < 0) throw Error('Missing CAD refraction function body');
  const signature = fragment.slice(start,open), args = signature.slice(signature.indexOf('(')+1,signature.lastIndexOf(')'))
    .split(',').map(argument => argument.trim().match(/\b(\w+)\s*$/)?.[1]);
  if (args.length !== parameterNames.length || args.some((name,i) => name !== parameterNames[i]))
    throw Error('Unsupported CAD refraction function parameter ABI');
  let end = open + 1, depth = 1;
  for (; end < fragment.length && depth; end++) { if (fragment[end] === '{') depth++;if (fragment[end] === '}') depth--; }
  if (depth) throw Error('Unbalanced CAD refraction function body');
  const exact = fragment.slice(start,end).replace('getIBLVolumeRefraction','cadExactVolumeRefraction');
  const wrapper = `${signature}{
    if (cadTransportCapture) {
      cadTransportResult = cadExactVolumeRefraction(${args.join(',')});
      return cadTransportResult;
    }
    vec2 uv = gl_FragCoord.xy / cadTransportFullSize;
    return texture2D(cadTransportMap, uv);
  }`;
  const declarations = 'uniform bool cadTransportCapture;\nuniform sampler2D cadTransportMap;\nuniform vec2 cadTransportFullSize;\nvec4 cadTransportResult = vec4(0.0);\n';
  if(specializeCapture){const specialized=capture?`vec4 cadTransportResult=vec4(0.);\n${exact}\n${signature}{cadTransportResult=cadExactVolumeRefraction(${args.join(',')});return cadTransportResult;}`:`uniform sampler2D cadTransportMap;uniform vec2 cadTransportFullSize;\n${signature}{return texture2D(cadTransportMap,gl_FragCoord.xy/cadTransportFullSize);}`;fragment=fragment.slice(0,start)+specialized+fragment.slice(end);}else fragment = fragment.slice(0,start) + declarations + exact + '\n' + wrapper + fragment.slice(end);
  const output = '#include <opaque_fragment>';
  if (fragment.split(output).length !== 2) throw Error('Missing unique physical opaque output chunk');
  // Return before tone/color transforms, fog, premultiplication or dithering.
  // This target stores the transport function's raw RGB and alpha, not PBR.
  if(specializeCapture)return capture?fragment.replace(output,'gl_FragColor=cadTransportResult;return;'):fragment;
  return fragment.replace(output,`if (cadTransportCapture) {
    gl_FragColor = cadTransportResult;
    return;
  }
  ${output}`);
}

export function setupRasterTransport({THREE,renderer,scene,objects = [],cableMeshes = [],fullSize,scale = .5,sourceRevision:sourceRevisionProvider=()=>0,specializeCapture=false}) {
  if (!THREE || !renderer || !scene || !Array.isArray(objects) || !Array.isArray(cableMeshes))
    throw Error('Invalid optical transport scene');
  if(typeof sourceRevisionProvider!=='function')throw Error('Optical source revision must be a callback');
  const fullUniform = fullSize?.value !== undefined ? fullSize : {value:fullSize};
  const dimensions = () => {
    const value = fullUniform.value, width = value?.x ?? value?.[0], height = value?.y ?? value?.[1];
    transportDimensions(width,height,scale);return [width,height];
  };
  const [initialWidth,initialHeight] = dimensions(), initial = transportDimensions(initialWidth,initialHeight,scale);
  const target = new THREE.WebGLRenderTarget(...initial,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,
    minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false,samples:0,depthBuffer:true});
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  // Active samplers may not point at a framebuffer attachment, even when a
  // runtime branch does not sample it. Capture binds a separate neutral texel.
  const safeMap = new THREE.DataTexture(new Uint8Array(4),1,1,THREE.RGBAFormat,THREE.UnsignedByteType);
  safeMap.minFilter = safeMap.magFilter = THREE.NearestFilter;safeMap.generateMipmaps = false;safeMap.needsUpdate = true;
  const captureUniform = {value:false}, mapUniform = {value:target.texture};
  const opticalSize = {value:new THREE.Vector2(initialWidth,initialHeight)};
  const tracked = [...new Set([...objects,...cableMeshes])], opticalObjects = new Set(tracked.filter(object =>
    (Array.isArray(object.material) ? object.material : [object.material]).some(optical)));
  const opticalMaterials=new Set([...opticalObjects].flatMap(object=>(Array.isArray(object.material)?object.material:[object.material]).filter(optical)));
  const captureMaterials=new Map();if(specializeCapture)for(const material of opticalMaterials){const capture=material.clone();capture.name=material.name+' native transmission capture';capture.defines={...material.defines,CAD_TRANSPORT_CAPTURE:1};capture.onBeforeCompile=(shader,render)=>{shader.defines={...shader.defines,CAD_TRANSPORT_CAPTURE:1};material.onBeforeCompile.call(material,shader,render);};capture.customProgramCacheKey=()=>material.customProgramCacheKey()+':native-transport-capture';captureMaterials.set(material,capture);}
  const shaders = new Set();let disposed = false, rendering = false, renders = 0, failures = 0, resizes = 0, calls = 0, triangles = 0;
  let lastFullSize = [initialWidth,initialHeight], lastTransportSize = initial;
  let lastSignature=null,cacheHits=0,lastRegion=[0,0,...initial],lastSourceRevision=0;const boundingVersions=new WeakMap();

  function signature(camera,width,height,lowWidth,lowHeight,sourceRevision){
    scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    const values=[width,height,lowWidth,lowHeight,sourceRevision,...camera.projectionMatrix.elements,...camera.matrixWorld.elements];
    scene.traverse(object=>{
      if(!object.isMesh&&!object.isLight)return;
      values.push(object.uuid,object.visible,...object.matrixWorld.elements);
      for(let parent=object.parent;parent;parent=parent.parent)values.push(parent.visible);
      if(object.isMesh){values.push(object.geometry.uuid,object.geometry.attributes.position?.version,object.geometry.attributes.normal?.version,object.geometry.index?.version,object.geometry.drawRange.start,object.geometry.drawRange.count);
        for(const material of(Array.isArray(object.material)?object.material:[object.material])){
          values.push(material.uuid,material.version,material.opacity,material.roughness,material.metalness,material.ior,material.thickness,material.attenuationDistance,transmissionValue(material));
          for(const color of[material.color,material.attenuationColor])if(color)values.push(color.r,color.g,color.b);
          for(const map of[material.map,material.roughnessMap,material.normalMap,material.transmissionMap,material.thicknessMap])if(map)values.push(map.uuid,map.version);
        }
      }else if(object.isLight){values.push(object.intensity,object.color.r,object.color.g,object.color.b);}
    });
    if(scene.environment)values.push(scene.environment.uuid,scene.environment.version);
    return values;
  }
  function transmissionValue(material){return material.userData?.cadTransmission??material.transmission??0;}
  function projectedRegion(camera,width,height){
    const bounds=[];for(const object of opticalObjects){let visible=true;for(let ancestor=object;ancestor;ancestor=ancestor.parent)visible&&=ancestor.visible;
      if(!visible)continue;const version=object.geometry.attributes.position.version;
      if(!object.geometry.boundingBox||boundingVersions.get(object.geometry)!==version){object.geometry.computeBoundingBox();boundingVersions.set(object.geometry,version);}
      bounds.push(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));}
    return transportRegion(bounds,new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),width,height);
  }

  function bindShader(shader,material) {
    if (disposed || !opticalMaterials.has(material)) return false;
    if (!shader?.uniforms?.cadOpticalSize) throw Error('Bind CAD optics before raster transport');
    if (shaders.has(shader)) throw Error('Raster transport shader is already bound');
    const fragment = wrapRefraction(shader.fragmentShader,{specializeCapture,capture:!!shader.defines?.CAD_TRANSPORT_CAPTURE});
    shader.fragmentShader = fragment;
    Object.assign(shader.uniforms,{cadTransportCapture:captureUniform,cadTransportMap:mapUniform,
      cadTransportFullSize:fullUniform,cadOpticalSize:opticalSize});
    shaders.add(shader);return true;
  }

  async function compileCaptureAsync(camera){
    if(disposed||!specializeCapture)return false;if(rendering)throw Error('Reentrant optical transport compile');
    if(typeof renderer.compileAsync!=='function')throw Error('Asynchronous optical shader compiler unavailable');
    const visibility=new Map(),materials=new Map(),shadowFlags=[],state={background:scene.background,xr:renderer.xr?.enabled,shadowEnabled:renderer.shadowMap?.enabled,shadowAuto:renderer.shadowMap?.autoUpdate,shadowNeeds:renderer.shadowMap?.needsUpdate};rendering=true;
    try{scene.traverse(object=>{if(object.isMesh){visibility.set(object,object.visible);if(!opticalObjects.has(object))object.visible=false;else{materials.set(object,object.material);object.material=Array.isArray(object.material)?object.material.map(material=>captureMaterials.get(material)??material):captureMaterials.get(object.material)??object.material;}}if(object.isLight&&object.shadow){shadowFlags.push([object.shadow,object.shadow.autoUpdate,object.shadow.needsUpdate]);object.shadow.autoUpdate=false;object.shadow.needsUpdate=false;}});
      scene.background=null;if(renderer.xr)renderer.xr.enabled=false;if(renderer.shadowMap){renderer.shadowMap.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;}
      await renderer.compileAsync(scene,camera);return true;
    }finally{for(const[object,visible]of visibility)object.visible=visible;for(const[object,material]of materials)object.material=material;for(const[shadow,auto,needs]of shadowFlags){shadow.autoUpdate=auto;shadow.needsUpdate=needs;}scene.background=state.background;if(renderer.xr)renderer.xr.enabled=state.xr;if(renderer.shadowMap){renderer.shadowMap.enabled=state.shadowEnabled;renderer.shadowMap.autoUpdate=state.shadowAuto;renderer.shadowMap.needsUpdate=state.shadowNeeds;}rendering=false;}
  }

  function render(camera,{sourceRevision=sourceRevisionProvider(),force=false}={}) {
    if (disposed || !opticalObjects.size) return false;
    if (rendering) throw Error('Reentrant optical transport render');
    const [width,height] = dimensions(), [lowWidth,lowHeight] = transportDimensions(width,height,scale);
    const currentSignature=signature(camera,width,height,lowWidth,lowHeight,sourceRevision);
    if(!force&&lastSignature&&currentSignature.length===lastSignature.length&&currentSignature.every((value,i)=>value===lastSignature[i])){
      cacheHits++;return{calls:0,triangles:0,width:lowWidth,height:lowHeight,cached:true};
    }
    if (target.width !== lowWidth || target.height !== lowHeight) {target.setSize(lowWidth,lowHeight);resizes++;}
    lastFullSize = [width,height];lastTransportSize = [lowWidth,lowHeight];
    lastRegion=projectedRegion(camera,lowWidth,lowHeight);lastSourceRevision=sourceRevision;
    const visibility = new Map(), materialState=new Map(),shadowFlags = [];
    const state = {target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace?.() ?? 0,mip:renderer.getActiveMipmapLevel?.() ?? 0,
      viewport:renderer.getViewport?.(new THREE.Vector4()),scissor:renderer.getScissor?.(new THREE.Vector4()),scissorTest:renderer.getScissorTest?.(),
      clearColor:renderer.getClearColor?.(new THREE.Color()),clearAlpha:renderer.getClearAlpha?.(),autoClear:renderer.autoClear,
      background:scene.background,xr:renderer.xr?.enabled,shadowEnabled:renderer.shadowMap?.enabled,shadowAuto:renderer.shadowMap?.autoUpdate,shadowNeeds:renderer.shadowMap?.needsUpdate};
    rendering = true;
    try {
      scene.traverse(object => {
        if (object.isMesh) {visibility.set(object,object.visible);if (!opticalObjects.has(object)) object.visible = false;else if(specializeCapture){materialState.set(object,object.material);object.material=Array.isArray(object.material)?object.material.map(material=>captureMaterials.get(material)??material):captureMaterials.get(object.material)??object.material;}}
        if (object.isLight && object.shadow) {
          shadowFlags.push([object.shadow,object.shadow.autoUpdate,object.shadow.needsUpdate]);
          object.shadow.autoUpdate = false;object.shadow.needsUpdate = false;
        }
      });
      scene.background = null;renderer.autoClear = false;
      if (renderer.xr) renderer.xr.enabled = false;
      if (renderer.shadowMap) {renderer.shadowMap.enabled=false;renderer.shadowMap.autoUpdate = false;renderer.shadowMap.needsUpdate = false;}
      renderer.setClearColor?.(0,0);renderer.setScissorTest?.(false);
      captureUniform.value = true;mapUniform.value = safeMap;opticalSize.value.set(lowWidth,lowHeight);
      // RenderTarget viewport is in physical texels; renderer.setViewport
      // would multiply it by the main canvas pixel ratio a second time.
      target.scissorTest=false;renderer.setRenderTarget(target);renderer.clear(true,true,false);
      target.scissor.set(...lastRegion);target.scissorTest=true;renderer.setRenderTarget(target);renderer.render(scene,camera);
      calls = renderer.info?.render?.calls ?? 0;triangles = renderer.info?.render?.triangles ?? 0;renders++;
      lastSignature=currentSignature;
      return {calls,triangles,width:lowWidth,height:lowHeight};
    } catch (error) {lastSignature=null;failures++;throw error;}
    finally {
      captureUniform.value = false;mapUniform.value = target.texture;opticalSize.value.set(width,height);
      for (const [object,visible] of visibility) object.visible = visible;
      for (const [object,material] of materialState) object.material = material;
      for (const [shadow,autoUpdate,needsUpdate] of shadowFlags) {shadow.autoUpdate = autoUpdate;shadow.needsUpdate = needsUpdate;}
      scene.background = state.background;renderer.autoClear = state.autoClear;
      if (renderer.xr) renderer.xr.enabled = state.xr;
      if (renderer.shadowMap) {renderer.shadowMap.enabled=state.shadowEnabled;renderer.shadowMap.autoUpdate = state.shadowAuto;renderer.shadowMap.needsUpdate = state.shadowNeeds;}
      if (state.clearColor) renderer.setClearColor(state.clearColor,state.clearAlpha);
      if(!state.target)renderer.setRenderTarget(state.target,state.face,state.mip);
      if (state.viewport) renderer.setViewport(state.viewport);
      if (state.scissor) renderer.setScissor(state.scissor);
      if (state.scissorTest !== undefined) renderer.setScissorTest(state.scissorTest);
      // A non-default target owns a physical viewport distinct from the
      // renderer's logical canvas viewport. Rebinding restores that target's
      // viewport; the default framebuffer needs the logical viewport last.
      if(state.target)renderer.setRenderTarget(state.target,state.face,state.mip);
      rendering = false;
    }
  }

  function setScale(value) {
    transportDimensions(1,1,value);
    if (disposed) return false;
    scale = value;return scale;
  }
  function snapshot() {return {backend:'WebGL2 half-float deterministic CAD transmission buffer',scale,
    fullSize:[...lastFullSize],transportSize:[...lastTransportSize],rayPixelFraction:lastTransportSize[0]*lastTransportSize[1]/(lastFullSize[0]*lastFullSize[1]),
    opticalMeshes:opticalObjects.size,selectedModules:[...new Set([...opticalObjects].map(object=>object.userData.meshRecord?.module??object.material.userData?.module??object.name.split('/')[0]))],boundShaders:shaders.size,renders,failures,resizes,calls,triangles,capturing:rendering,disposed,
    history:false,specializeCapture,capturePrograms:captureMaterials.size,stationaryCacheHits:cacheHits,sourceRevision:lastSourceRevision,captureRegion:[...lastRegion],captureRegionFraction:lastRegion[2]*lastRegion[3]/(lastTransportSize[0]*lastTransportSize[1]),poseUpdates:'current camera and scene state; idle reuse until pose, source revision or size changes',captureContent:'raw transmission RGB and alpha only',
    finalShading:'native geometry, physical reflections and existing shadows; bilinear transmission lookup',separateReadWriteTexture:true};}
  function invalidate(){lastSignature=null;}
  function dispose() {if (disposed) return;disposed = true;captureUniform.value = false;mapUniform.value = null;lastSignature=null;target.dispose();safeMap.dispose();for(const material of captureMaterials.values())material.dispose();captureMaterials.clear();shaders.clear();}
  return {bindShader,render,compileCaptureAsync,setScale,invalidate,snapshot,dispose};
}
