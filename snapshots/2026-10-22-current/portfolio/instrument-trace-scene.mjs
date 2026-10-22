import { buildBVH } from '../cybr-light/browser/bvh.mjs';

// CYBR LIGHT Node48 ABI: TLAS nodes, rigid instance records, then local BLAS
// nodes. CAD coordinates stay Z-up; scale changes units and nothing else.
const STRIDE = 12, NODE_BYTES = 48, LEAF_BIT = 0x80000000;
const finite = (a, name) => {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) throw Error(`${name}: nonfinite value at ${i}`);
};
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
function checkScale(scale) {
  if (!Number.isFinite(scale) || scale <= 0) throw Error('Invalid CAD unit scale');
}
function topologyHash(indices) {
  let hash = 2166136261;
  for (const index of indices) hash = Math.imul(hash ^ index, 16777619) >>> 0;
  return hash;
}
function checkMesh(mesh, full = true) {
  if (!(mesh.positions instanceof Float32Array) || !(mesh.normals instanceof Float32Array)
      || !(mesh.indices instanceof Uint32Array)) throw Error('Expected FP32 positions/normals and U32 indices');
  if (!mesh.positions.length || mesh.positions.length % 3 || mesh.normals.length !== mesh.positions.length
      || !mesh.indices.length || mesh.indices.length % 3) throw Error('Invalid indexed mesh shape');
  if (!Number.isInteger(mesh.materialIndex) || mesh.materialIndex < 0 || mesh.materialIndex >= 16777216) throw Error('Invalid material identity');
  if (mesh.colors && (!(mesh.colors instanceof Float32Array) || mesh.colors.length !== mesh.positions.length)) throw Error('Invalid vertex color shape');
  if (mesh.finish && (!(mesh.finish instanceof Float32Array) || mesh.finish.length !== mesh.positions.length / 3 * 2)) throw Error('Invalid finish shape');
  if (full) {
    finite(mesh.positions, 'positions'); finite(mesh.normals, 'normals');
    if (mesh.colors) finite(mesh.colors, 'colors');
    if (mesh.finish) {
      finite(mesh.finish, 'finish');
      for (const value of mesh.finish) if (value < 0) throw Error('Negative finish factor');
    }
    const vertices = mesh.positions.length / 3;
    for (const index of mesh.indices) if (index >= vertices) throw Error('Triangle index outside vertex array');
  }
}

