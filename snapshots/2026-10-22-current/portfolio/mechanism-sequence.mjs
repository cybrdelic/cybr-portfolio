// Presentation choreography only. Drive remains a single constrained input;
// no part is independently rotated or pulled out of its physical assembly.
const clamp=x=>Math.max(0,Math.min(1,x));
const ease=(x,a,b)=>{const t=clamp((x-a)/(b-a));return t*t*t*(t*(t*6-15)+10);};
export const sequenceStops=[0,.48,1];
export function mechanismSequence(p){
 p=clamp(p);
 const inspect=ease(p,.10,.24)*(1-ease(p,.65,.78));
 const actuate=ease(p,.04,.49);
 const close=ease(p,.54,.69);
 // Hold a narrow edge-on silhouette for the drawing/solid handoff. The
 // subsequent reveal is a real rotation under one unchanged studio light.
 const arrival=ease(p,.65,.78);
 const turn=ease(p,.84,.96),opening=ease(p,.88,.99);
 const light=p>=.80?1:0;
 const act=p<.32?0:p<.78?1:2;
 const closed=actuate*(1-close);
 return {act,drive:closed*(1-arrival)+opening,light,
  rotationX:-.12*inspect+arrival*(.08-.28*turn),
  rotationY:-.62*inspect+arrival*(-1.48+1.08*turn),
  rotationZ:-.10+.12*inspect+.12*turn,
  scale:1+.12*inspect+.08*turn,
  title:['24 teeth.\n120 teeth.','Six blades.\nOne input.','Through\nthe aperture.'][act],
  detail:['IRIS—01 / Gear reduction','IRIS—01 / Cam followers & fixed pivots','IRIS—01 / Metal & glass'][act]};
}
