import * as T from './vendor/three-r180/three.module.min.js';
// Authored closed splash surface for the approved key pose. This is a static
// art-directed mesh, not a FLIP simulation or a substitute labelled as one.
export function createSplashAsset(){
 const root=new T.Group();root.name='CYBR ELEMENTS / asymmetric crown';
 const material=new T.MeshPhysicalMaterial({color:0xffffff,metalness:0,roughness:.035,transmission:1,ior:1.333,thickness:.065,attenuationColor:0xffffff,attenuationDistance:100,envMapIntensity:1.5});
 const radial=256,vertical=64,positions=[],indices=[];
 const peak=(a,c,w)=>Math.exp(-Math.pow(Math.atan2(Math.sin(a-c),Math.cos(a-c))/w,2));
 function surface(a,v,side){
  const top=.9+2.8*peak(a,.36,.28)+1.2*peak(a,2.4,.3)+.36*Math.sin(a*7)+.13*Math.sin(a*13);
  const r=2.2-1.12*Math.sin(v*Math.PI*.62)+.22*v*v+.12*Math.sin(a*4+v*4)*v+(.13*Math.sin(a*11-v*8)+.045*Math.sin(a*27+v*32))*Math.sin(v*Math.PI);
  const thickness=.022*(1-.6*v),radius=r+side*thickness;
  return new T.Vector3(Math.cos(a)*radius+.3*v*v,top*v+.024*Math.sin(a*19+v*22)*Math.sin(v*Math.PI),Math.sin(a)*radius*.68);
 }
 const stride=(radial+1)*(vertical+1);
 for(let side=0;side<2;side++)for(let j=0;j<=vertical;j++)for(let i=0;i<=radial;i++)positions.push(...surface(i/radial*Math.PI*2,j/vertical,side? -1:1).toArray());
 for(let side=0;side<2;side++)for(let j=0;j<vertical;j++)for(let i=0;i<radial;i++){
  const a=side*stride+j*(radial+1)+i,b=a+1,c=a+radial+1,d=c+1;
  indices.push(...(side?[a,b,c,b,d,c]:[a,c,b,b,c,d]));
 }
 for(const j of [0,vertical])for(let i=0;i<radial;i++){
  const a=j*(radial+1)+i,b=a+1,c=a+stride,d=b+stride;
  indices.push(...(j?[a,b,c,b,d,c]:[a,c,b,b,c,d]));
 }
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
 const shell=new T.Mesh(geo,material);shell.name='Closed crown sheet';root.add(shell);
 const rimPoints=Array.from({length:radial+1},(_,i)=>surface(i/radial*Math.PI*2,1,0));
 const rimGeo=new T.TubeGeometry(new T.CatmullRomCurve3(rimPoints),384,.032,6,true),rim=new T.Mesh(rimGeo,material);rim.name='Surface tension rim';root.add(rim);
 const dropGeo=new T.SphereGeometry(1,16,12),drops=new T.InstancedMesh(dropGeo,material,62),dummy=new T.Object3D();
 for(let i=0;i<62;i++){
  const a=i*2.399963,v=surface(a,1,0),size=.024+(Math.sin(i*12.98)*.5+.5)*.055;
  dummy.position.copy(v).multiplyScalar(1.06+(i%5)*.07);dummy.position.y+=.15+(i%7)*.24;dummy.scale.set(size,size*(1+(i%3)*.2),size);dummy.updateMatrix();drops.setMatrixAt(i,dummy.matrix);
 }
 drops.name='Detached droplets';root.add(drops);
 root.position.y=-2;root.rotation.y=-.35;
 root.userData={revision:'14-crown-solid-1',provenance:'New closed authored key-pose mesh. Not simulated FLIP.',triangles:indices.length/3+rimGeo.index.count/3+dropGeo.index.count/3*62,droplets:62};
 return {root,dispose(){geo.dispose();rimGeo.dispose();dropGeo.dispose();material.dispose();}};
}
