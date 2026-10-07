import * as THREE from './vendor/three-r180/three.module.min.js';

/** Offline CYBR volume playback. One video owns color, extinction and depth.
 * No background keying and no live combustion/pressure dispatches.
 * Angular interpolation and weighted ray depth remain approximations.
 */
export async function loadElementsFire({group,schedule,reduced,onFrame,visibleOnly=false,base='./assets/instrument-elements-bake/fire/'}){
 const response=await fetch(base+'manifest.json',{cache:'no-store'});if(!response.ok)throw Error('Fire bake manifest unavailable');
 const m=await response.json();if(!m.complete||m.angles.length!==8||m.frames<2)throw Error('Incomplete native fire bake');
 const video=document.createElement('video');video.muted=true;video.loop=true;video.playsInline=true;video.preload='auto';video.src=base+m.video+'?v='+m.sha256;
 // Keep the media element connected so paused seeking works in the IAB too.
 video.hidden=true;video.setAttribute('aria-hidden','true');document.body.append(video);
 // Explicit upload allows water geometry and this decoded atlas to become
 // visible together. VideoTexture's automatic callbacks would publish fire
 // before the matching compressed water surface has finished decoding.
 const texture=new THREE.Texture(video);texture.colorSpace=THREE.NoColorSpace;texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;
 const positions=new Float32Array(12),geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
 geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array([0,0,1,0,1,1,0,1]),2));geometry.setIndex([0,1,2,0,2,3]);geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,2.8,0),16);
 const uniforms={image:{value:texture},atlasSize:{value:new THREE.Vector2(m.width,m.height)},tileSize:{value:new THREE.Vector2(...m.tile)},views:{value:new THREE.Vector2()},viewBlend:{value:0},
  bakeEye:{value:new THREE.Vector3()},bakeForward:{value:new THREE.Vector3()},bakeRight:{value:new THREE.Vector3()},bakeUp:{value:new THREE.Vector3()},
  crop:{value:new THREE.Vector4(...m.crop)},sourceSize:{value:new THREE.Vector2(...m.sourceSize)},cameraSpec:{value:new THREE.Vector2(m.camera.tanHalfFov,m.camera.aspect)},
  worldFromSim:{value:new THREE.Matrix4()},viewProjection:{value:new THREE.Matrix4()}};
 const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.CustomBlending,
  blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneMinusSrcAlphaFactor,
  vertexShader:'varying vec2 fireUV;void main(){fireUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`uniform sampler2D image;uniform vec2 atlasSize,tileSize,views,sourceSize,cameraSpec;uniform float viewBlend;
