import test from 'node:test';
import assert from 'node:assert/strict';
import {designs,chapters,journeyState,smooth} from './directions-state.mjs';
test('exactly the five selected directions',()=>assert.deepEqual(Object.keys(designs).sort(),['04','05','11','14','27'].sort()));
test('all seven contributors have distinct chapters',()=>assert.deepEqual(chapters.map(c=>c.key),['geo','light','material','elements','song','combat','scenes']));
test('scroll boundaries are bounded and reversible',()=>{for(let n=-10;n<=1010;n++){const p=n/1000,s=journeyState(p);assert.ok(s.index>=0&&s.index<7);assert.ok(s.local>=0&&s.local<=1);assert.deepEqual(s,journeyState(p));}assert.equal(journeyState(1).key,'scenes');assert.equal(journeyState(1).local,1);assert.equal(journeyState(-1).key,'geo');});
test('each chapter can be addressed independently',()=>chapters.forEach((c,i)=>assert.equal(journeyState((i+.4)/7).key,c.key)));
test('smooth interpolation has bounded endpoints',()=>{assert.equal(smooth(-1),0);assert.equal(smooth(2),1);assert.equal(smooth(.5),.5);});
