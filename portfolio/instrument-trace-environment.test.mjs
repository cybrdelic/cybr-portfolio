import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentDistribution, environmentPDF, environmentDirectionToCell, sampleEnvironmentDistribution, environmentSamplingWGSL } from './instrument-trace-environment.mjs';
const PI=Math.PI,TAU=PI*2,AREA=4*PI;
const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
function image(width,height,value=1){const pixels=new Float32Array(width*height*4);for(let i=0;i<pixels.length;i+=4)pixels.set([value,value,value,1],i);return pixels;}
function random(seed=7139){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function rotation(angle){const c=Math.cos(angle),s=Math.sin(angle);return [[c,0,s],[0,1,0],[-s,0,c]];}
function transposeApply(rows,p){return [0,1,2].map(k=>rows.reduce((sum,row,j)=>sum+row[k]*p[j],0));}
function centerDirection(x,y,width,height){const phi=TAU*((x+.5)/width-.5),lat=PI*((y+.5)/height-.5);return [Math.cos(lat)*Math.cos(phi),Math.sin(lat),Math.cos(lat)*Math.sin(phi)];}
test('two-level CDFs are normalized, monotonic and represent exact latitude solid angles',()=>{
  const width=13,height=7,pixels=image(width,height);pixels[(3*width+7)*4]=900;
  const d=createEnvironmentDistribution(pixels,width,height),h=d.header,data=d.data;
  near(data[h.rowCDFOffset],0,0);near(data[h.rowCDFOffset+height],1,0);let area=0,mass=0;
  for(let y=0;y<height;y++){
    assert.ok(data[h.rowCDFOffset+y+1]>=data[h.rowCDFOffset+y]);const start=h.columnCDFOffset+y*(width+1);
    near(data[start],0,0);near(data[start+width],1,0);
    const exact=TAU/width*(Math.cos(PI*y/height)-Math.cos(PI*(y+1)/height));near(data[h.solidAngleOffset+y],exact,1e-7);area+=data[h.solidAngleOffset+y]*width;
    for(let x=0;x<width;x++){assert.ok(data[start+x+1]>=data[start+x]);mass+=data[h.cellMassOffset+y*width+x];}
  }
  near(area,AREA,1e-6);near(mass,1,1e-7);near(h.importanceWeight+h.uniformWeight,1,0);
  assert.equal(d.stats.storageBytes,data.byteLength);assert.equal(d.stats.zeroRadiance,false);
});
test('every direction retains uniform support and the mixture PDF integrates to one',()=>{
  const width=12,height=9,pixels=image(width,height,0);pixels.set([1000,1000,1000,1],(4*width+8)*4);
  const d=createEnvironmentDistribution(pixels,width,height),h=d.header;let integral=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const pdf=environmentPDF(d,centerDirection(x,y,width,height));assert.ok(pdf>=h.uniformWeight/AREA);
    integral+=pdf*d.data[h.solidAngleOffset+y];
  }
  near(integral,1,1e-7);assert.equal(d.stats.positiveCells,1);
  assert.ok(environmentPDF(d,[0,1,0])>0);assert.ok(environmentPDF(d,[0,-1,0])>0);
});
test('zero HDR falls back to a full sphere distribution without NaN or empty CDFs',()=>{
  const width=16,height=8,d=createEnvironmentDistribution(image(width,height,0),width,height);
  assert.equal(d.stats.zeroRadiance,true);assert.equal(d.stats.totalLuminanceIntegral,0);
  for(const value of d.data)assert.ok(Number.isFinite(value));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)near(environmentPDF(d,centerDirection(x,y,width,height)),1/AREA,1e-7);
  const rng=random(33);for(let i=0;i<200;i++){const v=sampleEnvironmentDistribution(d,rng);near(Math.hypot(...v),1,1e-12);assert.ok(environmentPDF(d,v)>0);}
});
test('inverse rotation and engine UV convention identify the same sampled HDR cell',()=>{
  const width=11,height=7,d=createEnvironmentDistribution(image(width,height),width,height),rows=rotation(.73);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const local=centerDirection(x,y,width,height),world=transposeApply(rows,local);
    assert.deepEqual(environmentDirectionToCell(world,width,height,rows),[x,y]);
    near(environmentPDF(d,world,rows),environmentPDF(d,local),1e-12);
  }
  const row=2,col=8,h=d.header,offset=h.columnCDFOffset+row*(width+1),values=[.1,(d.data[h.rowCDFOffset+row]+d.data[h.rowCDFOffset+row+1])/2,(d.data[offset+col]+d.data[offset+col+1])/2,.25,.75];
  let index=0;const direction=sampleEnvironmentDistribution(d,()=>values[index++],rows);
  assert.deepEqual(environmentDirectionToCell(direction,width,height,rows),[col,row]);
  const y0=-Math.cos(PI*row/height),y1=-Math.cos(PI*(row+1)/height),local=rows.map(r=>r.reduce((sum,v,k)=>sum+v*direction[k],0));
  near(local[1],y0+(y1-y0)*.75,1e-12);
});
test('sampled cell frequencies follow quantized CDF mass plus uniform solid angle',()=>{
  const width=6,height=4,pixels=image(width,height,.001);pixels.set([3000,3000,3000,1],(1*width+3)*4);
  const d=createEnvironmentDistribution(pixels,width,height),counts=new Uint32Array(width*height),rng=random(113),samples=60000;
  for(let i=0;i<samples;i++){const v=sampleEnvironmentDistribution(d,rng),[x,y]=environmentDirectionToCell(v,width,height);counts[y*width+x]++;}
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const expected=d.header.importanceWeight*d.data[d.header.cellMassOffset+y*width+x]+d.header.uniformWeight*d.data[d.header.solidAngleOffset+y]/AREA;
    const tolerance=6*Math.sqrt(expected*(1-expected)/samples)+.0002;near(counts[y*width+x]/samples,expected,tolerance);
  }
  assert.ok(counts[1*width+3]/samples>.95);
});
test('importance MIS estimates HDR energy with much lower direct-light variance than uniform sampling',()=>{
  const width=32,height=16,pixels=image(width,height,.05);pixels.set([1000,1000,1000,1],(7*width+21)*4);
  const d=createEnvironmentDistribution(pixels,width,height),samples=12000,rng=random(919),uniformRng=random(122);
  const luminance=v=>{const [x,y]=environmentDirectionToCell(v,width,height);return pixels[(y*width+x)*4];};
  let importance=0,importance2=0,uniform=0,uniform2=0;
  for(let i=0;i<samples;i++){
    const v=sampleEnvironmentDistribution(d,rng),a=luminance(v)/environmentPDF(d,v);importance+=a;importance2+=a*a;
    const y=2*uniformRng()-1,phi=TAU*(uniformRng()-.5),r=Math.sqrt(1-y*y),b=luminance([r*Math.cos(phi),y,r*Math.sin(phi)])*AREA;uniform+=b;uniform2+=b*b;
  }
  const mean=importance/samples,variance=importance2/samples-mean*mean,uniformMean=uniform/samples,uniformVariance=uniform2/samples-uniformMean*uniformMean;
  near(mean,d.stats.totalLuminanceIntegral,6*Math.sqrt(variance/samples));
  assert.ok(variance<uniformVariance*.01,`importance variance ${variance} must improve on uniform ${uniformVariance}`);
});
test('WGSL storage, mixture density and transpose rotation preserve the sampling contract',()=>{
  assert.ok(environmentSamplingWGSL.includes('@binding(9) var<storage,read> environmentDistribution:array<f32>'));
  assert.ok(environmentSamplingWGSL.includes('environmentDistribution[6]*mass/solidAngle+environmentDistribution[7]/(4.*PI)'));
  assert.ok(environmentSamplingWGSL.includes('u.environmentX.x,u.environmentY.x,u.environmentZ.x'));
  assert.ok(environmentSamplingWGSL.includes('let y0=-cos(PI*f32(row)/f32(height))'));
  assert.ok(!environmentSamplingWGSL.includes('clamp(radiance'));
  assert.throws(()=>createEnvironmentDistribution(new Float32Array(4),2,2),/RGBA32F/);
  const invalid=image(2,2);invalid[0]=NaN;assert.throws(()=>createEnvironmentDistribution(invalid,2,2),/Nonfinite/);
});
