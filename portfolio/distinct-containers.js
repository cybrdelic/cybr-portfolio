import * as THREE from './vendor/three-r180/three.module.min.js';

// Authored solid meshes for concept C. No image planes or generated imagery.
export function buildDistinctContainers({content,housings,fixtures,mesh,ring,metal,edge,grip,dark,black}){
  const combat=new THREE.Group(),springs=new THREE.Group();
  combat.name='Combat / articulated force frame';springs.name='Scenes / optical mineral vessel';
  content.add(combat,springs);housings.combat=combat;housings.springs=springs;
  function plate(shape,depth,material,parent){return mesh(new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:.024,bevelThickness:.018,bevelSegments:3,curveSegments:32,steps:1}),material,parent);}
  function link(a,b,width,depth,parent){
    const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),r=width/2,s=new THREE.Shape();
    s.absarc(0,0,r,Math.PI/2,Math.PI*1.5,false);s.lineTo(length,-r);s.absarc(length,0,r,-Math.PI/2,Math.PI/2,false);s.closePath();
    for(const x of [0,length]){const hole=new THREE.Path();hole.absarc(x,0,r*.48,0,Math.PI*2,true);s.holes.push(hole);}
    if(length>1){const slot=new THREE.Path(),a=.34,b=length-.34,w=width*.14;slot.moveTo(a,w);slot.lineTo(b,w);slot.absarc(b,0,w,Math.PI/2,-Math.PI/2,true);slot.lineTo(a,-w);slot.absarc(a,0,w,-Math.PI/2,-Math.PI*1.5,true);slot.closePath();s.holes.push(slot);}
    const p=plate(s,depth,metal,parent);p.position.set(...a);p.rotation.z=Math.atan2(dy,dx);p.position.z-=depth/2;return p;
  }
  function pivot(p,parent,r=.18){
    const hub=ring(r,r*.43,.105,grip,parent);hub.rotation.set(Math.PI/2,0,0);hub.position.set(...p);
    const cap=mesh(new THREE.CylinderGeometry(r*.68,r*.68,.13,48),edge,parent);cap.rotation.x=Math.PI/2;cap.position.set(p[0],p[1],p[2]+.03);
    const socket=mesh(new THREE.CylinderGeometry(r*.27,r*.27,.005,6),black,parent);socket.rotation.x=Math.PI/2;socket.position.set(p[0],p[1],p[2]+.098);
  }
  function port(root,sign,r){
    const g=new THREE.Group();g.position.y=.4;root.add(g);fixtures.push({group:g,sign});
    for(const [ro,ri,d,x,mat] of [[r,.18,.28,0,metal],[r*.90,.18,.12,sign*.2,grip],[r*.72,.17,.17,sign*.34,edge],[r*.69,.17,.025,sign*.44,black]]){
      const collar=ring(ro,ri,d,mat,g);collar.position.x=x;
    }
    for(let i=0;i<8;i++){const a=i*Math.PI/4;const screw=mesh(new THREE.CylinderGeometry(.036,.036,.018,6),dark,g);screw.rotation.z=Math.PI/2;screw.position.set(sign*.151,r*.8*Math.cos(a),r*.8*Math.sin(a));}
  }
  // Unequal wishbones make an open force-transmission mechanism, not a cage.
  for(const z of [-.63,.63]){
    const a=[-2.32,.42,z],b=[-1.88,1.95,z],c=[-1.62,-.66,z],d=[.05,-.21,z],e=[1.56,-.65,z],f=[2.50,.4,z];
    for(const [p,q,w] of [[a,b,.26],[b,c,.27],[b,d,.22],[c,d,.25],[c,e,.25],[d,f,.23],[e,f,.27]])link(p,q,w,.13,combat);
    for(const p of [a,b,c,d,e,f])pivot([p[0],p[1],z+Math.sign(z)*.09],combat);
  }
  for(const x of [-1.62,1.56]){const axle=mesh(new THREE.CylinderGeometry(.105,.105,1.52,48),edge,combat);axle.rotation.x=Math.PI/2;axle.position.set(x,-.66,0);}
  // Small foot bed, following the fighter's stance rather than a broad podium.
  const bed=new THREE.Shape();bed.absellipse(.22,0,1.24,.78,0,Math.PI*2,false,0);
  const foot=plate(bed,.10,metal,combat);foot.rotation.x=-Math.PI/2;foot.position.y=-.14;
  const pad=mesh(new THREE.CylinderGeometry(1,1,.012,96),dark,combat);pad.scale.set(1.20,1,.735);pad.position.set(.22,-.017,0);
  for(const x of [-.65,1.05])for(const z of [-.52,.52]){const bolt=mesh(new THREE.CylinderGeometry(.04,.04,.018,6),edge,combat);bolt.position.set(x,-.002,z);}
  for(const sign of [-1,1])port(combat,sign,sign<0?.46:.35);

  // Closed, thick-walled optical shell. Outer and inner profiles join at lip
  // and bottom; terrain/water remain independent, visible real source meshes.
  const glass=new THREE.MeshPhysicalMaterial({color:0xffffff,metalness:0,roughness:.025,transmission:1,ior:1.47,thickness:.16,attenuationColor:0xcbe3df,attenuationDistance:7,side:THREE.DoubleSide});
  glass.name='Optical vessel glass';glass.userData.nativeType='glass';
  const profile=[[.001,-.91],[.20,-.9],[.40,-.84],[.60,-.73],[.73,-.60],[.82,-.43],[.90,-.26],[.96,-.08],[.985,.55],[1,1],[.994,1.015],[.982,1],[.965,.53],[.94,-.06],[.875,-.22],[.80,-.37],[.71,-.53],[.58,-.65],[.39,-.76],[.20,-.81],[.001,-.82]];
  const points=[],uv=[],faces=[],N=160;
  for(let j=0;j<profile.length;j++)for(let i=0;i<=N;i++){
    const t=i/N*Math.PI*2,[r,h]=profile[j],taper=1-.10*Math.cos(t);
    const rim=.45-.26*Math.sin(t)-.25*Math.cos(t);
    points.push(3.03*r*Math.cos(t),h>0?-.08+(rim+.08)*h:h,1.80*r*Math.sin(t)*taper);uv.push(i/N,j/(profile.length-1));
  }
  for(let j=0;j<profile.length-1;j++)for(let i=0;i<N;i++){const a=j*(N+1)+i,b=a+N+1;faces.push(a,b,a+1,a+1,b,b+1);}
  const outerCenter=points.length/3;points.push(0,profile[0][1],0);uv.push(.5,0);
  const innerCenter=points.length/3;points.push(0,profile.at(-1)[1],0);uv.push(.5,1);
  for(let i=0;i<N;i++){const b=(profile.length-1)*(N+1)+i;faces.push(outerCenter,i,i+1,innerCenter,b+1,b);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(faces);g.computeVertexNormals();
  const bowl=mesh(g,glass,springs);bowl.name='Thick optical vessel';bowl.castShadow=false;
  // Sculpted asymmetric saddle blades support the glass belly, not end rings.
  for(const sign of [-1,1]){
    const s=new THREE.Shape();s.moveTo(-3.13,.33);s.bezierCurveTo(-2.65,-.72,-1.0,-1.05,.15,-1.02);s.bezierCurveTo(1.5,-1.05,2.8,-.6,3.03,.32);s.lineTo(2.76,.32);s.bezierCurveTo(2.36,-.40,1.3,-.79,.1,-.81);s.bezierCurveTo(-1.2,-.81,-2.38,-.45,-2.87,.33);s.closePath();
    const saddle=plate(s,.14,metal,springs);saddle.position.z=sign*.63-.07;
    for(const x of [-2.88,2.79])pivot([x,.25,sign*.72],springs,.09);
  }
  for(const sign of [-1,1])port(springs,sign,.34);
  return {combat,springs};
}
