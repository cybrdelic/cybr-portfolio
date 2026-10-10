import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as THREE from './vendor/three-r180/three.module.min.js';
import {attachMetalCoordinates,METAL_STYLES,METAL_CHARTS,METAL_PROFILE_PITCH_MM} from './instrument-metal-coordinates.mjs';

const manifest=JSON.parse(readFileSync(new URL('./assets/instrument-working-v1/manifest.json',import.meta.url)));
const decoded=gunzipSync(readFileSync(new URL('./assets/instrument-working-v1/instrument.bin.gz',import.meta.url)));
const buffer=decoded.buffer.slice(decoded.byteOffset,decoded.byteOffset+decoded.byteLength);
const close=(actual,expected,tolerance=2e-4)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const hash=attribute=>createHash('sha256').update(new Uint8Array(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength)).digest('hex');
function attribute(spec,size){const Type=spec.dtype==='int16'?Int16Array:spec.dtype==='uint32'?Uint32Array:Float32Array;return new THREE.BufferAttribute(new Type(buffer,spec.offset,spec.count),size,Type===Int16Array);}
function loadMesh(record){
  const geometry=new THREE.BufferGeometry();
  for(const [name,key,size] of[['position','positions',3],['normal','normals',3],['uv','uv',2]])geometry.setAttribute(name,attribute(record[key],size));
  geometry.setIndex(attribute(record.indices,1));
  const summary=attachMetalCoordinates({THREE,geometry,mesh:record,materialIndex:record.material});
  return {record,geometry,summary};
}
const cache=new Map();
function part(name){
  const record=manifest.meshes.find(mesh=>mesh.partNames.includes(name));assert.ok(record,name+' exists in the production package');
  if(!cache.has(record.feature))cache.set(record.feature,loadMesh(record));
  const loaded=cache.get(record.feature),range=record.partRanges.find(range=>range.name===name),metadata=loaded.summary.parts.find(part=>part.name===name);
  return {...loaded,range,metadata};
}
function vertices(p){return Array.from({length:p.range.vertexCount},(_,i)=>p.range.firstVertex+i);}
function coordinates(p,i){const a=p.geometry.getAttribute('metalUv');return [a.getX(i),a.getY(i)];}
function style(p,i){return p.geometry.getAttribute('metalStyle').getX(i);}
function xyz(p,i){const a=p.geometry.getAttribute('position'),c=p.metadata.originMM;return [a.getX(i)-c[0],a.getY(i)-c[1],a.getZ(i)-c[2]];}

test('production metal charts preserve every native position, normal, index and original UV byte',()=>{
  for(const record of manifest.meshes){
    const geometry=new THREE.BufferGeometry();
    for(const [name,key,size] of[['position','positions',3],['normal','normals',3],['uv','uv',2]])geometry.setAttribute(name,attribute(record[key],size));
    geometry.setIndex(attribute(record.indices,1));
    const originals=[geometry.getAttribute('position'),geometry.getAttribute('normal'),geometry.getAttribute('uv'),geometry.index],before=originals.map(hash);
    const summary=attachMetalCoordinates({THREE,geometry,mesh:record,materialIndex:record.material});
    [geometry.getAttribute('position'),geometry.getAttribute('normal'),geometry.getAttribute('uv'),geometry.index].forEach((value,i)=>{assert.equal(value,originals[i]);assert.equal(hash(value),before[i]);});
    assert.equal(geometry.getAttribute('metalUv').count,originals[0].count);assert.equal(geometry.getAttribute('metalStyle').count,originals[0].count);
    assert.equal(geometry.getAttribute('metalLocalPosition').count,originals[0].count);assert.equal(geometry.getAttribute('metalChart').count,originals[0].count);
    assert.equal(geometry.getAttribute('metalWearPhase').count,originals[0].count);assert.equal(geometry.getAttribute('metalWearBounds').count,originals[0].count);
    assert.equal(Object.values(summary.styleCounts).reduce((sum,value)=>sum+value,0),summary.vertexCount);
    assert.ok(geometry.getAttribute('metalUv').array.every(Number.isFinite));
    assert.ok(geometry.getAttribute('metalLocalPosition').array.every(Number.isFinite));assert.ok(geometry.getAttribute('metalChart').array.every(Number.isFinite));
  }
});

