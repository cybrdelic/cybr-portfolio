import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import * as T from './vendor/three-r180/three.module.min.js';
import {fetchArtifact} from './artifact-fetch.mjs';
import {updateCable} from './artifact-cable.mjs';

test('asset loader accepts gzip and already-decoded responses, retries HTTP failure',async()=>{
 const original=globalThis.fetch;
 try{
  for(const data of [gzipSync('{"ok":true}'),Buffer.from('{"ok":true}')]){
   globalThis.fetch=async()=>new Response(data);assert.deepEqual(await fetchArtifact('asset',{json:true}),{ok:true});
  }
  let calls=0;globalThis.fetch=async()=>++calls===1?new Response('',{status:503}):new Response('123');
  assert.equal(await fetchArtifact('retry',{json:true}),123);assert.equal(calls,2);
  globalThis.fetch=async()=>new Response('',{status:404});
  await assert.rejects(fetchArtifact('missing'),/missing: HTTP 404/);
 }finally{globalThis.fetch=original;}
});

test('resident cable buffers exactly match fresh Three.js tubes throughout assembly',()=>{
 const curve=span=>new T.CatmullRomCurve3([new T.Vector3(0,0,-23),new T.Vector3(span*.28,0,-26),new T.Vector3(span*.72,0,-26),new T.Vector3(span,0,-23)]);
 const geometry=new T.TubeGeometry(curve(37),20,2.1,8,false),position=geometry.attributes.position,index=geometry.index;
 for(const span of [37,31,20,9,5]){
  updateCable(geometry,curve(span));const reference=new T.TubeGeometry(curve(span),20,2.1,8,false);
  assert.equal(geometry.attributes.position,position);assert.equal(geometry.index,index);
  for(const name of ['position','normal']){
   const actual=geometry.attributes[name].array,expected=reference.attributes[name].array;
   for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-expected[i])<1e-5,`${name} at ${i}`);
  }
  reference.dispose();
 }
 geometry.dispose();
});
