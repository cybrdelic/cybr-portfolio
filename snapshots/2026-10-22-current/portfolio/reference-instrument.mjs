import * as T from './vendor/three-r180/three.module.min.js';
import {createWhiteprint} from '../cybr-geo/browser/whiteprint.mjs';

// New presentation assets, authored from the selected design images. These
// deliberately do not import iris01, its blade blanks, chassis or assembly.
// Dimensions are scene units (20 mm/unit). Visual mechanisms, not FEA claims.
export const referenceRecipes=Object.freeze({
 '04':{name:'Type Stage',radius:3.25,depth:.44,blades:8,seat:1.30,brass:.98,pinion:.61,teeth:120},
 '05':{name:'Optical Field',radius:3.25,depth:.80,blades:8,seat:1.30,brass:.98,pinion:.61,teeth:120},
 '11':{name:'Shadow Choreography',radius:3.30,depth:.76,blades:8,seat:.99,brass:.78,pinion:.62,teeth:120},
 '14':{name:'Light as the Event',radius:3.30,depth:.48,blades:8,seat:1.31,brass:.99,pinion:.62,teeth:120},
 '27':{name:'Neutral Actuated Canvas',radius:3.30,depth:.36,blades:6,seat:1.30,brass:.875,pinion:.78,teeth:120}
});
const TAU=Math.PI*2;
function circle(r,z=0,n=160){return Array.from({length:n+1},(_,i)=>[r*Math.cos(i/n*TAU),r*Math.sin(i/n*TAU),z]);}
function loop(points,z){return [...points,points[0]].map(p=>[p[0],p[1],z]);}
function extrude(points,holes=[],depth=.08,bevel=.012){
 const shape=new T.Shape(points.map(p=>new T.Vector2(...p)));
 for(const h of holes)shape.holes.push(new T.Path(h.map(p=>new T.Vector2(...p))));
 const g=new T.ExtrudeGeometry(shape,{depth,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:3,steps:1,curveSegments:32});
 // Physical planar UVs are applied by CYBR MATERIAL, not ExtrudeGeometry's
 // default unitless UV generator.
 g.deleteAttribute('uv');g.userData.cadEdges=[loop(points,-bevel),loop(points,depth+bevel),...holes.flatMap(h=>[loop(h,-bevel),loop(h,depth+bevel)])];return g;
}
function annulus(outer,inner,depth,bevel=.025){
 const profile=[[inner+bevel,0],[outer-bevel,0],[outer,bevel],[outer,depth-bevel],[outer-bevel,depth],[inner+bevel,depth],[inner,depth-bevel],[inner,bevel],[inner+bevel,0]];
 const g=new T.LatheGeometry(profile.map(p=>new T.Vector2(...p)),192);g.rotateX(Math.PI/2);
 // Lathe y becomes +z. Keep the drawing on the actual front/back surfaces.
 g.userData.cadEdges=[circle(outer-bevel,0),circle(outer,bevel),circle(outer,depth-bevel),circle(outer-bevel,depth),circle(inner+bevel,0),circle(inner,bevel)];g.deleteAttribute('uv');return g;
}
function gear(teeth,root,tip){
 const out=[];for(let i=0;i<teeth;i++)for(const [a,r] of [[-.49,root],[-.28,root],[-.18,tip],[.18,tip],[.28,root],[.49,root]]){const t=(i+a)/teeth*TAU;out.push([r*Math.cos(t),r*Math.sin(t)]);}return out;
}
function retainingLip27(){
 // A shallow crowned turned face, not a flat washer or a torus. The crown
 // gives grazing studio reflections a continuous radial sweep.
 const profile=[[.79,0],[.898,0],[.91,.015],[.91,.075],
  [.905,.09],[.89,.11],[.86,.127],[.83,.144],
  [.80,.16],[.786,.158],[.78,.145],[.78,.018],[.79,0]];
 const g=new T.LatheGeometry(profile.map(p=>new T.Vector2(...p)),192);g.rotateX(Math.PI/2);g.deleteAttribute('uv');
 g.userData.cadEdges=[circle(.91,.08),circle(.78,.097)];return g;
}
function slot(radius,start,span,width,round=false){
 const out=[];for(let i=0;i<=48;i++){const a=start+span*i/48;out.push([(radius+width/2)*Math.cos(a),(radius+width/2)*Math.sin(a)]);}
 if(round)for(let i=1;i<12;i++){const a=start+span,q=i/12*Math.PI;out.push([radius*Math.cos(a)+width/2*Math.cos(a+q),radius*Math.sin(a)+width/2*Math.sin(a+q)]);}
 for(let i=48;i>=0;i--){const a=start+span*i/48;out.push([(radius-width/2)*Math.cos(a),(radius-width/2)*Math.sin(a)]);}
 if(round)for(let i=1;i<12;i++){const q=Math.PI+i/12*Math.PI;out.push([radius*Math.cos(start)+width/2*Math.cos(start+q),radius*Math.sin(start)+width/2*Math.sin(start+q)]);}
 return out;
}
function turnedHead(radius,hole,depth){
 const profile=[[hole,0],[radius*.88,0],[radius,.18*depth],[radius,.38*depth],[radius*.98,.59*depth],[radius*.91,.82*depth],[radius*.78,depth],[hole*1.30,depth],[hole,.77*depth],[hole,0]];
 const g=new T.LatheGeometry(profile.map(p=>new T.Vector2(...p)),96);g.rotateX(Math.PI/2);g.deleteAttribute('uv');
 g.userData.cadEdges=[circle(radius,depth*.38,96),circle(hole*1.3,depth,96)];return g;
}
function referenceSlots27(){
 // Six spiral cam tracks, digitized in the reference's 1672x941 image space.
 // These are not concentric circular slots: the follower radius changes.
 const curves=[
  [[998,220],[931,214],[847,255],[807,298]],
  [[1094,180],[1175,185],[1238,239],[1250,306]],
  [[1324,340],[1356,415],[1345,513],[1299,580]],
  [[1289,682],[1226,732],[1154,750],[1093,742]],
  [[1015,778],[940,763],[879,711],[851,644]],
  [[777,573],[755,513],[772,446],[807,403]]
 ];
 return curves.map(points=>{
  const v=points.map(([x,y])=>new T.Vector2((x-1049)/115.5,(482-y)/115.5)),c=new T.CubicBezierCurve(...v),left=[],right=[],r=.034;
  for(let i=0;i<=48;i++){const u=i/48,p=c.getPoint(u),t=c.getTangent(u),n=new T.Vector2(-t.y,t.x);left.push(p.clone().addScaledVector(n,r).toArray());right.push(p.clone().addScaledVector(n,-r).toArray());}
  const out=[...left],end=c.getPoint(1),et=c.getTangent(1),ea=Math.atan2(et.x,-et.y);
  for(let i=1;i<12;i++){const a=ea-i/12*Math.PI;out.push([end.x+r*Math.cos(a),end.y+r*Math.sin(a)]);}
  out.push(...right.reverse());const start=c.getPoint(0),st=c.getTangent(0),sa=Math.atan2(-st.x,st.y);
  for(let i=1;i<12;i++){const a=sa-i/12*Math.PI;out.push([start.x+r*Math.cos(a),start.y+r*Math.sin(a)]);}
  return out;
 });
}
function bladeProfile(pivot){
 // Broad, swept leaf. Adjacent leaves overlap through the full small display
 // stroke; unlike the old clipped triangular blanks they fill the annulus.
 const shape=new T.Shape();shape.moveTo(.80,-.55);shape.quadraticCurveTo(.9,-.8,1.10,-1.0);shape.lineTo(2.45,-.90);shape.lineTo(2.50,.22);shape.lineTo(1.55,1.12);shape.lineTo(.90,.55);shape.quadraticCurveTo(.76,.08,.80,-.55);
 return shape.getPoints(28).map(p=>[p.x-pivot,p.y]);
}
function chassis27(){
 // The selected drawing is not a union of perfect circles. Author its actual
 // perimeter, including the flatter pinion pocket and asymmetric upper arc.
 const outline=new T.Shape();outline.moveTo(1395,615);
 outline.bezierCurveTo(1450,612,1492,634,1518,673);
 outline.bezierCurveTo(1546,713,1541,757,1517,786);
 outline.bezierCurveTo(1493,819,1458,820,1406,817);
 outline.bezierCurveTo(1335,815,1286,815,1240,817);
 outline.bezierCurveTo(1186,837,1124,849,1054,846);
 outline.bezierCurveTo(837,847,661,696,660,484);
 outline.bezierCurveTo(658,270,835,94,1047,94);
 outline.bezierCurveTo(1258,94,1428,270,1429,482);
 outline.bezierCurveTo(1430,531,1415,579,1395,615);
 const points=outline.getPoints(48).map(p=>[(p.x-1049)/115.5,(482-p.y)/115.5]);
 const g=extrude(points,[circle(2.1).map(p=>p.slice(0,2))],.36,.018);
 g.userData.cadEdges=[loop(points,.378),circle(2.1,.378)];return g;
}
export function createReferenceInstrument({concept='27',drawingColor=0x171b18}={}){
 const recipe=referenceRecipes[concept]||referenceRecipes['27'],root=new T.Group(),hardware=new T.Group(),parts=[],owned=new Set(),materials=[];root.add(hardware);
 root.name=`Reference ${concept} / rebuilt circular instrument`;root.userData.assetRevision=concept==='27'?'reference27-finish-contours-3':'reference-rebuild-1';
 function material(id,color,roughness,metalness=1){const m=new T.MeshPhysicalMaterial({color,roughness,metalness});m.userData={cybrMaterial:id,cybrMetresPerUnit:.02};materials.push(m);return m;}
 const steel=material('BrushedMetal',0xa8a399,.3),black=material('06_blackened_steel',0x22201b,.38),brass=material('05_champagne_brass',0xc79c4b,.24);
 const polymer=new T.MeshStandardMaterial({color:0x11140f,roughness:.64}),board=new T.MeshStandardMaterial({color:0x174b35,roughness:.6,metalness:.1});materials.push(polymer,board);
 function part(name,g,m,z=0,parent=hardware){const mesh=new T.Mesh(g,m);mesh.name=name;mesh.position.z=z;mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);parts.push(mesh);owned.add(g);return mesh;}
 function box(name,w,h,d,x,y,z,m=steel){const g=extrude([[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]],[],d,.012);const p=part(name,g,m,z);p.position.set(x,y,z);return p;}
 const R=recipe.radius;
 part('Circular machined chassis',concept==='27'?chassis27():annulus(R,2.28,recipe.depth),steel,-recipe.depth-.12);
 if(concept==='11'){
  // A load-bearing rear gear and spacer stack give the silhouette actual
  // axial depth. Through-bores and counterbores remain geometry in macro.
  const bores=Array.from({length:12},(_,i)=>{const a=i*TAU/12;return circle(.055,0,16).map(([x,y])=>[x+2.96*Math.cos(a),y+2.96*Math.sin(a)]);});
  part('Rear drive wheel',extrude(gear(96,3.24,3.43),[circle(2.45).map(p=>p.slice(0,2)),...bores],.24,.018),black,-.72);
  for(const z of [-.45,-.18])part('Turned spacer shoulder',annulus(3.27,3.12,.07,.012),steel,z);
  for(let i=0;i<12;i++){
   const a=i*TAU/12+.13,x=2.93*Math.cos(a),y=2.93*Math.sin(a);
   const pocket=part('Recessed chassis counterbore',annulus(.115,.067,.024,.006),black,.166);pocket.position.set(x,y,.166);
   const socket=Array.from({length:6},(_,k)=>[.036*Math.cos(k*TAU/6),.036*Math.sin(k*TAU/6)]);
   const bolt=part('Hex socket chassis screw',extrude(circle(.072,0,32).map(p=>p.slice(0,2)),[socket],.036,.009),steel,.18);bolt.position.set(x,y,.18);
  }
 }
 if(concept==='27')part('Recessed cam track backing',annulus(R-.25,2.105,.025,.006),polymer,-.065);
 if(concept!=='27'){
  part('Rear barrel shoulder',annulus(R-.10,2.32,.10),black,-recipe.depth-.10);
  part('Fixed bearing outer race',annulus(R-.06,R-.20,.07,.012),steel,.015);
 }
 const camRoot=new T.Group();hardware.add(camRoot);
 const exact27=concept==='27';
 const holes=[circle(exact27?2.10:2.30).map(p=>p.slice(0,2)),...(exact27?referenceSlots27():Array.from({length:3},(_,i)=>slot(2.72,i*TAU/3+.4,1.25,.07)))];
 // Encoder apertures are cut through the cam plate, not black decal ticks.
 for(let i=0;i<120;i++){const a=i/120*TAU,r=R-(exact27?.48:.31),w=exact27?.009:.004;holes.push([[r-.045,a-w],[r+.045,a-w],[r+.045,a+w],[r-.045,a+w]].map(([radius,angle])=>[radius*Math.cos(angle),radius*Math.sin(angle)]));}
 part('120T reference cam gear',extrude(gear(recipe.teeth,R-(exact27?.36:.20),R-(exact27?.27:.095)),holes,.10,.008),steel,.05,camRoot);
 const bladeRoots=[];
 for(let i=0;i<recipe.blades;i++){
  const a=i/recipe.blades*TAU+(exact27?Math.PI*2/3:0),pivot=exact27?1.52:2.16,b=new T.Group();b.position.set(pivot*Math.cos(a),pivot*Math.sin(a),.20+i*.018);b.rotation.z=a;hardware.add(b);bladeRoots.push({b,a});
  // 27's six long interleaved plates are traced from its visible corners,
  // independently of the broad eight-leaf family used by the other studies.
  const profile=exact27?[[-.85,1.91],[-.26,1.83],[-1.15,-1.17],[-1.77,-1]].map(([x,y])=>[x*Math.cos(-TAU/3)-y*Math.sin(-TAU/3)-pivot,x*Math.sin(-TAU/3)+y*Math.cos(-TAU/3)]):concept==='11'?[[.54,-.30],[.78,-.76],[2.36,-.72],[2.52,-.14],[1.91,.44],[.83,.51]].map(([x,y])=>[x-pivot,y]):bladeProfile(pivot);
  part(`Rigid iris blade ${i}`,extrude(profile,[],.025,.006),black,0,b);
  const screw=part(`Pivot retainer ${i}`,exact27||concept==='11'?turnedHead(.075,.024,.055):annulus(.055,.021,.025,.006),steel,0,b);screw.position.set(exact27?0:-.05,0,.045);
  if(exact27){const spoke=box('Black cam linkage',.90,.105,.028,0,0,.12,black);spoke.position.set(1.60*Math.cos(a+.37),1.60*Math.sin(a+.37),.12);spoke.rotation.z=a-.5;}
 }
 if(concept!=='14'){
 part('Optical retaining mask',annulus(recipe.seat,recipe.brass+.035,.09,.025),steel,.53);
 part('Lens retaining lip',exact27?retainingLip27():annulus(recipe.brass+.035,recipe.brass-.14,.09,.025),brass,.55);
 }
 if(exact27){
  part('Optical seal outer',annulus(.925,.907,.035,.004),polymer,.555);
  part('Optical seal inner',annulus(.781,.770,.025,.002),polymer,.64);
 }
 if(concept!=='14')part('Optical barrel',annulus(exact27?.78:recipe.brass-.145,exact27?.745:recipe.brass-.19,.35,.012),black,.12);
 for(let i=0;i<3;i++){
  const a=Math.PI/6+i*TAU/3,inner=exact27?1.18:recipe.seat,outer=exact27?[3.21,3.31,3.03][i]:concept==='11'?R-.2:R,mid=(outer+inner)/2;
  const bridge=box('Cover support bridge',outer-inner+.08,exact27?.12:.072,.05,mid*Math.cos(a),mid*Math.sin(a),.57);bridge.rotation.z=a;
  for(const r of exact27||concept==='11'?[inner,outer]:[recipe.seat-.04,R-.03]){const screw=part('Bridge socket fastener',annulus(.080,.030,.04,.008),steel,.65);screw.position.x=r*Math.cos(a);screw.position.y=r*Math.sin(a);}
 }
 const pinionRoot=new T.Group(),pinionAngle=exact27?-.57:-Math.PI/6,center=exact27?3.85:R-.15+recipe.pinion-.03;pinionRoot.position.set(center*Math.cos(pinionAngle),center*Math.sin(pinionAngle),.04);hardware.add(pinionRoot);
 if(exact27){pinionRoot.rotation.x=.10;pinionRoot.rotation.y=-.16;}
 part(exact27?'32T pinion':'24T pinion',extrude(gear(exact27?32:24,recipe.pinion-(exact27?.11:.075),recipe.pinion),[circle(.15,0,32).map(p=>p.slice(0,2))],exact27?.20:.13,exact27?.022:.012),concept==='27'?black:steel,0,pinionRoot);
 part('Pinion bearing cap',exact27?turnedHead(.27,.105,.10):annulus(.23,.105,.05,.012),steel,.23,pinionRoot);
 part('Pinion shaft',annulus(.105,.045,.09,.01),black,.22,pinionRoot);
 box('Encoder reader',exact27?.45:.32,exact27?.55:.40,.10,0,R-(exact27?.20:.02),.25);
 if(concept!=='11')box('Controller board',exact27?.58:.42,exact27?.43:.20,.055,-2.65,2.45,-.05,board);
 if(exact27){
  const screw=part('Controller board screw',annulus(.08,.035,.05,.01),steel,.03);screw.position.set(-2.76,2.46,.03);
  const cap=part('Encoder cap',turnedHead(.13,.035,.09),steel,.12);cap.position.set(0,R+.05,.12);
  box('Encoder mounting tab',.24,.08,.09,0,R-.52,.15);
  box('Controller board chip',.12,.14,.05,-2.52,2.45,.015,polymer);
  box('Encoder connector',.27,.24,.16,-2.9,.16,.18,polymer);
  const rightCable=new T.CatmullRomCurve3([new T.Vector3(0,3.22,.1),new T.Vector3(.6,3.30,.1),new T.Vector3(1.40,3.22,.1),new T.Vector3(1.88,2.73,.1)]);
  const g=new T.TubeGeometry(rightCable,60,.024,8,false);g.userData.cadEdges=[rightCable.getPoints(60).map(p=>p.toArray())];part('Routed encoder cable return',g,polymer);
 }
 // One mechanically routed harness, with a quiet second return above it.
 for(const offset of concept==='11'?[]:[0,.10]){
  const curve=new T.CatmullRomCurve3([new T.Vector3(-3.03,-.04,.12),new T.Vector3(-3.32,1.2,.10),new T.Vector3(-2.43,2.82+offset,.06),new T.Vector3(-.65,3.48+offset-(exact27?.18:0),.10),new T.Vector3(0,R+(exact27?-.06:.12),.15)]);
  const g=new T.TubeGeometry(curve,96,.022,8,false);g.userData.cadEdges=[curve.getPoints(96).map(p=>p.toArray())];part('Routed encoder cable',g,polymer);
 }
 const glass=new T.MeshPhysicalMaterial({color:0xffffff,roughness:.015,metalness:0,transmission:1,thickness:.13,ior:1.5});materials.push(glass);
 const lensGeometry=new T.SphereGeometry(recipe.brass-.085,64,32);lensGeometry.scale(1,1,.085);lensGeometry.userData.cadEdges=[circle(recipe.brass-.085)];const lens=part('Optical element',lensGeometry,glass,.55);lens.visible=false;
 // The reference's ivory centre is an opal receiver behind the clear cover,
 // not an empty aperture or an opaque material assigned to the glass itself.
 if(concept==='11'){
  const receiver=new T.MeshStandardMaterial({color:0xf4e5c9,roughness:.46,metalness:0});materials.push(receiver);
  const disk=new T.CylinderGeometry(recipe.brass-.19,recipe.brass-.19,.035,96);disk.rotateX(Math.PI/2);disk.userData.cadEdges=[circle(recipe.brass-.19,.018)];part('Opal optical receiver',disk,receiver,.43);
 }
 if(exact27){
  for(const p of parts){
   if(/iris blade|pinion|Lens retaining lip|Pivot retainer|Black cam linkage|Controller board|Routed encoder cable|Encoder connector|Encoder cap|Optical seal/i.test(p.name))p.userData.whiteprintEdges=false;
  }
 }
 hardware.userData.whiteprintMotionRoots=[camRoot,pinionRoot,...bladeRoots.map(x=>x.b)];hardware.updateMatrixWorld(true);
 const whiteprint=createWhiteprint(T,hardware,{color:drawingColor,opacity:.95,strokeWidth:exact27?1.65:1});root.add(whiteprint.root);
 function update(u,construction=1,view='mechanism',optical=0){
  const drive=Math.max(0,Math.min(1,u)),origin=.5;camRoot.rotation.z=(drive-origin)*.18;pinionRoot.rotation.z=-(drive-origin)*.18*5;
  for(const {b,a} of bladeRoots)b.rotation.z=a+(drive-origin)*.22;
  hardware.visible=construction>.01;lens.visible=optical>.05;root.updateMatrixWorld(true);whiteprint.update(1-construction);
 }
 update(.5);
 return {root,hardware,parts,materials,whiteprint,recipe,update,dispose(){whiteprint.dispose();owned.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
}
