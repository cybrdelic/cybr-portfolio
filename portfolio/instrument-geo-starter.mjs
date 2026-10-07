import {fitMobileView} from './instrument-mobile-story.mjs';
import {attachMetalCoordinates} from './instrument-metal-coordinates.mjs';
import {setupRasterLighting} from './instrument-raster-lighting.mjs';
import {createRasterPaper} from './instrument-raster-paper.mjs';

// A complete real GEO component while the full instrument loads. It shares
// the renderer and exact native mesh bytes; no image or reduced mesh is used.
export async function createGeoStarter({THREE,renderer,surface,manifest,buffer,environment,texture,
  makeMaterial,forgetMaterial,slider,reduced,onFrame=()=>{},scrollDriven=false,onProgress=()=>{}}){
  const scene=new THREE.Scene(),group=new THREE.Group();scene.add(group);
  const objects=[],materials=new Map(),camera=new THREE.OrthographicCamera();
  const geometryFor=record=>{
    const geometry=new THREE.BufferGeometry();
    for(const [key,size,name] of [['positions',3,'position'],['normals',3,'normal'],['uv',2,'uv'],['occlusion',1,'occlusion'],['finish',2,'finish'],['colors',3,'color']]){
      const spec=record[key];if(!spec)continue;
      const Type=spec.dtype==='int16'?Int16Array:Float32Array;
      geometry.setAttribute(name,new THREE.BufferAttribute(new Type(buffer,spec.offset,spec.count),size,Type===Int16Array));
    }
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer,record.indices.offset,record.indices.count),1));
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    if([0,1,2,5,8,9].includes(record.material))attachMetalCoordinates({THREE,geometry,mesh:record,materialIndex:record.material});
    return geometry;
  };
  let adapter;
  try{
    const gl=renderer.getContext?.(),debug=gl?.getExtension('WEBGL_debug_renderer_info');
    if(gl)adapter={renderer:String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER))};
  }catch{ /* Diagnostic metadata is optional and collected before any draw. */ }
  renderer.setPixelRatio(1);renderer.setClearColor(0xf4f4f2,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  scene.background=createRasterPaper(THREE,{color:0xf4f4f2,exposure:1});
  const env=new THREE.DataTexture(new Float32Array(environment),1024,512,THREE.RGBAFormat,THREE.FloatType);
  env.colorSpace=THREE.LinearSRGBColorSpace;env.flipY=false;env.mapping=THREE.EquirectangularReflectionMapping;env.needsUpdate=true;
  const pmrem=new THREE.PMREMGenerator(renderer),environmentTarget=pmrem.fromEquirectangular(env);pmrem.dispose();
  scene.environment=environmentTarget.texture;scene.environmentRotation.set(Math.PI/2,0,0);scene.environmentIntensity=.38;
  texture.colorSpace=THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  for(const record of manifest.meshes.filter(mesh=>mesh.module==='geo')){
    if(!materials.has(record.material)){
      const material=makeMaterial(record.material,texture,'geo'),originalKey=material.customProgramCacheKey.bind(material);
      material.customProgramCacheKey=()=>originalKey()+'-geo-starter-v1';materials.set(record.material,material);
    }
    const object=new THREE.Mesh(geometryFor(record),materials.get(record.material));
    object.position.x=record.assemblyShiftX||0;object.userData.meshRecord=record;group.add(object);objects.push(object);
  }
  scene.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(group,false),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
  const radius=size.length()*.5,lighting=setupRasterLighting({THREE,renderer,scene,objects,groups:new Map([['geo',group]]),studio:true});
  let yaw=Math.atan2(-80,50),pitch=.57,frame=0,disposed=false,drawCount=0,angle=scrollDriven?0:50,lastWidth=0,lastHeight=0,drag;
  function fit(){
    const width=surface.clientWidth,height=surface.clientHeight,aspect=width/height;
    if(width!==lastWidth||height!==lastHeight){renderer.setSize(width,height,false);lastWidth=width;lastHeight=height;}
    let view=radius*2.25/Math.min(aspect,1);
    camera.near=.1;camera.far=radius*12;camera.up.set(0,0,1);
    camera.position.set(center.x+Math.cos(yaw)*Math.cos(pitch)*radius*4,center.y+Math.sin(yaw)*Math.cos(pitch)*radius*4,center.z+Math.sin(pitch)*radius*4);
    camera.lookAt(center);camera.updateMatrixWorld();
    if(scrollDriven)view=fitMobileView(camera,bounds,aspect,0,radius*4,.80);
    camera.left=-view*aspect/2;camera.right=-camera.left;camera.top=view/2;camera.bottom=-camera.top;
    camera.updateProjectionMatrix();
  }
  function render(){
    frame=0;if(disposed||document.hidden)return;
    fit();lighting.update(camera,{progress:0,moving:false,geometryChanged:drawCount===0,now:performance.now()});
    renderer.setRenderTarget(null);renderer.render(scene,camera);drawCount++;onFrame();
  }
  function schedule(){if(!frame&&!disposed)frame=requestAnimationFrame(render);}
  function rotate(){angle=Number(slider.value);yaw=Math.atan2(-80,50)+(scrollDriven?angle/100*.22:(angle-50)/100*Math.PI*2);slider.setAttribute('aria-valuetext',`Rotate GEO: ${Math.round((angle-50)*3.6)} degrees`);schedule();}
  function input(){rotate();onProgress(angle/100);}
  function pointerDown(event){drag={id:event.pointerId,x:event.clientX,y:event.clientY,angle};}
  function pointerMove(event){
    if(!drag||drag.id!==event.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(dy))return;
    renderer.domElement.setPointerCapture(event.pointerId);slider.value=Math.max(0,Math.min(100,drag.angle+dx/surface.clientWidth*100));input();
  }
  function pointerEnd(){drag=undefined;}
  function visibility(){if(!document.hidden)schedule();}
  fit();surface.append(renderer.domElement);await renderer.compileAsync(scene,camera);render();
  slider.disabled=false;slider.value=angle;slider.setAttribute('aria-label',scrollDriven?'Instrument tour progress':'Rotate the GEO component');
  slider.addEventListener('input',input);window.addEventListener('resize',schedule);document.addEventListener('visibilitychange',visibility);
  const canvas=renderer.domElement;canvas.style.pointerEvents=scrollDriven?'none':'auto';canvas.style.touchAction='pan-y';
  // A scroll-driven preview never captures a canvas gesture.
  if(!scrollDriven){
    canvas.addEventListener('pointerdown',pointerDown,{passive:true});canvas.addEventListener('pointermove',pointerMove,{passive:true});
    canvas.addEventListener('pointerup',pointerEnd,{passive:true});canvas.addEventListener('pointercancel',pointerEnd,{passive:true});
  }
  return{reset(){slider.value=scrollDriven?0:50;rotate();},setProgress(p){slider.value=Math.max(0,Math.min(1,p))*100;rotate();},snapshot(){return{ready:true,preview:true,fullReady:false,adapter,module:'geo',meshes:objects.length,camera:camera.position.toArray(),scrollDriven,
    triangles:manifest.meshes.filter(mesh=>mesh.module==='geo').reduce((n,mesh)=>n+mesh.indices.count/3,0),drawCount,target:angle/100,progress:angle/100,
    geometryHash:manifest.stats.sha256,verifiedGeometryHash:manifest.progressiveGeo.sha256Decoded,geometryVerificationScope:'GEO only',startup:window.instrumentStartup};},
    dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);slider.removeEventListener('input',input);slider.removeAttribute('aria-label');
      window.removeEventListener('resize',schedule);document.removeEventListener('visibilitychange',visibility);
      canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',pointerEnd);canvas.removeEventListener('pointercancel',pointerEnd);
      canvas.style.removeProperty('pointer-events');canvas.style.removeProperty('touch-action');
      lighting.dispose();objects.forEach(object=>object.geometry.dispose());
      for(const material of materials.values()){material.dispose();forgetMaterial(material);}environmentTarget.dispose();env.dispose();}}
}
