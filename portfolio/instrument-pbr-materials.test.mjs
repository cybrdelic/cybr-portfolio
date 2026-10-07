import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import{configurePbrMetal,bindPbrMetalShader,pbrUvFromMillimeters,pbrTangentFrame,applyPbrNormal,applyPbrHeightNormal,pbrCavityResponse,buildPbrMaterialGroups,disposePbrMetal}from './instrument-pbr-materials.mjs';
import{bindRasterCamera}from './instrument-raster-camera.mjs';
import{setupRasterThickness}from './instrument-raster-thickness.mjs';
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const vectorClose=(a,b,tolerance=1e-9)=>a.forEach((x,i)=>close(x,b[i],tolerance));
const texture=()=>new THREE.DataTexture(new Uint8Array(4*4*4).fill(128),4,4,THREE.RGBAFormat);
const maps=()=>({baseColor:texture(),normal:texture(),roughness:texture(),metallic:texture()});
const shader=()=>({vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.physical.uniforms),defines:{USE_TRANSMISSION:''}});
const triangleMultiset=index=>{
  const result=new Map();for(let i=0;i<index.length;i+=3){const key=Array.from(index.slice(i,i+3)).join(',');result.set(key,(result.get(key)||0)+1);}return result;
};

test('physical UVs respect authored tile size, rotation, offset, and exact cap radius',()=>{
  const linear={localPosition:[0,0,0],chart:[0,0]};
  vectorClose(pbrUvFromMillimeters({...linear,uv:[200,100],tileMM:[200,100]}),[1,1]);
  vectorClose(pbrUvFromMillimeters({...linear,uv:[200,100],tileMM:[200,100],rotationRadians:Math.PI/2}),[.5,-2]);
  vectorClose(pbrUvFromMillimeters({...linear,uv:[200,100],tileMM:[200,100],offset:[.2,-.3]}),[1.2,.7]);
  const circumference=2*Math.PI*40;
  const actual=pbrUvFromMillimeters({uv:[circumference/8,40],localPosition:[0,20,20],chart:[1,circumference],tileMM:[circumference,20]});
  vectorClose(actual,[.125,Math.sqrt(800)/20]);
  assert.throws(()=>pbrUvFromMillimeters({...linear,uv:[0,0],tileMM:[0,100]}));
});

test('radial-face source sampling uses Cartesian cap coordinates while barrels retain their physical chart',()=>{
  const circumference=2*Math.PI*40;
  vectorClose(pbrUvFromMillimeters({uv:[circumference/8,40],localPosition:[0,20,20],chart:[1,circumference],tileMM:[120,120],mapping:'radialFace'}),[2/3,2/3]);
  vectorClose(pbrUvFromMillimeters({uv:[circumference/8,7],localPosition:[7,20,20],chart:[2,circumference],tileMM:[120,120],mapping:'radialFace'}),[.25,7/120]);
  const compiled=shader();bindPbrMetalShader(compiled,{THREE,tileMM:[120,120],mapping:'radialFace'});
  assert.equal(compiled.uniforms.pbrMetalRadialFace.value,1);
  assert.ok(compiled.fragmentShader.includes('pbrPhysicalTangentFrame(-vViewPosition,normal,pbrGrainUv)'));
});

test('fixed group charts reconstruct one radius or axial coordinate instead of interpolating chart modes',()=>{
  const circumference=279,tileMM=[40,40],localPosition=[7,30,40],turn=Math.atan2(40,30)/(2*Math.PI);
  const original={uv:[turn*circumference,50],localPosition,chart:[1,circumference],tileMM};
  vectorClose(pbrUvFromMillimeters({...original,chartKind:2}),[7*turn,7/40]);
  vectorClose(pbrUvFromMillimeters({...original,chartKind:1}),[7*turn,50/40]);
  vectorClose(pbrUvFromMillimeters({...original,chartKind:0}),original.uv.map(value=>value/40));
  vectorClose(pbrUvFromMillimeters({...original,chartKind:1,mapping:'radialFace'}),[1.25,1.5]);
  vectorClose(pbrUvFromMillimeters({...original,chartKind:2,mapping:'radialFace'}),[7*turn,7/40]);
  const branch={uv:[.75*circumference,42],localPosition:[3,0,-40],chart:[1,circumference],tileMM};
  vectorClose(pbrUvFromMillimeters({...branch,chartKind:3}),[3/40,7*.75]);
  vectorClose(pbrUvFromMillimeters({...branch,uv:[3,.75*circumference],chart:[3,circumference],chartKind:1}),[7*.75,1]);
  for(const chartKind of[-1,.5,4,NaN])assert.throws(()=>pbrUvFromMillimeters({...original,chartKind}),/descriptor/);
});

