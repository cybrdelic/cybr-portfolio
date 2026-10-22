// GPU-independent playback of the native water/fire composite.
export async function loadElementsMovieFallback({surface,reduced,status}){
 const base='./assets/instrument-elements-bake/composite-v3/';
 const response=await fetch(base+'manifest.json',{cache:'no-store'});
 if(!response.ok)throw Error('Composite manifest unavailable');
 const manifest=await response.json();
 if(!manifest.complete||!manifest.displayVideo)throw Error('Composite incomplete');
 if(surface.querySelector('.elements-composite-movie'))return()=>{};
 const video=document.createElement('video');video.className='elements-composite-movie';
 video.muted=true;video.loop=true;video.playsInline=true;video.preload='auto';
 video.setAttribute('aria-hidden','true');video.dataset.composite='native-water-fire';
 video.src=base+manifest.displayVideo;surface.append(video);
 const play=()=>{if(document.hidden||reduced.matches)video.pause();else video.play().catch(()=>{});};
 video.addEventListener('loadeddata',()=>{if(reduced.matches)video.currentTime=1.8;play();status.textContent='Baked water + fire preview. Interactive 3D is unavailable in this browser.';},{once:true});
 document.addEventListener('visibilitychange',play);reduced.addEventListener('change',play);
 video.addEventListener('error',()=>video.remove(),{once:true});play();
 return()=>{document.removeEventListener('visibilitychange',play);reduced.removeEventListener('change',play);video.pause();video.removeAttribute('src');video.load();video.remove();};
}
