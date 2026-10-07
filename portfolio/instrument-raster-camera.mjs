// The instrument interpolates orthographic and perspective projection matrices.
// Three's stock view vector only covers the two endpoints. These two entries
// describe the actual virtual eye for every projection on that interpolation.
const stockView = /vec3\s+geometryViewDir\s*=\s*\(\s*isOrthographic\s*\)\s*\?\s*vec3\s*\(\s*0(?:\.0)?\s*,\s*0(?:\.0)?\s*,\s*1(?:\.0)?\s*\)\s*:\s*normalize\s*\(\s*vViewPosition\s*\)\s*;/g;
const actualView = 'vec3 geometryViewDir = normalize(vViewPosition * (-projectionMatrix[2][3]) + vec3(0.0, 0.0, projectionMatrix[3][3]));';
const stockTransmissionView = /vec3\s+v\s*=\s*normalize\s*\(\s*cameraPosition\s*-\s*pos\s*\)\s*;/g;
const actualTransmissionView = 'vec3 v = inverseTransformDirection(geometryViewDir, viewMatrix);';
const declaration = '#ifndef USE_TRANSMISSION\nuniform mat4 projectionMatrix;\n#endif\n';

export function mixedCameraViewDirection(viewPosition, projection) {
  const position = viewPosition?.toArray ? viewPosition.toArray() : viewPosition;
  const matrix = projection?.elements ?? projection;
  if (!position || position.length !== 3 || !Array.from(position).every(Number.isFinite)
    || !matrix || matrix.length !== 16 || !Array.from(matrix).every(Number.isFinite))
    throw Error('Invalid mixed-camera view position or projection');
  const direction = Array.from(position, value => value * -matrix[11]);
  direction[2] += matrix[15];
  const length = Math.hypot(...direction);
  if (!(length > 0)) throw Error('Degenerate mixed-camera view direction');
  return direction.map(value => value / length);
}

export function bindRasterCamera(shader, THREE) {
  if (!shader || typeof shader.fragmentShader !== 'string' || !THREE?.ShaderChunk?.lights_fragment_begin)
    throw Error('Missing raster-camera shader contract');
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if ([...chunk.matchAll(stockView)].length !== 1)
    throw Error('Unsupported Three physical view-vector shader ABI');
  const marker = '#include <lights_fragment_begin>';
  let fragment = shader.fragmentShader;
  if (fragment.includes(marker)) {
    if (fragment.split(marker).length !== 2) throw Error('Ambiguous raster-camera light shader chunk');
    fragment = fragment.replace(marker, chunk);
  }
  if ([...fragment.matchAll(stockView)].length !== 1)
    throw Error('Missing unique physical view vector in raster shader');
  const transmissionMarker = '#include <transmission_fragment>';
  const transmissionRequested = fragment.includes(transmissionMarker)
    || [...fragment.matchAll(stockTransmissionView)].length > 0
    || Object.hasOwn(shader.defines ?? {}, 'USE_TRANSMISSION')
    || /^\s*#\s*define\s+USE_TRANSMISSION\b/m.test(fragment);
  if (transmissionRequested) {
    const transmissionChunk = THREE.ShaderChunk.transmission_fragment;
    if (typeof transmissionChunk !== 'string' || [...transmissionChunk.matchAll(stockTransmissionView)].length !== 1)
      throw Error('Unsupported Three transmission view-vector shader ABI');
    if (fragment.includes(transmissionMarker)) {
      if (fragment.split(transmissionMarker).length !== 2) throw Error('Ambiguous raster-camera transmission shader chunk');
      fragment = fragment.replace(transmissionMarker, transmissionChunk);
    }
    if ([...fragment.matchAll(stockTransmissionView)].length !== 1)
      throw Error('Missing unique transmission view vector in raster shader');
    // The stock transmission call independently constructs a world-space view
    // vector. Reuse the corrected physical direction and transform it to world
    // space, so both refraction and Fresnel use the actual projection.
    fragment = fragment.replace(stockTransmissionView, actualTransmissionView);
  }
  // WebGLRenderer uploads this linked built-in uniform for the camera of each
  // render, including all six probe faces. No shared main-camera copy is used.
  shader.fragmentShader = declaration + fragment.replace(stockView, actualView);
  return true;
}
