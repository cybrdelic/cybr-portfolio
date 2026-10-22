// GPU durations come only from asynchronous WebGL timer queries. CPU command
// submission and moving-frame cadence are independent observations.
const EXTENSION = 'EXT_disjoint_timer_query_webgl2';
const MAX_PENDING = 4, WINDOW = 120;
const finiteDuration = value => Number.isFinite(value) && value >= 0;
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function append(values, value) { values.push(value); if (values.length > WINDOW) values.shift(); }
const phaseOf = label => ['moving', 'stationary', 'frame'].includes(label) ? label : 'other';
const emptyPhase = () => ({ gpu: [], submit: [], gpuSamples: 0, submitSamples: 0 });

export function createRasterTiming(renderer) {
  let gl, extension, adapter = null, error = null;
  try {
    gl = renderer?.getContext?.();
    extension = gl?.getExtension?.(EXTENSION) ?? null;
    if (gl) {
      const debug = gl.getExtension?.('WEBGL_debug_renderer_info');
      const parameter = key => key === undefined ? null : String(gl.getParameter(key) ?? '').slice(0, 160);
      adapter = { vendor: parameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), renderer: parameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER), version: parameter(gl.VERSION), unmasked: !!debug };
    }
  } catch (cause) { error = String(cause?.message ?? cause).slice(0, 160); }
  const supported = !!extension && ['createQuery', 'beginQuery', 'endQuery', 'getQueryParameter', 'deleteQuery'].every(name => typeof gl?.[name] === 'function');
  let enabled = supported, disposed = false, active = null, wasDisjoint = false, lastMovingAt = null;
  let rejectedQueries = 0, skippedQueries = 0, disjointEvents = 0, gpuSamples = 0, submitSamples = 0, cadenceSamples = 0;
  const pending = [], gpu = [], submit = [], cadence = [], phases = { moving: emptyPhase(), stationary: emptyPhase(), frame: emptyPhase(), other: emptyPhase() };
  let latestLabel = null;
  const contextLost = () => !!gl?.isContextLost?.();
  function remove(query) { try { gl.deleteQuery(query); } catch { /* Timing cleanup must not disrupt rendering. */ } }
  function disjoint() {
    const value = !!gl.getParameter(extension.GPU_DISJOINT_EXT);
    if (value && !wasDisjoint) disjointEvents++;
    wasDisjoint = value; return value;
  }
  function rejectPending() {
    while (pending.length) { remove(pending.shift().query); rejectedQueries++; }
  }
  function disable(cause) {
    error = String(cause?.message ?? cause).slice(0, 160); enabled = false;
    rejectPending();
    if (active) {
      try { if (!contextLost()) gl.endQuery(extension.TIME_ELAPSED_EXT); } catch { /* Already invalid. */ }
      remove(active.query); active = null; rejectedQueries++;
    }
  }

  function begin(label = 'frame') {
    if (disposed || !enabled || contextLost()) return false;
    let query;
    try {
      if (active || pending.length >= MAX_PENDING || disjoint()
        || (gl.getQuery && gl.CURRENT_QUERY !== undefined && gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY))) {
        skippedQueries++; return false;
      }
      query = gl.createQuery();
      if (!query) { skippedQueries++; return false; }
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      active = { query, label: String(label ?? 'frame').slice(0, 48), invalid: false }; return true;
    } catch (cause) { if (query) remove(query); disable(cause); return false; }
  }
  function end() {
    if (disposed || !enabled || !active) return false;
    try {
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      const finished = active; active = null;
      if (finished.invalid || contextLost() || disjoint()) { remove(finished.query); rejectedQueries++; return false; }
      pending.push(finished); return true;
    } catch (cause) { disable(cause); return false; }
  }
  function poll() {
    if (disposed || !enabled) return 0;
    try {
      if (contextLost()) {
        rejectPending();
        if (active) { remove(active.query); active = null; rejectedQueries++; }
        return 0;
      }
      if (disjoint()) {
        rejectPending(); if (active) active.invalid = true; return 0;
      }
      let completed = 0;
      // Availability queries do not wait for unfinished GPU work. Never ask
      // for QUERY_RESULT until that specific query is reported available.
      for (let i = 0; i < pending.length;) {
        const item = pending[i];
        if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) { i++; continue; }
        const nanoseconds = gl.getQueryParameter(item.query, gl.QUERY_RESULT);
        pending.splice(i, 1); remove(item.query);
        if (!finiteDuration(nanoseconds)) { rejectedQueries++; continue; }
        const milliseconds = nanoseconds / 1e6, phase = phases[phaseOf(item.label)];
        append(gpu, milliseconds); append(phase.gpu, milliseconds); phase.gpuSamples++; gpuSamples++; completed++; latestLabel = item.label;
      }
      return completed;
    } catch (cause) { disable(cause); return 0; }
  }
  function recordFrame({ now, moving = false, submitMs } = {}) {
    if (disposed) return;
    const phase = phases[moving ? 'moving' : 'stationary'];
    if (finiteDuration(submitMs)) { append(submit, submitMs); append(phase.submit, submitMs); submitSamples++; phase.submitSamples++; }
    // A still frame breaks the activity interval. Long idle gaps between
    // separate gestures never contribute to the moving-frame cadence mean.
    if (!moving || !Number.isFinite(now)) { lastMovingAt = null; return; }
    if (lastMovingAt !== null && now > lastMovingAt) { append(cadence, now - lastMovingAt); cadenceSamples++; }
    lastMovingAt = now;
  }
  function snapshot() {
    return { supported, enabled: enabled && !disposed, extension: supported ? EXTENSION : null, adapter, error, disposed, contextLost: contextLost(),
      gpuMs: gpu.at(-1) ?? null, meanGpuMs: average(gpu), gpuSamples, latestLabel,
      pendingQueries: pending.length, activeQuery: !!active, maxQueries: MAX_PENDING, rejectedQueries, skippedQueries, disjointEvents,
      cpuSubmitMs: submit.at(-1) ?? null, meanCpuSubmitMs: average(submit), submitSamples,
      movingFrameIntervalMs: cadence.at(-1) ?? null, meanMovingFrameIntervalMs: average(cadence), cadenceSamples,
      phases: Object.fromEntries(Object.entries(phases).map(([name, values]) => [name, { gpuMs: values.gpu.at(-1) ?? null, meanGpuMs: average(values.gpu), gpuSamples: values.gpuSamples,
        cpuSubmitMs: values.submit.at(-1) ?? null, meanCpuSubmitMs: average(values.submit), submitSamples: values.submitSamples }])) };
  }
  function dispose() {
    if (disposed) return;
    if (active) {
      try { if (!contextLost()) gl.endQuery(extension.TIME_ELAPSED_EXT); } catch { /* Device may already be lost. */ }
      remove(active.query); active = null;
    }
    while (pending.length) remove(pending.shift().query);
    disposed = true;
  }
  return { begin, end, poll, recordFrame, snapshot, dispose };
}
