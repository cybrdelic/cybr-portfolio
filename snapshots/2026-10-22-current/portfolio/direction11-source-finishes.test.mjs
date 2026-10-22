import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {sourceGeometry} from './source-geometry.mjs';
import {applyDirection11SourceFinishes,sourceUvMetres,repairNativeRelief,SOURCE_FINISH_ASSUMPTIONS} from './direction11-source-finishes.mjs';
const derivative='vec3 qx=dFdx(vViewPosition),qy=dFdy(vViewPosition);vec3 rx=cross(qy,normal),ry=cross(normal,qx);float det=dot(qx,rx);';
const relief=scale=>`float h=texture2D(nativeRelief,p.yz).r;\n${derivative}\nnormal=normalize(abs(det)*normal-sign(det)*(dFdx(h)*rx+dFdy(h)*ry)*${scale});`;
const shader=()=>({uniforms:{},vertexShader:'#include <begin_vertex>\n#include <skinning_vertex>',fragmentShader:'#include <normal_fragment_maps>\n#include <lights_fragment_begin>'});

test('source UV metric uses rest-mesh metres and refuses missing or degenerate UVs',()=>{
 const g=new T.PlaneGeometry(2,1);assert.deepEqual(sourceUvMetres(g),[2,1]);assert.deepEqual(sourceUvMetres(g,.001),[.002,.001]);
 g.rotateY(.6);g.rotateZ(.7);const metric=sourceUvMetres(g);assert.ok(Math.abs(metric[0]-2)<1e-6);assert.ok(Math.abs(metric[1]-1)<1e-6);
 g.attributes.uv.array.fill(0);assert.equal(sourceUvMetres(g),null);g.deleteAttribute('uv');assert.equal(sourceUvMetres(g),null);g.dispose();
});

test('actual source garments have finite source UV calibration and keep original geometry attributes',()=>{
 const meta=JSON.parse(readFileSync(new URL('./assets/direction11-combat/geometry.json',import.meta.url),'utf8'));
 const bytes=gunzipSync(readFileSync(new URL('./assets/direction11-combat/'+meta.file,import.meta.url))),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 const root=new T.Group(),geometries=[],materials=[];
 for(const record of meta.meshes){const g=sourceGeometry(T,buffer,record),m=new T.MeshPhysicalMaterial({roughness:.86}),mesh=new T.SkinnedMesh(g,m);mesh.name=record.name;root.add(mesh);geometries.push(g);materials.push(m);}
 const before=root.children.map(mesh=>({geometry:mesh.geometry,uv:mesh.geometry.attributes.uv,skin:mesh.geometry.attributes.skinWeight}));
 const finish=applyDirection11SourceFinishes(T,{combatRoot:root});assert.equal(finish.counts.combat,2);assert.equal(finish.audit.length,2);
 const shirt=finish.audit.find(r=>r.asset==='Sewn shirt'),shorts=finish.audit.find(r=>r.asset==='Sewn shorts');
 assert.ok(shirt.uvMetres.every(n=>Number.isFinite(n)&&n>.01&&n<10));assert.equal(shirt.reliefMetres,.000018);
 assert.equal(shorts.kind,'source garment fiber BSDF');assert.match(shorts.uvDetail,/missing or degenerate/);
 assert.equal(sourceUvMetres(root.children[2].geometry),null,'do not pretend zero source UV arrays are usable garment coordinates');
 root.children.forEach((mesh,i)=>{assert.equal(mesh.geometry,before[i].geometry);assert.equal(mesh.geometry.attributes.uv,before[i].uv);assert.equal(mesh.geometry.attributes.skinWeight,before[i].skin);});
 assert.equal(root.children[0].material.roughness,.86,'the actual source mannequin body is not replaced with invented skin');
 finish.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
});

