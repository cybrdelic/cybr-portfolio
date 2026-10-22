import * as T from './vendor/three-r180/three.module.min.js';

export const SCORE_RIBBON_SEGMENTS=320;
export const SCORE_RIBBON_WIDTH_SEGMENTS=8;

// Preserve the authored coil centreline and score UVs. Cross-width curvature
// gives paper changing normals rather than a rigid two-vertex-wide ruled sign.
export function createScoreRibbonGeometry(){
 const positions=[],uvs=[],indices=[],stride=SCORE_RIBBON_WIDTH_SEGMENTS+1;
 for(let i=0;i<=SCORE_RIBBON_SEGMENTS;i++){
  const t=i/SCORE_RIBBON_SEGMENTS,a=-.45+t*Math.PI*1.8;
  for(let j=0;j<=SCORE_RIBBON_WIDTH_SEGMENTS;j++){
   const v=j/SCORE_RIBBON_WIDTH_SEGMENTS,q=2*v-1;
   const curl=.10*q*q*(.65+.35*Math.sin(t*Math.PI*2))+.035*q*Math.sin(t*Math.PI*4);
   const edge=.018*q*q*Math.sin(t*Math.PI*14+q);
   positions.push(Math.cos(a)*(3.8+curl),(t-.5)*3.6+(v-.5)*1.75+edge,Math.sin(a)*(2.3+curl));
   // Print on the outward-facing surface. The former inward winding put
   // faint, mirrored show-through toward the camera on the foreground coil.
   uvs.push(1-t,v);
   if(i<SCORE_RIBBON_SEGMENTS&&j<SCORE_RIBBON_WIDTH_SEGMENTS){const n=i*stride+j;indices.push(n,n+1,n+stride,n+1,n+stride+1,n+stride);}
  }
 }
 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
 geometry.setIndex(indices);geometry.computeVertexNormals();
 return geometry;
}

function finishPaper(material){
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec2 vScorePaperUv;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvScorePaperUv=uv;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>
varying vec2 vScorePaperUv;
vec3 scoreFilteredFibre(vec2 uv,vec2 frequency){
 float phase=dot(uv,frequency)*6.28318530718;
 float footprint=fwidth(phase)/6.28318530718;
 float fibreVisibility=1.0-smoothstep(0.35,1.0,footprint);
 return vec3(sin(phase),cos(phase)*frequency*6.28318530718)*fibreVisibility;
}`)
   .replace('#include <map_fragment>',`#ifdef USE_MAP
 vec4 sampledDiffuseColor=texture2D(map,vMapUv);
 // Printed face and its weaker show-through on the back of the paper.
 sampledDiffuseColor.rgb=mix(vec3(1.0),sampledDiffuseColor.rgb,gl_FrontFacing?1.0:0.42);
 diffuseColor*=sampledDiffuseColor;
#endif
vec3 scoreFibreAndGradient=0.60*scoreFilteredFibre(vScorePaperUv,vec2(900.0,13.0))+0.40*scoreFilteredFibre(vScorePaperUv,vec2(25.0,340.0));
float scoreFibre=scoreFibreAndGradient.x;
diffuseColor.rgb*=0.992+0.008*scoreFibre;`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+0.045*scoreFibre,0.68,0.96);')
   .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
// Fibre relief in the real sheet's tangent plane; footprint-filtered above.
vec3 paperDx=dFdx(-vViewPosition),paperDy=dFdy(-vViewPosition);
vec3 paperRx=cross(paperDy,normal),paperRy=cross(normal,paperDx);
float paperDet=dot(paperDx,paperRx);
// Analytic height derivatives avoid undefined dFdx(dFdx(...)) through the
// footprint filter. The filter is constant over this derivative footprint.
vec2 paperHeightGradient=scoreFibreAndGradient.yz*0.000035;
vec3 paperGradient=sign(paperDet)*(dot(paperHeightGradient,dFdx(vScorePaperUv))*paperRx+dot(paperHeightGradient,dFdy(vScorePaperUv))*paperRy);
normal=normalize(max(abs(paperDet),1e-10)*normal-paperGradient);`)
   .replace('#include <lights_physical_pars_fragment>',`#include <lights_physical_pars_fragment>
// Bounded thin diffuse sheet: 93% reflection + 7% back transmission. Uses
// already shadow-tested light, not an unshadowed emissive glow. The shadow
// map still treats this low-transmission paper as opaque (documented below).
void scorePaperDirect(const in IncidentLight light,const in vec3 position,const in vec3 n,const in vec3 viewDir,const in vec3 coatNormal,const in PhysicalMaterial surface,inout ReflectedLight reflected){
 vec3 before=reflected.directDiffuse;
 RE_Direct_Physical(light,position,n,viewDir,coatNormal,surface,reflected);
 reflected.directDiffuse=before+(reflected.directDiffuse-before)*0.93;
 reflected.directDiffuse+=light.color*max(-dot(n,light.direction),0.0)*BRDF_Lambert(surface.diffuseColor)*0.07;
}
#undef RE_Direct
#define RE_Direct scorePaperDirect`);
 };
 material.customProgramCacheKey=()=> 'direction11-vellum-fibres-v1';
 material.userData.paper={fibreFiltering:'screen-footprint',sourceNotation:true,thinSheetBackscatter:.07,extraPasses:0,approximation:'single-sheet diffuse transmission; standard opaque shadows'};
 return material;
}

