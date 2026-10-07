/* Small-step XPBD garment cages. Original implementation of compliant distance
 * constraints (Macklin et al., 2016), not a sinusoidal vertex animation. */
'use strict';
class ClothCage {
  constructor(asset) {
    this.asset=asset;
    this.rest=Float64Array.from(asset.position.flat());
    this.target=new Float64Array(this.rest.length);
    this.x=new Float64Array(this.rest.length);
    this.previous=new Float64Array(this.rest.length);
    this.velocity=new Float64Array(this.rest.length);
    this.output=new Float32Array(asset.position.length*4);
    this.lambda=new Float64Array(asset.edges.length);
    this.posedLengths=new Float64Array(asset.edges.length);
    this.collisionRadii=new Float64Array(asset.position.length*asset.capsules.length);
    this.capsules=asset.capsules.map(()=>new Float64Array(7));
    this.steps=0;
  }
  static point(palette,j,p,out,offset=0) {
    const m=j*16;
    for(let a=0;a<3;a++)out[offset+a]=palette[m+a]*p[0]+palette[m+4+a]*p[1]+palette[m+8+a]*p[2]+palette[m+12+a];
  }
  pose(palette,constraints=true) {
    const {position,joints,weights,capsules}=this.asset;
    for(let i=0;i<position.length;i++) {
      const p=position[i],o=i*3;this.target.fill(0,o,o+3);
      for(let k=0;k<4;k++) {
        const m=joints[i][k]*16,w=weights[i][k];
        for(let a=0;a<3;a++)this.target[o+a]+=w*(palette[m+a]*p[0]+palette[m+4+a]*p[1]+palette[m+8+a]*p[2]+palette[m+12+a]);
      }
    }
    if(!constraints)return;
    for(let i=0;i<capsules.length;i++) {
      const c=capsules[i],out=this.capsules[i];
      ClothCage.point(palette,c.a,c.pa,out);ClothCage.point(palette,c.b,c.pb,out,3);out[6]=c.radius+.006;
    }
    const t=this.target;
    for(let e=0;e<this.asset.edges.length;e++){const [i,j]=this.asset.edges[e],a=i*3,b=j*3;this.posedLengths[e]=Math.hypot(t[a]-t[b],t[a+1]-t[b+1],t[a+2]-t[b+2]);}
    for(let i=0;i<position.length;i++)for(let k=0;k<this.capsules.length;k++){
      const c=this.capsules[k],o=i*3,ax=c[3]-c[0],ay=c[4]-c[1],az=c[5]-c[2];
      const h=Math.max(0,Math.min(1,((t[o]-c[0])*ax+(t[o+1]-c[1])*ay+(t[o+2]-c[2])*az)/(ax*ax+ay*ay+az*az||1)));
      const distance=Math.hypot(t[o]-c[0]-h*ax,t[o+1]-c[1]-h*ay,t[o+2]-c[2]-h*az);
      this.collisionRadii[i*this.capsules.length+k]=distance-c[6]>this.asset.maxDistance[i]+.02?-1:Math.min(c[6],distance);
    }
  }
  reset(palette) {
    this.pose(palette);this.x.set(this.target);this.previous.set(this.target);this.velocity.fill(0);this.output.fill(0);
  }
  step(palette,dt=1/120) {
    this.pose(palette);
    const {edges,lengths,stretchCount,maxDistance}=this.asset;
    const x=this.x,v=this.velocity,t=this.target,old=this.previous;
    old.set(x);this.lambda.fill(0);
    for(let i=0;i<maxDistance.length;i++)for(let a=0;a<3;a++) {
      const o=i*3+a;
      if(!maxDistance[i]){x[o]=t[o];v[o]=0;continue;}
      // Weak air/animation drag, gravity and inertia. Pins do the attachment;
      // the painted maximum-distance cage limits extreme combat excursions.
      v[o]=v[o]*Math.exp(-8*dt)+((a===1?-9.81:0)+(t[o]-x[o])*65)*dt;
      x[o]+=v[o]*dt;
    }
    for(let iteration=0;iteration<4;iteration++) {
      for(let e=0;e<edges.length;e++) {
        const [i,j]=edges[e],a=i*3,b=j*3,wi=maxDistance[i]?1:0,wj=maxDistance[j]?1:0;
        if(!(wi+wj))continue;
        const dx=x[a]-x[b],dy=x[a+1]-x[b+1],dz=x[a+2]-x[b+2],d=Math.hypot(dx,dy,dz);
        if(d<1e-9)continue;
        const alpha=(e<stretchCount?2e-7:8e-5)/(dt*dt);
        // Preserve the authored/skinned garment shape, adding secondary
        // motion rather than forcing a bent torso back into T-pose lengths.
        const rest=this.posedLengths[e];
        const dl=(-(d-rest)-alpha*this.lambda[e])/(wi+wj+alpha);
        this.lambda[e]+=dl;
        const scale=dl/d;
        x[a]+=wi*scale*dx;x[a+1]+=wi*scale*dy;x[a+2]+=wi*scale*dz;
        x[b]-=wj*scale*dx;x[b+1]-=wj*scale*dy;x[b+2]-=wj*scale*dz;
      }
      for(let i=0;i<maxDistance.length;i++) {
        const o=i*3,limit=maxDistance[i];
        if(!limit){x.set(t.subarray(o,o+3),o);continue;}
        const dx=x[o]-t[o],dy=x[o+1]-t[o+1],dz=x[o+2]-t[o+2],distance=Math.hypot(dx,dy,dz);
        if(distance>limit){const k=limit/distance;x[o]=t[o]+dx*k;x[o+1]=t[o+1]+dy*k;x[o+2]=t[o+2]+dz*k;}
        for(let k=0;k<this.capsules.length;k++) {const c=this.capsules[k];
          if(this.collisionRadii[i*this.capsules.length+k]<0)continue;
          const ax=c[3]-c[0],ay=c[4]-c[1],az=c[5]-c[2];
          const h=Math.max(0,Math.min(1,((x[o]-c[0])*ax+(x[o+1]-c[1])*ay+(x[o+2]-c[2])*az)/(ax*ax+ay*ay+az*az||1)));
          const px=c[0]+h*ax,py=c[1]+h*ay,pz=c[2]+h*az;
          const nx=x[o]-px,ny=x[o+1]-py,nz=x[o+2]-pz,d=Math.hypot(nx,ny,nz);
          const radius=this.collisionRadii[i*this.capsules.length+k];
          if(d<radius&&d>1e-8){const k=radius/d;x[o]=px+nx*k;x[o+1]=py+ny*k;x[o+2]=pz+nz*k;}
        }
        x[o+1]=Math.max(.004,x[o+1]);
      }
    }
    // Resolve overlapping capsule contacts after structural projections. A
    // single sequential sweep can push a particle out of one limb into another.
    for(let i=0;i<maxDistance.length;i++) {
      if(!maxDistance[i])continue;
      const o=i*3;
      for(let sweep=0;sweep<6;sweep++) {
        let penetration=0,dx=0,dy=0,dz=0;
        for(let k=0;k<this.capsules.length;k++) {const c=this.capsules[k];
          if(this.collisionRadii[i*this.capsules.length+k]<0)continue;
          const ax=c[3]-c[0],ay=c[4]-c[1],az=c[5]-c[2];
          const h=Math.max(0,Math.min(1,((x[o]-c[0])*ax+(x[o+1]-c[1])*ay+(x[o+2]-c[2])*az)/(ax*ax+ay*ay+az*az||1)));
          const nx=x[o]-c[0]-h*ax,ny=x[o+1]-c[1]-h*ay,nz=x[o+2]-c[2]-h*az,d=Math.hypot(nx,ny,nz);
          const radius=this.collisionRadii[i*this.capsules.length+k];
          if(radius-d>penetration&&d>1e-8){penetration=radius-d;dx=nx/d;dy=ny/d;dz=nz/d;}
        }
        if(penetration<.0005)break;
        x[o]+=dx*penetration;x[o+1]+=dy*penetration;x[o+2]+=dz*penetration;
      }
      x[o+1]=Math.max(.004,x[o+1]);
    }
    for(let i=0;i<x.length;i++)v[i]=(x[i]-old[i])/dt;
    // Collision proxies are deliberately coarse. They must never overpower
    // the garment's authored envelope, particularly between crossed thighs.
    for(let i=0;i<maxDistance.length;i++) {
      const o=i*3,limit=maxDistance[i],d=Math.hypot(x[o]-t[o],x[o+1]-t[o+1],x[o+2]-t[o+2]);
      if(d>limit)for(let a=0;a<3;a++)x[o+a]=t[o+a]+(x[o+a]-t[o+a])*limit/d;
      for(let a=0;a<3;a++)v[o+a]=Math.max(-3,Math.min(3,(x[o+a]-old[o+a])/dt));
    }
    this.steps++;
  }
  displacement(palette) {
    this.pose(palette,false);
    for(let i=0;i<this.asset.position.length;i++)for(let a=0;a<3;a++)this.output[i*4+a]=this.x[i*3+a]-this.target[i*3+a];
    return this.output;
  }
}

