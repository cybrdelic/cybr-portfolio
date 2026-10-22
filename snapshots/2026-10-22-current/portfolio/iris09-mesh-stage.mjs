import {iris09Pose,IRIS09_SOURCE_SHA256} from './iris09-stage.mjs';
import {createIris09Geometry} from './iris09-mesh-geometry.mjs';
import {createIris09Materials} from './iris09-mesh-materials.mjs';
import {prepareVisiblePrograms} from './prepare-visible-programs.mjs';

// The reference's closed plano-convex surfaces, tessellated once rather than
// rediscovered by a whole-screen optical solver for every sample of every frame.
export function iris09LensProfile(T,radius,base,edge,segments=48){
 const center=base-Math.sqrt(radius*radius-edge*edge),profile=[new T.Vector2(0,base)];
 for(let i=0;i<=segments;i++){
  const r=edge*(1-i/segments);
  profile.push(new T.Vector2(r,center+Math.sqrt(radius*radius-r*r)));
 }
 return profile;
}

export function updateIris09Camera(camera,pose,width,height){
 camera.fov=2*Math.atan(1/pose.focal)*180/Math.PI;camera.aspect=width/height;
 const ce=Math.cos(pose.elevation);
 camera.position.set(pose.target[0]+pose.distance*Math.sin(pose.az)*ce,
  pose.target[1]+pose.distance*Math.sin(pose.elevation),pose.target[2]+pose.distance*Math.cos(pose.az)*ce);
 camera.lookAt(...pose.target);camera.updateProjectionMatrix();
 camera.projectionMatrix.elements[8]=-pose.shift[0]/camera.aspect;
 camera.projectionMatrix.elements[9]=-pose.shift[1];
 camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();camera.updateMatrixWorld();
}

export const IRIS09_ROOM=Object.freeze({
 floorHeight:-.100,floorThickness:.12,backFace:-4.2,sideFace:-4.8,
 floorColor:0x87402c,wallColor:0x542319,floorRoughness:.70,wallRoughness:.85,
 textureSize:256,texturePeriod:.55,opaqueDraws:3,triangles:36,
});

// The first three chapters share the later studio's burnt-mineral finish,
// but keep the recovered mechanism's calibrated finite-source lighting.
// These are actual receiver surfaces, not a horizon painted on a background.
export function createIris09Studio(T,sourceFloorMaterial){
 const root=new T.Group();root.name='IRIS09 / warm mineral studio';
 const size=IRIS09_ROOM.textureSize,data=new Uint8Array(size*size*4);
 const lattice=(x,y,period)=>{
  const ix=((x%period)+period)%period,iy=((y%period)+period)%period;
  let h=Math.imul(ix+17,374761393)^Math.imul(iy+31,668265263);
  h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;
 };
 const noise=(x,y,step)=>{
  const u=x/step,v=y/step,ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy;
  const ease=t=>t*t*t*(t*(t*6-15)+10),a=ease(fx),b=ease(fy),period=size/step;
  const p=lattice(ix,iy,period)*(1-a)+lattice(ix+1,iy,period)*a;
  const q=lattice(ix,iy+1,period)*(1-a)+lattice(ix+1,iy+1,period)*a;
  return p*(1-b)+q*b;
 };
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  // Almost-white variation avoids multiplying two dark base colours. The
  // same restrained aggregate supplies sub-millimetre raster bump detail.
  const mineral=.52*noise(x,y,4)+.34*noise(x,y,16)+.14*noise(x,y,64);
  const value=Math.round(255*(.94+.05*mineral)),i=(x+y*size)*4;
  data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
 }
 const texture=new T.DataTexture(data,size,size,T.RGBAFormat,T.UnsignedByteType);
 texture.name='IRIS09 / periodic mineral microfinish';texture.colorSpace=T.NoColorSpace;
 texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.generateMipmaps=true;
 texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;
 texture.anisotropy=4;texture.needsUpdate=true;
 const finish=(name,color,roughness,bumpScale)=>{
  const material=sourceFloorMaterial.clone();material.name=name;
  // Material.copy deliberately omits compile hooks. Preserve the original
  // energy partition and source display curve on both architectural finishes.
  material.onBeforeCompile=sourceFloorMaterial.onBeforeCompile;
  material.customProgramCacheKey=sourceFloorMaterial.customProgramCacheKey;
  material.color.set(color);material.roughness=roughness;
  material.map=texture;material.bumpMap=texture;material.bumpScale=bumpScale;
  return material;
 };
 const floorMaterial=finish('IRIS09 / burnt mineral floor',IRIS09_ROOM.floorColor,IRIS09_ROOM.floorRoughness,.00065);
 const wallMaterial=finish('IRIS09 / dark mineral architectural return',IRIS09_ROOM.wallColor,IRIS09_ROOM.wallRoughness,.00045);
 const geometries=[];
 const box=(name,size,position,material)=>{
  const geometry=new T.BoxGeometry(...size),mesh=new T.Mesh(geometry,material);
  mesh.name=name;mesh.position.set(...position);mesh.receiveShadow=true;
  // Directional lights represent finite softboxes located INSIDE this room.
  // A wall beyond a finite emitter must not occlude its infinite proxy ray.
  mesh.castShadow=false;root.add(mesh);geometries.push(geometry);
  const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;
  for(let i=0;i<p.count;i++){
   const x=p.getX(i)+position[0],y=p.getY(i)+position[1],z=p.getZ(i)+position[2];
   const a=Math.abs(n.getY(i))>.5?x:Math.abs(n.getX(i))>.5?z:x;
   const b=Math.abs(n.getY(i))>.5?z:y;
   uv.setXY(i,a/IRIS09_ROOM.texturePeriod,b/IRIS09_ROOM.texturePeriod);
  }
  uv.needsUpdate=true;return mesh;
 };
 const floor=box('IRIS09 / solid floor slab',[80,IRIS09_ROOM.floorThickness,80],
  [0,IRIS09_ROOM.floorHeight-IRIS09_ROOM.floorThickness*.5,0],floorMaterial);
 const back=box('IRIS09 / solid rear wall',[80,14,.18],[0,6.9,IRIS09_ROOM.backFace-.09],wallMaterial);
 const side=box('IRIS09 / solid left return',[.20,14,44.2],[IRIS09_ROOM.sideFace-.10,6.9,17.9],wallMaterial);
 let disposed=false;
 return {root,floor,back,side,floorMaterial,wallMaterial,texture,
  metadata:Object.freeze({geometry:'Solid floor slab and perpendicular full-height architectural return',
   opaqueDraws:IRIS09_ROOM.opaqueDraws,triangles:IRIS09_ROOM.triangles,textureBytes:data.byteLength,
   retained:'Original mechanism, camera, calibrated lights, source tone curve and shadow map',
   transport:'Raster PBR and existing cached source environment; no new render pass or ray traversal'}),
  dispose(){if(disposed)return;disposed=true;for(const geometry of geometries)geometry.dispose();floorMaterial.dispose();wallMaterial.dispose();texture.dispose();},
 };
}

