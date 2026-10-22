import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the expression actually assigned to the page, without creating a
// browser/GPU or a second implementation of the readiness rules.
const source=await readFile(new URL('./directions.mjs',import.meta.url),'utf8');
const assignment=source.match(/document\.body\.dataset\.ready=String\(([^;]+)\);/);
assert.ok(assignment,'production readiness assignment must be inspectable');
const readyExpression=assignment[1];
const context=overrides=>({contextLoss:null,irisRenderError:null,frameRendered:true,frameReused:false,irisPending:false,
 waiting:false,environmentReady:true,surfaces:null,id:'11',issue:null,s:{key:'geo'},
 projects:{state:{},fluid:()=>null},outdoorTarget:null,...overrides});
const ready=overrides=>vm.runInNewContext(readyExpression,context(overrides));

test('ready requires an actually presented frame, not only loaded resources',()=>{
 assert.equal(ready(),true);
 assert.equal(ready({frameRendered:false}),false,'silent false return from a stage must not become ready');
 assert.equal(ready({irisPending:true}),false);
 assert.equal(ready({irisRenderError:'first-use link failure'}),false,'render failure is independently guarded');
 assert.equal(ready({contextLoss:{lost:true}}),false,'a lost graphics context cannot retain its previous ready state');
 assert.equal(ready({issue:'asset failure'}),false);
 assert.equal(ready({waiting:true}),false);
});

test('intentional cached beauty remains ready without a redundant GPU draw',()=>{
 assert.match(source,/reusedBeautyFrames\+\+;frameRendered=false;frameReused=true;/);
 assert.equal(ready({frameRendered:false,frameReused:true,s:{key:'scenes'},outdoorTarget:{}}),true);
 assert.equal(ready({frameRendered:false,frameReused:true,id:'27',surfaces:{},s:{key:'elements'}}),true);
 assert.equal(ready({frameRendered:false,frameReused:true,irisRenderError:'failure'}),false);
 assert.equal(ready({frameRendered:false,frameReused:true,s:{key:'scenes'}}),false,'required landscape environment still gates ready');
});

test('first-use shader exceptions are latched once and cannot report ready',()=>{
 const start=source.indexOf('function renderIrisStage(options){');
 const end=source.indexOf("\nif(id==='11'){",start);
 assert.ok(start>=0&&end>start,'production guarded draw must exist');
 let attempts=0;
 const scope=vm.createContext(context({renderer:{},errors:[],irisStage:{render(){attempts++;throw new Error('synthetic link failure');}}}));
 vm.runInContext(source.slice(start,end),scope);
 assert.equal(vm.runInContext('renderIrisStage({})',scope),false);
 assert.equal(vm.runInContext('renderIrisStage({})',scope),false);
 assert.equal(attempts,1);
 assert.equal(scope.errors.length,1);
 assert.match(scope.irisRenderError,/synthetic link failure/);
 assert.equal(vm.runInContext(readyExpression,scope),false);
});

test('context loss cancels pending work and immediately replaces stale successful diagnostics',()=>{
 const start=source.indexOf('function handleContextLost(event){');
 const end=source.indexOf("\ncanvas.addEventListener('webglcontextlost',handleContextLost);",start);
 assert.ok(start>=0&&end>start,'production context-loss handler must be registered');
 const nodes={'#status':{textContent:''},'#metrics':{textContent:JSON.stringify({chapter:'elements',drawCalls:9,errors:[]})}};
 let stopped=0,prevented=0;const cancelled=[];
 const scope=vm.createContext(context({disposed:false,raf:37,last:25,errors:[],
  document:{body:{dataset:{chapter:'elements',ready:'true',settled:'true'}}},
  $:selector=>nodes[selector],stopIrisCompileNotice:()=>stopped++,cancelAnimationFrame:handle=>cancelled.push(handle)}));
 vm.runInContext(source.slice(start,end),scope);
 const event={preventDefault(){prevented++;},statusMessage:'driver diagnostic '.repeat(100)};
 scope.event=event;vm.runInContext('handleContextLost(event)',scope);
 assert.equal(prevented,1);assert.equal(stopped,1);assert.deepEqual(cancelled,[37]);
 assert.equal(scope.disposed,true);assert.equal(scope.raf,0);assert.equal(scope.last,0);
 assert.equal(scope.document.body.dataset.ready,'false');assert.equal(scope.document.body.dataset.settled,'false');
 assert.equal(scope.document.body.dataset.context,'lost');
 const metrics=JSON.parse(nodes['#metrics'].textContent);
 assert.equal(metrics.chapter,'elements');assert.equal(metrics.drawCalls,9);
 assert.equal(metrics.ready,false);assert.equal(metrics.settled,false);assert.equal(metrics.context.lost,true);
 assert.equal(metrics.context.reason.length,384);assert.equal(metrics.errors.length,1);
 assert.ok(metrics.errors[0].length<512);assert.match(metrics.errors[0],/WebGL context lost during elements/);
 assert.match(nodes['#status'].textContent,/Reload this direction/);
 assert.equal(vm.runInContext(readyExpression,scope),false);
 nodes['#metrics'].textContent='not valid JSON';vm.runInContext('handleContextLost(event)',scope);
 assert.equal(scope.errors.length,1,'duplicate notifications should not repeat the same error');
 assert.equal(JSON.parse(nodes['#metrics'].textContent).context.lost,true,'malformed prior diagnostics cannot suppress the failure');
});
