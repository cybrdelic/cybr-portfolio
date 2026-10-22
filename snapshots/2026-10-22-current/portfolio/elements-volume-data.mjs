// Source simulation data container. This is not an image/video decoder.
// CYBRVOL1 | uint32 LE JSON byte length | UTF-8 manifest | gzip float16 data.
export const ELEMENTS_VOLUME_MAGIC='CYBRVOL1';
export const ELEMENTS_VOLUME_LIMITS=Object.freeze({headerBytes:65536,decodedBytes:134217728,axis:1024});
const FIRE_CHANNELS=['emission.r','emission.g','emission.b','extinction'];
const FIRE_SOURCE_CHANNELS=['source.r','source.g','source.b','extinction'];
const WATER_CHANNELS=['signedDistance'];

function fail(message){throw new Error(`Invalid CYBR volume: ${message}`);}
function equalArray(a,b){return Array.isArray(a)&&a.length===b.length&&a.every((v,i)=>v===b[i]);}
function vector(value,label,{positive=false}={}){
 if(!Array.isArray(value)||value.length!==3||!value.every(v=>Number.isFinite(v)&&(!positive||v>0)))fail(`${label} must contain three ${positive?'positive ':''}finite numbers`);
 return [...value];
}
function nearly(a,b){return Math.abs(a-b)<=1e-6*Math.max(1,Math.abs(a),Math.abs(b));}

export function validateElementsVolumeManifest(manifest,{maxDecodedBytes=ELEMENTS_VOLUME_LIMITS.decodedBytes}={}){
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))fail('manifest is not an object');
 if(manifest.version!==1)fail('unsupported version');
 const fire=manifest.format==='cybr-fire-volume',water=manifest.format==='cybr-water-sdf-volume';
 if(!fire&&!water)fail('unsupported field format');
 const dimensions=manifest.dimensions;
 if(!Array.isArray(dimensions)||dimensions.length!==3||!dimensions.every(v=>Number.isInteger(v)&&v>=2&&v<=ELEMENTS_VOLUME_LIMITS.axis))fail('dimensions must be three integer axes in [2,1024]');
 const encoding=manifest.encoding,channels=fire?(equalArray(encoding?.channels,FIRE_SOURCE_CHANNELS)?FIRE_SOURCE_CHANNELS:FIRE_CHANNELS):WATER_CHANNELS;
 if(!encoding||encoding.type!=='float16'||encoding.endianness!=='little'||encoding.order!=='zyxc'||encoding.compression!=='gzip'||!equalArray(encoding.channels,channels))fail('field encoding/channel order mismatch');
 if(fire&&encoding.colorSpace!=='linear')fail('emission must remain linear, before display mapping');
 const bytes=dimensions.reduce((a,b)=>a*b,1)*channels.length*2;
 if(!Number.isSafeInteger(bytes)||bytes>maxDecodedBytes)fail(`decoded field exceeds ${maxDecodedBytes} bytes`);
 if(manifest.payload?.bytes!==bytes)fail('payload byte count does not match dimensions/channels');
 if(typeof manifest.payload.sha256!=='string'||!/^[a-f\d]{64}$/i.test(manifest.payload.sha256))fail('missing SHA-256 of uncompressed payload');
 const minimum=vector(manifest.domain?.minimum,'domain.minimum'),extent=vector(manifest.domain?.extent,'domain.extent',{positive:true});
 const origin=vector(manifest.sampling?.origin,'sampling.origin'),spacing=vector(manifest.sampling?.spacing,'sampling.spacing',{positive:true});
 for(let i=0;i<3;i++){
  const last=origin[i]+spacing[i]*(dimensions[i]-1),tolerance=1e-5*Math.max(1,extent[i]);
  if(origin[i]<minimum[i]-tolerance||last>minimum[i]+extent[i]+tolerance)fail('sample centres lie outside declared domain');
 }
 if(fire){
  // Original's xy samples are cell-centred; its native z layers include both
  // domain endpoints. Replacing this with a generic centred cube shifts data.
  const convention=manifest.sampling.convention||'xy-centered-z-endpoints';
  if(!['xy-centered-z-endpoints','cell-centered','endpoints'].includes(convention))fail('unsupported declared fire sampling convention');
  const centered=[convention!=='endpoints',convention!=='endpoints',convention==='cell-centered'];
  const expectedSpacing=extent.map((v,i)=>v/(dimensions[i]-(centered[i]?0:1)));
  const expectedOrigin=minimum.map((v,i)=>v+(centered[i]?expectedSpacing[i]*.5:0));
  if(!spacing.every((v,i)=>nearly(v,expectedSpacing[i]))||!origin.every((v,i)=>nearly(v,expectedOrigin[i])))fail('native fire sample origin/spacing mismatch');
 }else{
  if(manifest.coordinates?.units!=='mm'||!['x','y','z'].includes(manifest.coordinates?.upAxis)||manifest.coordinates?.handedness!=='right')fail('water source units/up axis/handedness are required');
 }
 if(!manifest.source||typeof manifest.source!=='object'||Array.isArray(manifest.source)||Object.keys(manifest.source).length===0)fail('source provenance is required');
 return Object.freeze({manifest,format:manifest.format,kind:fire?'fire':'water',dimensions:Object.freeze([...dimensions]),channelCount:channels.length,decodedBytes:bytes,
  domain:Object.freeze({minimum:Object.freeze(minimum),extent:Object.freeze(extent)}),
  sampling:Object.freeze({origin:Object.freeze(origin),spacing:Object.freeze(spacing)}),
  textureScale:Object.freeze(spacing.map((v,i)=>1/(v*dimensions[i]))),textureOffset:Object.freeze(origin.map((v,i)=>(.5-v/spacing[i])/dimensions[i]))});
}

