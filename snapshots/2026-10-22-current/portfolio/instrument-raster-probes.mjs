// One settled local probe supplies actual opaque-neighbor reflections and
// measured low-frequency incident radiance. It is a single spatial sample,
// not a multi-bounce GI solver. The original HDR remains the moving baseline.
const FACE_SIZE = 128, SETTLE_MS = 180, BLEND_MS = 250, LOCAL_WEIGHT = .4;
const nowTime = () => globalThis.performance?.now() ?? Date.now();
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function cubePixelDirection(face, x, y, size) {
  if (!Number.isInteger(face) || face < 0 || face > 5 || !Number.isInteger(size) || size < 1)
    throw Error('Invalid cubemap face or size');
  const col = -1 + (x + .5) * 2 / size, row = 1 - (y + .5) * 2 / size;
  // WebGL cube target readback orientation, including its vertical pixel
  // convention. Matches Three r180 LightProbeGenerator's WebGL directions.
  const directions = [[1,row,-col],[-1,row,col],[col,1,-row],
    [col,-1,row],[col,row,1],[-col,row,-1]];
  const vector = directions[face], length = Math.hypot(...vector);
  return { direction: vector.map(v => v / length), weight: 4 / (length * length * length) };
}
function shBasis([x,y,z]) {
  return [.28209479177387814, .4886025119029199*y, .4886025119029199*z, .4886025119029199*x,
    1.0925484305920792*x*y, 1.0925484305920792*y*z, .31539156525252005*(3*z*z-1),
    1.0925484305920792*x*z, .5462742152960396*(x*x-y*y)];
}
function halfFloat(value) {
  const sign = value & 0x8000 ? -1 : 1, exponent = value >> 10 & 31, mantissa = value & 1023;
  return exponent === 31 ? (mantissa ? NaN : sign * Infinity)
    : sign * (exponent ? Math.pow(2, exponent - 15) * (1 + mantissa / 1024) : Math.pow(2, -14) * mantissa / 1024);
}

/** Nine RGB radiance SH coefficients, from six linear RGBA cube faces. */
export function integrateCubeSH(faces, size, { half = false } = {}) {
  if (!Array.isArray(faces) || faces.length !== 6 || !Number.isInteger(size) || size < 1)
    throw Error('Expected six square linear cubemap faces');
  const coefficients = new Float64Array(27);let totalWeight = 0;
  for (let face = 0; face < 6; face++) {
    const data = faces[face];
    if (!ArrayBuffer.isView(data) || data.length !== size * size * 4) throw Error('Invalid cubemap pixel shape');
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4, { direction, weight } = cubePixelDirection(face,x,y,size), basis = shBasis(direction);
      totalWeight += weight;
      for (let channel = 0; channel < 3; channel++) {
        const radiance = half ? halfFloat(data[at + channel]) : data[at + channel];
        if (!Number.isFinite(radiance)) throw Error('Nonfinite captured radiance');
        for (let band = 0; band < 9; band++) coefficients[band * 3 + channel] += Math.max(0,radiance) * basis[band] * weight;
      }
    }
  }
  const normalization = 4 * Math.PI / totalWeight;
  for (let i = 0; i < coefficients.length; i++) coefficients[i] *= normalization;
  return coefficients;
}

/** Cosine-convolved irradiance; useful for independent CPU numeric checks. */
export function evaluateSHIrradiance(coefficients, normal) {
  if (!coefficients || coefficients.length !== 27 || !normal || normal.length !== 3 || !Array.from(normal).every(Number.isFinite))
    throw Error('Invalid SH or surface normal');
  const length = Math.hypot(...normal);
  if (length <= 0) throw Error('Zero irradiance normal');
  const basis = shBasis(Array.from(normal,v => v / length)), result = [0,0,0];
  for (let band = 0; band < 9; band++) {
    const convolution = band === 0 ? Math.PI : band < 4 ? 2 * Math.PI / 3 : Math.PI / 4;
    for (let k = 0; k < 3; k++) result[k] += coefficients[band*3+k] * basis[band] * convolution;
  }
  return result;
}

export function opticalMaterial(material) {
  return (material?.userData?.cadTransmission ?? material?.transmission ?? 0) > 0
    || (material?.opacity ?? 1) < .999 || !!material?.transparent;
}
function eachMaterial(mesh, callback) {
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (material) callback(material);
}

