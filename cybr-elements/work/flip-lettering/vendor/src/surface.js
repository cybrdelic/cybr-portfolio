/* Particle-kernel isosurface extraction for the browser worker.
 * No animated height field, spectral waves, or canned splash geometry.
 */
import {TRI_TABLE_B64} from './mc-table.js';
const TRI=Int8Array.from(atob(TRI_TABLE_B64),x=>{const v=x.charCodeAt(0);return v>127?v-256:v;});
const CORNERS=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const EDGES=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class SurfaceBuilder{
 constructor(config){
  this.h=config.h;this.spacing=config.h*.68;this.iso=1.9;this.radius=config.h*.98;
  this.shape=config.extent.map(v=>Math.ceil(v/this.spacing)+1);[this.nx,this.ny,this.nz]=this.shape;this.sx=this.ny*this.nz;this.sy=this.nz;
  this.field=new Float32Array(this.nx*this.ny*this.nz);this.temp=new Float32Array(this.field.length);this.foamField=new Float32Array(this.field.length);
  this.vertices=new Float32Array(3600000);this.normals=new Float32Array(3600000);this.foam=new Float32Array(1200000);
  this.gx=new Float32Array(this.field.length);this.gy=new Float32Array(this.field.length);this.gz=new Float32Array(this.field.length);
  this.cellValue=new Float32Array(8);this.edgePosition=new Float32Array(36);this.edgeNormal=new Float32Array(36);this.edgeFoam=new Float32Array(12);
 }
 index(i,j,k){return i*this.sx+j*this.sy+k;}
 sample(field,x,y,z){
  let fx=x/this.spacing,fy=y/this.spacing,fz=z/this.spacing;
  const i=clamp(Math.floor(fx),0,this.nx-2),j=clamp(Math.floor(fy),0,this.ny-2),k=clamp(Math.floor(fz),0,this.nz-2);
  fx=clamp(fx-i,0,1);fy=clamp(fy-j,0,1);fz=clamp(fz-k,0,1);
  const n=this.index(i,j,k),sx=this.sx,sy=this.sy,a=1-fx,b=1-fy,c=1-fz;
  return a*(b*(c*field[n]+fz*field[n+1])+fy*(c*field[n+sy]+fz*field[n+sy+1]))+fx*(b*(c*field[n+sx]+fz*field[n+sx+1])+fy*(c*field[n+sx+sy]+fz*field[n+sx+sy+1]));
 }
 splat(field,x,y,z,r,scale=1){
  const d=this.spacing,rr=r*r;
  const ia=Math.max(0,Math.floor((x-r)/d)),ib=Math.min(this.nx-1,Math.ceil((x+r)/d));
  const ja=Math.max(0,Math.floor((y-r)/d)),jb=Math.min(this.ny-1,Math.ceil((y+r)/d));
  const ka=Math.max(0,Math.floor((z-r)/d)),kb=Math.min(this.nz-1,Math.ceil((z+r)/d));
  for(let i=ia;i<=ib;i++){const dx=i*d-x;for(let j=ja;j<=jb;j++){const dy=j*d-y;for(let k=ka;k<=kb;k++){
   const dz=k*d-z,t=1-(dx*dx+dy*dy+dz*dz)/rr;if(t>0)field[this.index(i,j,k)]+=scale*t*t*t;
  }}}
 }
 density(p,count){
  const f=this.field;f.fill(0);
  for(let n=0;n<count;n++){const q=3*n;this.splat(f,p[q],p[q+1],p[q+2],this.radius);}
  // Conservative symmetric local smoothing, separate from the dynamics.
  for(const off of [this.sx,this.sy,1]){
   this.temp.set(f);for(let i=1;i<this.nx-1;i++)for(let j=1;j<this.ny-1;j++)for(let k=1;k<this.nz-1;k++){
    const n=this.index(i,j,k);this.temp[n]=.08*f[n-off]+.84*f[n]+.08*f[n+off];
   }f.set(this.temp);
  }
  const sx=this.sx,sy=this.sy;
  for(let i=1;i<this.nx-1;i++)for(let j=1;j<this.ny-1;j++)for(let k=1;k<this.nz-1;k++){
   const n=this.index(i,j,k);this.gx[n]=(f[n-sx]-f[n+sx])/(2*this.spacing);this.gy[n]=(f[n-sy]-f[n+sy])/(2*this.spacing);this.gz[n]=(f[n-1]-f[n+1])/(2*this.spacing);
  }
 }
 mesh(p,count,white){
  let low=.10,high=3.25,best=null;
  for(let iteration=0;iteration<5;iteration++){
   const g=this.extract(p,count,white),a=g.positions;let volume=0;
   for(let i=0;i<a.length;i+=9)volume+=(a[i]*(a[i+4]*a[i+8]-a[i+5]*a[i+7])+a[i+1]*(a[i+5]*a[i+6]-a[i+3]*a[i+8])+a[i+2]*(a[i+3]*a[i+7]-a[i+4]*a[i+6]))/6;
   volume=Math.abs(volume);const target=Math.max(1e-14,(count-g.drops.length/3)*(this.h*.5)**3),error=(volume-target)/target;
   if(!best||Math.abs(error)<Math.abs(best.error))best={g,error,volume,target,iso:this.iso,iteration:iteration+1};
   if(Math.abs(error)<.008)break;
   if(error>0)low=this.iso;else high=this.iso;
   let shell=0;for(const value of this.field)if(Math.abs(value-this.iso)<.13)shell++;
   const derivative=-shell*this.spacing**3/.26;
   const candidate=this.iso-(volume-target)/Math.min(-1e-12,derivative);
   this.iso=candidate>low&&candidate<high?candidate:(low+high)/2;
  }
  this.iso=best.iso;this.lastMeshStats={isovalue:best.iso,volume:best.volume,target:best.target,relativeError:best.error,iterations:best.iteration,kernel:'isotropic live preview / volume calibrated'};
  return best.g;
 }
 extract(p,count,white){
  const field=this.field,iso=this.iso,d=this.spacing,cv=this.cellValue,ep=this.edgePosition,en=this.edgeNormal,ef=this.edgeFoam;
  this.foamField.fill(0);if(white)for(let q=0;q<white.length;q+=6)if(white[q+4]===0)this.splat(this.foamField,white[q],white[q+1],white[q+2],this.h*1.5,.45*white[q+5]);
  let nv=0;
  for(let i=1;i<this.nx-2;i++)for(let j=1;j<this.ny-2;j++)for(let k=1;k<this.nz-2;k++){
   let code=0;
   for(let c=0;c<8;c++){const cc=CORNERS[c],val=field[this.index(i+cc[0],j+cc[1],k+cc[2])];cv[c]=val;if(val<iso)code|=1<<c;}
   if(code===0||code===255)continue;
   for(let e=0;e<12;e++){
    const [a,b]=EDGES[e],va=cv[a],vb=cv[b],t=Math.abs(vb-va)>1e-9?clamp((iso-va)/(vb-va),0,1):.5;
    const ca=CORNERS[a],cb=CORNERS[b],n0=this.index(i+ca[0],j+ca[1],k+ca[2]),n1=this.index(i+cb[0],j+cb[1],k+cb[2]);
    ep[e*3]=(i+ca[0]+(cb[0]-ca[0])*t)*d;ep[e*3+1]=(j+ca[1]+(cb[1]-ca[1])*t)*d;ep[e*3+2]=(k+ca[2]+(cb[2]-ca[2])*t)*d;
    let nx=this.gx[n0]*(1-t)+this.gx[n1]*t,ny=this.gy[n0]*(1-t)+this.gy[n1]*t,nz=this.gz[n0]*(1-t)+this.gz[n1]*t;const inv=1/Math.max(1e-9,Math.hypot(nx,ny,nz));
    en[e*3]=nx*inv;en[e*3+1]=ny*inv;en[e*3+2]=nz*inv;ef[e]=Math.min(.9,this.foamField[n0]*(1-t)+this.foamField[n1]*t);
   }
   for(let t=0;t<16;t+=3){const a=TRI[code*16+t];if(a<0)break;const b=TRI[code*16+t+1],c=TRI[code*16+t+2];
    if(nv+3>=this.vertices.length/3)throw Error('Surface capacity exceeded; lower live mesh resolution.');
    const ax=ep[b*3]-ep[a*3],ay=ep[b*3+1]-ep[a*3+1],az=ep[b*3+2]-ep[a*3+2];
    const bx=ep[c*3]-ep[a*3],by=ep[c*3+1]-ep[a*3+1],bz=ep[c*3+2]-ep[a*3+2];
    const dot=(ay*bz-az*by)*en[a*3]+(az*bx-ax*bz)*en[a*3+1]+(ax*by-ay*bx)*en[a*3+2];
    const edges=dot>=0?[a,b,c]:[a,c,b];
    for(const e of edges){this.vertices.set(ep.subarray(e*3,e*3+3),nv*3);this.normals.set(en.subarray(e*3,e*3+3),nv*3);this.foam[nv]=ef[e];nv++;}
   }
  }
  const indices=new Uint32Array(nv);for(let n=0;n<nv;n++)indices[n]=n;
  const drops=[];for(let n=0;n<count;n++){const q=n*3;if(this.sample(field,p[q],p[q+1],p[q+2])<Math.min(1.38,iso*.8)){drops.push(p[q],p[q+1],p[q+2]);if(drops.length>=15000)break;}}
  const diagnostic=new Float32Array(Math.min(14000,count)*3),step=count/(diagnostic.length/3);
  for(let n=0;n<diagnostic.length/3;n++){const q=Math.min(count-1,Math.floor(n*step))*3;diagnostic.set(p.subarray(q,q+3),n*3);}
  return {positions:this.vertices.slice(0,nv*3),normals:this.normals.slice(0,nv*3),indices,foam:this.foam.slice(0,nv),drops:new Float32Array(drops),white:white??new Float32Array(0),diagnostic};
 }
}
export class SecondaryParticles{
 constructor(seed){this.state=seed>>>0;this.items=[];this.previous=null;this.births=0;this.transitions=0;}
 random(){let x=this.state;x^=x<<13;x^=x>>>17;x^=x<<5;this.state=x>>>0;return this.state/4294967296;}
 advance(sim,surf,dt){
  if(['capillary','viscous'].includes(sim.config.nameKey))return new Float32Array(0);
  const keep=[],h=sim.h,iso=surf.iso;
  const flow=(x,y,z)=>[0,1,2].map(c=>sim.sample(sim.u[c],c,x,y,z));
  for(const a of this.items){
   let density=surf.sample(surf.field,a.x,a.y,a.z),old=a.mode;
   if(density<iso*.42)a.mode=1;else if(density>iso*1.65)a.mode=2;else if(density>iso*.72&&density<iso*1.35)a.mode=0;
   if(old!==a.mode)this.transitions++;
   if(a.mode===1){a.vy-=9.81*dt;const drag=Math.exp(-.22*dt);a.vx*=drag;a.vy*=drag;a.vz*=drag;}
   else {
    let u=flow(a.x,a.y,a.z);
    if(a.mode===0)u=flow(a.x+u[0]*dt*.5,a.y+u[1]*dt*.5,a.z+u[2]*dt*.5);
    const relax=a.mode===2?1-Math.exp(-dt/.065):1;
    a.vx+=(u[0]-a.vx)*relax;a.vy+=(u[1]+(a.mode===2?Math.min(.45,Math.sqrt(2*9.81*a.radius/.44)):0)-a.vy)*relax;a.vz+=(u[2]-a.vz)*relax;
   }
   a.x+=a.vx*dt;a.y+=a.vy*dt;a.z+=a.vz*dt;
   if(a.mode===0)for(let iteration=0;iteration<2;iteration++){
    density=surf.sample(surf.field,a.x,a.y,a.z);const nx=surf.sample(surf.gx,a.x,a.y,a.z),ny=surf.sample(surf.gy,a.x,a.y,a.z),nz=surf.sample(surf.gz,a.x,a.y,a.z),f=(density-iso)/Math.max(1e-7,nx*nx+ny*ny+nz*nz);
    a.x+=clamp(nx*f,-h*.25,h*.25);a.y+=clamp(ny*f,-h*.25,h*.25);a.z+=clamp(nz*f,-h*.25,h*.25);
   }
   a.life-=dt;
   if(a.life>0&&a.x>h&&a.x<sim.extent[0]-h&&a.y>h&&a.y<sim.extent[1]-h&&a.z>h&&a.z<sim.extent[2]-h&&!sim.insideSolid(a.x,a.y,a.z,-h*.05))keep.push(a);
  }
  this.items=keep;let births=0;
  for(let trial=0;trial<4500&&births<150&&this.items.length<12000;trial++){
   const id=Math.floor(this.random()*sim.count),q=id*3,x=sim.p[q],y=sim.p[q+1],z=sim.p[q+2],vx=sim.v[q],vy=sim.v[q+1],vz=sim.v[q+2],speed=Math.hypot(vx,vy,vz);
   if(speed<1.25||y<h*1.8)continue;const den=surf.sample(surf.field,x,y,z);if(den<iso*.65||den>iso*1.65)continue;
   const nx=surf.sample(surf.gx,x,y,z),ny=surf.sample(surf.gy,x,y,z),nz=surf.sample(surf.gz,x,y,z),l=Math.hypot(nx,ny,nz);if(l<1e-5)continue;
   const accel=this.previous&&q<this.previous.length?Math.hypot((vx-this.previous[q])/dt,(vy-this.previous[q+1])/dt+9.81,(vz-this.previous[q+2])/dt):0;
   const outward=(nx*vx+ny*vy+nz*vz)/l,potential=clamp((accel-6)/40,0,1)*clamp((speed-1.25)/4,0,1)+.3*clamp((outward-.7)/3,0,1);
   if(this.random()>1-Math.exp(-dt*4*potential))continue;
   const r=this.random(),mode=r<.4?2:r<.84?0:1,out=(mode===2?-.35:.12)*h/l,life=mode===0?2.2+this.random()*2.6:.75+this.random()*1.5;
   this.items.push({x:x+nx*out,y:y+ny*out,z:z+nz*out,vx,vy,vz,mode,radius:h*.03*Math.exp(this.random()*Math.log(4.5)),life,life0:life});births++;
  }
  this.births+=births;this.previous=sim.v.slice(0,sim.count*3);
  const out=new Float32Array(this.items.length*6);for(let n=0;n<this.items.length;n++){const a=this.items[n];out.set([a.x,a.y,a.z,a.radius,a.mode,Math.min(1,a.life/.25,(a.life0-a.life)/.12)],n*6);}return out;
 }
}
