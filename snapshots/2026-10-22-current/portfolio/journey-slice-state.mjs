export const clamp=x=>Math.max(0,Math.min(1,x));
export function phase(x,a,b){const t=clamp((x-a)/(b-a));return t*t*t*(t*(t*6-15)+10);}
export function sliceState(p){p=clamp(p);return {drive:phase(p,.02,.27),solid:phase(p,.25,.36),travel:phase(p,.46,.73),impact:p===1?1:clamp((p-.77)/.23),drop:phase(p,.72,.77),act:p<.30?0:p<.72?1:2};}
// Authored damped radial impulse, not a fluid solver. Compiled once into a
// fixed-topology cache; playback only interpolates adjacent positions/normals.
export function impactHeight(x,z,t){
 if(t<=0)return 0;
 const r=Math.hypot(x,z),front=5*t,packet=Math.exp(-(((r-front)/.48)**2));
 const arrival=phase(t,0,.025),decay=Math.exp(-1.4*t);
 const crown=.55*Math.exp(-(((r-.22-.65*t)/.12)**2))*Math.exp(-7*t)*(.78+.22*Math.cos(Math.atan2(z,x)*10));
 return arrival*decay*(.10*Math.cos((r-front)*8)*packet+crown);
}
