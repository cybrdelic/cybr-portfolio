import { rigidTransform } from './instrument-trace-scene.mjs';

// Instance IDs in the native trace guides are meshIndex + 1. Record zero is
// reserved for misses and remains invalid. Each record is four WGSL vec4f:
// current quaternion, current translation + validity, previous quaternion,
// previous translation + reserved zero.
export const TEMPORAL_MOTION_FLOATS = 16;

/** Capture before updateScene mutates its template matrices. */
export function capturePreviousMatrices(sceneData) {
  const templates = sceneData?.acceleration?.templates;
  if (!Array.isArray(templates)) throw Error('Missing scene acceleration templates');
  const scale = sceneData.acceleration.scale ?? .005;
  return templates.map(template => {
    rigidTransform(template.matrix, scale);
    return Array.from(template.matrix);
  });
}

/** Pack matched current/previous rigid poses in the trace scene's unit scale. */
export function packTemporalMotions(previousMatrices, meshes, { scale = .005, geometryChanged = false } = {}) {
  if (!Array.isArray(previousMatrices) || !Array.isArray(meshes) || previousMatrices.length !== meshes.length)
    throw Error('Temporal instance order/count changed');
  if (!Number.isFinite(scale) || scale <= 0) throw Error('Invalid CAD unit scale');
  const records = new Float32Array((meshes.length + 1) * TEMPORAL_MOTION_FLOATS);
  meshes.forEach((mesh, index) => {
    const current = rigidTransform(mesh?.matrix, scale);
    const previous = rigidTransform(previousMatrices[index], scale);
    const offset = (index + 1) * TEMPORAL_MOTION_FLOATS;
    records.set(current.quaternion, offset);
    records.set(current.translation, offset + 4);
    // A rigid pose cannot describe a deformed cable's previous local surface.
    // Reject its history while leaving all unchanged rigid CAD records valid.
    records[offset + 7] = geometryChanged && mesh.dynamic ? 0 : 1;
    records.set(previous.quaternion, offset + 8);
    records.set(previous.translation, offset + 12);
  });
  for (const value of records) if (!Number.isFinite(value)) throw Error('Temporal motion exceeds FP32 range');
  return records;
}

function offsetOf(records, identity) {
  if (!(records instanceof Float32Array) || records.length % TEMPORAL_MOTION_FLOATS)
    throw Error('Invalid temporal motion buffer');
  if (!Number.isInteger(identity) || identity < 1 || identity >= records.length / TEMPORAL_MOTION_FLOATS)
    throw RangeError('Temporal instance identity outside buffer');
  return identity * TEMPORAL_MOTION_FLOATS;
}
function vector3(vector) {
  if (!vector || vector.length !== 3 || !Array.from(vector).every(Number.isFinite))
    throw Error('Expected finite world vector3');
}
function rotate(q, vector, inverse = false) {
  // Normalize the FP32 quaternion just as the GPU rigid transform does. This
  // keeps reciprocal rotations orthogonal after serialization.
  const length = Math.hypot(...q);
  if (!Number.isFinite(length) || length <= 0) throw Error('Invalid temporal quaternion');
  const sign = inverse ? -1 : 1;
  const x = q[0] / length * sign, y = q[1] / length * sign, z = q[2] / length * sign, w = q[3] / length;
  const [vx, vy, vz] = vector;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty,
    vy + w * ty + z * tx - x * tz,
    vz + w * tz + x * ty - y * tx];
}
function poses(records, identity, reverse) {
  const at = offsetOf(records, identity);
  if (records[at + 7] !== 1) return null;
  const from = at + (reverse ? 8 : 0), to = at + (reverse ? 0 : 8);
  return { fromQuaternion: records.subarray(from, from + 4), fromTranslation: records.subarray(from + 4, from + 7),
    toQuaternion: records.subarray(to, to + 4), toTranslation: records.subarray(to + 4, to + 7) };
}

/** Current world point -> previous world point; both already in trace units. */
export function reprojectPoint(records, identity, worldPoint, { reverse = false } = {}) {
  vector3(worldPoint);
  const pose = poses(records, identity, reverse);
  if (!pose) return null;
  const local = rotate(pose.fromQuaternion, Array.from(worldPoint, (v, k) => v - pose.fromTranslation[k]), true);
  return rotate(pose.toQuaternion, local).map((v, k) => v + pose.toTranslation[k]);
}

/** Rotate a world normal into the previous pose; translations never apply. */
export function reprojectNormal(records, identity, worldNormal, { reverse = false } = {}) {
  vector3(worldNormal);
  const pose = poses(records, identity, reverse);
  if (!pose) return null;
  return rotate(pose.toQuaternion, rotate(pose.fromQuaternion, worldNormal, true));
}
