// One authored photographic rig drives both the finite key and its reflection.
// Static radiance is prefiltered once; this is raster lighting, not a ray pass.
export const SHADOW_STUDIO=Object.freeze({
 keyPosition:Object.freeze([7,9,-2]),
 keyTarget:Object.freeze([0,-1.3,0]),
 keyColor:0xffdfb6,
 floorColor:0x87402c,
 wallColor:0x542319,
 fillColor:0xb8cce0,
 fillIntensity:.22,
 hemisphereIntensity:.085,
 environmentIntensity:.68,
 cards:Object.freeze([
  Object.freeze({size:[5,8],position:[7,9,-2],radiance:[9,7.1,5.2]}),
  Object.freeze({size:[1.1,8],position:[-6,3,4],radiance:[2.2,2.65,3.1]}),
  Object.freeze({size:[7,1.2],position:[0,10,1],radiance:[3.3,2.9,2.4]}),
  Object.freeze({size:[9,9],position:[-4,3,12],radiance:[.22,.26,.31]}),
  Object.freeze({size:[14,14],position:[0,-10,0],radiance:[.22,.065,.028]})
 ])
});
