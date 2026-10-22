/* Site-native kinetic studies. Damped springs, procedural targets, Canvas 2D.
   These are interactive visual studies, not the source projects' solvers. */
(() => {
  const stage = document.querySelector('.live-stage');
  if (!stage) return;
  const canvas = stage.querySelector('canvas');
  const ctx = canvas.getContext('2d', {alpha:false});
  const status = stage.querySelector('.live-status');
  if (!ctx) { status.textContent='Live drawing is unavailable. The project archive remains below.'; return; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pauseButton=stage.querySelector('[data-live-pause]');
  const modeButtons=[...stage.querySelectorAll('[data-live-mode]')];
  const descriptions={orbit:'A torus-knot field. Drag to bend its path.',sigil:'Cybrdelic Sigil, drawn with moving points. Drag to scatter it.',tide:'A travelling wave surface. Drag to disturb the field.'};
  const colors={orbit:[230,166,119],sigil:[141,207,238],tide:[119,230,196]};
  let w=1,h=1,dpr=1,mode='orbit',t=0,last=0,raf=0,visible=true,paused=true;
  let points=[],logo=[],rotation=0,turn=0,energy=0,quality=23*Math.floor((innerWidth<700?700:1400)/23);
  const buckets=Array.from({length:12},()=>[]);
  const pointer={x:0,y:0,active:false,down:false};
  let projected=[],forceGain=.5;
  const TAU=Math.PI*2;

  function makeLogo(artwork){
    const mask=document.createElement('canvas'); mask.width=1200; mask.height=360;
    const c=mask.getContext('2d');
    c.drawImage(artwork,400,425,1120,500,200,1,800,357);
    const data=c.getImageData(0,0,1200,360).data;
    logo=[];
    for(let y=0;y<360;y+=3) for(let x=15;x<1185;x+=3) if(data[(y*1200+x)*4]>130) logo.push([(x-600)/420,(180-y)/420]);
  }
  function initialize(){
    points=Array.from({length:quality},(_,i)=>{
      const a=i/quality*TAU;
      return {x:Math.cos(a)*1.2,y:Math.sin(a)*.8,z:Math.sin(a*3)*.2,vx:0,vy:0,vz:0,seed:i*2.39996323};
    });
    projected=points.map(()=>({x:0,y:0,z:0,size:1}));
  }
  function resize(){
    const rect=canvas.getBoundingClientRect();w=rect.width;h=rect.height;dpr=1;
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    if(paused)render(0);
  }
  function target(i){
    const u=i/quality*TAU;
    if(mode==='sigil'&&logo.length){
      const p=logo[(i*37)%logo.length];
      return [p[0],p[1]+Math.sin(t*.7+p[0]*3)*.018,Math.sin(i*1.618)*.05+Math.sin(p[0]*3+t)*.04];
    }
    if(mode==='tide'){
      const cols=70, x=(i%cols)/(cols-1)*3-1.5, z=Math.floor(i/cols)/(quality/cols)*2.1-1.05;
      return [x,Math.sin(x*3+t*1.3+z*2)*.16+Math.cos(z*5-t*.8)*.13,z];
    }
    // A (2,3) torus knot; cross-section points form a tubular filament bundle.
    const tube=i%23/23*TAU, a=Math.floor(i/23)/Math.ceil(quality/23)*TAU;
    const r=.78+.28*Math.cos(3*a+t*.13);
    return [(r+.095*Math.cos(tube))*Math.cos(2*a), (r+.095*Math.cos(tube))*Math.sin(2*a),.34*Math.sin(3*a+t*.13)+.095*Math.sin(tube)];
  }
  function render(dt){
    if(!w||!h)return;
    const k=dt?Math.min(dt*60,2):0;
    if(k){t+=dt;rotation+=dt*.075;turn+=(pointer.active?(pointer.x/w-.5)*.24-turn: -turn)*.025;energy*=Math.pow(.955,k);}
    ctx.fillStyle='#081719';ctx.fillRect(0,0,w,h);
    const small=w<650, scale=Math.min(w*(small?.32:mode==='tide'?.18:.25),h*.34)*(mode==='sigil'?1.4:1),cx=w*(small?.5:.64),cy=h*(small?.43:.45);
    const angle=mode==='sigil'?turn*.5:rotation*.5+turn, ca=Math.cos(angle),sa=Math.sin(angle);
    const tilt=mode==='tide'?-.7:mode==='sigil'?.02:-.25,ct=Math.cos(tilt),st=Math.sin(tilt);
    const forceRadius=Math.min(w,h)*.21;
    const damping=Math.pow(.87,k);
    buckets.forEach(bucket=>bucket.length=0);
    for(let i=0;i<quality;i++){
      const p=points[i],targetPoint=target(i),screen=projected[i];
      if(k){
        let fx=0,fy=0;
        if(pointer.active){
          const dx=screen.x-pointer.x,dy=screen.y-pointer.y,dist=Math.hypot(dx,dy)+1;
          const f=Math.max(0,1-dist/forceRadius)*(pointer.down?.11:.018)*forceGain*2;
          fx=dx/dist*f;fy=-dy/dist*f;
        }
        const spring=.013;
        p.vx=(p.vx+(targetPoint[0]-p.x)*spring*k+fx*k)*damping;
        p.vy=(p.vy+(targetPoint[1]-p.y)*spring*k+fy*k)*damping;
        p.vz=(p.vz+(targetPoint[2]-p.z)*spring*k+Math.sin(p.seed+t)*energy*.008*k)*damping;
        p.x+=p.vx*k;p.y+=p.vy*k;p.z+=p.vz*k;
      }
      const rx=p.x*ca+p.z*sa,rz=-p.x*sa+p.z*ca,ry=p.y*ct-rz*st,depth=p.y*st+rz*ct;
      const perspective=3.8/(3.8-depth);
      screen.x=cx+rx*scale*perspective;screen.y=cy-ry*scale*perspective;screen.z=depth;screen.size=(.7+(depth+1)*.45)*perspective*(small?.8:1);
      buckets[Math.max(0,Math.min(11,Math.floor((depth+1.8)/.3)))].push(i);
    }
    // Depth-bucketed points and filaments: far layers dim, front layers bright.
    const color=colors[mode];
    for(let layer=0;layer<12;layer++){
      const lo=-1.8+layer*.3,hi=lo+.3,brightness=.34+layer*.07;
      ctx.fillStyle=`rgb(${color.map(c=>Math.min(255,Math.round(c*brightness))).join(',')})`;
      ctx.beginPath();
      for(const i of buckets[layer]){const p=projected[i];ctx.moveTo(p.x+p.size,p.y);ctx.arc(p.x,p.y,p.size,0,TAU);}
      ctx.fill();
    }
    if(mode!=='sigil'){
      ctx.lineWidth=.45;ctx.strokeStyle=mode==='tide'?'#8adfbe35':'#e9bc8c33';ctx.beginPath();
      const jump=mode==='tide'?70:23;
      for(let i=0;i<(mode==='tide'?quality-jump:quality);i++){const a=projected[i],b=projected[(i+jump)%quality];if(Math.hypot(a.x-b.x,a.y-b.y)<scale*.25){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}}
      ctx.stroke();
    }
    if(pointer.active){ctx.beginPath();ctx.strokeStyle='#e1e5d84d';ctx.lineWidth=1;ctx.arc(pointer.x,pointer.y,pointer.down?34:18,0,TAU);ctx.stroke();}
    canvas.dataset.frame=String(Math.round(t*60));
    canvas.dataset.mode=mode;
  }
  function frame(now){raf=0;if(paused||!visible||document.hidden){last=0;return;}if(last&&now-last<32){raf=requestAnimationFrame(frame);return;}const dt=last?Math.min((now-last)/1000,.05):1/30;last=now;render(dt);raf=requestAnimationFrame(frame);}
  function start(){if(!raf&&!paused&&visible&&!document.hidden)raf=requestAnimationFrame(frame);}
  function sync(){pauseButton.textContent=paused?'Start motion':'Pause motion';pauseButton.setAttribute('aria-pressed',String(paused));stage.dataset.paused=String(paused);}
  function settle(){for(let i=0;i<quality;i++){const p=target(i);Object.assign(points[i],{x:p[0],y:p[1],z:p[2],vx:0,vy:0,vz:0});}render(0);}
  function choose(next){mode=next;modeButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.liveMode===mode)));status.textContent=descriptions[mode];if(paused)settle();else start();}
  modeButtons.forEach(b=>b.addEventListener('click',()=>choose(b.dataset.liveMode)));
  pauseButton.addEventListener('click',()=>{paused=!paused;sync();if(paused){cancelAnimationFrame(raf);raf=0;last=0;}else start();});
  stage.querySelector('[data-live-reset]').addEventListener('click',()=>{t=0;rotation=0;energy=0;pointer.active=false;settle();status.textContent='Field reset. '+descriptions[mode];});
  stage.querySelector('[data-live-scatter]').addEventListener('click',()=>{
    points.forEach(p=>{p.x+=Math.cos(p.seed)*.7;p.y+=Math.sin(p.seed)*.7;p.z+=Math.sin(p.seed*1.7)*.5;});energy=1;render(0);status.textContent=paused?'Scattered. Resume motion to reassemble.':'Scattered points return to their field.';start();
  });
  stage.querySelector('[data-live-force]').addEventListener('input',e=>{forceGain=Number(e.target.value)/100;stage.querySelector('.force-value').textContent=e.target.value+'%';});
  function move(e){const r=canvas.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;pointer.active=true;}
  canvas.addEventListener('pointermove',move);
  canvas.addEventListener('pointerdown',e=>{pointer.down=true;move(e);canvas.setPointerCapture(e.pointerId);});
  const release=()=>{pointer.down=false;pointer.active=false;};
  canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('pointerleave',()=>{if(!pointer.down)pointer.active=false;});
  canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();pointer.active=true;pointer.down=true;pointer.x=Math.max(0,Math.min(w,(pointer.x||w/2)+(e.key==='ArrowLeft'?-35:e.key==='ArrowRight'?35:0)));pointer.y=Math.max(0,Math.min(h,(pointer.y||h/2)+(e.key==='ArrowUp'?-35:e.key==='ArrowDown'?35:0)));if(paused)render(0);}});
  canvas.addEventListener('keyup',()=>{pointer.down=false;});canvas.addEventListener('blur',release);
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)start();},{threshold:0}).observe(stage);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)start();});
  reduced.addEventListener('change',e=>{if(e.matches){paused=true;sync();render(0);}});
  initialize();resize();settle();sync();status.textContent=descriptions[mode];start();
  const artwork=new Image();
  artwork.onload=()=>{makeLogo(artwork);if(mode==='sigil')settle();};
  artwork.onerror=()=>{stage.querySelector('[data-live-mode="sigil"]').disabled=true;status.textContent='Approved artwork could not load; orbit and tide remain available.';};
  artwork.src='../cybr-elements/outputs/cybrdelic-type/elements/motion/bending/sigils/02/artwork-02.png';
})();
