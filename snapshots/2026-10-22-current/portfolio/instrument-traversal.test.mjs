import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildScene } from './instrument-trace-scene.mjs';
import { optimizeInstrumentTraversal } from './instrument-traversal.mjs';
import { instancedShader } from '../cybr-light/browser/instanced-shader.mjs';

const traversal = await readFile(new URL('../cybr-light/browser/trace-instances.wgsl', import.meta.url), 'utf8');
const transport = await readFile(new URL('../cybr-light/browser/trace.wgsl', import.meta.url), 'utf8');
const optimized = optimizeInstrumentTraversal(traversal);
const maskOnly = optimizeInstrumentTraversal(traversal, { cacheDistances: false });
const add = (a, b) => a.map((v, i) => v + b[i]), sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map(v => v * s), dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = a => mul(a, 1 / Math.hypot(...a));
const rotate = (q, v) => add(v, mul(cross(q.slice(0, 3), add(cross(q.slice(0, 3), v), mul(v, q[3]))), 2));
function random(seed = 90210) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }

// CPU reference of the unchanged WGSL intersection arithmetic. Both walks
// below consume the production scene builder's actual Node48/triangle buffers.
function box(node, origin, inverse, stats) {
  stats.boxTests++;
  const a = node.low.map((v, i) => (v - origin[i]) * inverse[i]), b = node.high.slice(0, 3).map((v, i) => (v - origin[i]) * inverse[i]);
  return [Math.max(...a.map((v, i) => Math.min(v, b[i])), .00001), Math.min(...a.map((v, i) => Math.max(v, b[i])))];
}
function intersect(triangle, origin, direction, limit) {
  const p = cross(direction, triangle.e2), determinant = dot(triangle.e1, p);
  if (Math.abs(determinant) < 1e-10) return null;
  const inverse = 1 / determinant, s = sub(origin, triangle.p), x = dot(s, p) * inverse;
  if (x < 0 || x > 1) return null;
  const q = cross(s, triangle.e1), y = dot(direction, q) * inverse;
  if (y < 0 || x + y > 1) return null;
  const t = dot(triangle.e2, q) * inverse;
  return t > .00001 && t < limit ? { t, bary: [x, y] } : null;
}
function decode(scene) {
  const f = new Float32Array(scene.nodes), u = new Uint32Array(scene.nodes);
  const nodes = Array.from({ length: f.length / 12 }, (_, i) => ({ low: [...f.subarray(i * 12, i * 12 + 3)], high: [...f.subarray(i * 12 + 4, i * 12 + 8)], links: [...u.subarray(i * 12 + 8, i * 12 + 12)] }));
  const g = scene.geometry;
  const triangles = Array.from({ length: g.length / 12 }, (_, i) => ({ p: [...g.subarray(i * 12, i * 12 + 3)], e1: [...g.subarray(i * 12 + 4, i * 12 + 7)], e2: [...g.subarray(i * 12 + 8, i * 12 + 11)], mask: g[i * 12 + 7] >>> 0 }));
  return { nodes, triangles, instances: [...scene.acceleration.instanceSlots] };
}
function traceCPU(view, origin, direction, limit, anyHit, cached, hoistedMask = cached) {
  const stats = { boxTests: 0, triangleTests: 0, maskLoads: 0, maxStack: 0, leaves: [] };
  const getMask = instance => { stats.maskLoads++; return view.nodes[instance].links[1] >>> 24; };
  function walk(root, o, d, maxDistance, instance, top) {
    let hit = { t: maxDistance, id: -1, bary: [0, 0], instance };
    const inverse = d.map(v => (v >= 0 ? 1 : -1) / Math.max(Math.abs(v), 1e-10)), stack = [], distances = [];
    const push = (index, near) => { stack.push(index); distances.push(near); stats.maxStack = Math.max(stats.maxStack, stack.length); assert.ok(stack.length <= 64); };
    if (cached) { const range = box(view.nodes[root], o, inverse, stats); if (!(range[1] < range[0] || range[0] >= hit.t)) push(root, range[0]); }
    else push(root, 0);
    const mask = top || !hoistedMask ? 0 : getMask(instance);
    while (stack.length) {
      const index = stack.pop(), near = distances.pop(), node = view.nodes[index], links = node.links;
      if (cached) { if (near >= hit.t) continue; }
      else { const range = box(node, o, inverse, stats); if (range[1] < range[0] || range[0] >= hit.t) continue; }
      if (top && (links[3] & 0x80000000)) {
        for (let k = 0; k < (links[3] & 0x7fffffff); k++) {
          const slot = links[2] + k, transform = view.nodes[slot], scale = dot(transform.high, transform.high), rotation = normalize(transform.high), inverseRotation = [...mul(rotation.slice(0, 3), -1), rotation[3]];
          const localOrigin = mul(rotate(inverseRotation, sub(o, transform.low)), 1 / scale), localDirection = mul(rotate(inverseRotation, d), 1 / scale);
          const candidate = walk(transform.links[3], localOrigin, localDirection, hit.t, slot, false);
          if (candidate.id >= 0) { hit = candidate; if (anyHit) return hit; }
        }
      } else if (!top && links[3] > 0) {
        stats.leaves.push(index);
        for (let k = 0; k < links[3]; k++) {
          const id = links[2] + k, triangle = view.triangles[id];
          if (triangle.mask && !(triangle.mask & (hoistedMask ? mask : getMask(instance)))) continue;
          stats.triangleTests++;
          const candidate = intersect(triangle, o, d, hit.t);
          if (candidate) { hit = { ...candidate, id, instance }; if (anyHit) return hit; }
        }
      } else {
        const a = box(view.nodes[links[0]], o, inverse, stats), b = box(view.nodes[links[1]], o, inverse, stats);
        const av = a[1] >= a[0] && a[0] < hit.t, bv = b[1] >= b[0] && b[0] < hit.t;
        if (av && bv) {
          const nearIsLeft = a[0] < b[0];
          push(nearIsLeft ? links[1] : links[0], nearIsLeft ? b[0] : a[0]);
          push(nearIsLeft ? links[0] : links[1], nearIsLeft ? a[0] : b[0]);
        } else if (av) push(links[0], a[0]); else if (bv) push(links[1], b[0]);
      }
    }
    return hit;
  }
  return { hit: walk(0, origin, direction, limit, 0, true), stats };
}
function bruteForce(view, origin, direction, limit) {
  let result = { t: limit, id: -1, instance: 0 };
  for (const slot of view.instances) {
    const transform = view.nodes[slot], q = normalize(transform.high), scale = dot(transform.high, transform.high), mask = transform.links[1] >>> 24;
    // Independently transform every triangle into world space; no boxes,
    // cached distances or inverse instance rays take part in this oracle.
    const pending = [transform.links[3]];
    while (pending.length) {
      const node = view.nodes[pending.pop()];
      if (node.links[3]) for (let k = 0; k < node.links[3]; k++) {
        const id = node.links[2] + k, triangle = view.triangles[id];
        if (triangle.mask && !(triangle.mask & mask)) continue;
        const world = { p: add(mul(rotate(q, triangle.p), scale), transform.low), e1: mul(rotate(q, triangle.e1), scale), e2: mul(rotate(q, triangle.e2), scale) };
        const candidate = intersect(world, origin, direction, result.t);
        if (candidate) result = { ...candidate, id, instance: slot };
      } else pending.push(node.links[0], node.links[1]);
    }
  }
  return result;
}
function syntheticScene() {
  const rng = random(4003), meshes = [];
  for (let instance = 0; instance < 6; instance++) {
    const positions = [], normals = [], indices = [], angle = .37 * instance, c = Math.cos(angle), s = Math.sin(angle);
    for (let id = 0; id < 48; id++) {
      const center = [rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2], a = [rng() + .1, rng() - .5, rng() - .5], b = [rng() - .5, rng() + .1, rng() - .5];
      const n = normalize(cross(a, b));
      positions.push(...center, ...add(center, a), ...add(center, b)); normals.push(...n, ...n, ...n); indices.push(id * 3, id * 3 + 1, id * 3 + 2);
    }
    meshes.push({ positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices), materialIndex: instance,
      matrix: [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, (instance % 3 - 1) * 2.2, (Math.floor(instance / 3) - .5) * 2.5, instance * .13, 1] });
  }
  const scene = buildScene({ meshes, scale: 1 }), u = new Uint32Array(scene.nodes);
  scene.acceleration.instanceSlots.forEach((slot, i) => { u[slot * 12 + 9] |= (1 << (i % 3)) << 24; });
  for (let i = 0; i < scene.stats.triangles; i++) scene.geometry[i * 12 + 7] = i % 4 ? 1 << (i % 3) : 0;
  assert.ok(scene.acceleration.tlasNodeCount > 1 && scene.acceleration.templates.every(t => t.nodeCount > 1));
  return decode(scene);
}

