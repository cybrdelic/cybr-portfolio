// A bounded, prefiltered product studio. Reflection cards are lighting, not
// images on the artifact. Generated once; no extra per-frame render passes.
import {SHADOW_STUDIO} from './direction11-studio-rig.mjs';
export function createEventStudio(T,renderer,{neutral=false,monochrome=false,sculpted=false,liquid=false}={}){
 const studio=new T.Scene();studio.background=monochrome?new T.Color(.04,.04,.04):new T.Color(.055,.042,.032);
 const owned=[];
 function card(w,h,position,radiance){
  if(monochrome){const l=radiance[0]*.2126+radiance[1]*.7152+radiance[2]*.0722;radiance=[l,l,l];}
  const geometry=new T.PlaneGeometry(w,h),material=new T.MeshBasicMaterial({color:new T.Color(...radiance),side:T.DoubleSide});
  if(liquid||sculpted){
   // Diffusion cloth has a luminance profile, not a uniform hard rectangle.
   // This shader runs only while building the environment, never per frame.
   material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec2 studioSourceUv;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nstudioSourceUv=uv;');
    shader.fragmentShader='varying vec2 studioSourceUv;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
     vec2 q=abs(studioSourceUv*2.-1.);
     float cloth=(1.-smoothstep(.64,1.,q.x))*(1.-smoothstep(.78,1.,q.y));
     diffuseColor.rgb*=cloth*(.7+.3*exp(-1.2*dot(q,q)));`);
   };
   material.customProgramCacheKey=()=> 'liquid-studio-diffusion-cloth-v1';
  }
  const mesh=new T.Mesh(geometry,material);mesh.position.set(...position);mesh.lookAt(0,0,0);studio.add(mesh);owned.push(geometry,material);
 }
 if(sculpted&&!liquid){
  studio.background=new T.Color(.006,.004,.003);
  for(const source of SHADOW_STUDIO.cards)card(...source.size,source.position,source.radiance);
 }else if(sculpted){
  // A single broad key and two narrow edge cards, separated by dark space.
  // Prefiltered once: no additional runtime lighting or reflection passes.
  studio.background=new T.Color(.012,.009,.007);
  card(6,9,[-6,7,9],liquid?[4,4.3,4.6]:[8,6.8,5.4]);
  card(liquid?1.3:1.2,10,[7,2,5],liquid?[8,8.3,8.5]:[10,9.4,8.5]);
  card(8,1.2,[0,8,-4],[5,5.2,5.4]);
  card(10,10,[0,3,12],[1.4,1.25,1.08]);
  if(!liquid)card(18,12,[-12,2,9],[.9,.85,.76]);
  // Liquid needs a narrow rim, not two broad overexposed white panels which
  // erase the transmitted image and make the volume read like chrome.
  card(liquid?.75:1.6,9,[2,3,12],liquid?[6,6.3,6.5]:[16,15,13]);
  // Side illumination follows the thin sheet's silhouette. A low frontal
  // rectangle reflected as a white plate across the old lower curl.
  if(liquid)card(1.5,9,[-5,3,1],[3,3.2,3.4]);
  card(12,12,[0,-10,0],[.17,.035,.016]);
 }else{
 card(5,10,[-7,5,10],neutral?[1.1,1,.85]:[7,6.3,5.4]);
 card(3,9,[-1.5,2,14],[.9,.8,.68]);
 card(2,11,[8,1,7],[4.2,4,3.8]);
 card(10,3,[0,10,1],neutral?[1.4,1.3,1.1]:[3.8,3.5,3.1]);
 card(14,14,[0,-10,0],neutral?[.55,.49,.39]:[.22,.045,.022]);
 if(neutral){
  card(9,3,[3,-6,8],[6.4,5.8,4.8]);
  card(2,6,[9,-3,5],[2.8,2.6,2.2]);
 }
 }
 const generator=new T.PMREMGenerator(renderer),target=generator.fromScene(studio,.03,.1,100);
 generator.dispose();owned.forEach(x=>x.dispose());return target;
}
