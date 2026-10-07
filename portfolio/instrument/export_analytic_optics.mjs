/** Package the extracted native coefficients; never remesh or alter CAD. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {packNativeOpticalPrimitives,analyticOpticsGLSL} from '../instrument-analytic-optics.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const receipt=path.join(root,'output/geo-working/pbr-credible');
const destination=path.join(root,'assets/instrument-optical-primitives-v1');
const sha=b=>createHash('sha256').update(b).digest('hex');
const descriptorBytes=await readFile(path.join(receipt,'native-optical-primitives.json'));
const descriptor=JSON.parse(descriptorBytes),binary=await readFile(path.join(receipt,'native-water-cable-boundary.bin'));
const data=new DataView(binary.buffer,binary.byteOffset,binary.byteLength);
if(data.getUint32(0,true)!==0x43594454||data.getUint32(12,true)!==1)throw Error('Unexpected native duct layout');
const count=data.getUint32(4,true),triangles=data.getUint32(8,true),bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
if(binary.byteLength!==16+count*24+triangles*12)throw Error('Incomplete native duct binary');
for(let i=0;i<count*3;i++){const value=data.getFloat32(16+i*4,true);if(!Number.isFinite(value))throw Error('Nonfinite native duct');bounds[0][i%3]=Math.min(bounds[0][i%3],value);bounds[1][i%3]=Math.max(bounds[1][i%3],value);}
const recipe=packNativeOpticalPrimitives(descriptor,{ductBoundsMM:bounds});
recipe.sourceDescriptorSHA256=sha(descriptorBytes);
recipe.water.duct.binary={sha256:sha(binary),bytes:binary.byteLength,vertices:count,triangles,positionOffset:16,normalOffset:16+count*12,indexOffset:16+count*24,normalOrientation:'Native water-outward; do not flip'};
const json=JSON.stringify(recipe),glsl=analyticOpticsGLSL(recipe);
await mkdir(destination,{recursive:true});
await writeFile(path.join(destination,'primitives.json'),json+'\n');
await writeFile(path.join(destination,'native-water-cable-boundary.bin'),binary);
const proof={schema:1,operation:'Lossless native coefficient packaging; Float32 duct copy of verified native extraction',sourceDescriptorSHA256:sha(descriptorBytes),primitiveJSONSHA256:sha(Buffer.from(json+'\n')),binarySHA256:sha(binary),sourceBREPs:recipe.sources,counts:{cubicSpans:40,bubbles:18,ductVertices:count,ductTriangles:triangles},bytes:{primitives:Buffer.byteLength(json+'\n'),duct:binary.byteLength,shader:Buffer.byteLength(glsl)},drawGeometryChanged:false,defaultRendererChanged:false};
await writeFile(path.join(receipt,'analytic-optics-export.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({assetDirectory:destination,proof:path.join(receipt,'analytic-optics-export.json'),...proof.counts,bytes:proof.bytes}));
