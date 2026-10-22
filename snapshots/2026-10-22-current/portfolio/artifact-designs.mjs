import * as T from './vendor/three-r180/three.module.min.js';
import {fetchArtifact} from './artifact-fetch.mjs';

export const ARTIFACTS=['geo','light','elements','song','combat','scenes'];
export const TITLES=['Mechanism study','Spectral bench','Material chamber','Lacuna mechanism','Contact stage','Desert Hot Springs'];
const tau=Math.PI*2;
export function buildArtifacts(){
 const materials={
  alloy:new T.MeshStandardMaterial({color:0xb9c0c3,metalness:.92,roughness:.25}),
  steel:new T.MeshStandardMaterial({color:0xd2d4d1,metalness:.98,roughness:.16}),
  dark:new T.MeshStandardMaterial({color:0x242a2b,metalness:.75,roughness:.32}),
  ceramic:new T.MeshStandardMaterial({color:0xe5e2d8,roughness:.34}),
  bronze:new T.MeshStandardMaterial({color:0xa88a50,metalness:.85,roughness:.3}),
  red:new T.MeshStandardMaterial({color:0x920c25,roughness:.4}),
  rubber:new T.MeshStandardMaterial({color:0x171d1e,roughness:.78}),
  glass:new T.MeshPhysicalMaterial({color:0xeaf9f6,metalness:0,roughness:.04,transmission:1,thickness:8,ior:1.5,iridescence:.35}),
  water:new T.MeshPhysicalMaterial({color:0x73b9b6,roughness:.06,transmission:.82,thickness:7,ior:1.333,attenuationColor:0x49908d,attenuationDistance:38}),
  rock:new T.MeshStandardMaterial({color:0x9c8165,roughness:.95,flatShading:true})
 };
 const groups=new Map(ARTIFACTS.map(n=>[n,new T.Group()])),moving=[];
 function mesh(g,geometry,material,x=0,y=0,z=0){const m=new T.Mesh(geometry,materials[material]||material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;}
 function box(g,x,y,z,w,d,h,mat='alloy',bevel=.7){
  const s=new T.Shape();s.moveTo(-w/2,-d/2);s.lineTo(w/2,-d/2);s.lineTo(w/2,d/2);s.lineTo(-w/2,d/2);s.closePath();
  const geo=new T.ExtrudeGeometry(s,{depth:Math.max(.1,h-2*bevel),bevelEnabled:bevel>0,bevelSize:bevel,bevelThickness:bevel,bevelSegments:2,steps:1});geo.translate(0,0,-h/2+bevel);
  return mesh(g,geo,mat,x,y,z);
 }
 function rod(g,a,b,r,mat='steel',segments=20){const av=new T.Vector3(...a),bv=new T.Vector3(...b),delta=bv.clone().sub(av);const m=mesh(g,new T.CylinderGeometry(r,r,delta.length(),segments),mat);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());m.position.copy(av.add(bv).multiplyScalar(.5));return m;}
 function ring(g,x,y,z,r,t,mat='steel',axis='x'){const m=mesh(g,new T.TorusGeometry(r,t,10,56),mat,x,y,z);if(axis==='x')m.rotation.y=Math.PI/2;if(axis==='y')m.rotation.x=Math.PI/2;return m;}
 function bolt(g,x,y,z){const m=mesh(g,new T.CylinderGeometry(1.7,1.7,1.1,6),'steel',x,y,z);m.rotation.x=Math.PI/2;box(g,x,y,z+.58,1.5,.3,.1,'dark',0);}
 function ports(g){for(const x of [-43,43]){ring(g,x,0,-23,3.6,.8,'steel');const m=mesh(g,new T.CylinderGeometry(4.6,4.6,4,6),'dark',x,0,-23);m.rotation.z=Math.PI/2;}rod(g,[-43,0,-23],[43,0,-23],2.1,'red');}
 function fasteners(g,w,d,z){for(const x of [-w,w])for(const y of [-d,d])bolt(g,x,y,z);}
 function gear(g,x,z,r,teeth){const s=new T.Shape(),mod=2*r/teeth,base=r*Math.cos(Math.PI/9),root=r-1.25*mod,tip=r+mod;
  const inv=radius=>{const t=Math.sqrt(Math.max(0,(radius/base)**2-1));return t-Math.atan(t);};
  const half=radius=>Math.PI/(2*teeth)+inv(r)-inv(Math.max(base,radius));let first=true;
  const point=(radius,angle)=>{const px=radius*Math.cos(angle),py=radius*Math.sin(angle);if(first){s.moveTo(px,py);first=false;}else s.lineTo(px,py);};
  for(let i=0;i<teeth;i++){const a=i*tau/teeth;point(root,a-half(base));for(let j=0;j<=5;j++){const radius=base+(tip-base)*j/5;point(radius,a-half(radius));}for(let j=5;j>=0;j--){const radius=base+(tip-base)*j/5;point(radius,a+half(radius));}point(root,a+half(base));}
  s.closePath();const hole=new T.Path();hole.absarc(0,0,3,0,tau,true);s.holes.push(hole);
  for(let i=0;i<3;i++){const h=new T.Path(),a=i*tau/3;h.absarc(Math.cos(a)*6.7,Math.sin(a)*6.7,2.4,0,tau,true);s.holes.push(h);}
  const geo=new T.ExtrudeGeometry(s,{depth:5,bevelEnabled:true,bevelSegments:1,bevelSize:.3,bevelThickness:.3,steps:1});geo.translate(0,0,-2.5);const m=mesh(g,geo,'bronze',x,-5,z);m.rotation.x=Math.PI/2;moving.push({object:m,kind:'gear',phase:x});return m;
 }
 // GEO: an open mechanism with bearing seats, a carriage and two inspectable gears.
 {
 const g=groups.get('geo');ports(g);box(g,0,0,-19,79,38,5,'dark');
 for(const y of [-15,15])rod(g,[-33,y,-12],[33,y,-12],2.1);
 for(const x of [-31,31]){box(g,x,5,5,5,19,46);fasteners(g,31,13,-15);}
 box(g,0,15,26,66,4,5,'alloy');box(g,0,15,10,50,4,5,'dark');
 gear(g,-12,10,12,18);gear(g,12,10,12,18);
 for(const x of [-12,12]){rod(g,[x,-14,10],[x,18,10],2.7);ring(g,x,-10,10,4,1,'dark','y');}
 box(g,0,-1,-8,16,32,6);rod(g,[-38,0,-8],[38,0,-8],1.3,'bronze');
 for(let i=0;i<13;i++)ring(g,-30+i*5,0,-8,1.7,.3,'steel');
 box(g,32,4,31,7,22,3,'alloy');for(let i=0;i<6;i++)box(g,-22+i*8,12.7,27,3,1,.5,'dark',0);
 }
 // LIGHT: a cantilevered triangular prism and offset lens, not another barrel.
 {
 const g=groups.get('light');ports(g);box(g,0,0,-19,80,17,4,'dark');
 for(const x of [-27,21]){rod(g,[x,0,-17],[x,0,10],1.8);box(g,x,0,-14,13,22,3);}
 const prism=new T.CylinderGeometry(19,19,29,3,1);prism.rotateY(Math.PI/2);mesh(g,prism,'glass',-15,0,14);
 for(const y of [-15.5,15.5]){const points=Array.from({length:3},(_,i)=>[-15+19*Math.cos(i*tau/3),y,14+19*Math.sin(i*tau/3)]);for(let i=0;i<3;i++)rod(g,points[i],points[(i+1)%3],.8,'dark');}
 const lens=mesh(g,new T.SphereGeometry(21,48,24),'glass',26,0,17);lens.scale.set(.13,1,1);
 ring(g,26,0,17,21.2,1.1);ring(g,29,0,17,21.2,.5,'dark');
 for(const y of [-15,15])rod(g,[25,y,2],[25,y,-12],.8);
 // Engraved spectrum swatches: physical enamel, not a fake emitted rainbow beam.
 [0x7a416a,0x485e89,0x4b888b,0xa5ae70,0xd39b55,0xa74737].forEach((c,i)=>box(g,-24+i*8,-10,-15,5,2,1,new T.MeshStandardMaterial({color:c,roughness:.3}),.15));
 fasteners(g,35,5,-16);
 }
 // ELEMENTS: an offset pressure chamber, compression rods and fluid volume.
 {
 const g=groups.get('elements');ports(g);box(g,0,0,-19,68,45,5,'dark');
 const shell=box(g,0,0,8,40,34,40,'glass',4);shell.material=materials.glass.clone();
 // A thin clear cover is composited over the water. Three's single transmission
 // buffer cannot correctly nest two refractive volumes; do not hide the liquid.
 shell.material.transmission=0;shell.material.transparent=true;shell.material.opacity=.13;shell.material.depthWrite=false;shell.material.roughness=.07;
 const fluid=box(g,0,0,3,33,27,24,'water',3);moving.push({object:fluid,kind:'fluid'});
 for(const z of [-13,29])box(g,0,0,z,48,41,3,'alloy');
 for(const x of [-21,21])for(const y of [-17,17]){rod(g,[x,y,-16],[x,y,33],1.2);bolt(g,x,y,33);}
 for(const x of [-32,32]){rod(g,[x,0,-15],[x,0,19],1.8,'bronze');ring(g,x,0,19,5,.9,'steel');}
 for(let i=0;i<9;i++)mesh(g,new T.SphereGeometry(.65+(i%3)*.35,10,8),'glass',Math.sin(i*4)*12,Math.cos(i*3)*9,-4+i*2.4);
 for(let i=0;i<7;i++)box(g,-25,-17,-7+i*5,2,.5,.35,'dark',0);
 }
 // SONG: a piano/guitar-derived mechanical score: keys, hammers and real strings.
 {
 const g=groups.get('song');ports(g);box(g,0,0,-19,76,43,4,'dark');
 for(const x of [-32,32]){box(g,x,0,3,4,38,42,'bronze');rod(g,[x,-18,25],[x,18,25],1.5);}
 for(let i=0;i<11;i++){
  const x=-25+i*5;const key=box(g,x,-10,-11,3.8,27,3,'ceramic',.3);moving.push({object:key,kind:'key',phase:i});
  rod(g,[x,4,-9],[x,12,20-i*.9],.55,'bronze');
  box(g,x,12,20-i*.9,3.4,5,2,'rubber',.4);
  rod(g,[-30,-13+i*2.5,25],[30,-13+i*2.5,25-i*.5],.18,'steel',6);
  ring(g,32,-13+i*2.5,25-i*.5,1.4,.45,'steel');
 }
 for(const i of [1,2,4,5,6,8,9])box(g,-25+i*5+2.3,-3,-7,2,15,2,'dark',.2);
 }
 // COMBAT: a splayed impact platform; the character is loaded from source below.
 {
 const g=groups.get('combat');ports(g);box(g,0,0,-21,66,12,4,'dark');
 for(const x of [-27,27])for(const y of [-17,17]){rod(g,[x*.7,0,-22],[x,y,-10],1.8);ring(g,x,y,-10,2.5,.7,'bronze','y');}
 box(g,0,0,-8,66,39,3,'dark');box(g,0,0,-6,62,35,1,'rubber',.3);
 for(const x of [-30,30])box(g,x,0,-5,1.2,33,1,'alloy',.2);
 for(let i=0;i<9;i++)box(g,-24+i*6,-15,-5,2,.8,.25,'ceramic',0);
 // Split rear guard emphasizes authored movement without enclosing the avatar.
 for(const x of [-34,34]){rod(g,[x,18,-11],[x,18,15],1.1);rod(g,[x,18,15],[x*.55,18,28],1.1);}
 }
 // SCENES: an open rectangular environmental section, supported from one side.
 {
 const g=groups.get('scenes');ports(g);box(g,0,0,-21,76,11,4,'dark');
 for(const x of [-28,28]){rod(g,[x,0,-22],[x,18,-8],1.8);rod(g,[x,0,-22],[x,-18,-8],1.8);}
 const outline=new T.Shape();[[-32,-24],[25,-24],[34,-13],[31,24],[-28,23],[-35,8]].forEach(([x,y],i)=>i?outline.lineTo(x,y):outline.moveTo(x,y));outline.closePath();
 const core=new T.ExtrudeGeometry(outline,{depth:17,bevelEnabled:true,bevelThickness:1,bevelSize:2,bevelSegments:1});core.translate(0,0,-12);mesh(g,core,'rock');
 for(const x of [-28,28])for(const y of [-20,20]){box(g,x,y,-7,8,4,2);bolt(g,x,y,-5);}
 }
 // Consolidate stationary hardware by material. Tiny fasteners should not each
 // cost a separate browser draw call; animated mechanisms stay independent.
 const animated=new Set(moving.map(item=>item.object));
 for(const group of groups.values()){
  const batches=new Map();
  for(const object of [...group.children]){
   if(animated.has(object)||!object.isMesh)continue;
   if(!batches.has(object.material))batches.set(object.material,[]);
   batches.get(object.material).push(object);
  }
  for(const [material,batch] of batches){
   if(batch.length<2)continue;
   const positions=[],normals=[],uvs=[],indices=[];let base=0;
   for(const object of batch){object.updateMatrix();const g=object.geometry.clone().applyMatrix4(object.matrix),p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    for(let i=0;i<p.count;i++){positions.push(p.getX(i),p.getY(i),p.getZ(i));normals.push(n.getX(i),n.getY(i),n.getZ(i));uvs.push(uv?uv.getX(i):0,uv?uv.getY(i):0);}
    for(let i=0;i<(g.index?.count??p.count);i++)indices.push(base+(g.index?g.index.getX(i):i));base+=p.count;g.dispose();object.geometry.dispose();group.remove(object);
   }
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));g.setIndex(indices);mesh(group,g,material);
  }
 }
 return {groups,materials,moving};
}

