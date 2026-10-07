import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {createHdrComposite} from './instrument-hdr-composite.mjs';

test('refinement presents the retained full-resolution HDR without another native scene draw',()=>{
  const composite=createHdrComposite(THREE),scene=new THREE.Scene(),camera=new THREE.Camera(),paper=new THREE.Texture();
  const background=new THREE.Texture();scene.background=background;
  const draws=[],renderer={target:null,width:390,height:363,info:{render:{calls:1,triangles:1}},
    getDrawingBufferSize(out){return out.set(this.width,this.height);},getRenderTarget(){return this.target;},
    setRenderTarget(target){this.target=target;},render(subject,view){draws.push({subject,view,target:this.target});}};
  assert.equal(composite.present(renderer),false);
  composite.render(renderer,scene,camera,paper);
  assert.equal(draws.length,2);assert.equal(draws[0].subject,scene);
  const retained=draws[0].target;assert.equal(retained.width,390);assert.equal(retained.height,363);
  assert.equal(retained.samples,4);assert.equal(retained.texture.type,THREE.HalfFloatType);
  assert.equal(scene.background,background);assert.equal(renderer.target,null);
  assert.ok(composite.present(renderer));assert.equal(draws.length,3);
  assert.equal(draws[2].subject,draws[1].subject);assert.equal(draws[2].subject.children[0].material.uniforms.source.value,retained.texture);
  renderer.width=844;assert.equal(composite.present(renderer),false,'resize requires a new full-resolution scene image');
  composite.dispose();
});
