const clamp=value=>Math.max(0,Math.min(1,value));

// The same continuous page coordinate drives desktop and mobile choreography.
// This controller never cancels a native touch gesture or waits for a GPU frame.
export function createScrollTour({root,stage,viewport,onProgress,isReduced=()=>false,allowReducedScroll=()=>false,isPaused=()=>false,mapProgress=value=>value,unmapProgress=value=>value}){
  let origin=0,distance=1,measured=false,lastProgress=0;
  function measure(){
    origin=root.getBoundingClientRect().top+viewport.scrollY;
    distance=Math.max(1,root.offsetHeight-stage.offsetHeight);measured=true;
  }
  const pageProgress=()=>clamp((viewport.scrollY-origin)/distance);
  const progress=()=>clamp(mapProgress(pageProgress()));
  const top=p=>origin+clamp(unmapProgress(clamp(p)))*distance;
  const scrollEnabled=()=>!isPaused()&&(!isReduced()||allowReducedScroll());
  function scroll(){if(scrollEnabled()){lastProgress=progress();onProgress(lastProgress);}}
  return{
    measure,progress,scroll,
    jump(p){p=clamp(p);lastProgress=p;onProgress(p);if(!isReduced()||allowReducedScroll())viewport.scrollTo({top:top(p),behavior:'instant'});},
    resize({preserve=false}={}){
      // Browsers can clamp scrollY before dispatching an orientation resize.
      // Preserve the last published pose rather than the already-clamped Y.
      const previous=lastProgress,wasMeasured=measured;measure();
      if(preserve&&wasMeasured&&scrollEnabled())viewport.scrollTo({top:top(previous),behavior:'instant'});
      scroll();
    },
    snapshot:()=>({origin,distance,scrollY:viewport.scrollY,pageProgress:pageProgress(),progress:progress(),enabled:scrollEnabled()})
  };
}
