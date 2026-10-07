import test from 'node:test';
import assert from 'node:assert/strict';
import { createRasterTiming } from './instrument-raster-timing.mjs';

function fakeContext({ supported = true } = {}) {
  const timer = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb }, debug = { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 };
  const queries = [], deleted = [], reads = []; let current = null, broken = false, lost = false;
  const gl = {
    QUERY_RESULT_AVAILABLE: 0x8867, QUERY_RESULT: 0x8866, CURRENT_QUERY: 0x8865, VENDOR: 0x1f00, RENDERER: 0x1f01, VERSION: 0x1f02,
    getExtension: name => name === 'WEBGL_debug_renderer_info' ? debug : supported && name === 'EXT_disjoint_timer_query_webgl2' ? timer : null,
    getParameter: key => key === timer.GPU_DISJOINT_EXT ? broken : key === debug.UNMASKED_VENDOR_WEBGL ? 'Test Vendor' : key === debug.UNMASKED_RENDERER_WEBGL ? 'Test GPU' : 'WebGL 2.0',
    getQuery: (target, name) => { assert.equal(target, timer.TIME_ELAPSED_EXT); assert.equal(name, gl.CURRENT_QUERY); return current; },
    createQuery: () => { const query = { id: queries.length, available: false, result: null, ended: false }; queries.push(query); return query; },
    beginQuery: (target, query) => { assert.equal(target, timer.TIME_ELAPSED_EXT); assert.equal(current, null); current = query; },
    endQuery: target => { assert.equal(target, timer.TIME_ELAPSED_EXT); assert.ok(current); current.ended = true; current = null; },
    getQueryParameter: (query, key) => {
      assert.ok(query.ended && !deleted.includes(query)); reads.push([query.id, key]);
      if (key === gl.QUERY_RESULT_AVAILABLE) return query.available;
      assert.equal(key, gl.QUERY_RESULT); assert.ok(query.available, 'Result read must never wait for unavailable work'); return query.result;
    },
    deleteQuery: query => { assert.notEqual(query, current, 'Do not delete an active query'); assert.ok(!deleted.includes(query)); deleted.push(query); },
    isContextLost: () => lost,
    finish: () => { throw new Error('Synchronous GPU waits are forbidden'); },
    fenceSync: () => { throw new Error('Explicit fences are forbidden'); }
  };
  return { gl, queries, deleted, reads, setDisjoint: value => { broken = value; }, setLost: value => { lost = value; }, setExternalQuery: query => { current = query; },
    complete: (id, nanoseconds) => { queries[id].result = nanoseconds; queries[id].available = true; } };
}
const timingFor = context => createRasterTiming({ getContext: () => context.gl });

test('GPU work remains pending until available and GPU duration is independent of CPU submit/cadence', () => {
  const context = fakeContext(), timing = timingFor(context);
  assert.equal(timing.begin('moving'), true); assert.equal(timing.end(), true);
  timing.recordFrame({ now: 100, moving: true, submitMs: .25 }); timing.recordFrame({ now: 116, moving: true, submitMs: .35 });
  assert.equal(timing.poll(), 0); assert.equal(timing.snapshot().gpuMs, null);
  assert.ok(context.reads.every(([, kind]) => kind === context.gl.QUERY_RESULT_AVAILABLE));
  context.complete(0, 18000000); assert.equal(timing.poll(), 1);
  const state = timing.snapshot();
  assert.equal(state.gpuMs, 18); assert.equal(state.meanGpuMs, 18); assert.equal(state.gpuSamples, 1);
  assert.equal(state.meanCpuSubmitMs, .3); assert.equal(state.meanMovingFrameIntervalMs, 16);
  assert.equal(state.phases.moving.gpuSamples, 1); assert.equal(context.deleted.length, 1);
  assert.deepEqual(state.adapter, { vendor: 'Test Vendor', renderer: 'Test GPU', version: 'WebGL 2.0', unmasked: true });
});

test('four-query bound skips measurement while rendering can continue and reuses capacity after asynchronous completion', () => {
  const context = fakeContext(), timing = timingFor(context);
  for (let i = 0; i < 4; i++) { assert.equal(timing.begin('frame'), true); assert.equal(timing.end(), true); }
  assert.equal(timing.begin(), false); assert.equal(context.queries.length, 4); assert.equal(timing.snapshot().skippedQueries, 1);
  context.complete(1, 12000000); assert.equal(timing.poll(), 1);
  assert.equal(timing.snapshot().pendingQueries, 3); assert.equal(timing.begin('stationary'), true); assert.equal(timing.end(), true);
  assert.equal(timing.snapshot().pendingQueries, 4); assert.equal(timing.snapshot().phases.frame.gpuMs, 12);
  timing.dispose(); assert.equal(context.deleted.length, 5);
});

