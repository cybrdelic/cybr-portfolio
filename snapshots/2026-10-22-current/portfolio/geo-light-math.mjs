export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export function phase(p, a, b) {
  const t = clamp((p - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export function choreography(p) {
  return {
    open: phase(p, .06, .31) * (1 - phase(p, .52, .77)),
    travel: phase(p, .42, .80),
    optics: phase(p, .56, .86),
    geoCopy: 1 - phase(p, .13, .28),
    bridgeCopy: phase(p, .24, .33) * (1 - phase(p, .54, .64)),
    lightCopy: phase(p, .78, .91),
    paper: phase(p, .18, .33) * (1 - phase(p, .54, .72)),
  };
}
const dot = (a,b) => a[0]*b[0]+a[1]*b[1];
const cross = (a,b) => a[0]*b[1]-a[1]*b[0];
const sub = (a,b) => [a[0]-b[0],a[1]-b[1]];
export const normalized = a => {const n=Math.hypot(...a);return a.map(v=>v/n);};
export function refract(d,n,eta) {
  const c=-dot(d,n),k=1-eta*eta*(1-c*c);
  return k<0?null:normalized([eta*d[0]+(eta*c-Math.sqrt(k))*n[0],eta*d[1]+(eta*c-Math.sqrt(k))*n[1]]);
}
export function prismVertices(angle) {
  const c=Math.cos(angle),s=Math.sin(angle);
  return [[-1,-.57735],[1,-.57735],[0,1.15470]].map(([x,y])=>[c*x-s*y,s*x+c*y]);
}
function intersect(o,d,polygon) {
  let nearest=null;
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length],e=sub(b,a),den=cross(d,e);
    if(Math.abs(den)<1e-9)continue;
    const ao=sub(a,o),t=cross(ao,e)/den,u=cross(ao,d)/den;
    if(t>1e-5&&u>=0&&u<=1&&(!nearest||t<nearest.t))nearest={t,p:[o[0]+t*d[0],o[1]+t*d[1]],n:normalized([e[1],-e[0]])};
  }
  return nearest;
}
// Cauchy dispersion approximation; deterministic ray construction, not path tracing.
export function tracePrism(angle, wavelength=550, height=.1) {
  const polygon=prismVertices(angle),ior=1.5046+.012/(wavelength*.001)**2;
  let o=[-6,height],d=[1,0];const points=[o];
  const entry=intersect(o,d,polygon);if(!entry)return {points,ior,exited:false};
  points.push(entry.p);d=refract(d,entry.n,1/ior);o=entry.p;
  for(let bounce=0;bounce<5;bounce++) {
    const exit=intersect(o,d,polygon);if(!exit)break;
    points.push(exit.p);const out=refract(d,exit.n.map(v=>-v),ior);
    if(out){points.push([exit.p[0]+out[0]*12,exit.p[1]+out[1]*12]);return {points,ior,exited:true};}
    const k=2*dot(d,exit.n);d=[d[0]-k*exit.n[0],d[1]-k*exit.n[1]];o=exit.p;
  }
  return {points,ior,exited:false};
}