export function rigidTransform(matrix, scale = .005) {
  checkScale(scale);
  if (!matrix || matrix.length !== 16) throw Error('Expected column-major matrix16');
  finite(matrix, 'matrix');
  if (Math.abs(matrix[3]) > 1e-6 || Math.abs(matrix[7]) > 1e-6 || Math.abs(matrix[11]) > 1e-6 || Math.abs(matrix[15] - 1) > 1e-6) throw Error('Non-affine instance transform');
  const axes = [[matrix[0], matrix[1], matrix[2]], [matrix[4], matrix[5], matrix[6]], [matrix[8], matrix[9], matrix[10]]];
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  if (axes.some(a => Math.abs(dot(a, a) - 1) > 1e-5)
      || Math.abs(dot(axes[0], axes[1])) > 1e-5 || Math.abs(dot(axes[0], axes[2])) > 1e-5
      || Math.abs(dot(axes[1], axes[2])) > 1e-5) throw Error('Instance transform must be rigid, without scale or shear');
  const cross = [axes[0][1] * axes[1][2] - axes[0][2] * axes[1][1], axes[0][2] * axes[1][0] - axes[0][0] * axes[1][2], axes[0][0] * axes[1][1] - axes[0][1] * axes[1][0]];
  if (Math.abs(dot(cross, axes[2]) - 1) > 1e-5) throw Error('Reflected instance transform');
  const m00 = matrix[0], m01 = matrix[4], m02 = matrix[8], m10 = matrix[1], m11 = matrix[5], m12 = matrix[9], m20 = matrix[2], m21 = matrix[6], m22 = matrix[10];
  const trace = m00 + m11 + m22;
  let x, y, z, w;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1); w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4;
  }
  const length = Math.hypot(x, y, z, w), sign = w < 0 ? -1 : 1;
  return { translation: [matrix[12] * scale, matrix[13] * scale, matrix[14] * scale], quaternion: [x, y, z, w].map(v => v / length * sign) };
}
function worldBounds(bounds, matrix, scale) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let mask = 0; mask < 8; mask++) {
    const p = bounds[0].map((v, k) => mask & (1 << k) ? bounds[1][k] : v);
    for (let k = 0; k < 3; k++) {
      const v = Math.fround(matrix[k] * p[0] + matrix[4 + k] * p[1] + matrix[8 + k] * p[2] + matrix[12 + k] * scale);
      lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
    }
  }
  // Quaternion serialization and GPU normalization can differ from the source
  // rigid matrix by a few FP32 ulps. Expand bounds only, never geometry.
  for (let k = 0; k < 3; k++) {
    const pad = Math.max(1e-7, Math.max(Math.abs(lo[k]), Math.abs(hi[k])) * 2e-6);
    lo[k] = Math.fround(lo[k] - pad); hi[k] = Math.fround(hi[k] + pad);
  }
  return [lo, hi];
}
function meshBounds(mesh, scale) {
  const count = mesh.indices.length / 3, bounds = new Float32Array(count * 6), centers = new Float32Array(count * 3);
  for (let face = 0; face < count; face++) for (let k = 0; k < 3; k++) {
    let lo = Infinity, hi = -Infinity;
    const p0 = Math.fround(mesh.positions[mesh.indices[face * 3] * 3 + k] * scale);
    for (let j = 0; j < 3; j++) {
      const endpoint = Math.fround(mesh.positions[mesh.indices[face * 3 + j] * 3 + k] * scale);
      const value = j ? p0 + Math.fround(endpoint - p0) : p0;
      lo = Math.min(lo, value); hi = Math.max(hi, value);
    }
    const pad = Math.max(1e-8, Math.max(Math.abs(lo), Math.abs(hi)) * 3e-7);
    bounds[face * 6 + k] = lo - pad; bounds[face * 6 + 3 + k] = hi + pad; centers[face * 3 + k] = (lo + hi) / 2;
  }
  return { bounds, centers };
}
function boundaries(mesh, fallback) {
  const count = mesh.indices.length / 3, ids = new Uint32Array(count).fill(fallback);
  let last = 0;
  for (const range of mesh.boundaryRanges || []) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.count) || range.start < last || range.start % 3 || range.count <= 0 || range.count % 3
        || range.start + range.count > mesh.indices.length || !Number.isInteger(range.id) || range.id < 1 || range.id >= 16777216) throw Error('Invalid boundary index range');
    ids.fill(range.id, range.start / 3, (range.start + range.count) / 3); last = range.start + range.count;
  }
  return ids;
}
function packMesh(mesh, template, geometry, attributes, scale, boundaryIds) {
  let geometryChanged = false, attributesChanged = false;
  const write = (array, index, value, kind) => {
    const packed = Math.fround(value);
    if (!Number.isFinite(packed)) throw Error('Packed scene value is nonfinite');
    if (array[index] !== packed) { array[index] = packed; if (kind === 0) geometryChanged = true; else attributesChanged = true; }
  };
  for (let ordered = 0; ordered < template.count; ordered++) {
    const face = template.order[ordered], target = template.triangleStart + ordered, g = target * 12, a = target * 24;
    const vertices = [mesh.indices[face * 3], mesh.indices[face * 3 + 1], mesh.indices[face * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      const p = Math.fround(mesh.positions[vertices[0] * 3 + k] * scale);
      write(geometry, g + k, p, 0);
      // Subtract the SAME rounded endpoints used to construct the bounds.
      write(geometry, g + 4 + k, Math.fround(mesh.positions[vertices[1] * 3 + k] * scale) - p, 0);
      write(geometry, g + 8 + k, Math.fround(mesh.positions[vertices[2] * 3 + k] * scale) - p, 0);
    }
    write(geometry, g + 3, mesh.materialIndex, 0); write(geometry, g + 7, 0, 0); write(geometry, g + 11, 0, 0);
    for (let j = 0; j < 3; j++) {
      const vertex = vertices[j], brightness = mesh.finish ? mesh.finish[vertex * 2 + 1] : 1;
      for (let k = 0; k < 3; k++) {
        write(attributes, a + j * 4 + k, mesh.normals[vertex * 3 + k], 1);
        write(attributes, a + 12 + j * 4 + k, (mesh.colors ? mesh.colors[vertex * 3 + k] : 1) * brightness, 1);
      }
      write(attributes, a + j * 4 + 3, j === 0 ? boundaryIds[face] : 0, 1);
      write(attributes, a + 12 + j * 4 + 3, mesh.finish ? mesh.finish[vertex * 2] : 1, 1);
    }
  }
  return { geometryChanged, attributesChanged };
}
function writeRecord(f, u, node, transform, root, identity) {
  const at = node * STRIDE;
  f.set(transform.translation, at); f[at + 3] = 0;
  f.set(transform.quaternion, at + 4);
  u.set([root, identity, 0, root], at + 8);
}
function nodeBounds(f, node) { const at = node * STRIDE; return [[f[at], f[at + 1], f[at + 2]], [f[at + 4], f[at + 5], f[at + 6]]]; }
function setBounds(f, node, bounds) { f.set(bounds[0], node * STRIDE); f.set(bounds[1], node * STRIDE + 4); }
function unionInto(lo, hi, bounds) { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], bounds[0][k]); hi[k] = Math.max(hi[k], bounds[1][k]); } }
function refitBLAS(result, template) {
  const f = new Float32Array(result.nodes), u = new Uint32Array(result.nodes), g = result.geometry;
  for (let node = template.nodeStart + template.nodeCount - 1; node >= template.nodeStart; node--) {
    const at = node * STRIDE, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    if (u[at + 11]) {
      for (let t = u[at + 10]; t < u[at + 10] + u[at + 11]; t++) for (let k = 0; k < 3; k++) {
        const p = g[t * 12 + k], p1 = p + g[t * 12 + 4 + k], p2 = p + g[t * 12 + 8 + k];
        lo[k] = Math.min(lo[k], p, p1, p2); hi[k] = Math.max(hi[k], p, p1, p2);
      }
      for (let k = 0; k < 3; k++) {
        const pad = Math.max(1e-8, Math.max(Math.abs(lo[k]), Math.abs(hi[k])) * 3e-7);
        lo[k] -= pad; hi[k] += pad;
      }
    } else { unionInto(lo, hi, nodeBounds(f, u[at + 8])); unionInto(lo, hi, nodeBounds(f, u[at + 9])); }
    setBounds(f, node, [lo, hi]);
  }
  template.localBounds = nodeBounds(f, template.nodeStart);
}
function refitTLAS(result, world) {
  const a = result.acceleration, f = new Float32Array(result.nodes), u = new Uint32Array(result.nodes);
  for (let node = a.tlasNodeCount - 1; node >= 0; node--) {
    const at = node * STRIDE, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    if (u[at + 11] & LEAF_BIT) {
      const start = u[at + 10] - a.recordStart, count = u[at + 11] & 0x7fffffff;
      for (let j = start; j < start + count; j++) unionInto(lo, hi, world[a.instanceOrder[j]]);
    } else { unionInto(lo, hi, nodeBounds(f, u[at + 8])); unionInto(lo, hi, nodeBounds(f, u[at + 9])); }
    setBounds(f, node, [lo, hi]);
  }
  f[3] = .1;
}
function mergeRanges(ranges) {
  const merged = [];
  for (const range of ranges.sort((a, b) => a.offset - b.offset)) {
    const last = merged.at(-1);
    if (last && range.offset <= last.offset + last.size) last.size = Math.max(last.offset + last.size, range.offset + range.size) - last.offset;
    else merged.push({ ...range });
  }
  return merged;
}

