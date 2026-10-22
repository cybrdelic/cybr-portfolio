// Concept 14: an authored three-dimensional notation asset. No image planes.
// Units are engraving units until the final continuous paperless staff warp.
import * as T from './vendor/three-r180/three.module.min.js';

export const songAssetRevision='14-score-solid-1';
export const phrases=[
 ['E4','G4','B4','A4','G4','E4','D4','E4','G4','A4','B4','D5','C5','B4','A4','G4','F#4','A4','G4','E4','D4','F#4','E4','E4'],
 ['C5','B4','G4','E4','G4','A4','B4','G4','A4','C5','E5','D5','C5','A4','G4','E4','F#4','G4','A4','B4','A4','G4','E4','D4'],
 ['G4','E4','D4','B3','D4','E4','G4','A4','B4','A4','G4','E4','D4','F#4','A4','G4','E4','G4','B4','A4','G4','F#4','E4','E4'],
];

export function staffPoint(x,y,z,row){
 const u=x/1200, lift=-55*Math.sin(u*Math.PI*1.4+row*.3)+240*u*u;
 return new T.Vector3((x-600)/85,(lift+y+(1-row)*170-90)/85,z/85+Math.sin(u*Math.PI*1.3+row*.7)*.7-row*.32);
}

function merge(parts){
 let length=0;for(const g of parts)length+=g.attributes.position.array.length;
 const array=new Float32Array(length);let offset=0;
 for(const g of parts){array.set(g.attributes.position.array,offset);offset+=g.attributes.position.array.length;g.dispose();}
 const out=new T.BufferGeometry();out.setAttribute('position',new T.BufferAttribute(array,3));out.computeVertexNormals();out.computeBoundingSphere();return out;
}

export function createSongAsset(){
 const root=new T.Group();root.name='CYBR SONG / engraved floating score';
 const material=new T.MeshStandardMaterial({color:0xf3e6c9,roughness:.48,metalness:.12});
 const owned=[];let noteCount=0,beamCount=0;
 for(let row=0;row<3;row++){
  const parts=[];
  function warped(g){
   if(g.index){const next=g.toNonIndexed();g.dispose();g=next;}
   const p=g.attributes.position;for(let i=0;i<p.count;i++){const v=staffPoint(p.getX(i),p.getY(i),p.getZ(i),row);p.setXYZ(i,v.x,v.y,v.z);}parts.push(g);
  }
  function line(points,radius=.85){
   const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));
   warped(new T.TubeGeometry(curve,Math.max(3,points.length*3),radius,5,false));
  }
  function path(points,radius=1.3){line(points.map(p=>[...p,1.3]),radius);}
  function solid(shape){warped(new T.ExtrudeGeometry(shape,{depth:1.7,bevelEnabled:true,bevelSize:.32,bevelThickness:.3,bevelSegments:1,steps:1,curveSegments:12}));}
  function head(x,y,open=false){
   const shape=new T.Shape();shape.absellipse(x,y,7.6,4.9,0,Math.PI*2,false,.32);
   if(open){const hole=new T.Path();hole.absellipse(x,y,4.8,2.4,0,Math.PI*2,true,.32);shape.holes.push(hole);}solid(shape);
  }
  for(let l=0;l<5;l++)line(Array.from({length:65},(_,i)=>[i*1200/64,l*13,0]),.48);
  for(let bar=0;bar<=6;bar++){const x=112+bar*177;line([[x,0,0],[x,52,0]],.67);}
  // Hand-authored treble clef; continuous engraved stroke, not font fallback.
  path([[56,-19],[62,-10],[59,15],[49,43],[47,69],[53,84],[60,77],[56,57],[42,40],[34,26],[35,13],[47,5],[61,10],[65,21],[58,33],[48,35],[42,29],[43,21]],1.7);
  head(55,-18);
  // 4/4 signature, drawn as geometry so export has no font dependency.
  for(const y of [14,40]){path([[88,y+10],[78,y-3],[92,y-3]],1);path([[88,y+10],[88,y-12]],1);}
  const notes=phrases[row].map((pitch,i)=>{
   const m=/^([A-G])(#?)(\d)$/.exec(pitch),step=+m[3]*7+'CDEFGAB'.indexOf(m[1]);
   return {x:135+i*43.7,y:(step-30)*6.5,sharp:!!m[2],i};
  });
  for(let i=0;i<notes.length;i++){
   const n=notes[i],open=i===23;head(n.x,n.y,open);noteCount++;
   for(let y=-13;y>=n.y;y-=13)line([[n.x-12,y,1],[n.x+12,y,1]],.7);
   for(let y=65;y<=n.y;y+=13)line([[n.x-12,y,1],[n.x+12,y,1]],.7);
   if(n.sharp){for(const dx of [-19,-14])path([[n.x+dx,n.y-9],[n.x+dx,n.y+12]],.85);for(const dy of [-3,5])path([[n.x-23,n.y+dy],[n.x-10,n.y+dy+3]],1.6);}
   const beamed=i%4<2&&i<22;
   const partner=beamed?notes[i+(i%4===0?1:-1)]:n;
   const stemY=Math.max(n.y,partner.y)+38;
   line([[n.x+6.4,n.y,1],[n.x+6.4,stemY,1]],.85);
   if(beamed&&i%4===0){
    const shape=new T.Shape();shape.moveTo(n.x+6,stemY);shape.lineTo(partner.x+7,stemY);shape.lineTo(partner.x+7,stemY-4);shape.lineTo(n.x+6,stemY-4);shape.closePath();solid(shape);beamCount++;
   }
  }
  const geo=merge(parts),mesh=new T.Mesh(geo,material);mesh.name=`Floating score / system ${row+1}`;root.add(mesh);owned.push(geo);
 }
 root.userData={revision:songAssetRevision,noteCount,beamCount,staffLines:15,provenance:'New concept-14 engraving; authored arrangement, not a literal Lantern Steps transcription.',triangles:owned.reduce((n,g)=>n+g.attributes.position.count/3,0)};
 function update(progress){
  const t=T.MathUtils.clamp(progress,0,1),ease=t*t*(3-2*t);
  // Move actual solid systems through depth, rather than translating a score image.
  root.children.forEach((system,row)=>{
   system.rotation.set((ease-.5)*.12,(ease-.5)*(.16+row*.035),(ease-.5)*.04);
   system.position.set((.5-ease)*.65,(ease-.5)*(row-1)*.12,Math.sin(ease*Math.PI)*(1-row)*.35);
  });
 }
 return {root,update,dispose(){owned.forEach(g=>g.dispose());material.dispose();}};
}
