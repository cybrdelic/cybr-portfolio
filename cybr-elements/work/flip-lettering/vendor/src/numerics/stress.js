/** Symmetric-strain backward-Euler viscosity on a staggered MAC grid.
 * Minimizes 1/2 ||u-u*||_M^2 + nu*dt ||sym(grad u)||^2 over free faces.
 * Rows explicitly couple u,v,w through off-diagonal strains. Dirichlet wall
 * values enter the right-hand side. Liquid-volume weights approximate the
 * free surface. Pressure is still a separate projection (not a unified Stokes
 * saddle-point solver); this distinction is exposed in diagnostics.
 */
import {pcg} from './multigrid.js';
export class SymmetricStressSystem {
  constructor(sim,dt) {
    const {len,sx,sy,h,nx,ny,nz,kind,solid}=sim;
    this.sim=sim;this.ids=[];this.faceMap=new Int32Array(len*3);this.faceMap.fill(-1);
    this.fixed=new Float64Array(len*3);this.mass=[];
    for(let c=0;c<3;c++) {
      const off=[sx,sy,1][c];
      for(let i=1;i<nx;i++)for(let j=1;j<ny;j++)for(let k=1;k<nz;k++) {
        const q=sim.index(i,j,k),id=c*len+q;
        if(solid[q]||solid[q-off]){this.fixed[id]=sim.u[c][q];continue;}
        if(kind[q]===1||kind[q-off]===1) {
          this.faceMap[id]=this.ids.length;this.ids.push(id);
          this.mass.push(.5*((kind[q]===1?1:0)+(kind[q-off]===1?1:0)));
        }
      }
    }
    this.n=this.ids.length;this.mass=new Float64Array(this.mass);
    const a=[],co=[],weight=[],constant=[],offset=[0];
    const add=(faces,coeff,strength)=>{
      const terms=[];let fixed=0;
      for(let j=0;j<faces.length;j++) {
        const f=faces[j],index=this.faceMap[f];
        if(index>=0)terms.push([index,coeff[j]]);
        else {
          // A strain touching unsupported air faces is omitted, not tied to
          // stationary imaginary air. The liquid-side mass remains positive.
          const component=Math.floor(f/len),q=f-component*len,off=[sx,sy,1][component];
          if(q<0||q>=len||(!solid[q]&&!solid[q-off]))return;
          fixed+=coeff[j]*this.fixed[f];
        }
      }
      if(!terms.length)return;
      for(const [id,c] of terms){a.push(id);co.push(c);}
      weight.push(strength);constant.push(fixed);offset.push(a.length);
    };
    // Diagonal strains at cell centres: twice their squared derivative.
    const alpha=sim.nu*dt/(h*h);
    for(let t=0;t<sim.nActive;t++) {
      const q=sim.active[t];
      add([q+sx,q],[1,-1],2*alpha);
      add([len+q+sy,len+q],[1,-1],2*alpha);
      add([2*len+q+1,2*len+q],[1,-1],2*alpha);
    }
    // Shear strains at edge centres; each row is du/dy + dv/dx, etc.
    for(let i=1;i<nx;i++)for(let j=1;j<ny;j++)for(let k=1;k<nz;k++) {
      const q=sim.index(i,j,k);
      const xy=.25*((kind[q]===1)+(kind[q-sx]===1)+(kind[q-sy]===1)+(kind[q-sx-sy]===1));
      const xz=.25*((kind[q]===1)+(kind[q-sx]===1)+(kind[q-1]===1)+(kind[q-sx-1]===1));
      const yz=.25*((kind[q]===1)+(kind[q-sy]===1)+(kind[q-1]===1)+(kind[q-sy-1]===1));
      if(xy)add([q,q-sy,len+q,len+q-sx],[1,-1,1,-1],alpha*xy);
      if(xz)add([q,q-1,2*len+q,2*len+q-sx],[1,-1,1,-1],alpha*xz);
      if(yz)add([len+q,len+q-1,2*len+q,2*len+q-sy],[1,-1,1,-1],alpha*yz);
    }
    this.row=new Int32Array(offset);this.column=new Int32Array(a);this.coefficient=new Float64Array(co);
    this.weight=new Float64Array(weight);this.constant=new Float64Array(constant);
    this.diagonal=this.mass.slice();this.b=new Float64Array(this.n);this.x=new Float64Array(this.n);
    for(let i=0;i<this.n;i++) {
      const id=this.ids[i],c=Math.floor(id/len);this.x[i]=sim.u[c][id-c*len];this.b[i]=this.mass[i]*this.x[i];
    }
    for(let r=0;r<weight.length;r++)for(let e=this.row[r];e<this.row[r+1];e++) {
      const j=this.column[e],c=this.coefficient[e],w=this.weight[r];
      this.diagonal[j]+=w*c*c;this.b[j]-=w*c*this.constant[r];
    }
  }
  apply(x,y) {
    for(let i=0;i<this.n;i++)y[i]=this.mass[i]*x[i];
    for(let r=0;r<this.weight.length;r++) {
      let s=0;for(let e=this.row[r];e<this.row[r+1];e++)s+=this.coefficient[e]*x[this.column[e]];
      s*=this.weight[r];
      for(let e=this.row[r];e<this.row[r+1];e++)y[this.column[e]]+=this.coefficient[e]*s;
    }
    return y;
  }
  strainEnergy(x) {
    let s=0;for(let r=0;r<this.weight.length;r++) {
      let value=this.constant[r];
      for(let e=this.row[r];e<this.row[r+1];e++)value+=this.coefficient[e]*x[this.column[e]];
      s+=this.weight[r]*value*value;
    }return .5*s;
  }
  solve() {
    const before=this.strainEnergy(this.x),kinetic=x=>x.reduce((s,v,i)=>s+.5*this.mass[i]*v*v,0),energyBefore=kinetic(this.x);
    const report=pcg(this,this.b,this.x,(r,z)=>{for(let i=0;i<this.n;i++)z[i]=r[i]/this.diagonal[i];},
      {relativeTolerance:this.sim.config.viscosityTolerance??2e-6,maxIterations:320});
    for(let i=0;i<this.n;i++) {
      const id=this.ids[i],c=Math.floor(id/this.sim.len);this.sim.u[c][id-c*this.sim.len]=this.x[i];
    }
    return {method:'coupled symmetric-strain backward Euler; split pressure',...report,unknownFaces:this.n,
      strainRows:this.weight.length,strainBefore:before,strainAfter:this.strainEnergy(this.x),energyBefore,energyAfter:kinetic(this.x)};
  }
}
