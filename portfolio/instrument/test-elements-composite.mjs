import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from '../vendor/three-r180/three.module.min.js';
import {createElementsTimeline} from '../instrument-elements-timeline.mjs';
import {loadElementsComposite} from '../instrument-elements-composite.mjs';

const duration=109/30,timeline=createElementsTimeline({duration,waterFrames:109});
const values=[0,duration/2,duration-.001,.001,duration/2,duration-.001,.001].map(t=>timeline.sample(t));
assert.deepEqual(values.map(v=>v.waterFrame),[0,54,108,108,54,0,0]);
assert.ok(values.every(v=>v.waterFrame>=0&&v.waterFrame<109));

const callbacks=new Map();let callbackID=0,video,release;
globalThis.document={hidden:false,body:{append(v){video=v;}},addEventListener(){},removeEventListener(){},
 createElement(){return{paused:true,currentTime:0,readyState:4,
  setAttribute(){},removeAttribute(){},remove(){},load(){},addEventListener(){},
  pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},
  requestVideoFrameCallback(fn){callbacks.set(++callbackID,fn);return callbackID;},
  cancelVideoFrameCallback(i){callbacks.delete(i);}};}};
globalThis.fetch=async url=>new Response(await fs.readFile(path.resolve('portfolio',url.split('?')[0])));
const reduced={matches:false,addEventListener(){},removeEventListener(){}},group=new THREE.Group();
let waterFrame=-1,scheduled=0;
const fluid={frameCount:109,prefetch(){return Promise.resolve();},
 async setFrame(i){await new Promise(resolve=>release=resolve);waterFrame=i;return true;}};
const composite=await loadElementsComposite({group,fluid,reduced,schedule(){scheduled++;}});
const camera=new THREE.PerspectiveCamera();camera.position.set(30,-70,30);camera.updateMatrixWorld();
composite.update(camera,.6);assert.equal(video.paused,false);
const texture=group.getObjectByName('elements/baked-CYBR-fire').material.uniforms.image.value;
const previousVersion=texture.version;
const callback=callbacks.get(callbackID),delivery=callback(0,{mediaTime:duration/2});
assert.equal(video.paused,true,'media must wait for its matching water geometry');
assert.equal(texture.version,previousVersion,'new fire cannot publish during water decode');
assert.equal(composite.snapshot().waitingForWater,true);
release();await delivery;
assert.equal(waterFrame,54);assert.equal(texture.version,previousVersion+1);
assert.equal(video.paused,false);assert.equal(composite.snapshot().waitingForWater,false);
composite.setPaused(true);assert.equal(video.paused,true);
composite.dispose();assert.equal(group.children.length,0);
const proof={pass:true,timelineFrames:values.map(v=>v.waterFrame),
 atomicColorAndWaterPresentation:true,pauseDuringDecode:true,cleanDisposal:true,scheduled};
await fs.mkdir('portfolio/output/elements-bake',{recursive:true});
await fs.writeFile('portfolio/output/elements-bake/shared-clock-proof.json',JSON.stringify(proof,null,2));
console.log(JSON.stringify(proof));
