// Retain the landscape surface, water and routed service connections. Replace
// the display vessel/carrier and reshape its low skirt into a mounted cut-core.
export function specimenIndices(record, indices) {
  if(record.module!=='scenes'||record.material>=20||record.material===14)return indices;
  const keep=(record.partRanges||[]).filter(p=>/grounded_saddle_chassis|entry_|exit_/.test(p.name));
  const output=new indices.constructor(keep.reduce((n,p)=>n+p.indexCount,0));
  let offset=0;
  for(const p of keep){output.set(indices.subarray(p.firstIndex,p.firstIndex+p.indexCount),offset);offset+=p.indexCount;}
  return output;
}

export const SPECIMEN_SUPPORTS=[[-24,-12],[24,-12],[0,23]];

// Change only the manufactured skirt below the landscape. Surface, basin,
// rocks and foliage retain their original coordinates.
export function specimenPositions(record, source) {
  if(record.module!=='scenes'||record.material!==20)return source;
  const part=record.partRanges?.find(p=>p.name.endsWith('Closed_terrain_and_basin'));
  if(!part)return source;
  const result=source.slice();
  for(let i=part.firstVertex;i<part.firstVertex+part.vertexCount;i++){
    const k=i*3,x=source[k],y=source[k+1],z=source[k+2],r=Math.hypot(x,y);
    if(z>=-10||r<30)continue;
    const angle=Math.atan2(y,x),sector=Math.PI/6;
    const facet=Math.cos(Math.PI/12)/Math.cos(((angle+Math.PI*2+sector/2)%sector)-sector/2);
    const radius=30.5*facet;
    result[k]=x*radius/r;result[k+1]=y*radius/r;result[k+2]=-18;
  }
  return result;
}

export function specimenSurfaceGroups(record, indices, positions) {
  const part=record.partRanges?.find(p=>p.name.endsWith('Closed_terrain_and_basin'));
  const surface=[],cut=[];
  for(let j=0;j<indices.length;j+=3){
    const ids=[indices[j],indices[j+1],indices[j+2]];
    const skirt=part&&j>=part.firstIndex&&j<part.firstIndex+part.indexCount&&ids.some(i=>positions[i*3+2]<-10&&Math.hypot(positions[i*3],positions[i*3+1])>28);
    (skirt?cut:surface).push(...ids);
  }
  const output=new indices.constructor(indices.length);output.set(surface);output.set(cut,surface.length);
  return {indices:output,surfaceCount:surface.length,cutCount:cut.length};
}

export function createScenesSpecimen(THREE,{group,objects,materials}) {
  const owned=[];
  const rock=new THREE.MeshStandardMaterial({color:0x514a41,roughness:.88,metalness:0});
  const metal=new THREE.MeshStandardMaterial({color:0x717a80,roughness:.3,metalness:.85});
  const pad=new THREE.MeshStandardMaterial({color:0x252a29,roughness:.7,metalness:0});
  materials.push(rock,metal,pad);
  function add(geometry,material,name){
    const object=new THREE.Mesh(geometry,material);object.name='scenes/specimen/'+name;
    object.userData.meshRecord={module:'scenes',feature:name,material:material===metal?10:20,motion:{kind:'static'}};
    geometry.computeBoundingBox();geometry.computeBoundingSphere();group.add(object);objects.push(object);owned.push(geometry);return object;
  }
  // A single underside closes the tapered source skirt, without stacked plinths.
  const core=new THREE.CylinderGeometry(30.5,27,2,12,1);
  core.rotateX(Math.PI/2);core.translate(0,0,-18);
  add(core,rock,'fractured-underside');
  function bar(a,b,r,material,name){
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),axis=end.clone().sub(start);
    const geometry=new THREE.CylinderGeometry(r,r,axis.length(),12,1);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis.normalize()));
    const center=start.add(end).multiplyScalar(.5);geometry.translate(center.x,center.y,center.z);add(geometry,material,name);
  }
  SPECIMEN_SUPPORTS.forEach(([x,y],i)=>{
    bar([x*.72,y*.45,-28],[x,y,-22],1.2,metal,'survey-arm-'+i);
    bar([x,y,-23],[x,y,-19.5],2,metal,'adjuster-'+i);
    bar([x,y,-19.6],[x,y,-18.5],2.7,pad,'contact-pad-'+i);
  });
  return {snapshot:()=>({design:'exposed-geological-specimen',sourceLandscapeSurfaceUnchanged:true,sourceWaterUnchanged:true,supports:3,addedDraws:owned.length,triangles:owned.reduce((n,g)=>n+(g.index?g.index.count:g.attributes.position.count)/3,0)}),dispose(){owned.forEach(g=>g.dispose());}};
}