test('fixed chart uniforms share one shader program without losing per-material kind or original angular branches',()=>{
  const set=maps(),materials=[];
  try{
    for(const chartKind of[undefined,0,1,2,3]){
      const material=new THREE.MeshPhysicalMaterial();material.customProgramCacheKey=()=> 'same-native-factory';
      configurePbrMetal(material,{THREE,maps:set,tileMM:[40,40],chartKind,anisotropy:.45});materials.push(material);
    }
    const compiled=materials.map(material=>{const result=shader();material.onBeforeCompile(result,{});return result;});
    assert.equal(new Set(materials.map(material=>material.customProgramCacheKey())).size,1);
    assert.equal(new Set(compiled.map(result=>result.fragmentShader)).size,1);assert.equal(new Set(compiled.map(result=>result.vertexShader)).size,1);
    for(let i=0;i<compiled.length;i++)vectorClose(compiled[i].uniforms.pbrMetalFixedChartKind.value.toArray(),i===0?[0,0]:[1,i-1]);
    assert.ok(compiled[0].vertexShader.includes('(metalChart.x>2.5?metalUv.y:metalUv.x)/max(metalChart.y,1.e-8)'));
    assert.ok(compiled[0].fragmentShader.includes('turn+=floor(vPbrMetalAngularReference-turn+.5)'));
    assert.ok(compiled[0].fragmentShader.includes('float kind=pbrMetalChartKind()'));
  }finally{for(const material of materials)material.dispose();for(const map of Object.values(set))map.dispose();}
});

test('polar barrel and axial brush maps close whole source tiles with matching seam gradients',()=>{
  const radius=44.4,circumference=2*Math.PI*radius,tileMM=[40,23],offset=[.13,-.21],height=7.5;
  const periodic=uv=>Math.sin(2*Math.PI*uv[0])+.3*Math.cos(2*Math.PI*uv[1]);
  const step=1e-5;
  for(const kind of[2,3])for(const rotationRadians of[0,Math.PI/2,.37]){
    const c=Math.cos(rotationRadians),s=Math.sin(rotationRadians);
    const desired=(kind===3?[s,c]:[c,-s]).map((value,i)=>value*circumference/tileMM[i]);
    const repeats=desired.map(value=>Math.floor(value+.5));
    const sample=(angle,reference=angle,axial=height)=>pbrUvFromMillimeters({
      uv:kind===3?[axial,reference/(2*Math.PI)*circumference]:[reference/(2*Math.PI)*circumference,axial],
      localPosition:[axial,radius*Math.cos(angle),radius*Math.sin(angle)],chart:[kind,circumference],tileMM,rotationRadians,offset,
    });
    const plus=sample(Math.PI),minus=sample(-Math.PI);
    vectorClose(plus.map((value,i)=>value-minus[i]),repeats);
    close(periodic(plus),periodic(minus),1e-10);
    const angularDerivative=center=>{
      const a=sample(center-step,center),b=sample(center+step,center);
      return b.map((value,i)=>(value-a[i])/(2*step));
    };
    const dp=angularDerivative(Math.PI),dm=angularDerivative(-Math.PI);
    vectorClose(dp,repeats.map(value=>value/(2*Math.PI)),2e-9);vectorClose(dp,dm,2e-9);
    const lightDerivative=center=>(periodic(sample(center+step,center))-periodic(sample(center-step,center)))/(2*step);
    close(lightDerivative(Math.PI),lightDerivative(-Math.PI),2e-9);
    const x0=sample(Math.PI,Math.PI,height-step),x1=sample(Math.PI,Math.PI,height+step);
    const axialDerivative=x1.map((value,i)=>(value-x0[i])/(2*step));
    vectorClose(axialDerivative,kind===3?[c/tileMM[0],-s/tileMM[1]]:[s/tileMM[0],c/tileMM[1]],2e-9);
    const surface={positionDx:[0,0,-radius],positionDy:[1,0,0],uvDy:axialDerivative,normal:[0,-1,0]};
    const fp=pbrTangentFrame({...surface,uvDx:dp}),fm=pbrTangentFrame({...surface,uvDx:dm});
    vectorClose(fp.tangent,fm.tangent,2e-9);vectorClose(fp.bitangent,fm.bitangent,2e-9);
  }
});

