import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r180/three.module.min.js';
import {loadFluid} from '../instrument-fluid.js';
const root=path.resolve('portfolio'),base=process.argv[2]||'./assets/instrument-elements-bake/water/';
globalThis.fetch=async url=>new Response(await fs.readFile(path.join(root,url.split('?')[0])),{status:200});
const group=new THREE.Group();let changes=0;const player=await loadFluid(group,()=>changes++,{base});
const index=player.mesh.geometry.index;const proof=[];
for(const p of [0,.5,1,.5,0]){
 player.setProgress(p);const deadline=performance.now()+5000;
 while(player.snapshot().pending){assert(performance.now()<deadline,'FLIP frame decode timed out');await new Promise(r=>setTimeout(r,1));}
 const s=player.snapshot(),g=player.mesh.geometry;assert.equal(s.failed,null);assert.equal(s.frame,Math.round(p*(player.frameCount-1)));assert.equal(g.index,index,'Index storage must be reused');
 assert.equal(g.drawRange.count,s.surfaceTriangles*3);assert(g.boundingBox.min.x>=-26.5&&g.boundingBox.max.x<=26.5);
 const a=g.attributes.position.array;let volume=0;for(let i=0;i<g.drawRange.count*3;i+=9){volume+=(a[i]*(a[i+4]*a[i+8]-a[i+5]*a[i+7])+a[i+1]*(a[i+5]*a[i+6]-a[i+3]*a[i+8])+a[i+2]*(a[i+3]*a[i+7]-a[i+4]*a[i+6]))/6;}
 assert(volume>100000&&volume<115000,'Reconstructed liquid has invalid winding or volume');
 proof.push({progress:p,frame:s.frame,triangles:s.surfaceTriangles,volumeMM3:volume,bounds:g.boundingBox.min.toArray().concat(g.boundingBox.max.toArray())});
}
player.dispose();assert.equal(group.children.length,0);
await fs.mkdir('portfolio/output/elements-bake',{recursive:true});
await fs.writeFile('portfolio/output/elements-bake/water-playback-proof.json',JSON.stringify({pass:true,changes,proof},null,2));
console.log(JSON.stringify({pass:true,frames:proof.map(p=>p.frame),changes,indexStorageReused:true,disposed:true}));
