import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from './vendor/three-r180/three.module.min.js';
import {IRIS09_GEOMETRY,iris09LeafContour,iris09HingeAngle,iris09ActuatorAngle,createIris09Geometry} from './iris09-mesh-geometry.mjs';
import {IRIS09_MECHANICS as M,iris09InputFromTime,solveIris09Input,iris09MechanicalFrame} from './iris09-kinematics.mjs';
import {iris09Pose} from './iris09-stage.mjs';

const source=await readFile(new URL('./assets/iris09/IRIS-09.glsl',import.meta.url),'utf8');
const make=()=>{
 const materials=Object.fromEntries([1,2,3,4,5,8].map(id=>[id,new T.MeshStandardMaterial({side:T.DoubleSide})]));
 return {materials,geometry:createIris09Geometry(T,{materials})};
};
const close=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);

test('unchanged source-reference helpers retain recovered Revision III definitions',()=>{
 assert.match(source,/Revision 3\./);
 for(const [glsl,key]of [['IRIS_RADIUS','radius'],['IRIS_HINGE_RADIUS','hingeRadius'],['IRIS_BLADE_THICKNESS','thickness'],['IRIS_BLADE_CANT','cant'],['IRIS_BLADE_HEIGHT','height']]){
  const found=source.match(new RegExp(`const float ${glsl} = ([0-9.]+);`)); assert.ok(found); close(IRIS09_GEOMETRY[key],Number(found[1]));
 }
 for(let time=-20;time<=40;time+=.17){
  close(iris09HingeAngle(time),.45+.45*Math.cos(time*Math.PI/10));
  close(iris09ActuatorAngle(time),-.38+.54*(1-Math.cos(time*Math.PI/10)));
  close(iris09HingeAngle(time),iris09HingeAngle(time+20));
 }
});

test('source-reference contour remains inside both original circular prisms',()=>{
 const points=iris09LeafContour(); assert.ok(points.length>100);
 for(let i=0;i<points.length;i++){
  const p=points[i],next=points[(i+1)%points.length];
  for(const [cx,cz,r]of[IRIS09_GEOMETRY.frontArc,IRIS09_GEOMETRY.trailingArc]){
   assert.ok(Math.hypot(p[0]-cx,p[1]-cz)<=r+1e-10);
   assert.ok(Math.hypot((p[0]+next[0])/2-cx,(p[1]+next[1])/2-cz)<=r+1e-10);
  }
  assert.ok([IRIS09_GEOMETRY.frontArc,IRIS09_GEOMETRY.trailingArc].some(([cx,cz,r])=>Math.abs(Math.hypot(p[0]-cx,p[1]-cz)-r)<1e-9));
 }
});

test('all nine live rigid transforms come from the one constrained drive-ring input',()=>{
 const {geometry:g}=make(),point=new T.Vector3();
 for(const time of[0,1.2,5,8.7,10,15,20,5,0]){
  const state=g.update(time); g.root.updateMatrixWorld(true);
  close(state.input,iris09InputFromTime(time));close(state.bladeAngle,solveIris09Input(state.input).bladeAngle);
  for(let blade=0;blade<9;blade++)for(const [x,z]of[[0,0],[.2,.3],[-.17,-.3]])for(const underside of[false,true]){
   const f=iris09MechanicalFrame(blade,state),expected=[f.hx+f.c*x-f.s*z,f.top-(underside?M.thickness:0),f.hz+f.s*x+f.c*z];
   point.set(x,underside?-M.thickness:0,z).applyMatrix4(g.leaves[blade].matrix);
   point.toArray().forEach((v,i)=>close(v,expected[i]));
  }
  close(g.actuator.rotation.y,-state.input);
  for(let i=0;i<9;i++){
   const f=iris09MechanicalFrame(i,state),data=g.leaves[i].material.userData;
   data.iris09MechanicalFrames.value[i].toArray().forEach((v,j)=>close(v,[f.c,f.s,f.hx,f.hz][j]));
   close(data.iris09MechanicalHeights.value[i],f.top,2e-8);assert.equal(data.iris09LeafIndex.value,i);
   assert.equal(data.iris09MechanicalFrames,g.leaves[0].material.userData.iris09MechanicalFrames);
  }
 }
 const arrays=g.leaves.map(leaf=>leaf.geometry.attributes.position.array);g.update(4.5);
 g.leaves.forEach((leaf,i)=>assert.equal(leaf.geometry.attributes.position.array,arrays[i]));
 assert.throws(()=>g.update(NaN),TypeError);g.dispose();
});

test('attribute-aware indexing preserves exact attributes without triangle loss',()=>{
 const {geometry:g}=make();let triangles=0;
 g.root.traverse(mesh=>{
  if(!mesh.geometry)return;
  const original=mesh.geometry,expanded=original.index?original.toNonIndexed():original;
  triangles+=expanded.attributes.position.count/3;
  if(original.index)for(const key of['position','normal','uv']){
   const a=original.attributes[key],b=expanded.attributes[key],aa=new Uint32Array(a.array.buffer),bb=new Uint32Array(b.array.buffer);
   for(let i=0;i<original.index.count;i++)for(let k=0;k<a.itemSize;k++)assert.equal(aa[original.index.getX(i)*a.itemSize+k],bb[i*a.itemSize+k]);
  }
  if(expanded!==mesh.geometry)expanded.dispose();
 });
 assert.equal(g.metadata.triangles,triangles);
 assert.equal(g.metadata.unindexedVertexCount,triangles*3);
 assert.ok(g.metadata.vertexCount<g.metadata.unindexedVertexCount*.36);
 assert.ok(g.metadata.bufferBytes<8_000_000);
 g.dispose();
});

