import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {chapters,journeyState} from './directions-state.mjs';
import {eventScoreMarkup} from './direction14-score.mjs';
import {createEventCave} from './direction14-cave.mjs';

test('red storyboard has seven distinct reachable chapters',()=>{
 assert.equal(chapters.length,7);
 chapters.forEach((chapter,i)=>assert.equal(journeyState((i+.08)/7).key,chapter.key));
 assert.equal(chapters[1].event,'Light\nshapes perception.');
 assert.equal(chapters[6].event,'Scenes\ntake it further.');
});
test('score spans three staves and retains original event timing',()=>{
 const score={duration:30,notes:[{on:0,off:1,pitch:'E4'},{on:4,off:5,pitch:'G4'},{on:8,off:9,pitch:'C5'}]};
 const html=eventScoreMarkup(score);
 assert.equal((html.match(/data-staff-y=/g)||[]).length,15);
 assert.equal((html.match(/data-on=/g)||[]).length,3);
 assert.ok(!/NaN|Infinity/.test(html));
});
test('cave foreground is bounded live geometry and follows camera projection',()=>{
 const cave=createEventCave(T),mesh=cave.group.children[0];
 assert.ok(mesh.geometry.index.count/3<16000);
 for(const n of mesh.geometry.attributes.normal.array)assert.ok(Number.isFinite(n));
 const camera=new T.PerspectiveCamera(50,1.2,.04,20000);camera.position.set(0,0,10);camera.lookAt(0,0,0);
 cave.update(camera);assert.ok(cave.group.scale.x>cave.group.scale.y);cave.dispose();
});
