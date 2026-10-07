// Independent topology, orientation and volume measurements of emitted buffers.
export function auditTubeMesh(cable){
  const p=cable.positions,n=cable.normals,index=cable.geometry.index.array,welded=new Map(),vertex=[];
  for(let i=0;i<p.length;i+=3){const key=[p[i],p[i+1],p[i+2]].map(v=>Math.round(v*1e5)).join(',');if(!welded.has(key))welded.set(key,welded.size);vertex.push(welded.get(key));}
  const edges=new Map();let volume=0,minNormalDot=Infinity,degenerate=0;
  for(let i=0;i<index.length;i+=3){
    const ids=[index[i],index[i+1],index[i+2]],v=ids.map(k=>[p[k*3],p[k*3+1],p[k*3+2]]);
    const a=v[1].map((x,j)=>x-v[0][j]),b=v[2].map((x,j)=>x-v[0][j]);
    const face=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],area2=Math.hypot(...face);
    if(area2<1e-10)degenerate++;
    else{
      const normal=[0,1,2].map(j=>ids.reduce((s,k)=>s+n[k*3+j],0)),scale=area2*Math.hypot(...normal);
      minNormalDot=Math.min(minNormalDot,face.reduce((s,x,j)=>s+x*normal[j],0)/scale);
    }
    volume+=(v[0][0]*(v[1][1]*v[2][2]-v[1][2]*v[2][1])+v[0][1]*(v[1][2]*v[2][0]-v[1][0]*v[2][2])+v[0][2]*(v[1][0]*v[2][1]-v[1][1]*v[2][0]))/6;
    for(let j=0;j<3;j++){
      const from=vertex[ids[j]],to=vertex[ids[(j+1)%3]],key=Math.min(from,to)+','+Math.max(from,to),record=edges.get(key)||{count:0,balance:0};
      record.count++;record.balance+=from<to?1:-1;edges.set(key,record);
    }
  }
  const badEdges=[...edges.values()].filter(e=>e.count!==2||e.balance!==0).length;
  return {passed:badEdges===0&&degenerate===0&&volume>0&&minNormalDot>.9,
    weldedVertices:welded.size,triangles:index.length/3,badEdges,degenerateTriangles:degenerate,signedVolumeMM3:volume,minimumFaceNormalAgreement:minNormalDot};
}