uniform vec4 crop;uniform vec3 bakeEye,bakeForward,bakeRight,bakeUp;uniform mat4 worldFromSim,viewProjection;varying vec2 fireUV;
vec3 field(float view,float band){vec2 cell=vec2(mod(view,4.),floor(view/4.)+band*2.);vec2 pixel=cell*tileSize+vec2(fireUV.x,1.-fireUV.y)*(tileSize-1.)+.5;return texture2D(image,vec2(pixel.x/atlasSize.x,1.-pixel.y/atlasSize.y)).rgb;}
void main(){
 vec3 a=field(views.x,0.),b=field(views.y,0.);vec3 radiance=mix(a*a,b*b,viewBlend)*${(m.radianceScale*(m.radianceGain??1)).toFixed(1)};
 float matte=clamp(mix(field(views.x,1.).r,field(views.y,1.).r,viewBlend),0.,1.);
 if(max(max(radiance.r,radiance.g),radiance.b)<.0004&&matte<.005){discard;}
 float depth=mix(field(views.x,2.).r,field(views.y,2.).r,viewBlend)*${m.depthScale.toFixed(1)};
 vec2 pixel=crop.xy+vec2(fireUV.x,1.-fireUV.y)*crop.zw;vec2 screen=vec2(pixel.x/sourceSize.x*2.-1.,1.-pixel.y/sourceSize.y*2.);
 vec3 ray=normalize(bakeForward+screen.x*cameraSpec.x*cameraSpec.y*bakeRight+screen.y*cameraSpec.x*bakeUp);
 vec4 hit=viewProjection*worldFromSim*vec4(bakeEye+ray*depth,1.);
 if(hit.w<=0.){discard;}gl_FragDepth=clamp(hit.z/hit.w*.5+.5,0.,1.);
 gl_FragColor=vec4(radiance,matte);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`});
 const mesh=new THREE.Mesh(geometry,material);mesh.name='elements/baked-CYBR-fire';mesh.frustumCulled=false;mesh.renderOrder=0;
 const scale=m.placement?.scaleMM??2.5,baseZ=m.placement?.baseZMM??14;
 const simToCad=new THREE.Matrix4().set(scale,0,0,0,0,0,-scale,0,0,scale,0,baseZ,0,0,0,1);
 mesh.matrixAutoUpdate=false;mesh.matrix.copy(simToCad);group.add(mesh);
 // Recorded radiance drives a bounded local direct-light approximation.
 const light=new THREE.PointLight(0xffae68,0,48,2);light.name='CYBR baked flame direct light';light.position.set(0,0,baseZ+3);light.castShadow=false;group.add(light);
 let paused=false,active=false,inView=true,disposed=false,decoded=0,lastFrame=-1,failed=null,frameCallback=0,fallbackTimer=0,lastAz=NaN,presenting=false;
 const maximumEnergy=Math.max(...m.energyCurve),localEye=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3(),forward=new THREE.Vector3(),eye=new THREE.Vector3(),point=new THREE.Vector3(),center=new THREE.Vector3();
 function state(){return{enabled:active,inView,visibleOnly,source:m.lineage.source,frames:m.frames,fps:m.fps,time:video.currentTime,decodedFrames:decoded,displayedFrame:lastFrame,ready:video.readyState>=2,failed,views:uniforms.views.value.toArray(),viewBlend:uniforms.viewBlend.value,videoBytes:m.bytes,background:false,sharedColorMatteDepthClock:true,liveSimulation:false,depth:'weighted ray distance; approximate partial volume occlusion',viewElevationDegrees:Math.atan2(m.camera.height,m.camera.distance)*180/Math.PI,lighting:'recorded energy curve drives local direct light; full GI is not baked'};}
 async function delivered(now,metadata){
  if(disposed||presenting)return;presenting=true;
  const time=metadata?.mediaTime??video.currentTime;
  if(onFrame)video.pause();
  try{
   if(onFrame)await onFrame(time,m);
   if(disposed)return;
   decoded++;lastFrame=Math.min(m.frames-1,Math.floor(time*m.fps));texture.needsUpdate=true;schedule();
  }catch(error){failed='Elements composite: '+error.message;mesh.visible=false;light.intensity=0;schedule();}
  finally{
   presenting=false;
   if(!disposed){if(video.requestVideoFrameCallback)frameCallback=video.requestVideoFrameCallback(delivered);playback();}
  }
 }
 if(video.requestVideoFrameCallback)frameCallback=video.requestVideoFrameCallback(delivered);
 video.addEventListener('error',()=>{failed='Baked fire video could not decode';mesh.visible=false;light.intensity=0;console.error(failed);schedule();});
 video.addEventListener('loadeddata',()=>{texture.needsUpdate=true;if(reduced.matches)video.currentTime=1.1;schedule();});
 function playback(){const shouldPlay=active&&inView&&!paused&&!presenting&&!failed&&!document.hidden&&!reduced.matches;
  if(shouldPlay&&video.paused){void video.play().catch(error=>{failed=error.message;schedule();});if(!video.requestVideoFrameCallback&&!fallbackTimer)fallbackTimer=setInterval(delivered,1000/m.fps);}
  else if(!shouldPlay&&!video.paused){video.pause();clearInterval(fallbackTimer);fallbackTimer=0;}
 }
 function update(camera,progress){
  group.updateWorldMatrix(true,false);camera.updateMatrixWorld();
  // The whole component and the flame's conservative native bound must be
  // outside the view before its shared fire/water clock can pause. The last
  // authored radiance and direct light remain available to neighboring parts.
  inView=!visibleOnly||elementsInView(camera,group,mesh);
  active=progress>.48&&progress<.72;mesh.visible=active&&video.readyState>=2&&!failed;
  playback();localEye.copy(camera.position);group.worldToLocal(localEye);
  const az=Math.atan2(localEye.x,-localEye.y);const normalized=((az*180/Math.PI)%360+360)%360,view=normalized/45;
  uniforms.views.value.set(Math.floor(view)%8,(Math.floor(view)+1)%8);uniforms.viewBlend.value=view-Math.floor(view);
  eye.set(Math.sin(az)*m.camera.distance,m.camera.targetY+m.camera.height,Math.cos(az)*m.camera.distance);
  forward.set(-eye.x,m.camera.targetY-eye.y,-eye.z).normalize();right.crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();up.crossVectors(right,forward);
  uniforms.bakeEye.value.copy(eye);uniforms.bakeForward.value.copy(forward);uniforms.bakeRight.value.copy(right);uniforms.bakeUp.value.copy(up);
  uniforms.worldFromSim.value.multiplyMatrices(group.matrixWorld,simToCad);uniforms.viewProjection.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  if(az!==lastAz){
   const distance=Math.hypot(m.camera.distance,m.camera.height),half=distance*m.camera.tanHalfFov;
   for(let i=0;i<4;i++){const u=[0,1,1,0][i],v=[0,0,1,1][i],px=m.crop[0]+u*m.crop[2],py=m.crop[1]+(1-v)*m.crop[3];
    center.set(0,m.camera.targetY,0);point.copy(center).addScaledVector(right,(px/m.sourceSize[0]*2-1)*half*m.camera.aspect).addScaledVector(up,(1-py/m.sourceSize[1]*2)*half);point.toArray(positions,i*3);}
   geometry.attributes.position.needsUpdate=true;lastAz=az;
  }
  const index=Math.max(0,lastFrame);light.intensity=active&&!failed?20*(m.radianceGain??1)*(m.energyCurve[index]/maximumEnergy):0;
 }
 const visibility=()=>playback();document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',visibility);video.load();
 return{update,snapshot:state,setPaused(value){paused=value;playback();},dispose(){disposed=true;video.pause();video.cancelVideoFrameCallback?.(frameCallback);clearInterval(fallbackTimer);video.removeAttribute('src');video.load();video.remove();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',visibility);geometry.dispose();material.dispose();texture.dispose();group.remove(mesh,light);}};
}

export function elementsInView(camera,group,fireMesh){
 const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const bounds=new THREE.Box3().setFromObject(group,false);
 if(frustum.intersectsBox(bounds))return true;
 const sphere=fireMesh.geometry.boundingSphere.clone().applyMatrix4(fireMesh.matrixWorld);
 // The bounded point light can still affect visible adjacent native parts.
 sphere.radius=Math.max(sphere.radius,48);
 return frustum.intersectsSphere(sphere);
}
