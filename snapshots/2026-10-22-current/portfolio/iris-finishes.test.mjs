import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {applyIrisFinishes} from '../cybr-geo/examples/iris01/finishes.mjs';
test('fabrication finishes distinguish housing, gear, journals and optics',()=>{
 const materials=Array.from({length:13},()=>new T.MeshPhysicalMaterial());
 materials[12].transmission=1;materials[12].ior=1.52;
 const parts=[{name:'120T involute cam gear',material:materials[2]},{name:'Pivot journal 0',material:materials[2]}];
 applyIrisFinishes(materials,parts);
 assert.equal(materials[3].metalness,1);
 assert.equal(materials[0].userData.cybrMaterial,'BrushedMetal');
 assert.equal(materials[3].userData.cybrMaterial,'BrushedMetal');
 assert.equal(parts[0].material,materials[3]);assert.equal(parts[1].material,materials[2]);
 assert.equal(materials[2].userData.cybrMaterial,'05_champagne_brass');
 for(let i=4;i<=9;i++)assert.equal(materials[i].userData.cybrMaterial,'06_blackened_steel');
 assert.equal(materials[12].transmission,1);assert.equal(materials[12].ior,1.52);
});
