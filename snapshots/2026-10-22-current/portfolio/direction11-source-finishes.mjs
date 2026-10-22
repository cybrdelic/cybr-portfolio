// Source-attached finishes, not replacement assets. Garment UV density and
// source terrain height maps supply the coordinates; there is no random noise.
const owned=new WeakMap();
export const SOURCE_FINISH_ASSUMPTIONS=Object.freeze({
 clothPitchMetres:Object.freeze([.00065,.00085]),clothReliefMetres:.000018,
 provenance:'Authored garment optical finish scales; not measured fabric.',
 terrainProvenance:'Original native height-map coordinates and authored relief gains preserved; map displacement is not calibrated in metres.'
});

// Robust area-weighted rest-mesh UV metric. No planar UV substitute: an asset
// without valid source UVs receives no invented spatial surface detail.
export function sourceUvMetres(geometry,metresPerUnit=1){
 const p=geometry.attributes.position,uv=geometry.attributes.uv,index=geometry.index;
 if(!p||!uv||uv.count!==p.count||!(metresPerUnit>0))return null;
 const count=index?index.count:p.count,triangles=Math.floor(count/3),stride=Math.max(1,Math.ceil(triangles/4096)),u=[],v=[];
 for(let triangle=0;triangle<triangles;triangle+=stride){
  const ids=[0,1,2].map(k=>index?index.getX(triangle*3+k):triangle*3+k),[a,b,c]=ids;
  const d1=[p.getX(b)-p.getX(a),p.getY(b)-p.getY(a),p.getZ(b)-p.getZ(a)],d2=[p.getX(c)-p.getX(a),p.getY(c)-p.getY(a),p.getZ(c)-p.getZ(a)];
  const du1=uv.getX(b)-uv.getX(a),dv1=uv.getY(b)-uv.getY(a),du2=uv.getX(c)-uv.getX(a),dv2=uv.getY(c)-uv.getY(a),det=du1*dv2-dv1*du2;
  const area=Math.hypot(d1[1]*d2[2]-d1[2]*d2[1],d1[2]*d2[0]-d1[0]*d2[2],d1[0]*d2[1]-d1[1]*d2[0]);
  if(!Number.isFinite(det)||Math.abs(det)<1e-12||!Number.isFinite(area)||area<1e-12)continue;
  const tu=Math.hypot(...d1.map((x,k)=>(x*dv2-d2[k]*dv1)/det))*metresPerUnit;
  const tv=Math.hypot(...d1.map((x,k)=>(d2[k]*du1-x*du2)/det))*metresPerUnit;
  if(!Number.isFinite(tu)||!Number.isFinite(tv)||tu<=0||tv<=0)continue;
  u.push([tu,area]);v.push([tv,area]);
 }
 if(!u.length)return null;
 const median=items=>{items.sort((a,b)=>a[0]-b[0]);const half=items.reduce((sum,x)=>sum+x[1],0)*.5;let sum=0;for(const [value,weight] of items){sum+=weight;if(sum>=half)return value;}return items.at(-1)[0];};
 return [median(u),median(v)];
}

export function repairNativeRelief(fragment){
 const derivative='vec3 qx=dFdx(vViewPosition),qy=dFdy(vViewPosition);vec3 rx=cross(qy,normal),ry=cross(normal,qx);float det=dot(qx,rx);';
 const gradient=/normal=normalize\(abs\(det\)\*normal-sign\(det\)\*\(dFdx\(h\)\*rx\+dFdy\(h\)\*ry\)\*(2\.0|\.012|\.045)\);/g;
 if(!fragment.includes(derivative))throw Error('Native source relief derivative changed; finish requires review');
 let matches=0;
 const repaired=fragment.replace(derivative,'vec3 qx=dFdx(-vViewPosition),qy=dFdy(-vViewPosition);vec3 rx=cross(qy,normal),ry=cross(normal,qx);float det=dot(qx,rx)*faceDirection;')
  .replace(gradient,(_,scale)=>{matches++;
   // Keep height-to-map-width ratio intact. In particular the ridge map
   // repeats every16.667 source units, so its2.0 gain is meso-scale relief,
   // not a millimetre microtexture that can share a generic amplitude cap.
   return `if(abs(det)>1.e-12)normal=normalize(abs(det)*normal-sign(det)*(dFdx(h)*rx+dFdy(h)*ry)*${scale});`;});
 if(matches!==1)throw Error('Native source relief amplitude changed; finish requires review');
 return repaired;
}

