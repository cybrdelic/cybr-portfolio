import test from 'node:test';
import assert from 'node:assert/strict';
import {installCanvasDemoRecorder} from './canvas-demo-recorder.mjs';

function fixture({manual=true,supported=true,throwStart=false,mimeTypes=['video/mp4'],stopEvent=true}={}){
 let time=0,nextTimer=1;const timers=new Map(),recorders=[],streams=[],urls=[],revoked=[],clicks=[],rates=[],events=[];
 class Node{
  constructor(tag,ownerDocument){this.tagName=tag;this.ownerDocument=ownerDocument;this.children=[];this.listeners=new Map();this.attributes={};this.hidden=false;}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parent=this;}}
  setAttribute(name,value){this.attributes[name]=value;}
  removeAttribute(name){delete this.attributes[name];delete this[name];}
  addEventListener(name,callback){this.listeners.set(name,callback);}
  removeEventListener(name,callback){if(this.listeners.get(name)===callback)this.listeners.delete(name);}
  click(){clicks.push(this);this.listeners.get('click')?.({type:'click'});}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
 }
 const doc=new Node('document');doc.ownerDocument=doc;doc.createElement=tag=>new Node(tag,doc);
 const container=new Node('div',doc),canvas=new Node('canvas',doc);
 canvas.captureStream=rate=>{
  rates.push(rate);const track={stops:0,requests:0,stop(){this.stops++;events.push('track-stop');}};
  if(manual)track.requestFrame=function(){this.requests++;events.push('frame');};
  const stream={track,getTracks:()=>[track],getVideoTracks:()=>[track]};streams.push(stream);return stream;
 };
 class Recorder{
  static isTypeSupported(type){return mimeTypes.includes(type);}
  constructor(stream,options){this.stream=stream;this.options=options;this.mimeType=options.mimeType||'video/webm';this.state='inactive';recorders.push(this);}
  start(interval){if(throwStart)throw new Error('Encoder rejected the stream.');this.state='recording';this.interval=interval;}
  emitData(size=4){this.ondataavailable?.({data:new Blob([new Uint8Array(size)],{type:this.mimeType})});}
  stop(){this.state='inactive';events.push('encoder-stop');if(stopEvent){this.emitData();this.onstop?.();}}
 }
 const runtime={performance:{now:()=>time},MediaRecorder:supported?Recorder:undefined,Blob,
  URL:{createObjectURL(blob){const url=`blob:test-${urls.length}`;urls.push({url,blob});return url;},revokeObjectURL:url=>revoked.push(url)},
  setTimeout(callback,delay){const id=nextTimer++;timers.set(id,{callback,at:time+delay});return id;},clearTimeout:id=>timers.delete(id)};
 const callbacks={starts:[],stops:[],closes:0};
 const recorder=installCanvasDemoRecorder({canvas,container,runtime,closeNotes:()=>callbacks.closes++,onStart:value=>callbacks.starts.push(value),onStop:value=>callbacks.stops.push(value)});
 const tick=value=>{time=value;for(const[id,timer]of [...timers])if(timer.at<=time){timers.delete(id);timer.callback();}};
 const frame=value=>{time=value;return recorder.recordFrame(value);};
 const ui=container.children[0],buttons=ui.children.filter(node=>node.tagName==='button'),download=ui.children.find(node=>node.tagName==='a');
 return {recorder,doc,container,canvas,runtime,timers,recorders,streams,urls,revoked,clicks,rates,events,callbacks,tick,frame,ui,buttons,download};
}

test('records only real canvas draws, with a 30 fps capture-request maximum',()=>{
 const f=fixture();assert.equal(f.recorder.start(),true);assert.equal(f.recorder.start(),false);
 assert.deepEqual(f.rates,[0]);assert.equal(f.recorders[0].interval,250);assert.equal(f.callbacks.closes,1);
 f.frame(0);f.frame(10);f.frame(20);f.frame(34);f.frame(50);f.frame(68);
 assert.equal(f.recorder.stats.renderedFrames,6);assert.equal(f.recorder.stats.captureRequests,3);
 assert.equal(f.streams[0].track.requests,3);assert.equal(f.recorder.stats.mode,'requested-rendered-frames');
 assert.equal(f.recorders[0].options.videoBitsPerSecond,16000000);f.recorder.dispose();
});

test('successful stop downloads a real video Blob once and then releases capture tracks',()=>{
 const f=fixture();f.recorder.start();f.frame(100);f.frame(400);f.recorder.stop();
 assert.equal(f.recorder.active,false);assert.equal(f.recorder.stats.phase,'complete');
 assert.equal(f.recorder.stats.elapsedMs,400);assert.equal(f.urls.length,1);assert.equal(f.urls[0].blob.type,'video/mp4');
 assert.equal(f.download.hidden,false);assert.match(f.download.download,/\.mp4$/);assert.equal(f.clicks.filter(node=>node===f.download).length,1);
 assert.equal(f.streams[0].track.stops,1);assert.deepEqual(f.events.slice(-2),['encoder-stop','track-stop']);
 f.recorder.stop();assert.equal(f.callbacks.stops.length,1);assert.equal(f.timers.size,0);f.recorder.dispose();
});

