// Offline adapter only. Native CYBR FLIP III solver is imported unchanged.
import {FlipSolver,makePreset} from '../../cybr-elements/work/flip-lettering/vendor/src/flip.js';
import {SurfaceBuilder} from '../../cybr-elements/work/flip-lettering/vendor/src/surface.js';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {gzipSync} from 'node:zlib';
const args=process.argv.slice(2),value=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:Number(args[i+1]);};
const out=path.resolve(args[0]||'portfolio/assets/instrument-fluid');fs.mkdirSync(out,{recursive:true});
const frames=value('frames',72),fps=value('fps',180),drive=value('drive',0),measuredCFL=args.includes('--measured-cfl');
if(!Number.isInteger(frames)||frames<2||fps<20||fps>180||!Number.isFinite(drive))throw Error('Invalid bake timing');
const config=makePreset('slosh','high');Object.assign(config,{nameKey:'instrument-vessel',h:.00125,nx:48,ny:52,nz:48,extent:[.060,.065,.060],maxParticles:600000,obstacles:[],seed:9217,pressureTolerance:2e-5,iterations:300,shapeTransport:false});
// Positive clearance inside the rounded glass cavity and outside the cable.
function clearance(x,y,z){
  const px=x-.030,py=y-.0325,pz=z-.030,r=.010;
  const q=[Math.abs(px)-(.0265-r),Math.abs(py)-(.0295-r),Math.abs(pz)-(.0275-r)];
  const wall=r-Math.hypot(...q.map(a=>Math.max(0,a)))-Math.min(Math.max(...q),0);
  const t=Math.max(0,Math.min(1,(px+.035)/.070)),s=Math.sin(Math.PI*t)**2;
  const wire=Math.hypot(py-(-.0025-.007*s),pz-(-.008-.005*s))-.0026;
  return Math.min(wall,wire);
}
class Vessel extends FlipSolver{
  insideSolid(x,y,z,margin=0){return clearance(x,y,z)<margin;}
  initialize(){this.seedVolume((x,y,z)=>y<.043+.003*(x-.030)/.0265,[.055,0,.012]);}
  emit(){}
  advance(frameDt){
    if(!measuredCFL)return super.advance(frameDt);
    let remaining=frameDt,steps=0;
    while(remaining>1e-8){
      this.gravity[0]=drive*Math.sin(2*Math.PI*this.time/3.6);
      const speed=this.maxSpeed(),acceleration=Math.hypot(...this.gravity),distance=.55*this.h;
      // Bound v*dt + |g|*dt² in metres. The stock adapter's 1 m/s
      // speed floor is needlessly restrictive for a 53 mm vessel.
      const bound=2*distance/(speed+Math.sqrt(speed*speed+4*acceleration*distance));
      const dt=Math.min(remaining,1/90,bound);
      this.step(dt);remaining-=dt;steps++;
      if(steps>256)throw Error('Measured CFL substep budget exceeded');
    }
    return this.inspect(steps);
  }
  collide(n){
    const q=n*3,p=this.p,v=this.v,margin=this.h*.12,e=.00001;
    for(let k=0;k<3;k++){
      const x=p[q],y=p[q+1],z=p[q+2],c=clearance(x,y,z);if(c>=margin)break;
      let nx=clearance(x+e,y,z)-clearance(x-e,y,z),ny=clearance(x,y+e,z)-clearance(x,y-e,z),nz=clearance(x,y,z+e)-clearance(x,y,z-e);
      const l=Math.hypot(nx,ny,nz);if(l<1e-12)throw Error('Degenerate cavity normal');nx/=l;ny/=l;nz/=l;
      p[q]+=(margin-c)*nx;p[q+1]+=(margin-c)*ny;p[q+2]+=(margin-c)*nz;
      const vn=v[q]*nx+v[q+1]*ny+v[q+2]*nz;if(vn<0){v[q]-=vn*nx;v[q+1]-=vn*ny;v[q+2]-=vn*nz;}
    }
  }
}
const sim=new Vessel(config),surface=new SurfaceBuilder(config),start=performance.now();
const dt=1/fps,manifest={version:2,solver:'CYBR FLIP III quadratic APIC/FLIP, Galerkin MG-PCG (unchanged)',config,frameDt:dt,frames:[],coordinateTransform:'simulation metres (X,Y-up,Z) to CAD millimetres (X,Z,Y)',playback:'recorded physical sequence; reverse playback is not reverse simulation',positionScale:512,forcing:{lateralAccelerationMPS2:drive,periodSeconds:3.6},timestep:measuredCFL?'measured velocity plus gravity displacement <= 0.55 grid cells':'production adapter'};
for(let i=0;i<frames;i++){
  const info=sim.advance(dt);
  if(!info.finite||info.capacityRejected||info.pressureFailures||!info.pressure.converged)throw Error(JSON.stringify({frame:i,...info}));
  surface.density(sim.p,sim.count);
  const g=surface.mesh(sim.p,sim.count),count=g.positions.length/3;
  if(count<300||!Number.isFinite(surface.lastMeshStats.volume))throw Error('Empty or invalid liquid reconstruction');
  const pos=new Int16Array(count*3),norm=new Int16Array(count*3);
  for(let j=0;j<count;j++){
    const q=j*3;pos[q]=Math.round((g.positions[q]-.030)*1000*512);pos[q+1]=Math.round((g.positions[q+2]-.030)*1000*512);pos[q+2]=Math.round((g.positions[q+1]-.0325)*1000*512);
    norm[q]=Math.round(g.normals[q]*32767);norm[q+1]=Math.round(g.normals[q+2]*32767);norm[q+2]=Math.round(g.normals[q+1]*32767);
  }
  // Coordinate swap reverses handedness: reverse each triangle's winding.
  for(let j=0;j<count;j+=3)for(let a=0;a<3;a++){let x=pos[(j+1)*3+a];pos[(j+1)*3+a]=pos[(j+2)*3+a];pos[(j+2)*3+a]=x;x=norm[(j+1)*3+a];norm[(j+1)*3+a]=norm[(j+2)*3+a];norm[(j+2)*3+a]=x;}
  const packed=gzipSync(Buffer.concat([Buffer.from(pos.buffer),Buffer.from(norm.buffer)]),{level:9});
  const file=`${String(i).padStart(3,'0')}.bin.gz`;fs.writeFileSync(path.join(out,file),packed);
  manifest.frames.push({file,count,bytes:packed.length,sha256:crypto.createHash('sha256').update(packed).digest('hex'),particles:sim.count,finite:info.finite,pressure:info.pressure,solidViolations:info.solidViolations,volume:surface.lastMeshStats});
  if(i%3===0)console.log(JSON.stringify({frame:i,particles:sim.count,triangles:count/3,substeps:info.substeps,time:sim.time,seconds:Math.round((performance.now()-start)/1000)}));
}
manifest.complete=true;manifest.seconds=(performance.now()-start)/1000;
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest));console.log(JSON.stringify({complete:true,frames,seconds:manifest.seconds,bytes:manifest.frames.reduce((n,f)=>n+f.bytes,0)}));