test('polar closure keeps at least one repeat, preserves exact authored cycles and leaves planar/radial sources unchanged',()=>{
  for(const kind of[2,3]){
    const chart=[kind,4],position=[2,-1,0],uv=kind===3?[2,2]:[2,2];
    const plus=pbrUvFromMillimeters({uv,localPosition:position,chart,tileMM:[40,40]});
    const minus=pbrUvFromMillimeters({uv:[-2,-2],localPosition:[2,-1,-0],chart,tileMM:[40,40]});
    vectorClose(plus.map((value,i)=>value-minus[i]),kind===3?[0,1]:[1,0]);
  }
  const exact=pbrUvFromMillimeters({uv:[279/8,3],localPosition:[3,1,1],chart:[2,279],tileMM:[279/17,10]});
  vectorClose(exact,[17/8,.3]);
  vectorClose(pbrUvFromMillimeters({uv:[16,10],localPosition:[0,0,0],chart:[0,0],tileMM:[40,23],rotationRadians:.37}),[(Math.cos(.37)*16+Math.sin(.37)*10)/40,(-Math.sin(.37)*16+Math.cos(.37)*10)/23]);
  const radial={uv:[1,2],localPosition:[0,20,-12],chart:[1,279],tileMM:[120,140],mapping:'radialFace',offset:[.1,-.2]};
  vectorClose(pbrUvFromMillimeters({...radial,rotationRadians:.37}),[20/120+.6,-12/140+.3]);
  const compiled=shader();bindPbrMetalShader(compiled,{THREE,tileMM:[40,23]});
  assert.ok(compiled.fragmentShader.includes('closed=floor(desired+vec2(.5))'));
  assert.ok(compiled.fragmentShader.includes('pbrPhysicalTangentFrame(-vViewPosition,normal,pbrGrainUv)'));
});

test('normal tangent orientation preserves polar cap handedness and final rotated map axes',()=>{
  // +X cap: increasing angular U follows +Z and radial V follows +Y.
  const frame=pbrTangentFrame({positionDx:[0,0,.1],positionDy:[0,.1,0],uvDx:[.01,0],uvDy:[0,.01],normal:[1,0,0]});
  vectorClose(frame.tangent,[0,0,1]);vectorClose(frame.bitangent,[0,1,0]);assert.equal(frame.handedness,-1);
  const green=applyPbrNormal({sample:[.5,.75,1],frame});
  assert.ok(green[1]>0);close(green[2],0);close(Math.hypot(...green),1);
  const rotated=pbrTangentFrame({positionDx:[.1,0,0],positionDy:[0,.1,0],uvDx:[0,-.01],uvDy:[.01,0],normal:[0,0,1]});
  vectorClose(rotated.tangent,[0,1,0]);vectorClose(rotated.bitangent,[-1,0,0]);
  const flat=applyPbrNormal({sample:[.5,.5,1],frame:rotated});vectorClose(flat,[0,0,1]);
  const back=pbrTangentFrame({positionDx:[0,0,.1],positionDy:[0,.1,0],uvDx:[.01,0],uvDy:[0,.01],normal:[-1,0,0]});
  vectorClose(applyPbrNormal({sample:[.5,.75,1],frame:back,faceDirection:-1}),green.map(x=>-x));
});

test('tangent mapping is invariant to pixel scale and remains finite at singular texture charts',()=>{
  for(const scale of[1e-5,.1,10000]){
    const frame=pbrTangentFrame({positionDx:[scale,0,0],positionDy:[.3*scale,.8*scale,0],uvDx:[scale/200,0],uvDy:[.3*scale/200,.8*scale/100],normal:[0,0,1]});
    vectorClose(frame.tangent,[1,0,0]);vectorClose(frame.bitangent,[0,1,0]);
  }
  const frame=pbrTangentFrame({positionDx:[0,0,0],positionDy:[0,0,0],uvDx:[0,0],uvDy:[0,0],normal:[0,0,1]});
  assert.ok([...frame.tangent,...frame.bitangent,...frame.normal].every(Number.isFinite));
  close(Math.hypot(...frame.tangent),1);close(Math.hypot(...frame.bitangent),1);
});

