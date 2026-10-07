import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {geometrySegments,restoreGeometryBytes} from './instrument-geometry-codec.mjs';

test('lossless CAD transfer restores all original geometry bytes and fingerprint',()=>{
  const base=new URL('./assets/instrument-working-v1/',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',base)));
  const packed=readFileSync(new URL(manifest.losslessTransfer.file,base));
  assert.equal(packed.byteLength,manifest.losslessTransfer.bytes);
  assert.equal(createHash('sha256').update(packed).digest('hex'),manifest.losslessTransfer.sha256);
  const shuffled=gunzipSync(packed);
  const restored=restoreGeometryBytes(shuffled.buffer.slice(shuffled.byteOffset,shuffled.byteOffset+shuffled.byteLength),geometrySegments(manifest.meshes));
  const original=gunzipSync(readFileSync(new URL('instrument.bin.gz',base)));
  assert.equal(restored.byteLength,manifest.stats.decodedGeometryBytes);
  assert.ok(Buffer.from(restored).equals(original),'every position, normal, UV, index, finish and padding byte must match');
  assert.equal(createHash('sha256').update(Buffer.from(restored)).digest('hex'),manifest.stats.sha256);
});

test('invalid transfer segments fail before constructing out-of-bounds attributes',()=>{
  for(const segment of [{offset:1,count:1,width:4,stride:1},{offset:0,count:5,width:2,stride:3},
    {offset:0,count:-1,width:4,stride:1},{offset:0,count:1,width:8,stride:1}])
    assert.throws(()=>restoreGeometryBytes(new ArrayBuffer(8),[segment]),/Invalid lossless CAD segment/);
  assert.throws(()=>geometrySegments([{positions:{offset:0,count:3,dtype:'float16'}}]),/Unsupported/);
});
