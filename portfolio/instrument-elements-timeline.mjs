/** Both cached effects follow the decoded fire media clock. The recorded water
 * surface plays forward/back with eased turns; physics was solved forward only. */
export function createElementsTimeline({duration,waterFrames}){
 if(!(duration>0)||!Number.isInteger(waterFrames)||waterFrames<2)throw Error('Invalid Elements timeline');
 let previous=0,cycles=0;
 return{sample(time){
   const t=Math.max(0,Math.min(duration,time));
   if(t<previous-duration*.5)cycles++;
   previous=t;
   const phase=((cycles%2)+t/duration)/2;
   const progress=(1-Math.cos(phase*Math.PI*2))*.5;
   return{time:t,cycle:cycles,phase,waterFrame:Math.round(progress*(waterFrames-1))};
 },reset(){previous=0;cycles=0;}};
}