export function buildScene({ meshes, scale = .005 }) {
  checkScale(scale);
  if (!Array.isArray(meshes) || !meshes.length || meshes.length >= 16777216) throw Error('Invalid template list');
  const triangleCount = meshes.reduce((sum, mesh) => { checkMesh(mesh); return sum + mesh.indices.length / 3; }, 0);
  const geometry = new Float32Array(triangleCount * 12), attributes = new Float32Array(triangleCount * 24);
  const templates = [], localNodes = [], world = [], transforms = [];
  let triangleStart = 0, blasNodeCount = 0, maxDepth = 0;
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i], transform = rigidTransform(mesh.matrix, scale), { bounds, centers } = meshBounds(mesh, scale);
    const built = buildBVH(bounds, centers, mesh.indices.length / 3), localBounds = nodeBounds(new Float32Array(built.buffer), 0);
    const template = { triangleStart, count: mesh.indices.length / 3, nodeStart: blasNodeCount, nodeCount: built.nodeCount, localBounds,
      order: built.ids, dynamic: !!mesh.dynamic, materialIndex: mesh.materialIndex, vertexCount: mesh.positions.length / 3,
      topologyHash: topologyHash(mesh.indices), matrix: Array.from(mesh.matrix), boundaryIds: boundaries(mesh, i + 1) };
    packMesh(mesh, template, geometry, attributes, scale, template.boundaryIds);
    templates.push(template); localNodes.push(built.buffer); transforms.push(transform); world.push(worldBounds(localBounds, mesh.matrix, scale));
    triangleStart += template.count; blasNodeCount += built.nodeCount; maxDepth = Math.max(maxDepth, built.maxDepth);
  }
  const bounds = new Float32Array(meshes.length * 6), centers = new Float32Array(meshes.length * 3);
  world.forEach((box, i) => { bounds.set([...box[0], ...box[1]], i * 6); centers.set(box[0].map((v, k) => (v + box[1][k]) / 2), i * 3); });
  const tlas = buildBVH(bounds, centers, meshes.length, 1), recordStart = tlas.nodeCount, blasStart = recordStart + meshes.length;
  const nodes = new ArrayBuffer((blasStart + blasNodeCount) * NODE_BYTES), f = new Float32Array(nodes), u = new Uint32Array(nodes);
  new Uint8Array(nodes).set(new Uint8Array(tlas.buffer));
  for (let node = 0; node < tlas.nodeCount; node++) {
    const at = node * STRIDE;
    if (u[at + 11]) { u[at + 10] += recordStart; u[at + 11] = (u[at + 11] | LEAF_BIT) >>> 0; }
  }
  const instanceSlots = new Uint32Array(meshes.length);
  tlas.ids.forEach((source, ordered) => { instanceSlots[source] = recordStart + ordered; });
  for (let i = 0; i < templates.length; i++) {
    const template = templates[i]; template.nodeStart += blasStart;
    new Uint8Array(nodes, template.nodeStart * NODE_BYTES, localNodes[i].byteLength).set(new Uint8Array(localNodes[i]));
    for (let node = template.nodeStart; node < template.nodeStart + template.nodeCount; node++) {
      const at = node * STRIDE;
      if (u[at + 11]) u[at + 10] += template.triangleStart;
      else { u[at + 8] += template.nodeStart; u[at + 9] += template.nodeStart; }
    }
    writeRecord(f, u, instanceSlots[i], transforms[i], template.nodeStart, i + 1);
  }
  f[3] = .1;
  const acceleration = { templates, tlasNodeCount: tlas.nodeCount, recordStart, instanceOrder: tlas.ids, instanceSlots, blasStart, scale };
  return { geometry, attributes, nodes, acceleration, stats: { triangles: triangleCount, templates: meshes.length,
    nodeCount: nodes.byteLength / NODE_BYTES, maxDepth: Math.max(maxDepth, tlas.maxDepth),
    geometryBytes: geometry.byteLength, attributeBytes: attributes.byteLength, nodeBytes: nodes.byteLength } };
}