test('height-derived normals match independently displaced curved geometry, UV rotation and physical stretch',()=>{
  const normalize=v=>v.map(x=>x/Math.hypot(...v)),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],y0=2,z0=1,e=1e-5;
  const surface=(y,z)=>[.15*y*y+.10*y*z+.05*z*z,y,z],base=(y,z)=>normalize([1,-(.3*y+.1*z),-(.1*y+.1*z)]);
  const derivative=(fn,y,z,axis)=>fn(y+(axis===0?e:0),z+(axis===1?e:0)).map((v,i)=>(v-fn(y-(axis===0?e:0),z-(axis===1?e:0))[i])/(2*e));
  const py=derivative(surface,y0,z0,0),pz=derivative(surface,y0,z0,1),normal=base(y0,z0),tileMM=[128,80];
  for(const rotation of[0,.37,Math.PI/2]){
    const c=Math.cos(rotation),s=Math.sin(rotation),sourceHeight=(y,z)=>.04*(c*(y-y0)+s*(z-z0))+.025*(-s*(y-y0)+c*(z-z0));
    const displaced=(y,z)=>surface(y,z).map((v,i)=>v+sourceHeight(y,z)*base(y,z)[i]);
    const expected=normalize(cross(derivative(displaced,y0,z0,0),derivative(displaced,y0,z0,1)));
    const mapNormal=normalize([-.04,-.025,1]),sample=mapNormal.map(v=>(v+1)/2);
    for(const pixelScale of[1e-5,.1,10000]){
      const args={positionDx:py.map(v=>v*pixelScale),positionDy:pz.map(v=>v*pixelScale),uvDx:[c*pixelScale/tileMM[0],-s*pixelScale/tileMM[1]],uvDy:[s*pixelScale/tileMM[0],c*pixelScale/tileMM[1]],normal};
      const frame=pbrTangentFrame(args);vectorClose(applyPbrHeightNormal({sample,frame,tileMM}),expected,2e-9);
      if(rotation===0){const generic=applyPbrNormal({sample,frame});assert.ok(Math.acos(Math.min(1,generic.reduce((sum,v,i)=>sum+v*expected[i],0)))>Math.PI/180*.4);}
      const back=pbrTangentFrame({...args,normal:normal.map(v=>-v)});vectorClose(applyPbrHeightNormal({sample,frame:back,tileMM,faceDirection:-1}),expected.map(v=>-v),2e-9);
    }
  }
  const stretched=pbrTangentFrame({positionDx:[1,0,0],positionDy:[0,1,0],uvDx:[1/64,0],uvDy:[0,1/80],normal:[0,0,1]}),sample=normalize([-.04,-.025,1]).map(v=>(v+1)/2);
  vectorClose(applyPbrHeightNormal({sample,frame:stretched,tileMM}),normalize([-.08,-.025,1]));
  const singular=pbrTangentFrame({positionDx:[0,0,0],positionDy:[0,0,0],uvDx:[0,0],uvDy:[0,0],normal:[1,0,0]});vectorClose(applyPbrHeightNormal({sample,frame:singular,tileMM}),[1,0,0]);
});

test('RGB8 height normals retain a flat plane through both neutral centre codes and mip interpolation',()=>{
  const frame=pbrTangentFrame({positionDx:[1,0,0],positionDy:[0,1,0],uvDx:[1/32,0],uvDy:[0,1/32],normal:[0,0,1]});
  for(const x of[127/255,.5,128/255])for(const y of[127/255,.5,128/255])vectorClose(applyPbrHeightNormal({sample:[x,y,1],frame,tileMM:[32,32]}),[0,0,1]);
  const slope=applyPbrHeightNormal({sample:[129/255,.5,1],frame,tileMM:[32,32]});assert.ok(slope[0]>0);close(slope[1],0);
  const generic=shader(),height=shader();bindPbrMetalShader(generic,{THREE,tileMM:[32,32]});bindPbrMetalShader(height,{THREE,tileMM:[32,32],heightNormals:true});
  assert.ok(height.fragmentShader.includes('mapN.xy*=step(vec2(1./255.+1.e-6),abs(mapN.xy))'));assert.ok(!generic.fragmentShader.includes('mapN.xy*=step'));
});