test('optimization checks both traversal source contracts and preserves shared scale-relative patches', () => {
  assert.equal((optimized.match(/var nearStack:array<f32,64>/g) ?? []).length, 2);
  assert.equal((optimized.match(/var stack:array<u32,64>/g) ?? []).length, 2);
  assert.equal((optimized.match(/nodes\[instance\]\.links.y>>24u/g) ?? []).length, 1);
  assert.doesNotMatch(optimized, /boxDistance\(node,o,inv\)/);
  assert.match(optimized, /nearStack\[count\]>=hit.t/);
  const shader = instancedShader(transport, optimized);
  assert.match(shader, /if\(abs\(det\)<1e-8\*length\(tr.e1.xyz\)\*length\(tr.e2.xyz\)\)/);
  assert.match(shader, /t>\(max\(nodes\[0\].low.w,1e-6\)\*0.00001\)/);
  assert.throws(() => optimizeInstrumentTraversal(traversal.replace('var count=1u;', 'var count=2u;')), /contract changed/);
  assert.throws(() => optimizeInstrumentTraversal(traversal.replace('if(abs(det)<1e-10)', 'if(abs(det)<1e-12)')), /contract changed/);
  assert.throws(() => optimizeInstrumentTraversal(optimized), /contract changed/);
});

test('mask-only mode retains the original stack and AABB tests with checked scale-relative contracts', () => {
  assert.doesNotMatch(maskOnly, /nearStack|rootRange/);
  assert.equal((maskOnly.match(/var stack:array<u32,64>/g) ?? []).length, 2);
  assert.equal((maskOnly.match(/boxDistance\(node,o,inv\)/g) ?? []).length, 2);
  assert.equal((maskOnly.match(/nodes\[instance\]\.links.y>>24u/g) ?? []).length, 1);
  assert.match(maskOnly, /u32\(tr.e1.w\)&instanceMask/);
  assert.match(instancedShader(transport, maskOnly), /if\(abs\(det\)<1e-8\*length\(tr.e1.xyz\)\*length\(tr.e2.xyz\)\)/);
  assert.throws(() => optimizeInstrumentTraversal(traversal.replace('var count=1u;', 'var count=2u;'), { cacheDistances: false }), /contract changed/);
  assert.throws(() => optimizeInstrumentTraversal(traversal.replace('if(abs(det)<1e-10)', 'if(abs(det)<1e-12)'), { cacheDistances: false }), /contract changed/);
});

