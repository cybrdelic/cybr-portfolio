import * as THREE from './vendor/three-r180/three.module.min.js';
import {exportModule} from './module-export.js';
import {poolMaterial} from './cartridge-water.js';
import {exportNative} from './module-native-export.js';
import {buildDistinctContainers} from './distinct-containers.js';

const host=document.querySelector('#viewport'),error=document.querySelector('#error');
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.localClippingEnabled=true;
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;host.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#f3f2ee');
const camera=new THREE.PerspectiveCamera(33,innerWidth/innerHeight,.05,100);
const content=new THREE.Group();scene.add(content);
const metal=new THREE.MeshStandardMaterial({color:0xbfc2c5,metalness:1,roughness:.25});
const edge=new THREE.MeshStandardMaterial({color:0xe2e4e5,metalness:1,roughness:.17});
const grip=new THREE.MeshStandardMaterial({color:0x8d9193,metalness:1,roughness:.38});
const dark=new THREE.MeshStandardMaterial({color:0x222626,metalness:.65,roughness:.36});
const red=new THREE.MeshStandardMaterial({color:0x800918,metalness:.25,roughness:.39});
red.onBeforeCompile=s=>{s.vertexShader='varying vec2 vBraid;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBraid=uv;');s.fragmentShader='varying vec2 vBraid;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nvec2 braid=vBraid*vec2(380.,16.); float coverage=1.-smoothstep(.3,1.,max(fwidth(braid.x),fwidth(braid.y)));float weave=sin((braid.x+braid.y)*6.283)*sin((braid.x-braid.y)*6.283);diffuseColor.rgb*=.85+.15*weave*coverage;');};
const black=new THREE.MeshStandardMaterial({color:0x171917,roughness:.68});
const stageMaterial=new THREE.MeshStandardMaterial({color:0x47443c,roughness:.89});
const plane=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0xf3f2ee,roughness:1}));
plane.rotation.x=-Math.PI/2;plane.position.y=-1.18;plane.receiveShadow=true;scene.add(plane);
const key=new THREE.DirectionalLight(0xffffff,1.9);key.position.set(-4,8,5);key.castShadow=true;key.shadow.mapSize.set(2048,2048);
Object.assign(key.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.1,far:30});key.shadow.bias=-.00015;key.shadow.normalBias=.025;key.shadow.radius=3;scene.add(key);
const fill=new THREE.DirectionalLight(0xf0f5ff,1.1);fill.position.set(5,4,-3);scene.add(fill);scene.add(new THREE.HemisphereLight(0xf5f7ff,0x53565a,.8));
let yaw=.58,pitch=.40,distance=11.5,active='combat',frame=0,draws=0,lastMs=0;
const roots={},fixtures=[],loaded={};let cable,cableFittings;
window.exportCombatNative=()=>{if(active!=='combat')throw Error('Select Combat first');return exportNative(content);};
window.exportSpringsHousingNative=()=>{if(active!=='springs')throw Error('Select Scenes first');content.updateMatrixWorld(true);return exportNative(content,{excludeRoots:[roots.springs],filename:'springs-housing-native.json',source:'Concept C glass vessel and saddle; source interior transform included',metadata:{interiorWorld:roots.springs.matrixWorld.toArray(),sectionTaper:.20}});};
window.exportContainerGLB=()=>exportModule(housings[active],'cybr-'+active+'-container-c');
const housings={};
function mesh(geometry,material,parent=content){const m=new THREE.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function cylinder(r,h,mat,parent=content){return mesh(new THREE.CylinderGeometry(r,r,h,96),mat,parent);}
function ring(ro,ri,depth,mat,parent){
  const b=Math.min(.025,(ro-ri)*.2,depth*.2),profile=[[ri+b,-depth/2],[ro-b,-depth/2],[ro,-depth/2+b],[ro,depth/2-b],[ro-b,depth/2],[ri+b,depth/2],[ri,depth/2-b],[ri,-depth/2+b],[ri+b,-depth/2]];
  const m=mesh(new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),128),mat,parent);m.rotation.z=Math.PI/2;return m;
}
function curve(points,r,mat,parent=content){return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),80,r,10,false),mat,parent);}
function bolt(parent,y,z){for(const sign of [-1,1]){const head=mesh(new THREE.CylinderGeometry(.065,.065,.05,24),edge,parent);head.rotation.z=Math.PI/2;head.position.set(sign*.185,y,z);const socket=mesh(new THREE.CylinderGeometry(.029,.029,.003,6),black,parent);socket.rotation.z=Math.PI/2;socket.position.set(sign*.212,y,z);}}
function makeHardware(){
  buildDistinctContainers({content,housings,fixtures,mesh,ring,metal,edge,grip,dark,black});
}
// Retained only as a reference for old exported bakes; not used by the viewer.
function makeLegacyHardware(){
  const first=content.children.length;
  const tray=cylinder(2.28,.055,metal);tray.position.y=-.105;
  const gasket=cylinder(2.25,.015,black);gasket.position.y=-.072;
  const lower=ring(2.29,2.18,.055,metal,content);lower.rotation.set(0,0,0);lower.position.y=-.36;
  for(let i=0;i<8;i++){let a=i*Math.PI/4;const p=mesh(new THREE.BoxGeometry(.08,.24,.08),metal);p.position.set(2.22*Math.cos(a),-.23,2.22*Math.sin(a));p.rotation.y=-a;}
  for(let i=0;i<12;i++){const a=i*Math.PI/6;const h=mesh(new THREE.CylinderGeometry(.049,.049,.035,6),edge);h.position.set(2.12*Math.cos(a),-.058,2.12*Math.sin(a));}
  // Closed pool reaches -.80: the carrier must be below it, not through it.
  for(const part of content.children.slice(first))part.position.y-=.775;
  for(const sign of [-1,1]){
    const foot=mesh(new THREE.BoxGeometry(.86,.12,.5),metal);foot.position.set(sign*2.50,-1.08,0);
    for(const x of [2.28,2.72]){const head=mesh(new THREE.CylinderGeometry(.045,.045,.035,6),edge);head.position.set(sign*x,-1.0025,.14);}
  }
  for(const sign of [-1,1]){
    const group=new THREE.Group();content.add(group);fixtures.push({group,sign});group.position.y=.40;
    ring(1.56,1.23,.32,metal,group);ring(1.567,1.52,.23,grip,group);
    for(const offset of [-.07,.07]){const groove=ring(1.568,1.547,.012,dark,group);groove.position.x=offset;}
    for(const side of [-1,1]){const lip=ring(1.56,1.51,.035,edge,group);lip.position.x=side*.16;}
    for(let i=0;i<6;i++){let a=(i+.5)*Math.PI/3;bolt(group,1.405*Math.cos(a),1.405*Math.sin(a));}
    const connector=ring(.27,.09,.30,metal,group);connector.position.x=sign*.24;
    const nut=ring(.235,.09,.19,grip,group);nut.position.x=sign*.48;
    const exit=ring(.17,.078,.09,edge,group);exit.position.x=sign*.62;
    // Broad machined yoke, rather than the previous bent-tube support.
    const outline=new THREE.Shape();outline.moveTo(-.12,.12);outline.lineTo(.17,.12);outline.bezierCurveTo(.28,-.42,.67,-.74,.47,-1.4);outline.lineTo(.20,-1.43);outline.bezierCurveTo(.42,-.73,.04,-.45,-.12,-.12);outline.closePath();
    const yoke=mesh(new THREE.ExtrudeGeometry(outline,{depth:.18,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:3,steps:1,curveSegments:24}),metal,group);yoke.rotation.y=Math.PI/2;yoke.position.x=-.09;
    const seal=ring(.13,.076,.04,black,group);seal.position.x=sign*.68;
  }
  const parts=content.children.slice(first);housings.springs=new THREE.Group();housings.springs.name='Scenes / open silver instrument';content.add(housings.springs);parts.forEach(p=>housings.springs.add(p));
  makeCombatHousing();
}
function makeCombatHousing(){
  const root=housings.combat=new THREE.Group();root.name='Combat / armored octagonal chassis';content.add(root);
  const armor=new THREE.MeshStandardMaterial({color:0x292e32,metalness:.78,roughness:.38});
  const inset=new THREE.MeshStandardMaterial({color:0x111516,metalness:.35,roughness:.58});
  const bronze=new THREE.MeshStandardMaterial({color:0x786348,metalness:.85,roughness:.34});
  const outline=new THREE.Shape();
  for(let i=0;i<8;i++){const a=Math.PI/8+i*Math.PI/4;const x=2.34*Math.cos(a),y=2.34*Math.sin(a);if(i===0)outline.moveTo(x,y);else outline.lineTo(x,y);}outline.closePath();
  const base=mesh(new THREE.ExtrudeGeometry(outline,{depth:.24,bevelEnabled:true,bevelSize:.065,bevelThickness:.035,bevelSegments:3,steps:1}),armor,root);base.rotation.x=-Math.PI/2;base.position.y=-.37;
  for(const x of [-1.5,1.5])for(const z of [-1.5,1.5]){
    const leg=mesh(new THREE.BoxGeometry(.28,.65,.28),armor,root);leg.position.set(x,-.7,z);
    const boot=mesh(new THREE.CylinderGeometry(.24,.28,.16,8),inset,root);boot.position.set(x,-1.08,z);
    const cap=mesh(new THREE.CylinderGeometry(.07,.07,.025,6),bronze,root);cap.position.set(x,-.06,z);
  }
  for(const sign of [-1,1]){
    const group=new THREE.Group();group.position.y=.4;root.add(group);fixtures.push({group,sign});
    const plate=new THREE.Shape();plate.moveTo(-.51,-.74);plate.lineTo(.51,-.74);plate.lineTo(.65,-.56);plate.lineTo(.65,.28);plate.lineTo(.42,.48);plate.lineTo(-.42,.48);plate.lineTo(-.65,.28);plate.lineTo(-.65,-.56);plate.closePath();
    const hole=new THREE.Path();hole.absarc(0,0,.105,0,Math.PI*2,true);plate.holes.push(hole);
    const body=mesh(new THREE.ExtrudeGeometry(plate,{depth:.28,bevelEnabled:true,bevelSize:.045,bevelThickness:.025,bevelSegments:3,steps:1}),armor,group);body.rotation.y=Math.PI/2;body.position.x=-.14;
    const socket=ring(.24,.085,.38,bronze,group);socket.position.x=sign*.15;
    const seal=ring(.16,.074,.08,inset,group);seal.position.x=sign*.39;
    for(const y of [-.48,.23])for(const z of [-.42,.42])bolt(group,y,z);
  }
}
function route(){
  const spread=Number(document.querySelector('#spread').value),x=(active==='springs'?3.12:2.65)+spread*1.8;
  fixtures.forEach(f=>f.group.position.x=f.sign*x);
  if(cable){content.remove(cable);cable.geometry.dispose();}
  const cableY=active==='combat'?-.49:-.75;
  // Continuous cable enters fittings, bends below terrain, and clears the tray.
  const routePoints=active==='springs'?[[-x-1,.4,0],[-x,.4,0],[-2.8,-.28,-.64],[-1.8,-.79,-.7],[0,-.96,-.7],[1.8,-.74,-.7],[2.8,-.24,-.64],[x,.4,0],[x+1,.4,0]]:[[-x-1,.4,0],[-x,.4,0],[-2.20,-.40,0],[-1.55,-.56,0],[0,-.56,0],[1.55,-.56,0],[2.2,-.30,0],[x,.4,0],[x+1,.4,0]];
  cable=curve(routePoints,.064,red);cable.userData.routePoints=routePoints;
  cable.userData.module=active;
  if(cableFittings){content.remove(cableFittings);cableFittings.traverse(m=>m.geometry?.dispose());}
  cableFittings=new THREE.Group();content.add(cableFittings);
  // A real stepped junction terminates the miniature harness and accepts the
  // 2.35 mm hero trunk (0.157 workshop units). No exposed taper in the wire.
  for(const sign of [-1,1]){
    const junction=new THREE.Group();cableFittings.add(junction);junction.position.set(sign*(x+.91),.4,0);junction.rotation.z=sign>0?-Math.PI/2:Math.PI/2;
    const profile=[[.071,-.22],[.19,-.22],[.24,-.14],[.24,.24],[.177,.24],[.177,.02],[.071,.02],[.071,-.22]];
    mesh(new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),64),metal,junction);
    const hex=new THREE.Shape();for(let i=0;i<6;i++){const a=i*Math.PI/3;i?hex.lineTo(.255*Math.cos(a),.255*Math.sin(a)):hex.moveTo(.255*Math.cos(a),.255*Math.sin(a));}hex.closePath();const hole=new THREE.Path();hole.absarc(0,0,.18,0,Math.PI*2,true);hex.holes.push(hole);
    const nut=mesh(new THREE.ExtrudeGeometry(hex,{depth:.13,bevelEnabled:false,curveSegments:32}),grip,junction);nut.rotation.x=Math.PI/2;nut.position.y=.005;
    const bore=cylinder(.165,.003,black,junction);bore.position.y=.021;
    // The route used by the hero stops inside the large cable socket.
    cable.userData.routePoints=routePoints.map(p=>p.slice());
  }
  cable.userData.routePoints[0][0]=-x-1.13;
  cable.userData.routePoints.at(-1)[0]=x+1.13;
  cable.userData.trunkRadius=2.35/15;
  const path=cable.geometry.parameters.path;
  for(const t of [.40,.60]){const joint=new THREE.Group();joint.position.copy(path.getPointAt(t));joint.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),path.getTangentAt(t));cableFittings.add(joint);ring(.13,.071,.23,grip,joint);for(const sign of [-1,1]){const collar=ring(.142,.071,.045,edge,joint);collar.position.x=sign*.13;}}
  schedule();
}
async function inflate(url){const r=await fetch(url);if(!r.ok)throw Error(`${url}: ${r.status}`);return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}
const textureLoader=new THREE.TextureLoader();
async function loadModule(name){
  if(name==='springs')return loadFaithfulSprings();
  const base='./assets/display-modules/',asset=name==='combat'?'combat-impact-cloth-v1':name,doc=await fetch(base+asset+'.json').then(r=>{if(!r.ok)throw Error('Missing module '+name);return r.json();}),buffer=await inflate(base+asset+'.bin.gz');
  const root=new THREE.Group();roots[name]=root;content.add(root);root.visible=name===active;
  const mats={earth:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95}),strata:new THREE.MeshStandardMaterial({color:0x9e8e6a,roughness:.95}),rock:new THREE.MeshStandardMaterial({color:0x918575,roughness:.93}),wood:new THREE.MeshStandardMaterial({color:0x554a2a,roughness:.98}),leaf:new THREE.MeshStandardMaterial({color:0x687148,roughness:.95,side:THREE.DoubleSide}),water:new THREE.MeshPhysicalMaterial({color:0xb4e9e4,metalness:0,roughness:.07,transmission:.82,thickness:.45,ior:1.333,attenuationColor:0x26968e,attenuationDistance:.75,transparent:true,opacity:1,depthWrite:false})};
  const textures={};
  if(name==='combat'&&!doc.currentMannequin)for(const i of [3,4,5,7,8,9]){textures[i]=await textureLoader.loadAsync(base+`combat-${i}.webp`);textures[i].flipY=false;textures[i].anisotropy=renderer.capabilities.getMaxAnisotropy();if(i===3||i===4||i===7)textures[i].colorSpace=THREE.SRGBColorSpace;}
  if(name==='springs'){
    const grain=await textureLoader.loadAsync(base+'mineral-grain.webp');grain.wrapS=grain.wrapT=THREE.RepeatWrapping;grain.repeat.set(8,8);grain.anisotropy=8;
    for(const id of ['earth','rock','strata']){mats[id].map=grain;mats[id].bumpMap=grain;mats[id].bumpScale=.024;}
    mats.strata.onBeforeCompile=s=>{s.vertexShader='varying vec3 vStrata;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvStrata=position;');s.fragmentShader='varying vec3 vStrata;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=.82+.18*sin(vStrata.y*90.+sin(vStrata.x*8.)*.7);');};
  }
  for(const item of doc.meshes){
    const g=new THREE.BufferGeometry();
    for(const key of ['position','normal','uv','color','index']){
      const spec=item[key];if(!spec)continue;
      const array=key==='index'?new Uint32Array(buffer,spec.offset,spec.count):new Float32Array(buffer,spec.offset,spec.count);
      if(key==='index')g.setIndex(new THREE.BufferAttribute(array,1));else g.setAttribute(key,new THREE.BufferAttribute(array,spec.size));
    }
    if(name==='springs'&&!g.getAttribute('uv')){const p=g.getAttribute('position'),uv=new Float32Array(p.count*2);for(let i=0;i<p.count;i++){uv[i*2]=p.getX(i)/4;uv[i*2+1]=(item.material==='strata'?p.getY(i):p.getZ(i))/4;}g.setAttribute('uv',new THREE.BufferAttribute(uv,2));}
    let mat=mats[item.material];
    if(name==='combat'){
      const m=doc.materials[item.material];mat=new THREE.MeshStandardMaterial({color:new THREE.Color(...m.slice(1,4)),roughness:Math.sqrt(m[17]),metalness:m[0]===6?1:.2,side:THREE.DoubleSide});
      if(textures[m[20]])mat.map=textures[m[20]];
      if(doc.currentMannequin)mat.metalness=0;
      else if(item.name==='body'){mat.metalness=.72;mat.roughness=.52;mat.color.setRGB(.56,.42,.27);}
      if(item.name==='helmet'){mat.normalMap=textures[8];mat.normalScale.set(.55,.55);mat.roughnessMap=textures[9];mat.metalnessMap=textures[9];mat.metalness=1;mat.roughness=1;}
    }
    const object=mesh(g,mat,root);object.name=item.name;if(item.material==='water'){object.castShadow=false;object.renderOrder=2;}
  }
  if(name==='combat'&&doc.currentMannequin){
    root.rotation.y=Math.PI-1.2;root.position.x=.22;
  }else if(name==='combat'){
    root.rotation.y=Math.PI-.4;stageMaterial.map=textures[4];stageMaterial.normalMap=textures[5];stageMaterial.normalScale=new THREE.Vector2(.3,.3);textures[4].wrapS=textures[4].wrapT=THREE.RepeatWrapping;textures[4].repeat.set(2,2);textures[5].wrapS=textures[5].wrapT=THREE.RepeatWrapping;textures[5].repeat.set(2,2);const floor=cylinder(2.09,.07,stageMaterial,root);floor.position.y=-.02;
    for(let i=0;i<3;i++){const r=ring(1.4+i*.22,1.394+i*.22,.002,dark,root);r.rotation.set(0,0,0);r.position.y=.018;}
  }
  loaded[name]=doc;return root;
}
async function loadFaithfulSprings(){
  const lodCheck=new URLSearchParams(location.search).has('lod-check');
  const base=lodCheck?'./assets/springs-runtime-v1/':'./assets/springs-cartridge-v3/';
  const doc=await fetch(base+'manifest.json').then(r=>r.json()),buffer=await inflate(base+'geometry.bin.gz');
  const root=new THREE.Group();roots.springs=root;content.add(root);root.visible=active==='springs';
  root.scale.set(1.19,.45,.65);root.position.y=-.08;
  const baked=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,toneMapped:false});
  const skyBuffer=await inflate('./assets/springs-cartridge-v3/sky.bin.gz');
  const sky=new THREE.DataTexture(new Float32Array(skyBuffer),512,256,THREE.RGBAFormat,THREE.FloatType);sky.mapping=THREE.EquirectangularReflectionMapping;sky.needsUpdate=true;
  sky.minFilter=sky.magFilter=THREE.LinearFilter;
  const water=poolMaterial(await inflate('./assets/springs-cartridge-v3/pool-field.bin.gz'),sky);
  const physical=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8,side:THREE.DoubleSide});
  const lodWater=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.025,transmission:1,thickness:.5,ior:1.334});
  const section=new THREE.MeshStandardMaterial({color:0x887458,roughness:1,side:THREE.DoubleSide});
  const mineral=await textureLoader.loadAsync('./assets/display-modules/mineral-grain.webp');mineral.wrapS=mineral.wrapT=THREE.RepeatWrapping;mineral.repeat.set(8,2);mineral.anisotropy=8;section.map=mineral;section.bumpMap=mineral;section.bumpScale=.012;
  for(const item of doc.meshes){
    const g=new THREE.BufferGeometry();
    for(const key of ['position','normal','color','index']){const s=item[key];if(!s)continue;const a=key==='index'?new Uint32Array(buffer,s.offset,s.count):new Float32Array(buffer,s.offset,s.count);if(key==='index')g.setIndex(new THREE.BufferAttribute(a,1));else g.setAttribute(key,new THREE.BufferAttribute(a,s.size));}
    if(lodCheck&&item.albedo){const a=item.albedo;g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(buffer,a.offset,a.count),a.size));}
    if(item.name==='Sealed mineral section'){const p=g.getAttribute('position'),n=g.getAttribute('normal'),uv=new Float32Array(p.count*2);for(let i=0;i<p.count;i++){if(Math.abs(p.getY(i)+.07)<1e-6)p.setY(i,-.83);const r=Math.hypot(p.getX(i),p.getZ(i)),t=THREE.MathUtils.clamp((-.05-p.getY(i))/.78,0,1),scale=1-.20*t;const normal=new THREE.Vector3(p.getX(i)/r,-.20*r/.78,p.getZ(i)/r).normalize();n.setXYZ(i,...normal.toArray());p.setX(i,p.getX(i)*scale);p.setZ(i,p.getZ(i)*scale);uv[i*2]=Math.atan2(p.getZ(i),p.getX(i))/(2*Math.PI);uv[i*2+1]=p.getY(i)*4;}g.setAttribute('uv',new THREE.BufferAttribute(uv,2));}
    const mat=lodCheck?(item.material==='water'?lodWater:physical):(item.name==='Sealed mineral section'?section:item.material==='baked'?baked:item.material==='water'?water:section);
    const m=mesh(g,mat,root);m.name=item.name;m.castShadow=false;m.receiveShadow=false;if(item.material==='water')m.renderOrder=2;
  }
  loaded.springs=doc;return root;
}
function schedule(){for(const [name,root]of Object.entries(housings))root.visible=name===active;if(cable&&cable.userData.module!==active){route();return;}if(!frame&&!document.hidden)frame=requestAnimationFrame(draw);}
function draw(){
  frame=0;const fitted=distance*Math.max(1,1.3/camera.aspect);camera.position.set(Math.sin(yaw)*Math.cos(pitch)*fitted,.65+Math.sin(pitch)*fitted,Math.cos(yaw)*Math.cos(pitch)*fitted);camera.lookAt(0,.65,0);
  const t=performance.now();renderer.render(scene,camera);lastMs=performance.now()-t;draws++;
  document.querySelector('#status').textContent=`${renderer.info.render.triangles.toLocaleString()} submitted triangles · ${renderer.info.render.calls} draws · renders only on interaction`;
}
function select(name){active=name;for(const [k,r]of Object.entries(roots))r.visible=k===name;document.querySelectorAll('[data-module]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.module===name)));document.querySelector('#title').textContent=name==='combat'?'Combat — fighting cartridge':'Scenes — Desert Hot Springs';document.querySelector('#detail').innerHTML=(name==='combat'?'Current CYBR Combat male mannequin / training kit.<br>Step-in cross · frozen source-rig pose. No robot or added weapon.':'Recovered scene meshes · native diffuse surface bake.<br>Continuous terrain; single water interface.<br>Experimental cartridge — not full path-traced lighting.')+'<br><span id="status"></span>';schedule();}
document.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>select(b.dataset.module));
document.querySelector('#spread').oninput=route;
document.querySelector('#reset').onclick=()=>{yaw=.58;pitch=.40;distance=11.5;schedule();};
document.querySelector('#download-container').onclick=async()=>{try{await window.exportContainerGLB();}catch(e){error.textContent=e.message;}};
document.querySelector('#wire').onclick=e=>{const on=e.target.getAttribute('aria-pressed')!=='true';e.target.setAttribute('aria-pressed',String(on));content.traverse(o=>{if(o.isMesh)o.material.wireframe=on;});schedule();};
let drag;
renderer.domElement.onpointerdown=e=>{drag=[e.clientX,e.clientY];renderer.domElement.setPointerCapture(e.pointerId);};
renderer.domElement.onpointermove=e=>{if(!drag)return;yaw-=(e.clientX-drag[0])*.006;pitch=THREE.MathUtils.clamp(pitch+(e.clientY-drag[1])*.005,-.15,1.4);drag=[e.clientX,e.clientY];schedule();};
renderer.domElement.onpointerup=renderer.domElement.onpointercancel=()=>{drag=null;};
renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();distance=THREE.MathUtils.clamp(distance*Math.exp(e.deltaY*.001),6,24);schedule();},{passive:false});
window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();schedule();});
document.addEventListener('visibilitychange',schedule);
window.moduleWorkshop={select,exportGLB:()=>exportModule(content,'cybr-'+active+'-cartridge'),view(y,p,d){yaw=y;pitch=p;distance=d;schedule();},stats(){return {active,loaded:Object.keys(loaded),draws,lastMs,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,sprites:0};}};
async function init(){
  const manifest=await fetch('./assets/instrument-3d/manifest.json').then(r=>r.json());
  const buffer=await inflate('./assets/instrument-3d/'+manifest.environment.file);
  const neutral=new Float32Array(buffer);for(let i=0;i<neutral.length;i+=4){const luminance=.2126*neutral[i]+.7152*neutral[i+1]+.0722*neutral[i+2];neutral[i]=neutral[i+1]=neutral[i+2]=luminance;}
  const env=new THREE.DataTexture(neutral,manifest.environment.width,manifest.environment.height,THREE.RGBAFormat,THREE.FloatType);env.mapping=THREE.EquirectangularReflectionMapping;env.needsUpdate=true;
  const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(env).texture;scene.environmentIntensity=1.1;scene.environmentRotation.x=Math.PI/2;pmrem.dispose();env.dispose();
  document.querySelector('#spread').value='.03';makeHardware();route();await loadModule('combat');schedule();await loadModule('springs');error.textContent='';select(new URLSearchParams(location.search).get('module')==='springs'?'springs':'combat');schedule();
}
init().catch(e=>{error.textContent=e.message;console.error(e);});