test('optional packed cavity matches native specular occlusion and height/cavity flags isolate shader caches without extra reads',()=>{
  const body=THREE.ShaderChunk.lights_physical_pars_fragment.match(/float computeSpecularOcclusion\([^]*?\{([^]*?)\}/)[1];
  const native=Function('dotNV','ambientOcclusion','roughness','saturate','pow','exp2',body),saturate=v=>Math.max(0,Math.min(1,v));
  for(const dotNV of[0,.2,1])for(const roughness of[.0525,.32,.6])for(const strength of[0,.25,1]){
    const white=pbrCavityResponse({sample:1,strength,dotNV,roughness});close(white.ambientOcclusion,1);close(white.specularOcclusion,1);
    const valley=pbrCavityResponse({sample:.78,strength,dotNV,roughness});close(valley.ambientOcclusion,1-.22*strength);close(valley.specularOcclusion,native(dotNV,valley.ambientOcclusion,roughness,saturate,Math.pow,v=>2**v));
    if(strength>0){assert.ok(valley.ambientOcclusion<1);assert.ok(valley.specularOcclusion>0&&valley.specularOcclusion<=1);if(dotNV===0||roughness>.1)assert.ok(valley.specularOcclusion<1);}
  }
  const packed=texture(),set={baseColor:texture(),normal:texture(),roughness:packed,metallic:packed},materials=[],compiled=[];let disposals=0;
  for(const map of new Set(Object.values(set)))map.addEventListener('dispose',()=>disposals++);
  try{
    for(const options of[{}, {heightNormals:true}, {cavity:true}, {heightNormals:true,cavity:true,cavityStrength:.25}, {heightNormals:true,cavity:true,cavityStrength:1}]){
      const material=new THREE.MeshPhysicalMaterial();materials.push(material);material.customProgramCacheKey=()=> 'same-factory';
      configurePbrMetal(material,{THREE,maps:set,tileMM:[128,80],anisotropy:.2,...options});const output=shader();material.onBeforeCompile(output,{});compiled.push(output);
    }
    assert.equal(new Set(materials.slice(0,4).map(m=>m.customProgramCacheKey())).size,4);assert.equal(materials[3].customProgramCacheKey(),materials[4].customProgramCacheKey());
    const reads=source=>(source.match(/texture2D\s*\(/g)||[]).length;
    for(let i=0;i<compiled.length;i++){
      const source=compiled[i].fragmentShader,height=[1,3,4].includes(i),cavity=i>=2;
      assert.equal(reads(source),reads(compiled[0].fragmentShader));assert.equal(materials[i].roughnessMap,packed);assert.equal(materials[i].metalnessMap,packed);
      assert.equal(source.includes('mat3 tbn = pbrPhysicalHeightFrame'),height);assert.ok(source.includes('pbrPhysicalTangentFrame(-vViewPosition,normal,pbrGrainUv)'));
      assert.ok(source.includes('vec3 nonPerturbedNormal = normal;'));assert.ok(source.includes('tbn[0] *= faceDirection'));
      assert.equal(source.includes('pbrCavityOcclusion'),cavity);assert.equal(Boolean(compiled[i].uniforms.pbrCavityStrength),cavity);
      if(cavity){
        assert.ok(source.includes('clamp(texelRoughness.r,0.,1.)'));assert.ok(source.includes('reflectedLight.indirectDiffuse*=pbrCavityOcclusion'));
        assert.ok(source.includes('reflectedLight.indirectSpecular*=computeSpecularOcclusion'));assert.equal(/reflectedLight\.direct(?:Diffuse|Specular)[^\n]*pbrCavity/.test(source),false);
        assert.equal(materials[i].userData.pbrMetal.cavity.strength,compiled[i].uniforms.pbrCavityStrength.value);
      }
    }
    assert.equal(compiled[3].fragmentShader,compiled[4].fragmentShader);assert.equal(compiled[3].uniforms.pbrCavityStrength.value,.25);
    for(const material of materials)disposePbrMetal(material);assert.equal(disposals,0);
    for(const options of[{heightNormals:1},{cavity:'yes'},{cavityStrength:-.1},{cavityStrength:1.1}])assert.throws(()=>bindPbrMetalShader(shader(),{THREE,tileMM:[128,80],...options}),/descriptor/);
  }finally{for(const map of new Set(Object.values(set)))map.dispose();}
  assert.equal(disposals,3);
});

test('profile grouping retains every original oriented triangle and every source array exactly',()=>{
  const geometry=new THREE.BufferGeometry();
  const positions=new Float32Array(Array.from({length:36},(_,i)=>i*.1));
  const normals=new Float32Array(36).fill(.5),uv=new Float32Array(24).fill(.25),styles=new Float32Array([3,3,2,1,1,1,0,0,0,4,4,4]);
  const originalIndices=new Uint16Array([6,7,8,0,1,2,3,4,5,9,10,11,2,1,0,0,1,2]);
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setAttribute('metalStyle',new THREE.BufferAttribute(styles,1));
  geometry.setIndex(new THREE.BufferAttribute(originalIndices,1));geometry.addGroup(0,originalIndices.length,7);
  const originalGroups=JSON.stringify(geometry.groups),before=originalIndices.slice();
  const result=buildPbrMaterialGroups(geometry,{styleToMaterialIndex:[10,11,12,13,14]});
  assert.deepEqual(triangleMultiset(result.indices),triangleMultiset(before));assert.equal(result.triangleCount,6);
  assert.deepEqual(result.styleCounts,[1,1,0,3,1]);assert.ok(result.indices instanceof Uint16Array);
  assert.deepEqual(originalIndices,before);assert.equal(geometry.index.array,originalIndices);
  assert.equal(geometry.getAttribute('position').array,positions);assert.equal(geometry.getAttribute('normal').array,normals);assert.equal(geometry.getAttribute('uv').array,uv);assert.equal(geometry.getAttribute('metalStyle').array,styles);
  assert.equal(JSON.stringify(geometry.groups),originalGroups);
  assert.deepEqual(result.groups.map(g=>g.materialIndex),[10,11,13,14]);
  close(result.groups.reduce((sum,g)=>sum+g.count,0),originalIndices.length);
  assert.deepEqual(buildPbrMaterialGroups(geometry).indices,result.indices);
  geometry.dispose();
});

test('profile grouping rejects invalid styles, indices, and incomplete triangles',()=>{
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(9),3));geometry.setAttribute('metalStyle',new THREE.BufferAttribute(new Float32Array([0,0,5]),1));geometry.setIndex([0,1,2]);
  assert.throws(()=>buildPbrMaterialGroups(geometry),/style/);
  geometry.getAttribute('metalStyle').setX(2,0);geometry.setIndex([0,1,3]);assert.throws(()=>buildPbrMaterialGroups(geometry),/outside/);
  geometry.setIndex([0,1]);assert.throws(()=>buildPbrMaterialGroups(geometry),/indexed/);geometry.dispose();
});

