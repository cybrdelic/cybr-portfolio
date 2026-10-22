/** Record the live renderer canvas, not screenshots, replays, or the surrounding DOM. */
export function installCanvasDemoRecorder({canvas,container,closeNotes,onStart,onStop,durationMs=12000,runtime=globalThis}={}){
 if(!canvas||!container?.ownerDocument)throw new TypeError('A canvas and an attached UI container are required.');
 const doc=container.ownerDocument,now=()=>runtime.performance.now();
 const duration=Number.isFinite(durationMs)?Math.min(30000,Math.max(1000,durationMs)):12000;
 const ui=doc.createElement('fieldset'),legend=doc.createElement('legend'),description=doc.createElement('p');
 const startButton=doc.createElement('button'),stopButton=doc.createElement('button'),status=doc.createElement('p'),download=doc.createElement('a');
 ui.className='canvas-demo-recorder';legend.textContent='Live scene video';
 description.textContent='Records the actual renderer canvas only. Page text, navigation and audio are not included.';
 startButton.type=stopButton.type='button';startButton.textContent=`Record scene (${Math.round(duration/1000)} s)`;stopButton.textContent='Stop recording';
 stopButton.disabled=true;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 download.hidden=true;download.textContent='Download scene video';
 ui.append(legend,description,startButton,stopButton,status,download);container.append(ui);
 const supported=typeof canvas.captureStream==='function'&&typeof runtime.MediaRecorder==='function';
 startButton.disabled=!supported;status.textContent=supported?'Ready. Recording follows the frames actually rendered.':'Canvas recording is unavailable in this browser.';
 let session=null,disposed=false,objectURL=null;
 let stats={phase:'idle',renderedFrames:0,captureRequests:0,elapsedMs:0,firstRenderedMs:null,lastRenderedMs:null,renderedSpanMs:0,bytes:0,mimeType:null,mode:null,error:null};
 const describeError=error=>String(error?.message||error||'Recording failed.').slice(0,240);
 const clearDownload=()=>{if(objectURL){runtime.URL.revokeObjectURL(objectURL);objectURL=null;}download.hidden=true;download.removeAttribute('href');download.removeAttribute('download');};
 const stopTracks=stream=>{for(const track of stream?.getTracks?.()||[]){try{track.stop();}catch{ /* Continue cleaning the remaining tracks. */ }}};
 const notify=(callback,value)=>{try{callback?.(value);}catch(error){status.textContent=`Recording callback: ${describeError(error)}`;}};
 function updateElapsed(current=now()){
  if(session)stats.elapsedMs=Math.max(stats.elapsedMs,Math.max(0,Math.min(current,session.stoppedAt??Infinity)-session.started));
 }
 function finish(current){
  if(session!==current||current.finished)return;
  current.finished=true;runtime.clearTimeout(current.timer);runtime.clearTimeout(current.stopTimer);
  updateElapsed(current.stoppedAt??now());stopTracks(current.stream);session=null;
  if(disposed)return;
  startButton.disabled=!supported;stopButton.disabled=true;
  if(current.error||!stats.renderedFrames||!current.bytes){
   stats.phase='error';stats.error=current.error||'No rendered video frames were received. Try recording again after the scene loads.';
   status.textContent=stats.error;
  }else{
   try{
    const mime=current.recorder.mimeType||current.mimeType||'video/webm';
    const blob=new runtime.Blob(current.chunks,{type:mime});
    objectURL=runtime.URL.createObjectURL(blob);download.href=objectURL;
    const extension=mime.includes('mp4')?'mp4':'webm';
    download.download=`cybr-portfolio-scene-${new Date().toISOString().replace(/[:.]/g,'-')}.${extension}`;
    download.hidden=false;stats.phase='complete';stats.bytes=blob.size;stats.mimeType=mime;
    // MediaRecorder timestamps start at its first encoded frame, not at our
    // button/timer. GPU startup and idle tails can make encoded duration shorter.
    status.textContent=`Video ready. ${stats.renderedFrames} rendered frames observed during ${(stats.elapsedMs/1000).toFixed(1)} s of recording; encoded timing is preserved.`;
    // One normal browser download; the visible link remains available if it is blocked.
    try{download.click();}catch{status.textContent='Scene video is ready. Use the download link to save it.';}
   }catch(error){clearDownload();stats.phase='error';stats.error=describeError(error);status.textContent=stats.error;}
  }
  current.chunks.length=0;notify(onStop,{...stats});
 }
 function stop(reason='user'){
  const current=session;if(!current||current.stopping)return;
  current.stopping=true;current.stoppedAt=now();updateElapsed(current.stoppedAt);runtime.clearTimeout(current.timer);
  stats.phase='stopping';stopButton.disabled=true;status.textContent='Finishing scene video…';
  // MediaRecorder.stop queues the final dataavailable event before stop. Keep
  // tracks alive until then; stopping them first can truncate the final frame.
  try{
   if(current.recorder.state==='inactive'){finish(current);return;}
   current.stopTimer=runtime.setTimeout(()=>{current.error||='The browser did not finish the video encoder.';finish(current);},5000);
   current.recorder.stop();
  }catch(error){current.error=describeError(error);finish(current);}
 }
 function start(){
  if(disposed||session||!supported)return false;
  clearDownload();let stream;
  try{
   stream=canvas.captureStream(0);
   let track=stream.getVideoTracks()[0];
   if(!track)throw new Error('The canvas did not provide a video track.');
   let mode='requested-rendered-frames';
   if(typeof track.requestFrame!=='function'){
    stopTracks(stream);stream=canvas.captureStream(30);track=stream.getVideoTracks()[0];mode='browser-30fps-maximum';
    if(!track)throw new Error('The canvas did not provide a video track.');
   }
   const mimeType=['video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type=>runtime.MediaRecorder.isTypeSupported?.(type));
   const options={videoBitsPerSecond:16000000,...(mimeType?{mimeType}:{})};
   const recorder=new runtime.MediaRecorder(stream,options);
   const current={stream,track,recorder,mimeType,started:now(),lastCapture:-Infinity,chunks:[],bytes:0,timer:null,stopTimer:null,stopping:false,finished:false,error:null};
   session=current;stats={phase:'recording',renderedFrames:0,captureRequests:0,elapsedMs:0,firstRenderedMs:null,lastRenderedMs:null,renderedSpanMs:0,bytes:0,mimeType:recorder.mimeType||mimeType||null,mode,error:null};
   recorder.ondataavailable=event=>{
    if(session!==current||current.finished||!event.data?.size)return;
    current.bytes+=event.data.size;
    // A failed/misbehaving encoder must not accumulate an unbounded Blob list.
    if(current.bytes>96*1024*1024){current.error='Recording exceeded the 96 MiB safety limit.';stop('size-limit');return;}
    current.chunks.push(event.data);
   };
   recorder.onerror=event=>{if(session===current){current.error=describeError(event.error||'The browser video encoder failed.');stop('encoder-error');}};
   recorder.onstop=()=>finish(current);
   recorder.start(250);startButton.disabled=true;stopButton.disabled=false;
   status.textContent=`Recording the live scene for ${Math.round(duration/1000)} seconds…`;
   current.timer=runtime.setTimeout(()=>stop('duration'),duration);
   notify(closeNotes);notify(onStart,{...stats});return true;
  }catch(error){
   if(session){runtime.clearTimeout(session.timer);runtime.clearTimeout(session.stopTimer);session.finished=true;session=null;}
   stopTracks(stream);stats.phase='error';stats.error=describeError(error);status.textContent=stats.error;
   startButton.disabled=!supported;stopButton.disabled=true;return false;
  }
 }
 function recordFrame(timestamp=now()){
  const current=session;if(!current||current.stopping)return false;
  const time=Number.isFinite(timestamp)?timestamp:now();updateElapsed(time);stats.renderedFrames++;
  const relative=Math.max(0,time-current.started);
  stats.firstRenderedMs??=relative;stats.lastRenderedMs=Math.max(stats.lastRenderedMs??relative,relative);stats.renderedSpanMs=stats.lastRenderedMs-stats.firstRenderedMs;
  if(stats.mode==='requested-rendered-frames'&&time-current.lastCapture>=1000/30){
   try{current.track.requestFrame();current.lastCapture=time;stats.captureRequests++;}
   catch(error){current.error=describeError(error);stop('frame-error');return false;}
  }
  if(stats.elapsedMs>=duration)stop('duration');return true;
 }
 const onHidden=()=>{if(doc.hidden)stop('hidden');};
 const onContextLost=()=>{if(session){session.error='The renderer context was lost during recording.';stop('context-loss');}};
 startButton.addEventListener('click',start);stopButton.addEventListener('click',stop);
 doc.addEventListener('visibilitychange',onHidden);canvas.addEventListener('webglcontextlost',onContextLost);
 return {
  start,stop,recordFrame,get active(){return !!session&&!session.stopping;},get stats(){updateElapsed();return {...stats};},
  dispose(){
   if(disposed)return;disposed=true;
   if(session){const current=session;session=null;runtime.clearTimeout(current.timer);runtime.clearTimeout(current.stopTimer);current.finished=true;
    current.recorder.ondataavailable=current.recorder.onstop=current.recorder.onerror=null;
    try{if(current.recorder.state!=='inactive')current.recorder.stop();}catch{ /* Still release tracks and buffers. */ }
    stopTracks(current.stream);current.chunks.length=0;
   }
   stats.phase='disposed';clearDownload();doc.removeEventListener('visibilitychange',onHidden);canvas.removeEventListener('webglcontextlost',onContextLost);ui.remove();
  },
 };
}
