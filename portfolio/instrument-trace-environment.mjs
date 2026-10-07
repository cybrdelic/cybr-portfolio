// Importance sample the ORIGINAL linear HDR. No image changes, radiance
// clamping, lost directions, or approximation of a latitude band's area.
const PI = Math.PI, TAU = 2 * PI, SPHERE_AREA = 4 * PI;
const identityRows = [[1,0,0], [0,1,0], [0,0,1]];
const normalize = v => { const length = Math.hypot(...v); if (!length || !Number.isFinite(length)) throw Error('Invalid environment direction'); return v.map(x => x / length); };
const dot = (a,b) => a.reduce((sum,v,k) => sum + v*b[k],0);
function localDirection(direction, rows) { return normalize(rows.map(row => dot(row, direction))); }
function worldDirection(direction, rows) { return normalize([0,1,2].map(k => rows.reduce((sum,row,j) => sum + row[k]*direction[j],0))); }
function checkRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 3 || rows.some(row => row.length < 3 || row.slice(0,3).some(v => !Number.isFinite(v)))) throw Error('Invalid environment rotation');
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(Math.abs(dot(rows[i].slice(0,3),rows[j].slice(0,3))-(i===j?1:0))>1e-5)throw Error('Environment rotation must be orthogonal');
}
export function createEnvironmentDistribution(pixels, width, height) {
  if (!(pixels instanceof Float32Array) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== width*height*4) throw Error('Invalid RGBA32F environment');
  const cells=width*height, rowCDFOffset=8, columnCDFOffset=rowCDFOffset+height+1,
    cellMassOffset=columnCDFOffset+height*(width+1), solidAngleOffset=cellMassOffset+cells;
  if(solidAngleOffset+height>=16777216)throw Error('Environment distribution exceeds exact FP32 offset range');
  const data=new Float32Array(solidAngleOffset+height), rowWeights=new Float64Array(height), cellWeights=new Float64Array(cells), solidAngles=new Float64Array(height);
  let totalLuminanceIntegral=0;
  for(let y=0;y<height;y++) {
    const area=TAU/width*(Math.cos(PI*y/height)-Math.cos(PI*(y+1)/height));
    solidAngles[y]=area;data[solidAngleOffset+y]=area;
    for(let x=0;x<width;x++) {
      const at=(y*width+x)*4;
      for(let k=0;k<4;k++)if(!Number.isFinite(pixels[at+k]))throw Error('Nonfinite HDR environment value');
      const luminance=Math.max(0,.2126*pixels[at]+.7152*pixels[at+1]+.0722*pixels[at+2]);
      const weight=luminance*area;cellWeights[y*width+x]=weight;rowWeights[y]+=weight;
    }
    totalLuminanceIntegral+=rowWeights[y];
  }
  const zeroRadiance=totalLuminanceIntegral===0;
  if(zeroRadiance)for(let y=0;y<height;y++) {
    rowWeights[y]=solidAngles[y]*width;
    for(let x=0;x<width;x++)cellWeights[y*width+x]=solidAngles[y];
  }
  const total=zeroRadiance?SPHERE_AREA:totalLuminanceIntegral;
  let rowCumulative=0;
  data[rowCDFOffset]=0;
  for(let y=0;y<height;y++) {
    rowCumulative+=rowWeights[y]/total;
    data[rowCDFOffset+y+1]=y===height-1?1:Math.min(1,rowCumulative);
    const start=columnCDFOffset+y*(width+1);let colCumulative=0;data[start]=0;
    for(let x=0;x<width;x++) {
      colCumulative+=rowWeights[y]>0?cellWeights[y*width+x]/rowWeights[y]:1/width;
      data[start+x+1]=x===width-1?1:Math.min(1,colCumulative);
    }
  }
  // Store the probabilities actually represented by the FP32 CDFs. Tiny
  // weights that collapse under CDF quantization remain covered by uniform MIS.
  let representedMass=0, positiveCells=0;
  for(let y=0;y<height;y++) {
    const rowMass=Math.fround(data[rowCDFOffset+y+1]-data[rowCDFOffset+y]),start=columnCDFOffset+y*(width+1);
    for(let x=0;x<width;x++) {
      const mass=Math.fround(rowMass*Math.fround(data[start+x+1]-data[start+x]));
      data[cellMassOffset+y*width+x]=mass;representedMass+=mass;if(mass>0)positiveCells++;
    }
  }
  const importanceWeight=Math.fround(.95),uniformWeight=Math.fround(1-importanceWeight);
  data.set([width,height,rowCDFOffset,columnCDFOffset,cellMassOffset,solidAngleOffset,importanceWeight,uniformWeight]);
  return {data,header:{width,height,rowCDFOffset,columnCDFOffset,cellMassOffset,solidAngleOffset,importanceWeight,uniformWeight},
    stats:{cells,storageBytes:data.byteLength,totalLuminanceIntegral,zeroRadiance,representedMass,positiveCells}};
}

