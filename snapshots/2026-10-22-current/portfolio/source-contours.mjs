// Intersect the actual source triangles with horizontal datum planes.
// This is a drawing of the landscape, not invented decorative terrain.
export function contourSegments(positions,indices,levels){
 const out=[];
 for(let i=0;i<indices.length;i+=3){
  const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
  const lo=Math.min(positions[a+1],positions[b+1],positions[c+1]),hi=Math.max(positions[a+1],positions[b+1],positions[c+1]);
  for(const y of levels){if(y<lo||y>=hi)continue;const hits=[];
   for(const [j,k] of [[a,b],[b,c],[c,a]]){const v=positions[j+1],w=positions[k+1];if((v<=y&&w>y)||(w<=y&&v>y)){const t=(y-v)/(w-v);hits.push(positions[j]+t*(positions[k]-positions[j]),y,positions[j+2]+t*(positions[k+2]-positions[j+2]));}}
   if(hits.length===6)out.push(...hits);
  }
 }
 return new Float32Array(out);
}
