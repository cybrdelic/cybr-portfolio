/** Pause between atomic uploads; never changes texture contents or GPU readiness. */
export function createStartupInputGate({target=globalThis.window,clock=()=>performance.now(),quietMs=180,pollMs=16,setTimer=setTimeout,clearTimer=clearTimeout,inputPending=()=>globalThis.navigator?.scheduling?.isInputPending?.({includeContinuous:true})??false}={}){
  const pointers=new Set(),listeners=[],waiters=new Set();
  let touches=0,quietUntil=-Infinity,disposed=false;
  const quiet=()=>{quietUntil=clock()+quietMs;};
  const pointerStart=event=>{if(event.pointerType==='touch'||event.pointerType==='pen'){pointers.add(event.pointerId);quiet();}};
  const pointerMove=event=>{if(pointers.has(event.pointerId))quiet();};
  const pointerEnd=event=>{if(pointers.delete(event.pointerId))quiet();};
  const touch=event=>{touches=event.touches.length;quiet();};
  function dispose(){
    if(disposed)return;disposed=true;
    for(const [type,listener] of listeners)target.removeEventListener(type,listener,true);
    pointers.clear();touches=0;
    for(const wake of [...waiters])wake();
  }
  function listen(type,listener){target.addEventListener(type,listener,{capture:true,passive:true});listeners.push([type,listener]);}
  if(target){
    listen('pointerdown',pointerStart);listen('pointermove',pointerMove);
    listen('pointerup',pointerEnd);listen('pointercancel',pointerEnd);
    for(const type of ['touchstart','touchmove','touchend','touchcancel'])listen(type,touch);
    listen('scroll',quiet);listen('pagehide',event=>{if(!event.persisted)dispose();});
  }
  const pending=()=>{try{return !!inputPending();}catch{return false;}};
  function waitTick(){return new Promise(resolve=>{
    let timer;
    const wake=()=>{clearTimer(timer);waiters.delete(wake);resolve();};
    waiters.add(wake);timer=setTimer(wake,pollMs);
  });}
  async function beforeUpload(cancelled=()=>false){
    // No timeout forces progress through continuous gestures or scroll inertia.
    // An upload already started remains synchronous and cannot be preempted.
    for(;;){
      if(disposed||cancelled())throw Error('Startup texture preparation cancelled');
      if(!pointers.size&&!touches&&clock()>=quietUntil&&!pending())return;
      await waitTick();
    }
  }
  return {beforeUpload,dispose};
}