// CPU reference uses the same quantized CDF data as WGSL, for normalization,
// cell identity, support and rotation tests. Direction axes match Three's HDR UV.
export function environmentDirectionToCell(direction,width,height,worldToLocal=identityRows) {
  checkRows(worldToLocal);const q=localDirection(direction,worldToLocal);
  const u=(Math.atan2(q[2],q[0])/TAU+.5+1)%1,v=Math.asin(Math.max(-1,Math.min(1,q[1])))/PI+.5;
  return [Math.min(width-1,Math.floor(u*width)),Math.min(height-1,Math.max(0,Math.floor(v*height)))];
}
export function environmentPDF(distribution,direction,worldToLocal=identityRows) {
  const {data,header:h}=distribution,[x,y]=environmentDirectionToCell(direction,h.width,h.height,worldToLocal);
  return h.importanceWeight*data[h.cellMassOffset+y*h.width+x]/data[h.solidAngleOffset+y]+h.uniformWeight/SPHERE_AREA;
}
function cdfCell(data,offset,count,value) {
  let low=0,high=count;
  while(low<high){const mid=(low+high)>>>1;if(value>=data[offset+mid+1])low=mid+1;else high=mid;}
  return Math.min(low,count-1);
}
export function sampleEnvironmentDistribution(distribution,random,worldToLocal=identityRows) {
  checkRows(worldToLocal);const {data,header:h}=distribution;
  const r=()=>{const value=random();if(!Number.isFinite(value)||value<0||value>=1)throw Error('Random variate must be in [0,1)');return value;};
  let phi,localY;
  if(r()<h.importanceWeight) {
    const row=cdfCell(data,h.rowCDFOffset,h.height,r()),col=cdfCell(data,h.columnCDFOffset+row*(h.width+1),h.width,r());
    phi=TAU*((col+r())/h.width-.5);
    const y0=-Math.cos(PI*row/h.height),y1=-Math.cos(PI*(row+1)/h.height);localY=y0+(y1-y0)*r();
  } else { localY=2*r()-1;phi=TAU*(r()-.5); }
  const radius=Math.sqrt(Math.max(0,1-localY*localY)),local=[radius*Math.cos(phi),localY,radius*Math.sin(phi)];
  return worldDirection(local,worldToLocal);
}

export const environmentSamplingWGSL = `
@group(0) @binding(9) var<storage,read> environmentDistribution:array<f32>;
fn environmentCdfCell(offset:u32,count:u32,value:f32)->u32 {
 var low=0u;var high=count;
 loop {if(low>=high){break;}let mid=(low+high)/2u;
  if(value>=environmentDistribution[offset+mid+1u]){low=mid+1u;}else{high=mid;}
 }return min(low,count-1u);
}
fn environmentLocalDirection(d:vec3f)->vec3f {
 return normalize(vec3f(dot(u.environmentX.xyz,d),dot(u.environmentY.xyz,d),dot(u.environmentZ.xyz,d)));
}
fn environmentWorldDirection(d:vec3f)->vec3f {
 return normalize(vec3f(dot(vec3f(u.environmentX.x,u.environmentY.x,u.environmentZ.x),d),
  dot(vec3f(u.environmentX.y,u.environmentY.y,u.environmentZ.y),d),
  dot(vec3f(u.environmentX.z,u.environmentY.z,u.environmentZ.z),d)));
}
fn environmentPDF(d:vec3f)->f32 {
 let q=environmentLocalDirection(d);let width=u32(environmentDistribution[0]);let height=u32(environmentDistribution[1]);
 let uv=vec2f(atan2(q.z,q.x)/(2.*PI)+.5,asin(clamp(q.y,-1.,1.))/PI+.5);
 let x=min(width-1u,u32(fract(uv.x)*f32(width)));let y=min(height-1u,u32(clamp(uv.y,0.,1.)*f32(height)));
 let mass=environmentDistribution[u32(environmentDistribution[4])+y*width+x];
 let solidAngle=environmentDistribution[u32(environmentDistribution[5])+y];
 return environmentDistribution[6]*mass/solidAngle+environmentDistribution[7]/(4.*PI);
}
fn sampleEnvironment(seed:ptr<function,u32>)->vec3f {
 let width=u32(environmentDistribution[0]);let height=u32(environmentDistribution[1]);var phi=0.;var localY=0.;
 if(random(seed)<environmentDistribution[6]) {
  let row=environmentCdfCell(u32(environmentDistribution[2]),height,random(seed));
  let col=environmentCdfCell(u32(environmentDistribution[3])+row*(width+1u),width,random(seed));
  phi=2.*PI*((f32(col)+random(seed))/f32(width)-.5);
  let y0=-cos(PI*f32(row)/f32(height));let y1=-cos(PI*f32(row+1u)/f32(height));localY=mix(y0,y1,random(seed));
 }else{localY=2.*random(seed)-1.;phi=2.*PI*(random(seed)-.5);}
 let radius=sqrt(max(0.,1.-localY*localY));return environmentWorldDirection(vec3f(radius*cos(phi),localY,radius*sin(phi)));
}
fn areaSelection()->f32{return 0.;}
`;
