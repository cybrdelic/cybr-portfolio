export const IRIS09_SOURCE_SHA256='455e1ba9b0740a6ab925f9c022eea5f217fd3bbfc08ffec3177fb3b1d925843b';
export const IRIS09_LOOP_COUNTS=Object.freeze({sampleAxis:2,opticalSteps:24,channels:3,lightCount:3,quadratureAxis:5,marchSteps:104,shadowSteps:28});
const MARKER='IRIS09_STAGE_REVISION_3';
const now=()=>globalThis.performance?.now?.()??Date.now();
const clamp=value=>Math.max(0,Math.min(1,value));
const ease=value=>{const t=clamp(value);return t*t*t*(t*(t*6-15)+10);};
const mix=(a,b,t)=>a+(b-a)*t;

// Full seven-chapter journey progress. Only framing and the source's time
// change: every optical interface, material, emitter and geometric detail is
// still evaluated by the recovered shader at its original AA=2 quality.
export function iris09Pose(progress,width,height){
 if(![progress,width,height].every(Number.isFinite)||width<=0||height<=0)throw new TypeError('IRIS / 09 requires finite progress and a positive viewport');
 const beat=Math.min(3,clamp(progress)*7),aspect=width/height,portrait=aspect<.8;
 const distance=portrait?7.8/aspect:Math.max(7.2,12.8/aspect);
 const poses=[
  {az:.62,elevation:.69,distance,target:[-.015,.235,0],center:[portrait?.5:.66,portrait?.37:.49]},
  {az:.28,elevation:.77,distance:distance*.94,target:[-.015,.235,0],center:[portrait?.5:.66,portrait?.37:.49]},
  {az:.88,elevation:.52,distance:distance*(portrait?.69:.52),target:[.28,.40,-.22],center:[portrait?.58:.76,portrait?.35:.49]}
 ];
 const index=Math.min(2,Math.floor(beat)),next=Math.min(2,index+1),blend=ease((beat-index-.64)/.36);
 const a=poses[index],b=poses[next],center=a.center.map((v,i)=>mix(v,b.center[i],blend));
 const time=beat<=1?5*ease(beat):beat<=2?5+5*ease(beat-1):10+3.6*ease((beat-2)/.5);
 return {time,az:mix(a.az,b.az,blend),elevation:mix(a.elevation,b.elevation,blend),distance:mix(a.distance,b.distance,blend),
  target:a.target.map((v,i)=>mix(v,b.target[i],blend)),focal:4.2,shift:[(2*center[0]-1)*aspect,2*center[1]-1],portrait};
}

function replaceOnce(source,from,to,label){
 const index=source.indexOf(from);
 if(index<0||source.indexOf(from,index+from.length)>=0)throw new Error(`IRIS / 09 source contract changed: ${label}`);
 return source.slice(0,index)+to+source.slice(index+from.length);
}

