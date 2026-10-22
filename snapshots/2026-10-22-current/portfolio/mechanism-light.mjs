// The portfolio supplies geometry; CYBR LIGHT owns transport and pose updates.
import * as T from './vendor/three-r180/three.module.min.js';
import {packThreeScene,createThreeHybrid} from '../cybr-light/browser/three-hybrid.mjs?revision=physical-turn-42';
export const packMechanism=hardware=>packThreeScene(T,hardware);
export async function createMechanismLight(canvas,hardware){
 const info=await(await fetch(new URL('./assets/pbr-metal/studio/studio_small_08-source.json',import.meta.url))).json();
 const response=await fetch(new URL('./assets/pbr-metal/studio/studio_small_08-1024x512-rgba.f32.gz',import.meta.url));
 if(!response.ok)throw Error('Photographic studio environment unavailable');
 const pixels=new Float32Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
 // Studio Small 08 has ~7.9x the spherical mean radiance of the previous
 // workshop. Three stops down preserves HDR ratios, not highlight clipping.
 for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)pixels[i+c]*=.125;
 const [width,height]=info.runtimeDimensions;
 return createThreeHybrid(canvas,T,hardware,{environment:{pixels,width,height},background:[.88,.90,.92],localMetalReflections:true});
}
