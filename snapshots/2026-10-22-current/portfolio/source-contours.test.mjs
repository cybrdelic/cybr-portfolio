import test from 'node:test';import assert from 'node:assert/strict';import {contourSegments} from './source-contours.mjs';
test('contours intersect the source triangle instead of inventing a curve',()=>{const segments=contourSegments(new Float32Array([0,0,0,2,2,0,0,2,2]),new Uint32Array([0,1,2]),[1]);assert.deepEqual([...segments],[1,1,0,0,1,1]);});
test('horizontal and out-of-range triangles produce no invalid segments',()=>{const p=new Float32Array([0,0,0,1,0,0,0,0,1]);assert.equal(contourSegments(p,new Uint32Array([0,1,2]),[0,1]).length,0);});