/** Outside every conservative world mesh bound, near the receiver's top. */
export function chooseProbeAnchor(THREE, receiver, meshes) {
  const bounds = new THREE.Box3().setFromObject(receiver,false);
  if (bounds.isEmpty()) throw Error('Empty reflection receiver');
  const size = bounds.getSize(new THREE.Vector3()), anchor = bounds.getCenter(new THREE.Vector3());
  anchor.z = bounds.max.z + Math.max(8,size.z * .25);
  const safety = 2;
  // Bounds are deliberately conservative: avoiding an entire mesh AABB also
  // avoids entering any real CAD solid within it. Only move the capture point.
  const boxes = meshes.filter(mesh => mesh?.geometry).map(mesh => new THREE.Box3().setFromObject(mesh,false).expandByScalar(safety));
  for (let pass = 0; pass <= boxes.length; pass++) {
    let moved = false;
    for (const box of boxes) if (box.containsPoint(anchor)) { anchor.z = box.max.z + safety; moved = true; }
    if (!moved) return anchor;
  }
  throw Error('Could not find an exterior local-probe anchor');
}

function localCubeChunk(THREE) {
  let chunk = THREE.ShaderChunk.cube_uv_reflection_fragment;
  // Original HDR and the 128-cube PMREM need different atlas dimensions. Keep
  // Three's roughness mapping while giving the local sampler its own ABI.
  chunk = chunk.replace(/^\s*#define[^\n]*\n/gm,'');
  for (const name of ['getFace','getUV','bilinearCubeUV','roughnessToMip','textureCubeUV'])
    chunk = chunk.replace(new RegExp(`\\b${name}\\b`,'g'),'cadProbe_' + name);
  return chunk.replaceAll('CUBEUV_TEXEL_WIDTH','cadProbeCubeUV.x')
    .replaceAll('CUBEUV_TEXEL_HEIGHT','cadProbeCubeUV.y').replaceAll('CUBEUV_MAX_MIP','cadProbeCubeUV.z');
}
const SH_GLSL = `
uniform sampler2D cadProbeMap;
uniform vec3 cadProbeCubeUV;
uniform vec3 cadProbeSH[9];
uniform float cadProbeBlend;
uniform float cadProbeDiffuseBlend;
uniform float cadProbeMaterialIntensity;
vec3 cadProbeIrradiance(vec3 n) {
  return max(vec3(0.0), .886226925452758 * cadProbeSH[0]
    + 1.02332670794649 * (cadProbeSH[1]*n.y + cadProbeSH[2]*n.z + cadProbeSH[3]*n.x)
    + .858085530809783 * (cadProbeSH[4]*n.x*n.y + cadProbeSH[5]*n.y*n.z + cadProbeSH[7]*n.x*n.z)
    + .247707956100376 * cadProbeSH[6]*(3.0*n.z*n.z-1.0)
    + .429042765404892 * cadProbeSH[8]*(n.x*n.x-n.y*n.y));
}
`;

export function setupRasterProbes({ THREE, renderer, scene, objects, cableMeshes = [], groups, environment,
  reflectionWeight=LOCAL_WEIGHT, diffuseWeight=LOCAL_WEIGHT, schedule = () => {}, clock = nowTime }) {
  if (!THREE || !renderer || !scene || !(groups instanceof Map) || !Array.isArray(objects)) throw Error('Invalid raster-probe scene');
  if(!Number.isFinite(reflectionWeight)||!Number.isFinite(diffuseWeight)||reflectionWeight<0||reflectionWeight>1||diffuseWeight<0||diffuseWeight>1)
    throw Error('Probe reflection and diffuse weights must be finite values from zero to one');
  const measureIrradiance=diffuseWeight>0, influenceTarget=reflectionWeight>0||diffuseWeight>0?1:0;
  const meshes = [...new Set([...objects,...cableMeshes])], allowed = new Set(meshes), materialRecords = new Map();
  for (const [name,group] of groups) group.traverse(object => {
    if (!object.isMesh || !allowed.has(object)) return;
    eachMaterial(object, material => {
      if (!materialRecords.has(material)) materialRecords.set(material,{groups:new Set(),shaders:new Set(),blend:{value:0},diffuseBlend:{value:0},intensity:{value:material.envMapIntensity ?? 1}});
      materialRecords.get(material).groups.add(name);
    });
  });
  const originalEnvironment = scene.environment;
  const cubeTarget = new THREE.WebGLCubeRenderTarget(FACE_SIZE,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,
    minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false});
  cubeTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const cubeCamera = new THREE.CubeCamera(.25,10000,cubeTarget), pmrem = new THREE.PMREMGenerator(renderer);
  const localMap = {value:originalEnvironment}, cubeUV = {value:new THREE.Vector3(1/768,1/512,7)};
  const shUniform = {value:Array.from({length:9},() => new THREE.Vector3())};
  // Internal blend is a normalized fade shared by independent radiance weights.
  let filteredTarget, inFlight, disposed = false, pending = true, selectedName = '', selectedGroup, captureGroup = '',
    epoch = 0, capturedEpoch = -1, lastChange = -Infinity, lastUpdate = NaN, lastMoving = false,
    blend = 0, blendTarget = 0, irradianceReady = false, captureCenters, anchorArray, lastError;
  const counters = {attempts:0,captures:0,faceRenders:0,environmentPreparationRenders:0,pixelReads:0,invalidations:0,largePoseInvalidations:0,
    failures:0,discardedCaptures:0,lastCaptureMs:0,totalCaptureMs:0,lastCaptureSubmitMs:0,lastReadbackMs:0,lastSHIntegrationMs:0,
    lastCaptureAt:null,opticalExcluded:0};
  const asynchronousReadback=measureIrradiance&&typeof renderer.readRenderTargetPixelsAsync==='function';
  function receiver(camera, progress) {
    const entries = [...groups.entries()];
    if (!entries.length) throw Error('No local-probe receiver groups');
    if (progress < .46 || progress >= .99) return groups.has('elements') ? ['elements',groups.get('elements')] : entries[Math.floor(entries.length/2)];
    const direction = camera.getWorldDirection(new THREE.Vector3()), origin = camera.position;
    const denominator = direction.y*direction.y + direction.z*direction.z;
    const distance = denominator > 1e-9 ? Math.max(0,-(origin.y*direction.y+origin.z*direction.z)/denominator) : 0;
    const lookX = origin.x + direction.x*distance;
    return entries.reduce((best,entry) => {
      const center = new THREE.Box3().setFromObject(entry[1],false).getCenter(new THREE.Vector3());
      return !best || Math.abs(center.x-lookX)<best.distance ? {entry,distance:Math.abs(center.x-lookX)} : best;
    },null).entry;
  }
  function centers() {
    return new Map([...groups].map(([name,group]) => [name,new THREE.Box3().setFromObject(group,false).getCenter(new THREE.Vector3())]));
  }
  function setBlend() {
    for (const [material,record] of materialRecords) {
      const active = record.groups.size === 1 && record.groups.has(selectedName) && !opticalMaterial(material);
      record.blend.value = active ? blend*reflectionWeight : 0;
      record.diffuseBlend.value = active && irradianceReady ? blend*diffuseWeight : 0;
      record.intensity.value = material.envMapIntensity ?? 1;
    }
  }
  function bindMaterialShader(shader, material) {
    const record = materialRecords.get(material);
    if (!record || opticalMaterial(material)) return;
    const marker = '#include <envmap_physical_pars_fragment>';
    if (!shader.fragmentShader.includes(marker)) throw Error('Missing physical IBL shader chunk');
    const chunk = THREE.ShaderChunk.envmap_physical_pars_fragment
      .replace('return PI * envMapColor.rgb * envMapIntensity;',
        'return mix(PI * envMapColor.rgb * envMapIntensity, cadProbeIrradiance(worldNormal) * cadProbeMaterialIntensity, cadProbeDiffuseBlend);')
      .replace('return envMapColor.rgb * envMapIntensity;',
        'if (cadProbeBlend <= 0.0) return envMapColor.rgb * envMapIntensity;\nreturn mix(envMapColor.rgb * envMapIntensity, cadProbe_textureCubeUV(cadProbeMap, reflectVec, roughness).rgb * cadProbeMaterialIntensity, cadProbeBlend);');
    if (chunk === THREE.ShaderChunk.envmap_physical_pars_fragment) throw Error('Unsupported physical IBL shader ABI');
    // Vendored chunks need not end in a newline. Preprocessor boundaries must
    // remain separate lines when the local sampler and physical IBL are joined.
    shader.fragmentShader = shader.fragmentShader.replace(marker,SH_GLSL + '\n' + localCubeChunk(THREE) + '\n' + chunk + '\n');
    Object.assign(shader.uniforms,{cadProbeMap:localMap,cadProbeCubeUV:cubeUV,cadProbeSH:shUniform,
      cadProbeBlend:record.blend,cadProbeDiffuseBlend:record.diffuseBlend,cadProbeMaterialIntensity:record.intensity});
    record.shaders.add(shader);
  }
  function capture(now) {
    counters.attempts++;
    counters.lastReadbackMs=0;counters.lastSHIntegrationMs=0;
    const started = clock(), visibility = new Map(), envMaps = new Map(), blends = new Map(), lightShadows = [];
    const state = {target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace?.() ?? 0,mip:renderer.getActiveMipmapLevel?.() ?? 0,
      viewport:renderer.getViewport?.(new THREE.Vector4()),scissor:renderer.getScissor?.(new THREE.Vector4()),scissorTest:renderer.getScissorTest?.(),
      autoClear:renderer.autoClear,toneMapping:renderer.toneMapping,toneMappingExposure:renderer.toneMappingExposure,
      outputColorSpace:renderer.outputColorSpace,xr:renderer.xr?.enabled,shadowAuto:renderer.shadowMap?.autoUpdate,shadowNeeds:renderer.shadowMap?.needsUpdate,
      background:scene.background,backgroundRotation:scene.backgroundRotation?.clone(),backgroundIntensity:scene.backgroundIntensity,
      backgroundBlurriness:scene.backgroundBlurriness,environment:scene.environment};
    const record={epoch,name:selectedName,group:selectedGroup,started,now,candidate:undefined};
    let countedRender, error;
    try {
      scene.updateMatrixWorld(true);
      const anchor = chooseProbeAnchor(THREE,selectedGroup,meshes);
      cubeCamera.position.copy(anchor);cubeCamera.updateMatrixWorld();
      const allBounds = new THREE.Box3();for (const mesh of meshes) allBounds.expandByObject(mesh,false);
      const far = Math.max(2000,allBounds.getSize(new THREE.Vector3()).length()*4);
      for (const child of cubeCamera.children) {child.far=far;child.updateProjectionMatrix();}
      counters.opticalExcluded = 0;
      scene.traverse(object => {
        if (object.isMesh) {
          visibility.set(object,object.visible);
          let optical = false;eachMaterial(object,material => {
            optical ||= opticalMaterial(material);
            if (!envMaps.has(material)) {envMaps.set(material,material.envMap);material.envMap=null;}
          });
          if (optical) counters.opticalExcluded++;
          if (!allowed.has(object) || optical) object.visible=false;
        }
        if (object.isLight && object.shadow) {
          lightShadows.push([object.shadow,object.shadow.autoUpdate,object.shadow.needsUpdate]);
          object.shadow.autoUpdate=false;object.shadow.needsUpdate=false;
        }
      });
      visibility.set(selectedGroup,selectedGroup.visible);selectedGroup.visible=false;
      for (const record of materialRecords.values()) {
        blends.set(record,[record.blend.value,record.diffuseBlend.value]);record.blend.value=record.diffuseBlend.value=0;
      }
      scene.environment=originalEnvironment;scene.background=environment;
      scene.backgroundIntensity=scene.environmentIntensity ?? 1;scene.backgroundBlurriness=0;
      scene.backgroundRotation?.copy(scene.environmentRotation);
      renderer.autoClear=true;renderer.toneMapping=THREE.NoToneMapping;renderer.toneMappingExposure=1;
      renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
      if (renderer.xr) renderer.xr.enabled=false;
      if (renderer.shadowMap) {renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;}
      const render = renderer.render;
      countedRender = (...args) => {
        if (cubeCamera.children.includes(args[1])) counters.faceRenders++;
        else counters.environmentPreparationRenders++;
        return render.apply(renderer,args);
      };
      renderer.render=countedRender;
      try {cubeCamera.update(renderer,scene);} finally {renderer.render=render;countedRender=undefined;}
      record.candidate=pmrem.fromCubemap(cubeTarget.texture);
      record.centers=centers();record.anchor=anchor.toArray();record.environmentIntensity=scene.environmentIntensity ?? 1;
    } catch (caught) {
      error=caught;
    } finally {
      for (const [object,visible] of visibility) object.visible=visible;
      for (const [material,envMap] of envMaps) material.envMap=envMap;
      for (const [record,values] of blends) [record.blend.value,record.diffuseBlend.value]=values;
      for (const [shadow,autoUpdate,needsUpdate] of lightShadows) {shadow.autoUpdate=autoUpdate;shadow.needsUpdate=needsUpdate;}
      scene.background=state.background;scene.environment=state.environment;
      scene.backgroundIntensity=state.backgroundIntensity;scene.backgroundBlurriness=state.backgroundBlurriness;
      if (state.backgroundRotation) scene.backgroundRotation.copy(state.backgroundRotation);
      renderer.autoClear=state.autoClear;renderer.toneMapping=state.toneMapping;renderer.toneMappingExposure=state.toneMappingExposure;
      renderer.outputColorSpace=state.outputColorSpace;
      if (renderer.xr) renderer.xr.enabled=state.xr;
      if (renderer.shadowMap) {renderer.shadowMap.autoUpdate=state.shadowAuto;renderer.shadowMap.needsUpdate=state.shadowNeeds;}
      renderer.setRenderTarget(state.target,state.face,state.mip);
      if (state.viewport) renderer.setViewport(state.viewport);
      if (state.scissor) renderer.setScissor(state.scissor);
      if (state.scissorTest !== undefined) renderer.setScissorTest(state.scissorTest);
      record.submitted=clock();counters.lastCaptureSubmitMs=Math.max(0,record.submitted-started);
    }
    inFlight=record;
    if(error){finishCapture(record,undefined,error);return;}
    if(!measureIrradiance){finishCapture(record);return;}
    const faces=Array.from({length:6},()=>new Uint16Array(FACE_SIZE*FACE_SIZE*4));
    if(asynchronousReadback){
      // r180 signature: target,x,y,width,height,buffer,face,textureIndex=0.
      // Its framebuffer is restored before awaiting the fence. Restore the
      // pixel-pack binding too, so intervening scene renders/readbacks are safe.
      const context=renderer.getContext?.(), requests=faces.map((pixels,face)=>{
        const previousPack=context?.getParameter(context.PIXEL_PACK_BUFFER_BINDING);
        try{return Promise.resolve(renderer.readRenderTargetPixelsAsync(cubeTarget,0,0,FACE_SIZE,FACE_SIZE,pixels,face));}
        catch(caught){return Promise.reject(caught);}
        finally{if(context)context.bindBuffer(context.PIXEL_PACK_BUFFER,previousPack);}
      });
      record.submitted=clock();counters.lastCaptureSubmitMs=Math.max(0,record.submitted-started);
      // Wait for every PBO, including after one fails, before reusing the cube.
      Promise.allSettled(requests).then(results=>{
        const failure=results.find(result=>result.status==='rejected');
        counters.pixelReads+=results.filter(result=>result.status==='fulfilled').length;
        finishCapture(record,faces,failure?.reason);
      });
    }else{
      try{
        for(let face=0;face<6;face++){
          renderer.readRenderTargetPixels(cubeTarget,0,0,FACE_SIZE,FACE_SIZE,faces[face],face);counters.pixelReads++;
        }
        finishCapture(record,faces);
      }catch(caught){finishCapture(record,undefined,caught);}
    }
  }
  function finishCapture(record,faces,error) {
    const readbackFinished=clock();counters.lastReadbackMs=measureIrradiance?Math.max(0,readbackFinished-record.submitted):0;
    const valid=!disposed&&record.epoch===epoch&&record.group===selectedGroup&&!lastMoving;
    try{
      if(!valid){counters.discardedCaptures++;return;}
      if(error)throw error;
      if(renderer.getContext?.().isContextLost?.())throw Error('WebGL context lost during probe readback');
      if(measureIrradiance){
        const integrationStarted=clock(), coefficients=integrateCubeSH(faces,FACE_SIZE,{half:true});
        counters.lastSHIntegrationMs=Math.max(0,clock()-integrationStarted);
        if(coefficients[0]+coefficients[1]+coefficients[2]<=0&&record.environmentIntensity>0)
          throw Error('Empty HDR cube readback; local irradiance unavailable');
        for(let i=0;i<9;i++)shUniform.value[i].set(...coefficients.subarray(i*3,i*3+3));
      }
      const old=filteredTarget;filteredTarget=record.candidate;record.candidate=undefined;localMap.value=filteredTarget.texture;
      cubeUV.value.set(1/filteredTarget.width,1/filteredTarget.height,Math.log2(filteredTarget.height/4));
      old?.dispose();captureCenters=record.centers;anchorArray=record.anchor;capturedEpoch=record.epoch;captureGroup=record.name;
      irradianceReady=measureIrradiance;pending=false;blend=0;blendTarget=influenceTarget;lastError=undefined;
      // Completion time, rather than submission time, starts the fade.
      lastUpdate=record.now+Math.max(0,clock()-record.started);
      counters.captures++;counters.lastCaptureAt=lastUpdate;
    }catch(caught){
      pending=false;blendTarget=blend=0;irradianceReady=false;
      counters.failures++;lastError=caught?.message||String(caught);
    }finally{
      record.candidate?.dispose();record.candidate=undefined;
      if(inFlight===record)inFlight=undefined;
      counters.lastCaptureMs=Math.max(0,clock()-record.started);counters.totalCaptureMs+=counters.lastCaptureMs;
      if(!disposed){setBlend();if(asynchronousReadback&&needsFrame())schedule();}
    }
  }
  function update(camera,{progress=0,moving=false,geometryChanged=false,now=clock()}={}) {
    if (disposed) return;
    if (!Number.isFinite(now) || !Number.isFinite(progress)) throw Error('Invalid probe update time/progress');
    scene.updateMatrixWorld(true);
    const [name,group]=receiver(camera,progress), changedGroup=name!==selectedName;
    if (geometryChanged || changedGroup || (moving&&!lastMoving)) {
      epoch++;counters.invalidations++;pending=true;lastChange=now;blendTarget=0;
      if (changedGroup) {blend=0;irradianceReady=false;}
      else if (captureCenters) {
        const threshold=Math.max(12,new THREE.Box3().setFromObject(group,false).getSize(new THREE.Vector3()).length()*.12);
        const large=[...centers()].some(([key,center]) => captureCenters.get(key)?.distanceTo(center)>threshold);
        if (large) {blend=0;counters.largePoseInvalidations++;}
      }
    }
    selectedName=name;selectedGroup=group;lastMoving=!!moving;
    if (moving) {blendTarget=0;lastChange=now;}
    else if (!pending && capturedEpoch===epoch && captureGroup===selectedName) blendTarget=influenceTarget;
    if (pending && !inFlight && !moving && now-lastChange>=SETTLE_MS && (!filteredTarget || blend<=1e-5)) capture(now);
    const dt=Number.isFinite(lastUpdate)?Math.max(0,Math.min(BLEND_MS,now-lastUpdate)):0;
    if (blend<blendTarget) blend=Math.min(blendTarget,blend+dt/BLEND_MS);
    else if (blend>blendTarget) blend=Math.max(blendTarget,blend-dt/BLEND_MS);
    if(Math.abs(blend-blendTarget)<1e-12)blend=blendTarget;
    // Capture may set a completion timestamp after this frame's start time.
    // Preserve it so the next fade step excludes the blocking readback cost.
    lastUpdate=Number.isFinite(lastUpdate)?Math.max(now,lastUpdate):now;setBlend();
    if (needsFrame()) schedule();
  }
  function needsFrame() {return !disposed && ((pending&&!inFlight&&!lastMoving) || Math.abs(blend-blendTarget)>1e-5);}
  function snapshot() {return {...counters,mode:measureIrradiance?'settled opaque CAD reflection and SH irradiance':'settled opaque CAD reflection only',faceSize:FACE_SIZE,
    geometryEpoch:epoch,capturedEpoch,pending,readbackPending:!!inFlight,asynchronousReadback,
    readbackMode:!measureIrradiance?'skipped-reflection-only':asynchronousReadback?'async-pbo-fence':'synchronous-api-fallback',
    moving:lastMoving,receiverModule:selectedName,capturedModule:captureGroup,
    blend:blend*reflectionWeight,blendTarget:blendTarget*reflectionWeight,diffuseBlend:irradianceReady?blend*diffuseWeight:0,
    reflectionWeight,diffuseWeight,irradianceReady,anchor:anchorArray,lastError,disposed,singleSpatialSample:true,parallaxCorrection:false,multipleBounces:false};}
  function dispose() {
    if (disposed) return;
    disposed=true;blend=blendTarget=0;pending=false;setBlend();
    inFlight?.candidate?.dispose();if(inFlight)inFlight.candidate=undefined;
    filteredTarget?.dispose();cubeTarget.dispose();pmrem.dispose();
    localMap.value=originalEnvironment;
    for (const record of materialRecords.values()) record.shaders.clear();
  }
  return {update,needsFrame,snapshot,dispose,bindMaterialShader};
}
