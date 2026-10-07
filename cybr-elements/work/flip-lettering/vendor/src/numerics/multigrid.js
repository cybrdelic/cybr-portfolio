/** Galerkin aggregation multigrid for symmetric M-matrices.
 * R=P^T; piecewise-constant prolongation; A_c=P^T A P. Aggregates never
 * join disconnected vertices merely because they occupy the same spatial box.
 * Symmetric damped-Jacobi pre/post smoothing makes the V-cycle usable by PCG.
 * This CPU reference is not described as a GPU or SPGrid implementation.
 */
export class CSRMatrix {
  constructor(diagonal, row, column, weight, coordinates=null) {
    this.n=diagonal.length; this.diagonal=diagonal; this.row=row;
    this.column=column; this.weight=weight; this.coordinates=coordinates;
  }
  apply(x,y) {
    for(let i=0;i<this.n;i++) {
      let a=this.diagonal[i]*x[i];
      for(let e=this.row[i];e<this.row[i+1];e++) a-=this.weight[e]*x[this.column[e]];
      y[i]=a;
    }
    return y;
  }
  static fromMAC(sim) {
    const n=sim.nActive, map=new Int32Array(sim.len); map.fill(-1);
    const diagonal=new Float64Array(n), coordinates=new Int32Array(n*3);
    for(let a=0;a<n;a++) {
      const q=sim.active[a]; map[q]=a; diagonal[a]=sim.diag[q];
      const i=Math.floor(q/sim.sx),r=q-i*sim.sx,j=Math.floor(r/sim.sy);
      coordinates.set([i,j,r-j*sim.sy],a*3);
    }
    const row=new Int32Array(n+1),column=new Int32Array(n*6),weight=new Float64Array(n*6);
    const offsets=[-sim.sx,sim.sx,-sim.sy,sim.sy,-1,1];let e=0;
    for(let a=0;a<n;a++) {
      row[a]=e; const q=sim.active[a];
      for(const off of offsets) if(map[q+off]>=0) {column[e]=map[q+off];weight[e++]=1;}
    }
    row[n]=e;
    return new CSRMatrix(diagonal,row,column.subarray(0,e),weight.subarray(0,e),coordinates);
  }
}
function aggregate(matrix) {
  const {n,coordinates:xyz,row,column,weight}=matrix;
  const parent=new Int32Array(n);parent.fill(-1);
  const cell=Array.from({length:n},(_,i)=>`${xyz[i*3]>>1},${xyz[i*3+1]>>1},${xyz[i*3+2]>>1}`);
  const queue=new Int32Array(n),coarseXYZ=[];let count=0;
  for(let i=0;i<n;i++) if(parent[i]<0) {
    let a=0,b=1;queue[0]=i;parent[i]=count;
    coarseXYZ.push(xyz[i*3]>>1,xyz[i*3+1]>>1,xyz[i*3+2]>>1);
    while(a<b) {
      const v=queue[a++];
      for(let e=row[v];e<row[v+1];e++) {
        const j=column[e];
        if(parent[j]<0&&cell[j]===cell[i]) {parent[j]=count;queue[b++]=j;}
      }
    }
    count++;
  }
  if(count>=n*.90) return null;
  const diagonal=new Float64Array(count),links=Array.from({length:count},()=>new Map());
  for(let i=0;i<n;i++) {
    const I=parent[i];diagonal[I]+=matrix.diagonal[i];
    for(let e=row[i];e<row[i+1];e++) {
      const J=parent[column[e]],v=weight[e];
      if(I===J) diagonal[I]-=v;
      else links[I].set(J,(links[I].get(J)||0)+v);
    }
  }
  const crow=new Int32Array(count+1);let total=0;
  for(let I=0;I<count;I++) {crow[I]=total;total+=links[I].size;}crow[count]=total;
  const col=new Int32Array(total),val=new Float64Array(total);let k=0;
  for(let I=0;I<count;I++) {
    diagonal[I]=Math.max(diagonal[I],1e-12);
    for(const [J,v] of [...links[I]].sort((a,b)=>a[0]-b[0])) {col[k]=J;val[k++]=v;}
  }
  return {parent,matrix:new CSRMatrix(diagonal,crow,col,val,new Int32Array(coarseXYZ))};
}
function cholesky(matrix) {
  const {n,row,column,weight}=matrix,L=new Float64Array(n*n);
  for(let i=0;i<n;i++) {
    L[i*n+i]=matrix.diagonal[i];
    for(let e=row[i];e<row[i+1];e++) L[i*n+column[e]]=-weight[e];
  }
  for(let i=0;i<n;i++) for(let j=0;j<=i;j++) {
    let d=L[i*n+j];for(let k=0;k<j;k++)d-=L[i*n+k]*L[j*n+k];
    if(i===j) {
      if(d<=0||!Number.isFinite(d))return null;
      L[i*n+j]=Math.sqrt(d);
    } else L[i*n+j]=d/L[j*n+j];
  }
  return L;
}
export class GalerkinMultigrid {
  constructor(matrix,{maxLevels=8,smoothing=2,omega=.65}={}) {
    this.smoothing=smoothing;this.omega=omega;this.levels=[];
    for(let depth=0;depth<maxLevels;depth++) {
      const level={matrix,x:new Float64Array(matrix.n),b:new Float64Array(matrix.n),
        residual:new Float64Array(matrix.n),scratch:new Float64Array(matrix.n)};
      this.levels.push(level);
      if(matrix.n<=72) {level.factor=cholesky(matrix);break;}
      const c=aggregate(matrix);if(!c)break;
      level.parent=c.parent;matrix=c.matrix;
    }
  }
  smooth(level,steps) {
    const {matrix:m,x,b,scratch}=level;
    for(let pass=0;pass<steps;pass++) {
      m.apply(x,scratch);
      for(let i=0;i<m.n;i++) x[i]+=this.omega*(b[i]-scratch[i])/m.diagonal[i];
    }
  }
  cycle(index) {
    const level=this.levels[index],{matrix:m,x,b}=level;
    if(index===this.levels.length-1) {
      if(level.factor) {
        const L=level.factor,n=m.n;
        for(let i=0;i<n;i++){let s=b[i];for(let j=0;j<i;j++)s-=L[i*n+j]*x[j];x[i]=s/L[i*n+i];}
        for(let i=n-1;i>=0;i--){let s=x[i];for(let j=i+1;j<n;j++)s-=L[j*n+i]*x[j];x[i]=s/L[i*n+i];}
      } else this.smooth(level,32);
      return;
    }
    this.smooth(level,this.smoothing);
    const next=this.levels[index+1],parent=level.parent;
    m.apply(x,level.residual);next.b.fill(0);next.x.fill(0);
    for(let i=0;i<m.n;i++)next.b[parent[i]]+=b[i]-level.residual[i];
    this.cycle(index+1);
    for(let i=0;i<m.n;i++)x[i]+=next.x[parent[i]];
    this.smooth(level,this.smoothing);
  }
  apply(r,z) {
    const fine=this.levels[0];fine.b.set(r);fine.x.fill(0);this.cycle(0);z.set(fine.x);return z;
  }
  get sizes(){return this.levels.map(l=>l.matrix.n);}
}
/** Reliable-residual PCG. Stops only after an independently recomputed b-Ax
 * satisfies the requested tolerance. Failed solves are returned, not hidden.
 */