export function buildIris09Fragment(source){
 if(typeof source!=='string'||!source.includes('Revision 3.')||!source.includes('#define AA 2'))throw new Error('IRIS / 09 requires the recovered Revision III source at AA=2');
 // Validate each exact camera declaration independently. No broad regex may
 // accidentally rewrite bodyMap, opticalTransport, or the area-light solver.
 let body=replaceOnce(source,'void main() {','void iris09SourceMain() {','main entry point');
 const cameraOverrides=[
  ['float az=0.52+0.13*sin(TAU*u_time/10.0+0.35)+u_drag.x/max(u_resolution.x,1.0)*2.5;','float az=u_irisOriginalCamera?0.52+0.13*sin(TAU*u_time/10.0+0.35)+u_drag.x/max(u_resolution.x,1.0)*2.5:u_irisCamera.x;'],
  ['float elev=0.690+clamp(u_drag.y/max(u_resolution.y,1.0),-0.2,0.25)*1.2;','float elev=u_irisOriginalCamera?0.690+clamp(u_drag.y/max(u_resolution.y,1.0),-0.2,0.25)*1.2:u_irisCamera.y;'],
  ['float distance=6.55*clamp(exp(-u_scroll*0.08),0.72,1.5);','float distance=u_irisOriginalCamera?6.55*clamp(exp(-u_scroll*0.08),0.72,1.5):u_irisCamera.z;'],
  ['vec3 target=vec3(-0.015,0.235,0.0);','vec3 target=u_irisOriginalCamera?vec3(-0.015,0.235,0.0):u_irisTarget;'],
  ['float focal=4.20;','float focal=u_irisOriginalCamera?4.20:u_irisCamera.w;'],
  ['vec2 uv=(2.0*(gl_FragCoord.xy+jitter)-u_resolution)/u_resolution.y;','vec2 uv=(2.0*(gl_FragCoord.xy+jitter)-u_resolution)/u_resolution.y;\n        if(!u_irisOriginalCamera)uv-=u_irisShift;']
 ];
 for(const [from,to] of cameraOverrides)body=replaceOnce(body,from,to,'camera/layout declaration');
 // Keep the immutable source and its sample count/order intact. Runtime
 // bounds stop a driver from specializing four AA copies of three dispersed
 // 24-step optical paths, each of which inlines marching and area lighting.
 // AA stays 2 for normalization, quadrature weights and the four light phases.
 // These uniforms are implementation constants, never quality controls.
 const loopHeaders=[
  ['for(int bounce=0;bounce<24;bounce++)','for(int bounce=0;bounce<u_irisOpticalSteps;bounce++)'],
  ['for(int y=0;y<AA;y++)','for(int y=0;y<u_irisSampleAxis;y++)'],
  ['for(int x=0;x<AA;x++)','for(int x=0;x<u_irisSampleAxis;x++)'],
  ['for(int i=0;i<104;i++)','for(int i=0;i<u_irisMarchSteps;i++)'],
  ['for(int i=0;i<28;i++)','for(int i=0;i<u_irisShadowSteps;i++)'],
  ['for(int sy=0;sy<5;sy++)','for(int sy=0;sy<u_irisQuadratureAxis;sy++)'],
  ['for(int sx=0;sx<5;sx++)','for(int sx=0;sx<u_irisQuadratureAxis;sx++)']
 ];
 for(const [from,to] of loopHeaders)body=replaceOnce(body,from,to,'exact-count loop header');
 const lightLoops=body.split('for(int i=0;i<3;i++)');
 if(lightLoops.length!==3)throw new Error('IRIS / 09 source contract changed: two three-emitter loops');
 body=lightLoops.join('for(int i=0;i<u_irisLightCount;i++)');
 // One runtime channel loop avoids three independently specialized copies of
 // the complete transport graph. Channel order, IORs and RGB selection are
 // identical; all three paths still run and no dispersion is approximated.
 body=replaceOnce(body,`    vec3 r=opticalTransport(ro,rd,h,-0.0030);
    vec3 g=opticalTransport(ro,rd,h,0.0);
    vec3 b=opticalTransport(ro,rd,h,0.0050);
    return vec3(r.r,g.g,b.b);`,`    vec3 channels=vec3(0.0);
    for(int channel=0;channel<u_irisChannels;channel++) {
        float dispersion=channel==0?-0.0030:channel==1?0.0:0.0050;
        vec3 value=opticalTransport(ro,rd,h,dispersion);
        channels[channel]=value[channel];
    }
    return channels;`,'three-channel optical transport');
 return `// ${MARKER}
precision highp float;
precision highp int;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_time_delta;
uniform int u_frame;
uniform vec4 u_mouse;
uniform vec2 u_drag;
uniform float u_scroll;
uniform vec4 u_irisCamera;
uniform vec3 u_irisTarget;
uniform vec2 u_irisShift;
uniform bool u_irisOriginalCamera;
uniform float u_irisOpacity;
uniform int u_irisSampleAxis;
uniform int u_irisOpticalSteps;
uniform int u_irisChannels;
uniform int u_irisLightCount;
uniform int u_irisQuadratureAxis;
uniform int u_irisMarchSteps;
uniform int u_irisShadowSteps;
out vec4 fragColor;
${body}
void main(){iris09SourceMain();fragColor.a*=u_irisOpacity;}
`;
}

