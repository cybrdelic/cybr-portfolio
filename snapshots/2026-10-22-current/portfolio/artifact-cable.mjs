import * as T from './vendor/three-r180/three.module.min.js';

// Same tube construction as Three.js, but keep index/UV/vertex buffers resident.
export function updateCable(geometry,curve,segments=20,radius=2.1,sides=8){
 const frames=curve.computeFrenetFrames(segments,false),point=new T.Vector3(),normal=new T.Vector3();
 const positions=geometry.attributes.position,normals=geometry.attributes.normal;
 for(let i=0;i<=segments;i++){
  curve.getPointAt(i/segments,point);
  for(let j=0;j<=sides;j++){
   const angle=j/sides*Math.PI*2;
   normal.copy(frames.normals[i]).multiplyScalar(-Math.cos(angle)).addScaledVector(frames.binormals[i],Math.sin(angle)).normalize();
   const k=i*(sides+1)+j;
   normals.setXYZ(k,normal.x,normal.y,normal.z);
   positions.setXYZ(k,point.x+radius*normal.x,point.y+radius*normal.y,point.z+radius*normal.z);
  }
 }
 positions.needsUpdate=true;normals.needsUpdate=true;geometry.computeBoundingSphere();
}
