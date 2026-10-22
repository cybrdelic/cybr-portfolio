// One sample is one presentation begin/end, not one renderer.render call.
// Disjoint timer queries are sequential; preparation draws never enter them.
const PENDING_LIMIT=64,SAMPLE_LIMIT=180,POLL_MS=50,QUERY_LIFETIME_MS=10000;

export function createFrameProfile(renderer,{clock=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout}={}){
 const gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 const render=renderer.render,setTarget=renderer.setRenderTarget,pending=[],samples=new Map();
 let frame=null,current=null,timer=null,nextPollAt=0,disposed=false,renderDepth=0,preparationDepth=0,sequence=0;
 let discardedGpuFrames=0,skippedGpuFrames=0,disjointEvents=0;
 const targetLabel=target=>target?`target-${target.width}x${target.height}-${target.texture?.type??'unknown'}`:'main';
 function record(key,field,value,order){
  if(!samples.has(key))samples.set(key,{cpu:[],gpu:[]});
  const values=samples.get(key)[field];values.push({value,order});
  // Query completion order is not necessarily presentation order.
  if(values.length>1&&values.at(-2).order>order)values.sort((a,b)=>a.order-b.order);
  if(values.length>SAMPLE_LIMIT)values.shift();
 }
 function finish(group){
  if(!group.sealed||group.waiting||group.reported)return;
  group.reported=true;
  if(!group.accepted)return;
  if(!group.queries){if(ext)skippedGpuFrames++;return;}
  if(group.invalid){discardedGpuFrames++;return;}
  let total=0;
  for(const [pass,ms] of group.passes){record(group.key+'/'+pass,'gpu',ms,group.sequence);total+=ms;}
  record(group.key,'gpu',total,group.sequence);
 }
 function deletePending(index,invalid=false){
  const entry=pending[index];if(invalid)entry.group.invalid=true;
  gl.deleteQuery(entry.query);pending.splice(index,1);entry.group.waiting--;finish(entry.group);
 }
 function stopDrain(){if(timer!==null){cancel(timer);timer=null;}}
 function poll(){
  if(disposed||!pending.length){stopDrain();return;}
  const time=clock();if(time<nextPollAt)return;nextPollAt=time+POLL_MS;
  const lost=gl.isContextLost?.()===true,disjoint=!lost&&gl.getParameter(ext.GPU_DISJOINT_EXT);
  if(disjoint){disjointEvents++;if(frame)frame.invalid=true;}
  for(let i=pending.length-1;i>=0;i--){
   const entry=pending[i];
   if(lost||disjoint||time-entry.createdAt>QUERY_LIFETIME_MS){deletePending(i,true);continue;}
   // Never request QUERY_RESULT before the nonblocking availability flag.
   if(!gl.getQueryParameter(entry.query,gl.QUERY_RESULT_AVAILABLE))continue;
   const ms=gl.getQueryParameter(entry.query,gl.QUERY_RESULT)/1e6;
   if(!Number.isFinite(ms)||ms<0)entry.group.invalid=true;
   else entry.group.passes.set(entry.label,(entry.group.passes.get(entry.label)||0)+ms);
   deletePending(i);
  }
  if(!pending.length)stopDrain();
 }
 function drain(){timer=null;poll();scheduleDrain();}
 function scheduleDrain(){
  if(disposed||timer!==null||!pending.length)return;
  timer=schedule(drain,Math.max(POLL_MS,nextPollAt-clock()));timer?.unref?.();
 }
 function close(){
  if(!current)return;
  const entry=current;current=null;
  // Do not terminate somebody else's query if external instrumentation changed
  // the GL timer target. The incomplete frame is rejected, never undercounted.
  if(gl.getQuery&&gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)!==entry.query){
   entry.group.invalid=true;gl.deleteQuery(entry.query);return;
  }
  gl.endQuery(ext.TIME_ELAPSED_EXT);entry.group.waiting++;pending.push(entry);scheduleDrain();
 }
 function open(label){
  if(!frame||current||!ext||frame.invalid||preparationDepth||disposed)return;
  if(pending.length>=PENDING_LIMIT||gl.isContextLost?.()===true){frame.invalid=true;return;}
  if(gl.getQuery&&gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)){
   frame.invalid=true;return;
  }
  const query=gl.createQuery();if(!query){frame.invalid=true;return;}
  gl.beginQuery(ext.TIME_ELAPSED_EXT,query);frame.queries++;
  current={query,group:frame,label,createdAt:clock()};
 }
 function discardQueries(group){
  for(let i=pending.length-1;i>=0;i--)if(pending[i].group===group)deletePending(i);
  if(!pending.length)stopDrain();
 }
 function seal(rendered){
  if(!frame)return;
  close();const group=frame;frame=null;group.sealed=true;
  group.accepted=rendered!==false&&group.draws>0;
  record(group.key,'cpu',clock()-group.startedAt,group.sequence);
  if(group.draws)record(group.key+'/draw','cpu',group.drawMs,group.sequence);
  if(!group.accepted)discardQueries(group);
  finish(group);
 }
 const wrappedTarget=function(target,...args){
  const label=targetLabel(target),measured=Boolean(current)&&current.label!==label;if(measured)close();
  try{
   const result=setTarget.call(this,target,...args);
   if(measured)open(label);
   return result;
  }catch(error){if(frame)frame.invalid=true;throw error;}
 };
 const wrappedRender=function(scene,...args){
  if(disposed||!frame)return render.call(this,scene,...args);
  if(preparationDepth||scene.userData?.preparingBuffers){
   const resume=Boolean(current);close();preparationDepth++;
   try{return render.call(this,scene,...args);}
   finally{preparationDepth--;if(resume)open(targetLabel(renderer.getRenderTarget?.()??null));}
  }
  const topLevel=renderDepth===0,startedAt=topLevel?clock():0;
  if(topLevel)frame.draws++;
  open(targetLabel(renderer.getRenderTarget?.()??null));renderDepth++;
  try{return render.call(this,scene,...args);}
  catch(error){frame.invalid=true;throw error;}
  finally{renderDepth--;if(topLevel&&frame)frame.drawMs+=clock()-startedAt;}
 };
 renderer.render=wrappedRender;renderer.setRenderTarget=wrappedTarget;
 return {
  begin(key){
   if(disposed)return;
   // An unmatched begin abandons the incomplete old frame, rather than nesting
   // elapsed queries or combining two chapter identities in one sample.
   if(frame)seal(false);poll();
   frame={key,sequence:sequence++,startedAt:clock(),drawMs:0,draws:0,queries:0,waiting:0,passes:new Map(),invalid:false,sealed:false,accepted:false,reported:false};
  },
  end(rendered=true){if(!disposed)seal(rendered);},
  snapshot(){
   poll();const result={gpuTimerAvailable:!!ext,pendingQueries:pending.length+(current?1:0),discardedGpuFrames,skippedGpuFrames,disjointEvents};
   const stats=values=>{const sorted=values.map(entry=>entry.value).sort((a,b)=>a-b),round=value=>value===undefined?null:+value.toFixed(2);return {samples:sorted.length,medianMs:round(sorted[Math.floor(sorted.length*.5)]),p95Ms:round(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]),maxMs:round(sorted.at(-1)),lastMs:round(values.at(-1)?.value)};};
   for(const [key,values] of samples)result[key]={cpu:stats(values.cpu),gpu:stats(values.gpu)};
   return result;
  },
  dispose(){
   if(disposed)return;
   if(frame)seal(false);disposed=true;stopDrain();
   if(renderer.render===wrappedRender)renderer.render=render;
   if(renderer.setRenderTarget===wrappedTarget)renderer.setRenderTarget=setTarget;
   for(const entry of pending)gl.deleteQuery(entry.query);pending.length=0;
  }
 };
}
