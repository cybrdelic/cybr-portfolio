import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynchronizedVideoTexture} from './instrument-video-texture.mjs';
test('video uses mutable upload without independently publishing unsynchronized frames',()=>{
 class Texture {constructor(image){this.image=image;this.version=0;}set needsUpdate(v){if(v)this.version++;}}
 const video={},t=createSynchronizedVideoTexture({Texture,NoColorSpace:'linear',LinearFilter:'linear-filter'},video);
 assert.equal(t.image,video);assert.equal(t.isVideoTexture,true);
 assert.equal(t.generateMipmaps,false);t.update();assert.equal(t.version,0);
 t.needsUpdate=true;assert.equal(t.version,1);
});