// A continuous paper surface, not floating notation or a billboard.
export function createShadowScore({onChange=()=>{}}={}){
 const canvas=document.createElement('canvas');canvas.width=4096;canvas.height=512;
 // Notation only: paper grain is shader-authored. The former 180,000 canvas
 // draw calls blocked startup and baked an orange colour into the substrate.
 const c=canvas.getContext('2d');c.fillStyle='#ffffff';c.fillRect(0,0,4096,512);
 c.strokeStyle='#302b25';c.fillStyle='#302b25';c.lineWidth=4;
 for(let row=0;row<1;row++){
  const base=180;for(let line=0;line<5;line++){c.beginPath();c.moveTo(0,base+line*32);c.lineTo(4096,base+line*32);c.stroke();}
  c.font='190px serif';c.fillText('𝄞',25,base+125);
 }
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
 const geometry=createScoreRibbonGeometry();
 // Keep the actual two-sided paper silhouette in depth. This opaque shadow
 // approximates the low (7%) diffuse transmission in beauty; neither printed
 // nor unprinted paper becomes a fake ink-shaped or alpha-cutout shadow.
 const material=finishPaper(new T.MeshStandardMaterial({map:texture,color:0xf3e8d3,roughness:.82,metalness:0,side:T.DoubleSide,shadowSide:T.DoubleSide}));
 const mesh=new T.Mesh(geometry,material);mesh.castShadow=mesh.receiveShadow=true;
 const root=new T.Group();root.name='11 / continuous parchment score';root.add(mesh);
 let disposed=false;
 fetch('../cybr-song/demo-output/score.json').then(r=>{if(!r.ok)throw Error('CYBR SONG score unavailable');return r.json();}).then(score=>{
  if(disposed)return;
  const notes=score.notes.filter(n=>n.role==='melody'),end=Math.max(1,...notes.map(n=>n.quarter_off)),letters='CDEFGAB';
  for(const note of notes){
   const pitch=/([A-G])([#b]?)(-?\d+)/.exec(note.pitch);if(!pitch)continue;
   const x=230+note.quarter/end*3650,y=308-(Number(pitch[3])*7+letters.indexOf(pitch[1])-30)*16,duration=note.quarter_off-note.quarter;
   c.beginPath();c.ellipse(x,y,16,11,-.3,0,Math.PI*2);if(duration>=2){c.lineWidth=4;c.stroke();}else c.fill();
   if(duration<4)c.fillRect(x+12,y-77,4,77);
   if(duration<1){c.beginPath();c.moveTo(x+14,y-76);c.bezierCurveTo(x+49,y-62,x+47,y-40,x+31,y-30);c.stroke();}
   if(pitch[2]){c.font='36px serif';c.fillText(pitch[2]==='#'?'♯':'♭',x-40,y+12);}
   for(let ledger=340;ledger<=y;ledger+=32)c.fillRect(x-24,ledger-1,48,3);
   for(let ledger=148;ledger>=y;ledger-=32)c.fillRect(x-24,ledger-1,48,3);
  }
  for(const quarter of new Set(notes.filter(n=>n.beat===0).map(n=>n.quarter))){const x=210+quarter/end*3650;c.fillRect(x,180,3,128);}
  root.userData.scoreTitle=score.title;root.userData.sourceNotes=notes.length;texture.needsUpdate=true;onChange();
 }).catch(e=>{root.userData.sourceError=e.message;onChange();});
 return {root,update(t){root.rotation.set(.02,-.3+t*.35,-.15);root.position.set(1.8,-.35,0);},dispose(){disposed=true;geometry.dispose();material.dispose();texture.dispose();}};
}
