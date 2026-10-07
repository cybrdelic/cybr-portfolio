export const PROJECT_STOPS = [
  {name:'geo', title:'GEO', at:.49, discipline:'Geometry / mechanisms', study:'ORBIT', lead:'From a single involute tooth to a serviceable 148-component wrist.', description:'A procedural geometry practice that makes the outside, the inside and the assembly sequence equally visible.', facts:['148 named CAD parts','331 service operations','CAD · STEP · GLB']},
  {name:'light', title:'LIGHT', at:.55, discipline:'Spectral transport / optics', study:'Light as a material', lead:'Metal highlights, absorbing glass and the atmosphere between objects.', description:'A native spectral renderer for wavelength-dependent transport, dispersive glass and caustics.', facts:['Native C++ engine','Python scene API','Spectral transport']},
  {name:'elements', title:'ELEMENTS', at:.60, discipline:'Material motion / identity', study:'Sigil 02', lead:'Fire, water and material motion, built around the Cybrdelic sigil.', description:'Seven retained films explore motion, identity and type. The project includes the source work and delivery records behind each study.', facts:['Seven films','Material motion','Identity & type']},
  {name:'song', title:'SONG', at:.70, discipline:'Composition / instrument design', study:'Lacuna', lead:'Music with a readable structure.', description:'Original scores, calibrated sample instruments and performances that can be traced back to each note. Lantern Steps is scored for piano and clean electric guitar.', facts:['Original scores','Calibrated instruments','33 events in Lantern Steps']},
  {name:'combat', title:'COMBAT', at:.78, discipline:'Authored motion / performance', study:'CONTACT', lead:'A character, a stage, and a sequence of authored movements.', description:'Rigging and performance studies, including a side-view leap and its retained capture records. Explore the films and motion work in the project.', facts:['Rigged character','Authored motion','Two retained films']},
  {name:'scenes', title:'SCENES', at:.86, discipline:'Architecture / terrain', study:'Constructed environments', lead:'Places built from geometry.', description:'Vaulted rooms, mineral pools, basalt shores, flooded crystal and forest water. The collection includes Quiet Observatory IV and its render anatomy.', facts:['Six recovered environments','Quiet Observatory IV','Native CPU rendering']}
];

export function nextProjectStop(progress, direction=1) {
  const stops=[0,...PROJECT_STOPS.map(project=>project.at),1];
  return direction<0 ? [...stops].reverse().find(at=>at<progress-.005)??0 : stops.find(at=>at>progress+.005)??1;
}

