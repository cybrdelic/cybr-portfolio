import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveQuality, estimateScale } from './instrument-adaptive.mjs';
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('GPU estimates account for the resolution at which the timestamp was measured', () => {
  const expected = Math.sqrt(33 / 96);
  near(estimateScale({ gpuMs: 96, scale: 1 }), expected);
  near(estimateScale({ gpuMs: 24, scale: .5 }), expected);
  assert.equal(estimateScale({ gpuMs: 300 }), .5);
  assert.equal(estimateScale({ gpuMs: 8 }), 1);
});

test('motion immediately uses recent stationary cost; still rendering keeps native resolution', () => {
  const quality = createAdaptiveQuality();
  assert.equal(quality.update({ moving: false, now: 0, gpuMs: 96, scale: 1 }), 1);
  assert.equal(quality.update({ moving: true, now: 16 }), .6);
  assert.equal(quality.snapshot().phase, 'moving');
  assert.equal(quality.snapshot().changes, 1);
});

test('settling spans brief gesture gaps and restores full resolution exactly once', () => {
  const quality = createAdaptiveQuality();
  assert.equal(quality.update({ moving: true, now: 0 }), .6);
  assert.equal(quality.update({ moving: false, now: 100 }), .6);
  assert.equal(quality.update({ moving: true, now: 150 }), .6);
  assert.equal(quality.update({ moving: false, now: 349 }), .6);
  assert.equal(quality.snapshot().phase, 'settling');
  assert.equal(quality.update({ moving: false, now: 350 }), 1);
  for (let now = 366; now < 1200; now += 16) assert.equal(quality.update({ moving: false, now, gpuMs: 200, scale: 1 }), 1);
  assert.equal(quality.snapshot().changes, 2);
});

test('timestamp noise around the motion budget does not cause repeated resizes', () => {
  const quality = createAdaptiveQuality();
  quality.update({ moving: false, now: 0, gpuMs: 96, scale: 1 });
  quality.update({ moving: true, now: 16 });
  for (let i = 1; i < 160; i++) {
    assert.equal(quality.update({ moving: true, now: 16 + i * 40, gpuMs: i % 2 ? 32 : 37, scale: .6, timingId: i }), .6);
  }
  assert.equal(quality.snapshot().changes, 1);
});

test('slow motion feedback reduces to the configured floor and cannot keep shrinking', () => {
  const quality = createAdaptiveQuality();
  assert.equal(quality.update({ moving: true, now: 0 }), .6);
  assert.equal(quality.update({ moving: true, now: 349, gpuMs: 90, scale: .6 }), .6);
  assert.equal(quality.update({ moving: true, now: 350, gpuMs: 90, scale: .6 }), .5);
  for (let i = 1; i < 10; i++) assert.equal(quality.update({ moving: true, now: 350 + i * 400, gpuMs: 70, scale: .5, timingId: i }), .5);
  assert.equal(quality.snapshot().changes, 2);
});

test('moving and stationary GPU costs remain separate and asynchronous timings retain their phase', () => {
  const quality = createAdaptiveQuality();
  quality.update({ moving: false, now: 0, gpuMs: 96, scale: 1, timingId: 1 });
  quality.update({ moving: true, now: 16, gpuMs: 36, scale: .6, timingId: 2 });
  quality.update({ moving: false, now: 40, gpuMs: 30, scale: .6, timingMoving: true, timingId: 3 });
  const state = quality.snapshot();
  assert.equal(state.stationaryGpu.count, 1);
  near(state.stationaryGpu.fullResolutionGpuMs, 96);
  assert.equal(state.movingGpu.count, 2);
  near(state.movingGpu.fullResolutionGpuMs, 100 * .8 + (30 / .36) * .2);
});

test('one GPU timestamp observed by many display frames counts once', () => {
  const quality = createAdaptiveQuality();
  for (let now = 0; now < 100; now += 16) quality.update({ moving: false, now, gpuMs: 96, scale: 1, timingId: 8 });
  assert.equal(quality.snapshot().stationaryGpu.count, 1);
  quality.update({ moving: false, now: 100, gpuMs: 96, scale: 1, timingId: 9 });
  assert.equal(quality.snapshot().stationaryGpu.count, 2);
});

test('fresh stationary feedback informs the next gesture instead of stale moving costs', () => {
  const quality = createAdaptiveQuality();
  quality.update({ moving: true, now: 0, gpuMs: 12, scale: 1, timingId: 1 });
  quality.update({ moving: false, now: 200 });
  for (let i = 0; i < 20; i++) quality.update({ moving: false, now: 300 + i * 20, gpuMs: 200, scale: 1, timingId: 2 + i });
  assert.equal(quality.update({ moving: true, now: 720 }), .5);
  assert.equal(quality.snapshot().movingGpu.count, 1);
});

test('missing or invalid timing uses bounded fallback and never lowers stationary quality', () => {
  for (const gpuMs of [undefined, NaN, Infinity, 0, -20]) {
    const quality = createAdaptiveQuality();
    assert.equal(quality.update({ moving: false, now: 0, gpuMs, scale: 1 }), 1);
    assert.equal(quality.update({ moving: true, now: 16, gpuMs, scale: 1 }), .6);
    assert.equal(quality.update({ moving: false, now: 216, gpuMs, scale: 1 }), 1);
    assert.equal(quality.snapshot().movingGpu.count, 0);
  }
  assert.equal(estimateScale({ gpuMs: 96, scale: 0 }), .65);
});