test('triangle material selector separates a circular cap from a turned barrel without dropping oriented faces',()=>{
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(18),3));geometry.setAttribute('metalStyle',new THREE.BufferAttribute(new Float32Array(6).fill(2),1));
  geometry.setAttribute('metalChart',new THREE.BufferAttribute(new Float32Array([1,200,1,200,1,200,2,200,2,200,2,200]),2));
  const source=new Uint32Array([3,4,5,0,1,2]);geometry.setIndex(new THREE.BufferAttribute(source,1));
  const calls=[];
  const result=buildPbrMaterialGroups(geometry,{triangleMaterial:record=>{calls.push(record);return record.chartKind===1?6:2;}});
  assert.deepEqual(result.groups.map(g=>[g.style,g.chartKind,g.materialIndex]),[[2,1,6],[2,2,2]]);
  assert.deepEqual(triangleMultiset(result.indices),triangleMultiset(source));assert.deepEqual(result.styleCounts,[0,0,2,0,0]);
  assert.deepEqual(calls.map(c=>c.indices),[[3,4,5],[0,1,2]]);assert.deepEqual(source,new Uint32Array([3,4,5,0,1,2]));
  assert.throws(()=>buildPbrMaterialGroups(geometry,{triangleMaterial:()=>-1}),/selected/);geometry.dispose();
});

