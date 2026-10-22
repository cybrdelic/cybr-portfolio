import * as T from './vendor/three-r180/three.module.min.js';

// Transmission's mesh modelMatrix does not contain instanceMatrix. A shared
// 0.8 thickness therefore used to refract tiny droplets like the entire crest.
// Supply local optical depth explicitly, including each droplet's real size.
// This remains Three's one-pass volume-refraction approximation, not FLIP or
// ray-traced second interfaces. The public maximum also bounds the ROI copy.
export const WATER_MAX_THICKNESS=.36;
export function waterSectionThickness(depth,ripple=1){return Math.min(WATER_MAX_THICKNESS,Math.max(0,2*depth*ripple));}

function finishWater(material){
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nattribute float waterThickness;\nvarying float vWaterThickness;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvWaterThickness=waterThickness;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>','#include <common>\nvarying float vWaterThickness;')
   .replace('#include <transmission_fragment>',T.ShaderChunk.transmission_fragment.replace(
    'material.thickness = thickness;',
    'material.thickness = clamp(vWaterThickness,0.0,thickness);'
   ));
 };
 material.customProgramCacheKey=()=> 'direction11-water-local-volume-v1';
 material.userData.optics={model:'local volume thickness / existing physical Fresnel and Beer–Lambert',extraPasses:0,screenSpaceRefraction:true};
 return material;
}

const TAU=Math.PI*2;
const crestWidths=[[0,.012],[.045,.51],[.15,.91],[.30,.79],[.47,.55],[.65,.37],[.80,.39],[.91,.43],[.975,.16],[1,.009]];
function crestWidth(t){
 for(let i=1;i<crestWidths.length;i++)if(t<=crestWidths[i][0]){
  const [a,x]=crestWidths[i-1],[b,y]=crestWidths[i],u=(t-a)/(b-a),s=u*u*(3-2*u);
  return x+(y-x)*s;
 }
 return crestWidths.at(-1)[1];
}

