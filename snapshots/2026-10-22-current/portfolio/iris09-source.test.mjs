import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {IRIS09_SOURCE_SHA256,buildIris09Fragment} from './iris09-stage.mjs';

const expectedHash='455e1ba9b0740a6ab925f9c022eea5f217fd3bbfc08ffec3177fb3b1d925843b';
const sourceBytes=await readFile(new URL('./assets/iris09/IRIS-09.glsl',import.meta.url));
const source=sourceBytes.toString('utf8');
const provenance=JSON.parse(await readFile(new URL('./assets/iris09/provenance.json',import.meta.url),'utf8'));

test('production source is the exact recovered Revision III artifact',()=>{
 assert.equal(sourceBytes.length,43865);
 assert.equal(createHash('sha256').update(sourceBytes).digest('hex'),expectedHash);
 assert.equal(IRIS09_SOURCE_SHA256,expectedHash);
 assert.equal(provenance.source.sha256,expectedHash);
 assert.equal(provenance.source.bytes,sourceBytes.length);
 assert.equal(provenance.source.file,'IRIS-09.glsl');
 assert.equal(provenance.revision,3);
 assert.equal(provenance.revisionLabel,'Revision III');
 assert.equal('conversation' in provenance.source,false);
 assert.equal(provenance.source.retrievedOn,'2026-10-21');
 assert.equal(provenance.source.downloadLabel,'Download IRIS-09.glsl');
 assert.equal(provenance.excludedArchive.revision,2);
 assert.notEqual(provenance.excludedArchive.sourceSha256,expectedHash);
});

