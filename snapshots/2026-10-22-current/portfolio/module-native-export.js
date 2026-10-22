// Export visible real meshes to disk for CYBR LIGHT, never a screenshot bake.
export function exportNative(root,{excludeRoots=[],filename='combat-native-source.json',source='current Combat workshop visible geometry',metadata={}}={}){
  root.updateMatrixWorld(true);const meshes=[],routes=[];
  root.traverseVisible(o=>{
    if(!o.isMesh)return;
    for(let p=o;p;p=p.parent)if(excludeRoots.includes(p))return;
    if(o.userData.routePoints)routes.push({points:o.userData.routePoints,world:o.matrixWorld.toArray(),radius:o.geometry.parameters.radius,trunkRadius:o.userData.trunkRadius});
    const m=o.material,g=o.geometry;
    if(m.isShaderMaterial||m.map)throw Error('Native reference exporter requires explicit untextured materials; refusing silent loss.');
    meshes.push({name:o.name,world:o.matrixWorld.toArray(),position:Array.from(g.attributes.position.array),normal:Array.from(g.attributes.normal.array),uv:g.attributes.uv?Array.from(g.attributes.uv.array):null,index:g.index?Array.from(g.index.array):null,material:{color:m.color.toArray(),metalness:m.metalness||0,roughness:m.roughness??.6,...(m.transmission?{nativeType:'glass',transmission:m.transmission,ior:m.ior,thickness:m.thickness,attenuationColor:m.attenuationColor.toArray(),attenuationDistance:m.attenuationDistance}: {})}});
  });
  const doc={version:3,source,meshes,routes,...metadata};
  const url=URL.createObjectURL(new Blob([JSON.stringify(doc)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  return {meshes:meshes.length,vertices:meshes.reduce((n,m)=>n+m.position.length/3,0)};
}
