import * as T from './vendor/three-r180/three.module.min.js';
import {SHADOW_STUDIO} from './direction11-studio-rig.mjs';

// Shared physical plaster finish for the floor and the architectural backdrop.
export function createShadowSet(){
 const size=512,data=new Uint8Array(size*size*4);let seed=917;
 const noise=new Float32Array(size*size);
 for(let i=0;i<noise.length;i++){seed=(seed+0x6d2b79f5)|0;let h=Math.imul(seed^(seed>>>15),1|seed);h^=h+Math.imul(h^(h>>>7),61|h);noise[i]=((h^(h>>>14))>>>0)/4294967296;}
 // Mineral aggregate, trowel-scale variation and pores have independent
 // spatial scales. The old single-pixel noise vanished into the mip chain.
 const sample=(x,y,step)=>{const u=x/step,v=y/step,ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy,s=t=>t*t*(3-2*t),at=(a,b)=>noise[((b*step)%size)*size+(a*step)%size];return T.MathUtils.lerp(T.MathUtils.lerp(at(ix,iy),at(ix+1,iy),s(fx)),T.MathUtils.lerp(at(ix,iy+1),at(ix+1,iy+1),s(fx)),s(fy));};
 const height=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const n=noise[y*size+x],aggregate=sample(x,y,4),trowel=sample(x,y,32),v=.94+.035*aggregate+.025*trowel,i=(y*size+x)*4;
  // Pigment belongs to the base colour. This map only varies it a few percent:
  // a middle-gray map previously multiplied an already-dark finish twice.
  data[i]=data[i+1]=data[i+2]=255*v;data[i+3]=255;
  const h=Math.max(0,Math.min(255,90+75*aggregate+25*trowel+15*n-(n>.985?65:0)));
  height[i]=h;height[i+1]=255*(.76+.16*trowel+.06*aggregate);height[i+2]=h;height[i+3]=255;
 }
 const map=new T.DataTexture(data,size,size),relief=new T.DataTexture(height,size,size);map.colorSpace=T.SRGBColorSpace;
 for(const texture of [map,relief]){texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(96,96);texture.generateMipmaps=true;texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;texture.anisotropy=8;texture.needsUpdate=true;}
 const wetness={value:0};
 const material=new T.MeshPhysicalMaterial({color:SHADOW_STUDIO.floorColor,map,bumpMap:relief,bumpScale:.0035,roughnessMap:relief,roughness:.88,clearcoat:0});
 function mineralRoomFinish(shader){
  shader.vertexShader='varying vec3 mineralRoomPoint;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nmineralRoomPoint=(modelMatrix*vec4(position,1.)).xyz;');
  shader.fragmentShader='varying vec3 mineralRoomPoint;\n'+shader.fragmentShader;
  // Concave-contact approximation, anchored to the actual floor/wall join.
  // Never darken direct illumination or paint a screen-space vignette.
  shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',`#include <aomap_fragment>
   float cornerDistance=max(mineralRoomPoint.y+3.35,0.)/.38+max(mineralRoomPoint.z+6.25,0.)/.65;
   float cornerVisibility=1.-.42*exp(-cornerDistance);
   reflectedLight.indirectDiffuse*=cornerVisibility;
   reflectedLight.indirectSpecular*=sqrt(cornerVisibility);`);
 }
 material.onBeforeCompile=shader=>{
  mineralRoomFinish(shader);
  shader.uniforms.liquidWetness=wetness;
  const reflection=root.userData.wetReflection;
  if(!reflection){
   shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat=0.;\n#endif');
   return;
  }
  shader.uniforms.stageReflection=reflection?.texture||{value:null};shader.uniforms.stageReflectionMatrix=reflection?.matrix||{value:new T.Matrix4()};shader.uniforms.stageReflectionReady=reflection?.ready||{value:0};
  shader.vertexShader='varying vec3 stagePoint;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nstagePoint=(modelMatrix*vec4(position,1.)).xyz;');
  shader.fragmentShader='varying vec3 stagePoint;uniform float liquidWetness;uniform sampler2D stageReflection;uniform mat4 stageReflectionMatrix;uniform float stageReflectionReady;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
   float wetRadius=length((stagePoint.xz-vec2(.12,.08))/vec2(7.,6.));
   float wet=liquidWetness*(1.-smoothstep(.65,1.,wetRadius))*(1.-smoothstep(.02,.12,abs(stagePoint.y+3.35)));
   roughnessFactor=mix(roughnessFactor,.65,wet);`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat*=wet*.35;\n#endif');
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`vec4 reflectedPoint=stageReflectionMatrix*vec4(stagePoint,1.);
   vec2 reflectedUV=reflectedPoint.xy/reflectedPoint.w;
   float reflectionBounds=step(0.,reflectedUV.x)*step(reflectedUV.x,1.)*step(0.,reflectedUV.y)*step(reflectedUV.y,1.);
   float fresnel=.04+.96*pow(1.-abs(dot(normal,geometryViewDir)),5.);
   vec4 reflectionSample=texture2D(stageReflection,reflectedUV);
   outgoingLight=mix(outgoingLight,reflectionSample.rgb,wet*stageReflectionReady*reflectionBounds*fresnel*reflectionSample.a);
   #include <opaque_fragment>`);
 };
 material.customProgramCacheKey=()=> 'shadow-stage-calibrated-mineral-v3-clearcoat-guard';
 material.addEventListener('dispose',()=>relief.dispose());
 const wallMaterial=material.clone();wallMaterial.clearcoat=0;wallMaterial.color.set(SHADOW_STUDIO.wallColor);wallMaterial.bumpScale=.002;wallMaterial.roughness=.97;
 wallMaterial.onBeforeCompile=mineralRoomFinish;wallMaterial.customProgramCacheKey=()=> 'shadow-wall-calibrated-mineral-v2';
 // The exterior has the same mineral finish, but a different incident light
 // field. Keeping it separate also avoids sampling a wet-floor render target
 // from walls and dry outdoor architecture.
 const exteriorMaterial=wallMaterial.clone();exteriorMaterial.color.set(0xad4a2a);
 const terraceMaterial=exteriorMaterial.clone();terraceMaterial.bumpScale=.002;
 const root=new T.Group();
 root.userData.wetness=wetness;
 // A solid architectural room. Metric UVs retain the same plaster grain on
 // a short reveal and a long floor; box-default UVs stretched it by wall size.
 const sweep=new T.Group();sweep.name='Solid warm mineral studio';root.add(sweep);
 const roomGeometries=[];
 function metricUV(mesh){
  root.updateMatrixWorld(true);
  const geometry=mesh.geometry,p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;
  const point=new T.Vector3(),normal=new T.Vector3(),normalMatrix=new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for(let i=0;i<p.count;i++){
   point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
   normal.fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize();
   const {x,y,z}=point;
   if(Math.abs(normal.y)>.5)uv.setXY(i,x/100,z/100);
   else if(Math.abs(normal.x)>.5)uv.setXY(i,z/100,y/100);
   else uv.setXY(i,x/100,y/100);
  }
  uv.needsUpdate=true;
 }
 function solid(parent,name,geometry,position,finish=wallMaterial,rotation=0){
  const mesh=new T.Mesh(geometry,finish);mesh.name=name;mesh.position.set(...position);mesh.rotation.y=rotation;
  mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);roomGeometries.push(geometry);metricUV(mesh);return mesh;
 }
 const slab=(parent,name,size,position,finish,rotation)=>solid(parent,name,new T.BoxGeometry(...size),position,finish,rotation);
 const floor=slab(sweep,'Floor slab',[70,.35,60],[0,-3.525,12],material);
 // A real opening with pocket doors. The former handoff translated the
 // entire studio 90 units, removing the ground before the camera even moved.
 const opening=new T.Group();opening.name='Open wall assembly';sweep.add(opening);
 slab(opening,'Back wall / left',[15,20,.5],[-17.5,6.65,-6.5]);
 slab(opening,'Back wall / right',[15,20,.5],[17.5,6.65,-6.5]);
 slab(opening,'Back wall / lintel',[20,7,.5],[0,13.15,-6.5]);
 // The closed pose is one welded volume, not touching boxes with internal
 // faces that self-shadow as dotted seams. Opening exposes the actual jambs.
 const closedWall=slab(sweep,'Closed flush wall',[50,20,.5],[0,6.65,-6.5]);
 slab(sweep,'Left return',[.55,20,35],[-25,6.65,10.75]);
 const doors=[
  slab(opening,'Pocket door / left',[10,13,.4],[-5,3.15,-6.45],wallMaterial),
  slab(opening,'Pocket door / right',[10,13,.4],[5,3.15,-6.45],wallMaterial)
 ];
 // The final chapter is a room opening, not a scissor/canvas mask. The wall
 // has a deep return and the terrace edge recedes diagonally in world space.
 const architecture=new T.Group();architecture.name='Terracotta threshold';architecture.position.set(0,-.8,-5);root.add(architecture);
 slab(architecture,'Threshold wall',[100,32,1.15],[-49.8,10,-28.1],exteriorMaterial);
 // End on dry ground: the former lip extended into the pool by about a metre.
 const terraceShape=new T.Shape();terraceShape.moveTo(-100,24);terraceShape.lineTo(100,24);terraceShape.lineTo(100,-17.4);
 // A footing under the wall return, not an extended lip over the water.
 // The old diagonal stopped just short of the wall and exposed a light leak.
 terraceShape.lineTo(.2,-28.0786);terraceShape.lineTo(.2,-28.7);terraceShape.lineTo(-.6/.107,-28.7);
 terraceShape.lineTo(-100,-38.8);terraceShape.closePath();
 const terraceGeometry=new T.ExtrudeGeometry(terraceShape,{depth:.35,bevelEnabled:false});
 // Shape XY coordinates encode world XZ; its extrusion gives real thickness.
 terraceGeometry.rotateX(Math.PI/2);
 const terrace=solid(architecture,'Terrace slab',terraceGeometry,[0,-3.45,0],terraceMaterial);
 // Continuous walking surface between the studio and the lower terrace.
 // Cross-section coordinates are depth/height; extrusion supplies real width.
 const rampShape=new T.Shape();
 rampShape.moveTo(-18,-3.35);rampShape.lineTo(-27,-4.25);rampShape.lineTo(-27,-4.6);rampShape.lineTo(-18,-3.7);rampShape.closePath();
 const rampGeometry=new T.ExtrudeGeometry(rampShape,{depth:70,bevelEnabled:false});
 rampGeometry.rotateY(-Math.PI/2);rampGeometry.translate(35,0,0);
 const ramp=solid(root,'Threshold ramp',rampGeometry,[0,0,0],terraceMaterial);
 // Overhanging slab sits behind/above the camera, but intercepts the sun.
 // Its shadow is projected by the same light as the room and landscape.
 slab(architecture,'Threshold overhang',[180,.24,55],[1,12,-7.8],exteriorMaterial,-.3);
 let outdoorEnvironment=null;
 function openDoors(t){
  closedWall.visible=t<=0;opening.visible=t>0;
  // Flush when closed; retract behind the fixed returns before sliding.
  // Starting recessed exposed a heavy vertical shadow seam in every chapter.
  const recess=T.MathUtils.smoothstep(t,0,.08);
  const u=T.MathUtils.smoothstep(t,.08,.35);
  doors[0].position.x=-5-10.1*u;doors[1].position.x=5+10.1*u;
  for(const door of doors)door.position.z=-6.45-.6*recess;
 }
 return {
  root,material,reflectionReceivers:[floor,terrace,ramp],reflectionHeight:-3.35,
  setOutdoorEnvironment(environment){
   if(!environment||environment===outdoorEnvironment)return;
   outdoorEnvironment=environment;
   for(const finish of [exteriorMaterial,terraceMaterial]){finish.envMap=environment;finish.envMapIntensity=.85;finish.needsUpdate=true;}
  },
  update(chapter){root.visible=sweep.visible=true;architecture.visible=ramp.visible=chapter==='scenes';openDoors(chapter==='scenes'?1:0);},
  transitionToScene(t){root.visible=sweep.visible=true;architecture.visible=ramp.visible=t>0;openDoors(t);},
  dispose(){map.dispose();material.dispose();wallMaterial.dispose();exteriorMaterial.dispose();terraceMaterial.dispose();roomGeometries.forEach(g=>g.dispose());}
 };
}
