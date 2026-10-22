// Foreground rock, not an image mask: a shallow, irregular cave mouth.
// Its framing follows the presentation camera; distant terrain remains 3D.
export function createEventCave(T){
 const group=new T.Group(),p=[],uv=[],indices=[],segments=224,rings=32;
 for(let r=0;r<=rings;r++)for(let i=0;i<=segments;i++){
  const a=i/segments*Math.PI*2,t=r/rings;
  const lip=1+.06*Math.sin(a*5+.8)+.035*Math.sin(a*11)+.018*Math.sin(a*23);
  const radius=lip+t*1.1;
  const relief=(.06*Math.sin(a*11+t*7)+.035*Math.sin(a*23-t*13)+.018*Math.sin(a*41+t*23))*(.3+.7*Math.sin(t*Math.PI));
  p.push(Math.cos(a)*radius+.14,Math.sin(a)*radius,-.2-t*.65+relief);
  uv.push(i/segments*8,t*4);
  if(r<rings&&i<segments){const q=r*(segments+1)+i;indices.push(q,q+1,q+segments+1,q+1,q+segments+2,q+segments+1);}
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(p,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();
 const material=new T.MeshStandardMaterial({color:0x76200e,roughness:.93,side:T.DoubleSide});
 const mesh=new T.Mesh(geometry,material);group.add(mesh);group.visible=false;
 const forward=new T.Vector3(),anchor=new T.Vector3();let mapped=false;
 return {group,update(camera,terrain){
  camera.getWorldDirection(forward);anchor.copy(camera.position).addScaledVector(forward,1.5);
  group.position.copy(anchor);group.quaternion.copy(camera.quaternion);
  const h=Math.tan(T.MathUtils.degToRad(camera.fov/2))*1.8;
  group.scale.set(h*camera.aspect*.88,h*.94,1);
  if(!mapped){const source=terrain?.children.find(o=>o.material?.normalMap)?.material;if(source){material.normalMap=source.normalMap;material.normalScale.set(.65,.65);material.needsUpdate=true;mapped=true;}}
 },dispose(){geometry.dispose();material.dispose();}};
}
