// The cross-section and Cauchy coefficients come from CYBR LIGHT's
// examples/prism.py. This is a geometric spectral ray demonstration.
export const PRISM_SOURCE=Object.freeze({crossSection:[[-.65,-.6],[.8,0],[-.65,.6]],iorA:1.49,iorB:.014});
export const cauchyIndex=nm=>PRISM_SOURCE.iorA+PRISM_SOURCE.iorB/(nm*.001)**2;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1],cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const unit=a=>{const d=Math.hypot(...a);return a.map(v=>v/d);};
export function refract2(direction,normal,n1,n2){
  let n=normal.slice();if(dot(direction,n)>0)n=n.map(v=>-v);
  const eta=n1/n2,cos=-dot(direction,n),k=1-eta*eta*(1-cos*cos);
  if(k<0)return null;
  return unit(direction.map((v,i)=>eta*v+(eta*cos-Math.sqrt(k))*n[i]));
}
export function prismPath(nm,{incidence=60,rotation=0,detectorX=2.4}={}){
  const a=rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a),rotate=p=>[c*p[0]-s*p[1],s*p[0]+c*p[1]];
  const polygon=PRISM_SOURCE.crossSection.map(rotate),entry=rotate([-.65,0]);
  const theta=(incidence+rotation)*Math.PI/180;
  let direction=[Math.cos(theta),Math.sin(theta)],origin=entry.map((v,i)=>v-direction[i]*1.8),inside=false;
  const points=[origin.slice()],n=cauchyIndex(nm);let reflections=0,exited=false;
  for(let bounce=0;bounce<8;bounce++){
    let nearest;
    for(let i=0;i<polygon.length;i++){
      const p=polygon[i],q=polygon[(i+1)%polygon.length],edge=q.map((v,j)=>v-p[j]),d=cross(direction,edge);
      if(Math.abs(d)<1e-10)continue;
      const delta=p.map((v,j)=>v-origin[j]),t=cross(delta,edge)/d,u=cross(delta,direction)/d;
      if(t>1e-6&&u>=-1e-8&&u<=1+1e-8&&(!nearest||t<nearest.t))nearest={t,normal:unit([edge[1],-edge[0]])};
    }
    if(!nearest)break;
    const hit=origin.map((v,i)=>v+direction[i]*nearest.t);points.push(hit);
    const transmitted=refract2(direction,nearest.normal,inside?n:1,inside?1:n);
    if(transmitted){direction=transmitted;inside=!inside;if(!inside){exited=true;origin=hit;break;}}
    else{const d=dot(direction,nearest.normal);direction=direction.map((v,i)=>v-2*d*nearest.normal[i]);reflections++;}
    origin=hit.map((v,i)=>v+direction[i]*1e-5);
  }
  let detector;
  if(exited&&direction[0]>1e-6){const t=(detectorX-origin[0])/direction[0];if(t>0){detector=origin.map((v,i)=>v+direction[i]*t);points.push(detector);}}
  if(!detector)points.push(origin.map((v,i)=>v+direction[i]*1.5));
  return {nm,index:n,points,detector,reflections,exited};
}

// ORBIT's original pose_parameters: +X wrist, +Z up; dimensions in mm.
export function orbitPose(THREE,motion,{wrist=0,gap=33.8}={}){
  const theta=wrist*Math.PI/180,d=(gap-33.8)/2,local=new THREE.Matrix4();
  const pivotRotation=(axis,angle,pivot)=>new THREE.Matrix4().makeTranslation(...pivot).multiply(new THREE.Matrix4().makeRotationAxis(axis,angle)).multiply(new THREE.Matrix4().makeTranslation(...pivot.map(v=>-v)));
  if(motion==='jaw_plus'||motion==='jaw_minus')local.makeTranslation(0,motion==='jaw_plus'?d:-d,0);
  else if(motion==='leadscrew')local.copy(pivotRotation(new THREE.Vector3(0,1,0),-Math.PI*2*d/3,[60,0,70]));
  if(motion==='pinion')return pivotRotation(new THREE.Vector3(1,0,0),-theta*72/20,[0,46,70]);
  if(motion!=='fixed')return pivotRotation(new THREE.Vector3(1,0,0),theta,[0,0,70]).multiply(local);
  return local;
}