export function createIris09Stage(T,{source}){
 const fragmentShader=buildIris09Fragment(source);
 const uniforms={u_resolution:{value:new T.Vector2(1,1)},u_time:{value:0},u_time_delta:{value:0},u_frame:{value:0},
  u_mouse:{value:new T.Vector4(0,0,-1,-1)},u_drag:{value:new T.Vector2()},u_scroll:{value:0},
  u_irisCamera:{value:new T.Vector4()},u_irisTarget:{value:new T.Vector3()},u_irisShift:{value:new T.Vector2()},
  u_irisOriginalCamera:{value:false},u_irisOpacity:{value:1},
  u_irisSampleAxis:{value:IRIS09_LOOP_COUNTS.sampleAxis},u_irisOpticalSteps:{value:IRIS09_LOOP_COUNTS.opticalSteps},
  u_irisChannels:{value:IRIS09_LOOP_COUNTS.channels},u_irisLightCount:{value:IRIS09_LOOP_COUNTS.lightCount},
  u_irisQuadratureAxis:{value:IRIS09_LOOP_COUNTS.quadratureAxis},u_irisMarchSteps:{value:IRIS09_LOOP_COUNTS.marchSteps},
  u_irisShadowSteps:{value:IRIS09_LOOP_COUNTS.shadowSteps}};
 const material=new T.RawShaderMaterial({name:'IRIS / 09 · original Revision III',glslVersion:T.GLSL3,uniforms,fragmentShader,
  // The three-component buffer keeps Three's bounds/sorting finite; the vec2
  // shader input intentionally ignores its zero Z and retains the already
  // compiled vertex program. Both describe the identical fullscreen triangle.
  vertexShader:`precision highp float;in vec2 position;void main(){gl_Position=vec4(position,0.,1.);}`,
  depthTest:false,depthWrite:false,transparent:true,blending:T.NormalBlending,toneMapped:false});
 material.customProgramCacheKey=()=>MARKER;
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
 const mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;
 const scene=new T.Scene(),camera=new T.Camera();scene.add(mesh);
 const metadata={name:'IRIS / 09',revision:3,adapterVersion:'runtime-loop-v2-tiled',sourceURL:'./assets/iris09/IRIS-09.glsl',expectedSourceSha256:IRIS09_SOURCE_SHA256,
  sourceSha256:null,sourceIdentityVerified:false,samplesPerPixel:4,transport:'Original analytic intersections, SDF housing, bounded RGB optics and finite-emitter GGX',
  presentation:'Live full-scene fragment shader; not a mesh, film, or static image',output:'Original ACES + gamma 1/2.2; no second display transform'};
 const status={phase:'uncompiled',error:null,draws:0,submissions:0,lastDrawTiles:0,timedOut:false,diagnostic:null,
  get elapsedMs(){return startedAt===null?0:(finishedAt??now())-startedAt;}};
 let compilation=null,compiledRenderer=null,disposed=false,startedAt=null,finishedAt=null,compileTimer=null;

 async function verifySource(){
  if(!globalThis.crypto?.subtle)throw new Error('IRIS / 09 source verification requires Web Crypto (HTTPS or localhost)');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
  metadata.sourceSha256=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
  if(metadata.sourceSha256!==IRIS09_SOURCE_SHA256)throw new Error('IRIS / 09 source hash differs from the recovered Revision III artifact');
  metadata.sourceIdentityVerified=true;
 }
 function shaderDiagnostics(renderer){
  const debug=renderer.debug;
  if(!debug)return ()=>{};
  const previous=debug.onShaderError,check=debug.checkShaderErrors;
  const handler=(gl,program,vertex,fragment)=>{
   if(gl.getShaderSource(fragment)?.includes(MARKER)){
    const log=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n').slice(0,3000);
    status.error=new Error(`IRIS / 09 shader compilation failed: ${log||'Unknown WebGL compile error'}`);status.phase='error';
   }
   previous?.(gl,program,vertex,fragment);
  };
  debug.checkShaderErrors=true;debug.onShaderError=handler;
  return ()=>{if(debug.onShaderError===handler)debug.onShaderError=previous;debug.checkShaderErrors=check;};
 }
 async function compile(renderer,{timeoutMs=45000}={}){
  if(disposed)throw new Error('IRIS / 09 stage is disposed');
  if(compiledRenderer&&compiledRenderer!==renderer)throw new Error('IRIS / 09 must use one existing renderer');
  if(compilation)return compilation;
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new TypeError('IRIS / 09 compile diagnostic timeout must be positive and finite');
  compiledRenderer=renderer;status.phase='compiling';startedAt=now();
  const gl=renderer.getContext?.(),driver=gl?.getExtension('WEBGL_debug_renderer_info');
  metadata.graphicsDevice=driver?gl.getParameter(driver.UNMASKED_RENDERER_WEBGL):'Not exposed';
  metadata.drawSubmission=/intel/i.test(metadata.graphicsDevice)?'Disjoint physical-pixel scissor tiles, maximum 256 × 256':'Single fullscreen draw';
  compileTimer=setTimeout(()=>{
   if(disposed||status.phase!=='compiling')return;
   status.timedOut=true;
   status.diagnostic=`GPU shader compilation is still pending after ${Math.round(status.elapsedMs/1000)} seconds; no shader failure has been reported.`;
  },timeoutMs);
  compilation=(async()=>{
   await verifySource();
   if(disposed)throw new Error('IRIS / 09 stage was disposed while compiling');
   const restore=shaderDiagnostics(renderer);
   try{
    if(renderer.compileAsync)await renderer.compileAsync(scene,camera);
    else renderer.compile(scene,camera);
    if(status.error)throw status.error;
    if(!disposed){status.phase='ready';status.diagnostic=null;}
   }finally{restore();}
  })().catch(error=>{if(!disposed){status.error=error;status.phase='error';}throw error;})
   .finally(()=>{finishedAt=now();clearTimeout(compileTimer);compileTimer=null;});
  return compilation;
 }
 return {metadata,status,compile,
  render(renderer,{progress,width,height,opacity=1,originalCamera=false}){
   if(disposed)return false;
   if(status.error)throw status.error;
   if(status.phase!=='ready'){if(status.phase==='uncompiled')compile(renderer).catch(()=>{});return false;}
   if(renderer!==compiledRenderer)throw new Error('IRIS / 09 was compiled for a different renderer');
   if(!Number.isFinite(opacity))throw new TypeError('IRIS / 09 opacity must be finite');
   if(opacity<=0)return false;
   if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0)throw new TypeError('IRIS / 09 requires positive integer drawing-buffer pixel dimensions');
   const pose=iris09Pose(progress,width,height);
   // width/height are physical drawing-buffer pixels, not CSS dimensions.
   uniforms.u_resolution.value.set(width,height);uniforms.u_time.value=pose.time;
   uniforms.u_irisCamera.value.set(pose.az,pose.elevation,pose.distance,pose.focal);
   uniforms.u_irisTarget.value.fromArray(pose.target);uniforms.u_irisShift.value.fromArray(pose.shift);
   uniforms.u_irisOriginalCamera.value=Boolean(originalCamera);uniforms.u_irisOpacity.value=clamp(opacity);
   uniforms.u_irisSampleAxis.value=IRIS09_LOOP_COUNTS.sampleAxis;uniforms.u_irisOpticalSteps.value=IRIS09_LOOP_COUNTS.opticalSteps;
   uniforms.u_irisChannels.value=IRIS09_LOOP_COUNTS.channels;uniforms.u_irisLightCount.value=IRIS09_LOOP_COUNTS.lightCount;
   uniforms.u_irisQuadratureAxis.value=IRIS09_LOOP_COUNTS.quadratureAxis;uniforms.u_irisMarchSteps.value=IRIS09_LOOP_COUNTS.marchSteps;
   uniforms.u_irisShadowSteps.value=IRIS09_LOOP_COUNTS.shadowSteps;
   const autoClear=renderer.autoClear,restore=shaderDiagnostics(renderer);
   let savedScissor=null,savedScissorTest=false;
   const draw=()=>{
    renderer.render(scene,camera);
    if(status.error)throw status.error;
    status.submissions++;status.lastDrawTiles++;
   };
   try{
    // Alpha is solely a composition handoff. The shader still traces its own
    // complete floor and environment; there is no pretend raster depth.
    renderer.autoClear=false;status.lastDrawTiles=0;
    if(/intel/i.test(metadata.graphicsDevice)){
     const ratio=renderer.getPixelRatio();
     if(!Number.isFinite(ratio)||ratio<=0)throw new TypeError('IRIS / 09 requires a positive finite renderer pixel ratio');
     savedScissorTest=renderer.getScissorTest();savedScissor=renderer.getScissor(new T.Vector4());
     const gl=renderer.getContext?.();
     // Three stores CSS units, but releases differ on round vs floor when
     // multiplying by DPR. If a caller clip is enabled, retain its actual GL
     // pixel rectangle instead of guessing how its fractional edges rounded.
     const clip=new T.Vector4(0,0,width,height);
     if(savedScissorTest){
      if(gl?.SCISSOR_BOX!==undefined)clip.fromArray(gl.getParameter(gl.SCISSOR_BOX));
      else clip.copy(savedScissor).multiplyScalar(ratio).round();
     }
     const left=Math.max(0,clip.x),bottom=Math.max(0,clip.y),right=Math.min(width,clip.x+clip.z),top=Math.min(height,clip.y+clip.w);
     renderer.setScissorTest(true);
     for(let y=bottom;y<top;y+=256)for(let x=left;x<right;x+=256){
      const w=Math.min(256,right-x),h=Math.min(256,top-y);
      // A quarter-pixel offset is inside BOTH the floor and nearest-round
      // bins of the intended integer. Plain integer / DPR can multiply back
      // just below it, creating seams at fractional device pixel ratios.
      renderer.setScissor((x+.25)/ratio,(y+.25)/ratio,(w+.25)/ratio,(h+.25)/ratio);
      draw();
      // Non-blocking submission, never finish/readback. This bounds each
      // draw's fragment work; it does not reduce total work or claim more FPS.
      gl?.flush?.();
     }
    }else draw();
    status.draws++;return true;
   }finally{
    try{
     if(savedScissor){try{renderer.setScissor(savedScissor);}finally{renderer.setScissorTest(savedScissorTest);}}
    }finally{renderer.autoClear=autoClear;restore();}
   }
  },
  dispose(){if(disposed)return;disposed=true;status.phase='disposed';finishedAt??=now();clearTimeout(compileTimer);compileTimer=null;geometry.dispose();material.dispose();}
 };
}
