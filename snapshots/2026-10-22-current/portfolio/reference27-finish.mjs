// Manufacturing-scale finish over the shared CYBR MATERIAL maps. No baked
// reflections: directional roughness and the existing normal maps respond to the studio.
export function applyReference27Finish(parts){
 const owned=[];
 for(const part of parts){
  if(!/Rigid iris blade|T pinion|Pivot retainer|Pinion bearing cap|Lens retaining lip/.test(part.name))continue;
  const original=part.material,m=original.clone(),turned=/bearing cap|retaining lip|retaining mask|Pivot retainer/.test(part.name),pinion=/T pinion/.test(part.name),prior=original.onBeforeCompile;
  m.roughness=turned?.26:.66;m.normalScale?.set(.12,.12);
  if(part.name==='Lens retaining lip'){m.color.setRGB(1.05,.91,.68);m.anisotropy=.7;m.roughness=.28;}
  if(/bearing cap|Pivot retainer/.test(part.name)){m.roughness=.38;m.metalness=.85;}
  if(!turned){m.anisotropy=.12;m.anisotropyRotation=/pinion/.test(part.name)?Math.PI/4:0;m.normalScale?.set(.025,.025);}
  if(pinion){m.metalness=.72;m.clearcoat=.18;m.clearcoatRoughness=.3;m.anisotropy=.5;}
  m.onBeforeCompile=shader=>{
   prior.call(original,shader);
   if(pinion){
    shader.vertexShader='varying vec3 vGearTangent;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nvGearTangent=normalMatrix*vec3(-position.y,position.x,0.);');
    shader.fragmentShader='varying vec3 vGearTangent;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>
     vec3 gt=vGearTangent-normal*dot(normal,vGearTangent);
     if(dot(gt,gt)>.00001){material.anisotropyT=normalize(gt);material.anisotropyB=normalize(cross(normal,material.anisotropyT));}
    `);
   }
   shader.vertexShader='varying vec3 vFinishPoint;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFinishPoint=position;');
   shader.fragmentShader=`varying vec3 vFinishPoint;
    float finishHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float finishNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(finishHash(i),finishHash(i+vec2(1,0)),f.x),mix(finishHash(i+vec2(0,1)),finishHash(i+vec2(1,1)),f.x),f.y);}
   `+shader.fragmentShader;
   if(!turned)shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
    vec2 finishP=vFinishPoint.xy;
    float grain=finishNoise(finishP*95.);
    float coarse=finishNoise(finishP*12.);
    float brush=finishNoise(finishP*vec2(3.,170.));
    float footprint=max(length(dFdx(finishP)),length(dFdy(finishP)));
    float resolved=1.-smoothstep(.004,.018,footprint);
    roughnessFactor=clamp(roughnessFactor+((grain-.5)*.12*resolved+(brush-.5)*.06*resolved),.45,.9);
    diffuseColor.rgb*=1.+(grain-.5)*.06*resolved;
   `);
   // Micro-relief changes reflected light, not a mottled colour overlay. The
   // derivative footprint fades unresolved grain before it can shimmer.
   if(!turned)shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    vec2 reliefP=vFinishPoint.xy;
    float reliefFoot=max(length(dFdx(reliefP)),length(dFdy(reliefP)));
    float reliefResolve=1.-smoothstep(.004,.016,reliefFoot);
    float reliefHeight=(finishNoise(reliefP*155.)-.5)*.0006*reliefResolve;
    vec3 reliefDx=dFdx(-vViewPosition),reliefDy=dFdy(-vViewPosition);
    vec3 reliefR1=cross(reliefDy,normal),reliefR2=cross(normal,reliefDx);
    float reliefDet=dot(reliefDx,reliefR1);
    vec3 reliefGrad=sign(reliefDet)*(dFdx(reliefHeight)*reliefR1+dFdy(reliefHeight)*reliefR2);
    normal=normalize(abs(reliefDet)*normal-reliefGrad);
   `);
  };
  m.customProgramCacheKey=()=>original.customProgramCacheKey()+'-reference27-surface-v4-'+Number(pinion)+'-'+Number(turned);
  part.material=m;owned.push({part,original,m});
 }
 return {dispose(){for(const {part,original,m} of owned){part.material=original;m.dispose();}}};
}
