/* CYBR FLIP LAB -- original 3D staggered-grid PIC/FLIP implementation.
 * Positions and lengths are metres; time is seconds; velocities are m/s.
 * Renderer-independent: the identical module runs in Node and a browser worker.
 * Single-phase free-surface liquid. Air pressure is zero, not an air solver.
 */
export const PRESETS = {
  breach: {name:'BREACH / monolith', subtitle:'Dam release · solid obstacle · returning bore',
    extent:[4.8,3.2,3.2], h:0.08, flip:0.97, iterations:64,
    obstacles:[{kind:'box',center:[2.8,0.67,1.6],half:[0.22,0.67,0.48]}], seed:1701},
  impact: {name:'IMPACT / free surface', subtitle:'Liquid drop · shallow pool · radial splash',
    extent:[4.8,3.2,3.2], h:0.075, flip:0.97, iterations:64, obstacles:[], seed:5309},
  jets: {name:'CONFLUENCE / opposing jets', subtitle:'Continuous emitters · colliding sheets · breakup',
    extent:[4.8,3.2,3.2], h:0.08, flip:0.97, iterations:64, obstacles:[], seed:8107},
  cascade: {name:'CASCADE / spillway', subtitle:'Three elevations · solid boundaries · plunge pool',
    extent:[4.8,3.2,3.2], h:0.08, flip:0.97, iterations:64,
    obstacles:[{kind:'box',center:[0.64,1.02,1.6],half:[0.56,1.02,1.44]},
      {kind:'box',center:[1.49,0.65,1.6],half:[0.29,0.65,1.44]},
      {kind:'box',center:[2.07,0.34,1.6],half:[0.29,0.34,1.44]}],seed:9101},
  slosh: {name:'IMPULSE / basin', subtitle:'Lateral acceleration · wall run-up · reflected wave',
    extent:[4.8,3.2,3.2], h:0.08, flip:0.97, iterations:64, obstacles:[],seed:3503}
};
export function makePreset(name, quality='high') {
  if (!PRESETS[name]) throw new Error(`Unknown scene: ${name}`);
  const c=structuredClone(PRESETS[name]); c.nameKey=name;
  if(quality==='live'){c.h=0.12; c.iterations=32;}
  if(quality==='test'){c.h=0.20; c.iterations=48;}
  c.nx=Math.round(c.extent[0]/c.h);c.ny=Math.round(c.extent[1]/c.h);c.nz=Math.round(c.extent[2]/c.h);
  c.extent=[c.nx*c.h,c.ny*c.h,c.nz*c.h];
  return c;
}
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export class FlipSolver {
  constructor(config) {
    this.config=structuredClone(config); this.h=config.h;
    this.nx=config.nx;this.ny=config.ny;this.nz=config.nz;
    this.sx=(this.ny+1)*(this.nz+1);this.sy=this.nz+1;
    this.len=(this.nx+1)*this.sx;this.extent=[this.nx*this.h,this.ny*this.h,this.nz*this.h];
    this.maxParticles=config.maxParticles??260000;
    this.p=new Float32Array(this.maxParticles*3);this.v=new Float32Array(this.maxParticles*3);
    this.u=[0,1,2].map(()=>new Float32Array(this.len));
    this.old=[0,1,2].map(()=>new Float32Array(this.len));
    this.weights=[0,1,2].map(()=>new Float32Array(this.len));
    this.valid=[0,1,2].map(()=>new Uint8Array(this.len));
    this.tmp=new Float32Array(this.len);this.tmpValid=new Uint8Array(this.len);
    this.kind=new Uint8Array(this.len); this.solid=new Uint8Array(this.len);
    this.pressure=new Float32Array(this.len); this.active=new Int32Array(this.len);this.nActive=0;
    this.head=new Int32Array(this.len);this.next=new Int32Array(this.maxParticles);
    this.count=0;this.time=0;this.steps=0;this.randomState=(config.seed??7)>>>0;
    this.spawned=0;this.deleted=0;this.capacityRejected=0;this.emitCarry=0;
    this.flip=config.flip??.97;this.iterations=config.iterations??60;
    this.gravity=config.gravity??[0,-9.81,0];this.metrics={};
    this.obstacles=config.obstacles??[];
    this.markSolids(); this.initialize(); this.initialCount=this.count; this.initialEmitterParticles=this.spawned; this.spawned=0;
  }
  index(i,j,k){return i*this.sx+j*this.sy+k;}
  random(){let x=this.randomState;x^=x<<13;x^=x>>>17;x^=x<<5;this.randomState=x>>>0;return this.randomState/4294967296;}
  insideSolid(x,y,z,margin=0) {
    const h=this.h;
    if(x<h+margin||y<h+margin||z<h+margin||x>this.extent[0]-h-margin||y>this.extent[1]-h-margin||z>this.extent[2]-h-margin)return true;
    for(const o of this.obstacles){
      if(o.kind==='box'&&Math.abs(x-o.center[0])<o.half[0]+margin&&Math.abs(y-o.center[1])<o.half[1]+margin&&Math.abs(z-o.center[2])<o.half[2]+margin)return true;
      if(o.kind==='sphere'&&Math.hypot(x-o.center[0],y-o.center[1],z-o.center[2])<o.radius+margin)return true;
    } return false;
  }
  markSolids(){
    this.solid.fill(1);const h=this.h;
    for(let i=1;i<this.nx-1;i++)for(let j=1;j<this.ny-1;j++)for(let k=1;k<this.nz-1;k++)
      this.solid[this.index(i,j,k)]=this.insideSolid((i+.5)*h,(j+.5)*h,(k+.5)*h)?1:0;
  }
  add(x,y,z,vx=0,vy=0,vz=0){
    if(this.count>=this.maxParticles){this.capacityRejected++;return false;}
    if(this.insideSolid(x,y,z,this.h*.12))return false;
    const n=3*this.count++;this.p[n]=x;this.p[n+1]=y;this.p[n+2]=z;
    this.v[n]=vx;this.v[n+1]=vy;this.v[n+2]=vz;return true;
  }
  seedVolume(predicate,velocity=[0,0,0]){
    const h=this.h,s=h*.5;
    for(let x=h+s*.5;x<this.extent[0]-h;x+=s)for(let y=h+s*.5;y<this.extent[1]-h;y+=s)for(let z=h+s*.5;z<this.extent[2]-h;z+=s){
      const xx=x+(this.random()-.5)*s*.12, yy=y+(this.random()-.5)*s*.12, zz=z+(this.random()-.5)*s*.12;
      if(predicate(xx,yy,zz)) this.add(xx,yy,zz,...velocity);
    }
  }
  initialize(){
    const key=this.config.nameKey;
    if(key==='breach') this.seedVolume((x,y,z)=>(x<1.42&&y<2.38)||(y<.20));
    else if(key==='impact') {this.seedVolume((x,y,z)=>y<.43||Math.hypot(x-2.4,y-2.22,z-1.6)<.49);for(let n=0;n<this.count;n++)if(this.p[n*3+1]>1.)this.v[n*3+1]=-2.5;}
    else if(key==='jets') {this.seedVolume((x,y,z)=>y<.22);this.emit(0.12);}
    else if(key==='cascade') {
      this.seedVolume((x,y,z)=>(y<.34&&x>2.4)||(x<1.1&&y>2.06&&y<2.53&&z>.35&&z<2.85),[1.6,0,0]);
    } else if(key==='slosh')this.seedVolume((x,y,z)=>y<.95+.25*Math.cos(x*.8),[2.9,0,.4]);
    // No automatic seed for tests: tests can construct exactly controlled states.
  }
  emit(dt){
    const key=this.config.nameKey,s=this.h*.5;
    if(key==='jets'){
      // Volume-conserving source count, independent of variable substep length.
      const radius=.215, speed=4.30, rate=Math.PI*radius*radius*speed/(s*s*s);
      this.emitCarry+=rate*dt;
      const n=Math.floor(this.emitCarry);this.emitCarry-=n;
      for(let e=0;e<2;e++)for(let q=0;q<n;q++){
        const a=this.random()*Math.PI*2, r=radius*Math.sqrt(this.random());
        const x=e?4.43-this.random()*speed*dt:.37+this.random()*speed*dt;
        const y=1.35+r*Math.sin(a),z=1.6+r*Math.cos(a);
        if(this.add(x,y,z,e?-4.30:4.30,2.50,e?-.1:.1))this.spawned++;
      }
    } else if(key==='cascade'){
      const area=.34*2.25, speed=1.65,rate=area*speed/(s*s*s);
      this.emitCarry+=rate*dt; const n=Math.floor(this.emitCarry);this.emitCarry-=n;
      for(let q=0;q<n;q++)if(this.add(.24+this.random()*speed*dt,2.12+this.random()*.34,.475+this.random()*2.25,speed,0,0))this.spawned++;
    }
  }
  splat(component, x,y,z,value){
    const h=this.h,sx=this.sx,sy=this.sy;
    let fx=x/h-(component===0?0:.5),fy=y/h-(component===1?0:.5),fz=z/h-(component===2?0:.5);
    const i=clamp(Math.floor(fx),0,this.nx-1),j=clamp(Math.floor(fy),0,this.ny-1),k=clamp(Math.floor(fz),0,this.nz-1);
    fx=clamp(fx-i,0,1);fy=clamp(fy-j,0,1);fz=clamp(fz-k,0,1);
    const a=1-fx,b=1-fy,c=1-fz,base=i*sx+j*sy+k,g=this.u[component],w=this.weights[component];
    let id=base,t=a*b*c;g[id]+=value*t;w[id]+=t;
    id=base+1;t=a*b*fz;g[id]+=value*t;w[id]+=t;
    id=base+sy;t=a*fy*c;g[id]+=value*t;w[id]+=t;
    id=base+sy+1;t=a*fy*fz;g[id]+=value*t;w[id]+=t;
    id=base+sx;t=fx*b*c;g[id]+=value*t;w[id]+=t;
    id=base+sx+1;t=fx*b*fz;g[id]+=value*t;w[id]+=t;
    id=base+sx+sy;t=fx*fy*c;g[id]+=value*t;w[id]+=t;
    id=base+sx+sy+1;t=fx*fy*fz;g[id]+=value*t;w[id]+=t;
  }
  sample(g,component,x,y,z){
    const sx=this.sx,sy=this.sy;
    let fx=x/this.h-(component===0?0:.5),fy=y/this.h-(component===1?0:.5),fz=z/this.h-(component===2?0:.5);
    const i=clamp(Math.floor(fx),0,this.nx-1),j=clamp(Math.floor(fy),0,this.ny-1),k=clamp(Math.floor(fz),0,this.nz-1);
    fx=clamp(fx-i,0,1);fy=clamp(fy-j,0,1);fz=clamp(fz-k,0,1);
    const a=1-fx,b=1-fy,c=1-fz,n=i*sx+j*sy+k;
    return a*(b*(c*g[n]+fz*g[n+1])+fy*(c*g[n+sy]+fz*g[n+sy+1]))+
      fx*(b*(c*g[n+sx]+fz*g[n+sx+1])+fy*(c*g[n+sx+sy]+fz*g[n+sx+sy+1]));
  }
  transferToGrid(){
    const kind=this.kind;for(let q=0;q<this.len;q++)kind[q]=this.solid[q]?2:0;
    for(let c=0;c<3;c++){this.u[c].fill(0);this.weights[c].fill(0);this.valid[c].fill(0);}
    for(let n=0;n<this.count;n++){
      const q=n*3,x=this.p[q],y=this.p[q+1],z=this.p[q+2];
      const id=this.index(Math.floor(x/this.h),Math.floor(y/this.h),Math.floor(z/this.h));
      if(!this.solid[id])kind[id]=1;
      this.splat(0,x,y,z,this.v[q]);this.splat(1,x,y,z,this.v[q+1]);this.splat(2,x,y,z,this.v[q+2]);
    }
    this.nActive=0;
    for(let q=0;q<this.len;q++){
      if(kind[q]===1)this.active[this.nActive++]=q;
      for(let c=0;c<3;c++)if(this.weights[c][q]>1e-8){this.u[c][q]/=this.weights[c][q];this.valid[c][q]=1;}
    }
    this.enforceBoundary();
    // Old and new fields must use the same transfer stencil. Store before gravity/projection.
    for(let c=0;c<3;c++)this.old[c].set(this.u[c]);
  }
  enforceBoundary(){
    const sx=this.sx,sy=this.sy,s=this.solid;
    for(let i=1;i<this.nx;i++)for(let j=1;j<this.ny;j++)for(let k=1;k<this.nz;k++){
      const id=i*sx+j*sy+k;
      if(s[id]||s[id-sx]){this.u[0][id]=0;this.valid[0][id]=1;}
      if(s[id]||s[id-sy]){this.u[1][id]=0;this.valid[1][id]=1;}
      if(s[id]||s[id-1]){this.u[2][id]=0;this.valid[2][id]=1;}
    }
  }
  divergence(){
    const [u,v,w]=this.u,sx=this.sx,sy=this.sy;let sum=0,max=0;
    for(let t=0;t<this.nActive;t++){const n=this.active[t];const d=(u[n+sx]-u[n]+v[n+sy]-v[n]+w[n+1]-w[n])/this.h;sum+=d*d;max=Math.max(max,Math.abs(d));}
    return {rms:Math.sqrt(sum/Math.max(1,this.nActive)),max};
  }
  project(dt,iterations=this.iterations){
    const [u,v,w]=this.u,sx=this.sx,sy=this.sy,s=this.solid,ids=this.active,p=this.pressure;
    p.fill(0); const before=this.divergence();
    // In-place SOR of the pressure Poisson system, expressed as face flux updates.
    // A solid neighbour removes a pressure coefficient; air has p=0.
    const omega=1.72;
    for(let it=0;it<iterations;it++){
      for(let a=0;a<this.nActive;a++){
        const n=ids[a],xl=1-s[n-sx],xr=1-s[n+sx],yl=1-s[n-sy],yr=1-s[n+sy],zl=1-s[n-1],zr=1-s[n+1];
        const sum=xl+xr+yl+yr+zl+zr;if(sum===0)continue;
        const div=u[n+sx]-u[n]+v[n+sy]-v[n]+w[n+1]-w[n];
        const dp=-omega*div/sum;
        u[n]-=xl*dp;u[n+sx]+=xr*dp;v[n]-=yl*dp;v[n+sy]+=yr*dp;w[n]-=zl*dp;w[n+1]+=zr*dp;
        p[n]+=dp*this.h/dt;
      }
    }
    return {before,after:this.divergence()};
  }
  extendVelocities(){
    const sx=this.sx,sy=this.sy,kind=this.kind,s=this.solid;
    for(let c=0;c<3;c++){
      const g=this.u[c],valid=this.valid[c],off=c===0?sx:c===1?sy:1;
      // Only projected liquid-adjacent faces seed the extrapolation.
      valid.fill(0);
      for(let i=1;i<this.nx;i++)for(let j=1;j<this.ny;j++)for(let k=1;k<this.nz;k++){
        const n=i*sx+j*sy+k;
        if(s[n]||s[n-off]||kind[n]===1||kind[n-off]===1)valid[n]=1;
      }
      for(let layer=0;layer<2;layer++){
        this.tmp.set(g);this.tmpValid.set(valid);
        for(let i=1;i<this.nx-1;i++)for(let j=1;j<this.ny-1;j++)for(let k=1;k<this.nz-1;k++){
          const n=i*sx+j*sy+k;if(valid[n])continue;
          let sum=0,num=0;
          if(valid[n-sx]){sum+=g[n-sx];num++;}if(valid[n+sx]){sum+=g[n+sx];num++;}
          if(valid[n-sy]){sum+=g[n-sy];num++;}if(valid[n+sy]){sum+=g[n+sy];num++;}
          if(valid[n-1]){sum+=g[n-1];num++;}if(valid[n+1]){sum+=g[n+1];num++;}
          if(num){this.tmp[n]=sum/num;this.tmpValid[n]=1;}
        }
        g.set(this.tmp);valid.set(this.tmpValid);
      }
    }
  }
  collide(n){
    const p=this.p,v=this.v,q=n*3,margin=this.h*.16;
    for(let c=0;c<3;c++){
      const lo=this.h+margin,hi=this.extent[c]-this.h-margin;
      if(p[q+c]<lo){p[q+c]=lo;if(v[q+c]<0)v[q+c]=0;}
      if(p[q+c]>hi){p[q+c]=hi;if(v[q+c]>0)v[q+c]=0;}
    }
    for(const o of this.obstacles){
      if(o.kind==='box'){
        let dx=p[q]-o.center[0],dy=p[q+1]-o.center[1],dz=p[q+2]-o.center[2];
        const a=o.half[0]+margin-Math.abs(dx),b=o.half[1]+margin-Math.abs(dy),c=o.half[2]+margin-Math.abs(dz);
        if(a>0&&b>0&&c>0){
          const axis=a<b?(a<c?0:2):(b<c?1:2),delta=axis===0?dx:axis===1?dy:dz,sign=delta<0?-1:1;
          p[q+axis]=o.center[axis]+sign*(o.half[axis]+margin);if(v[q+axis]*sign<0)v[q+axis]=0;
        }
      }else if(o.kind==='sphere'){
        const dx=p[q]-o.center[0],dy=p[q+1]-o.center[1],dz=p[q+2]-o.center[2],l=Math.hypot(dx,dy,dz),r=o.radius+margin;
        if(l<r&&l>1e-9){const nx=dx/l,ny=dy/l,nz=dz/l; p[q]=o.center[0]+nx*r;p[q+1]=o.center[1]+ny*r;p[q+2]=o.center[2]+nz*r;
          const vn=v[q]*nx+v[q+1]*ny+v[q+2]*nz;if(vn<0){v[q]-=vn*nx;v[q+1]-=vn*ny;v[q+2]-=vn*nz;}}
      }
    }
  }
  separate(){
    // Small positional anti-clumping correction; not the incompressibility solve.
    // Does not alter particle count or replace the pressure projection.
    const head=this.head,next=this.next,p=this.p,h=this.h,sx=this.sx,sy=this.sy;
    head.fill(-1);
    for(let n=0;n<this.count;n++){const q=n*3,id=this.index(Math.floor(p[q]/h),Math.floor(p[q+1]/h),Math.floor(p[q+2]/h));next[n]=head[id];head[id]=n;}
    const dmin=h*.43,d2=dmin*dmin;
    for(let n=0;n<this.count;n++){
      const q=n*3,x=p[q],y=p[q+1],z=p[q+2],i=Math.floor(x/h),j=Math.floor(y/h),k=Math.floor(z/h);
      let cx=0,cy=0,cz=0;
      for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++)for(let dk=-1;dk<=1;dk++){
        let other=head[(i+di)*sx+(j+dj)*sy+k+dk];
        while(other>=0){
          if(other!==n){const r=other*3,dx=x-p[r],dy=y-p[r+1],dz=z-p[r+2],rr=dx*dx+dy*dy+dz*dz;
            if(rr>1e-12&&rr<d2){const f=.16*(dmin/Math.sqrt(rr)-1);cx+=dx*f;cy+=dy*f;cz+=dz*f;}}
          other=next[other];
        }
      }
      const l=Math.hypot(cx,cy,cz),f=l>h*.07?h*.07/l:1;
      p[q]+=cx*f;p[q+1]+=cy*f;p[q+2]+=cz*f;this.collide(n);
    }
  }
  step(dt){
    if(!(dt>0&&dt<=.05))throw new Error('FLIP dt must be in (0, 0.05] seconds.');
    this.emit(dt);this.transferToGrid();
    const gravity=this.gravity;
    for(let c=0;c<3;c++)for(let q=0;q<this.len;q++)if(this.weights[c][q]>1e-8)this.u[c][q]+=gravity[c]*dt;
    this.enforceBoundary();const projection=this.project(dt);
    // Gather from matched old/new transfer samples BEFORE extrapolation changes air stencils.
    // The FLIP update is a velocity increment, not a sampled noise/height-field animation.
    for(let n=0;n<this.count;n++){
      const q=n*3,x=this.p[q],y=this.p[q+1],z=this.p[q+2];
      for(let c=0;c<3;c++){
        const pic=this.sample(this.u[c],c,x,y,z),prev=this.sample(this.old[c],c,x,y,z);
        this.v[q+c]=this.flip*(this.v[q+c]+pic-prev)+(1-this.flip)*pic;
      }
    }
    // Particle advection is substepped by a measured CFL bound in advance().
    for(let n=0;n<this.count;n++){
      const q=n*3;this.p[q]+=this.v[q]*dt;this.p[q+1]+=this.v[q+1]*dt;this.p[q+2]+=this.v[q+2]*dt;this.collide(n);
    }
    if(this.steps%2===0)this.separate();
    this.time+=dt;this.steps++;
    this.metrics={...this.metrics,divergenceBefore:projection.before.rms,divergenceAfter:projection.after.rms,
      divergenceMax:projection.after.max,projectionRatio:projection.after.rms/Math.max(1e-12,projection.before.rms),activeCells:this.nActive,dt};
    return this.metrics;
  }
  maxSpeed(){let max=0;for(let n=0;n<this.count;n++){const q=3*n;max=Math.max(max,Math.hypot(this.v[q],this.v[q+1],this.v[q+2]));}return max;}
  advance(frameDt=1/48){
    if(!(frameDt>0&&frameDt<=.25))throw new Error('Invalid frame duration.');
    let remaining=frameDt,substeps=0;
    while(remaining>1e-8){
      const speed=this.maxSpeed(),dt=Math.min(remaining,1/90,.55*this.h/Math.max(1,speed+9.81*remaining));
      this.step(dt);remaining-=dt;substeps++;
      if(substeps>256)throw new Error('CFL substep budget exceeded; unstable simulation.');
    }
    return this.inspect(substeps);
  }
  inspect(substeps=0){
    let finite=true,violations=0,maxSpeed=0,cx=0,cy=0,cz=0,ke=0;
    for(let n=0;n<this.count;n++){
      const q=n*3,x=this.p[q],y=this.p[q+1],z=this.p[q+2],s2=this.v[q]**2+this.v[q+1]**2+this.v[q+2]**2;
      if(!Number.isFinite(x+y+z+s2))finite=false;if(this.insideSolid(x,y,z,-1e-5))violations++;
      cx+=x;cy+=y;cz+=z;ke+=s2;maxSpeed=Math.max(maxSpeed,Math.sqrt(s2));
    }
    const massPerParticle=1000*(this.h*.5)**3;
    return {...this.metrics,time:this.time,steps:this.steps,substeps,particles:this.count,initialParticles:this.initialCount,
      spawned:this.spawned,deleted:this.deleted,capacityRejected:this.capacityRejected,finite,solidViolations:violations,
      particleVolume:this.count*(this.h*.5)**3,center:[cx/Math.max(1,this.count),cy/Math.max(1,this.count),cz/Math.max(1,this.count)],maxSpeed,
      kineticEnergy:ke*.5*massPerParticle,grid:[this.nx,this.ny,this.nz],h:this.h};
  }
}
