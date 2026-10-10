import { PREVIEWS } from './preview-catalog.mjs';

const preview=document.querySelector('#preview');
const image=document.querySelector('#preview-image');
const video=document.querySelector('#preview-video');
const audio=document.querySelector('#preview-audio');
const play=document.querySelector('#preview-play');
const rail=document.querySelector('#preview-thumbnails');
const counter=document.querySelector('#preview-counter');
const previous=document.querySelector('#preview-previous');
const next=document.querySelector('#preview-next');
const original=document.querySelector('#preview-original');
const rows=[...document.querySelectorAll('[data-project]')];
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const mobile=matchMedia('(max-width: 700px)');
const positions=new Map();
let current=null,request=0,hoverTimer,suppressFocus=false;

function stopVideo(){
  video.onloadeddata=null;video.onerror=null;video.pause();
  video.hidden=true;video.removeAttribute('src');video.load();play.hidden=true;
}
function stopMedia(){
  stopVideo();audio.pause();audio.hidden=true;audio.removeAttribute('src');audio.load();
  document.querySelector('#preview-audio-label').hidden=true;
}
function close(){
  clearTimeout(hoverTimer);request++;stopMedia();preview.hidden=true;current=null;document.body.classList.remove("preview-open");
  image.removeAttribute('src');rail.replaceChildren();
  for(const row of rows){row.classList.remove('selected');row.querySelector('button').setAttribute('aria-pressed','false');}
}
function select(index){
  const collection=PREVIEWS[current];
  index=Math.max(0,Math.min(index,collection.items.length-1));
  positions.set(current,index);
  const item=collection.items[index],token=++request;
  stopVideo();image.src=item.image;image.alt=item.caption;image.hidden=false;
  document.querySelector('#preview-caption').textContent=item.caption;
  counter.textContent=`${index+1} / ${collection.items.length}`;
  previous.disabled=index===0;next.disabled=index===collection.items.length-1;
  original.hidden=!item.original;
  if(item.original){original.href=item.original;original.setAttribute('aria-label',`Open full-size image: ${item.caption}`);}
  for(const [i,button] of [...rail.children].entries()){
    button.setAttribute('aria-pressed',String(i===index));
  }
  if(item.film){
    video.onloadeddata=()=>{
      if(token!==request)return;
      image.hidden=true;video.hidden=false;play.hidden=false;play.textContent='Play';
      if(!reduced.matches)video.play().then(()=>{if(token===request)play.textContent='Pause';}).catch(()=>{});
    };
    video.onerror=()=>{if(token!==request)return;video.hidden=true;image.hidden=false;play.hidden=true;};
    video.src=item.film;video.load();
  }
}
function show(id){
  if(current===id&&!preview.hidden)return;
  current=id;request++;stopMedia();
  const collection=PREVIEWS[id];
  for(const row of rows){const selected=row.dataset.project===id;row.classList.toggle('selected',selected);row.querySelector('button').setAttribute('aria-pressed',String(selected));}
  document.querySelector('#preview-label').textContent=collection.label;
  const link=document.querySelector('#preview-link');link.href=`${id}.html`;link.textContent=`Explore ${id.toUpperCase()} ↗`;
  rail.replaceChildren();
  for(const [index,item] of collection.items.entries()){
    const button=document.createElement('button');button.type='button';
    button.setAttribute('aria-label',`Show ${index+1}: ${item.caption}`);
    button.title=item.caption;button.setAttribute('aria-pressed','false');
    const thumbnail=document.createElement('img');thumbnail.src=item.thumb;thumbnail.alt='';
    thumbnail.width=160;thumbnail.height=100;thumbnail.loading='lazy';thumbnail.decoding='async';
    button.append(thumbnail);
    if(item.film){const mark=document.createElement('span');mark.textContent='▶';mark.setAttribute('aria-hidden','true');button.append(mark);}
    button.addEventListener('click',()=>select(index));rail.append(button);
  }
  preview.hidden=false;document.body.classList.add("preview-open");
  if(mobile.matches)rows.find(row=>row.dataset.project===id).append(preview);
  else document.querySelector('main').append(preview);
  select(positions.get(id)??0);
  if(collection.audio){audio.src=collection.audio;audio.hidden=false;const label=document.querySelector('#preview-audio-label');label.textContent=collection.audioCaption;label.hidden=false;}
}
for(const row of rows){
  const name=row.querySelector('button');
  name.addEventListener('pointerenter',event=>{if(event.pointerType!=='mouse'||mobile.matches)return;clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>show(row.dataset.project),120);});
  name.addEventListener('pointerleave',()=>clearTimeout(hoverTimer));
  name.addEventListener('focus',()=>{if(!mobile.matches&&!suppressFocus)show(row.dataset.project);});
  name.addEventListener('click',()=>show(row.dataset.project));
}
previous.addEventListener('click',()=>select((positions.get(current)??0)-1));
next.addEventListener('click',()=>select((positions.get(current)??0)+1));
document.querySelector('#preview-close').addEventListener('click',()=>{
  const selected=rows.find(row=>row.dataset.project===current);close();suppressFocus=true;
  selected?.querySelector('button').focus({preventScroll:true});suppressFocus=false;
});
play.addEventListener('click',()=>{if(video.paused)video.play().then(()=>play.textContent='Pause').catch(()=>{});else{video.pause();play.textContent='Play';}});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){close();return;}
  if(!current||!preview.contains(document.activeElement)||document.activeElement===audio)return;
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
    event.preventDefault();select((positions.get(current)??0)+(event.key==='ArrowLeft'?-1:1));
  }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){video.pause();audio.pause();play.textContent='Play';}});
mobile.addEventListener('change',()=>{if(current){if(mobile.matches)rows.find(row=>row.dataset.project===current).append(preview);else document.querySelector('main').append(preview);}});
reduced.addEventListener('change',()=>{if(reduced.matches){video.pause();play.textContent='Play';}});
