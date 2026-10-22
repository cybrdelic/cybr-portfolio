import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {createShadowSet} from './direction11-set.mjs';
import {createShadowChoreography} from './direction11-choreography.mjs';

test('every architectural surface uses the same world-metric texture scale',()=>{
 const set=createShadowSet();set.root.updateMatrixWorld(true);
 const point=new T.Vector3(),normal=new T.Vector3();let checked=0;
 set.root.traverse(mesh=>{
  if(!mesh.isMesh)return;
  const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,uv=mesh.geometry.attributes.uv;
  const matrix=new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for(let i=0;i<p.count;i++){
   point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
   normal.fromBufferAttribute(n,i).applyMatrix3(matrix).normalize();
   const expected=Math.abs(normal.y)>.5?[point.x,point.z]:Math.abs(normal.x)>.5?[point.z,point.y]:[point.x,point.y];
   assert.ok(Math.abs(uv.getX(i)-expected[0]/100)<1e-6,mesh.name+' u');
   assert.ok(Math.abs(uv.getY(i)-expected[1]/100)<1e-6,mesh.name+' v');
   checked++;
  }
 });
 assert.ok(checked>200);set.dispose();
});

test('only doors move: floor, walls and threshold stay fixed and scroll reverses exactly',()=>{
 const set=createShadowSet(),floor=set.root.getObjectByName('Floor slab'),wall=set.root.getObjectByName('Back wall / left');
 const snapshots=[floor,wall].map(mesh=>mesh.position.toArray());
 for(const t of [0,.1,.2,.5,1,.5,.2,.1,0]){
  set.transitionToScene(t);set.root.updateMatrixWorld(true);
  assert.deepEqual([floor,wall].map(mesh=>mesh.position.toArray()),snapshots);
  assert.equal(floor.visible,true);assert.equal(floor.parent.visible,true);
 }
 assert.equal(set.root.getObjectByName('Pocket door / left').position.x,-5);
 set.update('scenes');assert.equal(set.root.getObjectByName('Terracotta threshold').visible,true);
 set.update('geo');assert.equal(set.root.getObjectByName('Terracotta threshold').visible,false);
 assert.equal(set.root.getObjectByName('Wall reveal'),undefined,'no stray pilaster shadow');
 set.dispose();
});

test('camera never crosses solid architecture or loses continuous supporting ground',()=>{
 const set=createShadowSet(),object=()=>new T.Group();
 const env={width:1059,height:917,mechanism:{root:object(),update(){},whiteprint:{update(){}}},splash:{root:object(),update(){}},score:{root:object(),update(){this.root.position.set(4.6,.6,0);}},projects:null,set,ground:object(),sun:new T.DirectionalLight(),fill:new T.DirectionalLight(),hemi:new T.HemisphereLight(),scene:new T.Scene()};
 const director=createShadowChoreography(),ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),solids=[];
 set.root.traverse(o=>{if(o.isMesh)solids.push(o);});
 let previous;
 for(let step=0;step<=240;step++){
  const progress=(5.64+.36*step/240)/7;
  const {camera}=director.apply(progress,env);set.root.updateMatrixWorld(true);
  const visible=solids.filter(mesh=>{for(let p=mesh;p;p=p.parent)if(!p.visible)return false;return true;});
  ray.set(camera.position,down);ray.far=2e3;
  const hit=ray.intersectObjects(visible,false)[0];
  assert.ok(hit,`no floor under camera at ${step}`);
  assert.ok(hit.distance>=.4,`camera-floor clearance ${hit.distance} at ${step}`);
  if(previous){
   const segment=new T.Vector3().subVectors(camera.position,previous),length=segment.length();
   if(length>1e-9){ray.set(previous,segment.normalize());ray.far=length;assert.equal(ray.intersectObjects(visible,false).length,0,`camera crosses solid at ${step}`);}
  }
  previous=camera.position.clone();
 }
 set.dispose();
});

test('threshold wall meets its slab and outdoor materials use the outdoor environment',()=>{
 const set=createShadowSet();set.update('scenes');set.root.updateMatrixWorld(true);
 const wall=set.root.getObjectByName('Threshold wall'),terrace=set.root.getObjectByName('Terrace slab');
 const bounds=new T.Box3().setFromObject(wall);
 const ray=new T.Raycaster(new T.Vector3(.1,20,(bounds.min.z+bounds.max.z)/2),new T.Vector3(0,-1,0));
 assert.ok(ray.intersectObject(terrace,false).length,'wall foot must meet terrace, not hover over pool');
 const outdoor=new T.Texture();set.setOutdoorEnvironment(outdoor);
 assert.equal(wall.material.envMap,outdoor);assert.equal(terrace.material.envMap,outdoor);
 assert.equal(set.material.envMap,null,'interior retains its own studio environment');
 set.dispose();outdoor.dispose();
});