export function createInstrumentInterface({stage, root, jump, isReady, getTarget, reduced, onPaneChange}) {
  const route=document.createElement('nav');
  route.className='chapter-stops';route.setAttribute('aria-label','Inspect a project in 3D');
  route.innerHTML=PROJECT_STOPS.map((project,index)=>`<button type="button" data-route-project="${project.name}" aria-label="Inspect ${project.title} in 3D" disabled><span>0${index+1}</span>${project.title}</button>`).join('');
  stage.append(route);
  const dialog=document.createElement('dialog');
  dialog.className='project-pane';dialog.id='project-pane';dialog.setAttribute('aria-labelledby','pane-title');
  dialog.innerHTML=`<div class="pane-topline"><span>PROJECT / <span class="pane-index">01</span></span><button type="button" class="pane-close" aria-label="Close project details">CLOSE <span>×</span></button></div><div class="pane-body"><p class="pane-discipline"></p><h2 id="pane-title"></h2><p class="pane-study"></p><p class="pane-lead"></p><p class="pane-description"></p><ul class="pane-facts"></ul><div class="pane-actions"><button type="button" class="pane-inspect">Inspect in 3D <span>↗</span></button><a class="pane-project" href="geo.html">Open full project <span>↗</span></a></div></div><nav class="pane-pagination" aria-label="Browse project details"><button type="button" class="pane-prev">← <span>Previous</span></button><span class="pane-count">01 / 06</span><button type="button" class="pane-next"><span>Next</span> →</button></nav>`;
  document.body.append(dialog);
  let selected=0, opener, animation, captionAnimation, closing=false, activeProject=-1, savedScrollY=0;
  const query=selector=>dialog.querySelector(selector);
  function populate(index) {
    selected=(index+PROJECT_STOPS.length)%PROJECT_STOPS.length;
    const project=PROJECT_STOPS[selected];dialog.dataset.project=project.name;
    query('.pane-index').textContent=`0${selected+1}`;
    query('.pane-discipline').textContent=project.discipline;
    query('#pane-title').textContent=project.title;
    query('.pane-study').textContent=project.study;
    query('.pane-lead').textContent=project.lead;
    query('.pane-description').textContent=project.description;
    query('.pane-facts').replaceChildren(...project.facts.map(fact=>{const item=document.createElement('li');item.textContent=fact;return item;}));
    query('.pane-project').href=`${project.name}.html`;
    query('.pane-inspect').disabled=!isReady();
    query('.pane-count').textContent=`0${selected+1} / 06`;
    if(dialog.open&&!reduced.matches)query('.pane-body').animate([{opacity:.3},{opacity:1}],{duration:180,easing:'ease-out'});
  }
  function open(index, trigger) {
    animation?.cancel();closing=false;opener=trigger||document.activeElement;populate(index);
    if(!dialog.open){savedScrollY=window.scrollY;onPaneChange(true);dialog.showModal();}
    document.documentElement.classList.add('has-project-pane');
    if(!reduced.matches)animation=dialog.animate([{transform:'translateX(40px)',opacity:0},{transform:'translateX(0)',opacity:1}],{duration:340,easing:'cubic-bezier(.16,1,.3,1)'});
    query('.pane-close').focus({preventScroll:true});
  }
  async function close({inspect=false}={}) {
    if(!dialog.open||closing)return;
    closing=true;animation?.cancel();
    if(!reduced.matches){
      animation=dialog.animate([{transform:'translateX(0)',opacity:1},{transform:'translateX(24px)',opacity:0}],{duration:180,easing:'ease-in'});
      try{await animation.finished;}catch{}
      if(!closing)return;
    }
    dialog.close();document.documentElement.classList.remove('has-project-pane');closing=false;
    window.scrollTo({top:savedScrollY,behavior:'instant'});onPaneChange(false);
    opener?.focus({preventScroll:true});
    if(inspect){jump(PROJECT_STOPS[selected].at);route.querySelector(`[data-route-project="${PROJECT_STOPS[selected].name}"]`).focus({preventScroll:true});}
  }
  query('.pane-close').addEventListener('click',()=>close());
  query('.pane-inspect').addEventListener('click',()=>close({inspect:true}));
  query('.pane-prev').addEventListener('click',()=>populate(selected-1));
  query('.pane-next').addEventListener('click',()=>populate(selected+1));
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{const rect=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))close();});
  dialog.addEventListener('close',()=>document.documentElement.classList.remove('has-project-pane'));
  document.querySelectorAll('[data-label],.study-link').forEach(link=>{
    let pressedProject;
    link.addEventListener('pointerdown',()=>{pressedProject=link.dataset.label||link.dataset.project;});
    link.addEventListener('pointercancel',()=>{pressedProject=undefined;});
    link.setAttribute('aria-haspopup','dialog');link.setAttribute('aria-controls',dialog.id);
    link.addEventListener('click',event=>{
      if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      event.preventDefault();const name=event.detail>0&&pressedProject?pressedProject:link.dataset.label||link.dataset.project||'geo';pressedProject=undefined;
      open(PROJECT_STOPS.findIndex(project=>project.name===name),link);
    });
  });
  route.addEventListener('click',event=>{const button=event.target.closest('[data-route-project]');if(button)jump(PROJECT_STOPS.find(project=>project.name===button.dataset.routeProject).at);});
  route.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const buttons=[...route.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowLeft'?-1:1)));
    buttons[next].focus({preventScroll:true});jump(PROJECT_STOPS[next].at);
  });
  return {
    ready(){route.querySelectorAll('button').forEach(button=>button.disabled=false);query('.pane-inspect').disabled=false;stage.classList.add('interface-ready');},
    update(p,active){
      root.dataset.targetChapter=String(active+1);
      document.querySelector('[data-end="100"]').textContent=p>=.995?'Replay ↺':'Next →';
      stage.classList.toggle('is-inspecting',p>.44&&p<.93);
      document.querySelector('.study-link').dataset.project=PROJECT_STOPS[active].name;
      if(activeProject!==active){
        activeProject=active;
        captionAnimation?.cancel();
        if(p>.46&&p<.9&&!reduced.matches)captionAnimation=document.querySelector('.study-link').animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'});
        route.querySelectorAll('button').forEach(button=>{if(button.dataset.routeProject===PROJECT_STOPS[active].name)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');});
      }
      route.style.setProperty('--route-progress',String(p));
    },
    next(direction=1){const target=getTarget();jump(target>=.995&&direction>0?0:nextProjectStop(target,direction));}
  };
}