export async function loadSourceArtifact(name,lod,group){
 const base=`./assets/artifacts-v2/${name}-${lod}`;
 const [meta,data]=await Promise.all([fetchArtifact(base+'.json',{json:true}),fetchArtifact(base+'.bin.gz')]);
 if(data.byteLength!==meta.bytes)throw Error('Source asset length mismatch');
 const result=new T.Group();result.name=`source-${name}-${lod}`;
 for(const record of meta.meshes){
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(new Float32Array(data,record.positions.offset,record.positions.count),3));geo.setIndex(new T.BufferAttribute(new Uint32Array(data,record.indices.offset,record.indices.count),1));geo.computeVertexNormals();
  const spec=record.material,color=new T.Color().setRGB(...spec.color);
  let mat;
  if(spec.role==='springs-water')mat=new T.MeshPhysicalMaterial({color:0x87c4ba,roughness:.08,transmission:.7,thickness:5,ior:1.333,attenuationColor:0x4d9490,attenuationDistance:35});
  else mat=new T.MeshStandardMaterial({color,roughness:spec.roughness,metalness:0,vertexColors:!!record.colors});
  if(record.colors)geo.setAttribute('color',new T.BufferAttribute(new Float32Array(data,record.colors.offset,record.colors.count),3));
  const mesh=new T.Mesh(geo,mat);mesh.castShadow=true;mesh.receiveShadow=true;result.add(mesh);
 }
 if(name==='combat'){
  const bounds=new T.Box3().setFromObject(result),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
  const scale=48/size.z;result.scale.setScalar(scale);result.position.set(-center.x*scale,-center.y*scale,-5-bounds.min.z*scale);
 }else result.position.z=5;
 group.add(result);return result;
}

export async function loadArtifactHardware(){
 const data=await fetchArtifact('./assets/artifacts-v2/hardware.json.gz',{json:true});
 const root=new T.ObjectLoader().parse(data.scene),objects=new Map(),allMaterials=new Map();root.traverse(o=>{objects.set(o.uuid,o);if(o.material)allMaterials.set(o.material.uuid,o.material);});
 return {groups:new Map([...root.children].map(g=>[g.name,g])),materials:Object.fromEntries(Object.entries(data.materials).map(([name,id])=>[name,allMaterials.get(id)])),moving:data.moving.map(({uuid,...rest})=>({...rest,object:objects.get(uuid)}))};
}
