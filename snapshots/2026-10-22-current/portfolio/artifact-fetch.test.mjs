import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {decodedResponseBytes} from './artifact-fetch.mjs';
function response(bytes,split=1){let offset=0;return new Response(new ReadableStream({pull(controller){if(offset===bytes.length)return controller.close();const next=Math.min(bytes.length,offset+split);controller.enqueue(bytes.subarray(offset,next));offset=next;}}));}
test('streaming loader detects gzip even across one-byte prefix chunks',async()=>{
 const original=Buffer.from('Exact source geometry and material bytes '.repeat(1000));
 const result=await decodedResponseBytes(response(gzipSync(original)));
 assert.deepEqual(Buffer.from(result),original);
});
test('streaming loader accepts already-decoded and empty bodies',async()=>{
 for(const original of [Buffer.alloc(0),Buffer.from([31]),Buffer.from('{"scene":"springs"}')])assert.deepEqual(Buffer.from(await decodedResponseBytes(response(original,7))),original);
});