export function createIris09MeshStage(T){
 // The closest authored camera remains more than two units from the housing.
 // A fitted near plane retains depth precision between the thin iris leaves.
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(27,1,1,60);
 const metadata={name:'IRIS / 09',revision:3,adapterVersion:'constrained-mechanism-2',sourceSha256:IRIS09_SOURCE_SHA256,
  presentation:'Live source-derived geometry; raster PBR, prefiltered studio reflections and bounded lens coating',
  geometry:'Source exterior; redesigned rigid blades, fixed pivots, captured followers and single-input radial-slot ring',
  engineering:'Geometric constraints, not force dynamics, friction, stress analysis or manufacturing certification',
  reference:'./assets/iris09/IRIS-09.glsl',qualityTradeoff:'Raster lighting and coating approximation, not the original multi-interface ray-traced transport'};
 let resources=null,instrument=null,studio=null,rendererOwner=null,compilation=null,disposed=false,lastTime=NaN,started=0,finished=0,fadeTarget=null;
 const status={phase:'uncompiled',error:null,draws:0,get elapsedMs(){return started?(finished||performance.now())-started:0;}};
 const lenses=[];
 const quadGeometry=new T.BufferGeometry();quadGeometry.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
 const quadMaterial=new T.RawShaderMaterial({depthWrite:false,depthTest:false,transparent:true,toneMapped:false,
  uniforms:{image:{value:null},opacity:{value:1}},
  vertexShader:'precision highp float;attribute vec3 position;varying vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position,1.);}',
  fragmentShader:'precision highp float;uniform sampler2D image;uniform float opacity;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(image,vUv).rgb,opacity);}'});
 const quadScene=new T.Scene(),quadCamera=new T.Camera();quadScene.add(new T.Mesh(quadGeometry,quadMaterial));
 async function compile(renderer){
  if(disposed)throw Error('IRIS mesh stage is disposed');
  if(rendererOwner&&rendererOwner!==renderer)throw Error('IRIS mesh stage must keep one renderer');
  if(compilation)return compilation;
  rendererOwner=renderer;started=performance.now();status.phase='compiling';
  compilation=(async()=>{
   const gl=renderer.getContext(),driver=gl.getExtension('WEBGL_debug_renderer_info');
   metadata.graphicsDevice=driver?gl.getParameter(driver.UNMASKED_RENDERER_WEBGL):'Not exposed';
   resources=createIris09Materials(T,renderer);instrument=createIris09Geometry(T,{materials:resources.materials});
   // These leaves have tiny authored axial clearances: a shadow map cannot
   // resolve their clearance. Their local occlusion is reconstructed analytically.
   for(const leaf of instrument.leaves)leaf.receiveShadow=false;
   scene.add(instrument.root);scene.environment=resources.environment;scene.background=new T.Color(0x25120e);
   for(const light of resources.lights)scene.add(light);
   studio=createIris09Studio(T,resources.floorMaterial);scene.add(studio.root);
   for(const [radius,base,edge]of [[1.40,.052,.560],[2.05,-.025,.390]]){
    const lens=new T.Mesh(new T.LatheGeometry(iris09LensProfile(T,radius,base,edge),96),resources.materials.glass);
    lens.name='IRIS09 recessed plano-convex optic';lens.renderOrder=1;lenses.push(lens);scene.add(lens);
   }
   const key=resources.lights.find(light=>light.isDirectionalLight);
   if(key){key.castShadow=true;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-2.6,right:2.6,top:2.6,bottom:-2.6,near:.1,far:30});key.shadow.bias=-.00008;key.shadow.normalBias=.002;}
   scene.updateMatrixWorld(true);instrument.update(0);updateIris09Camera(camera,iris09Pose(0,1000,900),1000,900);
   // Warm actual display, shadow and buffer variants before the first scroll.
   // KHR shader compilation alone does not finalize D3D executable state.
   if(renderer.compileAsync)await prepareVisiblePrograms(T,renderer,scene,camera);else renderer.compile(scene,camera);
   if(disposed)return;
   const warm=new T.WebGLRenderTarget(16,16,{colorSpace:renderer.outputColorSpace});
   warm.isXRRenderTarget=true;scene.userData.preparingBuffers=true;
   const previous=renderer.getRenderTarget(),exposure=renderer.toneMappingExposure;
   try{renderer.setRenderTarget(warm);renderer.toneMappingExposure=1;renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);}
   finally{renderer.setRenderTarget(previous);renderer.toneMappingExposure=exposure;delete scene.userData.preparingBuffers;warm.dispose();}
   if(disposed)return;
   metadata.geometryStats=instrument.metadata;metadata.materials=resources.metadata;metadata.studio=studio.metadata;status.phase='ready';finished=performance.now();
  })().catch(error=>{status.error=error.message;status.phase='error';finished=performance.now();throw error;});
  return compilation;
 }
 function render(renderer,{progress,width,height,opacity=1}){
  if(disposed)return false;if(status.phase!=='ready')return false;if(opacity<=0)return false;
  if(renderer!==rendererOwner)throw Error('IRIS mesh stage belongs to another renderer');
  const pose=iris09Pose(progress,width,height),time=pose.time*2;
  if(time!==lastTime){instrument.update(time);lastTime=time;renderer.shadowMap.needsUpdate=true;}
  updateIris09Camera(camera,pose,width,height);
  const saved={target:renderer.getRenderTarget(),autoClear:renderer.autoClear,exposure:renderer.toneMappingExposure};
  try{
   renderer.autoClear=true;renderer.toneMappingExposure=1;
   if(opacity>=1){renderer.render(scene,camera);}
   else{
    if(!fadeTarget){fadeTarget=new T.WebGLRenderTarget(width,height,{samples:4});fadeTarget.texture.colorSpace=T.SRGBColorSpace;fadeTarget.isXRRenderTarget=true;}
    if(fadeTarget.width!==width||fadeTarget.height!==height)fadeTarget.setSize(width,height);
    renderer.setRenderTarget(fadeTarget);renderer.render(scene,camera);renderer.setRenderTarget(saved.target);
    renderer.autoClear=false;quadMaterial.uniforms.image.value=fadeTarget.texture;quadMaterial.uniforms.opacity.value=opacity;renderer.render(quadScene,quadCamera);
   }
   status.draws++;return true;
  }finally{renderer.setRenderTarget(saved.target);renderer.autoClear=saved.autoClear;renderer.toneMappingExposure=saved.exposure;}
 }
 return {metadata,status,compile,render,
  dispose(){if(disposed)return;disposed=true;status.phase='disposed';instrument?.dispose();for(const lens of lenses)lens.geometry.dispose();studio?.dispose();resources?.dispose();fadeTarget?.dispose();quadGeometry.dispose();quadMaterial.dispose();}
 };
}
