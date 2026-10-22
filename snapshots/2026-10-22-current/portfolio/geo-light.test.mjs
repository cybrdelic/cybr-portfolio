import test from 'node:test';
import assert from 'node:assert/strict';
import {phase,choreography,tracePrism,refract} from './geo-light-math.mjs';
test('timeline endpoints and reversible deterministic sampling',()=>{
  assert.equal(choreography(0).optics,0);assert.equal(choreography(1).optics,1);
  assert.equal(choreography(0).open,0);assert.equal(choreography(1).open,0);
  for(let p=0;p<=1;p+=.001)for(const v of Object.values(choreography(p)))assert.ok(v>=0&&v<=1);
  assert.deepEqual(choreography(.42),choreography(.42));assert.equal(phase(.5,0,1),.5);
});
test('Snell normal incidence and total internal reflection',()=>{
  assert.deepEqual(refract([1,0],[-1,0],1/1.5),[1,0]);
  assert.equal(refract([.5,Math.sqrt(.75)],[-1,0],1.5),null);
});
test('all interactive prism angles and wavelengths yield finite exiting rays',()=>{
  for(let angle=-25;angle<=-5;angle++)for(let wavelength=420;wavelength<=680;wavelength+=10){
    const ray=tracePrism(angle*Math.PI/180,wavelength);
    assert.ok(ray.exited,`${angle} / ${wavelength}`);assert.ok(ray.points.flat().every(Number.isFinite));
  }
});
test('short wavelengths refract more than long wavelengths',()=>{
  const a=tracePrism(-15*Math.PI/180,430),b=tracePrism(-15*Math.PI/180,680);
  assert.ok(a.ior>b.ior);assert.ok(Math.abs(a.points.at(-1)[1]-b.points.at(-1)[1])>.05);
});
