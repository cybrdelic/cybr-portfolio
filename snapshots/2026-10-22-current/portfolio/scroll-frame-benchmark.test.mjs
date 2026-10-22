import test from 'node:test';
import assert from 'node:assert/strict';
import {createScrollFrameBenchmark} from './scroll-frame-benchmark.mjs';

function fixture(t,{durationMs=20000}={}){
 let time=0,id=0;const callbacks=new Map(),scrolls=[],button={},output={dataset:{}},journey={offsetHeight:8000};
 const values={performance:{now:()=>time},document:{hidden:false},innerHeight:1000,scrollY:87,
  requestAnimationFrame(fn){const next=++id;callbacks.set(next,fn);return next;},cancelAnimationFrame(id){callbacks.delete(id);},scrollTo(options){scrolls.push(options);}};
 const originals=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(values))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 const benchmark=createScrollFrameBenchmark({button,output,journey,closeNotes(){},durationMs});
 t.after(()=>{benchmark.dispose();for(const [key,descriptor] of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 return {benchmark,button,output,scrolls,start(){button.onclick();},
  record(at,chapter='geo',ready=true){time=at;benchmark.record(at,chapter,ready);},
  drive(at){time=at;const [next,callback]=callbacks.entries().next().value;callbacks.delete(next);callback(at);},
  finish(){this.drive(durationMs);return benchmark.result;}};
}

test('intentional holds do not appear as motion stalls even when no draw occurs during the hold',t=>{
 const f=fixture(t);f.start();f.record(0);f.record(16);
 f.record(1000);f.record(1016); // forward starts after a 984 ms idle gap
 f.record(11000,'scenes');f.record(11016,'scenes'); // reverse after a hold with no redraw
 const r=f.finish();assert.equal(r.cadence.frames,2);assert.equal(r.cadence.maxMs,16);assert.equal(r.cadence.over25Ms,0);
 assert.equal(r.chapters.geo.frames,1);assert.equal(r.chapters.scenes.frames,1);
 assert.deepEqual(r.missingChapters,['light','material','elements','song','combat']);
 assert.match(r.measurement,/first draw of each leg are excluded/);
});

test('draws during holds and exact segment boundaries are excluded without hiding genuine 100 ms motion stalls',t=>{
 const f=fixture(t);f.start();
 f.record(1000);f.record(1016);f.record(1116,'light');
 f.record(10000,'scenes');f.record(10500,'scenes'); // both endpoint hold draws
 f.record(11000,'scenes');f.record(11016,'scenes');f.record(11116,'combat');
 const r=f.finish();assert.equal(r.cadence.frames,4);assert.equal(r.cadence.maxMs,100);assert.equal(r.cadence.over25Ms,2);
 assert.equal(r.chapters.light.maxMs,100);assert.equal(r.chapters.combat.maxMs,100);
});

test('first samples and hold samples still report unready coverage; missing scenes cannot look like a pass',t=>{
 const f=fixture(t);f.start();f.record(0,'geo',false);f.record(1000,'geo',false);f.record(1016,'geo',false);
 f.record(10000,'scenes',false);f.record(11000,'scenes',false);f.record(11016,'scenes',true);
 const r=f.finish();assert.equal(r.unreadyFrames,5);assert.equal(r.cadence.frames,2);
 assert.equal(r.missingChapters.length,5);assert.match(r.measurement,/unready frames are not a pass/);
});

test('idle RAF cadence excludes entering a different hold segment',t=>{
 const f=fixture(t);f.start();f.drive(0);f.drive(16);f.drive(1000);f.drive(10000);f.drive(10016);
 const r=f.finish();assert.equal(r.idleRafCadence.frames,2);assert.equal(r.idleRafCadence.maxMs,16);
 assert.equal(r.cadence.frames,0);assert.equal(r.cadence.maxMs,null);assert.equal(r.missingChapters.length,7);
});

test('restart resets prior segment identity and scene coverage',t=>{
 const f=fixture(t,{durationMs:1000});f.start();f.record(50);f.record(66);f.finish();
 f.start();f.record(1050,'song');f.record(1066,'song');f.drive(2000);
 const r=f.benchmark.result;assert.equal(r.cadence.frames,1);assert.equal(r.cadence.maxMs,16);
 assert.deepEqual(Object.keys(r.chapters),['song']);assert.equal(r.unreadyFrames,0);
});
