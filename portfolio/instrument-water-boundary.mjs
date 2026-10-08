const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
/** Capture the exterior liquid boundary, never the closed bubble-void shells.
 * Native CAD duplicates vertices at face seams. Connectivity is welded only
 * for classification; all retained triangle indices and attributes stay exact.
 */
export function waterOuterBoundaryIndices(position,index,{quantizationMM=.0001}={}){
 if(!position?.array||position.itemSize!==3||!index?.array||index.itemSize!==1||index.count%3||!(quantizationMM>0)||!Number.isFinite(quantizationMM))throw Error('Invalid native water boundary');
 const requestedQuantizationMM=quantizationMM,triangleCount=index.count/3,parent=Uint32Array.from({length:triangleCount},(_,i)=>i),welded=new Uint32Array(position.count),active=new Uint8Array(triangleCount),edges=new Map();
 const find=value=>{let root=value;while(parent[root]!==root)root=parent[root];while(parent[value]!==value){const next=parent[value];parent[value]=root;value=next;}return root;};
 const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);};
 const bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
 for(let i=0;i<position.count;i++){
  const p=[position.getX(i),position.getY(i),position.getZ(i)];if(p.some(value=>!Number.isFinite(value)))throw Error('Nonfinite native water position');
  for(let axis=0;axis<3;axis++){bounds[0][axis]=Math.min(bounds[0][axis],p[axis]);bounds[1][axis]=Math.max(bounds[1][axis],p[axis]);}
 }
 let rawZeroAreaTriangles=0;
 for(let triangle=0;triangle<triangleCount;triangle++){
  const ids=[index.getX(triangle*3),index.getX(triangle*3+1),index.getX(triangle*3+2)];if(ids.some(value=>!Number.isInteger(value)||value<0||value>=position.count))throw Error('Native water index outside positions');
  const p=ids.map(i=>[position.getX(i),position.getY(i),position.getZ(i)]),a=p[1].map((v,i)=>v-p[0][i]),b=p[2].map((v,i)=>v-p[0][i]);
  // Only exactly zero-area source faces can be discarded. Small native faces
  // are real geometry; a rounded classification grid must not erase them.
  if(a[1]*b[2]-a[2]*b[1]===0&&a[2]*b[0]-a[0]*b[2]===0&&a[0]*b[1]-a[1]*b[0]===0)rawZeroAreaTriangles++;else active[triangle]=1;
 }
 let weldedDegenerateTriangles=0,quantizationRefinements=0;
 for(;;){
  const vertices=new Map();
  for(let i=0;i<position.count;i++){
   const key=[position.getX(i),position.getY(i),position.getZ(i)].map(value=>Math.round(value/quantizationMM)).join(',');let vertex=vertices.get(key);if(vertex===undefined){vertex=vertices.size;vertices.set(key,vertex);}welded[i]=vertex;
  }
  weldedDegenerateTriangles=0;
  for(let triangle=0;triangle<triangleCount;triangle++)if(active[triangle]){const a=welded[index.getX(triangle*3)],b=welded[index.getX(triangle*3+1)],c=welded[index.getX(triangle*3+2)];if(a===b||b===c||a===c)weldedDegenerateTriangles++;}
  if(!weldedDegenerateTriangles||quantizationRefinements===8)break;
  // Refining connectivity changes no source position, normal or triangle.
  // Closed-shell validation below remains mandatory before deleting cavities.
  quantizationMM*=.1;quantizationRefinements++;
 }
 for(let triangle=0;triangle<triangleCount;triangle++)if(active[triangle]){
  const w=[0,1,2].map(corner=>welded[index.getX(triangle*3+corner)]);if(w[0]===w[1]||w[1]===w[2]||w[0]===w[2])continue;
  for(let side=0;side<3;side++){const a=w[side],b=w[(side+1)%3],key=Math.min(a,b)+','+Math.max(a,b),orientation=a<b?1:-1;let edge=edges.get(key);if(!edge){edge={triangle,count:0,orientation:0};edges.set(key,edge);}else join(triangle,edge.triangle);edge.count++;edge.orientation+=orientation;}
 }
 const center=bounds[0].map((value,axis)=>(value+bounds[1][axis])*.5),components=new Map();
 for(let triangle=0;triangle<triangleCount;triangle++)if(active[triangle]){
  const root=find(triangle);let component=components.get(root);if(!component){component={root,triangles:0,signedVolumeMM3:0,closed:true};components.set(root,component);}component.triangles++;
  const p=[0,1,2].map(corner=>{const i=index.getX(triangle*3+corner);return[position.getX(i)-center[0],position.getY(i)-center[1],position.getZ(i)-center[2]];});
  component.signedVolumeMM3+=dot(p[0],[p[1][1]*p[2][2]-p[1][2]*p[2][1],p[1][2]*p[2][0]-p[1][0]*p[2][2],p[1][0]*p[2][1]-p[1][1]*p[2][0]])/6;
 }
 for(const edge of edges.values())if(edge.count!==2||edge.orientation!==0)components.get(find(edge.triangle)).closed=false;
 const volumeTolerance=Math.max(1e-10,Math.hypot(...bounds[1].map((value,axis)=>value-bounds[0][axis]))**3*1e-12),list=[...components.values()],outer=list.filter(component=>component.signedVolumeMM3>volumeTolerance),cavities=list.filter(component=>component.signedVolumeMM3 < -volumeTolerance);
 const validated=weldedDegenerateTriangles===0&&list.every(component=>component.closed&&Math.abs(component.signedVolumeMM3)>volumeTolerance)&&outer.length>0;
 const removed=validated?new Set(cavities.map(component=>component.root)):new Set(),kept=[];
 const filtered=validated&&(removed.size>0||rawZeroAreaTriangles>0);
 if(filtered)for(let triangle=0;triangle<triangleCount;triangle++)if(active[triangle]&&!removed.has(find(triangle)))kept.push(index.getX(triangle*3),index.getX(triangle*3+1),index.getX(triangle*3+2));
 const indices=filtered?new index.array.constructor(kept):index.array;
 return{indices,audit:{method:'Adaptive seam connectivity preserving nonzero native faces and signed closed-shell volume; positive exterior shells only',requestedQuantizationMM,quantizationMM,quantizationRefinements,rawZeroAreaTriangles,discardedZeroAreaTriangles:validated?rawZeroAreaTriangles:0,weldedDegenerateTriangles,validated,reason:validated?'closed consistently oriented components':weldedDegenerateTriangles?'welded degenerate triangle':'open, nonmanifold or ambiguously oriented component',componentCount:list.length,outerComponents:outer.length,cavityComponents:cavities.length,removedCavities:removed.size,sourceTriangles:triangleCount,fieldTriangles:indices.length/3,componentDetailsTruncated:list.length>32,components:list.slice(0,32).map(({triangles,signedVolumeMM3,closed})=>({triangles,signedVolumeMM3,closed,kind:signedVolumeMM3>volumeTolerance?'exterior':signedVolumeMM3 < -volumeTolerance?'cavity':'ambiguous'}))}};
}