test('custom limits remain respected and invalid settings fail explicitly', () => {
  const quality = createAdaptiveQuality({ minScale: .7, maxScale: 1 });
  assert.equal(quality.update({ moving: true, now: 0, gpuMs: 300, scale: 1 }), .7);
  assert.equal(quality.update({ moving: false, now: 200 }), 1);
  assert.throws(() => createAdaptiveQuality({ targetMs: 0 }), RangeError);
  assert.throws(() => createAdaptiveQuality({ minScale: 1, maxScale: .5 }), RangeError);
});

test('queue completion cost governs motion when timestamp duration undercounts responsiveness', () => {
  const quality = createAdaptiveQuality();
  assert.equal(quality.update({ moving: false, now: 0, gpuMs: 1, queueMs: 120, queueDepth: 2, scale: 1, timingId: 1 }), 1);
  assert.equal(quality.update({ moving: true, now: 16 }), .75);
  const state = quality.snapshot();
  near(state.estimatedFullResolutionGpuMs, 1);
  near(state.estimatedFullResolutionCostMs, 60);
  near(state.stationaryGpu.gpuMs, 1);
  near(state.stationaryGpu.queueMs, 120);
  near(state.stationaryGpu.budgetMs, 60);
  assert.equal(state.stationaryGpu.queueDepth, 2);
  const heavier = createAdaptiveQuality();
  assert.equal(heavier.update({ moving: true, now: 0, gpuMs: 1, queueMs: 192, queueDepth: 2, scale: 1 }), .6);
});

test('queue-based estimates normalize measured resolution without relabeling wall time as GPU time', () => {
  const expected = Math.sqrt(33 / 96);
  near(estimateScale({ gpuMs: 1, queueMs: 192, queueDepth: 2, scale: 1 }), expected);
  near(estimateScale({ gpuMs: 1, queueMs: 48, queueDepth: 2, scale: .5 }), expected);
  const quality = createAdaptiveQuality();
  assert.equal(quality.update({ moving: true, now: 0, gpuMs: 1, queueMs: 48, queueDepth: 2, scale: .5, timingId: 2 }), .6);
  const state = quality.snapshot();
  near(state.estimatedFullResolutionGpuMs, 4);
  near(state.estimatedFullResolutionCostMs, 96);
  near(state.movingGpu.gpuMs, 1);
  near(state.movingGpu.budgetMs, 24);
});

test('queue-only timing survives unavailable timestamps and invalid depths; GPU cost still provides a floor', () => {
  const quality = createAdaptiveQuality();
  assert.equal(quality.update({ moving: true, now: 0, queueMs: 192, queueDepth: 2, scale: 1, timingId: 3 }), .6);
  assert.equal(quality.snapshot().estimatedFullResolutionGpuMs, null);
  assert.equal(quality.snapshot().movingGpu.gpuCount, 0);
  assert.equal(quality.snapshot().movingGpu.queueCount, 1);
  for (const queueDepth of [undefined, NaN, 0, -1]) near(estimateScale({ gpuMs: 1, queueMs: 60, queueDepth }), Math.sqrt(33 / 60));
  const gpuLimited = createAdaptiveQuality();
  gpuLimited.update({ moving: true, now: 0, gpuMs: 96, queueMs: 20, queueDepth: 2, scale: 1 });
  near(gpuLimited.snapshot().movingGpu.budgetMs, 96);
});

test('completed queue/GPU observations deduplicate by submission ID and stay stable under timing noise', () => {
  const quality = createAdaptiveQuality();
  quality.update({ moving: false, now: 0, gpuMs: 1, queueMs: 120, queueDepth: 2, scale: 1, timingId: 4 });
  for (let now = 16; now < 100; now += 16) quality.update({ moving: false, now, gpuMs: 1, queueMs: 120, queueDepth: 2, scale: 1, timingId: 4 });
  assert.equal(quality.snapshot().stationaryGpu.count, 1);
  assert.equal(quality.update({ moving: true, now: 100 }), .75);
  for (let i = 0; i < 120; i++) {
    assert.equal(quality.update({ moving: true, now: 140 + i * 40, gpuMs: 1, queueMs: i % 2 ? 65 : 76, queueDepth: 2, scale: .75, timingId: 5 + i }), .75);
  }
  assert.equal(quality.snapshot().changes, 1);
  assert.equal(quality.update({ moving: false, now: 5100 }), 1);
});

test('delayed queue completion remains in its submission motion phase', () => {
  const quality = createAdaptiveQuality();
  quality.update({ moving: false, now: 0, gpuMs: 1, queueMs: 120, queueDepth: 2, scale: 1, timingId: 1 });
  quality.update({ moving: true, now: 16 });
  quality.update({ moving: false, now: 60, gpuMs: .8, queueMs: 84, queueDepth: 2, scale: .75, timingMoving: true, timingId: 2 });
  const state = quality.snapshot();
  assert.equal(state.stationaryGpu.count, 1); assert.equal(state.movingGpu.count, 1);
  near(state.stationaryGpu.gpuMs, 1); near(state.stationaryGpu.budgetMs, 60);
  near(state.movingGpu.gpuMs, .8); near(state.movingGpu.queueMs, 84); near(state.movingGpu.budgetMs, 42);
  near(state.movingGpu.fullResolutionCostMs, 42 / .75 ** 2);
});
