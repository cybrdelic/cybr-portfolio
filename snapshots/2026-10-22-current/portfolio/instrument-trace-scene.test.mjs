import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScene, updateScene, rigidTransform } from './instrument-trace-scene.mjs';

const identity = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const pose = (x, y, z, angle = 0) => [Math.cos(angle),Math.sin(angle),0,0, -Math.sin(angle),Math.cos(angle),0,0, 0,0,1,0, x,y,z,1];
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function cube(dynamic = false, matrix = identity()) {
  const positions = new Float32Array([-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1]);
  return { positions, normals: Float32Array.from(positions, v => v / Math.sqrt(3)),
    indices: new Uint32Array([0,2,1,0,3,2, 4,5,6,4,6,7, 0,1,5,0,5,4, 1,2,6,1,6,5, 2,3,7,2,7,6, 3,0,4,3,4,7]),
    materialIndex: 3, boundaryRanges: [{ start: 0, count: 18, id: 71 }, { start: 18, count: 18, id: 72 }], matrix, dynamic };
}
function boundsAt(result, node) {
  const f = new Float32Array(result.nodes), at = node * 12;
  return [[f[at], f[at + 1], f[at + 2]], [f[at + 4], f[at + 5], f[at + 6]]];
}
function assertEncloses(bounds, point) {
  for (let k = 0; k < 3; k++) assert.ok(point[k] >= bounds[0][k] - 1e-10 && point[k] <= bounds[1][k] + 1e-10, `AABB misses ${point} at axis ${k}`);
}
function inspectHierarchy(result) {
  const a = result.acceleration, u = new Uint32Array(result.nodes), g = result.geometry;
  for (const template of a.templates) {
    const seen = [];
    function visit(node) {
      const at = node * 12, bounds = boundsAt(result, node);
      assert.ok(node >= template.nodeStart && node < template.nodeStart + template.nodeCount);
      if (u[at + 11]) {
        for (let t = u[at + 10]; t < u[at + 10] + u[at + 11]; t++) {
          seen.push(t);
          for (let vertex = 0; vertex < 3; vertex++) assertEncloses(bounds, [0,1,2].map(k => g[t * 12 + k] + (vertex ? g[t * 12 + vertex * 4 + k] : 0)));
        }
      } else {
        for (const child of [u[at + 8], u[at + 9]]) { const childBounds = boundsAt(result, child); assertEncloses(bounds, childBounds[0]); assertEncloses(bounds, childBounds[1]); visit(child); }
      }
    }
    visit(template.nodeStart);
    assert.deepEqual(seen.sort((x,y) => x-y), Array.from({length:template.count}, (_,i) => template.triangleStart+i));
  }
  const instances = [];
  function visitTLAS(node) {
    const at = node * 12, bounds = boundsAt(result, node);
    assert.ok(node < a.tlasNodeCount);
    if (u[at + 11] & 0x80000000) {
      for (let j = 0; j < (u[at + 11] & 0x7fffffff); j++) {
        const record = u[at + 10] + j, source = a.instanceOrder[record - a.recordStart], t = a.templates[source];
        instances.push(source); assert.equal(record, a.instanceSlots[source]);
        assert.equal(u[record*12+8], t.nodeStart); assert.equal(u[record*12+11], t.nodeStart); assert.equal(u[record*12+9], source+1);
        const m = t.matrix;
        for (let mask = 0; mask < 8; mask++) {
          const p = t.localBounds[0].map((v,k) => mask & (1<<k) ? t.localBounds[1][k] : v);
          assertEncloses(bounds, [0,1,2].map(k => m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2]+m[12+k]*a.scale));
        }
      }
    } else for (const child of [u[at+8],u[at+9]]) { const cb=boundsAt(result,child); assertEncloses(bounds,cb[0]); assertEncloses(bounds,cb[1]); visitTLAS(child); }
  }
  visitTLAS(0); assert.deepEqual(instances.sort((x,y)=>x-y),Array.from({length:a.templates.length},(_,i)=>i));
}
function edges(indices) {
  const map = new Map();
  for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){
    const a=indices[i+j],b=indices[i+(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;
    const item=map.get(key)||{count:0,winding:0};item.count++;item.winding+=a<b?1:-1;map.set(key,item);
  }
  for(const edge of map.values()){assert.equal(edge.count,2);assert.equal(edge.winding,0);}
}
test('native Z-up coordinates, material/boundary identities, finish and albedo survive packing', () => {
  const mesh=cube();mesh.colors=new Float32Array(mesh.positions.length).fill(.4);mesh.finish=new Float32Array(16);
  for(let v=0;v<8;v++)mesh.finish.set([.7,.5],v*2);
  const result=buildScene({meshes:[mesh]});const t=result.acceleration.templates[0];
  for(let face=0;face<t.count;face++){
    const source=t.order[face],g=face*12,a=face*24;
    assert.equal(result.geometry[g+3],3);assert.equal(result.attributes[a+3],source<6?71:72);
    for(let k=0;k<3;k++)near(result.geometry[g+k],mesh.positions[mesh.indices[source*3]*3+k]*.005,1e-9);
    for(let j=0;j<3;j++){near(result.attributes[a+12+j*4],.2);near(result.attributes[a+15+j*4],.7);}
  }
  assert.equal(new Float32Array(result.nodes)[3],Math.fround(.1));inspectHierarchy(result);
});
test('BLAS and TLAS completely enclose source triangles after arbitrary rigid poses', () => {
  const meshes=Array.from({length:9},(_,i)=>cube(false,pose(i*31-100,i*7-25,i*3,i*.41)));
  const result=buildScene({meshes});inspectHierarchy(result);
  meshes.forEach((m,i)=>m.matrix=pose(200-i*39,100-i*11,i*21,Math.PI-i*.32));
  const geometry=result.geometry.slice(),attributes=result.attributes.slice(),updates=updateScene(result,meshes);
  inspectHierarchy(result);assert.equal(updates.stats.changedTransforms,9);assert.equal(updates.geometry.length,0);assert.equal(updates.attributes.length,0);
  assert.deepEqual(result.geometry,geometry);assert.deepEqual(result.attributes,attributes);
  assert.ok(updates.nodes.every(r=>r.offset+r.size<=result.acceleration.blasStart*48));
});
test('dynamic closed mesh refit preserves topology and static buffers, with precise upload ranges', () => {
  const meshes=[cube(false,pose(-20,0,0)),cube(true,pose(20,0,0))],result=buildScene({meshes});
  const staticTemplate=result.acceleration.templates[0],dynamicTemplate=result.acceleration.templates[1];
  const geometryBefore=result.geometry.slice(),attributesBefore=result.attributes.slice(),nodesBefore=new Uint8Array(result.nodes).slice();
  const indicesBefore=meshes[1].indices.slice();edges(indicesBefore);
  for(let i=0;i<meshes[1].positions.length;i+=3){meshes[1].positions[i]+=meshes[1].positions[i+2]*.35;meshes[1].normals[i]*=.8;}
  const changes=updateScene(result,meshes);inspectHierarchy(result);edges(meshes[1].indices);assert.deepEqual(meshes[1].indices,indicesBefore);
  assert.equal(changes.stats.changedGeometry,1);assert.equal(changes.stats.changedAttributes,1);
  assert.deepEqual(changes.geometry,[{offset:dynamicTemplate.triangleStart*48,size:dynamicTemplate.count*48}]);
  assert.deepEqual(changes.attributes,[{offset:dynamicTemplate.triangleStart*96,size:dynamicTemplate.count*96}]);
  assert.deepEqual(result.geometry.subarray(0,staticTemplate.count*12),geometryBefore.subarray(0,staticTemplate.count*12));
  assert.deepEqual(result.attributes.subarray(0,staticTemplate.count*24),attributesBefore.subarray(0,staticTemplate.count*24));
  const begin=staticTemplate.nodeStart*48,end=begin+staticTemplate.nodeCount*48;
  assert.deepEqual(new Uint8Array(result.nodes).subarray(begin,end),nodesBefore.subarray(begin,end));
  const unchanged=updateScene(result,meshes);assert.equal(unchanged.changed,false);assert.deepEqual(unchanged.nodes,[]);assert.deepEqual(unchanged.geometry,[]);assert.deepEqual(unchanged.attributes,[]);
});
test('quaternion matches source column-major rotation and rejects scale, shear or reflection', () => {
  const angle=1.23,m=pose(100,20,-9,angle),t=rigidTransform(m),[x,y,z,w]=t.quaternion;
  near(x,0);near(y,0);near(z,Math.sin(angle/2));near(w,Math.cos(angle/2));assert.deepEqual(t.translation,[.5,.1,-.045]);
  for(const axis of [0,5,10]){const bad=identity();bad[axis]*=2;assert.throws(()=>rigidTransform(bad),/rigid/);}
  const shear=identity();shear[4]=.1;assert.throws(()=>rigidTransform(shear),/rigid/);
  const reflected=identity();reflected[0]=-1;assert.throws(()=>rigidTransform(reflected),/Reflected/);
  const nan=identity();nan[12]=NaN;assert.throws(()=>rigidTransform(nan),/nonfinite/);
});
test('malformed geometry, identities and changed cable topology fail explicitly', () => {
  const invalid=cube();invalid.positions[0]=NaN;assert.throws(()=>buildScene({meshes:[invalid]}),/nonfinite/);
  const badIndex=cube();badIndex.indices[0]=99;assert.throws(()=>buildScene({meshes:[badIndex]}),/outside/);
  const range=cube();range.boundaryRanges[0].count=4;assert.throws(()=>buildScene({meshes:[range]}),/boundary/);
  const material=cube();material.materialIndex=.5;assert.throws(()=>buildScene({meshes:[material]}),/material/);
  const dynamic=cube(true),result=buildScene({meshes:[dynamic]});dynamic.indices[0]=1;assert.throws(()=>updateScene(result,[dynamic]),/topology/);
  assert.throws(()=>updateScene(result,[dynamic],.01),/scale/);
});
test('thin submillimetre closed meshes retain indexed triangles and conservative bounds', () => {
  const mesh=cube(true,pose(238,-54,79,.72));
  for(let i=0;i<mesh.positions.length;i+=3){mesh.positions[i]*=33;mesh.positions[i+1]*=.015;mesh.positions[i+2]*=22;}
  const result=buildScene({meshes:[mesh]});assert.equal(result.stats.triangles,12);inspectHierarchy(result);
  mesh.positions[0]-=.01;mesh.positions[1]-=.005;updateScene(result,[mesh]);inspectHierarchy(result);edges(mesh.indices);
});

const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
function rotate(q,v){const t=cross(q.slice(0,3),v).map(x=>x*2),r=cross(q.slice(0,3),t);return v.map((x,k)=>x+q[3]*t[k]+r[k]);}
function recordTransform(result,source){
  const f=new Float32Array(result.nodes),at=result.acceleration.instanceSlots[source]*12,q=Array.from(f.subarray(at+4,at+8)),l=Math.hypot(...q);
  return {p:Array.from(f.subarray(at,at+3)),q:q.map(v=>v/l)};
}
function triangleHit(g,id,o,d){
  const at=id*12,p=Array.from(g.subarray(at,at+3)),e1=Array.from(g.subarray(at+4,at+7)),e2=Array.from(g.subarray(at+8,at+11));
  const c=cross(d,e2),det=dot(e1,c);if(Math.abs(det)<1e-16)return Infinity;
  const s=o.map((v,k)=>v-p[k]),u=dot(s,c)/det;if(u<0||u>1)return Infinity;
  const q=cross(s,e1),v=dot(d,q)/det;if(v<0||u+v>1)return Infinity;
  const t=dot(e2,q)/det;return t>1e-6?t:Infinity;
}
function localRay(transform,o,d){const inverse=[-transform.q[0],-transform.q[1],-transform.q[2],transform.q[3]];return {o:rotate(inverse,o.map((v,k)=>v-transform.p[k])),d:rotate(inverse,d)};}
function boxHit(result,node,o,d,limit){
  const b=boundsAt(result,node);let lo=0,hi=limit;
  for(let k=0;k<3;k++){
    if(Math.abs(d[k])<1e-16){if(o[k]<b[0][k]||o[k]>b[1][k])return false;continue;}
    let a=(b[0][k]-o[k])/d[k],z=(b[1][k]-o[k])/d[k];if(a>z)[a,z]=[z,a];lo=Math.max(lo,a);hi=Math.min(hi,z);
    if(hi<lo)return false;
  }return true;
}
function bruteHit(result,o,d){
  let closest=Infinity;
  result.acceleration.templates.forEach((template,source)=>{
    const ray=localRay(recordTransform(result,source),o,d);
    for(let i=template.triangleStart;i<template.triangleStart+template.count;i++)closest=Math.min(closest,triangleHit(result.geometry,i,ray.o,ray.d));
  });return closest;
}
function acceleratedHit(result,o,d){
  const a=result.acceleration,u=new Uint32Array(result.nodes);let closest=Infinity;
  const stack=[0];while(stack.length){
    const node=stack.pop(),at=node*12;if(!boxHit(result,node,o,d,closest))continue;
    if(u[at+11]&0x80000000){
      for(let j=0;j<(u[at+11]&0x7fffffff);j++){
        const record=u[at+10]+j,source=a.instanceOrder[record-a.recordStart],ray=localRay(recordTransform(result,source),o,d),blas=[u[record*12+11]];
        while(blas.length){const n=blas.pop(),b=n*12;if(!boxHit(result,n,ray.o,ray.d,closest))continue;
          if(u[b+11])for(let t=u[b+10];t<u[b+10]+u[b+11];t++)closest=Math.min(closest,triangleHit(result.geometry,t,ray.o,ray.d));
          else blas.push(u[b+8],u[b+9]);
        }
      }
    }else stack.push(u[at+8],u[at+9]);
  }return closest;
}
test('thin rotated edge rays match a brute-force triangle oracle before and after refit',()=>{
  const meshes=Array.from({length:7},(_,i)=>{const m=cube(true,pose(141+i*67,-100+i*41,80-i*7,i*.67));
    for(let v=0;v<m.positions.length;v+=3){m.positions[v]*=31;m.positions[v+1]*=.015;m.positions[v+2]*=23;}return m;});
  const result=buildScene({meshes});let hitChecks=0;
  function compare(){
    result.acceleration.templates.forEach((template,source)=>{
      const transform=recordTransform(result,source),g=result.geometry;
      for(let face=0;face<template.count;face++)for(const weights of [[.2,.3],[1e-6,1e-6],[.499999,.499999]]){
        const at=(template.triangleStart+face)*12,p=Array.from(g.subarray(at,at+3)),e1=Array.from(g.subarray(at+4,at+7)),e2=Array.from(g.subarray(at+8,at+11));
        const normal=cross(e1,e2),nl=Math.hypot(...normal);if(nl<1e-15)continue;
        const target=rotate(transform.q,p.map((v,k)=>v+e1[k]*weights[0]+e2[k]*weights[1])).map((v,k)=>v+transform.p[k]);
        const direction=rotate(transform.q,normal.map(v=>-v/nl)),origin=target.map((v,k)=>v-direction[k]*2);
        const expected=bruteHit(result,origin,direction),actual=acceleratedHit(result,origin,direction);
        assert.ok(Number.isFinite(expected),'oracle ray must hit source geometry');near(actual,expected,1e-9);hitChecks++;
      }
    });
  }
  compare();meshes.forEach((m,i)=>{m.matrix=pose(-99-i*22,121-i*71,-25+i*19,.17+i*.54);m.positions[0]-=.009;m.positions[1]-=.008;});
  updateScene(result,meshes);compare();assert.equal(hitChecks,504);
});