function closeSweep(positions,indices,depths,rings,sides,first,last){
 for(const [ring,point,reverse] of [[0,first,false],[rings,last,true]]){
  const center=positions.length/3;positions.push(point.x,point.y,point.z);depths.push(depths[ring*sides]);
  for(let j=0;j<sides;j++){const a=ring*sides+j,b=ring*sides+(j+1)%sides;indices.push(center,...(reverse?[b,a]:[a,b]));}
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('waterThickness',new T.Float32BufferAttribute(depths,1));geometry.setIndex(indices);geometry.computeVertexNormals();
 return geometry;
}

function createCrest(spine){
 // A splash is a thin, billowing sheet with a thick free rim, not a tapered
 // solid elliptical rod. The same 2-manifold changes its broad-face curvature
 // continuously; every highlight follows real mesh normals. End caps are now
 // tiny and the lower endpoint is within the shallow pool, not a visible cut.
 const rings=128,sides=48,positions=[],indices=[],depths=[];
 const across=new T.Vector3(),depth=new T.Vector3(),v=new T.Vector3();
 for(let i=0;i<=rings;i++){
  const t=i/rings,p=spine.getPoint(t),tangent=spine.getTangent(t).normalize();
  across.set(tangent.y,-tangent.x,0).normalize();depth.crossVectors(across,tangent).normalize();
  const width=crestWidth(t),end=Math.min(1,t/.045,(1-t)/.025);
  const halfDepth=.008+end*(.024+.045*Math.exp(-t*5));
  const twist=.18*Math.sin(t*7)+.22*t,ct=Math.cos(twist),st=Math.sin(twist);
  for(let j=0;j<sides;j++){
   const angle=j/sides*TAU,u=Math.cos(angle),s=Math.sin(angle),edge=Math.pow(Math.abs(u),8);
   const shoulder=1-u*u;
   const scallop=1+end*.035*Math.sin(t*26+u*3);
   const x=u*width*scallop;
   const rim=halfDepth+end*.040*edge;
   const bow=end*shoulder*(.11*Math.sin(t*8.2)+.035*Math.sin(u*5.5+t*19));
   const z=s*rim+bow;
   const a=x*ct-z*st,b=x*st+z*ct;
   v.copy(p).addScaledVector(across,a).addScaledVector(depth,b);
   positions.push(v.x,v.y,v.z);depths.push(waterSectionThickness(rim));
   if(i<rings){const k=i*sides+j,n=i*sides+(j+1)%sides;indices.push(k,k+sides,n,n,k+sides,n+sides);}
  }
 }
 const geometry=closeSweep(positions,indices,depths,rings,sides,spine.getPoint(0),spine.getPoint(1));
 geometry.userData.surface={kind:'closed billowing sheet with rounded rim',largeExposedCaps:false,maximumLocalDepth:Math.max(...depths)};
 return geometry;
}

function createRunoff(index){
 // Low connected splash fingers replace open, six-sided wire hoops. They
 // start inside the pool and taper to a round tip, with no exposed tube ends.
 const a=index*2.39996+.3,length=1.65+.18*(index%3),height=.10+.045*(index%3);
 const points=[];for(let j=0;j<6;j++){
  const u=j/5,r=.42+u*length;
  points.push(new T.Vector3(.12+Math.cos(a)*r,.035+Math.sin(u*Math.PI)*height,.08+Math.sin(a)*r*.57));
 }
 const path=new T.CatmullRomCurve3(points),rings=28,sides=12,frames=path.computeFrenetFrames(rings,false),positions=[],indices=[],depths=[];
 for(let i=0;i<=rings;i++){
  const t=i/rings,p=path.getPointAt(t),radius=.004+.052*Math.sin(Math.min(t/.22,1)*Math.PI*.5)*Math.pow(1-t,.65),n=frames.normals[i],b=frames.binormals[i];
  for(let j=0;j<sides;j++){
   const a=j/sides*TAU,v=p.clone().addScaledVector(n,-Math.cos(a)*radius).addScaledVector(b,Math.sin(a)*radius);
   positions.push(v.x,v.y,v.z);depths.push(2*radius);
   if(i<rings){const k=i*sides+j,q=i*sides+(j+1)%sides;indices.push(k,k+sides,q,q,k+sides,q+sides);}
  }
 }
 return closeSweep(positions,indices,depths,rings,sides,path.getPointAt(0),path.getPointAt(1));
}

// Authored liquid event, not a claimed FLIP simulation. Closed rounded
// geometry supplies real changing interface normals rather than opacity.
export function createLiquidEvent(){
 const root=new T.Group();root.name='11 / curling water sheet';
 const water=finishWater(new T.MeshPhysicalMaterial({color:0xffffff,metalness:0,roughness:.018,transmission:1,ior:1.333,thickness:WATER_MAX_THICKNESS,attenuationDistance:4,attenuationColor:0xe4f7f5,envMapIntensity:1}));
 const spine=new T.CatmullRomCurve3([[.12,.034,.08],[.14,.30,.08],[.30,.85,.10],[.85,1.48,.06],[.58,2.10,.02],[-.32,2.84,.08],[-.49,3.55,.08],[-.10,4.24,.03],[.85,4.83,.04]].map(p=>new T.Vector3(...p)));
 const owned=[];
 const crestGeometry=createCrest(spine);owned.push(crestGeometry);
 const crest=new T.Mesh(crestGeometry,water);crest.name='Rounded liquid crest';root.add(crest);
 const dg=new T.SphereGeometry(1,16,10),drops=new T.InstancedMesh(dg,water,48),matrix=new T.Matrix4(),q=new T.Quaternion(),base=[],dropThickness=new Float32Array(48),movingPoint=new T.Vector3(),dropScale=new T.Vector3();owned.push(dg);root.add(drops);drops.name='Size-correct refractive droplets';
 for(let i=0;i<48;i++){
  const t=(i+.5)/48,p=spine.getPoint(t),side=i%2?1:-1,r=.018+(.5+.5*Math.sin(i*17.3))*.055;
  base.push({p:new T.Vector3(p.x+side*(crestWidth(t)+.15+.27*(.5+.5*Math.sin(i*5.2))),Math.max(.12,p.y+.15+.20*Math.cos(i*3.1)),p.z+.35*Math.sin(i*2.3)),r,t});
  dropThickness[i]=2*r;
 }
 dg.setAttribute('waterThickness',new T.InstancedBufferAttribute(dropThickness,1));
 const pg=new T.SphereGeometry(1,64,16);owned.push(pg);
 // Bake this nonuniform object scale into the mesh. Component-wise model
 // scale in getVolumeTransmissionRay otherwise stretches refraction sideways.
 const pp=pg.attributes.position;for(let i=0;i<pp.count;i++){const x=pp.getX(i),y=pp.getY(i),z=pp.getZ(i),a=Math.atan2(z,x),r=1+.055*Math.sin(a*5)+.035*Math.sin(a*9+.8);pp.setXYZ(i,x*r*1.9,y*.027,z*r*1.08);}pg.computeVertexNormals();
 const poolThickness=new Float32Array(pp.count);for(let i=0;i<pp.count;i++)poolThickness[i]=Math.max(.001,2*Math.abs(pp.getY(i)));
 pg.setAttribute('waterThickness',new T.Float32BufferAttribute(poolThickness,1));
 const poolMaterial=finishWater(water.clone());poolMaterial.thickness=.054;poolMaterial.roughness=.025;
 const pool=new T.Mesh(pg,poolMaterial);pool.name='Water body / true shallow depth';pool.position.set(.12,.027,.08);root.add(pool);
 for(let i=0;i<5;i++){
  const tube=createRunoff(i);owned.push(tube);const mesh=new T.Mesh(tube,water);mesh.name=`Tapered water runoff ${i+1}`;root.add(mesh);
 }
 root.position.set(0,-3.3,0);
 const update=u=>{root.rotation.y=-.12+(u-.5)*.18;for(let i=0;i<base.length;i++){const {p,r,t}=base[i];movingPoint.copy(p);movingPoint.y+=Math.sin((u-.5)*1.5+t*5)*.09;dropScale.set(r,r*(1.2+.6*t),r);matrix.compose(movingPoint,q,dropScale);drops.setMatrixAt(i,matrix);}drops.instanceMatrix.needsUpdate=true;};update(.5);
 root.userData.optics={authoredEvent:true,simulation:false,physicalIor:1.333,localThickness:true,extraTransmissionPasses:0,volumeApproximation:'closed billowing sheet with rim thickness, sphere diameter and shallow-pool chord; not a fluid solve'};
 return {root,update,dispose(){owned.forEach(g=>g.dispose());water.dispose();poolMaterial.dispose();}};
}
