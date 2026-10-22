export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export function phase(p,a,b){const t=clamp((p-a)/(b-a));return t*t*(3-2*t);}
export function contourRadius(a,bend=0){return 1+(.18+.09*clamp(bend,-1,1))*Math.cos(a*3);}
export function instrumentState(p){return {depth:phase(p,.08,.43),solid:phase(p,.20,.46),optics:phase(p,.63,.91),dark:phase(p,.19,.39)*(1-phase(p,.58,.78)),sketch:1-phase(p,.30,.48),opening:phase(p,.61,.94)};}
// Visible portion of a pivoting leaf, clipped by the fixed circular optical seat.
// Six moving half-planes produce a convex opening, not a six-pointed star.
export function irisLeaf(index,opening){
  const sweep=80*Math.PI/180*(1-clamp(opening)),angle=index*Math.PI/3+sweep;
  const normal=[Math.cos(angle),Math.sin(angle)],offset=1.33*(Math.cos(sweep)-Math.cos(80*Math.PI/180));
  const circle=Array.from({length:96},(_,i)=>[Math.cos(i/96*Math.PI*2)*1.35,Math.sin(i/96*Math.PI*2)*1.35]);
  const points=[];
  for(let i=0;i<circle.length;i++){const a=circle[i],b=circle[(i+1)%circle.length],da=a[0]*normal[0]+a[1]*normal[1]-offset,db=b[0]*normal[0]+b[1]*normal[1]-offset;if(da>=0)points.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);points.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}
  return points;
}