test('cloth shader preserves earlier hooks/skinning, filters subpixel fibers, and restores materials',()=>{
 const root=new T.Group(),g=new T.PlaneGeometry(1,1),m=new T.MeshPhysicalMaterial({roughness:.86,sheen:.16,sheenRoughness:.85,color:0x123456}),mesh=new T.SkinnedMesh(g,m);mesh.name='Sewn shirt';root.add(mesh);
 const original=function(s){s.fragmentShader='// source hook\n'+s.fragmentShader;},key=()=> 'source-shirt';m.onBeforeCompile=original;m.customProgramCacheKey=key;
 const color=m.color.clone(),finish=applyDirection11SourceFinishes(T,{combatRoot:root}),s=shader();m.onBeforeCompile(s);
 assert.ok(s.fragmentShader.startsWith('varying'));assert.match(s.fragmentShader,/source hook/);assert.match(s.vertexShader,/#include <skinning_vertex>/);
 assert.match(s.vertexShader,/d11ClothUv=uv/);assert.match(s.fragmentShader,/fwidth\(d11Q\)/);assert.match(s.fragmentShader,/dFdx\(-vViewPosition\)/);
 assert.doesNotMatch(s.fragmentShader,/dFdx\(d11Resolved\)|random|noise|time/);assert.deepEqual(s.uniforms.d11ClothPitch.value.toArray(),[.00065,.00085]);
 assert.deepEqual(m.color,color);const same=applyDirection11SourceFinishes(T,{combatRoot:root});assert.equal(same.counts.combat,1);assert.equal(same.audit.length,0);same.dispose();
 assert.notEqual(m.onBeforeCompile,original);finish.dispose();assert.equal(m.onBeforeCompile,original);assert.equal(m.customProgramCacheKey,key);assert.equal(m.roughness,.86);assert.equal(m.sheen,.16);finish.dispose();g.dispose();m.dispose();
});

test('material clones are explicitly repatched rather than trusting copied userData markers',()=>{
 const root=new T.Group(),g=new T.PlaneGeometry(),m=new T.MeshPhysicalMaterial(),mesh=new T.SkinnedMesh(g,m);mesh.name='shirt';root.add(mesh);
 const first=applyDirection11SourceFinishes(T,{combatRoot:root}),clone=m.clone(),other=new T.SkinnedMesh(g,clone),secondRoot=new T.Group();other.name='shorts';secondRoot.add(other);
 const second=applyDirection11SourceFinishes(T,{combatRoot:secondRoot});assert.equal(second.counts.combat,1);assert.equal(second.audit.length,1);const s=shader();clone.onBeforeCompile(s);assert.ok(s.uniforms.d11ClothPitch);
 second.dispose();first.dispose();clone.dispose();m.dispose();g.dispose();
});

test('source terrain relief repairs gradient sign without erasing authored map frequency or amplitude',()=>{
 const source=readFileSync(new URL('./native-springs-finish.mjs',import.meta.url),'utf8');assert.ok(source.includes(derivative),'source contract must be reviewed when upstream changes');
 for(const [input,frequency] of [['2.0','.060'],['.012','1.800'],['.045','1.800']]){
  const mapping=`vec3 p=nativePoint*${frequency};\n`;
  const result=repairNativeRelief(mapping+relief(input));assert.match(result,/dFdx\(-vViewPosition\),qy=dFdy\(-vViewPosition\)/);assert.match(result,/dot\(qx,rx\)\*faceDirection/);
  assert.ok(result.startsWith(mapping));assert.ok(result.includes('*'+input+');'));assert.match(result,/if\(abs\(det\)>1.e-12\)/);
 }
 assert.throws(()=>repairNativeRelief('unrecognized source'),/requires review/);assert.throws(()=>repairNativeRelief(relief('.9')),/requires review/);
 assert.equal(SOURCE_FINISH_ASSUMPTIONS.provenance.includes('not measured'),true);
 assert.match(SOURCE_FINISH_ASSUMPTIONS.terrainProvenance,/not calibrated/);
 assert.equal('ridgeReliefMetres' in SOURCE_FINISH_ASSUMPTIONS,false);
});

test('scene finish retains source textures, vertex colors, roughness hooks, and unrelated water',()=>{
 const root=new T.Group(),g=new T.PlaneGeometry(),rock=new T.MeshPhysicalMaterial({vertexColors:true}),water=new T.MeshPhysicalMaterial({transmission:1,roughness:.025});
 const compile=s=>{s.fragmentShader+='\n'+relief('.045')+'\n// native sunlight and surfaceRoughness retained';};rock.onBeforeCompile=compile;rock.customProgramCacheKey=()=> 'native-springs-rock-triplanar-1.8';
 root.add(new T.Mesh(g,rock),new T.Mesh(g,water));const originalWater=water.onBeforeCompile;
 const finish=applyDirection11SourceFinishes(T,{sceneRoot:root}),s=shader();assert.equal(finish.counts.scenes,1);rock.onBeforeCompile(s);
 assert.match(s.fragmentShader,/native sunlight and surfaceRoughness retained/);assert.match(s.fragmentShader,/texture2D\(nativeRelief/);assert.equal(rock.vertexColors,true);assert.equal(water.onBeforeCompile,originalWater);assert.equal(water.roughness,.025);
 assert.equal(finish.audit[0].amplitude,'Unchanged source-authored gain');assert.equal('maxHeightMetres' in finish.audit[0],false);assert.match(rock.customProgramCacheKey(),/v2-preserved-gain/);
 finish.dispose();assert.equal(rock.onBeforeCompile,compile);g.dispose();rock.dispose();water.dispose();
});