// Only changed rigid records/TLAS nodes and dynamic cable buffers are returned.
// Triangle order, material identities, all source caps, and static BLAS stay put.
export function updateScene(result, meshes, scale = .005) {
  checkScale(scale);
  const a = result.acceleration;
  if (scale !== a.scale || meshes.length !== a.templates.length) throw Error('Scene scale/template list changed; rebuild required');
  const f = new Float32Array(result.nodes), u = new Uint32Array(result.nodes), world = [];
  const ranges = { nodes: [], geometry: [], attributes: [] };
  let changedTransforms = 0, changedGeometry = 0, changedAttributes = 0;
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i], template = a.templates[i]; checkMesh(mesh, template.dynamic);
    if (mesh.indices.length / 3 !== template.count || mesh.positions.length / 3 !== template.vertexCount || mesh.materialIndex !== template.materialIndex || !!mesh.dynamic !== template.dynamic) throw Error('Template topology/material changed; rebuild required');
    const transform = rigidTransform(mesh.matrix, scale), moved = !same(template.matrix, mesh.matrix);
    if (template.dynamic) {
      if (topologyHash(mesh.indices) !== template.topologyHash) throw Error('Dynamic cable topology changed; rebuild required');
      const updated = packMesh(mesh, template, result.geometry, result.attributes, scale, template.boundaryIds);
      if (updated.geometryChanged) {
        refitBLAS(result, template); changedGeometry++;
        ranges.geometry.push({ offset: template.triangleStart * 48, size: template.count * 48 });
        ranges.nodes.push({ offset: template.nodeStart * NODE_BYTES, size: template.nodeCount * NODE_BYTES });
      }
      if (updated.attributesChanged) { changedAttributes++; ranges.attributes.push({ offset: template.triangleStart * 96, size: template.count * 96 }); }
    }
    if (moved) {
      writeRecord(f, u, a.instanceSlots[i], transform, template.nodeStart, i + 1);
      template.matrix = Array.from(mesh.matrix); changedTransforms++;
      ranges.nodes.push({ offset: a.instanceSlots[i] * NODE_BYTES, size: NODE_BYTES });
    }
    world.push(worldBounds(template.localBounds, mesh.matrix, scale));
  }
  if (changedTransforms || changedGeometry) {
    refitTLAS(result, world); ranges.nodes.push({ offset: 0, size: a.tlasNodeCount * NODE_BYTES });
  }
  return { changed: !!(changedTransforms || changedGeometry || changedAttributes), nodes: mergeRanges(ranges.nodes), geometry: mergeRanges(ranges.geometry), attributes: mergeRanges(ranges.attributes),
    stats: { changedTransforms, changedGeometry, changedAttributes } };
}
