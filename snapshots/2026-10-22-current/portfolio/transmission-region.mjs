// Keep the original full-resolution transmission texture and mip chain.
// Only shade texels reachable by a visible, smooth dielectric. Three's volume
// ray has length <= thickness * max(modelScale); project that expanded bound.
export function installTransmissionRegion(T,renderer){
 const render=renderer.render,setTarget=renderer.setRenderTarget;
 const bounds=new T.Box3(),world=new T.Box3(),point=new T.Vector3(),scale=new T.Vector3();
 const instance=new T.Matrix4(),instanceWorld=new T.Matrix4();
 let region=null,active=false;
 renderer.render=function(scene,camera){
  const previous=region;region=null;
  if(!active){
   scene.updateMatrixWorld();camera.updateMatrixWorld();bounds.makeEmpty();let unsafe=false,roughness=0;
   scene.traverseVisible(o=>{
    if(!o.isMesh)return;
    for(const m of Array.isArray(o.material)?o.material:[o.material]){
     if(!m?.visible||!(m.transmission>0))continue;
     if(o.isSkinnedMesh||o.isInstancedMesh&&o.morphTexture||m.roughness>.1||m.thicknessMap||m.displacementMap||m.dispersion>0){unsafe=true;continue;}
     // A source shader may replace the physical material's uniform thickness
     // (native pools sample bed depth). Its explicit contract is mandatory
     // once declared; an invalid/unknown bound must never silently crop rays.
     const customThickness=Object.hasOwn(m.userData??{},'transmissionThicknessBounds');
     const thickness=customThickness?m.userData.transmissionThicknessBounds?.max:m.thickness;
     if(!Number.isFinite(thickness)||thickness<0){unsafe=true;continue;}
     if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();
     scale.setFromMatrixScale(o.matrixWorld);
     // Match Three's getVolumeTransmissionRay exactly: its length uses the
     // mesh modelMatrix scale, not instanceMatrix scale. A tiny droplet still
     // needs this full expansion with the current shared physical material.
     // Normal maps change direction only: normalize(refractionVector) has
     // components in [-1,1], so the same expansion contains EVERY ray direction.
     // Vertex displacement is different and must keep the full-frame fallback.
     const expansion=thickness*Math.max(scale.x,scale.y,scale.z);
     if(o.isInstancedMesh){
      if(!Number.isInteger(o.count)||o.count<0||o.count>o.instanceMatrix.count){unsafe=true;continue;}
      for(let i=0;i<o.count;i++){
       // Recompute from the active prefix each draw. Animated instance data
       // does not invalidate InstancedMesh.boundingBox automatically.
       o.getMatrixAt(i,instance);
       if(!instance.elements.every(Number.isFinite)||instance.elements[3]!==0||instance.elements[7]!==0||instance.elements[11]!==0||instance.elements[15]!==1){unsafe=true;break;}
       instanceWorld.multiplyMatrices(o.matrixWorld,instance);
       world.copy(o.geometry.boundingBox).applyMatrix4(instanceWorld).expandByScalar(expansion);
       if(![...world.min.toArray(),...world.max.toArray()].every(Number.isFinite)){unsafe=true;break;}
       bounds.union(world);
      }
     }else{
      world.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).expandByScalar(expansion);
      bounds.union(world);
     }
     roughness=Math.max(roughness,m.roughness*Math.max(0,Math.min(1,m.ior*2-2)));
    }
   });
   if(!unsafe&&!bounds.isEmpty()){
    let x0=1,y0=1,x1=-1,y1=-1;
    for(let i=0;i<8;i++){
     point.set(i&1?bounds.max.x:bounds.min.x,i&2?bounds.max.y:bounds.min.y,i&4?bounds.max.z:bounds.min.z).applyMatrix4(camera.matrixWorldInverse);
     if(point.z>=-camera.near){unsafe=true;break;}
     point.applyMatrix4(camera.projectionMatrix);x0=Math.min(x0,point.x);x1=Math.max(x1,point.x);y0=Math.min(y0,point.y);y1=Math.max(y1,point.y);
    }
    if(!unsafe)region={x0,y0,x1,y1,roughness};
   }
  }
  const wasActive=active,autoUpdate=scene.matrixWorldAutoUpdate;active=true;
  // The bounds pass already updated the same world matrices above.
  if(!wasActive)scene.matrixWorldAutoUpdate=false;
  try{return render.call(this,scene,camera);}finally{scene.matrixWorldAutoUpdate=autoUpdate;active=wasActive;region=previous;}
 };
 renderer.setRenderTarget=function(target,...args){
  // The half-float, multisampled target is Three's physical transmission pass;
  // depth/shadow targets must retain their own scissor state.
  const use=active&&region&&target?.texture.type===T.HalfFloatType&&target.samples>0;
  if(!use)return setTarget.call(this,target,...args);
  const old=target.scissor.clone(),test=target.scissorTest;
  const w=target.width,h=target.height,pad=Math.max(32,Math.ceil(2*Math.pow(Math.max(w,h),region.roughness))+4);
  const x=Math.max(0,Math.floor((region.x0+1)*w*.5)-pad),y=Math.max(0,Math.floor((region.y0+1)*h*.5)-pad);
  target.scissor.set(x,y,Math.max(0,Math.min(w,Math.ceil((region.x1+1)*w*.5)+pad)-x),Math.max(0,Math.min(h,Math.ceil((region.y1+1)*h*.5)+pad)-y));target.scissorTest=true;
  try{return setTarget.call(this,target,...args);}finally{target.scissor.copy(old);target.scissorTest=test;}
 };
 return {dispose(){renderer.render=render;renderer.setRenderTarget=setTarget;}};
}
