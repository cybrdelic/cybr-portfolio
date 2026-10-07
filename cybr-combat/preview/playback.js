/* Bone-local interpolation. Four decoded frame endpoints maximum; no new poses
   or matrices are baked into the payload. Integer-frame inspection is exact. */
class PosePlayback {
  static multiply(a, b, out = new Float64Array(16)) {
    for (let j=0;j<4;j++) for(let i=0;i<4;i++) {
      let value=0;for(let k=0;k<4;k++)value+=a[k*4+i]*b[j*4+k];
      out[j*4+i]=value;
    }
    return out;
  }
  static inverse(m) {
    const out=new Float64Array(16);
    const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10];
    const det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
    if(Math.abs(det)<1e-10)throw Error('Singular playback transform');
    const v=[e*i-f*h,f*g-d*i,d*h-e*g,c*h-b*i,a*i-c*g,b*g-a*h,b*f-c*e,c*d-a*f,a*e-b*d];
    for(let col=0;col<3;col++)for(let row=0;row<3;row++)out[col*4+row]=v[col*3+row]/det;
    for(let row=0;row<3;row++)out[12+row]=-(out[row]*m[12]+out[4+row]*m[13]+out[8+row]*m[14]);
    out[15]=1;return out;
  }
  static decompose(m) {
    const s=[Math.hypot(m[0],m[1],m[2]),Math.hypot(m[4],m[5],m[6]),Math.hypot(m[8],m[9],m[10])];
    const r=[m[0]/s[0],m[4]/s[1],m[8]/s[2],m[1]/s[0],m[5]/s[1],m[9]/s[2],m[2]/s[0],m[6]/s[1],m[10]/s[2]];
    const q=[0,0,0,0],trace=r[0]+r[4]+r[8];
    if(trace>0){const t=Math.sqrt(trace+1)*2;q[3]=t/4;q[0]=(r[7]-r[5])/t;q[1]=(r[2]-r[6])/t;q[2]=(r[3]-r[1])/t;}
    else {let i=r[4]>r[0]?1:0;if(r[8]>r[i*3+i])i=2;const j=(i+1)%3,k=(j+1)%3,t=Math.sqrt(1+r[i*3+i]-r[j*3+j]-r[k*3+k])*2;
      q[i]=t/4;q[j]=(r[i*3+j]+r[j*3+i])/t;q[k]=(r[i*3+k]+r[k*3+i])/t;q[3]=(r[k*3+j]-r[j*3+k])/t;}
    return {t:[m[12],m[13],m[14]],q,s};
  }
  static blend(a,b,u,out) {
    let dot=a.q.reduce((v,x,i)=>v+x*b.q[i],0),sign=dot<0?-1:1;dot=Math.min(1,Math.abs(dot));
    let x=1-u,y=u;
    if(dot<.9995){const angle=Math.acos(dot),den=Math.sin(angle);x=Math.sin((1-u)*angle)/den;y=Math.sin(u*angle)/den;}
    const q=a.q.map((v,i)=>v*x+b.q[i]*y*sign),length=Math.hypot(...q);
    const [qx,qy,qz,qw]=q.map(v=>v/length),s=a.s.map((v,i)=>v*(1-u)+b.s[i]*u);
    out[0]=(1-2*(qy*qy+qz*qz))*s[0];out[1]=2*(qx*qy+qz*qw)*s[0];out[2]=2*(qx*qz-qy*qw)*s[0];out[3]=0;
    out[4]=2*(qx*qy-qz*qw)*s[1];out[5]=(1-2*(qx*qx+qz*qz))*s[1];out[6]=2*(qy*qz+qx*qw)*s[1];out[7]=0;
    out[8]=2*(qx*qz+qy*qw)*s[2];out[9]=2*(qy*qz-qx*qw)*s[2];out[10]=(1-2*(qx*qx+qy*qy))*s[2];out[11]=0;
    for(let i=0;i<3;i++)out[12+i]=a.t[i]*(1-u)+b.t[i]*u;out[15]=1;
    return out;
  }
  constructor(frames,rig,rows) {
    this.frames=frames;this.rig=rig;this.rows=rows;this.cache=new Map();this.outputs=[];
    this.binds=rig?.skins.map(s=>s.parents.map((_,i)=>new Float64Array(s.bind.slice(i*16,i*16+16))));
    this.inverses=rig?.skins.map(s=>s.parents.map((_,i)=>new Float64Array(s.inverseBind.slice(i*16,i*16+16))));
  }
  decode(frame) {
    if(this.cache.has(frame))return this.cache.get(frame);
    const decodeActor=actor=>{
      const worlds=actor.skins.map((palette,k)=>this.rig.skins[k].parents.map((_,i)=>PosePlayback.multiply(palette.subarray(i*16,i*16+16),this.binds[k][i])));
      const local=worlds.map((skin,k)=>skin.map((world,i)=>PosePlayback.decompose(this.rig.skins[k].parents[i]<0?world:PosePlayback.multiply(PosePlayback.inverse(skin[this.rig.skins[k].parents[i]]),world))));
      const attachments={};for(const [name,[skin,bone]] of Object.entries(this.rig.attachments))if(actor[name])attachments[name]=PosePlayback.decompose(PosePlayback.multiply(PosePlayback.inverse(worlds[skin][bone]),actor[name]));
      return {local,attachments};
    };
    const result=[frame,...(frame.enemies||[])].map(decodeActor);
    this.cache.set(frame,result);if(this.cache.size>4)this.cache.delete(this.cache.keys().next().value);
    return result;
  }
  sample(index,next,u) {
    const a=this.frames[index],b=this.frames[next];
    if(!this.rig||!b||u<=0||index===next||this.rows[index].take!==this.rows[next].take||(a.enemies||[]).length!==(b.enemies||[]).length)return a;
    u=Math.min(u,1);
    return this.mix(a,b,u);
  }
  mix(a,b,u) {
    const aa=this.decode(a),bb=this.decode(b),actors=[a,...(a.enemies||[])],other=[b,...(b.enemies||[])];
    const results=actors.map((actor,k)=>{
      let out=this.outputs[k];
      if(!out){out={skins:actor.skins.map(p=>new Float32Array(p.length)),worlds:this.rig.skins.map(s=>s.parents.map(()=>new Float64Array(16))),local:new Float64Array(16),axe:new Float32Array(16),helmet:new Float32Array(16),track:[0,0,0]};this.outputs[k]=out;}
      out.tint=actor.tint;out.flash=(actor.flash||0)*(1-u)+(other[k].flash||0)*u;
      for(let s=0;s<aa[k].local.length;s++)for(const i of this.rig.skins[s].order){
        PosePlayback.blend(aa[k].local[s][i],bb[k].local[s][i],u,out.local);
        const parent=this.rig.skins[s].parents[i];
        if(parent<0)out.worlds[s][i].set(out.local);else PosePlayback.multiply(out.worlds[s][parent],out.local,out.worlds[s][i]);
        PosePlayback.multiply(out.worlds[s][i],this.inverses[s][i],out.skins[s].subarray(i*16,i*16+16));
      }
      for(const [name,[s,i]] of Object.entries(this.rig.attachments))if(aa[k].attachments[name]){
        PosePlayback.blend(aa[k].attachments[name],bb[k].attachments[name],u,out.local);
        PosePlayback.multiply(out.worlds[s][i],out.local,out[name]);
      }
      for(let j=0;j<3;j++)out.track[j]=(actor.track?.[j]||0)*(1-u)+(other[k].track?.[j]||0)*u;
      return out;
    });
    results[0].enemies=results.slice(1);return results[0];
  }
}
