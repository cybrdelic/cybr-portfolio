import * as THREE from './vendor/three-r180/three.module.min.js';
import {orbitPose,prismPath,PRISM_SOURCE,cauchyIndex} from './specimen-optics.mjs';
import {loadFluid} from './instrument-fluid.js';

const paper=0xf1f0ec;
export async function createSpecimen(host,name,{signal,onChange=()=>{}}={}){
  const renderer=new THREE.WebGLRenderer({alpha:false,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(paper);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene(),root=new THREE.Group(),camera=new THREE.PerspectiveCamera(32,1,.1,4000);scene.add(root);camera.up.set(0,0,1);
  const ambient=new THREE.HemisphereLight(0xffffff,0x777b83,2);ambient.position.set(0,0,200);scene.add(ambient);
  for(const [position,intensity] of [[[100,-180,260],4],[[-160,100,140],2],[[150,180,80],1.5]]){
    const light=new THREE.DirectionalLight(0xffffff,intensity);light.position.set(...position);scene.add(light);
    if(intensity===4){light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-250,right:250,top:250,bottom:-250,near:1,far:900});light.shadow.bias=-.0005;light.shadow.normalBias=.15;}
  }
  // Analytic studio reflection cards. They light geometry; no image projection.
  const w=256,h=128,pixels=new Float32Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const v=y/h,u=x/w,card=(u>.13&&u<.24||u>.62&&u<.69)&&v>.2&&v<.72;
    const value=card?4.5:.28+.32*(1-v),i=(y*w+x)*4;pixels.set([value,value,value,1],i);
  }
  const environment=new THREE.DataTexture(pixels,w,h,THREE.RGBAFormat,THREE.FloatType);environment.mapping=THREE.EquirectangularReflectionMapping;environment.needsUpdate=true;
  const pmrem=new THREE.PMREMGenerator(renderer),env=pmrem.fromEquirectangular(environment);pmrem.dispose();scene.environment=env.texture;scene.environmentIntensity=.7;
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(1600,1600),new THREE.ShadowMaterial({opacity:.12}));floor.position.z=-2.4;floor.receiveShadow=true;scene.add(floor);
  const state={wrist:0,gap:29,reveal:false,incidence:60,rotation:0,rays:true,tilt:0,frame:0,playing:false};
  const meshes=[],ownedMaterials=[],records=[];let manifest,fluid,opticalGroup,prism,laser,resize,initialized=false,disposed=false,frame=0,yaw=-.82,pitch=.52,distance=470,target=new THREE.Vector3(25,0,70),drag,lastFlow=0,flowPending=false;
  const materialFor=m=>{
    const color=new THREE.Color(...(m.color||[.6,.65,.68]));
    const material=new THREE.MeshPhysicalMaterial({color,metalness:m.metalness??0,roughness:m.roughness??.3,
      transmission:m.transmission??0,ior:m.ior??1.5,thickness:m.transmission?5:0,clearcoat:m.coat??0,side:m.transmission?THREE.FrontSide:THREE.DoubleSide});
    ownedMaterials.push(material);return material;
  };
  const abort=()=>{if(signal?.aborted)throw new DOMException('Selection changed','AbortError');};
  function geometry(record,buffer){
    const g=new THREE.BufferGeometry();
    for(const [key,attribute,size,Type] of [['positions','position',3,Float32Array],['normals','normal',3,Int16Array]]){
      const s=record[key];g.setAttribute(attribute,new THREE.BufferAttribute(new Type(buffer,s.offset,s.count),size,Type===Int16Array));
    }
    const s=record.indices;g.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer,s.offset,s.count),1));g.computeBoundingSphere();return g;
  }
  try{
    if(name!=='light'){
      const base=`./assets/specimens/${name}/`;manifest=await fetch(base+'manifest.json',{signal}).then(r=>{if(!r.ok)throw Error('Specimen metadata unavailable');return r.json();});abort();
      const response=await fetch(base+manifest.geometry.file+'?v='+(manifest.geometry.compressedSHA256||manifest.geometry.sha256),{signal});if(!response.ok)throw Error('Specimen geometry unavailable');
      const buffer=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();abort();
      if(buffer.byteLength!==manifest.geometry.decodedBytes)throw Error('Specimen geometry revision mismatch');
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),x=>x.toString(16).padStart(2,'0')).join('');
      if(digest!==manifest.geometry.sha256)throw Error('Specimen geometry verification failed');
      const materials=manifest.materials.map(materialFor);materials[4]??=materialFor({color:[.45,.01,.035],metalness:.12,roughness:.3});
      for(const record of manifest.parts){const mesh=new THREE.Mesh(geometry(record,buffer),materials[record.material]||materials[0]);mesh.name=record.name;mesh.castShadow=record.material!==3;mesh.receiveShadow=true;root.add(mesh);meshes.push(mesh);records.push(record);}
      if(name==='elements'){
        target.set(0,0,5);distance=260;floor.position.z=-40;
        const water=materialFor({color:[.36,.72,.75],transmission:.7,ior:1.333,roughness:.06});water.transparent=true;water.opacity=.85;water.depthWrite=false;water.attenuationDistance=90;water.attenuationColor=new THREE.Color(.55,.85,.86);
        fluid=await loadFluid(root,()=>{invalidate();publish();},{base:'./assets/instrument-elements-bake/water-shared-v3/',material:water});abort();
        for(const mesh of meshes)if(mesh.material.transmission>0){mesh.material.transparent=true;mesh.material.opacity=.22;mesh.material.transmission=.35;mesh.material.depthWrite=false;mesh.renderOrder=3;}
      }
    }else{
      target.set(25,0,83);distance=440;yaw=-2.1;manifest={name:'light',source:{recipe:'cybr-light/examples/prism.py',...PRISM_SOURCE},geometry:{bytes:0},parts:[]};
      const v=[];for(const y of [-1,1])for(const [x,z] of PRISM_SOURCE.crossSection)v.push(x*50,y*50,z*50);
      const faces=[[0,1,2],[3,5,4],[0,3,4],[0,4,1],[1,4,5],[1,5,2],[2,5,3],[2,3,0]],center=new THREE.Vector3(-50/6,0,0);
      for(const f of faces){const a=new THREE.Vector3().fromArray(v,f[0]*3),b=new THREE.Vector3().fromArray(v,f[1]*3),c=new THREE.Vector3().fromArray(v,f[2]*3);if(b.clone().sub(a).cross(c.clone().sub(a)).dot(a.clone().add(b).add(c).multiplyScalar(1/3).sub(center))<0)f.reverse();}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(faces.flat());
      const planar=g.toNonIndexed();planar.computeVertexNormals();g.dispose();
      prism=new THREE.Mesh(planar,materialFor({color:[.83,.94,.98],transmission:1,roughness:.04,ior:cauchyIndex(550)}));prism.material.thickness=65;prism.position.z=90;root.add(prism);meshes.push(prism);
      const edges=new THREE.LineSegments(new THREE.EdgesGeometry(planar),new THREE.LineBasicMaterial({color:0x6c929e,transparent:true,opacity:.45}));prism.add(edges);
      for(const y of [-58,58]){
        const stand=new THREE.Mesh(new THREE.CylinderGeometry(2.5,2.5,90,24),materialFor({color:[.15,.17,.18],metalness:.8,roughness:.3}));stand.rotation.x=Math.PI/2;stand.position.set(0,y,45);root.add(stand);meshes.push(stand);
        const spindle=new THREE.Mesh(new THREE.CylinderGeometry(3,3,14,24),stand.material);spindle.position.set(0,Math.sign(y)*56,90);root.add(spindle);meshes.push(spindle);
      }
      const detector=new THREE.Mesh(new THREE.BoxGeometry(2,64,136),materialFor({color:[.12,.13,.14],metalness:.2,roughness:.48}));detector.position.set(121,0,110);root.add(detector);meshes.push(detector);
      const screen=new THREE.Mesh(new THREE.PlaneGeometry(130,60),materialFor({color:[.96,.96,.94],metalness:0,roughness:.8}));screen.rotation.y=-Math.PI/2;screen.position.set(119.85,0,110);root.add(screen);meshes.push(screen);
      for(const y of [-24,24]){const post=new THREE.Mesh(new THREE.CylinderGeometry(2.5,2.5,42,24),detector.material);post.rotation.x=Math.PI/2;post.position.set(121,y,21);root.add(post);meshes.push(post);}
      const foot=new THREE.Mesh(new THREE.BoxGeometry(20,78,3),detector.material);foot.position.set(121,0,1.5);root.add(foot);meshes.push(foot);
      laser=new THREE.Mesh(new THREE.CylinderGeometry(5,5,23,32),materialFor({color:[.07,.08,.09],metalness:.7,roughness:.3}));root.add(laser);meshes.push(laser);opticalGroup=new THREE.Group();root.add(opticalGroup);
    }
    abort();host.append(renderer.domElement);renderer.domElement.setAttribute('aria-label',`${name.toUpperCase()} interactive specimen`);renderer.domElement.style.touchAction='pan-y';
    apply();fit();await renderer.compileAsync(scene,camera);abort();initialized=true;render();publish();
  }catch(error){dispose();throw error;}
  function fit(){
    const width=host.clientWidth,height=host.clientHeight;renderer.setSize(width,height,false);camera.aspect=width/height;
    const scale=camera.aspect<1?1.45:1;
    camera.position.set(target.x+Math.cos(yaw)*Math.cos(pitch)*distance*scale,target.y+Math.sin(yaw)*Math.cos(pitch)*distance*scale,target.z+Math.sin(pitch)*distance*scale);camera.lookAt(target);camera.updateProjectionMatrix();
  }
  function apply(){
    if(name==='geo')meshes.forEach((mesh,i)=>{mesh.matrixAutoUpdate=false;mesh.matrix.copy(orbitPose(THREE,records[i].motion,state));mesh.visible=!state.reveal||!['housing','cover','cover_fasteners'].includes(records[i].group);});
    else if(name==='elements')root.rotation.x=state.tilt*Math.PI/180;
    else{
      prism.rotation.y=-state.rotation*Math.PI/180;
      for(const mesh of [...opticalGroup.children]){mesh.geometry.dispose();mesh.material.dispose();opticalGroup.remove(mesh);}
      const palette=[0x8139e6,0x455ce9,0x168ed0,0x22b89f,0x79b732,0xd8b920,0xed8d25,0xe45c30,0xd6333b];
      for(let i=0;i<9;i++){
        const path=prismPath(430+i*33.75,state),points=path.points.map(p=>new THREE.Vector3(p[0]*50,0,p[1]*50+90));
        const start=i===0?0:1;
        for(let j=start;j<points.length-1;j++){
          const curve=new THREE.LineCurve3(points[j],points[j+1]);
          if(j===0){const outline=new THREE.Mesh(new THREE.TubeGeometry(curve,1,.95,8,false),new THREE.MeshBasicMaterial({color:0x85969c,transparent:true,opacity:.35}));opticalGroup.add(outline);}
          const beam=new THREE.Mesh(new THREE.TubeGeometry(curve,1,j===0?.65:.3,6,false),new THREE.MeshBasicMaterial({color:j===0?0xffffff:palette[i],transparent:true,opacity:j===0?.85:.8}));opticalGroup.add(beam);
        }
        if(path.detector){const dot=new THREE.Mesh(new THREE.SphereGeometry(1.1,12,8),new THREE.MeshBasicMaterial({color:palette[i]}));dot.position.copy(points.at(-1));dot.position.x=119.65;opticalGroup.add(dot);}
        if(i===0){laser.position.copy(points[0]);laser.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),points[1].clone().sub(points[0]).normalize());}
      }
      opticalGroup.visible=state.rays;
    }
    invalidate();publish();
  }
  function snapshot(){return {ready:initialized&&!disposed,model:name,source:manifest?.source,compressedBytes:manifest?.geometry.bytes,parts:manifest?.parts.length,state:{...state},fluid:fluid?.snapshot(),optics:name==='light'?{violet:prismPath(430,state),red:prismPath(700,state)}:undefined};}
  function publish(){onChange(snapshot());}
  async function tickFluid(now){
    if(!fluid||flowPending||now-lastFlow<90)return;lastFlow=now;flowPending=true;
    try{state.frame=(state.frame+1)%fluid.frameCount;await fluid.setFrame(state.frame);publish();}catch{state.playing=false;}finally{flowPending=false;}
  }
  function render(now=performance.now()){
    frame=0;if(disposed)return;fit();renderer.render(scene,camera);
    if(state.playing&&!document.hidden){
      if(name==='geo'){const seconds=now/1000;state.wrist=18*Math.sin(seconds*Math.PI/4);state.gap=27.8+6*Math.cos(seconds*Math.PI/4);apply();}
      else if(name==='elements')void tickFluid(now);
      else{state.rotation=5*Math.sin(now/1800);apply();}
      invalidate();
    }
  }
  function invalidate(){if(initialized&&!frame&&!disposed)frame=requestAnimationFrame(render);}
  resize=new ResizeObserver(invalidate);resize.observe(host);
  const canvas=renderer.domElement;
  function down(e){drag={id:e.pointerId,x:e.clientX,y:e.clientY,yaw,pitch};}
  function move(e){if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)<6)return;canvas.setPointerCapture(e.pointerId);yaw=drag.yaw-dx*.008;pitch=Math.max(.08,Math.min(1.25,drag.pitch+dy*.006));invalidate();}
  function up(){drag=undefined;}
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
  function dispose(){
    if(disposed)return;disposed=true;cancelAnimationFrame(frame);fluid?.dispose();
    resize?.disconnect();
    scene.traverse(object=>{object.geometry?.dispose();if(object.material){for(const m of Array.isArray(object.material)?object.material:[object.material])m.dispose();}});
    env.dispose();environment.dispose();renderer.dispose();renderer.domElement.remove();
  }
  return {snapshot,set(patch){Object.assign(state,patch);apply();if(patch.frame!==undefined&&fluid)void fluid.setFrame(state.frame).then(publish);},dispose};
}
