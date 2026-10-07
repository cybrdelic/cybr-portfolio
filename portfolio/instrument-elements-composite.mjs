import {loadElementsFire} from './instrument-elements-bake.mjs?v=shared-3';
import {createElementsTimeline} from './instrument-elements-timeline.mjs';

export async function loadElementsComposite({group,fluid,schedule,reduced,visibleOnly=false}){
 let timeline,sample={waterFrame:0,time:0,cycle:0},held=false;
 const fire=await loadElementsFire({group,schedule,reduced,visibleOnly,onFrame:async(time,manifest)=>{
   timeline??=createElementsTimeline({duration:manifest.duration,waterFrames:fluid.frameCount});
   sample=timeline.sample(time);held=true;
   try{
     if(!await fluid.setFrame(sample.waterFrame))throw Error('Water frame superseded');
     const direction=sample.phase<.5?1:-1;
     void fluid.prefetch([sample.waterFrame+direction,sample.waterFrame+direction*2]).catch(()=>{});
   }finally{held=false;}
 }});
 return{update:fire.update,setPaused:fire.setPaused,
  snapshot(){return{...fire.snapshot(),sharedSimulationClock:true,waterFrame:sample.waterFrame,
   waterCycle:sample.cycle,waitingForWater:held,composite:'linear HDR radiance, live water refraction, depth-tested glass',
   waterPlayback:'forward/back cached physics with eased endpoints'};},
  dispose:fire.dispose};
}
