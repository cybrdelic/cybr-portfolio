// Additional finish charts for the native CAD package. The native geometry and
// its original UVs remain intact; each named part keeps its own machining axis.
export const METAL_STYLES=Object.freeze({disabled:0,brushed:1,turned:2,diamondKnurl:3,fineEtched:4});
export const METAL_CHARTS=Object.freeze({linear:0,polarRadial:1,polarBarrel:2,axialBrush:3});
export const METAL_PROFILE_PITCH_MM=Object.freeze({diamondKnurl:1,fineEtched:.65});
const TAU=2*Math.PI;
const styleNames=['disabled','brushed','turned','diamondKnurl','fineEtched'];
const blackMetal=name=>name==='geo__graphite_inner_liner'||name==='geo__inner_black_barrel'||name==='geo__retainer'||name.startsWith('geo__flange_recess_')||name.startsWith('light__optic_locknut_');
const eligible=(material,name)=>[0,1,8,9].includes(material)||(material===2&&blackMetal(name));

function prescription(name,module,material){
  if(!eligible(material,name))return {mode:'disabled',style:0,axis:'X'};
  if(material===8)return {mode:'bell',style:2,axis:'X'};
  // Spoke-supported flat guards and rectangular longitudinal keys are milled
  // pieces. Their whole-part bounds do not define a lathe's circular center.
  if(name==='geo__takeup_guard_-35'||name==='geo__takeup_guard_35'||/^geo__internal_key_\d+$/.test(name))return {mode:'planar-X',style:1,axis:'X'};
  if(name==='geo__vented_monocoque'||name==='geo__slotted_shell')return {mode:'monocoque',style:2,axis:'X'};
  if(/^geo__helical_stator_|^elements__protective_frame_|^geo__service_grip_/.test(name))return {mode:'planar-X',style:1,axis:'X'};
  if(name==='geo__knurled_service_band')return {mode:'diamond',style:2,axis:'X',pitch:METAL_PROFILE_PITCH_MM.diamondKnurl};
  if(name==='light__exploded_locking_ring')return {mode:'etched',style:2,axis:'X',pitch:METAL_PROFILE_PITCH_MM.fineEtched};
  if(name==='geo__identity_plate')return {mode:'planar-XZ',style:1,axis:'X'};
  if(material===9){
    if(name==='scenes_bored_ceramic_landscape_carrier')return {mode:'turned',style:2,axis:'Z'};
    if(name.includes('compression_barrel'))return {mode:'turned',style:2,axis:'X'};
    if(module==='combat'||name.includes('chassis'))return {mode:'planar-X',style:1,axis:'X'};
    return {mode:'native-mm',style:1,axis:'X'};
  }
  // Core metal shells, collars, washers and fasteners are X-axis turned parts.
  return {mode:'turned',style:2,axis:'X'};
}

function bounds(position,start,count){
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=start;i<start+count;i++){
    const p=[position.getX(i),position.getY(i),position.getZ(i)];
    for(let k=0;k<3;k++){if(!Number.isFinite(p[k]))throw Error('Nonfinite native metal position');lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}
  }
  return {lo,hi,origin:lo.map((value,k)=>(value+hi[k])*.5)};
}

// Existing X charts are split per CAD triangle at their angular seam. Match
// that branch while calculating angles from the actual part's own axis.
function xTurns(y,z,nativeU){
  const turns=Math.atan2(z,y)/TAU;
  return turns+Math.round(nativeU-turns);
}

// Name-only offsets: no pose, camera, clock or array ordering enters the seed.
// Keep 24 bits so Float32 attributes cannot round the upper endpoint to 1.
function wearPhase(name){
  const component=suffix=>{
    let hash=0x811c9dc5;
    const text=name+suffix;
    for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),0x01000193)>>>0;
    hash^=hash>>>16;hash=Math.imul(hash,0x85ebca6b)>>>0;
    hash^=hash>>>13;hash=Math.imul(hash,0xc2b2ae35)>>>0;hash^=hash>>>16;
    return (hash>>>8)/0x1000000;
  };
  return [component('/wear-u'),component('/wear-v')];
}

/**
 * Attach independent finish attributes to a native BufferGeometry.
 * metalUv is in physical mm: U follows the grain; V crosses it. Diamond U
 * spans an integer number of profile pitches. Z-axis turning has a polar U
 * seam; its radial V stays continuous there and turned relief uses only V.
 * metalLocalPosition is Cartesian [axial, radial-Y, radial-Z] in part-local mm.
 * metalChart is [kind, angularLengthMM]. Reconstruct polar radius/angle in the
 * fragment shader: interpolating a radius at CAD vertices facets large faces.
 */
