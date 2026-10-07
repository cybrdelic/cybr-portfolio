// Binned SAH with one reusable scratch set; costs and partition order unchanged.
export function buildBVH(bounds, centers, count, leafSize = 6) {
  if (!Number.isInteger(leafSize) || leafSize < 1 || leafSize > 6)
    throw Error('Invalid BVH leaf size');
  if (!count) throw Error('Empty BVH');
  const ids = Uint32Array.from({ length: count }, (_, i) => i);
  let capacity = Math.min(1024, 2 * count - 1),
    buffer = new ArrayBuffer(capacity * 48);
  let floats = new Float32Array(buffer),
    uints = new Uint32Array(buffer),
    nodeCount = 0,
    maxDepth = 0;
  const low = new Float64Array(3),
    high = new Float64Array(3),
    cl = new Float64Array(3),
    ch = new Float64Array(3);
  const binCount = new Uint32Array(16),
    binLow = new Float64Array(48),
    binHigh = new Float64Array(48);
  const leftCost = new Float64Array(16),
    rightCost = new Float64Array(16),
    l = new Float64Array(3),
    h = new Float64Array(3);
  const area = (lo, hi) => {
    const x = Math.max(0, hi[0] - lo[0]),
      y = Math.max(0, hi[1] - lo[1]),
      z = Math.max(0, hi[2] - lo[2]);
    return 2 * (x * y + y * z + z * x);
  };
  function grow() {
    capacity = Math.min(2 * count - 1, capacity * 2);
    const next = new ArrayBuffer(capacity * 48);
    new Uint8Array(next).set(new Uint8Array(buffer));
    buffer = next;
    floats = new Float32Array(buffer);
    uints = new Uint32Array(buffer);
  }
  function build(start, end, depth) {
    maxDepth = Math.max(maxDepth, depth);
    if (nodeCount === capacity) grow();
    const index = nodeCount++,
      off = index * 12;
    low.fill(Infinity);
    high.fill(-Infinity);
    cl.fill(Infinity);
    ch.fill(-Infinity);
    for (let i = start; i < end; i++) {
      const id = ids[i];
      for (let k = 0; k < 3; k++) {
        low[k] = Math.min(low[k], bounds[id * 6 + k]);
        high[k] = Math.max(high[k], bounds[id * 6 + k + 3]);
        cl[k] = Math.min(cl[k], centers[id * 3 + k]);
        ch[k] = Math.max(ch[k], centers[id * 3 + k]);
      }
    }
    floats.set(low, off);
    floats.set(high, off + 4);
    uints[off + 10] = start;
    uints[off + 11] = end - start;
    if (end - start <= leafSize || depth >= 48) return index;
    let best = Infinity,
      axis = -1,
      boundary = 0;
    for (let k = 0; k < 3; k++) {
      if (ch[k] - cl[k] < 1e-9) continue;
      binCount.fill(0);
      binLow.fill(Infinity);
      binHigh.fill(-Infinity);
      const factor = 16 / (ch[k] - cl[k]);
      for (let i = start; i < end; i++) {
        const id = ids[i],
          b = Math.min(15, Math.floor((centers[id * 3 + k] - cl[k]) * factor));
        binCount[b]++;
        for (let a = 0; a < 3; a++) {
          binLow[b * 3 + a] = Math.min(binLow[b * 3 + a], bounds[id * 6 + a]);
          binHigh[b * 3 + a] = Math.max(
            binHigh[b * 3 + a],
            bounds[id * 6 + a + 3],
          );
        }
      }
      let n = 0;
      l.fill(Infinity);
      h.fill(-Infinity);
      for (let b = 0; b < 16; b++) {
        n += binCount[b];
        for (let a = 0; a < 3; a++) {
          l[a] = Math.min(l[a], binLow[b * 3 + a]);
          h[a] = Math.max(h[a], binHigh[b * 3 + a]);
        }
        leftCost[b] = n ? area(l, h) * n : 0;
      }
      n = 0;
      l.fill(Infinity);
      h.fill(-Infinity);
      for (let b = 15; b >= 0; b--) {
        n += binCount[b];
        for (let a = 0; a < 3; a++) {
          l[a] = Math.min(l[a], binLow[b * 3 + a]);
          h[a] = Math.max(h[a], binHigh[b * 3 + a]);
        }
        rightCost[b] = n ? area(l, h) * n : 0;
      }
      for (let b = 0; b < 15; b++) {
        const cost = leftCost[b] + rightCost[b + 1];
        if (cost < best) {
          best = cost;
          axis = k;
          boundary = cl[k] + (b + 1) / factor;
        }
      }
    }
    let split = start;
    if (axis >= 0)
      for (let i = start; i < end; i++)
        if (centers[ids[i] * 3 + axis] < boundary) {
          const swap = ids[split];
          ids[split++] = ids[i];
          ids[i] = swap;
        }
    if (split === start || split === end) split = (start + end) >> 1;
    uints[off + 11] = 0;
    // Recursive growth can replace the backing views: store links afterwards.
    const left = build(start, split, depth + 1),
      right = build(split, end, depth + 1);
    uints[off + 8] = left;
    uints[off + 9] = right;
    return index;
  }
  build(0, count, 0);
  return { ids, buffer: buffer.slice(0, nodeCount * 48), nodeCount, maxDepth };
}
