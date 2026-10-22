// The binary source describes triangles with size=3; GPU index attributes
// nevertheless have one scalar per element, unlike positions and normals.
export function sourceGeometry(T,bytes,record){
 const geometry=new T.BufferGeometry();
 for(const [key,name] of Object.entries({position:'position',normal:'normal',color:'color',roughness:'surfaceRoughness',uv:'uv',joints:'skinIndex',weights:'skinWeight',index:'index'})){
  const d=record[key];if(!d)continue;
  const ArrayType=key==='index'?(d.componentType==='uint16'?Uint16Array:Uint32Array):Float32Array;
  const values=new ArrayType(bytes,d.offset,d.count);
  const attribute=new T.BufferAttribute(values,key==='index'?1:d.size);
  if(key==='index')geometry.setIndex(attribute);else geometry.setAttribute(name,attribute);
 }
 if(record.bounds){geometry.boundingBox=new T.Box3(new T.Vector3(...record.bounds.min),new T.Vector3(...record.bounds.max));geometry.boundingSphere=geometry.boundingBox.getBoundingSphere(new T.Sphere());}
 else geometry.computeBoundingSphere();return geometry;
}
