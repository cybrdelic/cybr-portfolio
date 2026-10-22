// Mean of the green channel in the current 1024-square machining map. Keeping
// its variation centered on one preserves each material's authored roughness.
export const MACHINED_ROUGHNESS_MEAN=.6494857788085937;
export const MACHINED_TEXTURE_WIDTH=1024;
export const MACHINED_VARIATION_SCALE=.16;
export const MACHINED_VARIATION_LIMIT=.04;
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
function smoothstep(low,high,value){const t=clamp((value-low)/(high-low),0,1);return t*t*(3-2*t);}

// Derivatives are UV changes per CSS pixel. The default renderer has DPR 1.
export function machinedTextureFootprint(dUvDx,dUvDy){
 if(![dUvDx,dUvDy].every(value=>value?.length===2&&Array.from(value).every(Number.isFinite)))throw Error('Invalid machining UV derivatives');
 return Math.max(Math.hypot(...dUvDx),Math.hypot(...dUvDy))*MACHINED_TEXTURE_WIDTH;
}
export function evaluateMachinedRoughness({roughness,green=MACHINED_ROUGHNESS_MEAN,footprint=0}){
 if(![roughness,green,footprint].every(Number.isFinite)||roughness<0||roughness>1||green<0||green>1||footprint<0)throw Error('Invalid machining roughness sample');
 const variation=clamp((green/MACHINED_ROUGHNESS_MEAN-1)*MACHINED_VARIATION_SCALE,-MACHINED_VARIATION_LIMIT,MACHINED_VARIATION_LIMIT);
 const resolved=1-smoothstep(.25,1,footprint);
 return roughness*(1+variation*resolved);
}

// Insert immediately after Three's roughnessmap_fragment. texelRoughness is
// defined by that chunk. Part-specific finish multipliers belong to the caller.
export const MACHINED_ROUGHNESS_SHADER_CHUNK=`
#ifdef USE_ROUGHNESSMAP
 float machiningFootprint=max(length(dFdx(vRoughnessMapUv)*${MACHINED_TEXTURE_WIDTH}.),length(dFdy(vRoughnessMapUv)*${MACHINED_TEXTURE_WIDTH}.));
 float machiningResolved=1.-smoothstep(.25,1.,machiningFootprint);
 float machiningVariation=clamp((texelRoughness.g/${MACHINED_ROUGHNESS_MEAN}-1.)*${MACHINED_VARIATION_SCALE},-${MACHINED_VARIATION_LIMIT},${MACHINED_VARIATION_LIMIT});
 roughnessFactor=roughness*(1.+machiningVariation*machiningResolved);
#endif
`;
