import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTextureAsset,loadTextureAssets} from './texture-asset-load.mjs';

test('successful texture identity and request URL are unchanged, with no extra fetch or decode',async()=>{
 const calls=[],texture={image:{decode(){throw Error('must not replace the loader decode path');}}},url=new URL('http://127.0.0.1:4181/assets/real.png?revision=2');
 const loader={loadAsync:async value=>{calls.push(value);return texture;}};
 assert.equal(await loadTextureAsset(loader,url,{delay(){throw Error('unexpected retry');}}),texture);
 assert.deepEqual(calls,[url.href]);
});

test('opaque image event gets exactly one per-image retry using the identical URL',async()=>{
 const calls=[],delays=[],event={type:'error'},texture={isTexture:true};
 const loader={loadAsync:async url=>{calls.push(url);if(calls.length===1)throw event;return texture;}};
 assert.equal(await loadTextureAsset(loader,'./real-height.jpg',{delay:async ms=>delays.push(ms)}),texture);
 assert.deepEqual(calls,['./real-height.jpg','./real-height.jpg']);assert.deepEqual(delays,[120]);
});

test('terminal failure reports the actual image URL, attempts and original cause instead of undefined',async()=>{
 let calls=0;const cause={type:'error',target:{currentSrc:'http://127.0.0.1:4181/remapped/rock.jpg?real=1'}};
 await assert.rejects(loadTextureAsset({loadAsync:async()=>{calls++;throw cause;}},'./rock.jpg',{delay:async()=>{}}),error=>{
  assert.equal(error.name,'TextureAssetLoadError');assert.equal(error.attempts,2);assert.equal(error.cause,cause);
  assert.equal(error.url,cause.target.currentSrc);assert.match(error.message,/2 attempts/);assert.ok(error.message.includes(cause.target.currentSrc));
  assert.match(error.message,/did not expose/);assert.doesNotMatch(error.message,/undefined/);return true;
 });
 assert.equal(calls,2);
});

test('decode error can recover but cancellation and programming errors are not retried',async()=>{
 let calls=0;const decode=new Error('Image decode temporarily failed');decode.name='EncodingError';
 assert.equal(await loadTextureAsset({loadAsync:async()=>{if(++calls===1)throw decode;return 'real texture';}},'https://example.test/image.png',{delay:async()=>{}}),'real texture');
 assert.equal(calls,2);
 for(const cause of [Object.assign(new Error('cancelled'),{name:'AbortError'}),{type:'abort'},new TypeError('bad loader configuration')]){
  calls=0;await assert.rejects(loadTextureAsset({loadAsync:async()=>{calls++;throw cause;}},'./actual.png',{delay:async()=>{throw Error('must not retry');}}),error=>error.attempts===1&&error.cause===cause);assert.equal(calls,1);
 }
 calls=0;await assert.rejects(loadTextureAsset({loadAsync(){calls++;throw Error('synchronous loader failure');}},'./actual.png',{delay:async()=>{throw Error('must not retry');}}),error=>error.attempts===1);assert.equal(calls,1);
});

test('errors without an event URL resolve the requested loader path, without exposing embedded data',async()=>{
 await assert.rejects(loadTextureAsset({path:'https://example.test/source/',loadAsync:async()=>{throw undefined;}},'height.jpg',{delay:async()=>{}}),error=>{
  assert.equal(error.url,'https://example.test/source/height.jpg');assert.match(error.message,/without an error message/);return true;
 });
 await assert.rejects(loadTextureAsset({loadAsync:async()=>{throw {type:'error'};}},'data:image/png;base64,PRIVATE_BINARY',{delay:async()=>{}}),error=>!error.message.includes('PRIVATE_BINARY')&&error.url==='[embedded image data URL]');
});

test('batch failure settles siblings, disposes unowned successes once and never retries successful assets',async()=>{
 const calls=[],texture={dispose(){this.disposed=(this.disposed??0)+1;}},delay=async()=>{};
 const loader={loadAsync:async url=>{calls.push(url);if(url==='bad.png')throw {type:'error'};return texture;}};
 await assert.rejects(loadTextureAssets(loader,['good.png','bad.png','shared-good.png'],{delay}),error=>error.attempts===2&&error.url.endsWith('/bad.png'));
 assert.equal(texture.disposed,1);assert.equal(calls.filter(x=>x==='good.png').length,1);assert.equal(calls.filter(x=>x==='bad.png').length,2);
 const first={},second={};assert.deepEqual(await loadTextureAssets({loadAsync:async url=>url==='a'?first:second},['a','b']),[first,second]);
});

test('both production image-loader sites use bounded wrappers rather than restarting the chapter',()=>{
 const journey=readFileSync(new URL('./journey-projects.mjs',import.meta.url),'utf8'),native=readFileSync(new URL('./native-springs-finish.mjs',import.meta.url),'utf8');
 for(const source of[journey,native]){assert.match(source,/texture-asset-load\.mjs/);assert.doesNotMatch(source,/\.loadAsync\(/);}
 assert.match(journey,/if\(!pending\.has\(key\)\)/);assert.match(journey,/pending\.set\(key,task\)/);
 assert.match(native,/catch\(error\)\{ripple\.dispose\(\);sunVisibility\.dispose\(\);throw error;\}/);
});
