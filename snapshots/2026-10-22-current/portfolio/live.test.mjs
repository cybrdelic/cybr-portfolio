import test from 'node:test';import assert from 'node:assert/strict';
import {chapterAt,refract,prismPath,springStep,project3D} from './live-math.mjs';
test('scroll chapters clamp at both ends',()=>{assert.equal(chapterAt(-50,100),0);assert.equal(chapterAt(450,100),5);assert.equal(chapterAt(9999,0),5);});
test('Snell normal incidence and total internal reflection',()=>{assert.deepEqual(refract([1,0],[-1,0],1/1.5),[1,0]);assert.equal(refract([.5,Math.sqrt(.75)],[-1,0],1.5),null);});
test('prism paths contain entry, exit, and wavelength-dependent outgoing rays',()=>{const tri=[[0,-150],[-130,75],[130,75]],a=prismPath([-420,0],[1,.03],tri,1.52),b=prismPath([-420,0],[1,.03],tri,1.54);assert.ok(a.length>=4);assert.notDeepEqual(a.at(-1),b.at(-1));assert.ok(a.flat().every(Number.isFinite));});
test('damped particle returns to equilibrium',()=>{const p={x:100,y:-50,vx:220,vy:-20};for(let i=0;i<600;i++)springStep(p,0,0,1/60);assert.ok(Math.hypot(p.x,p.y)<.001);});
test('3D projection is length preserving before dropping depth',()=>{const v=project3D(3,4,5,.3,.7);assert.ok(Math.abs(Math.hypot(...v)-Math.sqrt(50))<1e-8);});
