// Three r180 tonemapping_pars_fragment, row-major forms of its GLSL matrices.
const INPUT=[.59719,.35458,.04823,.076,.90834,.01566,.0284,.13383,.83777];
const OUTPUT=[1.60475,-.53108,-.07367,-.10208,1.10813,-.00605,-.00327,-.07276,1.07602];
const multiply=(matrix,value)=>[0,3,6].map(row=>matrix[row]*value[0]+matrix[row+1]*value[1]+matrix[row+2]*value[2]);
function inverse([a,b,c,d,e,f,g,h,i]){
  const determinant=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  return [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d].map(value=>value/determinant);
}
const INVERSE_INPUT=inverse(INPUT),INVERSE_OUTPUT=inverse(OUTPUT);
function validExposure(exposure){
  if(!Number.isFinite(exposure)||exposure<=0)throw Error('Paper exposure must be positive and finite');
}
// Invert the shader's actual 0.41666 exponent, including its branch boundary.
const encode=value=>value<=.0031308?12.92*value:1.055*Math.pow(value,.41666)-.055;
const decode=value=>value<=12.92*.0031308?value/12.92:Math.pow((value+.055)/1.055,1/.41666);

/** Forward ACES + sRGB output, for linear HDR radiance at a given exposure. */
export function rasterPaperDisplay(radiance,exposure=1){
  validExposure(exposure);
  if(!radiance||radiance.length!==3||!Array.from(radiance).every(value=>Number.isFinite(value)&&value>=0))
    throw Error('Paper radiance must contain three finite nonnegative values');
  const fitted=multiply(INPUT,Array.from(radiance,value=>value*exposure/.6)).map(value=>
    (value*(value+.0245786)-.000090537)/(value*(.983729*value+.432951)+.238081));
  return multiply(OUTPUT,fitted).map(value=>encode(Math.max(0,Math.min(1,value))));
}

/** Linear HDR clear radiance whose final ACES output matches the CSS hex. */
export function rasterPaperRadiance(color=0xf4f4f2,exposure=1){
  validExposure(exposure);
  if(!Number.isInteger(color)||color<0||color>0xffffff)throw Error('Paper color must be a 24-bit integer hex');
  const display=[color>>16&255,color>>8&255,color&255].map(value=>decode(value/255));
  const fitted=multiply(INVERSE_OUTPUT,display).map(value=>{
    const a=1-.983729*value,b=.0245786-.432951*value,c=-.000090537-.238081*value;
    return (-b+Math.sqrt(b*b-4*a*c))/(2*a);
  });
  const radiance=multiply(INVERSE_INPUT,fitted).map(value=>value*.6/exposure);
  if(!radiance.every(value=>Number.isFinite(value)&&value>=0))throw Error('Paper color is outside positive ACES HDR gamut');
  return radiance;
}

export function createRasterPaper(THREE,{color=0xf4f4f2,exposure=1}={}){
  if(typeof THREE?.Color!=='function')throw Error('Three Color factory is required');
  return new THREE.Color(...rasterPaperRadiance(color,exposure));
}
