import test from 'node:test';import assert from 'node:assert/strict';
import {mechanismSequence as state,sequenceStops} from './mechanism-sequence.mjs';
test('all mechanical acts precede lighting; endpoints remain valid',()=>{
 for(let i=0;i<=1000;i++){const p=i/1000,s=state(p);assert.ok(s.drive>=0&&s.drive<=1);assert.ok(s.light===0||s.light===1);if(p<.8)assert.equal(s.light,0);}
 assert.equal(state(0).drive,0);assert.equal(state(1).drive,1);assert.equal(state(1).light,1);
 assert.equal(state(.50).drive,1);assert.equal(sequenceStops.length,3);
});
test('scrubbing is deterministic, continuous and exactly reversible',()=>{
 for(let i=1;i<=1000;i++){const a=state((i-1)/1000),b=state(i/1000);for(const k of ['drive','rotationX','rotationY','rotationZ','scale'])assert.ok(Math.abs(a[k]-b[k])<.04,k);assert.deepEqual(b,state(i/1000));}
});
test('handoff holds the closed edge-on pose; lit geometry then turns and opens',()=>{
 const edge=state(.80);
 for(const p of [.78,.79,.81,.83,.84])for(const k of ['drive','rotationX','rotationY','rotationZ','scale'])assert.equal(state(p)[k],edge[k],k);
 assert.equal(edge.drive,0);assert.equal(edge.rotationY,-1.48);
 assert.ok(state(.90).rotationY>edge.rotationY);assert.ok(state(.94).drive>state(.90).drive);
});
test('the drive chapter actuates rather than consuming scroll on an idle object',()=>{
 assert.equal(state(.2).act,0);assert.ok(state(.2).drive>0);
 assert.equal(state(.48).act,1);assert.equal(state(1).act,2);
});
