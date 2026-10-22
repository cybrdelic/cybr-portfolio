import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from './vendor/three-r180/three.module.min.js';
import {iris09Pose} from './iris09-stage.mjs';
import {iris09LensProfile,updateIris09Camera} from './iris09-mesh-stage.mjs';

const source=await readFile(new URL('./assets/iris09/IRIS-09.glsl',import.meta.url),'utf8');
const sourceCaps=[...source.matchAll(/capIntersection\(ro,rd,([\d.]+),(-?[\d.]+),([\d.]+),2[12]\.0,h\)/g)].map(match=>match.slice(1,4).map(Number));
assert.equal(sourceCaps.length,2,'the recovered shader must provide both reference optics');
const near=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);

test('both source lens profiles close on the axis and retain their spherical cap and radial bounds',()=>{
 for(const [radius,base,edge] of sourceCaps){
  const segments=48,profile=iris09LensProfile(T,radius,base,edge,segments);
  const center=base-Math.sqrt(radius*radius-edge*edge),top=center+radius;
  assert.equal(profile.length,segments+2);
  near(profile[0].x,0);near(profile[0].y,base);
  near(profile[1].x,edge);near(profile[1].y,base);
  near(profile.at(-1).x,0);near(profile.at(-1).y,top);
  for(let i=0;i<profile.length;i++){
   const point=profile[i];assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
   assert.ok(point.x>=0&&point.x<=edge);assert.ok(point.y>=base-1e-12&&point.y<=top+1e-12);
   if(i>0)near(point.x*point.x+(point.y-center)**2,radius*radius);
   if(i>1){assert.ok(point.x<profile[i-1].x);assert.ok(point.y>profile[i-1].y);}
  }
 }
});

test('lathed source caps are finite outward-facing solids with the expected spherical-cap volume',()=>{
 const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),cross=new T.Vector3();
 for(const [radius,base,edge] of sourceCaps){
  const geometry=new T.LatheGeometry(iris09LensProfile(T,radius,base,edge),96),position=geometry.attributes.position,index=geometry.index;
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  assert.ok(Number.isFinite(geometry.boundingSphere.radius));near(geometry.boundingBox.min.y,base,2e-8);
  for(let i=0;i<position.count;i++){
   a.fromBufferAttribute(position,i);assert.ok(a.toArray().every(Number.isFinite));
   assert.ok(Math.hypot(a.x,a.z)<=edge+5e-8);
  }
  let volume=0;
  for(let i=0;i<index.count;i+=3){
   a.fromBufferAttribute(position,index.getX(i));b.fromBufferAttribute(position,index.getX(i+1));c.fromBufferAttribute(position,index.getX(i+2));
   volume+=a.dot(cross.crossVectors(b,c))/6;
  }
  const height=radius-Math.sqrt(radius*radius-edge*edge),analytic=Math.PI*height*height*(radius-height/3);
  assert.ok(volume>0,'closed cap winding must face outward');
  assert.ok(Math.abs(volume/analytic-1)<.002,'tessellation must preserve the closed source volume');
  geometry.dispose();
 }
});

test('mesh camera reproduces source ray projection and layout shift across aspect ratios',()=>{
 const camera=new T.PerspectiveCamera(27,1,.2,60);
 for(const [width,height] of [[1920,1080],[1059,930],[390,844],[2560,720]]){
  for(const progress of [0,.08,1/7,.24,2/7,.35,3/7,1]){
   const pose=iris09Pose(progress,width,height);updateIris09Camera(camera,pose,width,height);
   near(camera.aspect,width/height);near(Math.tan(camera.fov*Math.PI/360),1/pose.focal);
   const target=new T.Vector3().fromArray(pose.target),forward=target.clone().sub(camera.position).normalize();
   near(camera.position.distanceTo(target),pose.distance);
   const right=new T.Vector3().crossVectors(forward,new T.Vector3(0,1,0)).normalize();
   const up=new T.Vector3().crossVectors(right,forward);
   for(const [u,v] of [[0,0],[-.65,.27],[.72,-.3]]){
    // Invert the source's ray: normalize(forward*focal+right*u+up*v).
    const point=target.clone().addScaledVector(right,u*pose.distance/pose.focal).addScaledVector(up,v*pose.distance/pose.focal);
    const ndc=point.project(camera);
    near(ndc.x,(u+pose.shift[0])/camera.aspect);near(ndc.y,v+pose.shift[1]);
   }
   const matrices=[camera.matrixWorld,camera.matrixWorldInverse,camera.projectionMatrix,camera.projectionMatrixInverse];
   for(const matrix of matrices)assert.ok(matrix.elements.every(Number.isFinite));
   const identity=camera.projectionMatrix.clone().multiply(camera.projectionMatrixInverse).elements;
   for(let i=0;i<16;i++)near(identity[i],i%5===0?1:0);
  }
 }
});

test('camera updates are deterministic, reversible, and continuous at source chapter boundaries',()=>{
 const camera=new T.PerspectiveCamera(27,1,.2,60);
 const sample=progress=>{updateIris09Camera(camera,iris09Pose(progress,1280,720),1280,720);return [...camera.matrixWorld.elements,...camera.projectionMatrix.elements];};
 const expected=sample(.31);sample(.42);sample(0);assert.deepEqual(sample(.31),expected);
 for(const boundary of [1/7,2/7,3/7]){
  const before=sample(boundary-1e-8),after=sample(boundary+1e-8);
  before.forEach((value,index)=>near(value,after[index],1e-8));
 }
});
