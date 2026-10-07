// Read-only source-geometry, routing and camera audit. Writes numerical evidence
// only; does not alter models, route specifications, motion or bake assets.
// node portfolio/instrument/audit-cartridge-motion.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import * as THREE from '../vendor/three-r180/three.module.min.js';
import {span,takeup,takeupForLength,internal,length,distance} from '../instrument-routing.js';

const root=new URL('../',import.meta.url),base=new URL('assets/instrument-cartridges-c/',root);
const read=path=>JSON.parse(fs.readFileSync(path,'utf8'));
const manifest=read(new URL('manifest.json',base)),spec=read(new URL('route.json',base));
const names=manifest.modules.map(m=>m.name),exploded=manifest.modules.map(m=>m.explodedX);
const clamp=x=>Math.max(0,Math.min(1,x)),mix=(a,b,t)=>a+(b-a)*t;
const smooth=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10);};
const raw=zlib.gunzipSync(fs.readFileSync(new URL('instrument.bin.gz',base)));
const sourceHash=crypto.createHash('sha256').update(raw).digest('hex');
if(sourceHash!==manifest.stats.sha256||raw.length!==manifest.stats.decodedGeometryBytes)throw Error('Geometry revision mismatch');
const meshBounds=manifest.meshes.map(mesh=>{
  const values=new Float32Array(raw.buffer,raw.byteOffset+mesh.positions.offset,mesh.positions.count);
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<values.length;i++){
    const axis=i%3;lo[axis]=Math.min(lo[axis],values[i]);hi[axis]=Math.max(hi[axis],values[i]);
  }
  return {name:mesh.module+'/'+mesh.feature+'/'+mesh.material,module:mesh.module,shift:mesh.assemblyShiftX||0,lo,hi};
});
const localBounds=(name,c)=>{
  const members=meshBounds.filter(m=>m.module===name);
  return [Math.min(...members.map(m=>m.lo[0]+m.shift*c)),Math.max(...members.map(m=>m.hi[0]+m.shift*c))];
};
const offsetsAt=c=>exploded.map((x,i)=>mix(x,spec.assembled[i],c));
const portsAt=offsets=>Object.fromEntries(names.map((name,i)=>[name,spec.ports[name].map(p=>[p[0]+offsets[i],p[1],p[2]])]));
const spansAt=offsets=>{const ports=portsAt(offsets);return names.slice(0,-1).map((name,i)=>span(ports[name][1],ports[names[i+1]][0]));};
const reference=spansAt(exploded).reduce((sum,points)=>sum+length(points),0)+length(takeup(1));
function partsAt(c){
  const offsets=offsetsAt(c),spans=spansAt(offsets),external=spans.reduce((sum,points)=>sum+length(points),0);
  const coil=takeupForLength(reference-external).map(p=>[p[0]+offsets[0],p[1],p[2]]),parts=[{name:'geo-takeup',points:coil}];
  spans.forEach((points,i)=>{
    parts.push({name:names[i]+'-'+names[i+1],points});
    const name=names[i+1],local=spec.internalRoutes?.[name]
      ?new THREE.CatmullRomCurve3(spec.internalRoutes[name].map(p=>new THREE.Vector3(...p)),false,'centripetal').getPoints(120).map(p=>p.toArray())
      :internal(name,spec.ports[name]);
    parts.push({name:name+'-internal',points:local.map(p=>[p[0]+offsets[i+1],p[1],p[2]])});
  });
  return {offsets,spans,coil,parts,lengthError:Math.abs(external+length(coil)-reference)};
}
function joins(parts){return parts.slice(1).map((part,i)=>{
  const before=parts[i].points,after=part.points,a=new THREE.Vector3(...before.at(-1)).sub(new THREE.Vector3(...before.at(-2))),b=new THREE.Vector3(...after[1]).sub(new THREE.Vector3(...after[0]));
  return {at:parts[i].name+' → '+part.name,gapMM:distance(before.at(-1),after[0]),tangentAngleDeg:a.lengthSq()&&b.lengthSq()?THREE.MathUtils.radToDeg(a.angleTo(b)):null};
});}
function inverseSmooth(wanted){let lo=0,hi=1;for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(smooth(mid)<wanted)lo=mid;else hi=mid;}return (lo+hi)/2;}
const crossing=names.slice(0,-1).flatMap((name,i)=>{
  const initial=spec.ports[names[i+1]][0][0]+exploded[i+1]-spec.ports[name][1][0]-exploded[i];
  const final=spec.ports[names[i+1]][0][0]+spec.assembled[i+1]-spec.ports[name][1][0]-spec.assembled[i];
  if(initial*final>=0)return [];
  const c=initial/(initial-final),state=partsAt(c),segment=state.spans[i];
  return [{interface:name+'-'+names[i+1],initialPortGapMM:initial,assembledPortGapMM:final,condense:c,
    scrollProgress:.035+.245*inverseSmooth(c),collapsedSpanLengthMM:length(segment),maximumSegmentLengthMM:Math.max(...segment.slice(1).map((p,j)=>distance(segment[j],p)))}];
});
const states=Array.from({length:41},(_,i)=>{
  const c=i/40,state=partsAt(c),ports=portsAt(state.offsets),junctions=joins(state.parts);
  return {condense:c,scrollProgress:.035+.245*inverseSmooth(c),lengthErrorMM:state.lengthError,
    portGapsMM:names.slice(0,-1).map((name,j)=>ports[names[j+1]][0][0]-ports[name][1][0]),
    envelopeGapsMM:names.slice(0,-1).map((name,j)=>state.offsets[j+1]+localBounds(names[j+1],c)[0]-state.offsets[j]-localBounds(name,c)[1]),
    maxJoinGapMM:Math.max(...junctions.map(j=>j.gapMM)),maximumJoinAngleDeg:Math.max(...junctions.map(j=>j.tangentAngleDeg??0)),
    reversingJoins:junctions.filter(j=>j.tangentAngleDeg>170)};
});
function liveCamera(p){
  const c=smooth((p-.035)/.245),state=partsAt(c),offsets=state.offsets;
  const path=[[-47+offsets[0],0,0],[61+offsets[0],0,0]];
  state.parts.slice(1).forEach(part=>path.push(...part.points.slice(1)));
  const route=new THREE.CatmullRomCurve3(path.map(p=>new THREE.Vector3(...p)),false,'centripetal');
  const turn=smooth((p-.28)/.18),travel=clamp((p-.46)/.44),exit=smooth((p-.90)/.10);
  const entry=route.getPointAt(0),entryOffset=new THREE.Vector3(-55,-80*Math.cos(.5),80*Math.sin(.5));
  const pivot=new THREE.Vector3(mix(35,60,c),0,0).lerp(entry,turn);
  const direction=new THREE.Vector3(50,-80,50).normalize().lerp(entryOffset.clone().normalize(),turn).normalize();
  const eye=pivot.clone().addScaledVector(direction,mix(6000,entryOffset.length(),turn)),look=pivot.clone();
  let height=mix(400,2*entryOffset.length()*Math.tan(THREE.MathUtils.degToRad(34)),turn);
  if(p>.46){
    const dive=smooth(travel/.13),point=route.getPointAt(travel),ahead=route.getPointAt(Math.min(1,travel+.018));
    const angle=.5+.45*Math.sin(travel*Math.PI),inspectionEye=point.clone().add(new THREE.Vector3(-55,-80*Math.cos(angle),80*Math.sin(angle)));
    if(point.distanceTo(ahead)<1)ahead.add(new THREE.Vector3(10,0,0));
    eye.lerp(inspectionEye,dive);look.lerp(ahead,dive);height=mix(height,2*eye.distanceTo(look)*Math.tan(THREE.MathUtils.degToRad(34)),dive);
  }
  if(exit>0){eye.lerp(new THREE.Vector3(620,-420,285),exit);look.lerp(new THREE.Vector3(40,0,0),exit);height=mix(height,370,exit);}
  const camera=new THREE.Camera();camera.position.copy(eye);camera.up.set(0,0,1);camera.lookAt(look);camera.updateMatrixWorld();
  const d=Math.max(1,eye.distanceTo(look)),near=p>.46&&p<.9?.05:Math.max(.2,d-650),far=d+750;
  const ortho=new THREE.OrthographicCamera(-height*1.6/2,height*1.6/2,height/2,-height/2,near,far);
  const perspective=new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2*Math.atan(height/2/d)),1.6,near,far);
  for(let i=0;i<16;i++)camera.projectionMatrix.elements[i]=mix(ortho.projectionMatrix.elements[i],perspective.projectionMatrix.elements[i]/d,turn);
  return {camera,condense:c,offsets,routeLengthMM:route.getLength()};
}
function frameAudit(file){
  const doc=read(file);return {file:file.pathname,sourceGeometry:doc.sourceGeometry,frames:doc.frames.map(frame=>{
    const live=liveCamera(frame.progress),sourceWorld=new THREE.Matrix4().fromArray(frame.world),sourcePosition=new THREE.Vector3().setFromMatrixPosition(sourceWorld),sourceRotation=new THREE.Quaternion().setFromRotationMatrix(sourceWorld);
    return {index:frame.index,progress:frame.progress,groupMaxErrorMM:Math.max(...frame.groups.map(group=>Math.abs(group.x-live.offsets[names.indexOf(group.name)]))),
      objectMaxShiftErrorMM:Math.max(0,...frame.objects.map(o=>{const mesh=manifest.meshes.find(m=>m.module+'/'+m.feature+'/'+m.material===o.name);return Math.abs((mesh?.assemblyShiftX||0)*live.condense-(o.shift||0));})),
      cameraPositionErrorMM:sourcePosition.distanceTo(live.camera.position),cameraRotationErrorDeg:THREE.MathUtils.radToDeg(sourceRotation.angleTo(live.camera.quaternion)),
      maxProjectionElementDifference:Math.max(...frame.projection.map((v,i)=>Math.abs(v-live.camera.projectionMatrix.elements[i])))};
  })};
}
const targetAudit=frameAudit(new URL('assets/instrument-targeted-path/manifest.json',root));
const legacyAudit=frameAudit(new URL('assets/instrument-path-light/manifest.json',root));
const minimumHousingGapMM=8,proposedAssembled=[...spec.assembled],proposedExploded=[...exploded];
for(let i=4;i<names.length;i++){
  proposedAssembled[i]=Math.max(proposedAssembled[i],proposedAssembled[i-1]+localBounds(names[i-1],1)[1]-localBounds(names[i],1)[0]+minimumHousingGapMM);
  proposedExploded[i]=Math.max(proposedExploded[i],proposedExploded[i-1]+localBounds(names[i-1],0)[1]-localBounds(names[i],0)[0]+minimumHousingGapMM);
}
const proposedEndpointGaps=[0,1].map(c=>({condense:c,portGapsMM:names.slice(0,-1).map((name,i)=>{
  const offsets=proposedExploded.map((x,j)=>mix(x,proposedAssembled[j],c));return spec.ports[names[i+1]][0][0]+offsets[i+1]-spec.ports[name][1][0]-offsets[i];
}),envelopeGapsMM:names.slice(0,-1).map((name,i)=>{
  const offsets=proposedExploded.map((x,j)=>mix(x,proposedAssembled[j],c));return offsets[i+1]+localBounds(names[i+1],c)[0]-offsets[i]-localBounds(name,c)[1];
})}));
const report={geometryHash:sourceHash,units:'mm',source:'Actual cartridge-c binary, route specification and runtime pose/routing equations',
  changesProductionFiles:false,scopeLimit:'AABB envelope overlap is conservative, not a triangle intersection/solid containment verdict. Port reversal and collapsed tube spans are exact routing defects.',
  originalAssembled:spec.assembled,originalExploded:exploded,crossing,states,
  targetedBakeMotion:targetAudit,originalFourModuleBakeMotion:legacyAudit,
  proposal:{minimumHousingGapMM,assembled:proposedAssembled,exploded:proposedExploded,endpointGaps:proposedEndpointGaps,
    continuousSeparationProof:'Every mesh-pair X envelope separation is affine in condense. Positive endpoint separation proves positive separation for every intermediate state.',
    invalidatesExistingBakes:true,requiresCameraPathReexport:true},
  existingAuditLimitations:['check_routing.mjs hardcodes legacy instrument-route.json and does not use cartridge-c internalRoutes.','Its bend check excludes joins between route pieces, so a180degree interface reversal is missed.','check_clearance.py references old geometry-v4 caches/legacy material assumptions, not cartridge-c source geometry.']};
const output=new URL('cartridge-motion-audit.json',import.meta.url);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:output.pathname,crossing,minimumEnvelopeGapMM:Math.min(...states.flatMap(s=>s.envelopeGapsMM)),maxJoinGapMM:Math.max(...states.map(s=>s.maxJoinGapMM)),
  targetedCameraMaxErrorMM:Math.max(...targetAudit.frames.map(f=>f.cameraPositionErrorMM)),legacyCameraMaxErrorMM:Math.max(...legacyAudit.frames.map(f=>f.cameraPositionErrorMM)),proposal:report.proposal}));
