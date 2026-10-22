import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {createSongAsset} from './direction14-song-asset.mjs';
import {createSplashAsset} from './direction14-splash-asset.mjs';
for(const [name,build] of [['song',createSongAsset],['water',createSplashAsset]])test(`${name}: finite native geometry and serializable materials`,()=>{
 const asset=build();let triangles=0;
 asset.root.traverse(mesh=>{if(!mesh.geometry)return;const g=mesh.geometry;for(const key of ['position','normal'])for(const v of g.attributes[key].array)assert.ok(Number.isFinite(v));triangles+=(g.index?.count??g.attributes.position.count)/3;});
 assert.ok(triangles>1000&&triangles<150000);
 const copy=new T.ObjectLoader().parse(asset.root.toJSON());assert.equal(copy.children.length,asset.root.children.length);asset.dispose();
});
test('song engraving is three batched solids with full note vocabulary',()=>{
 const a=createSongAsset();assert.equal(a.root.children.length,3);assert.equal(a.root.userData.noteCount,72);assert.equal(a.root.userData.beamCount,18);assert.equal(a.root.userData.staffLines,15);a.dispose();
});
test('scroll poses move real score systems without rebuilding geometry',()=>{
 const a=createSongAsset(),geometry=a.root.children.map(m=>m.geometry),start=a.root.children[0].position.clone();
 for(const progress of [0,.25,.5,.75,1,.5,0]){a.update(progress);a.root.children.forEach((m,i)=>{assert.equal(m.geometry,geometry[i]);assert.ok(Number.isFinite(m.rotation.y));});}
 assert.notDeepEqual(a.root.children[0].position.toArray(),start.toArray());a.dispose();
});