test('disjoint epochs reject pending and active results then allow fresh valid measurements', () => {
  const context = fakeContext(), timing = timingFor(context);
  timing.begin('moving'); timing.end(); context.complete(0, 9000000);
  timing.begin('moving'); context.setDisjoint(true);
  assert.equal(timing.poll(), 0); assert.equal(timing.poll(), 0);
  assert.equal(timing.end(), false); assert.equal(timing.begin(), false);
  assert.equal(timing.snapshot().disjointEvents, 1); assert.equal(timing.snapshot().rejectedQueries, 2); assert.equal(timing.snapshot().gpuSamples, 0);
  context.setDisjoint(false); timing.begin('stationary'); timing.end(); context.complete(2, 7000000); timing.poll();
  assert.equal(timing.snapshot().phases.stationary.gpuMs, 7); assert.equal(timing.snapshot().gpuSamples, 1);
});

test('missing timer extension retains CPU metrics and excludes idle gaps from moving cadence', () => {
  const context = fakeContext({ supported: false }), timing = timingFor(context);
  assert.equal(timing.begin(), false); assert.equal(timing.end(), false); assert.equal(timing.poll(), 0);
  timing.recordFrame({ now: 0, moving: true, submitMs: 1 }); timing.recordFrame({ now: 16, moving: true, submitMs: 2 });
  timing.recordFrame({ now: 32, moving: false, submitMs: 3 }); timing.recordFrame({ now: 10000, moving: false, submitMs: 4 });
  timing.recordFrame({ now: 10100, moving: true, submitMs: 5 }); timing.recordFrame({ now: 10120, moving: true, submitMs: 6 });
  const state = timing.snapshot();
  assert.equal(state.supported, false); assert.equal(state.gpuMs, null); assert.equal(context.queries.length, 0);
  assert.equal(state.meanCpuSubmitMs, 3.5); assert.equal(state.cadenceSamples, 2); assert.equal(state.meanMovingFrameIntervalMs, 18);
});

test('foreign active queries and nested calls are preserved; disposing deletes only owned resources', () => {
  const context = fakeContext(), timing = timingFor(context), foreign = { external: true };
  context.setExternalQuery(foreign); assert.equal(timing.begin(), false); assert.equal(context.queries.length, 0);
  context.setExternalQuery(null); assert.equal(timing.begin(), true); assert.equal(timing.begin(), false);
  timing.dispose(); timing.dispose(); assert.equal(context.deleted.length, 1);
  assert.equal(timing.begin(), false); assert.equal(timing.end(), false); assert.equal(timing.poll(), 0);
  assert.equal(timing.snapshot().disposed, true);
});

test('invalid GPU results are rejected and bounded means cover the newest 120 valid samples', () => {
  const context = fakeContext(), timing = timingFor(context);
  for (const duration of [-1, NaN, Infinity]) { timing.begin(); timing.end(); context.complete(context.queries.length - 1, duration); timing.poll(); }
  assert.equal(timing.snapshot().rejectedQueries, 3); assert.equal(timing.snapshot().gpuMs, null);
  for (let i = 1; i <= 130; i++) { timing.begin('moving'); timing.end(); context.complete(context.queries.length - 1, i * 1e6); timing.poll(); }
  assert.equal(timing.snapshot().gpuSamples, 130); assert.equal(timing.snapshot().meanGpuMs, 70.5); assert.equal(timing.snapshot().phases.moving.meanGpuMs, 70.5);
});

test('CPU-only measurement never polls GPU state or allocates queries while preserving CPU metrics',()=>{
  const context=fakeContext(),original=context.gl.getParameter;
  context.gl.getParameter=key=>{if(key===0x8fbb)assert.fail('CPU-only mode must not ask for driver disjoint state');return original(key);};
  context.gl.getQueryParameter=()=>assert.fail('CPU-only mode must not poll GPU queries');
  const timing=createRasterTiming({getContext:()=>context.gl},{gpuQueries:false});
  assert.equal(timing.begin(),false);assert.equal(timing.end(),false);assert.equal(timing.poll(),0);
  timing.recordFrame({now:100,moving:true,submitMs:2});timing.recordFrame({now:120,moving:true,submitMs:4});
  const state=timing.snapshot();assert.equal(state.supported,true);assert.equal(state.enabled,false);
  assert.equal(state.gpuQueriesRequested,false);assert.equal(state.meanCpuSubmitMs,3);assert.equal(state.meanMovingFrameIntervalMs,20);
  assert.equal(state.pendingQueries,0);assert.equal(context.queries.length,0);timing.dispose();
});