test('wear phases and physical bounds are constant per native part and reproduce independently of attachment order',()=>{
  const names=['geo__front_mount','geo__front_mount_bolt_0_head','geo__front_mount_bolt_1_head','geo__takeup_guard_-35','geo__rear_mount','song__dished_cymbal_0','scenes_bored_ceramic_landscape_carrier'];
  const first=new Map();
  for(const name of names){
    const p=part(name),phase=p.geometry.getAttribute('metalWearPhase'),wearBounds=p.geometry.getAttribute('metalWearBounds'),position=p.geometry.getAttribute('position');
    assert.equal(phase.itemSize,2);assert.equal(wearBounds.itemSize,2);
    const i=p.range.firstVertex,expectedPhase=[phase.getX(i),phase.getY(i)],axis=p.metadata.axis==='Z'?2:0;
    const along=vertices(p).map(j=>axis===2?position.getZ(j):position.getX(j));
    const expectedHalfLength=(Math.max(...along)-Math.min(...along))*.5;
    for(const j of vertices(p)){
      assert.deepEqual([phase.getX(j),phase.getY(j)],expectedPhase);
      assert.ok(phase.getX(j)>=0&&phase.getX(j)<1&&phase.getY(j)>=0&&phase.getY(j)<1);
      close(wearBounds.getX(j),p.metadata.outerRadiusMM);close(wearBounds.getY(j),expectedHalfLength);
    }
    first.set(name,{phase:expectedPhase,bounds:[wearBounds.getX(i),wearBounds.getY(i)]});
  }
  assert.equal(new Set(Array.from(first.values(),entry=>entry.phase.join(','))).size,names.length,'different named parts do not repeat a fingerprint offset');
  for(const name of names.slice().reverse()){
    const p=part(name),reload=loadMesh(p.record),range=reload.record.partRanges.find(entry=>entry.name===name);
    const phase=reload.geometry.getAttribute('metalWearPhase'),wearBounds=reload.geometry.getAttribute('metalWearBounds'),i=range.firstVertex;
    assert.deepEqual([phase.getX(i),phase.getY(i)],first.get(name).phase);
    assert.deepEqual([wearBounds.getX(i),wearBounds.getY(i)],first.get(name).bounds);
    for(const attr of ['metalUv','metalStyle','metalLocalPosition','metalChart'])assert.equal(hash(reload.geometry.getAttribute(attr)),hash(p.geometry.getAttribute(attr)),attr+' stays identical when wear attributes are regenerated');
  }
});

test('main shell outer barrel has axial brushing and its end faces have radial turning in mm',()=>{
  const p=part('geo__slotted_shell'),indices=vertices(p),brushed=indices.filter(i=>style(p,i)===METAL_STYLES.brushed),normal=p.geometry.getAttribute('normal');
  assert.ok(brushed.length>100);
  for(const i of brushed){const [x,y,z]=xyz(p,i);close(coordinates(p,i)[0],x);assert.ok(Math.hypot(y,z)>=41.8);}
  const caps=indices.filter(i=>Math.abs(normal.getX(i))>.99);assert.ok(caps.length>10);
  for(const i of caps){const [,y,z]=xyz(p,i);assert.equal(style(p,i),METAL_STYLES.turned);close(coordinates(p,i)[1],Math.hypot(y,z));}
  const points=brushed.filter(i=>Math.abs(xyz(p,i)[1])<1&&xyz(p,i)[2]>41.5);
  assert.ok(points.length>1);const a=points[0],b=points.at(-1);close(coordinates(p,b)[0]-coordinates(p,a)[0],xyz(p,b)[0]-xyz(p,a)[0]);
});

test('48 actual grip inserts retain their individual geometry and polymer finish',()=>{
  const names=Object.keys(manifest.namedParts).filter(name=>name.startsWith('geo__service_grip_'));
  assert.equal(names.length,48);
  for(const name of names){const p=part(name);assert.ok(p.range.indexCount>=36);assert.ok(vertices(p).every(i=>style(p,i)===METAL_STYLES.disabled));}
});

