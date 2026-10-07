/** CYBR FLIP III: quadratic B-spline APIC/FLIP; Galerkin MG-PCG;
 * matched extrapolation, reliable residuals, symmetric-strain viscosity,
 * transported particle shape tensors, explicit two-way rigid coupling.
 * SI units. CPU reference used unchanged by Node and the browser worker.
 */
import {FlipSolver as ReferenceFlipSolver,PRESETS as REFERENCE_PRESETS,makePreset as referencePreset} from './flip-reference.js';
import {CSRMatrix,GalerkinMultigrid,pcg} from './numerics/multigrid.js';
import {SymmetricStressSystem} from './numerics/stress.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const PRESETS={...structuredClone(REFERENCE_PRESETS),
 hero:{name:'HERO / liquid and free body',subtitle:'Impact sheets · two-way floating body · returned wake',extent:[4.8,3.2,3.2],h:.08,flip:.88,seed:7135,
  obstacles:[{kind:'sphere',center:[2.65,.88,1.6],radius:.37,dynamic:true,density:580,velocity:[0,0,0]}]},
 buoy:{name:'BUOYANCY / two-way coupling',subtitle:'Free body · pressure force · momentum exchange',extent:[4.8,3.2,3.2],h:.08,flip:.88,seed:4852,
  obstacles:[{kind:'sphere',center:[2.4,1.44,1.6],radius:.46,dynamic:true,density:620,velocity:[.7,-1.0,0]}]}
};
export function makePreset(name,quality='high') {
  if(!PRESETS[name])throw Error('Unknown scene '+name);
  let c;
  if(REFERENCE_PRESETS[name])c=referencePreset(name,quality);
  else {
    c=structuredClone(PRESETS[name]);c.nameKey=name;
    if(quality==='live')c.h*=1.5;if(quality==='test')c.h*=2.5;if(quality==='ultra')c.h*=.75;
    c.nx=Math.round(c.extent[0]/c.h);c.ny=Math.round(c.extent[1]/c.h);c.nz=Math.round(c.extent[2]/c.h);
    c.extent=[c.nx*c.h,c.ny*c.h,c.nz*c.h];c.quality=quality;
  }
  Object.assign(c,{transfer:'quadratic-apic-flip',affine:true,pressureMethod:'galerkin-mg-pcg',
    pressureTolerance:quality==='live'?6e-5:1e-5,iterations:240,extrapolationLayers:3,
    advection:'rk2',separation:false,shapeTransport:true,maxParticles:800000,density:1000,
    surfaceTension:c.surfaceTension??.072,ghostFluid:true});
  if(!['capillary','viscous'].includes(name))c.flip=.88;
  if(name==='capillary'){c.flip=.12;c.curvatureSmoothing=4;}
  if(name==='viscous'){c.flip=.1;c.viscosityModel='symmetric-stress';}
  return c;
}
function detSym(a,b,c,d,e,f){return a*b*c+2*d*e*f-a*f*f-b*e*e-c*d*d;}
export class FlipSolver extends ReferenceFlipSolver {
  constructor(config) {
    super(config);
    this.shape=new Float32Array(this.maxParticles*6);this.shapeInitialized=0;
    this.previousPosition=new Float32Array(this.maxParticles*3);
    this.shapeResets=0;this.pressureFailures=0;this.pressureSolveCount=0;
    this.totalPressureIterations=0;this.dynamic=this.obstacles.some(o=>o.dynamic);
    this.moving=this.moving||this.dynamic;
    for(const o of this.obstacles) if(o.dynamic) {
      const volume=o.kind==='sphere'?4*Math.PI*o.radius**3/3:8*o.half[0]*o.half[1]*o.half[2];
      o.mass=o.mass??(o.density??600)*volume;o.velocity=o.velocity??[0,0,0];
      o.force=o.force??[0,0,0];o.impulsePending=[0,0,0];o.angularVelocity=[0,0,0];o.torque=[0,0,0];
      o.displacedVolume=volume;
    }
    this.initializeShapes();
  }
  initialize() {
    super.initialize();const key=this.config.nameKey;
    if(key==='hero') {
      this.seedVolume((x,y,z)=>y<.58||(x<1.28&&y<2.32));
      for(let n=0;n<this.count;n++)if(this.p[n*3]<1.28)this.v[n*3]=1.15;
    }
    if(key==='buoy')this.seedVolume((x,y,z)=>y<1.02);
  }
  initializeShapes() {
    for(let n=this.shapeInitialized;n<this.count;n++) {
      const q=n*6;this.shape[q]=this.shape[q+1]=this.shape[q+2]=1;
      this.shape[q+3]=this.shape[q+4]=this.shape[q+5]=0;
    }this.shapeInitialized=this.count;
  }
  /** Separable quadratic cardinal B-spline. D_p=(h²/4)I for complete
   * interior stencils; APIC moments use that identity, not a sampled gradient.
   */
  splat(c,x,y,z,value) {
    if(this.config.transfer!=='quadratic-apic-flip')return super.splat(c,x,y,z,value);
    const h=this.h,fx=x/h-(c===0?0:.5),fy=y/h-(c===1?0:.5),fz=z/h-(c===2?0:.5);
    const i=clamp(Math.floor(fx-.5),0,this.nx-2),j=clamp(Math.floor(fy-.5),0,this.ny-2),k=clamp(Math.floor(fz-.5),0,this.nz-2);
    const dx=fx-i,dy=fy-j,dz=fz-k;
    const wx=[.5*(1.5-dx)**2,.75-(dx-1)**2,.5*(dx-.5)**2];
    const wy=[.5*(1.5-dy)**2,.75-(dy-1)**2,.5*(dy-.5)**2];
    const wz=[.5*(1.5-dz)**2,.75-(dz-1)**2,.5*(dz-.5)**2];
    const A=this.affine,start=this.currentParticle*9+c*3;
    const ax=this.config.affine!==false?(A[start]||0):0,ay=this.config.affine!==false?(A[start+1]||0):0,az=this.config.affine!==false?(A[start+2]||0):0;
    const g=this.u[c],weight=this.weights[c];
    for(let a=0;a<3;a++)for(let b=0;b<3;b++)for(let d=0;d<3;d++) {
      const q=(i+a)*this.sx+(j+b)*this.sy+k+d,w=wx[a]*wy[b]*wz[d];
      g[q]+=w*(value+h*(ax*(a-dx)+ay*(b-dy)+az*(d-dz)));weight[q]+=w;
    }
  }
  sample(g,c,x,y,z) {
    if(this.config.transfer!=='quadratic-apic-flip')return super.sample(g,c,x,y,z);
    const h=this.h,fx=clamp(x/h-(c===0?0:.5),.5,this.nx-.5),fy=clamp(y/h-(c===1?0:.5),.5,this.ny-.5),fz=clamp(z/h-(c===2?0:.5),.5,this.nz-.5);
    const i=Math.min(this.nx-2,Math.floor(fx-.5)),j=Math.min(this.ny-2,Math.floor(fy-.5)),k=Math.min(this.nz-2,Math.floor(fz-.5));
    const dx=fx-i,dy=fy-j,dz=fz-k;
    const wx=[.5*(1.5-dx)**2,.75-(dx-1)**2,.5*(dx-.5)**2],wy=[.5*(1.5-dy)**2,.75-(dy-1)**2,.5*(dy-.5)**2],wz=[.5*(1.5-dz)**2,.75-(dz-1)**2,.5*(dz-.5)**2];
    let out=0;
    for(let a=0;a<3;a++)for(let b=0;b<3;b++) {
      const q=(i+a)*this.sx+(j+b)*this.sy+k;
      out+=wx[a]*wy[b]*(wz[0]*g[q]+wz[1]*g[q+1]+wz[2]*g[q+2]);
    }return out;
  }
  gradient(g,c,x,y,z,out=this._gradient) {
    if(this.config.transfer!=='quadratic-apic-flip')return super.gradient(g,c,x,y,z,out);
    const h=this.h,fx=x/h-(c===0?0:.5),fy=y/h-(c===1?0:.5),fz=z/h-(c===2?0:.5);
    const i=clamp(Math.floor(fx-.5),0,this.nx-2),j=clamp(Math.floor(fy-.5),0,this.ny-2),k=clamp(Math.floor(fz-.5),0,this.nz-2);
    const dx=fx-i,dy=fy-j,dz=fz-k;
    const wx=[.5*(1.5-dx)**2,.75-(dx-1)**2,.5*(dx-.5)**2],wy=[.5*(1.5-dy)**2,.75-(dy-1)**2,.5*(dy-.5)**2],wz=[.5*(1.5-dz)**2,.75-(dz-1)**2,.5*(dz-.5)**2];
    let a0=0,a1=0,a2=0;
    for(let a=0;a<3;a++)for(let b=0;b<3;b++)for(let d=0;d<3;d++) {
      const q=(i+a)*this.sx+(j+b)*this.sy+k+d,s=wx[a]*wy[b]*wz[d]*g[q];
      a0+=s*(a-dx);a1+=s*(b-dy);a2+=s*(d-dz);
    }out[0]=4*a0/h;out[1]=4*a1/h;out[2]=4*a2/h;return out;
  }
  diffuse(dt) {
    if(!(this.nu>0))return;
    if(this.config.viscosityModel==='component-diffusion')return super.diffuse(dt);
    const system=new SymmetricStressSystem(this,dt);this.lastViscosity=system.solve();
    if(!this.lastViscosity.converged)throw Error('Symmetric-stress viscosity failed: '+JSON.stringify(this.lastViscosity));
  }
  project(dt,iterations=this.iterations) {
    if(this.config.pressureMethod==='icpcg')return super.project(dt,iterations);
    const before=this.divergence(),{sx,sy,kind:k,active:ids}=this,[u,v,w]=this.u;
    const offsets=[-sx,sx,-sy,sy,-1,1],cap=dt*this.surfaceTension/(this.rho*this.h);
    this.diag.fill(0);this.rhs.fill(0);let b2=0;
    for(let a=0;a<this.nActive;a++) {
      const q=ids[a];let diag=0,b=-(u[q+sx]-u[q]+v[q+sy]-v[q]+w[q+1]-w[q]);
      for(const off of offsets) {
        const nb=q+off;if(k[nb]===2)continue;
        const coefficient=k[nb]===1?1:this.interfaceWeight(q,nb);diag+=coefficient;
        if(k[nb]===0)b+=coefficient*cap*this.curvature[q];
      }
      this.diag[q]=Math.max(diag,1e-12);this.rhs[q]=b;b2+=b*b;
    }
    // Handle disconnected enclosed liquid components explicitly. A gauge is
    // added only to a component without a free-surface Dirichlet boundary.
    const seen=new Uint8Array(this.len),queue=new Int32Array(this.nActive);let gauges=0,closedFlux=0;
    for(let a=0;a<this.nActive;a++) {
      const seed=ids[a];if(seen[seed])continue;
      let head=0,tail=1,hasAir=false,sum=0;queue[0]=seed;seen[seed]=1;
      while(head<tail) {
        const q=queue[head++];sum+=this.rhs[q];
        for(const o of offsets){const nb=q+o;if(k[nb]===0)hasAir=true;else if(k[nb]===1&&!seen[nb]){seen[nb]=1;queue[tail++]=nb;}}
      }
      if(!hasAir){this.diag[seed]+=1;gauges++;closedFlux=Math.max(closedFlux,Math.abs(sum));}
    }
    const matrix=CSRMatrix.fromMAC(this),n=this.nActive,b=new Float64Array(n),x=new Float64Array(n);
    for(let a=0;a<n;a++){const q=ids[a];b[a]=this.rhs[q];x[a]=this.pressure[q]*dt/(this.rho*this.h);}
    const temp=new Float64Array(n);matrix.apply(x,temp);let warmError2=0;
    for(let a=0;a<n;a++)warmError2+=(b[a]-temp[a])**2;
    const warmStarted=this.config.warmStart!==false&&warmError2<b2;
    if(!warmStarted)x.fill(0);
    const mg=new GalerkinMultigrid(matrix);
    const report=pcg(matrix,b,x,(r,z)=>mg.apply(r,z),{relativeTolerance:this.config.pressureTolerance??1e-5,maxIterations:iterations});
    this.lastPressure={method:'Galerkin aggregation MG-PCG / reliable residual',...report,levels:mg.sizes,warmStarted,gauges,closedComponentFluxError:closedFlux};
    this.pressureSolveCount++;this.totalPressureIterations+=report.iterations;
    if(!report.converged){this.pressureFailures++;throw Error('Pressure solve did not converge: '+JSON.stringify(this.lastPressure));}
    this.solution.fill(0);this.pressure.fill(0);
    for(let a=0;a<n;a++){const q=ids[a];this.solution[q]=x[a];this.pressure[q]=x[a]*this.rho*this.h/dt;}
    const p=this.solution;
    for(let i=1;i<this.nx;i++)for(let j=1;j<this.ny;j++)for(let kk=1;kk<this.nz;kk++) {
      const q=this.index(i,j,kk);
      for(let c=0;c<3;c++) {
        const off=[sx,sy,1][c],left=q-off,right=q;
        if(k[left]===2||k[right]===2||(k[left]!==1&&k[right]!==1))continue;
        let delta;
        if(k[left]===1&&k[right]===1)delta=p[right]-p[left];
        else if(k[left]===1)delta=(cap*this.curvature[left]-p[left])*this.interfaceWeight(left,right);
        else delta=(p[right]-cap*this.curvature[right])*this.interfaceWeight(right,left);
        this.u[c][q]-=delta;
      }
    }
    this.enforceBoundary();const after=this.divergence();
    this.maxProjectionIterations=Math.max(this.maxProjectionIterations,report.iterations);
    if(this.dynamic)this.integratePressureForces();
    return {before,after,...this.lastPressure};
  }
  updateObstacles(time) {
    if(!this.dynamic)return super.updateObstacles(time);
    const dt=time-this.time;
    for(let n=0;n<this.obstacles.length;n++) {
      const o=this.obstacles[n];
      if(o.dynamic) {
        o.previousCenter=o.center.slice();
        for(let c=0;c<3;c++) {
          o.velocity[c]+=dt*(this.gravity[c]+o.force[c]/o.mass)+o.impulsePending[c]/o.mass;
          o.impulsePending[c]=0;o.center[c]+=dt*o.velocity[c];
          const r=o.kind==='sphere'?o.radius:o.half[c],lo=this.h+r,hi=this.extent[c]-this.h-r;
          if(o.center[c]<lo){o.center[c]=lo;o.velocity[c]=Math.max(0,o.velocity[c]);}
          if(o.center[c]>hi){o.center[c]=hi;o.velocity[c]=Math.min(0,o.velocity[c]);}
        }
      }else if(o.motion) {
        const m=o.motion,a=m.axis??0,omega=2*Math.PI*m.frequency,t=omega*time+(m.phase??0);
        o.center[a]=this.motionBase[n][a]+m.amplitude*Math.sin(t);o.velocity=[0,0,0];o.velocity[a]=m.amplitude*omega*Math.cos(t);
      }
    }
    this.markSolids();
  }
  solidVelocity(x,y,z,c) {
    for(const o of this.obstacles)if(o.dynamic||o.motion) {
      const near=o.kind==='sphere'?Math.hypot(x-o.center[0],y-o.center[1],z-o.center[2])<o.radius+this.h:
        Math.abs(x-o.center[0])<o.half[0]+this.h&&Math.abs(y-o.center[1])<o.half[1]+this.h&&Math.abs(z-o.center[2])<o.half[2]+this.h;
      if(near)return o.velocity?.[c]??0;
    }return 0;
  }
  integratePressureForces() {
    for(const o of this.obstacles)if(o.dynamic){o.force=[0,0,0];o.torque=[0,0,0];}
    const h=this.h,offs=[-this.sx,this.sx,-this.sy,this.sy,-1,1];
    for(let a=0;a<this.nActive;a++) {
      const q=this.active[a],i=Math.floor(q/this.sx),r=q-i*this.sx,j=Math.floor(r/this.sy),k=r-j*this.sy;
      for(let face=0;face<6;face++) {
        const nb=q+offs[face];if(this.kind[nb]!==2)continue;
        const c=face>>1,sign=face%2?1:-1,pos=[(i+.5)*h,(j+.5)*h,(k+.5)*h];pos[c]+=sign*h;
        for(const o of this.obstacles)if(o.dynamic) {
          const inside=o.kind==='sphere'?Math.hypot(...pos.map((v,d)=>v-o.center[d]))<=o.radius:
            pos.every((v,d)=>Math.abs(v-o.center[d])<=o.half[d]);
          if(!inside)continue;
          const force=sign*this.pressure[q]*h*h;o.force[c]+=force;
          // Spheres do not receive torque from ideal normal pressure. Boxes
          // record voxel pressure torque, but only translation is integrated.
          if(o.kind!=='sphere') {
            pos[c]-=sign*.5*h;const r=pos.map((v,d)=>v-o.center[d]),f=[0,0,0];f[c]=force;
            o.torque[0]+=r[1]*f[2]-r[2]*f[1];o.torque[1]+=r[2]*f[0]-r[0]*f[2];o.torque[2]+=r[0]*f[1]-r[1]*f[0];
          }
          break;
        }
      }
    }
  }
  collide(n) {
    if(!this.dynamic)return super.collide(n);
    const q=n*3,margin=this.h*.16,p=this.p,v=this.v;
    for(let c=0;c<3;c++) {
      const lo=this.h+margin,hi=this.extent[c]-this.h-margin;
      if(p[q+c]<lo){p[q+c]=lo;v[q+c]=Math.max(0,v[q+c]);}
      if(p[q+c]>hi){p[q+c]=hi;v[q+c]=Math.min(0,v[q+c]);}
    }
    for(const o of this.obstacles) {
      if(o.kind!=='sphere')continue;
      const dx=p[q]-o.center[0],dy=p[q+1]-o.center[1],dz=p[q+2]-o.center[2],dist=Math.hypot(dx,dy,dz),radius=o.radius+margin;
      if(dist>=radius)continue;
      const normal=dist>1e-9?[dx/dist,dy/dist,dz/dist]:[0,1,0],wall=o.velocity??[0,0,0];
      for(let c=0;c<3;c++)p[q+c]=o.center[c]+radius*normal[c];
      const vn=normal.reduce((s,a,c)=>s+a*(v[q+c]-wall[c]),0);
      if(vn<0) {
        const mass=this.rho*(this.h*.5)**3,impulse=-vn/(1/mass+(o.dynamic?1/o.mass:0));
        for(let c=0;c<3;c++){v[q+c]+=impulse*normal[c]/mass;if(o.dynamic)o.impulsePending[c]-=impulse*normal[c];}
      }
    }
  }
  transportShapes(dt) {
    this.initializeShapes();const shape=this.shape,A=this.affine;
    const B=new Float64Array(9),C=new Float64Array(9),tmp=new Float64Array(9),next=new Float64Array(9);
    for(let n=0;n<this.count;n++) {
      const q=n*6,a=n*9;
      for(let i=0;i<3;i++)for(let j=0;j<3;j++) {
        let square=0;for(let k=0;k<3;k++)square+=A[a+i*3+k]*A[a+k*3+j];
        B[i*3+j]=(i===j?1:0)+dt*A[a+i*3+j]+.5*dt*dt*square;
      }
      C[0]=shape[q];C[4]=shape[q+1];C[8]=shape[q+2];C[1]=C[3]=shape[q+3];C[2]=C[6]=shape[q+4];C[5]=C[7]=shape[q+5];
      for(let i=0;i<3;i++)for(let j=0;j<3;j++) {
        let value=0;for(let k=0;k<3;k++)value+=B[i*3+k]*C[k*3+j];tmp[i*3+j]=value;
      }
      for(let i=0;i<3;i++)for(let j=0;j<3;j++) {
        let value=0;for(let k=0;k<3;k++)value+=tmp[i*3+k]*B[j*3+k];next[i*3+j]=value;
      }
      // Isotropic relaxation bounds condition growth; it does not displace
      // primary particles. Normalize determinant to separate shape from volume.
      const trace=(next[0]+next[4]+next[8])/3,relax=1-Math.exp(-dt*1.5);
      for(let k=0;k<9;k++)next[k]*=1-relax;
      next[0]+=relax*trace;next[4]+=relax*trace;next[8]+=relax*trace;
      const determinant=detSym(next[0],next[4],next[8],next[1],next[2],next[5]);
      if(!(determinant>1e-20&&Number.isFinite(determinant))){shape[q]=shape[q+1]=shape[q+2]=1;shape[q+3]=shape[q+4]=shape[q+5]=0;this.shapeResets++;continue;}
      const factor=Math.pow(determinant,-1/3);
      shape[q]=next[0]*factor;shape[q+1]=next[4]*factor;shape[q+2]=next[8]*factor;
      shape[q+3]=next[1]*factor;shape[q+4]=next[2]*factor;shape[q+5]=next[5]*factor;
    }
  }
  step(dt) {
    this.previousPosition.set(this.p.subarray(0,this.count*3));
    const m=super.step(dt);
    if(this.config.shapeTransport!==false)this.transportShapes(dt);
    m.transfer=this.config.transfer??'quadratic-apic-flip';m.shapeResets=this.shapeResets;
    m.rigidCoupling=this.dynamic?'explicit pressure plus equal/opposite collision impulses; translation only':null;
    return m;
  }
  maxSpeed() {
    let max=super.maxSpeed();
    for(const o of this.obstacles)if(o.velocity)max=Math.max(max,Math.hypot(...o.velocity));return max;
  }
  inspect(substeps=0) {
    const m=super.inspect(substeps);
    m.pressureFailures=this.pressureFailures??0;m.pressureSolves=this.pressureSolveCount??0;
    m.pressureIterationsTotal=this.totalPressureIterations??0;
    m.sourceVolumeBalance=m.particleVolume-(m.initialParticles+m.spawned-m.deleted)*(this.h*.5)**3;
    m.massAccounting='nominal primary-particle volumes; not a local incompressibility proof';
    return m;
  }
}
