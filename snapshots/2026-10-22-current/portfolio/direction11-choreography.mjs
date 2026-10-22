import * as T from './vendor/three-r180/three.module.min.js';
import {SHADOW_STUDIO} from './direction11-studio-rig.mjs';
const keys=['geo','light','material','elements','song','combat','scenes'];
const clamp=t=>Math.max(0,Math.min(1,t));
export const ease=t=>{t=clamp(t);return t*t*t*(t*(t*6-15)+10);};
export function choreographyState(progress){const time=clamp(progress)*7,index=Math.min(6,Math.floor(time)),local=clamp(time-index),blend=index<6?ease((local-.64)/.36):0;return {index,local,next:Math.min(6,index+1),blend,key:keys[index]};}
export function chapterPresentation(state){
 const {index,next,blend}=state;
 return {index:blend<.5?index:next,opacity:blend<.5?1-ease((blend-.25)/.2):ease((blend-.55)/.2)};
}
// A single actuator coordinate owns every driven part. GEO demonstrates the
// complete stroke, LIGHT returns through the same stroke, and MATERIAL opens
// to a readable inspection pose. The boundary velocities are zero in both
// directions, so interrupted/reversed scrolling cannot reset the mechanism.
export function mechanismDrive(progress){
 const beat=clamp(progress)*7;
 if(beat<=1)return ease(beat);
 if(beat<=2)return 1-ease(beat-1);
 return .72*ease((beat-2)/.5);
}
// One deterministic camera, not seven independent camera resets. All staging
// is derived from scroll; reverse and interrupted scroll have no stored tween.
export function createShadowChoreography(){
 const atmosphere=new T.FogExp2(0xc7ad8f,.00024);
 const camera=new T.PerspectiveCamera(39,1,.4,20000),a=new T.Vector3(),b=new T.Vector3();
 const poses=[
  [[4,3.6,24],[0,-.7,0],34,-.17],
  [[6,3.2,23],[0,-.7,0],34,-.17],
  [[4,2.5,9],[-1.5,.3,0],26,-.27],
  [[0,.6,12],[0,-1.3,0],39,-.22],
  [[0,1.2,14],[0,-.8,0],39,-.12],
  [[1,.2,10.5],[0,-1.8,0],35,-.18],
  [[2.1,-3.8,-30.4],[-.15,-3.7,-39.65],54,0]
 ];
 function apply(progress,{width,height,mechanism,splash,score,projects,set,ground,sun,studioKey,fireSpill,fill,hemi,scene,studio,splashStudio=studio,elementsTime=0,outdoor,sky}){
  const s=choreographyState(progress),t=s.blend,i=s.index,j=s.next,aspect=width/height;
  const visible=k=>i===k||(j===k&&t>0);
  // The incoming silhouette arrives before the outgoing silhouette leaves.
  // Symmetric slides left an empty stage at the midpoint.
  const departure=ease((t-.35)/.65),arrival=ease(t*2);
  const offset=k=>i===k?(j!==i?-12*departure:0):6*(1-arrival);
  if(mechanism){
  mechanism.root.visible=i<3;
  mechanism.root.position.x=i===2?-14*departure:0;
  mechanism.root.position.y=-.28;
  // The housing is the stationary reaction frame. Only the mechanism solver
  // may rotate its cam, pinion, and leaves; showcase orientation is fixed.
  mechanism.root.rotation.set(0,-.25,0);
  mechanism.update(mechanismDrive(progress),1,'mechanism',1);
  mechanism.root.visible=i<3;mechanism.whiteprint.update(0);
  }
  splash.root.visible=visible(3);splash.update(clamp(progress*7-3),{time:elementsTime});splash.root.position.x=offset(3);
  if(splash.root.userData.elementsShader){splash.root.scale.setScalar(1.45);splash.root.position.y=-3.35-.013*1.45;}
  else splash.root.position.y=-3.3;
  if(!splash.root.userData.elementsShader&&splashStudio&&splash.root.userData.reflectionStudio!==splashStudio){splash.root.traverse(o=>{if(o.isMesh&&!o.material.isShaderMaterial){o.material.envMap=splashStudio;o.material.envMapIntensity=1;o.material.needsUpdate=true;}});splash.root.userData.reflectionStudio=splashStudio;}
  score.root.visible=visible(4);score.update(i===4?s.local:0);score.root.position.x+=offset(4);
  if(i===4){score.root.position.x=1.8+6*departure;score.root.position.y+=8*t;}
  if(projects){
   projects.groups.root.visible=i>=4||j>=4&&t>0;
   projects.groups.elements.visible=projects.groups.song.visible=false;
   projects.groups.combat.visible=visible(5);projects.groups.combat.position.set(offset(5),-1.55,8);
   if(visible(5))projects.update(.68+(i===5?s.local:0)*.16,null,'combat');
   // update() has legacy visibility side effects; restore authored ownership.
   projects.groups.root.visible=i>=4||j>=4&&t>0;projects.groups.elements.visible=projects.groups.song.visible=false;
   projects.groups.combat.visible=visible(5);projects.groups.scenes.visible=visible(6);
   projects.groups.scenes.position.set(0,-2.8,-28.5);
   projects.groups.scenes.userData.waterSunBlend=i===6?1:j===6?ease((t-.65)/.35):0;
   if(outdoor)projects.groups.scenes.traverse(o=>{if(o.isMesh&&o.material.envMap!==outdoor){o.material.envMap=outdoor;o.material.needsUpdate=true;}});
  }
  set.update(s.key);
  set.setOutdoorEnvironment?.(outdoor);
  if(set.root.userData.wetness)set.root.userData.wetness.value=splash.root.userData.elementsShader?0:T.MathUtils.lerp(i===3?1:0,j===3?1:0,t);
  if(j===6)set.transitionToScene(i===6?1:t);
  ground.visible=false;
  const p=poses[i],q=poses[j],travel=j===6?ease((t-.2)/.8):t;camera.aspect=aspect;
  camera.position.copy(a.fromArray(p[0]).lerp(b.fromArray(q[0]),travel));
  camera.lookAt(a.fromArray(p[1]).lerp(b.fromArray(q[1]),travel));
  const fov=k=>k===6?2*Math.atan(Math.tan(32*Math.PI/180)/aspect)*180/Math.PI:poses[k][2];
  camera.fov=T.MathUtils.lerp(fov(i),fov(j),travel);camera.clearViewOffset();
  camera.setViewOffset(width,height,T.MathUtils.lerp(p[3],q[3],travel)*width,0,width,height);camera.updateProjectionMatrix();
  const lights=[[8,5,2],[6,4,-1],[7,5,3],[7,5,-2],[8,4,3],[7,5,4],[-30,12,-55]];
  sun.position.copy(a.fromArray(lights[i]).lerp(b.fromArray(lights[j]),t));
  const outdoors=i===6?1:j===6?t:0;sun.target.position.set(-outdoors,-2-2*outdoors,-36*outdoors);sun.target.updateMatrixWorld();
  // Bias is in normalized shadow depth: the landscape needs a different
  // receiver offset from the small studio mechanism, blended during travel.
  sun.shadow.bias=-.0004*outdoors;sun.shadow.normalBias=T.MathUtils.lerp(.006,.035,outdoors);
  // Tight studio coverage retains shadow detail at the same map resolution.
  const shadowExtent=k=>k<6?10:16;
  const extent=T.MathUtils.lerp(shadowExtent(i),shadowExtent(j),t);
  Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent});sun.shadow.camera.updateProjectionMatrix();
  set.material.color.set(SHADOW_STUDIO.floorColor);sun.color.set(SHADOW_STUDIO.keyColor).lerp(new T.Color(0xffdfae),outdoors);fill.color.set(SHADOW_STUDIO.fillColor);
  const keyPower=[3.8,5.2,4.1,4.3,4.2,3.8,3.5];
  sun.intensity=T.MathUtils.lerp(keyPower[i],keyPower[j],t);
  if(studioKey){
   // Same source as the reflection card. Moving a separate light made the
   // reflected highlight and the actual shadow point in opposite directions.
   studioKey.position.fromArray(SHADOW_STUDIO.keyPosition);
   studioKey.target.position.fromArray(SHADOW_STUDIO.keyTarget);studioKey.target.updateMatrixWorld();
   studioKey.color.copy(sun.color);
   // Match authored illuminance at the subject, then let inverse-square
   // falloff light the actual room. The cone is wide enough for the set.
   const indoorPower=j===6?keyPower[5]:sun.intensity;
   studioKey.intensity=indoorPower*studioKey.position.distanceToSquared(studioKey.target.position)*(1-outdoors);
   sun.position.fromArray(lights[6]);sun.target.position.set(-1,-4,-36);sun.target.updateMatrixWorld();
   // Centimetre-scale offsets detached the threshold wall's shadow from
   // its footing. The fitted 32-unit shadow volume needs millimetres here.
   sun.intensity=3.5*outdoors;sun.shadow.bias=-.00008;sun.shadow.normalBias=.006;
   Object.assign(sun.shadow.camera,{left:-16,right:16,top:16,bottom:-16});sun.shadow.camera.updateProjectionMatrix();
   // Stable light/shadow counts avoid compiling a new beauty shader at the
   // exit. An inactive light still exists, but does not render its shadow map.
   sun.visible=studioKey.visible=true;
   studioKey.shadow.autoUpdate=outdoors<1;sun.shadow.autoUpdate=outdoors>0;
   if(outdoors===1)studioKey.shadow.needsUpdate=false;
   if(outdoors===0)sun.shadow.needsUpdate=false;
  }
  // Keep a directional key and real cast shadows. A weak cool fill separates
  // the source garments without repainting them or adding another light pass.
  const portrait=T.MathUtils.lerp(i===5?1:0,j===5?1:0,t);
  fill.intensity=T.MathUtils.lerp(SHADOW_STUDIO.fillIntensity+.12*portrait,.8,outdoors);hemi.intensity=T.MathUtils.lerp(SHADOW_STUDIO.hemisphereIntensity,.85,outdoors);
  hemi.groundColor.set(0x552218).lerp(new T.Color(0x883f2a),outdoors);
  if(fireSpill){
   // A broad static proxy for the captured emissive fire, not live GI. Its
   // inverse-square spill is captured with the room, never rebuilt per frame.
   const presence=T.MathUtils.lerp(i===3?1:0,j===3?1:0,t);
   fireSpill.position.set(splash.root.position.x,-.7,0);fireSpill.intensity=12*presence;
  }
  // Own the rotation as well as the environment. The legacy page director
  // otherwise snapped it by half a radian at the SCENES chapter boundary.
  scene.environment=studio;scene.environmentRotation.set(0,0,0);scene.environmentIntensity=SHADOW_STUDIO.environmentIntensity;
  scene.background=outdoors>0&&sky?sky:null;
  atmosphere.density=.00012*outdoors;scene.fog=outdoors>0?atmosphere:null;
  splash.setLightWorld?.((studioKey||sun).position);
  return {camera,state:s};
 }
 return {apply};
}