test('both retaining bezels retain closed radial and barrel machining charts',()=>{
  for(const name of ['light__front_retaining_bezel','light__rear_retaining_bezel']){
    const p=part(name),chart=p.geometry.getAttribute('metalChart');
    assert.ok(vertices(p).every(i=>style(p,i)===METAL_STYLES.turned));
    assert.ok(vertices(p).some(i=>chart.getX(i)===METAL_CHARTS.polarRadial));
    assert.ok(vertices(p).some(i=>chart.getX(i)===METAL_CHARTS.polarBarrel));
  }
});

test('all three bronze cymbals have radial turning continuously across both shallow and steep bell surfaces',()=>{
  for(let k=0;k<3;k++){
    const p=part('song__dished_cymbal_'+k),n=p.geometry.getAttribute('normal');let shallow=0,steep=0;
    assert.equal(p.record.material,8);
    for(const i of vertices(p)){const [,y,z]=xyz(p,i);assert.equal(style(p,i),METAL_STYLES.turned);close(coordinates(p,i)[1],Math.hypot(y,z));if(Math.abs(n.getX(i))>.7)shallow++;else steep++;}
    assert.ok(shallow>100&&steep>100,'the bell is covered across the old cap chart threshold');
  }
});

test('both actual spoke-supported takeup guards use planar brushed face charts without a shifted polar center',()=>{
  const names=Object.keys(manifest.namedParts).filter(name=>name.startsWith('geo__takeup_guard_')).sort();
  assert.deepEqual(names,['geo__takeup_guard_-35','geo__takeup_guard_35']);
  for(const name of names){
    const p=part(name),normal=p.geometry.getAttribute('normal'),chart=p.geometry.getAttribute('metalChart');
    assert.equal(p.record.material,1);assert.equal(p.metadata.mode,'planar-X');
    const caps=vertices(p).filter(i=>Math.abs(normal.getX(i))>.99);assert.ok(caps.length>100);
    for(const i of vertices(p)){assert.equal(style(p,i),METAL_STYLES.brushed);assert.equal(chart.getX(i),METAL_CHARTS.linear);}
    // Physical Y/Z distances on the broad faces remain unchanged by the
    // asymmetric spokes' AABB origin. No angular/radial coordinate is sampled.
    for(const i of caps){const [,y,z]=xyz(p,i),[u,v]=coordinates(p,i);close(u,y);close(v,z);}
    const a=caps[0],b=caps.at(-1),position=p.geometry.getAttribute('position');
    close(coordinates(p,b)[0]-coordinates(p,a)[0],position.getY(b)-position.getY(a));
    close(coordinates(p,b)[1]-coordinates(p,a)[1],position.getZ(b)-position.getZ(a));
  }
});

test('GEO replaces unsupported vanes and floating interfaces with seated endplates',()=>{
  assert.ok(!Object.keys(manifest.namedParts).some(name=>/geo__helical_stator_|geo__bearing_|geo__detached_interface/.test(name)));
  const shell=manifest.namedParts.geo__slotted_shell.boundsMM;
  const rear=manifest.namedParts.geo__rear_mount.boundsMM;
  const front=manifest.namedParts.geo__front_mount.boundsMM;
  close(rear[1][0],shell[0][0]);close(shell[1][0],front[0][0]);
  for(const name of ['geo__rear_service_sleeve','geo__front_service_sleeve'])assert.ok(manifest.namedParts[name]);
});

test('felt, glass, polymers and seals stay disabled while named black metal remains eligible',()=>{
  for(const name of['song__felt_washer_0','song__felt_washer_1','song__felt_washer_2','light__rear_cell','elements__port_seal_-1','elements__vessel_port_gasket_1']){
    const p=part(name);assert.ok(vertices(p).every(i=>style(p,i)===METAL_STYLES.disabled),name);
  }
  for(const name of['geo__graphite_inner_liner','light__collimation_adjuster_0_head']){const p=part(name);assert.ok(vertices(p).every(i=>style(p,i)===METAL_STYLES.turned),name);}
  for(const record of manifest.meshes.filter(mesh=>![0,1,2,8,9].includes(mesh.material))){const loaded=cache.get(record.feature)||loadMesh(record);assert.equal(loaded.summary.activeVertices,0,record.feature+' contains no authored machining finish');}
});

