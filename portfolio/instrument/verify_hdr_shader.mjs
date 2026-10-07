import fs from 'node:fs';
import * as THREE from '../vendor/three-r180/three.module.min.js';
import {createHdrComposite} from '../instrument-hdr-composite.mjs';
import {rasterPaperDisplay,rasterPaperRadiance} from '../instrument-raster-paper.mjs';
let material;
class Capture extends THREE.ShaderMaterial{constructor(spec){super(spec);material=this;}}
const pass=createHdrComposite({...THREE,ShaderMaterial:Capture});
const dir=new URL('../output/elements-bake/hdr-proof/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
const chunks=THREE.ShaderChunk;
const fragment='#version 300 es\nprecision highp float;\n#define TONE_MAPPING\nout vec4 outputColor;\n'+chunks.tonemapping_pars_fragment+
 '\nvec3 toneMapping(vec3 color){return ACESFilmicToneMapping(color);}\n'+chunks.colorspace_pars_fragment+
 '\nvec4 linearToOutputTexel(vec4 value){return sRGBTransferOETF(value);}\n'+material.fragmentShader
 .replace('#include <tonemapping_fragment>',chunks.tonemapping_fragment).replace('#include <colorspace_fragment>',chunks.colorspace_fragment)
 .replaceAll('varying','in').replaceAll('gl_FragColor','outputColor').replaceAll('texture2D','texture');
fs.writeFileSync(new URL('fragment.glsl',dir),fragment);
const paper=rasterPaperRadiance();const inputs=[paper,[4,.6,.05],[.1,.1,.1],paper.map((c,i)=>c*.4+[4,.6,.05][i])];
fs.writeFileSync(new URL('samples.json',dir),JSON.stringify(inputs.map(rgb=>({rgb,expected:rasterPaperDisplay(rgb).map(c=>Math.round(c*255))}))));
pass.dispose();console.log(JSON.stringify({shader:'portfolio/output/elements-bake/hdr-proof/fragment.glsl',samples:inputs.length}));
