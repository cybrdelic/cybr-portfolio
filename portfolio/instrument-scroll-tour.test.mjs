import test from 'node:test';
import assert from 'node:assert/strict';
import {createScrollTour} from './instrument-scroll-tour.mjs';

function fixture(){
  const states=[],viewport={scrollY:80,scrollTo({top}){this.scrollY=top;}},root={offsetHeight:8200,getBoundingClientRect(){return{top:80-viewport.scrollY};}},stage={offsetHeight:1000};
  let reduced=false,paused=false;
  const tour=createScrollTour({root,stage,viewport,onProgress:p=>states.push(p),isReduced:()=>reduced,isPaused:()=>paused});tour.measure();
  return{tour,viewport,root,stage,states,reduced:value=>reduced=value,paused:value=>paused=value};
}
test('ordinary page coordinates advance intermediate choreography and reverse without chapter quantization',()=>{
  const h=fixture();
  for(const p of [.07,.23,.473,.617,.34,0]){h.viewport.scrollY=80+7200*p;h.tour.scroll();}
  h.states.forEach((p,i)=>assert.ok(Math.abs(p-[.07,.23,.473,.617,.34,0][i])<1e-12));
  h.viewport.scrollY=-100;h.tour.scroll();assert.equal(h.states.at(-1),0);
  h.viewport.scrollY=20000;h.tour.scroll();assert.equal(h.states.at(-1),1);
});
test('a control jump reanchors the document so the next native scroll continues from that pose',()=>{
  const h=fixture();h.tour.jump(.6);assert.equal(h.viewport.scrollY,4400);
  h.viewport.scrollY+=360;h.tour.scroll();assert.equal(h.states.at(-1),.65);
});
test('mobile orientation remeasures the sticky travel while preserving its current fraction',()=>{
  const h=fixture();h.tour.jump(.617);h.root.offsetHeight=390*8.2;h.stage.offsetHeight=390;
  h.viewport.scrollY=2400; // The browser clamped Y before its resize event.
  h.tour.resize({preserve:true});assert.ok(Math.abs(h.tour.progress()-.617)<1e-12);
  h.viewport.scrollY-=h.tour.snapshot().distance*.1;h.tour.scroll();assert.ok(Math.abs(h.states.at(-1)-.517)<1e-12);
});
test('modal and reduced-motion pauses retain explicit controls and resume the page coordinate',()=>{
  const h=fixture();h.paused(true);h.viewport.scrollY=3680;h.tour.scroll();assert.equal(h.states.length,0);
  h.paused(false);h.tour.scroll();assert.equal(h.states.at(-1),.5);
  h.reduced(true);h.viewport.scrollY=4400;h.tour.scroll();assert.equal(h.states.at(-1),.5);
  h.tour.jump(.8);assert.equal(h.states.at(-1),.8);assert.equal(h.viewport.scrollY,4400);
});
