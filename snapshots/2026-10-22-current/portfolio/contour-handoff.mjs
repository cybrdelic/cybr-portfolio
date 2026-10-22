// Keep the editorial rails continuous through chapter changes. The SVG itself
// moves; there is no screenshot overlay, duplicate headline or second renderer.
const running=new WeakMap();
export function morphContours(svg,markup,{reduced=false,duration=360}={}){
 const previous=running.get(svg);if(previous)cancelAnimationFrame(previous);
 const sample=path=>{const length=path.getTotalLength();return Array.from({length:81},(_,i)=>{const p=path.getPointAtLength(length*i/80);return [p.x,p.y];});};
 const from=[...svg.querySelectorAll('path')].map(sample);
 svg.innerHTML=markup;
 const paths=[...svg.querySelectorAll('path')],to=paths.map(sample),original=paths.map(p=>p.getAttribute('d'));
 if(reduced||!from.length){running.delete(svg);return;}
 const start=performance.now();
 function tick(now){
  const t=Math.min(1,(now-start)/duration),u=t*t*(3-2*t);
  paths.forEach((path,i)=>{const a=from[Math.min(i,from.length-1)],b=to[i];path.setAttribute('d',b.map((p,j)=>(j?'L':'M')+(a[j][0]+(p[0]-a[j][0])*u).toFixed(2)+' '+(a[j][1]+(p[1]-a[j][1])*u).toFixed(2)).join(''));});
  if(t<1)running.set(svg,requestAnimationFrame(tick));else{paths.forEach((p,i)=>p.setAttribute('d',original[i]));running.delete(svg);}
 }
 tick(start);
}