test('fallback captures at no more than 30 fps and chooses a supported WebM codec',()=>{
 const f=fixture({manual:false,mimeTypes:['video/webm;codecs=vp8']});f.recorder.start();
 assert.deepEqual(f.rates,[0,30]);assert.equal(f.streams[0].track.stops,1);
 assert.equal(f.recorder.stats.mode,'browser-30fps-maximum');f.frame(100);f.recorder.stop();
 assert.equal(f.recorder.stats.captureRequests,0);assert.match(f.download.download,/\.webm$/);assert.equal(f.streams[1].track.stops,1);f.recorder.dispose();
});

test('duration timer stops even if the parent renderer goes idle',()=>{
 const f=fixture();f.recorder.start();f.frame(10);f.tick(12000);
 assert.equal(f.recorder.stats.phase,'complete');assert.equal(f.recorder.stats.elapsedMs,12000);assert.equal(f.recorder.active,false);f.recorder.dispose();
});

test('wall-clock capture interval and observed rendered span are reported separately',()=>{
 const f=fixture();f.recorder.start();f.frame(1000);f.frame(1500);f.frame(4000);f.tick(12000);
 assert.equal(f.recorder.stats.elapsedMs,12000);assert.equal(f.recorder.stats.firstRenderedMs,1000);
 assert.equal(f.recorder.stats.lastRenderedMs,4000);assert.equal(f.recorder.stats.renderedSpanMs,3000);
 assert.doesNotMatch(f.ui.children.find(node=>node.attributes.role==='status').textContent,/Saved 12\.0 s/);f.recorder.dispose();
});

test('new recordings revoke old Blob URLs and never reuse previous chunks',()=>{
 const f=fixture();f.recorder.start();f.frame(30);f.recorder.stop();
 f.recorder.start();assert.deepEqual(f.revoked,['blob:test-0']);assert.equal(f.download.hidden,true);
 f.frame(80);f.recorder.stop();assert.equal(f.urls[1].blob.size,4);f.recorder.dispose();assert.deepEqual(f.revoked,['blob:test-0','blob:test-1']);
});

test('unsupported API and encoder startup failures are bounded and clean',()=>{
 const unavailable=fixture({supported:false});assert.equal(unavailable.recorder.start(),false);assert.equal(unavailable.buttons[0].disabled,true);unavailable.recorder.dispose();
 const broken=fixture({throwStart:true});assert.equal(broken.recorder.start(),false);assert.equal(broken.recorder.stats.phase,'error');
 assert.equal(broken.streams[0].track.stops,1);assert.equal(broken.timers.size,0);assert.equal(broken.urls.length,0);broken.recorder.dispose();
});

test('context loss does not download a misleading partial video',()=>{
 const f=fixture();f.recorder.start();f.frame(50);f.canvas.listeners.get('webglcontextlost')();
 assert.equal(f.recorder.stats.phase,'error');assert.match(f.recorder.stats.error,/context was lost/);assert.equal(f.urls.length,0);assert.equal(f.streams[0].track.stops,1);f.recorder.dispose();
});

test('empty capture is rejected; a missing stop event times out and releases the stream',()=>{
 const empty=fixture();empty.recorder.start();empty.recorder.stop();assert.equal(empty.recorder.stats.phase,'error');assert.equal(empty.urls.length,0);empty.recorder.dispose();
 const hung=fixture({stopEvent:false});hung.recorder.start();hung.frame(100);hung.recorder.stop();hung.tick(5200);
 assert.equal(hung.recorder.stats.phase,'error');assert.match(hung.recorder.stats.error,/did not finish/);assert.equal(hung.recorder.stats.elapsedMs,100);assert.equal(hung.streams[0].track.stops,1);hung.recorder.dispose();
});

test('dispose cleans timers, listeners, tracks and controls without triggering download',()=>{
 const f=fixture();f.recorder.start();f.frame(200);f.recorder.dispose();f.recorder.dispose();
 assert.equal(f.recorder.stats.phase,'disposed');assert.equal(f.timers.size,0);assert.equal(f.doc.listeners.size,0);assert.equal(f.canvas.listeners.size,0);
 assert.equal(f.streams[0].track.stops,1);assert.equal(f.container.children.length,0);assert.equal(f.urls.length,0);assert.equal(f.callbacks.stops.length,0);
});

test('hiding the document finishes the visible capture instead of recording background work',()=>{
 const f=fixture();f.recorder.start();f.frame(40);f.doc.hidden=true;f.doc.listeners.get('visibilitychange')();
 assert.equal(f.recorder.stats.phase,'complete');assert.equal(f.recorder.active,false);f.recorder.dispose();
});

test('output creation failure is reported after tracks are released',()=>{
 const f=fixture();f.runtime.URL.createObjectURL=()=>{throw new Error('Blob storage is unavailable.');};
 f.recorder.start();f.frame(40);f.recorder.stop();assert.equal(f.recorder.stats.phase,'error');
 assert.match(f.recorder.stats.error,/Blob storage/);assert.equal(f.streams[0].track.stops,1);assert.equal(f.callbacks.stops.length,1);f.recorder.dispose();
});

test('an unavailable automatic download retains the explicit video download link',()=>{
 const f=fixture();f.download.click=()=>{throw new Error('Automatic download was blocked.');};
 f.recorder.start();f.frame(40);f.recorder.stop();assert.equal(f.recorder.stats.phase,'complete');
 assert.equal(f.download.hidden,false);assert.match(f.download.href,/^blob:/);assert.equal(f.callbacks.stops.length,1);f.recorder.dispose();
});
