import * as T from './vendor/three-r180/three.module.min.js';

// Art-directed, closed water surface for the approved S-shaped silhouette.
// This is an authored scroll pose, not a substitute claim of a FLIP simulation.
export function createShadowSplash(){
 const root=new T.Group();root.name='11 / curling water sheet';
 const water=new T.MeshPhysicalMaterial({color:0xffffff,metalness:0,roughness:.018,transmission:1,ior:1.333,thickness:.035,attenuationDistance:20,attenuationColor:0xf4fcfa,envMapIntensity:1.45});
 const spine=new T.CatmullRomCurve3([[0,0,0],[.8,.65,0],[1.05,1.5,.05],[.3,2.35,.12],[-.65,3.2,.05],[-.7,4,.1],[0,4.65,.06],[.9,4.92,0]].map(p=>new T.Vector3(...p)));
 const positions=[],indices=[],rows=160,cols=40,edges=[[],[]],edgeGeometries=[];
 for(let i=0;i<=rows;i++){
  const t=i/rows,p=spine.getPoint(t),width=(1.15*Math.pow(1-t,.65)+.07)*(1+.065*Math.sin(t*57)+.025*Math.sin(t*109));
  for(let j=0;j<=cols;j++){
   const a=j/cols*Math.PI*2,v=Math.cos(a),ripple=(Math.sin(t*39+v*8)*.065+Math.sin(t*81-v*13)*.025)*Math.sin(Math.PI*t);
   const point=new T.Vector3(p.x+width*v,p.y+Math.sin(v*2+t*12)*.075*Math.sin(Math.PI*t),p.z+.32*(1-v*v)*Math.sin(Math.PI*t)+Math.sin(a)*(.014+.009*Math.sin(Math.PI*t))+ripple);
   positions.push(...point.toArray());if(j===0)edges[0].push(point);if(j===cols/2)edges[1].push(point);
   if(i<rows&&j<cols){const k=i*(cols+1)+j;indices.push(k,k+cols+1,k+1,k+1,k+cols+1,k+cols+2);}
  }
 }
 for(let j=1;j<cols-1;j++){indices.push(0,j+1,j);const end=rows*(cols+1);indices.push(end,end+j,end+j+1);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();
 const sheet=new T.Mesh(g,water);sheet.name='Thin curled liquid sheet';root.add(sheet);
 for(const edge of edges){const geometry=new T.TubeGeometry(new T.CatmullRomCurve3(edge),160,.026,8,false);edgeGeometries.push(geometry);root.add(new T.Mesh(geometry,water));}
 const dropGeometry=new T.SphereGeometry(1,20,12);
 const drops=[];
 for(let i=0;i<24;i++){
  const t=(i+.5)/24,p=spine.getPoint(t),side=i%2?1:-1,r=.035+(Math.sin(i*17.3)*.5+.5)*.065;
  const drop=new T.Mesh(dropGeometry,water);drop.position.set(p.x+side*(.8+Math.sin(i*5.2)*.35),p.y+.25+Math.cos(i*3.1)*.3,p.z+.2+Math.sin(i*2.3)*.5);drop.scale.set(r,r*(1.1+.4*t),r);root.add(drop);drops.push({drop,y:drop.position.y,t});
 }
 const pool=new T.Mesh(new T.SphereGeometry(1,72,20),water);pool.position.set(.1,.015,.1);pool.scale.set(2.05,.045,1.25);root.add(pool);
 // Surface-tension ligaments connect the impact pool to detached droplets.
 // These remain authored geometry, not a claimed fluid simulation.
 for(let i=0;i<7;i++){
  const a=i*2.39996,r=1.2+(i%3)*.18,points=[];
  for(let j=0;j<5;j++){const u=j/4;points.push(new T.Vector3(.1+Math.cos(a)*(r+u*.48),.035+Math.sin(u*Math.PI*.85)*(.18+(i%3)*.1),.1+Math.sin(a)*(r+u*.48)*.62));}
  const ligament=new T.TubeGeometry(new T.CatmullRomCurve3(points),24,.016,6,false);edgeGeometries.push(ligament);root.add(new T.Mesh(ligament,water));
 }
 root.position.set(0,-3.3,0);
 return {root,update(u){root.rotation.y=-.12+(u-.5)*.18;for(const {drop,y,t} of drops)drop.position.y=y+Math.sin((u-.5)*1.5+t*5)*.09;},dispose(){g.dispose();edgeGeometries.forEach(g=>g.dispose());dropGeometry.dispose();pool.geometry.dispose();water.dispose();}};
}
