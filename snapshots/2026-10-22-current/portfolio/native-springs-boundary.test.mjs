import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as T from './vendor/three-r180/three.module.min.js';
import {sourceGeometry} from './source-geometry.mjs';
import {sourcePoolQ,trimWaterInterface} from './native-springs-boundary.mjs';
test('native pool boundary retains both water surfaces and removes the box',()=>{
 const base=new URL('./assets/journey-sources/',import.meta.url),meta=JSON.parse(readFileSync(new URL('reference27-springs.json',base))),raw=gunzipSync(readFileSync(new URL(meta.file,base))),buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
 for(const record of meta.meshes.filter(m=>[6,7].includes(m.material))){
  const g=sourceGeometry(T,buffer,record),before=g.index.count,n=trimWaterInterface(g,record.material===7?1:0);
  assert.ok(n>100);assert.ok(n*3<before);assert.ok(g.attributes.position.array.every(Number.isFinite));g.dispose();
 }
 assert.ok(sourcePoolQ(.5,-1,0)<.05);assert.ok(sourcePoolQ(20,20,0)>1);
});
