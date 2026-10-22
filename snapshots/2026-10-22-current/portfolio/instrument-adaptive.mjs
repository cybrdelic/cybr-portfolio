// Resolution changes alter ray count, never the instrument's geometry or
// transport. Keep the levels coarse because a resize invalidates convergence.
const LEVELS = [.5, .6, .75, 1];
const FALLBACK_SCALE = .65;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const positive = value => Number.isFinite(value) && value > 0;
function frameBudget(gpuMs, queueMs, queueDepth = 1) {
  // Submission-to-completion wall time includes queue contention and other
  // GPU clients. Amortize by the depth recorded for this submission; this is
  // a responsiveness proxy, not a replacement GPU timestamp measurement.
  const queueCost = positive(queueMs) ? queueMs / Math.max(1, positive(queueDepth) ? queueDepth : 1) : 0;
  const cost = Math.max(positive(gpuMs) ? gpuMs : 0, queueCost);
  return positive(cost) ? cost : null;
}

/** Estimate scale from a measured frame cost at `scale`, not at full size. */
export function estimateScale({ gpuMs, queueMs, queueDepth = 1, budgetMs, scale = 1, targetMs = 33, minScale = .5, maxScale = 1 } = {}) {
  const cost = positive(budgetMs) ? budgetMs : frameBudget(gpuMs, queueMs, queueDepth);
  const estimate = cost !== null && positive(scale) && positive(targetMs)
    ? scale * Math.sqrt(targetMs / cost) : FALLBACK_SCALE;
  return clamp(estimate, minScale, maxScale);
}

export function createAdaptiveQuality({ targetMs = 33, minScale = .5, maxScale = 1, settleMs = 200 } = {}) {
  if (!positive(targetMs) || !positive(minScale) || !positive(maxScale) || minScale > maxScale || maxScale > 1
    || !Number.isFinite(settleMs) || settleMs < 0) throw new RangeError('Invalid adaptive quality settings');
  const levels = [...new Set([minScale, ...LEVELS.filter(value => value > minScale && value < maxScale), maxScale])].sort((a, b) => a - b);
  const nearest = value => levels.reduce((best, next) => Math.abs(next - value) < Math.abs(best - value) ? next : best, levels[0]);
  const emptySummary = () => ({ count: 0, gpuCount: 0, queueCount: 0, gpuMs: null, fullResolutionGpuMs: null, queueMs: null, queueDepth: null, budgetMs: null, fullResolutionCostMs: null, lastScale: null, lastObservedAt: null });
  const summaries = { moving: emptySummary(), stationary: emptySummary() };
  let currentScale = maxScale, phase = 'stationary', lastNow = null, lastMotionAt = -Infinity, motionStartedAt = -Infinity, lastChangeAt = -Infinity, changes = 0, timingToken = null;

  function recordTiming(gpuMs, queueMs, queueDepth, sampleScale, timingMoving, timingId, now) {
    const budget = frameBudget(gpuMs, queueMs, queueDepth);
    if (budget === null || !positive(sampleScale) || sampleScale > 1) return;
    const kind = timingMoving ? 'moving' : 'stationary';
    // The display loop can observe one timestamp many times. A caller that has
    // a submission counter can supply timingId, including equal-cost samples.
    const token = timingId === undefined ? `${kind}:${gpuMs}:${queueMs}:${queueDepth}:${sampleScale}` : `id:${timingId}`;
    if (token === timingToken) return;
    timingToken = token;
    const summary = summaries[kind], pixels = sampleScale * sampleScale;
    const blend = (old, value) => old === null ? value : old * .8 + value * .2;
    if (positive(gpuMs)) {
      summary.gpuMs = blend(summary.gpuMs, gpuMs);
      summary.fullResolutionGpuMs = blend(summary.fullResolutionGpuMs, gpuMs / pixels);
      summary.gpuCount++;
    }
    if (positive(queueMs)) {
      summary.queueMs = blend(summary.queueMs, queueMs);
      summary.queueDepth = Math.max(1, positive(queueDepth) ? queueDepth : 1);
      summary.queueCount++;
    }
    summary.budgetMs = blend(summary.budgetMs, budget);
    summary.fullResolutionCostMs = blend(summary.fullResolutionCostMs, budget / pixels);
    summary.lastScale = sampleScale;
    summary.lastObservedAt = now;
    summary.count++;
  }
  function fullCost(field = 'fullResolutionCostMs') {
    const motion = summaries.moving, still = summaries.stationary;
    if (phase === 'moving' && motion.lastObservedAt !== null && motion.lastObservedAt >= motionStartedAt && motion[field] !== null) return motion[field];
    if (still[field] !== null && still.lastObservedAt !== null && (motion.lastObservedAt === null || still.lastObservedAt >= motion.lastObservedAt)) return still[field];
    return motion[field] ?? still[field];
  }
  function changeScale(value, now) {
    if (value !== currentScale) { currentScale = value; lastChangeAt = now; changes++; }
  }

  /**
   * `scale`, queueDepth and timingMoving belong to the measured submission.
   * Supply GPU and queue completion results together with one timingId; a
   * display loop observing that result repeatedly must not count it again.
   */
  function update({ moving = false, now, gpuMs, queueMs, queueDepth = 1, scale = currentScale, timingMoving = moving, timingId } = {}) {
    const clock = now === undefined ? (globalThis.performance?.now?.() ?? Date.now())
      : Number.isFinite(now) ? now : (lastNow ?? globalThis.performance?.now?.() ?? Date.now());
    now = Math.max(lastNow ?? clock, clock); lastNow = now;
    recordTiming(gpuMs, queueMs, queueDepth, scale, timingMoving, timingId, now);
    if (moving) {
      lastMotionAt = now;
      if (phase === 'stationary') {
        motionStartedAt = now; phase = 'moving';
        // Respond immediately; do not wait for another expensive full-size ray
        // pass to complete before reducing the first frame of a new gesture.
        changeScale(nearest(estimateScale({ budgetMs: fullCost(), targetMs, minScale, maxScale })), now);
      } else {
        phase = 'moving';
        const cost = fullCost();
        if (cost !== null && now - lastChangeAt >= 350) {
          const predictedMs = cost * currentScale * currentScale;
          const desired = nearest(estimateScale({ budgetMs: cost, targetMs, minScale, maxScale }));
          if (predictedMs > targetMs * 1.2 && desired < currentScale) changeScale(desired, now);
          else if (predictedMs < targetMs * .7 && now - lastChangeAt >= 1000) {
            const next = levels.find(value => value > currentScale);
            if (next !== undefined && cost * next * next <= targetMs * .85) changeScale(next, now);
          }
        }
      }
    } else if (now - lastMotionAt < settleMs) {
      // Brief pauses between scroll/drag events do not trigger resize churn.
      phase = 'settling';
    } else {
      // One restoration, then native-resolution progressive accumulation.
      changeScale(maxScale, now); phase = 'stationary';
    }
    return currentScale;
  }
  function snapshot() {
    return { scale: currentScale, phase, targetMs, minScale, maxScale, settleMs, changes, lastChangeAt: Number.isFinite(lastChangeAt) ? lastChangeAt : null,
      estimatedFullResolutionGpuMs: fullCost('fullResolutionGpuMs'), estimatedFullResolutionCostMs: fullCost(), movingGpu: { ...summaries.moving }, stationaryGpu: { ...summaries.stationary }, levels: [...levels] };
  }
  return { update, snapshot };
}
