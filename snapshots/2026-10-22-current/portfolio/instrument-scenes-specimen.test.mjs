import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {specimenIndices,specimenPositions,specimenSurfaceGroups,createScenesSpecimen} from './instrument-scenes-specimen.mjs';

test('cut faces use an independent material without changing triangle winding',()=>{
 const record={partRanges:[{name:'scenes__Closed_terrain_and_basin',firstIndex:0,indexCount:6}]};
 const positions=new Float32Array([33,0,-12,33,0,2,32,1,2,0,0,2]);
 const split=specimenSurfaceGroups(record,new Uint32Array([0,1,2,1,2,3]),positions);
 assert.deepEqual([...split.indices],[1,2,3,0,1,2]);
 assert.equal(split.surfaceCount,3);assert.equal(split.cutCount,3);
});

test('only the low outer skirt changes; surface and basin remain exact',()=>{
 const source=new Float32Array([33,0,-12,33,0,2,15,0,-12]);
 const record={module:'scenes',material:20,partRanges:[{name:'scenes__Closed_terrain_and_basin',firstVertex:0,vertexCount:3}]};
 const shaped=specimenPositions(record,source);
 assert.equal(shaped[2],-18);
 assert.deepEqual([...shaped.slice(3)],[...source.slice(3)]);
 assert.equal(source[2],-12);
});

test('source terrain, water, cable and other modules retain their exact index arrays',()=>{
 const indices=new Uint32Array([0,1,2]);
 for(const record of [{module:'geo',material:0},{module:'scenes',material:20},{module:'scenes',material:21},{module:'scenes',material:14}])assert.equal(specimenIndices(record,indices),indices);
});
test('only the selected housing parts are removed, leaving original service fittings',()=>{
 const indices=new Uint32Array([0,1,2,3,4,5]);
 const record={module:'scenes',material:9,partRanges:[{name:'scenes_bored_ceramic_landscape_carrier',firstIndex:0,indexCount:3},{name:'scenes_entry_compression_barrel',firstIndex:3,indexCount:3}]};
 assert.deepEqual([...specimenIndices(record,indices)],[3,4,5]);
 assert.equal(specimenIndices({module:'scenes',material:13,partRanges:[]},indices).length,0);
});
test('specimen geometry is finite, stays within the existing assembly envelope and is inexpensive',()=>{
 const objects=[],materials=[],group=new THREE.Group();
 const specimen=createScenesSpecimen(THREE,{group,objects,materials});
 assert.equal(specimen.snapshot().supports,3);
 assert.ok(specimen.snapshot().triangles<3000);
 for(const object of objects){
  const b=object.geometry.boundingBox;
  assert.ok(b.min.x>=-58&&b.max.x<=58&&b.min.y>=-42&&b.max.y<=42&&b.min.z>=-31&&b.max.z<=9.1);
  assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite));
  assert.equal(object.userData.meshRecord.module,'scenes');
 }
 specimen.dispose();materials.forEach(m=>m.dispose());
});
