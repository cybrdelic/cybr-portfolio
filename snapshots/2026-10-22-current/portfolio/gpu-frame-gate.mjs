// Diagnostic experiment only: not imported by directions.mjs. Both tested
// queue limits worsened cadence versus native scheduling on the Intel adapter.
// Backpressure only: never reduce pixels, samples, or render quality. The caller
// polls once before a visible frame and submits once after its final draw.
// Skipped callbacks are not rendered frames and must not be reported as FPS.
export function createGpuFrameGate(renderer,{clock=()=>performance.now(),maxPendingMs=10000,maxFramesInFlight=1}={}){
 const limit=Number.isFinite(maxPendingMs)&&maxPendingMs>0?maxPendingMs:10000;
 // Two permits CPU/GPU overlap without letting rapid scroll callbacks build an
 // obsolete deep queue. Unsupported limits retain the conservative default.
 const capacity=maxFramesInFlight===2?2:1,pending=[];
 let gl=null,enabled=true,disposed=false,disabledReason=null;
 let fencedFrames=0,completedFences=0,skippedCallbacks=0,polls=0,duplicateSubmissions=0,failures=0;
 function releaseOldest(){
  const owned=pending.shift();
  if(owned)try{gl.deleteSync(owned.sync);}catch{failures++;}
 }
 function release(){
  // This is resource cleanup, never a polling loop; at most two entries exist.
  while(pending.length)releaseOldest();
 }
 function disable(reason){
  if(enabled){enabled=false;disabledReason=reason;failures++;}
  release();
 }
 function lost(){
  try{if(gl.isContextLost?.()){disable('context-lost');return true;}}
  catch{disable('context-status-failed');return true;}
  return false;
 }
 try{
  gl=renderer.getContext();
  if(!gl||['fenceSync','clientWaitSync','deleteSync','flush'].some(name=>typeof gl[name]!=='function')||
   ['SYNC_GPU_COMMANDS_COMPLETE','ALREADY_SIGNALED','CONDITION_SATISFIED','TIMEOUT_EXPIRED','WAIT_FAILED'].some(name=>!Number.isFinite(gl[name]))){
   enabled=false;disabledReason='unsupported';
  }
 }catch{enabled=false;disabledReason='context-unavailable';}
 return {
  ready(){
   if(disposed||!enabled)return true;
   if(lost()||!pending.length)return true;
   const oldest=pending[0];
   let result;
   try{polls++;result=gl.clientWaitSync(oldest.sync,0,0);}
   catch{disable('fence-poll-failed');return true;}
   if(result===gl.ALREADY_SIGNALED||result===gl.CONDITION_SATISFIED){releaseOldest();completedFences++;return true;}
   if(result===gl.TIMEOUT_EXPIRED){
    // Poll before considering age: a completed frame can sit idle arbitrarily
    // long. Only a fence still unsignaled after this poll trips the watchdog.
    // No background timer or blocking wait is introduced.
    if(clock()-oldest.submittedAt>=limit){disable('fence-timeout');return true;}
    if(pending.length<capacity)return true;
    skippedCallbacks++;return false;
   }
   disable(result===gl.WAIT_FAILED?'fence-wait-failed':'unexpected-fence-status');return true;
  },
  submitted(){
   if(disposed||!enabled||lost())return false;
   if(pending.length>=capacity){duplicateSubmissions++;return false;}
   try{
    const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
    if(sync===null){disable('fence-creation-failed');return false;}
    pending.push({sync,submittedAt:clock()});
    // Flush only submits queued work. Completion is queried on a later frame.
    gl.flush();fencedFrames++;return true;
   }catch{disable('fence-submission-failed');return false;}
  },
  snapshot(){return {enabled:enabled&&!disposed,disposed,pending:pending.length>0,pendingFrames:pending.length,maxFramesInFlight:capacity,disabledReason,maxPendingMs:limit,
   fencedFrames,completedFences,skippedCallbacks,polls,duplicateSubmissions,failures};},
  dispose(){if(disposed)return;disposed=true;release();}
 };
}