class ClothPlayback {
  constructor(assets,gl) {
    this.gl=gl;this.cages=assets.map(a=>new ClothCage(a));this.last=null;this.tick=0;this.resets=0;
    this.textures=this.cages.map(c=>{
      const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,c.output.length/4,1,0,gl.RGBA,gl.FLOAT,c.output);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return tex;
    });
  }
  update(time,take,model,enabled,frame,sample) {
    if(!enabled){this.last=null;return;}
    const active=this.cages.filter(c=>c.asset.model===model),last=this.last;
    if(!last||last.take!==take||last.model!==model||time<last.time-1e-6||
       time-last.time>.1||time-this.tick>.05) {
      for(const c of active)c.reset(frame.skins[c.asset.skin]);
      this.tick=time;this.resets++;
    } else {
      // Fixed source-time steps, not display-time Euler integration. Pausing and
      // camera changes do not advance physics; cuts/loops/seeks reset velocity.
      while(this.tick+1/120<=time+1e-8) {
        this.tick+=1/120;const pose=sample(this.tick);
        for(const c of active)c.step(pose.skins[c.asset.skin]);
      }
    }
    this.last={time,take,model};
    for(let i=0;i<this.cages.length;i++) {
      const c=this.cages[i];if(c.asset.model!==model)continue;
      const output=c.displacement(frame.skins[c.asset.skin]);
      this.gl.activeTexture(this.gl.TEXTURE5);this.gl.bindTexture(this.gl.TEXTURE_2D,this.textures[i]);
      this.gl.texSubImage2D(this.gl.TEXTURE_2D,0,0,0,output.length/4,1,this.gl.RGBA,this.gl.FLOAT,output);
    }
  }
}
if(typeof module!=='undefined')module.exports={ClothCage,ClothPlayback};
