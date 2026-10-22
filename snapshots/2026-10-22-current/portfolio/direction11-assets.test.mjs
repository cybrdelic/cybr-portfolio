import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
test('refracted sunlight bake matches source and contains both lit and occluded samples',()=>{
 const base=new URL('./assets/direction11-springs-sun/',import.meta.url),m=JSON.parse(readFileSync(new URL('manifest.json',base))),data=gunzipSync(readFileSync(new URL('visibility.rgba.gz',base)));
 const source=JSON.parse(readFileSync(new URL('./assets/journey-sources/reference27-springs.json',import.meta.url)));
 assert.equal(m.sourceFile,source.file);assert.equal(data.length,m.size*m.size*4);assert.equal(m.ior,1.333);
 assert.ok(m.samples>25000);assert.ok(m.occluded>0&&m.occluded<m.samples);
 let valid=0,dark=0;for(let i=0;i<data.length;i+=4)if(data[i+3]){valid++;dark+=data[i]===0;}
 assert.equal(valid,m.samples);assert.equal(dark,m.occluded);
});
test('new Combat pose uses original 52-bone skeleton and finite matrices',()=>{
 const base=new URL('./assets/direction11-combat/',import.meta.url),m=JSON.parse(readFileSync(new URL('manifest.json',base))),raw=gunzipSync(readFileSync(new URL('stance.bin.gz',base)));
 assert.equal(m.boneCount,52);assert.equal(raw.length,m.frameCount*m.boneCount*16*4);
 const data=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));assert.ok(data.every(Number.isFinite));
});
test('rebuilt basin has a matching bake without increasing geometry payload',()=>{
 const source=JSON.parse(readFileSync(new URL('./assets/journey-sources/reference27-springs.json',import.meta.url)));
 const rebuilt=JSON.parse(readFileSync(new URL('./assets/journey-sources/direction11-springs.json',import.meta.url)));
 const bake=JSON.parse(readFileSync(new URL('./assets/direction11-shelf-sun/manifest.json',import.meta.url)));
 assert.equal(rebuilt.decodedBytes,source.decodedBytes);
 assert.equal(rebuilt.meshes.length,source.meshes.length);
 assert.ok(rebuilt.reconstruction.movedVertices>10000);
 assert.equal(bake.sourceFile,rebuilt.file);
 assert.ok(bake.samples>24000&&bake.occluded>0);
});
