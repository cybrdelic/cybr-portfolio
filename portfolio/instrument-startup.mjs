/** CPU scheduling and diagnostics only; it never changes texture contents. */
export function collectStartupTextures(materials){
  const seen=new Set(),textures=new Set();
  function visit(value,depth=0){
    if(!value||typeof value!=='object'||seen.has(value))return;
    seen.add(value);
    if(value.isTexture){
      if(!value.isRenderTargetTexture&&!value.isVideoTexture&&!value.isFramebufferTexture&&value.image)textures.add(value);
      return;
    }
    if(depth>8||ArrayBuffer.isView(value)||value instanceof ArrayBuffer)return;
    if(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype)for(const child of Object.values(value))visit(child,depth+1);
  }
  for(const material of materials){
    if(!material)continue;
    for(const value of Object.values(material))visit(value);
  }
  return [...textures];
}

export async function prepareStartupTextures({renderer,materials,clock=()=>performance.now(),yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0)),budgetMs=4,cancelled=()=>false}){
  if(typeof renderer?.initTexture!=='function'||!Array.isArray(materials)||!Number.isFinite(budgetMs)||budgetMs<=0)throw Error('Invalid startup texture preparation');
  const textures=collectStartupTextures(materials),records=[],started=clock();
  let yields=0,batchStart=started;
  for(const texture of textures){
    if(cancelled())throw Error('Startup texture preparation cancelled');
    const at=clock();
    renderer.initTexture(texture);
    records.push({name:texture.name||texture.uuid||'texture',durationMs:clock()-at,width:texture.image?.width??null,height:texture.image?.height??null});
    // Each GL upload is atomic; a large single upload can exceed this budget.
    if(clock()-batchStart>=budgetMs&&records.length<textures.length){
      await yieldTask();yields++;batchStart=clock();
    }
  }
  return {mode:'original unique texture uploads across main-thread tasks',textures:records.length,yields,budgetMs,elapsedMs:clock()-started,maxUploadMs:Math.max(0,...records.map(r=>r.durationMs)),records};
}

export function createStartupProfiler({clock=()=>performance.now()}={}){
  const started=clock(),blocks=[];
  return {run(name,work){
    const at=clock();let success=false;
    try{const result=work();success=true;return result;}
    finally{blocks.push({name,startMs:at,durationMs:clock()-at,success});}
  },snapshot(){return {startedMs:started,elapsedMs:clock()-started,blocks:blocks.map(block=>({...block})),timing:'Inclusive synchronous CPU submission durations; no GPU-duration measurement'};}};
}
