// User-visible diagnostic. Measures actual presentation RAF intervals while
// driving the same native scroll path as the page; no synthetic FPS counter.
export function createScrollFrameBenchmark({button,output,journey,closeNotes,durationMs=30000}){
 let active=false,start=0,previous=null,previousSegment=null,driverPrevious=null,driverSegment=null,raf=0,restoreY=0,samples=[],idleCadence=[],unready=0,chapters=new Map(),result=null;
 // Segment identity matters, not merely whether the current draw is moving.
 // Demand-driven pages may render nothing during either intentional hold.
 const segmentAt=t=>t<.05?0:t<.5?1:t<.55?2:3;
 const stats=values=>{const sorted=[...values].sort((a,b)=>a-b),at=p=>sorted.length?+sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))].toFixed(2):null;return {frames:values.length,medianMs:at(.5),p95Ms:at(.95),maxMs:at(1),over25Ms:values.filter(v=>v>25).length};};
 function publish(){output.textContent=JSON.stringify(result,null,2);output.dataset.state=active?'running':'complete';}
 function stop(cancelled=false){
  cancelAnimationFrame(raf);raf=0;active=false;
  result={state:cancelled?'cancelled':'complete',durationMs:Math.round(performance.now()-start),cadence:stats(samples),idleRafCadence:stats(idleCadence),unreadyFrames:unready,missingChapters:['geo','light','material','elements','song','combat','scenes'].filter(k=>!chapters.has(k)),chapters:Object.fromEntries([...chapters].map(([k,v])=>[k,stats(v)])),measurement:'Actual draw RAF intervals within the same forward/reverse scroll leg, not GPU-only timing; holds and the first draw of each leg are excluded. Missing chapters and unready frames are not a pass'};
  publish();button.disabled=false;button.textContent='Run scroll check again';
  scrollTo({top:restoreY,behavior:'instant'});
 }
 function drive(now){
  if(!active)return;
  if(document.hidden){stop(true);return;}
  const t=Math.min(1,(now-start)/durationMs);
  const segment=segmentAt(t);
  if(driverPrevious!==null&&driverSegment===segment&&(segment===0||segment===2))idleCadence.push(now-driverPrevious);
  driverPrevious=now;driverSegment=segment;
  if(t>=1){stop();return;}
  // Full journey then reverse. Endpoint holds permit loading and readback,
  // and are excluded from the cadence sample by record() below.
  const p=t<.05?0:t<.5?(t-.05)/.45:t<.55?1:1-(t-.55)/.45;
  scrollTo({top:p*Math.max(1,journey.offsetHeight-innerHeight),behavior:'instant'});
  raf=requestAnimationFrame(drive);
 }
 button.onclick=()=>{
  if(active)return;restoreY=scrollY;active=true;start=performance.now();previous=driverPrevious=null;previousSegment=driverSegment=null;samples=[];idleCadence=[];unready=0;chapters.clear();result={state:'running'};
  publish();button.disabled=true;button.textContent='Measuring actual scroll…';closeNotes();raf=requestAnimationFrame(drive);
 };
 return {get active(){return active;},get result(){return result;},record(now,chapter,ready=true){
  if(!active)return;
  if(!ready)unready++;
  const elapsed=(now-start)/durationMs,segment=segmentAt(elapsed),moving=segment===1||segment===3;
  if(previous!==null&&previousSegment===segment&&moving&&elapsed<1){const dt=now-previous;if(dt>0&&samples.length<2400){samples.push(dt);if(!chapters.has(chapter))chapters.set(chapter,[]);chapters.get(chapter).push(dt);}}
  previous=now;previousSegment=segment;
 },dispose(){cancelAnimationFrame(raf);active=false;button.onclick=null;}};
}
