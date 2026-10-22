import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {createElementsProjectedRegion} from './elements-projected-region.mjs';
test('proxy projection contains every corner and uses drawing-buffer coordinates',()=>{
 const mesh=new T.Mesh(new T.BoxGeometry(2,2,2)),camera=new T.PerspectiveCamera(45,2,.1,100);
 camera.position.set(0,0,10);camera.lookAt(0,0,0);
 const project=createElementsProjectedRegion(),r=project(mesh,camera,1200,600);
 assert.ok(r.x>0&&r.y>0&&r.width>0&&r.height>0);
 for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
  const p=new T.Vector3(x,y,z).project(camera),px=(p.x*.5+.5)*1200,py=(p.y*.5+.5)*600;
  assert.ok(px>=r.x&&px<=r.x+r.width&&py>=r.y&&py<=r.y+r.height);
 }
 mesh.geometry.dispose();
});
test('near-plane crossing and invalid projection conservatively disable retention',()=>{
 const mesh=new T.Mesh(new T.BoxGeometry(2,2,2)),camera=new T.PerspectiveCamera(45,1,.1,100);
 const project=createElementsProjectedRegion();
 assert.equal(project(mesh,camera,100,100),null);assert.equal(project(mesh,camera,0,100),null);
 mesh.geometry.dispose();
});
