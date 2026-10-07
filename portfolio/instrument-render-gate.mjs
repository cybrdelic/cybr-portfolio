// Bound mobile WebGL submission to one outstanding frame. Zero-timeout fence
// checks yield to the event loop; no finish(), blocking wait or quality change.
export function createRenderGate({gl,onReady=()=>{},onState=()=>{},onComplete=()=>{},
  clock=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,pollMs=16}={}){
  const supported=!!gl&&['fenceSync','clientWaitSync','deleteSync','flush'].every(name=>typeof gl[name]==='function');
  let sync,job,timer=0,paused=false,held=false,quietUntil=0,wanted=false,disposed=false,error=null;
  const stats={submitted:0,completed:0,polls:0,maxPollMs:0,coalesced:0,lastCompletionWaitMs:null,maxCompletionWaitMs:0};
  const blocked=()=>paused||held||clock()<quietUntil;
  const state=()=>({supported,inFlight:!!sync,paused,held,quietUntil,wanted,disposed,error,...stats});
  function notify(){onState(state());}
  function cancelTimer(){if(timer)clearTimer(timer);timer=0;}
  function arm(delay=pollMs){if(!timer&&!disposed&&!error&&!paused&&!held)timer=setTimer(pump,Math.max(0,delay));}
  function pump(){
    timer=0;if(disposed||error||paused||held)return;
    if(clock()<quietUntil){arm(quietUntil-clock());return;}
    notify();
    if(sync){
      const start=clock();let result;
      try{result=gl.clientWaitSync(sync,0,0);}
      catch(cause){error=String(cause?.message??cause);paused=true;notify();return;}
      stats.polls++;stats.maxPollMs=Math.max(stats.maxPollMs,clock()-start);
      if(result===gl.TIMEOUT_EXPIRED){arm();return;}
      if(result!==gl.ALREADY_SIGNALED&&result!==gl.CONDITION_SATISFIED){error='WebGL frame fence failed';paused=true;notify();return;}
      gl.deleteSync(sync);sync=undefined;stats.completed++;stats.lastCompletionWaitMs=clock()-job.started;
      stats.maxCompletionWaitMs=Math.max(stats.maxCompletionWaitMs,stats.lastCompletionWaitMs);
      const completed=job;job=undefined;onComplete(completed.value);notify();
    }
    if(wanted&&!blocked()){wanted=false;onReady();}
  }
  return{
    canSubmit(){return !disposed&&!error&&!sync&&!blocked();},
    request(){if(disposed||error)return;stats.coalesced+=Number(wanted);wanted=true;if(!paused&&!held)arm(Math.max(pollMs,quietUntil-clock()));},
    submitted(value){
      if(disposed||error)return false;if(sync)throw Error('Only one WebGL frame may be in flight');
      stats.submitted++;
      if(!supported){onComplete(value);notify();return false;}
      try{sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);}
      catch(cause){error=String(cause?.message??cause);paused=true;notify();return false;}
      if(!sync){error='WebGL frame fence unavailable';paused=true;notify();return false;}
      job={started:clock(),value};
      try{gl.flush();}catch(cause){error=String(cause?.message??cause);paused=true;notify();return false;}
      notify();arm();return true;
    },
    beginInteraction(){if(disposed)return;held=true;cancelTimer();notify();},
    endInteraction(quietMs=120){if(disposed)return;held=false;this.hold(quietMs);},
    hold(quietMs=120){
      if(disposed)return;quietUntil=Math.max(quietUntil,clock()+quietMs);cancelTimer();notify();
      if(!paused&&!held)arm(quietUntil-clock());
    },
    setPaused(value){if(disposed||paused===!!value)return;paused=!!value;cancelTimer();notify();if(!paused&&!held)arm(Math.max(pollMs,quietUntil-clock()));},
    snapshot:state,
    dispose(){if(disposed)return;disposed=true;cancelTimer();if(sync){try{gl.deleteSync(sync);}catch{}}sync=job=undefined;wanted=false;notify();}
  };
}
