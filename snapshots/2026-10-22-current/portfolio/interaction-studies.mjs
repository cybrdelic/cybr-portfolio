import {projects,nearestIndex} from './interaction-data.mjs';

const $=s=>document.querySelector(s),reduced=matchMedia('(prefers-reduced-motion: reduce)');
const imageFor=p=>`assets/${p.image}`;
const errorBox=$('.asset-error');
document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement){errorBox.hidden=false;errorBox.textContent=`Image failed to load: ${event.target.getAttribute('src')}`;}},true);

// Each concept is independently addressable; switching never replaces the homepage.
function route(){
 const selected=['seam','strip','detail'].includes(location.hash.slice(1))?location.hash.slice(1):'seam';
 for(const section of document.querySelectorAll('main>section'))section.hidden=section.id!==selected;
 for(const link of document.querySelectorAll('.mast nav a')){
  if(link.hash===`#${selected}`)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
 }
 if(selected==='strip')requestAnimationFrame(()=>select(active,false));
}
$('#reveal').addEventListener('input',event=>{
 const value=event.target.value;$('.comparison').style.setProperty('--split',`${value}%`);
 event.target.setAttribute('aria-valuetext',`${value} percent exterior`);
});

// Native horizontal scrolling owns touch/trackpad inertia and scroll snapping.
// Mouse dragging adds the same physical gesture without a permanent animation loop.
const strip=$('.strip-window'),track=$('.strip-track');
track.innerHTML=projects.map((p,i)=>`<figure class="strip-card"><img src="${imageFor(p)}" alt="${p.title} — ${p.category}" width="1280" height="960" loading="lazy" decoding="async" draggable="false"><small>0${i+1} / ${p.category}</small></figure>`).join('');
const cards=[...track.children];
$('.ticks').innerHTML=projects.map((p,i)=>`<button aria-label="Select ${p.title}" aria-pressed="false" data-index="${i}">0${i+1}</button>`).join('');
let active=0,scrollFrame=0,snapTimer,drag=null;
function centers(){const origin=strip.getBoundingClientRect().left;return cards.map(card=>card.getBoundingClientRect().left-origin+strip.scrollLeft+card.offsetWidth/2);}
function describe(index){
 active=index;const p=projects[index];$('#strip-number').textContent=`0${index+1} / 06`;$('#strip-title').textContent=p.title;$('#strip-category').textContent=p.category;$('#strip-link').href=`${p.id}.html`;
 for(const [i,button] of [...$('.ticks').children].entries())button.setAttribute('aria-pressed',String(i===index));
 $('#prev').disabled=index===0;$('#next').disabled=index===projects.length-1;
}
function select(index,animate=true){
 index=Math.max(0,Math.min(projects.length-1,index));describe(index);
 strip.scrollTo({left:centers()[index]-strip.clientWidth/2,behavior:animate&&!reduced.matches?'smooth':'instant'});
}
strip.addEventListener('scroll',()=>{
 if(!scrollFrame)scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;describe(nearestIndex(centers(),strip.scrollLeft+strip.clientWidth/2));});
},{passive:true});
strip.addEventListener('pointerdown',event=>{
 if(event.pointerType!=='mouse'||event.button!==0)return;
 clearTimeout(snapTimer);drag={x:event.clientX,left:strip.scrollLeft};strip.setPointerCapture(event.pointerId);strip.classList.add('dragging');
});
strip.addEventListener('pointermove',event=>{if(drag)strip.scrollLeft=drag.left+drag.x-event.clientX;});
function release(){if(!drag)return;drag=null;strip.classList.remove('dragging');select(nearestIndex(centers(),strip.scrollLeft+strip.clientWidth/2));}
strip.addEventListener('pointerup',release);strip.addEventListener('pointercancel',release);strip.addEventListener('lostpointercapture',release);
strip.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();select(active+(event.key==='ArrowRight'?1:-1));}if(event.key==='Home'||event.key==='End'){event.preventDefault();select(event.key==='Home'?0:5);}});
$('#prev').onclick=()=>select(active-1);$('#next').onclick=()=>select(active+1);
$('.ticks').onclick=event=>{const button=event.target.closest('[data-index]');if(button)select(+button.dataset.index);};

// One moving image owns the entire handoff. Text is never scaled or duplicated.
const grid=$('.project-grid'),dialog=$('#project-dialog'),hero=$('#detail-image');
grid.innerHTML=projects.map((p,i)=>`<button class="project-card" data-project="${i}" aria-label="Open ${p.title} study"><figure><img src="${imageFor(p)}" alt="${p.title} — ${p.category}" width="1280" height="960" loading="lazy" decoding="async"></figure><span class="card-caption"><strong>${p.title}</strong><span>0${i+1} ↗</span></span></button>`).join('');
let source=null,busy=false,animation=null,pendingClose=false,oldOverflow='';
function bounds(element){const r=element.getBoundingClientRect();return {left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`};}
async function handoff(from,to){
 if(reduced.matches)return;
 const first=bounds(from),last=bounds(to),ghost=from.cloneNode();
 ghost.removeAttribute('id');ghost.className='shared-image';ghost.alt='';ghost.setAttribute('aria-hidden','true');Object.assign(ghost.style,first);dialog.append(ghost);
 from.style.visibility='hidden';to.style.visibility='hidden';
 try{
  animation=ghost.animate([first,last],{duration:620,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'});
  await animation.finished;
 }catch{ /* Resize/reduced-motion changes settle immediately at the live endpoint. */ }
 finally{to.style.visibility='';from.style.visibility='';ghost.remove();animation=null;}
}
async function openProject(index,button){
 if(busy||dialog.open)return;busy=true;source=button;
 const p=projects[index];hero.src=imageFor(p);hero.alt=`${p.title} — ${p.category}`;
 $('#detail-title').textContent=p.title;$('#detail-description').textContent=p.description;$('#detail-index').textContent=`0${index+1} / ${p.category}`;$('#detail-link').href=`${p.id}.html`;
 try{
  await hero.decode();oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();
  await handoff(button.querySelector('img'),hero);$('#close-detail').focus({preventScroll:true});
 }catch(error){errorBox.hidden=false;errorBox.textContent=`Unable to open ${p.title}: ${error.message}`;document.body.style.overflow=oldOverflow;}
 finally{busy=false;if(pendingClose){pendingClose=false;void closeProject();}}
}
async function closeProject(){
 if(busy){pendingClose=true;return;}if(!dialog.open)return;busy=true;
 try{await handoff(hero,source.querySelector('img'));}
 finally{dialog.close();document.body.style.overflow=oldOverflow;source.focus({preventScroll:true});busy=false;}
}
grid.onclick=event=>{const button=event.target.closest('[data-project]');if(button)void openProject(+button.dataset.project,button);};
$('#close-detail').onclick=()=>void closeProject();dialog.addEventListener('cancel',event=>{event.preventDefault();void closeProject();});
window.addEventListener('resize',()=>{animation?.cancel();clearTimeout(snapTimer);snapTimer=setTimeout(()=>{if(!$('#strip').hidden)select(active,false);},100);});
reduced.addEventListener('change',()=>animation?.cancel());
window.addEventListener('hashchange',route);describe(0);route();