test('dedicated PBR profile materials use native channels and color spaces while style zero stays isolated',()=>{
  const original=new THREE.MeshPhysicalMaterial({color:new THREE.Color(.66,.69,.71),roughness:.24,metalness:.95}),oldMap=texture();original.roughnessMap=oldMap;
  const active=original.clone(),set=maps();let hooks=0;
  active.onBeforeCompile=shader=>{hooks++;bindRasterCamera(shader,THREE);};
  configurePbrMetal(active,{THREE,maps:set,tileMM:[250,250],anisotropy:.45,maxAnisotropy:4,sourceMetadata:{kind:'caller supplied PBR source'}});
  assert.equal(active.map,set.baseColor);assert.equal(active.normalMap,set.normal);assert.equal(active.roughnessMap,set.roughness);assert.equal(active.metalnessMap,set.metallic);
  assert.equal(set.baseColor.colorSpace,THREE.SRGBColorSpace);
  for(const key of['normal','roughness','metallic'])assert.equal(set[key].colorSpace,THREE.NoColorSpace);
  for(const map of Object.values(set)){assert.equal(map.wrapS,THREE.RepeatWrapping);assert.equal(map.wrapT,THREE.RepeatWrapping);assert.equal(map.minFilter,THREE.LinearMipmapLinearFilter);assert.equal(map.generateMipmaps,true);assert.equal(map.anisotropy,4);}
  vectorClose(active.color.toArray(),[1,1,1]);vectorClose(active.normalScale.toArray(),[1,1]);assert.equal(active.roughness,1);assert.equal(active.metalness,1);close(active.anisotropyRotation,Math.PI/2);
  assert.equal(original.roughnessMap,oldMap);close(original.roughness,.24);close(original.metalness,.95);vectorClose(original.color.toArray(),[.66,.69,.71]);assert.ok(!original.userData.pbrMetal);
  const compiled=shader();active.onBeforeCompile(compiled,{});assert.equal(hooks,1);
  assert.ok(compiled.fragmentShader.includes('inverseTransformDirection(geometryViewDir, viewMatrix)'));
  assert.ok(compiled.fragmentShader.includes('texture2D( roughnessMap, pbrMapUv )'));assert.ok(compiled.fragmentShader.includes('texelRoughness.g'));assert.ok(compiled.fragmentShader.includes('texelMetalness.b'));
  assert.ok(!compiled.fragmentShader.includes('metalFinishSine'));assert.throws(()=>configurePbrMetal(active,{THREE,maps:set,tileMM:[1,1]}),/already configured/);
  let materialDisposals=0,textureDisposals=0;active.addEventListener('dispose',()=>materialDisposals++);for(const map of Object.values(set))map.addEventListener('dispose',()=>textureDisposals++);
  disposePbrMetal(active);assert.equal(materialDisposals,1);assert.equal(textureDisposals,0);
  original.dispose();oldMap.dispose();for(const map of Object.values(set))map.dispose();
});