const clothNormal=`
// Filter authored sub-mm knit before it reaches the pixel grid. UVs deform
// with the original skinned garment; no view-space or world-space swimming.
vec2 d11Frequency=d11ClothUvMetres/d11ClothPitch;
vec2 d11Q=d11ClothUv*d11Frequency;
vec2 d11Footprint=fwidth(d11Q);
float d11Resolved=(1.-smoothstep(.25,.75,d11Footprint.x))*(1.-smoothstep(.25,.75,d11Footprint.y));
vec2 d11Phase=d11Q*6.28318530718;
float d11Warp=d11Phase.x+.35*sin(d11Phase.y);
vec2 d11DhDu=d11ClothHeight*d11ClothWorldScale*d11Resolved*6.28318530718*d11Frequency*
 vec2(-.6*sin(d11Warp),-.21*sin(d11Warp)*cos(d11Phase.y)-.4*sin(d11Phase.y));
// Analytic dh/du chain rule avoids taking derivatives of fwidth itself.
vec2 d11Dh=vec2(dot(d11DhDu,dFdx(d11ClothUv)),dot(d11DhDu,dFdy(d11ClothUv)));
vec3 d11Dx=dFdx(-vViewPosition),d11Dy=dFdy(-vViewPosition);
vec3 d11Rx=cross(d11Dy,normal),d11Ry=cross(normal,d11Dx);
float d11Det=dot(d11Dx,d11Rx)*faceDirection;
if(abs(d11Det)>1.e-12)normal=normalize(abs(d11Det)*normal-sign(d11Det)*(d11Dh.x*d11Rx+d11Dh.y*d11Ry));
`;

