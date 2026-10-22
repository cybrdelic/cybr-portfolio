import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiquidEvent as createShadowSplash} from './direction11-liquid-event.mjs';
test('concept 11 owns a rounded water volume and finite reversible scroll poses',()=>{
 const asset=createShadowSplash(),sheet=asset.root.getObjectByName('Rounded liquid crest');
 assert.ok(sheet);assert.equal(sheet.material.ior,1.333);assert.equal(sheet.material.metalness,0);
 for(const u of [0,.5,1,0]){asset.update(u);asset.root.traverse(o=>{if(o.geometry)assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));});}
 sheet.geometry.computeBoundingBox();const b=sheet.geometry.boundingBox;
 assert.ok(b.max.y-b.min.y>4);assert.ok(b.max.z-b.min.z<1.3);
 assert.ok(sheet.geometry.index.count<45000);asset.dispose();
});
test('liquid breakup is a closed two-manifold rather than an open ribbon',()=>{
 const asset=createShadowSplash(),g=asset.root.getObjectByName('Rounded liquid crest').geometry,edges=new Map(),orientations=new Map();
 const indices=g.index.array;
 for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){const a=indices[i+j],b=indices[i+(j+1)%3],key=a<b?`${a}/${b}`:`${b}/${a}`;edges.set(key,(edges.get(key)||0)+1);orientations.set(key,(orientations.get(key)||0)+(a<b?1:-1));}
 assert.ok([...edges.values()].every(count=>count===2));
 assert.ok([...orientations.values()].every(count=>count===0),'each shared edge must have opposite directions');
 const droplets=asset.root.children.find(o=>o.isInstancedMesh);assert.equal(droplets.count,48);asset.dispose();
});
