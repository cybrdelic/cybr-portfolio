import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {createShadowScore,createScoreRibbonGeometry,SCORE_RIBBON_SEGMENTS,SCORE_RIBBON_WIDTH_SEGMENTS} from './direction11-song.mjs';

async function withCanvasAndScore(run){
 const originalDocument=globalThis.document,originalFetch=globalThis.fetch;
 const canvases=[],calls=[];
 let resolveScore;
 globalThis.document={createElement(tag){
  assert.equal(tag,'canvas');
  const context={};
  for(const method of ['fillRect','beginPath','moveTo','lineTo','stroke','fill','fillText','ellipse','bezierCurveTo'])context[method]=(...args)=>{calls.push([method,...args]);};
  // Deliberately omit getImageData/putImageData: colour readback must not be
  // required to synthesize a different shadow silhouette from the paper.
  const canvas={width:0,height:0,getContext(kind){assert.equal(kind,'2d');return context;}};
  canvases.push(canvas);return canvas;
 }};
 globalThis.fetch=async url=>{
  assert.equal(url,'../cybr-song/demo-output/score.json');
  return {ok:true,json:()=>new Promise(resolve=>{resolveScore=resolve;})};
 };
 try{
  await run({canvases,calls,async load(score){await Promise.resolve();resolveScore(score);await new Promise(resolve=>setImmediate(resolve));}});
 }finally{
  if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
  globalThis.fetch=originalFetch;
 }
}

test('paper beauty and standard shadow agree, without an ink-only mask',async()=>withCanvasAndScore(async({canvases,load})=>{
 let changed=0;
 const score=createShadowScore({onChange(){changed++;}}),mesh=score.root.children[0],material=mesh.material;
 assert.equal(material.isMeshStandardMaterial,true);
 assert.equal(material.transparent,false);
 assert.equal(material.opacity,1);
 assert.equal(material.transmission??0,0);
 assert.equal(material.alphaTest,0);
 assert.equal(material.alphaMap,null);
 assert.equal(material.side,T.DoubleSide);
 assert.equal(material.shadowSide,T.DoubleSide);
 assert.equal(mesh.customDepthMaterial,undefined);
 assert.equal(mesh.customDistanceMaterial,undefined);
 assert.equal(mesh.castShadow,true);
 assert.equal(mesh.receiveShadow,true);
 assert.equal(canvases.length,1);
 assert.equal(material.map.image,canvases[0]);
 assert.equal(material.map.colorSpace,T.SRGBColorSpace);
 assert.equal(canvases[0].width,4096);assert.equal(canvases[0].height,512);
 const oldVersion=material.map.version;
 await load({title:'Source score',notes:[{role:'melody',pitch:'C4',quarter:0,quarter_off:1,beat:0},{role:'bass',pitch:'C2',quarter:0,quarter_off:4,beat:0}]});
 assert.equal(score.root.userData.scoreTitle,'Source score');
 assert.equal(score.root.userData.sourceNotes,1);
 assert.equal(changed,1);
 assert.ok(material.map.version>oldVersion);
 assert.equal(canvases.length,1,'loading notation must not allocate a separate shadow texture');
 score.dispose();
}));

test('curved paper preserves the continuous centreline, score UVs and scroll pose',async()=>withCanvasAndScore(async({load})=>{
 const score=createShadowScore(),geometry=score.root.children[0].geometry;
 const positions=geometry.attributes.position,uv=geometry.attributes.uv;
 const segments=SCORE_RIBBON_SEGMENTS,width=SCORE_RIBBON_WIDTH_SEGMENTS,stride=width+1;
 assert.equal(positions.count,(segments+1)*stride);assert.equal(geometry.index.count,segments*width*6);
 for(let i=0;i<=segments;i++){
  const t=i/segments,a=-.45+t*Math.PI*1.8,center=i*stride+width/2;
  assert.ok(Math.abs(positions.getX(center)-Math.cos(a)*3.8)<1e-6);
  assert.ok(Math.abs(positions.getY(center)-(t-.5)*3.6)<1e-6);
  assert.ok(Math.abs(positions.getZ(center)-Math.sin(a)*2.3)<1e-6);
  for(let side=0;side<=width;side++){
   const index=i*stride+side;
   assert.ok(Math.abs(uv.getX(index)-(1-t))<1e-7);assert.equal(uv.getY(index),side/width);
  }
 }
 score.update(.4);
 assert.deepEqual(score.root.position.toArray(),[1.8,-.35,0]);
 assert.deepEqual(score.root.rotation.toArray(),[.02,-.3+.4*.35,-.15,'XYZ']);
 const disposed=[];
 for(const [name,resource]of [['geometry',geometry],['material',score.root.children[0].material],['texture',score.root.children[0].material.map]])resource.addEventListener('dispose',()=>disposed.push(name));
 score.dispose();assert.deepEqual(disposed,['geometry','material','texture']);
 await load({title:'Late response',notes:[]});
 assert.equal(score.root.userData.scoreTitle,undefined,'late loads must not revive disposed resources');
}));

test('vellum uses bounded filtered fibres and the real notation, not startup pixel noise',async()=>withCanvasAndScore(async({calls})=>{
 const score=createShadowScore(),material=score.root.children[0].material;
 assert.equal(calls.filter(c=>c[0]==='fillRect').length,1,'paper no longer paints 180k noise fragments');
 assert.equal(material.roughness,.82);assert.equal(material.metalness,0);
 const shader={vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};
 material.onBeforeCompile(shader);
 assert.match(shader.fragmentShader,/fwidth\(phase\)/);
 assert.doesNotMatch(shader.fragmentShader,/float\s+filter\b/,'filter is a reserved GLSL identifier');
 assert.match(shader.fragmentShader,/gl_FrontFacing\?1\.0:0\.42/);
 assert.match(shader.fragmentShader,/\*0\.93/);assert.match(shader.fragmentShader,/\*0\.07/);
 assert.match(shader.fragmentShader,/#define RE_Direct scorePaperDirect/);
 assert.doesNotMatch(shader.fragmentShader,/uniform.*time|random|noiseTexture|transmissionSamplerMap/);
 assert.equal(material.userData.paper.extraPasses,0);
 score.dispose();
}));

test('cross-width paper curvature has finite unit normals and nondegenerate triangles',()=>{
 const geometry=createScoreRibbonGeometry(),positions=geometry.attributes.position,normals=geometry.attributes.normal,index=geometry.index;
 const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),ab=new T.Vector3(),ac=new T.Vector3();
 let changingNormals=0;
 for(let i=0;i<positions.count;i++){
  a.fromBufferAttribute(normals,i);assert.ok(Math.abs(a.length()-1)<1e-6);
  if(i%(SCORE_RIBBON_WIDTH_SEGMENTS+1)===0){b.fromBufferAttribute(normals,i+SCORE_RIBBON_WIDTH_SEGMENTS);if(a.dot(b)<.999)changingNormals++;}
 }
 assert.ok(changingNormals>100,'the width is genuinely curved, not only textured');
 for(let i=0;i<positions.count;i++){
  const radialDot=positions.getX(i)*normals.getX(i)+positions.getZ(i)*normals.getZ(i);
  assert.ok(radialDot>0,'the printed front face must point outward from the coil');
 }
 for(let i=0;i<index.count;i+=3){
  a.fromBufferAttribute(positions,index.getX(i));b.fromBufferAttribute(positions,index.getX(i+1));c.fromBufferAttribute(positions,index.getX(i+2));
  ab.subVectors(b,a);ac.subVectors(c,a);assert.ok(ab.cross(ac).lengthSq()>1e-10);
 }
 geometry.dispose();
});
