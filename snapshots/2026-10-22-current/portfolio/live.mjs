import {TAU,clamp,mix,chapterAt,project3D,prismPath,springStep,percentile} from './live-math.mjs';
import {fetchArtifact} from './artifact-fetch.mjs';

const $=s=>document.querySelector(s),canvas=$('#live-canvas'),ctx=canvas.getContext('2d',{alpha:false});
if(!ctx)throw Error('Canvas 2D is unavailable');
const chapters=[
 {id:'geo',category:'GEOMETRY',title:'Things<br>that <em>move.</em>',intro:'Turn one part. The rest follows.',gesture:'Drag to turn the mechanism',parameter:'Drive rotation',action:'Reverse drive ↗',source:'Live kinematic illustration · linked gear ratio 5:3',color:'#ef9272'},
 {id:'light',category:'LIGHT',title:'A different<br><em>angle.</em>',intro:'One beam. A spectrum of possible exits.',gesture:'Drag to change the incoming beam',parameter:'Prism angle',action:'Sweep beam ↗',source:'2D Snell-law ray study · approximate wavelength-dependent glass',color:'#bca6f5'},
 {id:'elements',category:'MATTER',title:'Nothing<br>stays <em>still.</em>',intro:'Push a field out of place. Watch it find its way back.',gesture:'Move through the field · click to pulse',parameter:'Elasticity field',action:'Disturb field ↗',source:'Live spring-particle study · not the recorded FLIP simulation',color:'#96c6b6'},
 {id:'song',category:'SOUND',title:'Give it<br>a <em>voice.</em>',intro:'Nine strings. Start somewhere.',gesture:'Pluck a string · or use keys 1–9',parameter:'Pitch register',action:'Play a phrase ↗',source:'Live synthesized strings · sound starts only when enabled',color:'#dfc17c'},
 {id:'combat',category:'MOVEMENT',title:'Hold<br>the <em>pose.</em>',intro:'An original body, viewed from your angle.',gesture:'Drag to inspect the original avatar',parameter:'Viewing angle',action:'Turn around ↗',source:'Loading original CYBR Combat geometry…',color:'#e08ba1'},
 {id:'scenes',category:'ENVIRONMENTS',title:'A place<br>to <em>get lost.</em>',intro:'Move around a fragment of Desert Hot Springs.',gesture:'Drag to orbit · adjust the water level',parameter:'Water level',action:'Orbit terrain ↗',source:'Loading original Desert Hot Springs geometry…',color:'#87b8dd'}
];
let active=0,previous=0,blend=1,t=0,frame=0,last=0,paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
let w=1,h=1,scale=1,rotation=0,direction=1,parameter=50,beam=0,water=0,dragging=false,dragX=0,orbit=.7;
let pointer={x:9999,y:9999},audio=null,sound=false,raf=0,measureUntil=0,measuring=false;
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),sources={},errors=[],stats={frames:0,chapter:'geo',cpuP95:0,frameP95:0},frameTimes=[],cpuTimes=[],counts=new Uint32Array(6),actions=new Uint32Array(6);
const strings=Array.from({length:9},()=>({energy:0,phase:0}));
const particles=Array.from({length:1050},(_,i)=>({x:(i%42-20.5)*14,y:(Math.floor(i/42)-12)*14,vx:0,vy:0}));
const notes=[130.81,146.83,164.81,196,220,261.63,293.66,329.63,392];
function line(points,color='#aaa',width=1){if(points.length<2)return;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();}
function circle(x,y,r,color,fill=false){ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx[fill?'fillStyle':'strokeStyle']=color;fill?ctx.fill():ctx.stroke();}
function text(label,x,y,color='#747987'){ctx.font='10px monospace';ctx.fillStyle=color;ctx.fillText(label,x,y);}
function ring(x,y,r,angle,teeth,color){
 const points=[];for(let i=0;i<teeth*4;i++){const a=angle+i/(teeth*4)*TAU,rr=r+([0,1,1,0][i%4]?5:-5);points.push([x+Math.cos(a)*rr,y+Math.sin(a)*rr]);}points.push(points[0]);line(points,color,1.6);
 circle(x,y,r*.68,'#454953');circle(x,y,12,color);for(let k=0;k<5;k++){const a=angle+k/5*TAU;line([[x+Math.cos(a)*20,y+Math.sin(a)*20],[x+Math.cos(a)*r*.62,y+Math.sin(a)*r*.62]],color,6);}
}
function geo(){
 const angle=rotation+parameter/100*TAU;
 line([[-280,150],[260,150]],'#3e424e');ring(-90,0,120,angle,30,'#ef9272');ring(102,0,72,-angle*30/18+Math.PI/18,18,'#eae8df');
 const crank=[-90+Math.cos(angle)*85,Math.sin(angle)*85];line([[-90,0],crank],'#eae8df',3);circle(...crank,7,'#eae8df',true);
 const slider=90+Math.cos(angle)*60;line([crank,[slider,150]],'#a9adb5',2);ctx.strokeStyle='#ef9272';ctx.strokeRect(slider-18,138,36,24);
 text('DRIVER / 30',-190,-160);text('FOLLOWER / 18',70,-115);text('LINKED, NOT INDEPENDENT',-90,200);circle(-90,0,160,'#282c38');
}
function light(){
 const angle=(parameter-50)/160,triangle=[[0,-150],[-130,75],[130,75]].map(([x,y])=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)]);
 const origin=[-420,clamp(beam,-110,110)],aim=[1,.03];
 for(let i=0;i<23;i++){const lambda=.40+i/22*.30,n=1.50+.006/(lambda*lambda);const ray=prismPath(origin,aim,triangle,n);line(ray,`hsla(${275-i*12},80%,70%,.7)`,1.4);}
 line([...triangle,triangle[0]],'#e4def4',2);circle(...origin,6,'#eee',true);text('WHITE LIGHT',-400,-160);text('REFRACTION / DISPERSION',-85,170);text('n(λ) = 1.50 + 0.006 / λ²',-85,190);
}
function elements(dt){
 for(let i=0;i<particles.length;i++){
  const p=particles[i],x=(i%42-20.5)*14,y=(Math.floor(i/42)-12)*14,r=Math.hypot(x,y),wave=Math.sin(r*.021-t*1.8)*(7+parameter*.23);
  let tx=x,ty=y+wave;const dx=p.x-pointer.x,dy=p.y-pointer.y,d=Math.max(1,Math.hypot(dx,dy));
  if(d<95){const force=(95-d)*.9;tx+=dx/d*force;ty+=dy/d*force;}
  springStep(p,tx,ty,dt);const size=1.6+Math.min(2.2,Math.hypot(p.vx,p.vy)*.012);ctx.fillStyle=i%7===0?'#e5e9de':'#96c6b6';ctx.fillRect(p.x-size/2,p.y-size/2,size,size);
 }
 text('1,050 POINTS / ONE ELASTIC FIELD',-150,210);
}
function song(dt){
 for(let i=0;i<9;i++){
  const x=(i-4)*53,s=strings[i];s.energy*=Math.exp(-2.7*dt);s.phase+=dt*32;const pts=[];
  for(let j=0;j<=64;j++){const u=j/64;pts.push([x+Math.sin(u*Math.PI)*Math.sin(s.phase-u*12)*s.energy*30,-165+u*330]);}
  line(pts,s.energy>.03?'#dfc17c':'#5c5a50',s.energy>.03?2:1);circle(x,-165,3,'#dfc17c',true);circle(x,165,4,'#dfc17c',true);text(String(i+1),x-3,195);
 }
 text(sound?'AUDIO ON / TOUCH TO PLAY':'SOUND OFF / ENABLE ABOVE TO LISTEN',-145,-210,'#dfc17c');
}
function cloud(name,angle,tilt){
 const data=sources[name];if(!data){text(errors.length?'SOURCE UNAVAILABLE — SEE RUNTIME':'LOADING ORIGINAL GEOMETRY…',-160,0);return;}
 const points=data.points;for(let i=0;i<points.length;i++){
  const v=points[i],z=name==='scenes'&&v.water?v.z+water:v.z,[x,y,depth]=project3D(v.x,v.y,z,angle,tilt);
  const brightness=clamp(.55+depth/650,.22,1);ctx.globalAlpha*=brightness;
  ctx.fillStyle=v.water?'#91cee4':name==='combat'?'#e9acbb':'#d6c9b5';const size=v.water?2:2.1;ctx.fillRect(x,y,size,size);ctx.globalAlpha/=brightness;
 }
 const grid=[];for(let i=-3;i<=3;i++){grid.push([[-230,i*70,-180],[230,i*70,-180]],[ [i*70,-230,-180],[i*70,230,-180]]);}for(const seg of grid)line(seg.map(v=>project3D(...v,angle,tilt)),'#2e333d');
 text(name==='combat'?'ORIGINAL AVATAR / STATIC POSE':'DESERT HOT SPRINGS / SOURCE VERTICES',-170,235);
}
const renderers=[geo,light,elements,song,()=>cloud('combat',orbit+(parameter-50)*.045,.12),()=>cloud('scenes',orbit,.70)];
function background(){ctx.fillStyle='#16171d';ctx.fillRect(0,0,w,h);ctx.save();ctx.translate(w/2,h/2);ctx.scale(scale,scale);ctx.lineWidth=1;circle(0,0,240,'#252a35');for(let i=0;i<60;i++){const a=i/60*TAU,r=i%5===0?249:244;line([[Math.cos(a)*240,Math.sin(a)*240],[Math.cos(a)*r,Math.sin(a)*r]],'#3a3e48');}ctx.restore();}
function request(){if(!raf&&!document.hidden)raf=requestAnimationFrame(draw);}
function draw(now){
 raf=0;const start=performance.now(),dt=last?Math.min((now-last)/1000,.05):1/60;if(last&&now-last<250&&(!paused||measuring))frameTimes.push(now-last);last=now;
 if(!paused){t+=dt;rotation+=dt*.13*direction;if(active===5)orbit+=dt*.035;}
 blend=paused?1:Math.min(1,blend+dt*4);background();ctx.save();ctx.translate(w/2,h/2);ctx.scale(scale,scale);
 if(blend<1){ctx.globalAlpha=1-blend;renderers[previous](0);}ctx.globalAlpha=blend;renderers[active](paused?0:dt);ctx.restore();counts[active]++;frame++;stats.frames=frame;stats.chapter=chapters[active].id;
 cpuTimes.push(performance.now()-start);if(cpuTimes.length>300)cpuTimes.shift();if(frameTimes.length>300)frameTimes.shift();
 if(frame%30===0||paused)report();if(measuring&&now>=measureUntil){measuring=false;$('#measure').textContent='Measure next 3 seconds';report();}
 if(!paused||blend<1||measuring)request();
}
function report(){
 stats.cpuP95=+percentile(cpuTimes,.95).toFixed(2);stats.frameP95=+percentile(frameTimes,.95).toFixed(2);
 $('#runtime-metrics').textContent=JSON.stringify({...stats,paused,sound,sourcePoints:Object.fromEntries(Object.entries(sources).map(([key,v])=>[key,v.points.length])),chapterFrames:Array.from(counts),interactions:Array.from(actions),errors},null,2);
 $('#runtime-status').textContent=errors.length?errors.join('\n'):`Canvas active · ${Object.keys(sources).length}/2 original source datasets loaded`;
 $('#retry').hidden=errors.length===0;
}
function resize(){const r=canvas.getBoundingClientRect();w=r.width;h=r.height;const dpr=Math.min(devicePixelRatio,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);scale=Math.min(w/740,h/550);request();}
function setChapter(index){
 if(index===active&&frame>0)return;previous=active;active=index;blend=reduced.matches?1:0;parameter=50;const c=chapters[index];
 document.body.style.setProperty('--accent',c.color);$('#headline').innerHTML=c.title;$('#intro').textContent=c.intro;$('#category').textContent=c.category;$('#chapter-number').textContent=`0${index+1}`;
 $('#project-link').href=`${c.id}.html`;$('#project-link').innerHTML=`Explore CYBR ${c.id.toUpperCase()} <span>↗</span>`;$('#gesture-text').textContent=c.gesture;$('#parameter-label').textContent=c.parameter;$('#parameter').value=50;$('#parameter-value').textContent='50';$('#action').textContent=c.action;$('#provenance').textContent=c.source;
 canvas.setAttribute('aria-label',`${c.category}: ${c.gesture}. Use the parameter slider or action button as keyboard alternatives.`);
 for(const [i,a] of [...document.querySelectorAll('.chapters a')].entries())if(i===index)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
 if(!reduced.matches)$('#headline').animate([{opacity:.25,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:320,easing:'ease-out'});
 request();
}
function pointerAt(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left-w/2)/scale,y:(e.clientY-r.top-h/2)/scale};}
canvas.addEventListener('pointerdown',e=>{dragging=true;dragX=e.clientX;pointer=pointerAt(e);canvas.setPointerCapture(e.pointerId);actions[active]++;if(active===3)pluck(clamp(Math.round(pointer.x/53+4),0,8));if(active===2)pulse();request();});
canvas.addEventListener('pointermove',e=>{
 pointer=pointerAt(e);if(active===1)beam=pointer.y;
 if(dragging){const dx=e.clientX-dragX;dragX=e.clientX;if(active===0)rotation+=dx*.014;if(active===4||active===5)orbit+=dx*.013;if(active===3){const i=clamp(Math.round(pointer.x/53+4),0,8);if(strings[i].energy<.3)pluck(i);}}
 request();
});
function release(){dragging=false;}canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('lostpointercapture',release);canvas.addEventListener('pointerleave',()=>{pointer={x:9999,y:9999};});
function pulse(){for(const p of particles){const dx=p.x,dy=p.y,d=Math.max(1,Math.hypot(dx,dy));p.vx+=dx/d*220;p.vy+=dy/d*220;}request();}
async function pluck(i){
 strings[i].energy=1;strings[i].phase=0;request();if(!sound||!audio)return;
 try{await audio.resume();const start=audio.currentTime,freq=notes[i]*2**((parameter-50)/50),gain=audio.createGain();gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.055,start+.01);gain.gain.exponentialRampToValueAtTime(.0001,start+1.5);gain.connect(audio.destination);const oscillator=audio.createOscillator();oscillator.type='triangle';oscillator.frequency.value=freq;oscillator.connect(gain);oscillator.start(start);oscillator.stop(start+1.6);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};}
 catch(e){errors.push(`Audio: ${e.message}`);report();}
}
$('#sound').onclick=async()=>{try{if(!audio)audio=new AudioContext();sound=!sound;if(sound)await audio.resume();else await audio.suspend();$('#sound').textContent=sound?'Sound on':'Sound off';$('#sound').setAttribute('aria-pressed',String(sound));request();}catch(e){errors.push(`Audio: ${e.message}`);report();}};
$('#pause').onclick=()=>{paused=!paused;$('#pause').textContent=paused?'Resume motion':'Pause motion';$('#pause').setAttribute('aria-pressed',String(paused));last=0;request();};
if(paused){$('#pause').textContent='Resume motion';$('#pause').setAttribute('aria-pressed','true');}
$('#parameter').oninput=e=>{parameter=+e.target.value;water=(parameter-50)*.7;$('#parameter-value').textContent=String(parameter);actions[active]++;request();};
$('#action').onclick=()=>{actions[active]++;if(active===0)direction*=-1;if(active===1)beam=beam>0?-70:70;if(active===2)pulse();if(active===3)[0,2,4,6,8].forEach((n,i)=>setTimeout(()=>{if(active===3&&!document.hidden)void pluck(n);},i*110));if(active===4||active===5)orbit+=Math.PI/2;request();};
canvas.onkeydown=e=>{if(active===3&&/^[1-9]$/.test(e.key)){e.preventDefault();actions[active]++;void pluck(+e.key-1);}else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const d=e.key==='ArrowRight'?1:-1;rotation+=d*.2;orbit+=d*.2;beam+=d*8;actions[active]++;request();}};
$('#measure').onclick=()=>{frameTimes.length=0;cpuTimes.length=0;last=0;measuring=true;measureUntil=performance.now()+3000;$('#measure').textContent='Measuring…';request();};
window.addEventListener('scroll',()=>{setChapter(chapterAt(scrollY,innerHeight));},{passive:true});window.addEventListener('resize',resize);
document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;audio?.suspend();}else{if(sound)audio?.resume();request();}});
reduced.addEventListener('change',()=>{paused=reduced.matches;$('#pause').textContent=paused?'Resume motion':'Pause motion';$('#pause').setAttribute('aria-pressed',String(paused));request();});
async function loadSource(name){
 try{
  const [meta,buffer]=await Promise.all([fetchArtifact(`./assets/artifacts-v2/${name}-hero.json`,{json:true}),fetchArtifact(`./assets/artifacts-v2/${name}-hero.bin.gz`)]);
  if(buffer.byteLength!==meta.bytes)throw Error('Geometry length mismatch');const vertices=[];
  for(const record of meta.meshes){const floats=new Float32Array(buffer,record.positions.offset,record.positions.count);for(let i=0;i<floats.length;i+=3)vertices.push({x:floats[i],y:floats[i+1],z:floats[i+2],water:record.material.role==='springs-water'});}
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const v of vertices)for(const [i,key] of ['x','y','z'].entries()){min[i]=Math.min(min[i],v[key]);max[i]=Math.max(max[i],v[key]);}
  const size=Math.max(...max.map((v,i)=>v-min[i])),factor=(name==='combat'?360:420)/size,step=Math.max(1,Math.ceil(vertices.length/2800));
  const points=vertices.filter((_,i)=>i%step===0).map(v=>({x:(v.x-(min[0]+max[0])/2)*factor,y:(v.y-(min[1]+max[1])/2)*factor,z:(v.z-(min[2]+max[2])/2)*factor,water:v.water}));
  sources[name]={points};const c=chapters.find(c=>c.id===name);c.source=name==='combat'?'Original CYBR Combat avatar · source-geometry point study · static pose':'Original Desert Hot Springs terrain + water · source-geometry point study';
  if(chapters[active].id===name)$('#provenance').textContent=c.source;report();request();
 }catch(e){errors.push(`${name}: ${e.message}`);report();}
}
$('#retry').onclick=()=>{errors.length=0;for(const name of ['combat','scenes'])if(!sources[name])void loadSource(name);};
setChapter(chapterAt(scrollY,innerHeight));resize();void loadSource('combat');void loadSource('scenes');
