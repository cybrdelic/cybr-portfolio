// Lathe-cut annuli need a circumferential brushing direction. A single UV
// tangent makes the entire planar ring reflect like a flat sheet of metal.
// Retain the CYBR MATERIAL maps and use Three's anisotropic microfacet BRDF;
// this changes the fabrication direction, never paints a highlight.
export function applyTurnedFinish(parts,{anisotropy=.85}={}){
 const owned=[];
 for(const part of parts){
  if(!/120T (involute|reference) cam gear|132T involute cam ring|Fixed rear bearing carrier|Circular machined chassis|Fixed bearing outer race|Fixed bearing shoulder|Optical retaining mask|Lens retaining lip/.test(part.name))continue;
  const original=part.material,m=original.clone();m.anisotropy=anisotropy;
  m.onBeforeCompile=shader=>{
   shader.vertexShader='varying vec3 vLatheTangent;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nvLatheTangent = normalMatrix * vec3(-position.y, position.x, 0.0);');
   shader.fragmentShader='varying vec3 vLatheTangent;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>
    vec3 latheT = vLatheTangent - normal * dot(vLatheTangent, normal);
    if(dot(latheT,latheT)>0.00001){
      material.anisotropyT=normalize(latheT);
      material.anisotropyB=normalize(cross(normal,material.anisotropyT));
    }
   `);
  };
  m.customProgramCacheKey=()=> 'cybr-presentation-circumferential-brushing-v1';
  part.material=m;owned.push({part,original,m});
 }
 return {dispose(){for(const {part,original,m} of owned){part.material=original;m.dispose();}}};
}
