(() => {
  'use strict';
  const score = document.querySelector('.scroll-score');
  score.classList.add('is-enhanced');
  const stage = document.querySelector('.instrument');
  const sculpture = document.querySelector('.sculpture');
  const slider = document.querySelector('#explosion');
  const pieces = [...document.querySelectorAll('[data-part]')];
  const labels = [...document.querySelectorAll('[data-label]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const names = pieces.map(p => p.dataset.part);
  const descriptions = ['Machined chassis', 'Coated optical assembly', 'Water / glass / air', 'Dished score cymbals', 'Articulated gripper', 'Faceted mineral core'];
  const phase = document.querySelector('.phase-name');
  const study = document.querySelector('.study-link');
  const cable = document.querySelector('.cable-routing');
  const paths = document.querySelector('.cable-paths');
  let geometry = [], progress = 0, frame = 0, lastStudy = -1, scrollStart = 0, scrollRange = 1;
  const clamp = n => Math.min(1, Math.max(0, n));
  const ease = n => { n = clamp(n); return n*n*(3-2*n); };
  const mix = (a,b,t) => a+(b-a)*t;
  const svgNS = 'http://www.w3.org/2000/svg';

  function measure() {
    const w = sculpture.clientWidth, h = sculpture.clientHeight;
    geometry = pieces.map(piece => {
      const style = getComputedStyle(piece);
      return {
        x: (piece.offsetLeft+piece.offsetWidth/2)/w*1600,
        y: (piece.offsetTop+piece.offsetHeight/2)/h*1000,
        width: piece.offsetWidth/w*1600,
        height: piece.offsetHeight/h*1000,
        input: ['x','y'].map(c => Number(style.getPropertyValue(`--in-${c}`))),
        output: ['x','y'].map(c => Number(style.getPropertyValue(`--out-${c}`)))
      };
    });
    scrollStart = score.getBoundingClientRect().top+window.scrollY;
    scrollRange = Math.max(1,score.offsetHeight-stage.offsetHeight);
    if(!reduced.matches)progress=clamp((window.scrollY-scrollStart)/scrollRange);
    paths.replaceChildren();
    // Release connections before the study layout. Cable spans retain their
    // shape and length, instead of stretching to follow unrelated positions.
    for (let i=1;i<5;i++) {
      const a=geometry[i].output, b=geometry[i+1].input;
      const dx=b[0]-a[0], dy=b[1]-a[1];
      const sag=[0,22,16,20,28][i];
      const h=Math.min(36,Math.hypot(dx,dy)*.24),hy=h*.3125;
      const middle=[(a[0]+b[0])/2,(a[1]+b[1])/2+sag];
      // Both connector tangents follow the camera-projected shaft axis.
      const d=`M ${a} C ${a[0]+h} ${a[1]+hy}, ${middle[0]-h} ${middle[1]-hy}, ${middle} C ${middle[0]+h} ${middle[1]+hy}, ${b[0]-h} ${b[1]-hy}, ${b}`;
      for (const [stroke,width,dash] of [['#3c0710',12,null],['url(#cable-red)',9,null],['#ee7680',.8,'1.1 2.6']]) {
        const path=document.createElementNS(svgNS,'path');
        path.setAttribute('d',d);path.setAttribute('fill','none');path.setAttribute('stroke',stroke);
        path.setAttribute('stroke-width',width);path.setAttribute('stroke-linecap','round');
        if(dash)path.setAttribute('stroke-dasharray',dash);
        paths.append(path);
      }
    }
    schedule();
  }

  function draw() {
    frame=0;
    const mobile=window.innerWidth<=900, p=progress;
    const toBench=ease((p-.07)/.14);
    const focusTime=clamp((p-.27)/.60)*6;
    const current=Math.min(5,Math.floor(focusTime));
    const handoff=current===5?0:ease((focusTime-current-.72)/.28);
    const active=handoff>.5?current+1:current;
    const focus=ease((p-.24)/.03)*(1-ease((p-.91)/.09));
    const caption=focus*(1-Math.sin(Math.PI*handoff)*.85);
    const unit=sculpture.clientWidth/1600;
    pieces.forEach((piece,i) => {
      const base=geometry[i];
      const benchX=mobile ? [450,1150][i%2] : [330,800,1270][i%3];
      const benchY=mobile ? 160+Math.floor(i/2)*355 : 350+Math.floor(i/3)*390;
      const benchScale=Math.min(1.25,(mobile?530:350)/base.width,300/base.height);
      // Dock the outgoing piece before bringing the next one forward. The
      // other four remain stationary; enlarged silhouettes never cross.
      const featured=i===current?1-ease(handoff*2):i===current+1?ease((handoff-.5)*2):0;
      const finalX=mix(170+i*252,mobile?800:640,featured);
      const finalY=mix(mobile?1900:900,mobile?550:520,featured);
      const dockScale=Math.min(160/base.width,140/base.height);
      const heroScale=Math.min((mobile?1350:750)/base.width,(mobile?1100:630)/base.height);
      const finalScale=mix(dockScale,heroScale,featured);
      let x=mix(base.x,benchX,toBench),y=mix(base.y,benchY,toBench),s=mix(1,benchScale,toBench);
      x=mix(x,finalX,focus);y=mix(y,finalY,focus);s=mix(s,finalScale,focus);
      piece.style.transform=`translate(${(x-base.x)*unit}px,${(y-base.y)*unit}px) scale(${s})`;
      piece.style.zIndex=i===active&&focus>.1?'3':'1';
      piece.style.opacity=String(mix(1,mix(.62,1,featured),focus));
    });
    cable.style.transform=`translateY(${ease(p/.07)*1100*unit}px)`;
    cable.style.opacity=String(1-ease(p/.065));
    stage.style.setProperty('--plate-opacity',1-ease(p/.09));
    stage.style.setProperty('--study-opacity',caption);
    stage.style.setProperty('--bench-opacity',toBench*(1-focus));
    stage.style.setProperty('--bench-shift',`${toBench*8}%`);
    const labelOpacity=(p<.14?1-ease((p-.07)/.055):ease((p-.15)/.055))*(1-focus);
    stage.style.setProperty('--label-opacity',labelOpacity);
    stage.classList.toggle('is-study',focus>.45);
    stage.classList.toggle('is-bench',toBench>.5);
    labels.forEach(label=>{label.style.pointerEvents=labelOpacity<.45?'none':'';label.tabIndex=labelOpacity<.45?-1:0;label.setAttribute('aria-hidden',String(labelOpacity<.45));});
    study.tabIndex=focus>.45?0:-1;
    study.setAttribute('aria-hidden',String(focus<=.45));
    if(lastStudy!==active) {
      lastStudy=active;study.href=`${names[active]}.html`;
      study.querySelector('strong').textContent=names[active].toUpperCase();
      study.querySelector('.study-number').textContent=`0${active+1} / 06`;
      study.querySelector('.study-description').textContent=descriptions[active]+' / inspect project';
    }
    phase.textContent=p<.025?'01 / Exploded':p<.10?'02 / Connections released':focus>.45?`04 / Study ${String(active+1).padStart(2,'0')}`:'03 / Detached specimens';
    document.querySelector('.scroll-track i').style.transform=`scaleX(${p})`;
    slider.value=Math.round(p*100);slider.setAttribute('aria-valuetext',phase.textContent);
    stage.dataset.progress=p.toFixed(4);
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(draw);}
  function onScroll(){if(!reduced.matches){progress=clamp((window.scrollY-scrollStart)/scrollRange);schedule();}}
  function jump(value){
    if(reduced.matches){progress=value;schedule();}
    else window.scrollTo({top:scrollStart+value*scrollRange,behavior:'instant'});
  }
  slider.addEventListener('input',()=>jump(Number(slider.value)/100));
  document.querySelectorAll('[data-end]').forEach(button=>button.addEventListener('click',()=>jump(Number(button.dataset.end)/100)));
  document.querySelectorAll('[data-jump]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();jump(Number(link.dataset.jump));}));
  document.querySelectorAll('a[href="#projects"]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();jump(0);labels[0].focus({preventScroll:true});}));
  labels.forEach((link,i)=>{
    for(const event of ['pointerenter','focus'])link.addEventListener(event,()=>pieces[i].classList.add('is-selected'));
    for(const event of ['pointerleave','blur'])link.addEventListener(event,()=>pieces[i].classList.remove('is-selected'));
  });
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',measure,{passive:true});
  reduced.addEventListener('change',()=>{progress=0;if(reduced.matches)window.scrollTo({top:0,behavior:'instant'});measure();onScroll();});
  measure();onScroll();
})();