test('combat deck top uses an XY brush chart and the specimen pan uses its real Z turning axis',()=>{
  const deck=part('combat_horizontal_moving_deck'),n=deck.geometry.getAttribute('normal'),top=vertices(deck).filter(i=>n.getZ(i)>.99);assert.ok(top.length>10);
  for(const i of top){const [x,y]=xyz(deck,i);assert.equal(style(deck,i),METAL_STYLES.brushed);const [u,v]=coordinates(deck,i);close(u,x);close(v,y);}
  const pan=part('scenes_bored_ceramic_landscape_carrier'),pn=pan.geometry.getAttribute('normal');assert.equal(pan.metadata.axis,'Z');
  const caps=vertices(pan).filter(i=>Math.abs(pn.getZ(i))>.99),walls=vertices(pan).filter(i=>Math.abs(pn.getZ(i))<.05);assert.ok(caps.length>100&&walls.length>100);
  for(const i of caps){const [x,y]=xyz(pan,i);close(coordinates(pan,i)[1],Math.hypot(x,y));}
  for(const i of walls){const [,,z]=xyz(pan,i);close(coordinates(pan,i)[1],z);}
});

test('part-local Cartesian finish positions preserve actual native origins and X/Z machining axes',()=>{
  for(const name of['geo__front_mount_bolt_0_head','geo__slotted_shell','geo__turned_shoulder_-36','song__dished_cymbal_0','scenes_bored_ceramic_landscape_carrier']){
    const p=part(name),local=p.geometry.getAttribute('metalLocalPosition'),chart=p.geometry.getAttribute('metalChart');
    for(const i of vertices(p)){
      const [x,y,z]=xyz(p,i),expected=p.metadata.axis==='Z'?[z,x,y]:[x,y,z];
      [local.getX(i),local.getY(i),local.getZ(i)].forEach((value,k)=>close(value,expected[k]));
      close(chart.getY(i),p.metadata.periodicCircumferenceMM??p.metadata.circumferenceMM);
      if(name.startsWith('song__'))assert.equal(chart.getX(i),METAL_CHARTS.polarRadial);
      if(name==='geo__turned_shoulder_-36'&&style(p,i)===METAL_STYLES.diamondKnurl)assert.equal(chart.getX(i),METAL_CHARTS.polarBarrel);
      if(name==='geo__slotted_shell'&&style(p,i)===METAL_STYLES.brushed)assert.equal(chart.getX(i),METAL_CHARTS.axialBrush);
    }
  }
});

test('fragment reconstruction corrects radial interpolation across large native front-interface CAD triangles',()=>{
  const p=part('geo__front_mount'),index=p.geometry.index,local=p.geometry.getAttribute('metalLocalPosition'),chart=p.geometry.getAttribute('metalChart');
  let largestError=0,example;
  for(let k=p.range.firstIndex;k<p.range.firstIndex+p.range.indexCount;k+=3){
    const ids=[index.getX(k),index.getX(k+1),index.getX(k+2)];if(!ids.every(i=>chart.getX(i)===METAL_CHARTS.polarRadial))continue;
    const y=ids.reduce((sum,i)=>sum+local.getY(i),0)/3,z=ids.reduce((sum,i)=>sum+local.getZ(i),0)/3;
    const exactRadius=Math.hypot(y,z),interpolatedVertexRadius=ids.reduce((sum,i)=>sum+coordinates(p,i)[1],0)/3,error=interpolatedVertexRadius-exactRadius;
    if(error>largestError){largestError=error;example={ids,y,z,exactRadius,interpolatedVertexRadius};}
  }
  assert.ok(largestError>.1,'production CAD has radial interpolation errors larger than a fine turned-line pitch');
  const center=example.ids.reduce((sum,i)=>{const [,y,z]=xyz(p,i);sum[0]+=y/3;sum[1]+=z/3;return sum;},[0,0]);
  close(example.exactRadius,Math.hypot(...center));
  assert.ok(example.interpolatedVertexRadius-example.exactRadius>.1,'new Cartesian attributes retain the data needed for a smooth fragment radius');
});

test('invalid part ranges fail before silently assigning a neighboring part finish',()=>{
  const geometry=new THREE.BoxGeometry();assert.throws(()=>attachMetalCoordinates({THREE,geometry,materialIndex:0,mesh:{module:'geo',partRanges:[{name:'bad',firstVertex:1,vertexCount:100000}]}}),/Invalid native metal part vertex range/);
});
