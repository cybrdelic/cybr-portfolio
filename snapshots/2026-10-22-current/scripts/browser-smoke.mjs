import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {startServer} from './serve.mjs';
const capabilityOnly=process.argv.includes('--capabilities-only');
const output=new URL(capabilityOnly?'../evidence/browser/capabilities/':'../evidence/browser/',import.meta.url);await mkdir(output,{recursive:true});
const {server,url}=await startServer();
let browser;
const results=[];let currentPage;
const record=async()=>writeFile(new URL('results.json',output),JSON.stringify({platform:process.platform,browser:browser?.version()??null,softwareRendering:!!process.env.CI,results},null,2));
try{
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||undefined,args:process.env.CI?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});
 if(!capabilityOnly)for(const viewport of [{width:1280,height:800},{width:390,height:844}]){
  const context=await browser.newContext({viewport,deviceScaleFactor:1,reducedMotion:'reduce'});
  const page=await context.newPage();currentPage=page;const failures=[];
  page.on('pageerror',e=>failures.push(e.message));page.on('console',m=>{if(m.type()==='error')failures.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)failures.push(`${r.status()} ${r.url()}`);});
  await page.goto(`${url}/portfolio/directions.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.ready==='true',null,{timeout:180000});
  for(const chapter of ['geo','light','material','elements','song','combat','scenes']){
   const started=Date.now();console.log(`Checking ${chapter} ${viewport.width}x${viewport.height}`);
   await page.locator(`#chapters [data-chapter="${chapter}"]`).click();
   await page.waitForFunction(key=>document.body.dataset.chapter===key&&document.body.dataset.ready==='true',chapter,{timeout:180000});
   const state=await page.evaluate(()=>{
    const viewport={width:innerWidth,height:innerHeight};
    const nav=[...document.querySelectorAll('#chapters button')].map(b=>{const r=b.getBoundingClientRect();return {name:b.textContent,x:r.x,y:r.y,width:r.width,height:r.height};});
    const metrics=JSON.parse(document.querySelector('#metrics').textContent);
    return {chapter:document.body.dataset.chapter,status:document.querySelector('#status').textContent,viewport,nav,overflow:document.documentElement.scrollWidth>innerWidth,metrics};
   });
   assert.equal(state.overflow,false);
   for(const b of state.nav){assert.ok(b.x>=0&&b.x+b.width<=viewport.width+1&&b.y>=0&&b.y+b.height<=viewport.height+1,JSON.stringify(b));assert.ok(b.width>=44&&b.height>=44);}
   assert.equal(state.metrics.context,null);assert.deepEqual(state.metrics.errors,[]);assert.deepEqual(state.metrics.projects.errors,[]);
   if(chapter==='scenes')assert.match(state.status,/Full finish unavailable/);
   if(['geo','elements','scenes'].includes(chapter))await page.screenshot({path:fileURLToPath(new URL(`${chapter}-${viewport.width}.png`,output))});
   results.push({viewport,chapter,seconds:(Date.now()-started)/1000,passed:true,state});await record();
  }
  assert.deepEqual(failures,[]);
  await context.close();
 }
 for(const capability of ['WebGL2RenderingContext','DecompressionStream','crypto','float-targets']){
  const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();currentPage=page;
  await page.addInitScript(key=>{
   if(key==='float-targets'){
    const original=WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension=function(name){return name==='EXT_color_buffer_float'?null:original.call(this,name);};
   }else Object.defineProperty(globalThis,key,{configurable:true,value:undefined});
  },capability);
  await page.goto(`${url}/portfolio/directions.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.runtime==='unavailable');
  const message=await page.locator('[role="alert"]').innerText();assert.ok(message.length>40);
  assert.equal(await page.locator('button:enabled').count(),0);
  assert.equal(await page.locator('.shadow-headline').isVisible(),false,'unrendered decoration must not obscure capability errors');
  results.push({capability,passed:true,message});await record();
  if(capability==='WebGL2RenderingContext')await page.screenshot({path:fileURLToPath(new URL('fallback-webgl.png',output))});
  await context.close();
 }
 console.log(`PASS ${results.length} browser checks on ${process.platform}, Chrome ${browser.version()}`);
}catch(error){
 results.push({passed:false,error:error.stack});await record();
 if(currentPage&&!currentPage.isClosed()){
  await currentPage.screenshot({path:fileURLToPath(new URL('failure.png',output))}).catch(()=>{});
  await writeFile(new URL('failure-state.txt',output),await currentPage.locator('body').innerText().catch(()=>''));
  await writeFile(new URL('failure-metrics.json',output),await currentPage.evaluate(()=>JSON.stringify({dataset:{...document.body.dataset},status:document.querySelector('#status')?.textContent,metrics:document.querySelector('#metrics')?.textContent},null,2)).catch(()=>''));
 }
 throw error;
}finally{
 server.closeAllConnections();
 try{await browser?.close();}
 finally{await new Promise(resolve=>server.close(resolve));}
}