export function pcg(matrix,b,x,precondition,{relativeTolerance=1e-6,absoluteTolerance=1e-11,maxIterations=240}={}) {
  const n=b.length,r=new Float64Array(n),z=new Float64Array(n),d=new Float64Array(n),ad=new Float64Array(n);
  let b2=0;for(let i=0;i<n;i++)b2+=b[i]*b[i];
  const tolerance=Math.max(absoluteTolerance,relativeTolerance*Math.sqrt(b2));
  const residual=()=>{matrix.apply(x,ad);let s=0;for(let i=0;i<n;i++){r[i]=b[i]-ad[i];s+=r[i]*r[i];}return Math.sqrt(s);};
  let error=residual(),iterations=0,restarts=0,rz=0;
  const restart=()=>{precondition(r,z);rz=0;for(let i=0;i<n;i++){d[i]=z[i];rz+=r[i]*z[i];}};
  if(error>tolerance)restart();
  for(;iterations<maxIterations&&error>tolerance;) {
    matrix.apply(d,ad);let curvature=0;for(let i=0;i<n;i++)curvature+=d[i]*ad[i];
    if(!(curvature>1e-300&&rz>=0))break;
    const alpha=rz/curvature;let r2=0;
    for(let i=0;i<n;i++){x[i]+=alpha*d[i];r[i]-=alpha*ad[i];r2+=r[i]*r[i];}
    iterations++;error=Math.sqrt(r2);
    if(error<=tolerance||iterations%48===0) {
      error=residual();
      if(error<=tolerance)break;
      restart();restarts++;continue;
    }
    precondition(r,z);let next=0;for(let i=0;i<n;i++)next+=r[i]*z[i];
    const beta=next/Math.max(rz,1e-300);rz=next;
    for(let i=0;i<n;i++)d[i]=z[i]+beta*d[i];
  }
  error=residual();
  return {iterations,restarts,residual:error,relativeResidual:error/Math.max(Math.sqrt(b2),1e-30),
    initialResidual:Math.sqrt(b2),tolerance,converged:error<=tolerance};
}