test('mesh stays bounded and finite with consistently oriented triangle normals',()=>{
 const {geometry:g}=make();assert.ok(g.metadata.triangles<220000,g.metadata.triangles);assert.ok(g.metadata.drawCalls<=25,g.metadata.drawCalls);
 let invalid=0,wrongWinding=0,triangles=0;
 g.root.traverse(mesh=>{
  if(!mesh.geometry)return;
  const geometry=mesh.geometry,p=geometry.attributes.position,n=geometry.attributes.normal,index=geometry.index;
  for(let i=0;i<p.count;i++)if(!Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i)+n.getX(i)+n.getY(i)+n.getZ(i)))invalid++;
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),normal=new T.Vector3(),cross=new T.Vector3();
  for(let i=0;i<(index?.count??p.count);i+=3){
   const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]);c.fromBufferAttribute(p,ids[2]);
   cross.crossVectors(b.sub(a),c.sub(a));if(cross.lengthSq()<1e-20)continue;
   normal.set(0,0,0);for(const id of ids)normal.add(new T.Vector3().fromBufferAttribute(n,id));
   if(cross.dot(normal)<-1e-10)wrongWinding++;triangles++;
  }
 });
 assert.equal(invalid,0);assert.equal(wrongWinding,0,`${wrongWinding}/${triangles} triangles have reversed shading normals`);g.dispose();
});

test('rigid leaf shading follows root frame without world clipping and chains hooks',()=>{
 const materials=Object.fromEntries([1,2,3,4,5,8].map(id=>[id,new T.MeshStandardMaterial()]));
 let calls=0;materials[8].onBeforeCompile=function(shader){calls++;assert.ok(this.userData.iris09LeafIndex);shader.vertexShader+='\nvIrisSurfaceRootPosition=position;';shader.fragmentShader='// authored material\n'+shader.fragmentShader;};materials[8].customProgramCacheKey=()=> 'source-material';
 const g=createIris09Geometry(T,{materials});
 for(const leaf of g.leaves){const material=leaf.material;
  const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'void main() {\n}'};material.onBeforeCompile(shader,{});
  assert.equal(shader.uniforms.uIrisLeafToRoot.value,leaf.matrix);
  assert.match(shader.vertexShader,/uIrisLeafToRoot \* vec4\(position,1.0\)/);
  assert.doesNotMatch(shader.fragmentShader,/discard|0\.9801/);
  assert.match(shader.fragmentShader,/authored material/);assert.match(material.customProgramCacheKey(),/^source-material\|/);
 }
 assert.equal(calls,9);g.dispose();
});

test('bore-cut outer lathe walls point outward and do not expose the internal cavity',()=>{
 const {geometry:g}=make(),body=g.root.children.find(m=>m.name==='IRIS source material 1');
 const p=body.geometry.attributes.position,n=body.geometry.attributes.normal;let tested=0,minimumRadius=Infinity;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),z=p.getZ(i),r=Math.hypot(x,z),y=p.getY(i);
  if(r>1.487&&r<1.512&&y>.17&&y<.32){assert.ok(n.getX(i)*x+n.getZ(i)*z>=-1e-8);tested++;minimumRadius=Math.min(minimumRadius,r);}
 }
 assert.ok(tested>500);assert.ok(minimumRadius-M.cavityInner>.0299);g.dispose();
});

test('authored cameras stay above the deck and opaque leaves are submitted front-to-back',()=>{
 const {geometry:g}=make(),highest=M.firstBladeTop+(M.blades-1)*(M.thickness+M.axialClearance);
 for(const [width,height]of[[390,844],[1000,900],[1280,720],[2560,720],[3200,400]])for(let i=0;i<=1000;i++){
  const p=iris09Pose(i/1000,width,height),y=p.target[1]+p.distance*Math.sin(p.elevation);
  assert.ok(y>highest,`${width}x${height}, progress ${i/1000}: camera below blade deck`);
 }
 assert.deepEqual([...g.leaves].sort((a,b)=>a.renderOrder-b.renderOrder),[...g.leaves].reverse());
 for(const mesh of g.root.children.filter(m=>m.isMesh&&!g.leaves.includes(m)))assert.ok(mesh.renderOrder<g.leaves[8].renderOrder);
 for(const leaf of g.leaves){assert.equal(leaf.material.transparent,false);assert.equal(leaf.material.depthTest,true);assert.equal(leaf.material.depthWrite,true);assert.equal(leaf.castShadow,true);}
 g.dispose();
});

test('rigid blade top-cap triangles are planar with exact uniform upward normals',()=>{
 const {geometry:g}=make(),shape=g.leaves[0].geometry,p=shape.attributes.position,n=shape.attributes.normal,index=shape.index;let topTriangles=0;
 for(let i=0;i<(index?.count??p.count);i+=3){
  const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);
  if(!ids.every(id=>Math.abs(p.getY(id))<1e-10))continue;
  for(const id of ids){close(n.getX(id),0,1e-10);close(n.getY(id),1,1e-10);close(n.getZ(id),0,1e-10);}
  topTriangles++;
 }
 assert.ok(topTriangles>100);g.dispose();
});

test('dispose is idempotent and never disposes caller-owned source materials',()=>{
 const {materials,geometry:g}=make();let external=0,owned=0;
 for(const material of Object.values(materials))material.addEventListener('dispose',()=>external++);
 for(const leaf of g.leaves){leaf.material.addEventListener('dispose',()=>owned++);leaf.customDepthMaterial.addEventListener('dispose',()=>owned++);}
 g.dispose();g.dispose();assert.equal(external,0);assert.equal(owned,18);
});