test('cached two-level traversal matches original nearest/any-hit selection, finite limits and leaf pruning on randomized rays', () => {
  const view = syntheticScene(), rng = random(12213);
  let savedBoxes = 0, hitCount = 0;
  for (let i = 0; i < 3200; i++) {
    const target = [rng() * 7 - 3.5, rng() * 6 - 3, rng() * 5 - 2.5], direction = normalize([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]);
    const origin = sub(target, mul(direction, i % 7 === 0 ? 0 : 3 + rng() * 8)), limit = i % 3 ? 100 : rng() * 9 + .001;
    for (const anyHit of [false, true]) {
      const original = traceCPU(view, origin, direction, limit, anyHit, false), cached = traceCPU(view, origin, direction, limit, anyHit, true), mask = traceCPU(view, origin, direction, limit, anyHit, false, true);
      assert.deepEqual(cached.hit, original.hit, `ray ${i}, anyHit=${anyHit}`);
      assert.deepEqual(mask.hit, original.hit, `mask-only ray ${i}, anyHit=${anyHit}`);
      assert.deepEqual(cached.stats.leaves, original.stats.leaves, `leaf order/pruning ray ${i}`);
      assert.deepEqual(mask.stats.leaves, original.stats.leaves, `mask-only leaf order ray ${i}`);
      assert.equal(cached.stats.triangleTests, original.stats.triangleTests);
      assert.equal(mask.stats.boxTests, original.stats.boxTests);
      assert.equal(mask.stats.triangleTests, original.stats.triangleTests);
      assert.ok(cached.stats.boxTests <= original.stats.boxTests);
      savedBoxes += original.stats.boxTests - cached.stats.boxTests;
      if (cached.hit.id >= 0) hitCount++;
      if (!anyHit) {
        const brute = bruteForce(view, origin, direction, limit);
        assert.equal(cached.hit.id, brute.id, `brute-force triangle ray ${i}`);
        assert.equal(cached.hit.instance, brute.instance);
        assert.ok(Math.abs(cached.hit.t - brute.t) < 1e-9);
      }
    }
  }
  assert.ok(hitCount > 300, `expected substantial hit coverage, got ${hitCount}`);
  assert.ok(savedBoxes > 10000, `expected fewer box intersections, saved ${savedBoxes}`);
});

