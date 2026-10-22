// Use Three's video allocation path, but let the synchronized simulation clock
// publish frames. A plain Texture(video) allocates immutable storage before the
// video's dimensions are known and can trigger invalid subtexture uploads.
export function createSynchronizedVideoTexture(THREE, video) {
  const texture = new THREE.Texture(video);
  texture.isVideoTexture = true;
  texture.update = () => {}; // delivered() sets needsUpdate after water is ready.
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}
