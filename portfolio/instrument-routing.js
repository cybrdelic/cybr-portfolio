// Shared, renderer-independent centreline math. Coordinates in millimetres.
export const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
export const length=points=>points.slice(1).reduce((sum,p,i)=>sum+distance(p,points[i]),0);
export function span(a,b,count=96){
  const dx=b[0]-a[0],sag=Math.min(3,Math.max(0,dx)*.035);
  return Array.from({length:count+1},(_,i)=>{const t=i/count,s=t*t*(3-2*t);return [a[0]+dx*t,a[1]+(b[1]-a[1])*s,a[2]+(b[2]-a[2])*s-sag*Math.sin(Math.PI*t)**2];});
}
export function takeup(turns,count=640){
  const points=[[-47,0,0],[-40,0,0]];
  for(let i=0;i<=count;i++){
    const t=i/count,r=22*Math.sin(Math.PI*t)**2,a=2*Math.PI*turns*t;
    points.push([-35+70*t,r*Math.cos(a),r*Math.sin(a)]);
  }
  points.push([42,0,0],[61,0,0]);return points;
}
export function takeupForLength(wanted){
  let lo=1,hi=12;
  for(let i=0;i<32;i++){const mid=(lo+hi)/2;if(length(takeup(mid))<wanted)lo=mid;else hi=mid;}
  return takeup((lo+hi)/2);
}
export function internal(name,ports,count=120){
  if(name==='elements')return Array.from({length:count+1},(_,i)=>{const t=i/count,s=Math.sin(Math.PI*t)**2;return [-35+70*t,-8-5*s,-2.5-7*s];});
  return span(ports[0],ports[1],count).map(p=>[p[0],ports[0][1],ports[0][2]]);
}