export function applyDirection11SourceFinishes(T,{combatRoot=null,sceneRoot=null,metresPerUnit=1}={}){
 const records=[],audit=[],counts={combat:0,scenes:0};
 function install(material,kind,configure){
  const active=owned.get(material);if(active&&material.onBeforeCompile===active.compile){counts[kind]++;return;}
  const before={compile:material.onBeforeCompile,key:material.customProgramCacheKey,roughness:material.roughness,sheen:material.sheen,sheenRoughness:material.sheenRoughness,sheenColor:material.sheenColor?.clone(),marker:material.userData.direction11SourceFinish};
  const key=before.key.call(material),entry={material,before};configure(entry,key);owned.set(material,entry);records.push(entry);counts[kind]++;material.needsUpdate=true;
 }
 combatRoot?.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.isSkinnedMesh||!/(shirt|shorts)/i.test(mesh.name)||Array.isArray(mesh.material))return;
  const material=mesh.material;
  const active=owned.get(material);if(active&&material.onBeforeCompile===active.compile){counts.combat++;return;}
  const metric=sourceUvMetres(mesh.geometry,metresPerUnit);
  install(material,'combat',(entry,key)=>{
   material.roughness=Math.min(material.roughness,.72);material.sheen=.32;material.sheenRoughness=.72;
   // A neutral fiber lobe reflects the light colour; the underlying dyed cloth
   // retains its source albedo. This is not painted illumination.
   material.sheenColor?.setRGB(.28,.28,.28);
   if(!metric){
    entry.compile=material.onBeforeCompile;
    entry.cacheKey=material.customProgramCacheKey=()=>key+'/d11-source-fiber-bsdf-v1';
    material.userData.direction11SourceFinish={kind:'source garment fiber BSDF',uvDetail:'Not applied: source UVs missing or degenerate',provenance:SOURCE_FINISH_ASSUMPTIONS.provenance};
    audit.push({asset:mesh.name,...material.userData.direction11SourceFinish});return;
   }
   entry.compile=material.onBeforeCompile=function(shader,renderer){
    entry.before.compile.call(this,shader,renderer);
    const begin='#include <begin_vertex>',normal='#include <normal_fragment_maps>';
    if(!shader.vertexShader.includes(begin)||!shader.fragmentShader.includes(normal))throw Error('Garment shader hooks changed; finish requires review');
    Object.assign(shader.uniforms,{d11ClothUvMetres:{value:new T.Vector2(...metric)},d11ClothPitch:{value:new T.Vector2(...SOURCE_FINISH_ASSUMPTIONS.clothPitchMetres)},d11ClothHeight:{value:SOURCE_FINISH_ASSUMPTIONS.clothReliefMetres/metresPerUnit}});
    shader.vertexShader='varying vec2 d11ClothUv;varying float d11ClothWorldScale;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace(begin,begin+'\nd11ClothUv=uv;d11ClothWorldScale=max(length(modelMatrix[0].xyz),max(length(modelMatrix[1].xyz),length(modelMatrix[2].xyz)));');
    shader.fragmentShader='varying vec2 d11ClothUv;varying float d11ClothWorldScale;uniform vec2 d11ClothUvMetres;uniform vec2 d11ClothPitch;uniform float d11ClothHeight;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace(normal,normal+clothNormal);
   };
   entry.cacheKey=material.customProgramCacheKey=()=>key+'/d11-source-knit-v1/'+metric.map(n=>n.toFixed(6)).join('/')+'/'+metresPerUnit;
   material.userData.direction11SourceFinish={kind:'source-UV knit',uvMetres:metric,pitchMetres:[...SOURCE_FINISH_ASSUMPTIONS.clothPitchMetres],reliefMetres:SOURCE_FINISH_ASSUMPTIONS.clothReliefMetres,provenance:SOURCE_FINISH_ASSUMPTIONS.provenance};
   audit.push({asset:mesh.name,...material.userData.direction11SourceFinish});
  });
 });
 const sceneMaterials=new Set();sceneRoot?.traverse(mesh=>{if(mesh.isMesh&&!Array.isArray(mesh.material))sceneMaterials.add(mesh.material);});
 for(const material of sceneMaterials){
  if(!material.customProgramCacheKey().includes('native-springs-rock-triplanar-'))continue;
  install(material,'scenes',(entry,key)=>{
   entry.compile=material.onBeforeCompile=function(shader,renderer){entry.before.compile.call(this,shader,renderer);shader.fragmentShader=repairNativeRelief(shader.fragmentShader);};
   entry.cacheKey=material.customProgramCacheKey=()=>key+'/d11-source-relief-v2-preserved-gain';
   material.userData.direction11SourceFinish={kind:'source height-map gradient repair',coordinates:'Unchanged source triplanar mapping',amplitude:'Unchanged source-authored gain',provenance:SOURCE_FINISH_ASSUMPTIONS.terrainProvenance};
   audit.push({asset:material.name||key,...material.userData.direction11SourceFinish});
  });
 }
 let disposed=false;
 return {counts,audit,dispose(){
  if(disposed)return;disposed=true;
  for(const entry of records){const {material,before}=entry;if(owned.get(material)!==entry)continue;
   if(material.onBeforeCompile===entry.compile)material.onBeforeCompile=before.compile;
   if(material.customProgramCacheKey===entry.cacheKey)material.customProgramCacheKey=before.key;
   material.roughness=before.roughness;material.sheen=before.sheen;material.sheenRoughness=before.sheenRoughness;if(before.sheenColor)material.sheenColor.copy(before.sheenColor);
   if(before.marker===undefined)delete material.userData.direction11SourceFinish;else material.userData.direction11SourceFinish=before.marker;
   owned.delete(material);material.needsUpdate=true;
  }
 }};
}