test('a packed roughness-metallic alias reuses one filtered RGBA sample without changing channels or texture ownership',()=>{
  const packed=texture(),separate=maps(),aliased={baseColor:texture(),normal:texture(),roughness:packed,metallic:packed},materials=[];
  // Compile the generated scalar map section in each define combination, then
  // evaluate deliberately different G/B channels and count actual map reads.
  const evaluate=(fragment,defines)=>{
    const start=fragment.indexOf('float roughnessFactor = roughness;'),end=fragment.indexOf('float faceDirection =');
    assert.ok(start>=0&&end>start);const stack=[],lines=[];let enabled=true;
    for(const line of fragment.slice(start,end).split('\n')){
      const directive=line.trim().match(/^#(ifdef|else|endif)\s*(\w+)?$/);
      if(directive){
        if(directive[1]==='ifdef'){stack.push({parent:enabled,condition:defines.has(directive[2])});enabled=enabled&&stack.at(-1).condition;}
        else if(directive[1]==='else'){assert.ok(stack.length);enabled=stack.at(-1).parent&&!stack.at(-1).condition;}
        else{assert.ok(stack.length);enabled=stack.pop().parent;}
      }else if(enabled)lines.push(line);
    }
    assert.equal(stack.length,0);const source=lines.join('\n').replace(/\b(?:float|vec4)\s+/g,'let ');let reads=0;
    const result=Function('roughness','metalness','roughnessMap','metalnessMap','pbrMapUv','texture2D',source+'\nreturn [roughnessFactor,metalnessFactor];')(.8,.7,{r:.99,g:.23,b:.81,a:1},{r:.04,g:.23,b:.81,a:1},[.3,.8],sample=>{reads++;return sample;});
    return{result,reads};
  };
  let textureDisposals=0;for(const map of new Set([...Object.values(aliased),...Object.values(separate)]))map.addEventListener('dispose',()=>textureDisposals++);
  try{
    for(const set of[aliased,separate,aliased]){
      const material=new THREE.MeshPhysicalMaterial();materials.push(material);material.customProgramCacheKey=()=> 'shared-factory';
      // Supplied flags cannot override the actual native-slot identity.
      configurePbrMetal(material,{THREE,maps:set,tileMM:[32,32],packedRoughMetal:set===separate});
    }
    const [a,b,c]=materials.map(material=>{const compiled=shader();material.onBeforeCompile(compiled,{});return compiled;});
    assert.equal(materials[0].userData.pbrMetal.version,'native-pbr-mm-v9');assert.equal(materials[0].userData.pbrMetal.packedRoughMetal,true);assert.equal(materials[1].userData.pbrMetal.packedRoughMetal,false);
    assert.equal(materials[0].roughnessMap,packed);assert.equal(materials[0].metalnessMap,packed);
    assert.notEqual(materials[0].customProgramCacheKey(),materials[1].customProgramCacheKey());assert.equal(materials[0].customProgramCacheKey(),materials[2].customProgramCacheKey());
    assert.equal(a.fragmentShader,c.fragmentShader);assert.ok(a.fragmentShader.includes('vec4 texelMetalness = texelRoughness;'));assert.ok(!b.fragmentShader.includes('vec4 texelMetalness = texelRoughness;'));
    for(const compiled of[a,b]){
      const both=evaluate(compiled.fragmentShader,new Set(['USE_ROUGHNESSMAP','USE_METALNESSMAP']));vectorClose(both.result,[.8*.23,.7*.81]);assert.equal(both.reads,compiled===a?1:2);
      const metallicOnly=evaluate(compiled.fragmentShader,new Set(['USE_METALNESSMAP']));vectorClose(metallicOnly.result,[.8,.7*.81]);assert.equal(metallicOnly.reads,1);
      const roughOnly=evaluate(compiled.fragmentShader,new Set(['USE_ROUGHNESSMAP']));vectorClose(roughOnly.result,[.8*.23,.7]);assert.equal(roughOnly.reads,1);
      vectorClose(evaluate(compiled.fragmentShader,new Set()).result,[.8,.7]);
    }
    for(const material of materials)disposePbrMetal(material);assert.equal(textureDisposals,0);
  }finally{for(const map of new Set([...Object.values(aliased),...Object.values(separate)]))map.dispose();}
  assert.equal(textureDisposals,7);
});

test('native map hooks compose with camera and CAD thickness without changing illumination',()=>{
  const scene=new THREE.Scene(),material=new THREE.MeshPhysicalMaterial({transmission:1,thickness:1.5,ior:1.47}),object=new THREE.Mesh(new THREE.BoxGeometry(),material);scene.add(object);
  const thickness=setupRasterThickness({THREE,renderer:{},scene,objects:[object],fullSize:new THREE.Vector2(16,16)});
  try{
    for(const first of[true,false]){
      const compiled=shader();if(first)bindPbrMetalShader(compiled,{THREE,tileMM:[250,250]});
      bindRasterCamera(compiled,THREE);thickness.bindShader(compiled,material);
      if(!first)bindPbrMetalShader(compiled,{THREE,tileMM:[250,250]});
      assert.ok(compiled.uniforms.cadThicknessField);assert.ok(compiled.fragmentShader.includes('mat3 tbn = pbrPhysicalTangentFrame'));
      assert.ok(compiled.fragmentShader.includes('tbn[0] *= faceDirection'));assert.ok(compiled.fragmentShader.includes('vec3 nonPerturbedNormal = normal;'));
      assert.ok(compiled.fragmentShader.includes('#include <lights_physical_fragment>'));assert.ok(compiled.fragmentShader.includes('#include <aomap_fragment>'));
      assert.throws(()=>bindPbrMetalShader(compiled,{THREE,tileMM:[1,1]}),/already bound/);
    }
  }finally{thickness.dispose();object.geometry.dispose();material.dispose();}
  const wrong=shader();wrong.fragmentShader+='\nfloat machiningVariation=0.;';assert.throws(()=>bindPbrMetalShader(wrong,{THREE,tileMM:[1,1]}),/Remove procedural/);
});
