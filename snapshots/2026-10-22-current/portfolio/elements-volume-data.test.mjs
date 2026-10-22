import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as T from './vendor/three-r180/three.module.min.js';
import {validateElementsVolumeManifest,parseElementsVolumeHeader,decodeElementsVolume,createElementsVolumeTexture,loadElementsVolume,decodeElementsOccupancy,createElementsOccupancyTexture} from './elements-volume-data.mjs';

function fixture({water=false,words,mutate}={}){
 const channelCount=water?1:4,data=words||new Uint16Array(8*channelCount).fill(0x3c00),raw=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
 const manifest={format:water?'cybr-water-sdf-volume':'cybr-fire-volume',version:1,dimensions:[2,2,2],encoding:{type:'float16',endianness:'little',channels:water?['signedDistance']:['emission.r','emission.g','emission.b','extinction'],colorSpace:'linear',order:'zyxc',compression:'gzip'},domain:{minimum:[-3,0,-3],extent:[6,6,6]},sampling:{origin:[-1.5,1.5,-3],spacing:[3,3,6]},source:{renderer:'Original WebGL',checkpoint:'test-only'},payload:{bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')}};
 if(water)manifest.coordinates={units:'mm',upAxis:'z',handedness:'right'};
 mutate?.(manifest);const json=new TextEncoder().encode(JSON.stringify(manifest)),gzip=gzipSync(raw),container=new Uint8Array(12+json.length+gzip.length);
 container.set(new TextEncoder().encode('CYBRVOL1'));new DataView(container.buffer).setUint32(8,json.length,true);container.set(json,12);container.set(gzip,12+json.length);
 return {manifest,container,data};
}

test('decodes exact native linear RGBA16F with xyz sampling, hash, and one true 3D texture',async()=>{
 const f=fixture(),volume=await decodeElementsVolume(f.container);
 assert.deepEqual(volume.data,f.data);assert.equal(volume.kind,'fire');assert.equal(volume.channelCount,4);
 for(let axis=0;axis<3;axis++){
  const first=volume.sampling.origin[axis],last=first+volume.sampling.spacing[axis]*(volume.dimensions[axis]-1);
  assert.ok(Math.abs(first*volume.textureScale[axis]+volume.textureOffset[axis]-.25)<1e-12);
  assert.ok(Math.abs(last*volume.textureScale[axis]+volume.textureOffset[axis]-.75)<1e-12);
 }
 const texture=createElementsVolumeTexture(T,volume);assert.equal(texture.isData3DTexture,true);assert.equal(texture.type,T.HalfFloatType);assert.equal(texture.format,T.RGBAFormat);assert.equal(texture.colorSpace,T.NoColorSpace);assert.equal(texture.image.depth,2);assert.equal(texture.image.data,volume.data);texture.dispose();
});

test('water accepts signed float16 distances and preserves millimetres/up axis',async()=>{
 const words=new Uint16Array(8).fill(0xbc00),f=fixture({water:true,words}),volume=await decodeElementsVolume(f.container);
 assert.equal(volume.kind,'water');assert.equal(volume.manifest.coordinates.units,'mm');assert.deepEqual(volume.data,words);
 const texture=createElementsVolumeTexture(T,volume);assert.equal(texture.format,T.RedFormat);texture.dispose();
});

test('rejects corrupt headers, channels, sample grids, and mismatched payload sizes',()=>{
 const f=fixture();assert.throws(()=>parseElementsVolumeHeader(f.container.subarray(0,10)),/truncated/);
 const wrong=f.container.slice();wrong[0]=0;assert.throws(()=>parseElementsVolumeHeader(wrong),/magic/);
 for(const mutate of [m=>m.encoding.channels.reverse(),m=>m.sampling.origin[2]=-.1,m=>m.payload.bytes++,m=>m.dimensions[0]=1,m=>m.encoding.colorSpace='srgb']){
  const bad=fixture({mutate});assert.throws(()=>parseElementsVolumeHeader(bad.container),/Invalid CYBR volume/);
 }
 assert.throws(()=>validateElementsVolumeManifest(f.manifest,{maxDecodedBytes:8}),/exceeds/);
});

test('rejects hash mismatch, non-finite half values and negative radiance/extinction',async()=>{
 await assert.rejects(decodeElementsVolume(fixture({mutate:m=>m.payload.sha256='0'.repeat(64)}).container),/SHA-256 mismatch/);
 const nan=new Uint16Array(32).fill(0x7e00),negative=new Uint16Array(32).fill(0xbc00);
 await assert.rejects(decodeElementsVolume(fixture({words:nan}).container),/non-finite/);
 await assert.rejects(decodeElementsVolume(fixture({words:negative}).container),/negative optical/);
});

test('aborts and reports HTTP failures instead of substituting procedural fire',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(decodeElementsVolume(fixture().container,{signal:controller.signal}),/abort/i);
 await assert.rejects(loadElementsVolume('/missing',{fetchImpl:async()=>({ok:false,status:404,statusText:'Not Found'})}),/404 Not Found/);
 const f=fixture();const volume=await loadElementsVolume('/source',{fetchImpl:async()=>({ok:true,headers:{get:()=>String(f.container.length)},arrayBuffer:async()=>f.container.buffer})});assert.equal(volume.kind,'fire');
});

test('exact-zero occupancy validates source/hash/support and uses nearest R8, never a blurred skip threshold',async()=>{
 const volume=await decodeElementsVolume(fixture().container),data=new Uint8Array([255]);
 const manifest={format:'cybr-fire-exact-zero-occupancy',version:1,encoding:{type:'uint8',order:'zyxc',compression:'none',channels:['occupied'],values:[0,255]},dimensions:[1,1,1],sourceDimensions:[2,2,2],blockSize:[8,8,8],haloVoxels:1,bytes:1,sourceSha256:volume.sha256,sidecarSha256:createHash('sha256').update(data).digest('hex')};
 const occupancy=await decodeElementsOccupancy(manifest,data),texture=createElementsOccupancyTexture(T,occupancy,volume);
 assert.equal(texture.minFilter,T.NearestFilter);assert.equal(texture.magFilter,T.NearestFilter);assert.equal(texture.type,T.UnsignedByteType);assert.equal(texture.format,T.RedFormat);
 assert.throws(()=>createElementsOccupancyTexture(T,{...occupancy,sourceSha256:'0'.repeat(64)},volume),/does not match/);
 await assert.rejects(decodeElementsOccupancy({...manifest,haloVoxels:0},data),/support halo/);
 await assert.rejects(decodeElementsOccupancy(manifest,new Uint8Array([128])),/exact zero/);texture.dispose();
});
