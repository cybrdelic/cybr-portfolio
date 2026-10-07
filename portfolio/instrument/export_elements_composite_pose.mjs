import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from '../vendor/three-r180/three.module.min.js';
import {loadElementsFire} from '../instrument-elements-bake.mjs';
import {rasterPaperRadiance} from '../instrument-raster-paper.mjs';
import {createStudioEnvironment} from '../instrument-studio-environment.mjs';
const out=path.resolve('portfolio/output/elements-bake/joint-native');await fs.mkdir(out,{recursive:true});
globalThis.fetch=async url=>new Response(await fs.readFile(path.resolve('portfolio',url.split('?')[0])));
globalThis.document={hidden:false,body:{append(){}},addEventListener(){},removeEventListener(){},createElement(){return{readyState:4,currentTime:0,paused:true,setAttribute(){},removeAttribute(){},remove(){},load(){},addEventListener(){},pause(){},play(){return Promise.resolve();}};}};
const group=new THREE.Group(),reduced={matches:false,addEventListener(){},removeEventListener(){}};
const fire=await loadElementsFire({group,reduced,schedule(){}});
const camera=new THREE.PerspectiveCamera(42,1,2,400);camera.up.set(0,0,1);camera.position.set(66,-94,40);camera.lookAt(0,0,3);camera.updateMatrixWorld();fire.update(camera,.6);
const mesh=group.getObjectByName('elements/baked-CYBR-fire'),u=mesh.material.uniforms;
const uniforms=Object.fromEntries(Object.entries(u).map(([k,v])=>[k,v.value?.toArray?.()??v.value]).filter(([k])=>k!=='image'));
const model=mesh.matrix,positions=mesh.geometry.attributes.position.array;
const corners=[0,1,3].map(i=>new THREE.Vector3().fromArray(positions,i*3).applyMatrix4(model));
const U=corners[1].clone().sub(corners[0]),V=corners[2].clone().sub(corners[0]);
const packet={uniforms,positions:[...positions],model:model.toArray(),viewProjection:uniforms.viewProjection,
 camera:{eye:camera.position.toArray(),forward:new THREE.Vector3(0,0,3).sub(camera.position).normalize().toArray(),inverseViewProjection:new THREE.Matrix4().copy(u.viewProjection.value).invert().toArray(),near:2,far:400},
 firePlane:{origin:corners[0].toArray(),u:U.toArray(),v:V.toArray(),normal:U.clone().cross(V).normalize().toArray()},paper:rasterPaperRadiance()};
await fs.writeFile(path.join(out,'pose.json'),JSON.stringify(packet));
await fs.writeFile(path.join(out,'fire.frag'),mesh.material.fragmentShader.replace(/#include[^\n]+/g,''));
const environment=createStudioEnvironment(THREE);
await fs.writeFile(path.join(out,'studio.rgba32f'),Buffer.from(environment.image.data.buffer));environment.dispose();
fire.dispose();console.log(JSON.stringify({out,pose:'production fire mesh and fragment, actual CAD axes'}));
