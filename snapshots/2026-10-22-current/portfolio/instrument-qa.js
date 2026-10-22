// Opt-in local QA only. The normal page creates no observer, timer, or RAF loop.
if (new URLSearchParams(location.search).has('audit')) {
  const state = {longTasks:[],cls:0,lcpMs:null};
  const observers=[];
  for (const type of ['longtask','layout-shift','largest-contentful-paint']) {
    try {
      const observer=new PerformanceObserver(list => {
        for(const entry of list.getEntries()) {
          if(type==='longtask') state.longTasks.push({startMs:Math.round(entry.startTime),durationMs:Math.round(entry.duration)});
          if(type==='layout-shift'&&!entry.hadRecentInput) state.cls+=entry.value;
          if(type==='largest-contentful-paint') state.lcpMs=Math.round(entry.startTime);
        }
      });
      observer.observe({type,buffered:true}); observers.push(observer);
    } catch {}
  }
  window.addEventListener('load', () => setTimeout(() => {
    const nav=performance.getEntriesByType('navigation')[0];
    const report={...state,viewport:[innerWidth,innerHeight],loadMs:Math.round(nav.loadEventEnd),resourceBytes:performance.getEntriesByType('resource').reduce((n,e)=>n+e.encodedBodySize,0),brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,canvases:document.querySelectorAll('canvas').length};
    const details=document.createElement('details');details.className='audit';
    const summary=document.createElement('summary');summary.textContent='Local browser check';
    const pre=document.createElement('pre');pre.id='instrument-audit';pre.textContent=JSON.stringify(report,null,2);
    details.append(summary,pre);document.body.append(details);
    observers.forEach(o=>o.disconnect());
  },4000),{once:true});
}