export function parseElementsVolumeHeader(input,options){
 const bytes=input instanceof Uint8Array?input:input instanceof ArrayBuffer?new Uint8Array(input):null;
 if(!bytes||bytes.byteLength<12)fail('truncated container header');
 if(new TextDecoder('ascii').decode(bytes.subarray(0,8))!==ELEMENTS_VOLUME_MAGIC)fail('wrong container magic');
 const length=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8,true);
 if(length===0||length>ELEMENTS_VOLUME_LIMITS.headerBytes||12+length>=bytes.byteLength)fail('invalid/truncated manifest length');
 let manifest;
 try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(12,12+length)));}catch{fail('manifest is not valid UTF-8 JSON');}
 const descriptor=validateElementsVolumeManifest(manifest,options);
 return {descriptor,compressed:bytes.subarray(12+length)};
}

function abortIfRequested(signal){if(signal?.aborted)throw signal.reason||new DOMException('Volume load aborted','AbortError');}
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));

export async function decodeElementsVolume(input,{signal,maxDecodedBytes=ELEMENTS_VOLUME_LIMITS.decodedBytes}={}){
 abortIfRequested(signal);
 const {descriptor,compressed}=parseElementsVolumeHeader(input,{maxDecodedBytes});
 if(typeof DecompressionStream!=='function')throw new Error('This browser cannot decompress CYBR simulation volumes (gzip DecompressionStream unavailable).');
 const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
 const dataBytes=new Uint8Array(descriptor.decodedBytes);let offset=0;
 try{
  while(true){
   abortIfRequested(signal);const {value,done}=await reader.read();if(done)break;
   if(offset+value.byteLength>dataBytes.length)fail('gzip expands beyond declared payload size');
   dataBytes.set(value,offset);offset+=value.byteLength;
  }
 }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(offset!==dataBytes.length)fail('decompressed payload is truncated');
 abortIfRequested(signal);
 if(!globalThis.crypto?.subtle)throw new Error('Secure-context SHA-256 support is required for source simulation volumes.');
 const digest=await crypto.subtle.digest('SHA-256',dataBytes);
 const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
 if(hash!==descriptor.manifest.payload.sha256.toLowerCase())fail('payload SHA-256 mismatch');
 const littleEndian=new Uint8Array(new Uint16Array([0x0102]).buffer)[0]===2;
 const halfWords=littleEndian?new Uint16Array(dataBytes.buffer):new Uint16Array(dataBytes.length/2),view=littleEndian?null:new DataView(dataBytes.buffer);
 // Validate in bounded chunks, yielding between them. Large source volumes
 // must not create a long synchronous main-thread conversion/load stall.
 const chunk=131072;let nonzero=0;
 for(let start=0;start<halfWords.length;start+=chunk){
  abortIfRequested(signal);const end=Math.min(halfWords.length,start+chunk);
  for(let i=start;i<end;i++){
   const word=littleEndian?halfWords[i]:view.getUint16(i*2,true);
   if((word&0x7c00)===0x7c00)fail(`non-finite float16 sample at component ${i}`);
   if(descriptor.kind==='fire'&&(word&0x8000)&&(word&0x7fff))fail(`negative optical coefficient at component ${i}`);
   if(!littleEndian)halfWords[i]=word;if(word&0x7fff)nonzero++;
  }
  if(end<halfWords.length)await yieldTask();
 }
 return Object.freeze({...descriptor,data:halfWords,sha256:hash,nonzeroComponents:nonzero});
}

export async function loadElementsVolume(url,{signal,fetchImpl=globalThis.fetch,...options}={}){
 if(typeof fetchImpl!=='function')throw new Error('Fetch is unavailable');
 const response=await fetchImpl(url,{signal,credentials:'same-origin'});
 if(!response.ok)throw new Error(`CYBR volume request failed: ${response.status} ${response.statusText||''}`.trim());
 const expectedMax=ELEMENTS_VOLUME_LIMITS.headerBytes+12+(options.maxDecodedBytes||ELEMENTS_VOLUME_LIMITS.decodedBytes)*1.02;
 const declaredLength=Number(response.headers?.get('content-length'));
 if(Number.isFinite(declaredLength)&&declaredLength>expectedMax)fail('compressed container exceeds safety limit');
 const buffer=await response.arrayBuffer();if(buffer.byteLength>expectedMax)fail('container exceeds safety limit');
 return decodeElementsVolume(buffer,{signal,...options});
}