function orderedScene(leftZ = 2, rightZ = 4) {
  const bounds = (z0, z1) => ({ low: [-1, -1, z0], high: [1, 1, z1, 0] });
  const triangle = z => ({ p: [-1, -1, z], e1: [2, 0, 0], e2: [0, 2, 0], mask: 0 });
  return { nodes: [
    { ...bounds(1, 5), links: [0, 0, 1, 0x80000001] },
    { low: [0, 0, 0], high: [0, 0, 0, 1], links: [2, 1, 0, 2] },
    { ...bounds(Math.min(leftZ, rightZ), Math.max(leftZ, rightZ)), links: [3, 4, 0, 0] },
    { ...bounds(leftZ, leftZ), links: [0, 0, 0, 1] },
    { ...bounds(rightZ, rightZ), links: [0, 0, 1, 1] }
  ], triangles: [triangle(leftZ), triangle(rightZ)], instances: [1] };
}
test('near-first ordering, right-child ties, exact limits, misses and origins inside boxes retain original behavior', () => {
  for (const cached of [false, true]) {
    const near = traceCPU(orderedScene(), [-.2, -.1, 0], [0, 0, 1], 10, false, cached);
    assert.equal(near.hit.id, 0); assert.deepEqual(near.stats.leaves, [3]);
    const tie = traceCPU(orderedScene(3, 3), [-.2, -.1, 0], [0, 0, 1], 10, true, cached);
    assert.equal(tie.hit.id, 1); assert.deepEqual(tie.stats.leaves, [4]);
    assert.equal(traceCPU(orderedScene(), [-.2, -.1, 0], [0, 0, 1], 2, false, cached).hit.id, -1);
    assert.equal(traceCPU(orderedScene(), [-.2, -.1, 3], [0, 0, 1], 10, false, cached).hit.id, 1);
    assert.equal(traceCPU(orderedScene(), [4, 0, 0], [0, 0, 1], 10, true, cached).hit.id, -1);
  }
});

test('deep near-first hierarchies stay within the original 64-slot stack and prune every far leaf', () => {
  const view = orderedScene(), nodes = view.nodes.slice(0, 2);
  function branch(depth) {
    const index = nodes.length; nodes.push(null);
    if (depth === 0) nodes[index] = { low: [-1, -1, 2], high: [1, 1, 2, 0], links: [0, 0, 0, 1] };
    else {
      const left = branch(depth - 1), right = nodes.length;
      nodes.push({ low: [-1, -1, 4], high: [1, 1, 4, 0], links: [0, 0, 1, 1] });
      nodes[index] = { low: [-1, -1, 2], high: [1, 1, 4, 0], links: [left, right, 0, 0] };
    }
    return index;
  }
  nodes[1].links[3] = branch(62); view.nodes = nodes;
  const original = traceCPU(view, [-.2, -.1, 0], [0, 0, 1], 10, false, false), cached = traceCPU(view, [-.2, -.1, 0], [0, 0, 1], 10, false, true);
  assert.deepEqual(cached.hit, original.hit); assert.deepEqual(cached.stats.leaves, original.stats.leaves);
  assert.equal(cached.stats.maxStack, 63); assert.equal(cached.stats.triangleTests, 1);
  assert.ok(cached.stats.boxTests < original.stats.boxTests);
});
