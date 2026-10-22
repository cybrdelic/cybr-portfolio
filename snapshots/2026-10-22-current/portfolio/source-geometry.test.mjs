import test from 'node:test';import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {sourceGeometry} from './source-geometry.mjs';
test('source triangle triples draw every index, not one third',()=>{
 const bytes=new ArrayBuffer(60);new Float32Array(bytes,0,9).set([0,0,0,1,0,0,0,1,0]);new Uint32Array(bytes,36,6).set([0,1,2,2,1,0]);
 const g=sourceGeometry(T,bytes,{position:{offset:0,count:9,size:3},index:{offset:36,count:6,size:3}});
 assert.equal(g.index.itemSize,1);assert.equal(g.index.count,6);assert.equal(g.index.count/3,2);assert.equal(g.attributes.position.count,3);g.dispose();
});
