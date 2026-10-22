import {createPrintStrokes} from './print-strokes.mjs';
// Reusable live technical drawing for CYBR GEO browser geometry.
// CAD curves + camera-dependent silhouettes; depth-tested, no triangle wireframe.
export function silhouetteGeometry(T,geometry){
 const p=geometry.attributes.position,index=geometry.index,edges=new Map(),v=[new T.Vector3(),new T.Vector3(),new T.Vector3()];
 const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*1e5)).join(',');
 for(let f=0;f<(index?index.count:p.count);f+=3){
  const ids=[0,1,2].map(k=>index?index.getX(f+k):f+k);ids.forEach((id,k)=>v[k].fromBufferAttribute(p,id));
  const n=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize().toArray();
  for(let k=0;k<3;k++){const a=ids[k],b=ids[(k+1)%3],ka=key(a),kb=key(b);if(ka===kb)continue;const id=ka<kb?ka+'|'+kb:kb+'|'+ka;
   const e=edges.get(id);if(e)e.normals.push(n);else edges.set(id,{a,b,normals:[n]});}
 }
 const positions=[],normalA=[],normalB=[];let nonManifold=0;
 for(const e of edges.values()){
  if(e.normals.length>2){nonManifold++;continue;} // Never silently invent a silhouette at invalid topology.
  for(const id of [e.a,e.b]){positions.push(p.getX(id),p.getY(id),p.getZ(id));normalA.push(...e.normals[0]);normalB.push(...(e.normals[1]||e.normals[0].map(x=>-x)));}
 }
 const out=new T.BufferGeometry();out.setAttribute('position',new T.Float32BufferAttribute(positions,3));out.setAttribute('faceA',new T.Float32BufferAttribute(normalA,3));out.setAttribute('faceB',new T.Float32BufferAttribute(normalB,3));out.userData.nonManifoldEdges=nonManifold;return out;
}

export function createWhiteprint(T,source,{color=0x454942,opacity=.85,strokeWidth=1}={}){
 const root=new T.Group(),pairs=[],cache=new Map();root.name='CYBR GEO / live whiteprint';
 const depth=new T.MeshBasicMaterial({colorWrite:false,depthWrite:true,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
 const lines=new T.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false});
 const silhouettes=new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{ink:{value:new T.Color(color)},alpha:{value:opacity}},vertexShader:`attribute vec3 faceA;attribute vec3 faceB;
 void main(){vec4 p=modelViewMatrix*vec4(position,1.);float a=dot(normalMatrix*faceA,vec3(0,0,1));float b=dot(normalMatrix*faceB,vec3(0,0,1));gl_Position=projectionMatrix*p;if(a*b>=0.)gl_Position=vec4(2.,2.,2.,1.);}`,fragmentShader:'uniform vec3 ink;uniform float alpha;void main(){gl_FragColor=vec4(ink,alpha);}'});
 // Batch only when the assembly explicitly declares every mutable transform.
 // Unspecified consumers retain per-mesh tracking instead of silently freezing motion.
 const declared=source.userData.whiteprintMotionRoots;
 const buckets=new Map(),dynamic=new Set(declared||[]);let partCount=0;
 source.updateWorldMatrix(true,true);
 source.traverse(mesh=>{
  if(!mesh.isMesh)return;partCount++;
  if(!mesh.geometry.userData.cadEdges)throw Error('Whiteprint requires exported CAD edges: '+mesh.name);
  let anchor=mesh;
  if(declared){anchor=source;for(let p=mesh;p&&p!==source;p=p.parent)if(dynamic.has(p)){anchor=p;break;}}
  if(!buckets.has(anchor))buckets.set(anchor,[]);buckets.get(anchor).push(mesh);
 });
 const owned=[],strokeMaterials=[];
 for(const [anchor,meshes] of buckets){
  const positions=[],indices=[],edgePositions=[],silhouettePositions=[],faceA=[],faceB=[];
  const inv=new T.Matrix4().copy(anchor.matrixWorld).invert(),matrix=new T.Matrix4(),normal=new T.Matrix3(),v=new T.Vector3();
  for(const mesh of meshes){
   const g=mesh.geometry;matrix.multiplyMatrices(inv,mesh.matrixWorld);normal.getNormalMatrix(matrix);
   const offset=positions.length/3,p=g.attributes.position;
   for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(matrix);positions.push(...v);}
   for(let i=0;i<(g.index?g.index.count:p.count);i++)indices.push(offset+(g.index?g.index.getX(i):i));
   if(mesh.userData.whiteprintEdges!==false)for(const path of g.userData.cadEdges)for(let i=1;i<path.length;i++)for(const point of [path[i-1],path[i]]){v.fromArray(point).applyMatrix4(matrix);edgePositions.push(...v);}
   if(!cache.has(g))cache.set(g,silhouetteGeometry(T,g));const s=cache.get(g);
   for(let i=0;mesh.userData.whiteprintEdges!==false&&i<s.attributes.position.count;i++){
    v.fromBufferAttribute(s.attributes.position,i).applyMatrix4(matrix);silhouettePositions.push(...v);
    v.fromBufferAttribute(s.attributes.faceA,i).applyMatrix3(normal).normalize();faceA.push(...v);
    v.fromBufferAttribute(s.attributes.faceB,i).applyMatrix3(normal).normalize();faceB.push(...v);
   }
  }
  const fill=new T.BufferGeometry(),edges=new T.BufferGeometry(),silhouette=new T.BufferGeometry();
  fill.setAttribute('position',new T.Float32BufferAttribute(positions,3));fill.setIndex(indices);
  edges.setAttribute('position',new T.Float32BufferAttribute(edgePositions,3));
  silhouette.setAttribute('position',new T.Float32BufferAttribute(silhouettePositions,3));silhouette.setAttribute('faceA',new T.Float32BufferAttribute(faceA,3));silhouette.setAttribute('faceB',new T.Float32BufferAttribute(faceB,3));
  owned.push(fill,edges,silhouette);
  const group=new T.Group();group.matrixAutoUpdate=false;
  const stroke=strokeWidth>1?createPrintStrokes(T,edgePositions,{color,width:strokeWidth,opacity}):null;
  if(stroke){owned.push(stroke.geometry);strokeMaterials.push(stroke.material);}
  const mask=new T.Mesh(fill,depth),edge=stroke?.mesh||new T.LineSegments(edges,lines),outline=new T.LineSegments(silhouette,silhouettes);mask.renderOrder=-2;edge.renderOrder=2;outline.renderOrder=2;
  group.add(mask,edge,outline);root.add(group);pairs.push({anchor,group});
 }
 const nonManifoldEdges=[...cache.values()].reduce((n,g)=>n+g.userData.nonManifoldEdges,0);for(const g of cache.values())g.dispose();
 const inverse=new T.Matrix4();
 return {root,stats:{parts:partCount,batches:pairs.length,uniqueGeometries:cache.size,nonManifoldEdges},
  update(alpha=1){root.visible=alpha>.001;lines.opacity=opacity*alpha;silhouettes.uniforms.alpha.value=opacity*alpha;for(const m of strokeMaterials)m.uniforms.alpha.value=opacity*alpha;if(!root.visible)return;
   root.updateWorldMatrix(true,false);inverse.copy(root.matrixWorld).invert();source.updateWorldMatrix(true,true);
   for(const {anchor,group} of pairs)group.matrix.multiplyMatrices(inverse,anchor.matrixWorld);
  },dispose(){owned.forEach(g=>g.dispose());strokeMaterials.forEach(m=>m.dispose());depth.dispose();lines.dispose();silhouettes.dispose();}};
}
