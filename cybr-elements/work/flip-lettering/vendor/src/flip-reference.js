/** CYBR FLIP II — convergence-controlled single-phase liquid solver.
 * All dimensional quantities use SI. The dense MAC storage is intentional and
 * is NOT described as a sparse GPU solver. Particle volume is (h/2)^3.
 * This module is used unchanged by Node.js and the interactive browser worker.
 */
import {FlipSolver as BaseFlipSolver, PRESETS as ORIGINAL_PRESETS} from './flip-base.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const PRESETS={...structuredClone(ORIGINAL_PRESETS),
 vortex:{name:'VORTEX / angular flow',subtitle:'Resolved vortex · free surface · circulation',extent:[4.8,3.2,3.2],h:.08,flip:.90,iterations:140,obstacles:[],seed:4112},
 paddle:{name:'DISPLACEMENT / moving solid',subtitle:'Moving collider · relative wall velocity · wake',extent:[4.8,3.2,3.2],h:.08,flip:.90,iterations:140,obstacles:[{kind:'sphere',center:[2.4,.90,1.6],radius:.48,motion:{axis:0,amplitude:1.15,frequency:.55,phase:0}}],seed:9897},
 capillary:{name:'CAPILLARY / oscillating drop',subtitle:'Zero gravity · surface tension · inertial oscillation',extent:[.16,.12,.12],h:.004,flip:.75,iterations:160,gravity:[0,0,0],surfaceTension:.072,obstacles:[],seed:1281},
 viscous:{name:'VISCOSITY / pouring liquid',subtitle:'Implicit diffusion · thick stream · solid contact',extent:[1.6,1.2,1.2],h:.032,flip:.30,iterations:140,kinematicViscosity:.045,surfaceTension:.072,obstacles:[],seed:2816}
};
export function makePreset(name,quality='high'){
 if(!PRESETS[name])throw Error(`Unknown scene ${name}`);
 const c=structuredClone(PRESETS[name]);c.nameKey=name;
 c.transfer='apic-flip';c.flip=PRESETS[name].flip===.97?.93:PRESETS[name].flip;
 c.surfaceTension=c.surfaceTension??.072;c.density=1000;c.pressureTolerance=2e-5;c.iterations=160;
 c.ghostFluid=true;c.extrapolationLayers=2;c.affine=true;c.advection='rk2';c.maxParticles=800000;
 if(quality==='live'){c.h*=1.50;c.iterations=90;c.pressureTolerance=8e-5;}
 if(quality==='test'){c.h*=2.5;c.iterations=120;}
 if(quality==='ultra'){c.h*=.75;}
 c.nx=Math.round(c.extent[0]/c.h);c.ny=Math.round(c.extent[1]/c.h);c.nz=Math.round(c.extent[2]/c.h);
 c.extent=[c.nx*c.h,c.ny*c.h,c.nz*c.h];c.quality=quality;
 return c;
}
export class FlipSolver extends BaseFlipSolver{
 constructor(config){
  // The base owns mutable collider state; do not mutate the caller's start settings.
  super(structuredClone(config));
  this.affine=new Float32Array(this.maxParticles*9);
  this.phi=new Float32Array(this.len);this.curvature=new Float32Array(this.len);
  this.diag=new Float64Array(this.len);this.rhs=new Float64Array(this.len);
  this.r=new Float64Array(this.len);this.z=new Float64Array(this.len);this.search=new Float64Array(this.len);
  this.product=new Float64Array(this.len);this.ic=new Float64Array(this.len);this.work=new Float64Array(this.len);
  this.solution=new Float64Array(this.len);this.rho=config.density??1000;
  this.surfaceTension=config.surfaceTension??0;this.nu=config.kinematicViscosity??0;
  this._gradient=new Float64Array(3);this.currentParticle=-1;
  this.motionBase=this.obstacles.map(o=>o.center.slice());this.moving=this.obstacles.some(o=>o.motion);
  this.diagnostics={pressure:[],viscosity:[]};this.maxProjectionIterations=0;
 }
 initialize(){
  super.initialize();const key=this.config.nameKey;
  if(key==='vortex'){
   this.seedVolume((x,y,z)=>y<1.02);
   for(let n=0;n<this.count;n++){const q=n*3,dx=this.p[q]-2.4,dz=this.p[q+2]-1.6,r=Math.hypot(dx,dz),a=3.3*Math.exp(-r*r/.95);
    this.v[q]=a*dz;this.v[q+2]=-a*dx;}
  }else if(key==='paddle')this.seedVolume((x,y,z)=>y<1.03);
  else if(key==='capillary')this.seedVolume((x,y,z)=>((x-.08)/.029)**2+((y-.062)/.018)**2+((z-.06)/.023)**2<1);
  else if(key==='viscous')this.seedVolume((x,y,z)=>y<.09&&Math.hypot(x-.80,z-.60)<.28);
 }
 emit(dt){
  if(this.config.nameKey!=='viscous'){super.emit(dt);return;}
  const r=.067,speed=.72,s=this.h*.5;
  this.emitCarry+=Math.PI*r*r*speed*dt/(s*s*s);
  const n=Math.floor(this.emitCarry);this.emitCarry-=n;
  for(let a=0;a<n;a++){
   const theta=this.random()*2*Math.PI,rad=r*Math.sqrt(this.random());
   const x=.8+Math.cos(theta)*rad+.06*Math.sin(this.time*2),z=.6+Math.sin(theta)*rad;
   if(this.add(x,1.035-this.random()*speed*dt,z,.12*Math.cos(this.time*2),-speed,0))this.spawned++;
  }
 }
 updateObstacles(time){
  if(!this.moving)return;
  for(let n=0;n<this.obstacles.length;n++){
   const o=this.obstacles[n];o.velocity=[0,0,0];if(!o.motion)continue;
   const m=o.motion,a=m.axis??0,w=2*Math.PI*m.frequency,t=w*time+(m.phase??0);
   o.center[a]=this.motionBase[n][a]+m.amplitude*Math.sin(t);o.velocity[a]=m.amplitude*w*Math.cos(t);
  }this.markSolids();
 }
 solidVelocity(x,y,z,c){
  for(const o of this.obstacles){if(!o.motion)continue;
   const near=o.kind==='sphere'?Math.hypot(x-o.center[0],y-o.center[1],z-o.center[2])<o.radius+this.h:
    Math.abs(x-o.center[0])<o.half[0]+this.h&&Math.abs(y-o.center[1])<o.half[1]+this.h&&Math.abs(z-o.center[2])<o.half[2]+this.h;
   if(near)return o.velocity?.[c]??0;
  }return 0;
 }
 enforceBoundary(){
  if(!this.moving){super.enforceBoundary();return;}
  const sx=this.sx,sy=this.sy,s=this.solid,h=this.h;
  for(let i=1;i<this.nx;i++)for(let j=1;j<this.ny;j++)for(let k=1;k<this.nz;k++){
   const q=i*sx+j*sy+k;
   for(let c=0;c<3;c++){const off=c===0?sx:c===1?sy:1;
    if(s[q]||s[q-off]){this.u[c][q]=this.solidVelocity((i+(c===0?0:.5))*h,(j+(c===1?0:.5))*h,(k+(c===2?0:.5))*h,c);this.valid[c][q]=1;}
   }
  }
 }
 splat(c,x,y,z,value){
  if(!this.affine||this.config.affine===false){super.splat(c,x,y,z,value);return;}
  const h=this.h,sx=this.sx,sy=this.sy;
  let fx=x/h-(c===0?0:.5),fy=y/h-(c===1?0:.5),fz=z/h-(c===2?0:.5);
  const i=clamp(Math.floor(fx),0,this.nx-1),j=clamp(Math.floor(fy),0,this.ny-1),k=clamp(Math.floor(fz),0,this.nz-1);
  fx=clamp(fx-i,0,1);fy=clamp(fy-j,0,1);fz=clamp(fz-k,0,1);
  const g=this.u[c],w=this.weights[c],a=this.currentParticle*9+c*3,A=this.affine;
  const cx=A[a]||0,cy=A[a+1]||0,cz=A[a+2]||0;
  for(let di=0;di<2;di++)for(let dj=0;dj<2;dj++)for(let dk=0;dk<2;dk++){
   const q=(i+di)*sx+(j+dj)*sy+k+dk,t=(di?fx:1-fx)*(dj?fy:1-fy)*(dk?fz:1-fz);
   g[q]+=t*(value+h*(cx*(di-fx)+cy*(dj-fy)+cz*(dk-fz)));w[q]+=t;
  }
 }
 transferToGrid(){
  const kind=this.kind;for(let q=0;q<this.len;q++)kind[q]=this.solid[q]?2:0;
  for(let c=0;c<3;c++){this.u[c].fill(0);this.weights[c].fill(0);this.valid[c].fill(0);}
  for(let n=0;n<this.count;n++){
   const q=n*3,x=this.p[q],y=this.p[q+1],z=this.p[q+2],id=this.index(Math.floor(x/this.h),Math.floor(y/this.h),Math.floor(z/this.h));
   if(!this.solid[id])kind[id]=1;this.currentParticle=n;
   this.splat(0,x,y,z,this.v[q]);this.splat(1,x,y,z,this.v[q+1]);this.splat(2,x,y,z,this.v[q+2]);
  }
  this.nActive=0;
  for(let q=0;q<this.len;q++){
   if(kind[q]===1)this.active[this.nActive++]=q;
   for(let c=0;c<3;c++)if(this.weights[c][q]>1e-8){this.u[c][q]/=this.weights[c][q];this.valid[c][q]=1;}
  }
  this.enforceBoundary();
  // Both snapshots receive the SAME extension procedure. Extending only the
  // new grid changes FLIP increments on partially populated surface stencils.
  this.extendVelocities();for(let c=0;c<3;c++)this.old[c].set(this.u[c]);
 }
 gradient(g,c,x,y,z,out=this._gradient){
  let fx=x/this.h-(c===0?0:.5),fy=y/this.h-(c===1?0:.5),fz=z/this.h-(c===2?0:.5);
  const i=clamp(Math.floor(fx),0,this.nx-1),j=clamp(Math.floor(fy),0,this.ny-1),k=clamp(Math.floor(fz),0,this.nz-1);
  fx=clamp(fx-i,0,1);fy=clamp(fy-j,0,1);fz=clamp(fz-k,0,1);
  const q=this.index(i,j,k),sx=this.sx,sy=this.sy,ix=1-fx,iy=1-fy,iz=1-fz;
  out[0]=(iy*(iz*(g[q+sx]-g[q])+fz*(g[q+sx+1]-g[q+1]))+fy*(iz*(g[q+sx+sy]-g[q+sy])+fz*(g[q+sx+sy+1]-g[q+sy+1])))/this.h;
  out[1]=(ix*(iz*(g[q+sy]-g[q])+fz*(g[q+sy+1]-g[q+1]))+fx*(iz*(g[q+sx+sy]-g[q+sx])+fz*(g[q+sx+sy+1]-g[q+sx+1])))/this.h;
  out[2]=(ix*(iy*(g[q+1]-g[q])+fy*(g[q+sy+1]-g[q+sy]))+fx*(iy*(g[q+sx+1]-g[q+sx])+fy*(g[q+sx+sy+1]-g[q+sx+sy])))/this.h;
  return out;
 }
 buildLevelSet(){
  const h=this.h,sx=this.sx,sy=this.sy,phi=this.phi;phi.fill(h*3);const r=h*.80;
  // Particle-sphere union is used for subcell pressure-interface fractions.
  // This is a pressure SDF estimate, separate from anisotropic render meshing.
  for(let n=0;n<this.count;n++){
   const q=n*3,x=this.p[q],y=this.p[q+1],z=this.p[q+2],i=Math.floor(x/h),j=Math.floor(y/h),k=Math.floor(z/h);
   for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++){
    const id=(i+a)*sx+(j+b)*sy+k+c;
    const d=Math.hypot((i+a+.5)*h-x,(j+b+.5)*h-y,(k+c+.5)*h-z)-r;
    if(d<phi[id])phi[id]=d;
   }
  }
  for(let q=0;q<this.len;q++)phi[q]=this.kind[q]===1?Math.min(-.04*h,phi[q]):Math.max(.04*h,phi[q]);
  this.curvature.fill(0);if(!this.surfaceTension)return;
  // Smooth the narrow-band level-set estimate before its second derivatives.
  const f=this.tmp;f.set(phi);
  for(let pass=0;pass<2;pass++){
   this.work.set(f);
   for(let i=1;i<this.nx;i++)for(let j=1;j<this.ny;j++)for(let k=1;k<this.nz;k++){
    const q=this.index(i,j,k);f[q]=.4*this.work[q]+.1*(this.work[q-sx]+this.work[q+sx]+this.work[q-sy]+this.work[q+sy]+this.work[q-1]+this.work[q+1]);
   }
  }
  const hh=h*h;
  for(let a=0;a<this.nActive;a++){
   const q=this.active[a],x=(f[q+sx]-f[q-sx])/(2*h),y=(f[q+sy]-f[q-sy])/(2*h),z=(f[q+1]-f[q-1])/(2*h),g2=x*x+y*y+z*z;
   if(g2<1e-8)continue;
   const xx=(f[q+sx]-2*f[q]+f[q-sx])/hh,yy=(f[q+sy]-2*f[q]+f[q-sy])/hh,zz=(f[q+1]-2*f[q]+f[q-1])/hh;
   const xy=(f[q+sx+sy]-f[q+sx-sy]-f[q-sx+sy]+f[q-sx-sy])/(4*hh);
   const xz=(f[q+sx+1]-f[q+sx-1]-f[q-sx+1]+f[q-sx-1])/(4*hh);
   const yz=(f[q+sy+1]-f[q+sy-1]-f[q-sy+1]+f[q-sy-1])/(4*hh);
   this.curvature[q]=clamp(((y*y+z*z)*xx+(x*x+z*z)*yy+(x*x+y*y)*zz-2*(x*y*xy+x*z*xz+y*z*yz))/Math.pow(g2,1.5),-1.5/h,1.5/h);
  }
 }
 interfaceWeight(fluid,air){
  if(this.config.ghostFluid===false)return 1;
  const d=this.phi[fluid]-this.phi[air];return Math.abs(d)>1e-12?1/clamp(this.phi[fluid]/d,.08,1):1;
 }
 applyMatrix(x,out){
  const sx=this.sx,sy=this.sy,kind=this.kind;
  for(let a=0;a<this.nActive;a++){
   const q=this.active[a];let v=this.diag[q]*x[q];
   if(kind[q-sx]===1)v-=x[q-sx];if(kind[q+sx]===1)v-=x[q+sx];
   if(kind[q-sy]===1)v-=x[q-sy];if(kind[q+sy]===1)v-=x[q+sy];
   if(kind[q-1]===1)v-=x[q-1];if(kind[q+1]===1)v-=x[q+1];out[q]=v;
  }
 }
 buildPreconditioner(){
  const sx=this.sx,sy=this.sy,k=this.kind,ic=this.ic;ic.fill(0);
  for(let a=0;a<this.nActive;a++){
   const q=this.active[a];let d=this.diag[q];
   if(k[q-sx]===1)d-=ic[q-sx]**2;if(k[q-sy]===1)d-=ic[q-sy]**2;if(k[q-1]===1)d-=ic[q-1]**2;
   ic[q]=1/Math.sqrt(Math.max(d,.25*this.diag[q],1e-12));
  }
 }
 precondition(r,z){
  const k=this.kind,sx=this.sx,sy=this.sy,ic=this.ic,y=this.work;
  for(let a=0;a<this.nActive;a++){
   const q=this.active[a];let v=r[q];
   if(k[q-sx]===1)v+=ic[q-sx]*y[q-sx];if(k[q-sy]===1)v+=ic[q-sy]*y[q-sy];if(k[q-1]===1)v+=ic[q-1]*y[q-1];y[q]=v*ic[q];
  }
  for(let a=this.nActive-1;a>=0;a--){
   const q=this.active[a];let v=0;
   if(k[q+sx]===1)v+=z[q+sx];if(k[q+sy]===1)v+=z[q+sy];if(k[q+1]===1)v+=z[q+1];z[q]=(y[q]+v*ic[q])*ic[q];
  }
 }
 project(dt,iterations=this.iterations){
  if(!this.phi)return super.project(dt,iterations);
  const before=this.divergence(),sx=this.sx,sy=this.sy,k=this.kind,[u,v,w]=this.u;
  const x=this.solution,r=this.r,z=this.z,d=this.search,Ad=this.product,ids=this.active;
  const offsets=[-sx,sx,-sy,sy,-1,1],cap=dt*this.surfaceTension/(this.rho*this.h);
  this.diag.fill(0);this.rhs.fill(0);x.fill(0);let b2=0;
  for(let a=0;a<this.nActive;a++){
   const q=ids[a];let diag=0,b=-(u[q+sx]-u[q]+v[q+sy]-v[q]+w[q+1]-w[q]);
   for(const off of offsets){const nb=q+off;if(k[nb]===2)continue;
    const coeff=k[nb]===1?1:this.interfaceWeight(q,nb);diag+=coeff;
    if(k[nb]===0)b+=coeff*cap*this.curvature[q];
   }
   this.diag[q]=Math.max(diag,1e-12);this.rhs[q]=b;r[q]=b;b2+=b*b;
  }
  this.buildPreconditioner();this.precondition(r,z);
  let rz=0;for(let a=0;a<this.nActive;a++){const q=ids[a];d[q]=z[q];rz+=r[q]*z[q];}
  const initial=Math.sqrt(b2),tol=Math.max(1e-10,(this.config.pressureTolerance??2e-5)*initial);
  let error=initial,it=0;
  for(;it<iterations&&error>tol;it++){
   this.applyMatrix(d,Ad);let dAd=0;for(let a=0;a<this.nActive;a++){const q=ids[a];dAd+=d[q]*Ad[q];}
   if(!(dAd>1e-30))break;
   const alpha=rz/dAd;let r2=0;
   for(let a=0;a<this.nActive;a++){const q=ids[a];x[q]+=alpha*d[q];r[q]-=alpha*Ad[q];r2+=r[q]*r[q];}
   error=Math.sqrt(r2);if(error<=tol){it++;break;}
   this.precondition(r,z);let rzNew=0;for(let a=0;a<this.nActive;a++){const q=ids[a];rzNew+=r[q]*z[q];}
   const beta=rzNew/Math.max(rz,1e-300);rz=rzNew;
   for(let a=0;a<this.nActive;a++){const q=ids[a];d[q]=z[q]+beta*d[q];}
  }
  // Exactly one pressure-gradient update per staggered face.
  for(let i=1;i<this.nx;i++)for(let j=1;j<this.ny;j++)for(let kk=1;kk<this.nz;kk++){
   const q=this.index(i,j,kk);
   for(let c=0;c<3;c++){
    const off=c===0?sx:c===1?sy:1,left=q-off,right=q;
    if(k[left]===2||k[right]===2||k[left]!==1&&k[right]!==1)continue;
    let delta;
    if(k[left]===1&&k[right]===1)delta=x[right]-x[left];
    else if(k[left]===1)delta=(cap*this.curvature[left]-x[left])*this.interfaceWeight(left,right);
    else delta=(x[right]-cap*this.curvature[right])*this.interfaceWeight(right,left);
    this.u[c][q]-=delta;
   }
  }
  for(let a=0;a<this.nActive;a++){const q=ids[a];this.pressure[q]=x[q]*this.rho*this.h/dt;}
  this.enforceBoundary();const after=this.divergence();
  this.maxProjectionIterations=Math.max(this.maxProjectionIterations,it);
  this.lastPressure={method:'IC(0)-PCG / ghost fluid',iterations:it,initialResidual:initial,residual:error,relativeResidual:initial>0?error/initial:0,converged:error<=tol,tolerance:tol};
  return {before,after,...this.lastPressure};
 }
 diffuse(dt){
  if(!(this.nu>0))return;
  // Backward-Euler component diffusion. Natural zero-normal-gradient at air,
  // Dirichlet no-slip at solids. This is NOT a coupled free-surface stress solve.
  const alpha=this.nu*dt/(this.h*this.h),offs=[-this.sx,this.sx,-this.sy,this.sy,-1,1];
  let maxError=0,maxIts=0;
  for(let c=0;c<3;c++){
   const g=this.u[c],off=c===0?this.sx:c===1?this.sy:1,valid=this.valid[c];valid.fill(0);let num=0;
   for(let i=1;i<this.nx;i++)for(let j=1;j<this.ny;j++)for(let k=1;k<this.nz;k++){
    const q=this.index(i,j,k);if(this.solid[q]||this.solid[q-off])valid[q]=2;
    else if(this.kind[q]===1||this.kind[q-off]===1){valid[q]=1;this.rhs[q]=g[q];num++;}
   }
   let error=0,it=0;
   for(;it<96;it++){
    error=0;
    for(let i=1;i<this.nx;i++)for(let j=1;j<this.ny;j++)for(let k=1;k<this.nz;k++){
     const q=this.index(i,j,k);if(valid[q]!==1)continue;let sum=0,n=0;
     for(const o of offs)if(valid[q+o]){sum+=g[q+o];n++;}
     const value=(this.rhs[q]+alpha*sum)/(1+alpha*n);error=Math.max(error,Math.abs(value-g[q]));g[q]=value;
    }
    if(error<1e-5)break;
   }maxError=Math.max(maxError,error);maxIts=Math.max(maxIts,it+1);
  }
  this.lastViscosity={nu:this.nu,iterations:maxIts,maximumUpdate:maxError};
 }
 applyForces(dt){
  const gravity=this.gravity;
  for(let c=0;c<3;c++)for(let q=0;q<this.len;q++)if(this.valid[c][q])this.u[c][q]+=gravity[c]*dt;
  if(this.config.nameKey==='vortex'){
   for(let i=1;i<this.nx;i++)for(let j=1;j<this.ny;j++)for(let k=1;k<this.nz;k++){
    const q=this.index(i,j,k),x=(i+.5)*this.h-2.4,z=(k+.5)*this.h-1.6,r2=x*x+z*z,falloff=Math.exp(-r2/1.2);
    if(this.kind[q]===1){this.u[0][q]+=dt*1.3*falloff*z;this.u[2][q]-=dt*1.3*falloff*x;}
   }
  }
 }
 collide(n){
  if(!this.moving){super.collide(n);return;}
  const q=n*3,p=this.p,v=this.v,margin=this.h*.16;
  for(let c=0;c<3;c++){
   const lo=this.h+margin,hi=this.extent[c]-this.h-margin;
   if(p[q+c]<lo){p[q+c]=lo;v[q+c]=Math.max(0,v[q+c]);}
   if(p[q+c]>hi){p[q+c]=hi;v[q+c]=Math.min(0,v[q+c]);}
  }
  for(const o of this.obstacles){
   let normal=null;
   if(o.kind==='sphere'){
    const dx=p[q]-o.center[0],dy=p[q+1]-o.center[1],dz=p[q+2]-o.center[2],d=Math.hypot(dx,dy,dz),r=o.radius+margin;
    if(d<r){normal=d>1e-9?[dx/d,dy/d,dz/d]:[0,1,0];for(let c=0;c<3;c++)p[q+c]=o.center[c]+r*normal[c];}
   }else if(o.kind==='box'){
    const d=[p[q]-o.center[0],p[q+1]-o.center[1],p[q+2]-o.center[2]],depth=d.map((v,c)=>o.half[c]+margin-Math.abs(v));
    if(depth.every(x=>x>0)){const c=depth.indexOf(Math.min(...depth));normal=[0,0,0];normal[c]=d[c]<0?-1:1;p[q+c]=o.center[c]+normal[c]*(o.half[c]+margin);}
   }
   if(normal){const wall=o.velocity??[0,0,0],vn=normal.reduce((s,a,c)=>s+a*(v[q+c]-wall[c]),0);if(vn<0)for(let c=0;c<3;c++)v[q+c]-=vn*normal[c];}
  }
 }
 step(dt){
  if(!(dt>0&&dt<=.05))throw Error('Invalid timestep');
  this.updateObstacles(this.time+dt);for(let n=0;n<this.count;n++)this.collide(n);
  this.emit(dt);this.transferToGrid();this.buildLevelSet();this.applyForces(dt);this.diffuse(dt);this.enforceBoundary();
  const projection=this.project(dt);this.extendVelocities();
  for(let n=0;n<this.count;n++){
   const q=n*3,x=this.p[q],y=this.p[q+1],z=this.p[q+2];
   for(let c=0;c<3;c++){
    const pic=this.sample(this.u[c],c,x,y,z),old=this.sample(this.old[c],c,x,y,z);
    this.v[q+c]=this.flip*(this.v[q+c]+pic-old)+(1-this.flip)*pic;
    const a=this.gradient(this.u[c],c,x,y,z),start=n*9+c*3;
    for(let d=0;d<3;d++)this.affine[start+d]=a[d];
   }
   // Midpoint integration of projected velocity for the advected markers.
   // Particle velocities remain FLIP/APIC state, not finite differences of motion.
   if(this.config.advection==='euler'){
    this.p[q]+=this.v[q]*dt;this.p[q+1]+=this.v[q+1]*dt;this.p[q+2]+=this.v[q+2]*dt;
   }else{
    const mx=x+.5*dt*this.sample(this.u[0],0,x,y,z),my=y+.5*dt*this.sample(this.u[1],1,x,y,z),mz=z+.5*dt*this.sample(this.u[2],2,x,y,z);
    for(let c=0;c<3;c++)this.p[q+c]+=dt*this.sample(this.u[c],c,mx,my,mz);
   }
   this.collide(n);
  }
  if(this.config.separation!==false&&this.steps%2===0)this.separate();
  this.time+=dt;this.steps++;
  this.metrics={divergenceBefore:projection.before.rms,divergenceAfter:projection.after.rms,divergenceMax:projection.after.max,
   projectionRatio:projection.after.rms/Math.max(1e-12,projection.before.rms),activeCells:this.nActive,dt,pressure:this.lastPressure,
   viscosity:this.lastViscosity??null,surfaceTension:this.surfaceTension,transfer:this.config.affine===false?'PIC/FLIP':'affine PIC/FLIP',advection:this.config.advection??'rk2'};
  return this.metrics;
 }
 advance(frameDt=1/48){
  if(!(frameDt>0&&frameDt<=.25))throw Error('Invalid frame duration');
  let remaining=frameDt,substeps=0;
  const capDt=this.surfaceTension>0?.40*Math.sqrt(this.rho*this.h**3/(Math.PI*this.surfaceTension)):Infinity;
  while(remaining>1e-10){
   const speed=this.maxSpeed(),dt=Math.min(remaining,1/90,.48*this.h/Math.max(.1,speed+Math.hypot(...this.gravity)*remaining),capDt);
   this.step(dt);remaining-=dt;if(++substeps>256)throw Error('CFL budget exceeded');
  }
  const m=this.inspect(substeps);m.colliders=structuredClone(this.obstacles);return m;
 }
}