export function createElementsVolumeTexture(T,volume){
 if(!volume?.data||!(volume.data instanceof Uint16Array)||volume.data.length*2!==volume.decodedBytes)fail('decoded float16 data required');
 const texture=new T.Data3DTexture(volume.data,...volume.dimensions);
 texture.name=`CYBR ${volume.kind} source volume / ${volume.sha256.slice(0,12)}`;
 texture.format=volume.channelCount===4?T.RGBAFormat:T.RedFormat;texture.type=T.HalfFloatType;
 texture.minFilter=T.LinearFilter;texture.magFilter=T.LinearFilter;texture.generateMipmaps=false;
 texture.unpackAlignment=1;texture.colorSpace=T.NoColorSpace;texture.needsUpdate=true;
 texture.userData.source={kind:volume.kind,format:volume.format,sha256:volume.sha256,dimensions:[...volume.dimensions],provenance:volume.manifest.source};
 return texture;
}

export async function decodeElementsOccupancy(manifest,input,{signal}={}){
 abortIfRequested(signal);
 if(manifest?.format!=='cybr-fire-exact-zero-occupancy'||manifest.version!==1)fail('unsupported occupancy format/version');
 if(manifest.encoding?.type!=='uint8'||manifest.encoding.order!=='zyxc'||manifest.encoding.compression!=='none'||!equalArray(manifest.encoding.channels,['occupied'])||!equalArray(manifest.encoding.values,[0,255]))fail('unsupported occupancy encoding');
 const {dimensions,sourceDimensions,blockSize}=manifest||{};
 for(const [label,v] of [['dimensions',dimensions],['sourceDimensions',sourceDimensions],['blockSize',blockSize]]){
  if(!Array.isArray(v)||v.length!==3||!v.every(n=>Number.isInteger(n)&&n>0&&n<=1024))fail(`invalid occupancy ${label}`);
 }
 if(!dimensions.every((v,i)=>v===Math.ceil(sourceDimensions[i]/blockSize[i])))fail('occupancy dimensions do not tile the source');
 if(!Number.isInteger(manifest.haloVoxels)||manifest.haloVoxels<1)fail('occupancy requires a trilinear support halo');
 const data=input instanceof Uint8Array?input:new Uint8Array(input);
 if(data.byteLength!==dimensions.reduce((a,b)=>a*b,1)||data.byteLength!==manifest.bytes||data.byteLength>1048576)fail('invalid occupancy byte count');
 if(!data.every(v=>v===0||v===255))fail('occupancy must use exact zero/nonzero cells');
 for(const key of ['sourceSha256','sidecarSha256'])if(!/^[a-f\d]{64}$/i.test(manifest[key]||''))fail(`invalid occupancy ${key}`);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
 if(hash!==manifest.sidecarSha256.toLowerCase())fail('occupancy SHA-256 mismatch');
 abortIfRequested(signal);
 return Object.freeze({manifest,data,dimensions:[...dimensions],sourceDimensions:[...sourceDimensions],blockSize:[...blockSize],sourceSha256:manifest.sourceSha256.toLowerCase(),sha256:hash});
}

export async function loadElementsOccupancy(url,{signal,fetchImpl=globalThis.fetch}={}){
 const response=await fetchImpl(url,{signal,credentials:'same-origin'});
 if(!response.ok)throw new Error(`CYBR occupancy request failed: ${response.status}`);
 const manifest=await response.json();
 if(typeof manifest.file!=='string'||!manifest.file||/[:\\]/.test(manifest.file)||manifest.file.split('/').includes('..'))fail('invalid occupancy sidecar path');
 const base=typeof url==='string'&&/^[a-z]+:/i.test(url)?url:new URL(url,globalThis.location?.href||'http://localhost/').href;
 const payload=await fetchImpl(new URL(manifest.file,base),{signal,credentials:'same-origin'});
 if(!payload.ok)throw new Error(`CYBR occupancy payload request failed: ${payload.status}`);
 return decodeElementsOccupancy(manifest,await payload.arrayBuffer(),{signal});
}

export function createElementsOccupancyTexture(T,occupancy,volume){
 if(occupancy.sourceSha256!==volume.sha256||!occupancy.sourceDimensions.every((v,i)=>v===volume.dimensions[i]))fail('occupancy does not match the source volume');
 const texture=new T.Data3DTexture(occupancy.data,...occupancy.dimensions);
 texture.name=`Exact-zero macrogrid / ${occupancy.sha256.slice(0,12)}`;
 texture.format=T.RedFormat;texture.type=T.UnsignedByteType;texture.minFilter=texture.magFilter=T.NearestFilter;
 texture.generateMipmaps=false;texture.unpackAlignment=1;texture.colorSpace=T.NoColorSpace;texture.needsUpdate=true;
 return texture;
}
