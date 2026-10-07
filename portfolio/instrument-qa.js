// Opt-in local QA only. The normal page creates no observer, timer, or RAF loop.
if (new URLSearchParams(location.search).has('audit')) {
  const state = {longTasks:[],events:[],cls:0,lcpMs:null};
  const observers=[];
  for (const type of ['longtask','layout-shift','largest-contentful-paint','event']) {
    try {
      const observer=new PerformanceObserver(list => {
        for(const entry of list.getEntries()) {
          if(type==='longtask') state.longTasks.push({startMs:Math.round(entry.startTime),durationMs:Math.round(entry.duration)});
          if(type==='layout-shift'&&!entry.hadRecentInput) state.cls+=entry.value;
          if(type==='largest-contentful-paint') state.lcpMs=Math.round(entry.startTime);
          if(type==='event'&&state.events.length<1000) state.events.push({name:entry.name,startMs:entry.startTime,durationMs:entry.duration,processingDelayMs:entry.processingStart-entry.startTime,processingMs:entry.processingEnd-entry.processingStart,interactionId:entry.interactionId});
        }
      });
      observer.observe({type,buffered:true,...(type==='event'?{durationThreshold:16}:{})}); observers.push(observer);
    } catch {}
  }
  // Keep the observer through full-model startup; the former four-second
  // report missed the later shader/material stalls. No instrumentation runs
  // on ordinary visits, and this is browser evidence rather than phone INP.
  window.instrumentQA={snapshot:()=>({...state,longTasks:state.longTasks.slice(),events:state.events.slice(),navigation:performance.getEntriesByType('navigation')[0]?.toJSON(),resourceBytes:performance.getEntriesByType('resource').reduce((n,e)=>n+e.encodedBodySize,0)})};
  window.addEventListener('pagehide',()=>observers.forEach(observer=>observer.disconnect()),{once:true});
  window.addEventListener('load', () => setTimeout(() => {
    const nav=performance.getEntriesByType('navigation')[0];
    const report={...state,viewport:[innerWidth,innerHeight],loadMs:Math.round(nav.loadEventEnd),resourceBytes:performance.getEntriesByType('resource').reduce((n,e)=>n+e.encodedBodySize,0),brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,canvases:document.querySelectorAll('canvas').length};
    const details=document.createElement('details');details.className='audit';
    const summary=document.createElement('summary');summary.textContent='Local browser check';
    const pre=document.createElement('pre');pre.id='instrument-audit';pre.textContent=JSON.stringify(report,null,2);
    details.append(summary,pre);document.body.append(details);
  },4000),{once:true});
}
