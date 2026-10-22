export const TAU=Math.PI*2;
export const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const mix=(a,b,t)=>a+(b-a)*t;
export function chapterAt(scroll,height){return clamp(Math.round(scroll/Math.max(1,height)),0,5);}
export function project3D(x,y,z,angle,tilt=.45){
 const a=x*Math.cos(angle)-y*Math.sin(angle),b=x*Math.sin(angle)+y*Math.cos(angle);
 return [a,b*Math.sin(tilt)-z*Math.cos(tilt),b*Math.cos(tilt)+z*Math.sin(tilt)];
}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const norm=a=>{const l=Math.hypot(...a);return a.map(v=>v/l);};
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
export function refract(direction,normal,eta){
 const c=-dot(direction,normal),k=1-eta*eta*(1-c*c);
 return k<0?null:norm(direction.map((v,i)=>eta*v+(eta*c-Math.sqrt(k))*normal[i]));
}
export function prismPath(origin,direction,vertices,index){
 let p=[...origin],d=norm(direction),inside=false;const points=[[...p]];
 for(let bounce=0;bounce<8;bounce++){
  let hit=null;
  for(let i=0;i<vertices.length;i++){
   const a=vertices[i],b=vertices[(i+1)%vertices.length],edge=[b[0]-a[0],b[1]-a[1]],offset=[a[0]-p[0],a[1]-p[1]],den=cross(d,edge);
   if(Math.abs(den)<1e-8)continue;
   const t=cross(offset,edge)/den,u=cross(offset,d)/den;
   if(t>1e-4&&u>=0&&u<=1&&(!hit||t<hit.t))hit={t,normal:norm([-edge[1],edge[0]])};
  }
  if(!hit){points.push([p[0]+d[0]*800,p[1]+d[1]*800]);break;}
  p=[p[0]+hit.t*d[0],p[1]+hit.t*d[1]];points.push([...p]);
  let n=hit.normal;if(dot(d,n)>0)n=n.map(v=>-v);
  const r=refract(d,n,inside?index:1/index);
  if(r){d=r;inside=!inside;}else{const dn=dot(d,n);d=d.map((v,i)=>v-2*dn*n[i]);}
  p=p.map((v,i)=>v+d[i]*1e-3);
 }
 return points;
}
export function springStep(p,tx,ty,dt){
 dt=Math.min(dt,1/30);const damping=Math.exp(-8*dt);
 p.vx=(p.vx+(tx-p.x)*48*dt)*damping;p.vy=(p.vy+(ty-p.y)*48*dt)*damping;p.x+=p.vx*dt;p.y+=p.vy*dt;
}
export function percentile(values,p){if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(p*sorted.length))];}