test('provenance describes the actual geometry and bounded transport, not a mesh or full path tracer',()=>{
 const implementation=provenance.implementation;
 assert.equal(implementation.type,'procedural-fragment-scene');
 assert.equal(implementation.geometry.irisLeaves,9);
 assert.equal(implementation.geometry.refractiveElements,2);
 assert.equal(implementation.geometry.gripFlutes,120);
 assert.equal(implementation.maximumOpticalInterfaceSteps,24);
 assert.equal(implementation.aaPerAxis,2);
 assert.equal(implementation.cameraSamplesPerPixel,4);
 assert.equal(implementation.externalAssetCount,0);
 assert.match(source,/#ifndef AA\s+#define AA 2\s+#endif/);
 assert.match(source,/for\s*\(int blade = 0; blade < 9; \+\+blade\)/);
 assert.match(source,/float sector=TAU\/120\.0;/);
 assert.match(source,/for\(int bounce=0;bounce<24;bounce\+\+\)/);
 assert.equal((source.match(/\n\s+capIntersection\(ro,rd,/g)||[]).length,2);
 assert.match(source,/sceneTime=u_time\*2\.0;/);
 assert.match(source,/cos\(time \* \(IRIS_PI \/ 10\.0\)\)/);
 assert.match(provenance.limitations.join(' '),/not an exported CAD mesh or a full path tracer/);
 assert.match(provenance.limitations.join(' '),/not a force simulation/);
 assert.match(provenance.limitations.join(' '),/not browser frame rate/);
});

test('stage permits only exact-count loop bounds while preserving transport and sampling',()=>{
 const fragment=buildIris09Fragment(source);
 const loopBounds=[
  ['for(int bounce=0;bounce<24;bounce++)','for(int bounce=0;bounce<u_irisOpticalSteps;bounce++)',1],
  ['for(int y=0;y<AA;y++)','for(int y=0;y<u_irisSampleAxis;y++)',1],
  ['for(int x=0;x<AA;x++)','for(int x=0;x<u_irisSampleAxis;x++)',1],
  ['for(int i=0;i<104;i++)','for(int i=0;i<u_irisMarchSteps;i++)',1],
  ['for(int i=0;i<28;i++)','for(int i=0;i<u_irisShadowSteps;i++)',1],
  ['for(int i=0;i<3;i++)','for(int i=0;i<u_irisLightCount;i++)',2],
  ['for(int sy=0;sy<5;sy++)','for(int sy=0;sy<u_irisQuadratureAxis;sy++)',1],
  ['for(int sx=0;sx<5;sx++)','for(int sx=0;sx<u_irisQuadratureAxis;sx++)',1]
 ];
 let restored=fragment;
 for(const [original,adapted,count]of loopBounds){
  assert.equal(source.split(original).length-1,count,'source loop site count must match the recovered source');
  assert.equal(fragment.split(adapted).length-1,count,'every approved loop site must use its exact-count uniform');
  restored=restored.split(adapted).join(original);
 }
 for(const name of ['OpticalSteps','SampleAxis','MarchSteps','ShadowSteps','LightCount','QuadratureAxis','Channels'])assert.ok(fragment.includes(`uniform int u_iris${name};`));
 // Normalize the channel loop only if it retains the original three IOR
 // offsets, call inputs, component extraction and ordering. Runtime tests
 // separately require the iteration count to be pinned to exactly three.
 const channelLoop=/vec3 channels=vec3\(0\.0\);\s*for\(int channel=0;channel<u_irisChannels;channel\+\+\)\s*\{\s*float dispersion=channel==0\?-0\.0030:channel==1\?0\.0:0\.0050;\s*vec3 value=opticalTransport\(ro,rd,h,dispersion\);\s*channels\[channel\]=value\[channel\];\s*\}\s*return channels;/g;
 assert.equal([...fragment.matchAll(channelLoop)].length,1,'all three original wavelength paths must be represented by one exact channel loop');
 const originalChannels=source.match(/vec3 r=opticalTransport\(ro,rd,h,-0\.0030\);[\s\S]*?return vec3\(r\.r,g\.g,b\.b\);/)[0];
 restored=restored.replace(channelLoop,originalChannels);
 const sourceFunctions=source.slice(0,source.indexOf('void main() {'));
 assert.ok(restored.includes(sourceFunctions),'all pre-camera code must be verbatim after only the approved loop-bound substitution');
 restored=restored.replace('\n        if(!u_irisOriginalCamera)uv-=u_irisShift;','');
 const cameraSamplingAndDisplay=source.slice(source.indexOf('float focusDistance=distance-.035;'));
 assert.ok(restored.includes(cameraSamplingAndDisplay),'sample count normalization, seeds, phase weighting, lens sampling and display curve must be unchanged');
 assert.match(fragment,/void iris09SourceMain\(\)/);
 assert.match(fragment,/void main\(\)\{iris09SourceMain\(\);/);
 assert.equal((fragment.match(/#define AA 2/g)||[]).length,1);
 assert.doesNotMatch(fragment,/#define\s+AA\s+(?:1|3|4)\b/);
 assert.doesNotMatch(fragment,/sampler(?:2D|Cube)|texture(?:2D|Cube)?\s*\(/);
});

test('production concept11 uses source-derived meshes without compiling the reference shader or reusing iris02',async()=>{
 const directions=await readFile(new URL('./directions.mjs',import.meta.url),'utf8');
 const stage=await readFile(new URL('./iris09-stage.mjs',import.meta.url),'utf8');
 assert.match(directions,/import\s*\{\s*createIris09MeshStage\s*\}\s*from\s*['"]\.\/iris09-mesh-stage\.mjs['"]/);
 assert.doesNotMatch(directions,/fetch\(['"]\.\/assets\/iris09\/IRIS-09\.glsl['"]\)/);
 assert.match(directions,/await irisStage\.compile\(renderer\)/);
 assert.match(directions,/irisStage\.render\(renderer,/);
 assert.doesNotMatch(directions,/loadIrisAssembly|iris-assembly\.mjs|iris09-original/);
 assert.match(directions,/const mechanism=id==='11'\?null:createReferenceInstrument/);
 assert.match(directions,/catch\(error\)\{[^}]*throw error;/,'source/compile failure must remain an error');
 assert.doesNotMatch(stage,/source\.png|\.mp4\b|\.webm\b|poster\.webp|iris09-original|VideoTexture|TextureLoader|ImageLoader|ImageBitmapLoader|createElement\(['"]video['"]\)|new Image\s*\(/i);
 assert.match(stage,/source hash differs from the recovered Revision III artifact/);
 assert.match(stage,/RawShaderMaterial/);
});