export function attachMetalCoordinates({THREE,geometry,mesh,materialIndex=mesh?.material}){
  const position=geometry?.getAttribute('position'),normal=geometry?.getAttribute('normal'),nativeUv=geometry?.getAttribute('uv');
  if(!THREE?.BufferAttribute||!position||position.itemSize!==3||!normal||normal.count!==position.count||!nativeUv||nativeUv.count!==position.count)throw Error('Native metal chart requires matching position, normal and UV attributes');
  const count=position.count,uv=new Float32Array(count*2),style=new Float32Array(count),localPosition=new Float32Array(count*3),chartAttribute=new Float32Array(count*2),wearPhaseAttribute=new Float32Array(count*2),wearBoundsAttribute=new Float32Array(count*2);
  const parts=mesh?.partRanges?.length?mesh.partRanges:[{name:mesh?.partNames?.[0]||'',firstVertex:0,vertexCount:count,firstIndex:0,indexCount:geometry.index?.count||0}];
  const summary={materialIndex,vertexCount:count,activeVertices:0,styleCounts:Object.fromEntries(styleNames.map(name=>[name,0])),parts:[]};
  const covered=new Uint8Array(count);
  for(const part of parts){
    const start=part.firstVertex,length=part.vertexCount,name=part.name||'';
    if(!Number.isInteger(start)||!Number.isInteger(length)||start<0||length<=0||start+length>count)throw Error('Invalid native metal part vertex range: '+name);
    const chart=prescription(name,mesh?.module,materialIndex),{lo,hi,origin}=bounds(position,start,length);
    let outerRadius=0;
    for(let i=start;i<start+length;i++){
      const a=chart.axis==='Z'?position.getX(i)-origin[0]:position.getY(i)-origin[1];
      const b=chart.axis==='Z'?position.getY(i)-origin[1]:position.getZ(i)-origin[2];
      outerRadius=Math.max(outerRadius,Math.hypot(a,b));
    }
    const circumference=TAU*outerRadius,cycles=chart.pitch?Math.max(1,Math.round(circumference/chart.pitch)):undefined;
    const angularLength=cycles?cycles*chart.pitch:circumference;
    const phase=wearPhase(name),axialAxis=chart.axis==='Z'?2:0,axialHalfLength=(hi[axialAxis]-lo[axialAxis])*.5;
    const wearBounds=[outerRadius,axialHalfLength];
    const counts=Object.fromEntries(styleNames.map(key=>[key,0]));
    for(let i=start;i<start+length;i++){
      if(covered[i])throw Error('Overlapping native metal part vertex ranges: '+name);
      covered[i]=1;
      wearPhaseAttribute.set(phase,i*2);wearBoundsAttribute.set(wearBounds,i*2);
      const x=position.getX(i)-origin[0],y=position.getY(i)-origin[1],z=position.getZ(i)-origin[2];
      const nx=normal.getX(i),ny=normal.getY(i),nz=normal.getZ(i);
      localPosition.set(chart.axis==='Z'?[z,x,y]:[x,y,z],i*3);
      let u=0,v=0,s=chart.style,kind=METAL_CHARTS.linear;
      if(s){
        const a=chart.axis==='Z'?x:y,b=chart.axis==='Z'?y:z,radius=Math.hypot(a,b);
        const along=chart.axis==='Z'?z:x,axialNormal=chart.axis==='Z'?nz:nx;
        const radialNormal=radius>1e-8?(chart.axis==='Z'?(nx*x+ny*y):(ny*y+nz*z))/radius:0;
        const turns=chart.axis==='Z'?Math.atan2(y,x)/TAU:xTurns(y,z,nativeUv.getX(i));
        u=turns*angularLength;
        const radialChart=chart.mode==='bell'||Math.abs(axialNormal)>.7;
        v=radialChart?radius:along;
        kind=radialChart?METAL_CHARTS.polarRadial:METAL_CHARTS.polarBarrel;
        const outerWall=radialNormal>.65&&radius>=outerRadius-.15&&Math.abs(axialNormal)<.45;
        if(chart.mode==='diamond'&&outerWall){s=3;v=along;kind=METAL_CHARTS.polarBarrel;}
        else if(chart.mode==='etched'&&outerWall){s=4;v=along;kind=METAL_CHARTS.polarBarrel;}
        else if(chart.mode==='monocoque'&&outerWall){s=1;u=x;v=turns*circumference;kind=METAL_CHARTS.axialBrush;}
        else if(chart.mode==='planar-XZ'){u=x;v=z;kind=METAL_CHARTS.linear;}
        else if(chart.mode==='planar-X'){
          // XY decks and XZ side plates both follow the long X dimension.
          // End faces get their own face chart rather than a collapsed X UV.
          if(Math.abs(nx)>.7){u=y;v=z;}else{u=x;v=Math.abs(nz)>=Math.abs(ny)?y:z;}
          kind=METAL_CHARTS.linear;
        }
        else if(chart.mode==='native-mm'){u=nativeUv.getX(i)*40;v=nativeUv.getY(i)*40;kind=METAL_CHARTS.linear;}
      }
      if(!Number.isFinite(u)||!Number.isFinite(v))throw Error('Nonfinite metal surface coordinate: '+name);
      uv[i*2]=u;uv[i*2+1]=v;style[i]=s;chartAttribute[i*2]=kind;chartAttribute[i*2+1]=angularLength;counts[styleNames[s]]++;
    }
    summary.parts.push({name,mode:chart.mode,axis:chart.axis,originMM:origin,outerRadiusMM:outerRadius,
      circumferenceMM:circumference,styleCounts:counts,...(cycles?{pitchMM:chart.pitch,angularCycles:cycles,periodicCircumferenceMM:angularLength}:{}),
      ...(chart.axis==='Z'?{polarUSeam:true,turnedReliefCoordinate:'V'}:{})});
    for(const key of styleNames)summary.styleCounts[key]+=counts[key];
  }
  // A sparse future package may leave unnamed vertices. They are disabled.
  summary.styleCounts.disabled+=count-covered.reduce((sum,value)=>sum+value,0);
  summary.activeVertices=count-summary.styleCounts.disabled;
  geometry.setAttribute('metalUv',new THREE.BufferAttribute(uv,2));
  geometry.setAttribute('metalStyle',new THREE.BufferAttribute(style,1));
  geometry.setAttribute('metalLocalPosition',new THREE.BufferAttribute(localPosition,3));
  geometry.setAttribute('metalChart',new THREE.BufferAttribute(chartAttribute,2));
  geometry.setAttribute('metalWearPhase',new THREE.BufferAttribute(wearPhaseAttribute,2));
  geometry.setAttribute('metalWearBounds',new THREE.BufferAttribute(wearBoundsAttribute,2));
  return summary;
}
