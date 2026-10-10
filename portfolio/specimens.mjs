import {SPECIMENS} from './specimen-catalog.mjs';


const $=s=>document.querySelector(s),tabs=$('.specimen-tabs'),video=$('.specimen-film'),poster=$('.specimen-poster'),host=$('.live-stage'),controls=$('.specimen-controls'),loadButton=$('[data-action="inspect"]'),modeButton=$('[data-action="film"]'),status=$('.specimen-status');
let selected=SPECIMENS[0],stage,selection=0,controller,loading=false;
const reduced=matchMedia('(prefers-reduced-motion:reduce)');
function audit(snapshot={}){const resources=performance.getEntriesByType('resource');snapshot={network:{geometryRequests:resources.filter(r=>r.name.includes('/specimens/')&&r.name.includes('geometry.bin')).length,stageModuleRequested:resources.some(r=>r.name.includes('specimen-stage.mjs'))},...snapshot};const output=$('#specimen-audit');if(output)output.textContent=JSON.stringify({project:selected.id,selection,loading,mode:stage?'interactive':'demonstration',...snapshot});}
function format(value,unit){return `${Number(value).toFixed(unit==='mm'?1:0)} ${unit}`;}
function syncControls(snapshot){
  if(!snapshot.state)return;
  for(const input of controls.querySelectorAll('[data-parameter]')){
    const definition=selected.controls?.find(c=>c[0]===input.dataset.parameter);if(!definition)continue;
    const value=snapshot.state[definition[0]];input.value=value;input.parentElement.querySelector('output').textContent=format(value,definition[5]);
  }
  const toggle=controls.querySelector('[data-toggle]');if(!toggle)return;
  const on=selected.id==='light'?!snapshot.state.rays:selected.id==='geo'?snapshot.state.reveal:snapshot.state.playing;
  toggle.setAttribute('aria-pressed',String(on));toggle.textContent=selected.id==='geo'?(on?'Replace housing':'Reveal drive'):selected.id==='light'?(on?'Show ray paths':'Hide ray paths'):(on?'Pause flow':'Play flow');
}
function stop3D(){selection++;controller?.abort();controller=undefined;stage?.dispose();stage=undefined;host.replaceChildren();loading=false;host.hidden=true;controls.hidden=true;loadButton.disabled=false;modeButton.hidden=true;status.textContent='';audit();}
function select(id,{focus=false}={}){
  const specimen=SPECIMENS.find(p=>p.id===id)||SPECIMENS[0];stop3D();selected=specimen;
  document.documentElement.dataset.specimen=id;
  for(const tab of tabs.querySelectorAll('button')){const active=tab.dataset.specimen===id;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;if(active&&focus)tab.focus();}
  $('.specimen-number').textContent=`${specimen.number} / ${specimen.project}`;$('.specimen-title').textContent=specimen.title;$('.specimen-subtitle').textContent=specimen.subtitle;$('.specimen-description').textContent=specimen.description;
  $('.specimen-facts').replaceChildren(...specimen.facts.map(f=>{const li=document.createElement('li');li.textContent=f;return li;}));$('.specimen-source').textContent=specimen.source;
  $('.project-link').href=specimen.details;$('.project-link').textContent=`Explore ${specimen.project} ↗`;
  poster.src=specimen.poster;poster.alt=specimen.subtitle;poster.hidden=false;video.pause();video.removeAttribute('src');video.load();video.hidden=true;
  if(specimen.film){video.poster=specimen.poster;video.src=specimen.film;video.hidden=false;video.load();if(!reduced.matches)void video.play().catch(()=>{});}
  loadButton.hidden=!specimen.interactive;$('.film-transport').hidden=!specimen.film;
  $('.view-note').textContent=specimen.interactive?'Recorded demonstration · select Inspect for controls':specimen.film?'Recorded movement study':'Original project render';
  $('[data-action="play"]').textContent=reduced.matches?'Play':'Pause';$('.film-progress').value=0;audit();
  history.replaceState(null,'',`#${id}`);
}
function buildControls(specimen){
  controls.replaceChildren();
  for(const [key,label,min,max,value,unit] of specimen.controls){
    const wrapper=document.createElement('label');wrapper.className='parameter';const caption=document.createElement('span');caption.textContent=label;
    const output=document.createElement('output');output.textContent=format(value,unit);
    const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=key==='frame'?'1':'.1';input.value=value;input.dataset.parameter=key;input.setAttribute('aria-label',label);
    input.addEventListener('input',()=>{const next=Number(input.value);output.textContent=format(next,unit);stage?.set({[key]:next,playing:false});});wrapper.append(caption,output,input);controls.append(wrapper);
  }
  const toggle=document.createElement('button');toggle.type='button';toggle.className='secondary-control';toggle.dataset.toggle='true';toggle.textContent=specimen.id==='geo'?'Reveal drive':specimen.id==='light'?'Hide ray paths':'Play flow';toggle.setAttribute('aria-pressed','false');
  toggle.addEventListener('click',()=>{const on=toggle.getAttribute('aria-pressed')!=='true';toggle.setAttribute('aria-pressed',String(on));if(specimen.id==='geo'){stage?.set({reveal:on});toggle.textContent=on?'Replace housing':'Reveal drive';}else if(specimen.id==='light'){stage?.set({rays:!on});toggle.textContent=on?'Show ray paths':'Hide ray paths';}else{stage?.set({playing:on});toggle.textContent=on?'Pause flow':'Play flow';}});controls.append(toggle);
  const note=document.createElement('p');note.className='control-hint';note.textContent=specimen.id==='elements'?'Recorded flow. View tilt rotates the whole specimen. Drag to orbit.':'Drag to orbit the specimen.';controls.append(note);
}
async function inspect(){
  if(loading||stage)return;loading=true;const token=selection,specimen=selected;controller=new AbortController();loadButton.disabled=true;status.textContent=`Loading ${specimen.project} specimen…`;const started=performance.now();audit();
  try{
    const {createSpecimen}=await import('./specimen-stage.mjs?v=working-specimens-1');if(token!==selection)return;
    host.hidden=false;const result=await createSpecimen(host,specimen.id,{signal:controller.signal,onChange:snapshot=>{if(token===selection){syncControls(snapshot);audit({...snapshot,startedMs:started});}}});
    if(token!==selection){result.dispose();return;}stage=result;loading=false;video.pause();video.hidden=true;poster.hidden=true;controls.hidden=false;buildControls(specimen);modeButton.hidden=false;
    status.textContent='';$('.view-note').textContent='Interactive specimen';$('.film-transport').hidden=true;
    audit({...stage.snapshot(),readyMs:performance.now()-started});
    if(matchMedia('(max-width:650px)').matches)$('.specimen-view').scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});
  }catch(error){if(token!==selection)return;loading=false;host.hidden=true;loadButton.disabled=false;status.textContent='3D could not open. The recorded demonstration is still available.';audit({error:error.message});}
}
tabs.addEventListener('click',event=>{const button=event.target.closest('[data-specimen]');if(button)select(button.dataset.specimen);});
tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const i=SPECIMENS.indexOf(selected),next=event.key==='Home'?0:event.key==='End'?5:Math.max(0,Math.min(5,i+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)));select(SPECIMENS[next].id,{focus:true});});
loadButton.addEventListener('click',inspect);modeButton.addEventListener('click',()=>select(selected.id));
$('[data-action="play"]').addEventListener('click',()=>{if(video.paused)void video.play().catch(()=>{});else video.pause();});
video.addEventListener('play',()=>{$('[data-action="play"]').textContent='Pause';});video.addEventListener('pause',()=>{$('[data-action="play"]').textContent='Play';});
video.addEventListener('timeupdate',()=>{if(Number.isFinite(video.duration)&&video.duration>0)$('.film-progress').value=video.currentTime/video.duration*100;});
$('.film-progress').addEventListener('input',event=>{video.pause();if(Number.isFinite(video.duration)&&video.duration>0)video.currentTime=Number(event.target.value)/100*video.duration;});
document.addEventListener('visibilitychange',()=>{if(document.hidden){video.pause();stage?.set({playing:false});}else if(!stage&&!reduced.matches&&selected.film)void video.play().catch(()=>{});});
window.addEventListener('pagehide',()=>{controller?.abort();stage?.dispose();});
window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(id!==selected.id&&SPECIMENS.some(p=>p.id===id))select(id);});
select(location.hash.slice(1)||'geo');
