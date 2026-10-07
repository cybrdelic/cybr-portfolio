// Logic smoke tests in a DOM stub; visual rendering is checked in the browser.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function harness(reduce){
  const events=new Map(),queue=new Map();let id=0;
  const element=(data={})=>({dataset:data,textContent:'',value:'50',attrs:{},
    addEventListener(type,fn){events.set(this.key+type,fn)},setAttribute(k,v){this.attrs[k]=v},
    getBoundingClientRect(){return {width:390,height:844,left:0,top:0}},setPointerCapture(){}});
  const ctx=new Proxy({getImageData:()=>({data:new Uint8ClampedArray(1200*360*4)})},{get:(o,k)=>k in o?o[k]:()=>{}});
  const canvas=element();canvas.key='canvas';canvas.getContext=()=>ctx;
  const modes=['orbit','sigil','tide'].map(mode=>{const e=element({liveMode:mode});e.key=mode;return e});
  const els={canvas};for(const key of ['.live-status','[data-live-pause]','[data-live-reset]','[data-live-scatter]','[data-live-force]','.force-value']){els[key]=element();els[key].key=key;}
  const stage=element();stage.querySelector=k=>els[k];stage.querySelectorAll=()=>modes;
  const document={hidden:false,querySelector:()=>stage,createElement:()=>canvas,addEventListener:(k,v)=>events.set(k,v),fonts:{load:()=>Promise.resolve()}};
  const preference={matches:reduce,addEventListener:(k,v)=>events.set('preference',v)};
  const sandbox={document,innerWidth:390,devicePixelRatio:1,matchMedia:()=>preference,
    Image:class{},requestAnimationFrame:fn=>{queue.set(++id,fn);return id},cancelAnimationFrame:id=>queue.delete(id),
    ResizeObserver:class{observe(){}},IntersectionObserver:class{observe(){}}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/live.js','utf8'),sandbox);
  const click=key=>events.get(key+'click')();
  return {canvas,stage,els,queue,events,click,step(){const entries=[...queue.values()];queue.clear();entries.forEach(fn=>fn(100));}};
}
const reduced=harness(true);
assert.equal(reduced.stage.dataset.paused,'true');assert.equal(reduced.queue.size,0);
reduced.click('tide');assert.equal(reduced.canvas.dataset.mode,'tide');assert.equal(reduced.queue.size,0);
reduced.click('[data-live-scatter]');assert.match(reduced.els['.live-status'].textContent,/Resume motion/);
reduced.click('[data-live-reset]');assert.equal(reduced.canvas.dataset.frame,'0');
reduced.click('[data-live-pause]');assert.equal(reduced.stage.dataset.paused,'false');assert.equal(reduced.queue.size,1);
reduced.step();assert.notEqual(reduced.canvas.dataset.frame,'0');
const running=harness(false);assert.equal(running.queue.size,0);
running.click('[data-live-pause]');assert.equal(running.queue.size,1);
running.click('[data-live-pause]');assert.equal(running.queue.size,0);
running.els['[data-live-force]'].value='100';running.events.get('[data-live-force]input')({target:running.els['[data-live-force]']});
assert.equal(running.els['.force-value'].textContent,'100%');
let prevented=false;running.events.get('canvaskeydown')({key:'ArrowRight',preventDefault(){prevented=true}});assert.ok(prevented);
console.log('PASS: reduced-motion startup, static mode switch, scatter/reset, resume, pause, force control, keyboard input.');
