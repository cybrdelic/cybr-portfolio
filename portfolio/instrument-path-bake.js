import * as THREE from './vendor/three-r180/three.module.min.js';
const defaultBase=new URLSearchParams(location.search).has('cartridges')?'./assets/instrument-cartridges-path/':new URLSearchParams(location.search).has('legacy-bake')?'./assets/instrument-path/':'./assets/instrument-path-light/';
const shader=`
uniform sampler2D pathColorA,pathColorB,pathVisibilityA,pathVisibilityB;
uniform mat4 pathProjectA,pathProjectB,pathViewA,pathViewB;
uniform vec2 pathDepthA,pathDepthB;
uniform float pathBlend,pathSurface,pathEnabled,pathDiagnostic;
varying vec3 pathLocalPosition;
vec4 pathSample(sampler2D beauty,sampler2D visibility,mat4 project,mat4 view,vec2 range){
 vec4 projected=project*vec4(pathLocalPosition,1.);
 vec2 uv=projected.xy/projected.w*.5+.5;
 if(projected.w<=0.||any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec4(0.);
 vec3 record=floor(texture2D(visibility,uv).rgb*255.+.5);
 float surface=record.b;
 float stored=mix(range.x,range.y,(record.r*256.+record.g)/65535.);
 float expected=-(view*vec4(pathLocalPosition,1.)).z;
 float tolerance=max(.3,2.*fwidth(expected));
 if(abs(surface-pathSurface)>.1||abs(stored-expected)>tolerance)return vec4(0.);
 return vec4(texture2D(beauty,uv).rgb,1.);
}
`;
export async function loadPathBake(groups,schedule,geometryHash,options={}){
 const base=options.base||defaultBase;
 const response=await fetch(base+'manifest.json',{cache:'no-store'});if(!response.ok)throw Error('Camera-path bake not packaged');
 const manifest=await response.json();if(!manifest.frames?.length)throw Error('No completed camera-path frames');
 if(manifest.sourceGeometry!==geometryHash)throw Error('Camera-path bake does not match this geometry revision');
 const frames=manifest.frames,loader=new THREE.TextureLoader(),cache=new Map(),inflight=new Map(),sets=[];
 let current=0,pending=false,failed=null,requested=[0,0],shown=[-1,-1],sampled=[0,0],foregroundPair=null,disposed=false;
 function disposeView(value){value.color.dispose();value.visibility.dispose();}
 async function read(index){
  if(disposed)throw Error('Camera-path bake disposed');
  if(cache.has(index))return cache.get(index);
  if(inflight.has(index))return inflight.get(index);
  const promise=(async()=>{const item=frames[index],results=await Promise.allSettled([loader.loadAsync(base+item.color+'?v='+item.hash),loader.loadAsync(base+item.visibility+'?v='+item.hash)]);
  const rejected=results.find(result=>result.status==='rejected');
  if(rejected){for(const result of results)if(result.status==='fulfilled')result.value.dispose();throw rejected.reason;}
  const [color,visibility]=results.map(result=>result.value);
  color.colorSpace=THREE.SRGBColorSpace;color.generateMipmaps=false;color.minFilter=color.magFilter=THREE.LinearFilter;
  visibility.colorSpace=THREE.NoColorSpace;visibility.generateMipmaps=false;visibility.minFilter=visibility.magFilter=THREE.NearestFilter;
  const value={color,visibility};if(disposed){disposeView(value);throw Error('Camera-path bake disposed');}cache.set(index,value);return value;})();
  inflight.set(index,promise);try{return await promise;}finally{inflight.delete(index);}
 }
 const first=await read(0);
 for(const [groupName,group] of groups)for(const object of group.children){
  if(options.modules&&!options.modules.includes(groupName))continue;
  if(!object.visible||object.userData.staticWater)continue;
  const surface=manifest.surfaces[object.name];if(!surface)continue;
  const original=object.material;
  // Uncovered surfaces use an ordinary IBL material, never an unrelated
  // projected pixel. Coverage mode marks these pixels red for bake QA.
  const material=original.clone();material.side=THREE.DoubleSide;material.dithering=true;
  const uniforms={pathColorA:{value:first.color},pathColorB:{value:first.color},pathVisibilityA:{value:first.visibility},pathVisibilityB:{value:first.visibility},pathProjectA:{value:new THREE.Matrix4()},pathProjectB:{value:new THREE.Matrix4()},pathViewA:{value:new THREE.Matrix4()},pathViewB:{value:new THREE.Matrix4()},pathDepthA:{value:new THREE.Vector2()},pathDepthB:{value:new THREE.Vector2()},pathBlend:{value:0},pathSurface:{value:surface},pathEnabled:{value:0},pathDiagnostic:{value:new URLSearchParams(location.search).has('coverage')?1:0}};
  material.onBeforeCompile=s=>{
   original.onBeforeCompile?.(s);
   Object.assign(s.uniforms,uniforms);
   s.vertexShader='varying vec3 pathLocalPosition;\n'+s.vertexShader;
   s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npathLocalPosition=position;');
   s.fragmentShader=shader+'\n'+s.fragmentShader;
   s.fragmentShader=s.fragmentShader.replace('void main() {',`void main() {
    if(pathEnabled>.5){
     vec4 a=pathSample(pathColorA,pathVisibilityA,pathProjectA,pathViewA,pathDepthA);
     vec4 b=pathSample(pathColorB,pathVisibilityB,pathProjectB,pathViewB,pathDepthB);
     float wa=(1.-pathBlend)*a.a,wb=pathBlend*b.a;
     if(wa+wb>.001){
      gl_FragColor=vec4(pathDiagnostic>.5?vec3(0.,.7,.15):(a.rgb*wa+b.rgb*wb)/(wa+wb),1.);
      #include <colorspace_fragment>
      return;
     }
    }
    if(pathDiagnostic>.5){gl_FragColor=vec4(1.,0.,0.,1.);return;}
   `);
  };
  material.customProgramCacheKey=()=>`path-bake-v1-${object.name}`;
  object.material=material;sets.push({object,uniforms});
 }
 function apply(){
  if(disposed||shown[0]<0)return;
  const resources=shown.map(index=>cache.get(index));
  if(!resources.every(Boolean))throw Error('Camera-path bake pair is not resident');
  const [a,b]=shown.map(i=>frames[i]);const blend=a.progress===b.progress?0:THREE.MathUtils.clamp((current-a.progress)/(b.progress-a.progress),0,1);
  for(const {object,uniforms:u} of sets){
   for(const [suffix,item,index] of [['A',a,shown[0]],['B',b,shown[1]]]){
    const group=item.groups.find(g=>object.name.startsWith(g.name+'/'));const shift=item.objects.find(o=>o.name===object.name)?.shift||0;
    const model=new THREE.Matrix4().makeTranslation(group.x+shift,0,0),view=new THREE.Matrix4().fromArray(item.world).invert().multiply(model);
    u['pathView'+suffix].value.copy(view);u['pathProject'+suffix].value.fromArray(item.projection).multiply(view);
    u['pathDepth'+suffix].value.fromArray(item.depthRange);const data=index===shown[0]?resources[0]:resources[1];
    u['pathColor'+suffix].value=data.color;u['pathVisibility'+suffix].value=data.visibility;
   }
   u.pathBlend.value=blend;
   // Missing/unbaked path sections must not masquerade as supported views.
   const inside=current>=a.progress-.0001&&current<=b.progress+.0001;
   u.pathEnabled.value=(inside&&(manifest.complete||b.index-a.index<=1))||Math.abs(current-a.progress)<.0001||Math.abs(current-b.progress)<.0001?1:0;
  }
  sampled=[...shown];
 }
 function trim(){
  const middle=(requested[0]+requested[1])/2;
  for(const key of [...cache.keys()].sort((a,b)=>Math.abs(b-middle)-Math.abs(a-middle)))if(cache.size>6&&!shown.includes(key)&&!sampled.includes(key)&&!requested.includes(key)&&!foregroundPair?.includes(key)){disposeView(cache.get(key));cache.delete(key);}
 }
 let prefetching=false;
 async function prefetch(){
  if(disposed||prefetching||!manifest.complete)return;prefetching=true;
  try{for(const i of [requested[1]+1,requested[0]-1,requested[1]+2,requested[0]-2])if(!disposed&&i>=0&&i<frames.length&&!cache.has(i)){await read(i);trim();}}catch{/* Foreground loading reports errors if this checkpoint is needed. */}finally{prefetching=false;}
 }
 function bracket(p){let b=frames.findIndex(f=>f.progress>=p);if(b<0)b=frames.length-1;return [Math.max(0,b-1),b];}
 async function update(){
  if(disposed||pending||failed)return;pending=true;
  try{
   while(shown[0]!==requested[0]||shown[1]!==requested[1]){
    const next=[...requested];foregroundPair=next;
    try{
     await Promise.all([...new Set(next)].map(read));
     if(disposed)return;
     // A later scroll can change requested while one leg is still loading.
     // Keep both old legs pinned until they are published or discarded.
     if(next[0]!==requested[0]||next[1]!==requested[1])continue;
     shown=next;apply();schedule();void prefetch();
    }finally{foregroundPair=null;trim();}
   }
  }catch(e){if(!disposed){failed=e.message;console.error(e);}}finally{pending=false;}
 }
 shown=[0,0];apply();void prefetch();
 return {requestProgress(p){if(disposed)return;requested=bracket(p);void update();},resolveProgress(p){if(disposed)return current;const pair=bracket(p);if(pair.every(i=>cache.has(i))){shown=pair;return p;}return THREE.MathUtils.clamp(p,frames[shown[0]].progress,frames[shown[1]].progress);},setProgress(p){if(disposed)return;current=p;apply();},prepare(){},snapshot:()=>({type:'whole-assembly camera-path radiance projected onto real geometry',pending,failed,frames:frames.length,complete:manifest.complete,shown:[...shown],cached:cache.size,modules:groups.size,liveRayTracing:false}),dispose(){if(disposed)return;disposed=true;for(const v of cache.values())disposeView(v);cache.clear();}};
}
