import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReferenceInstrument,referenceRecipes} from './reference-instrument.mjs';
test('reference asset implementation does not import the previous model',()=>{
 const source=readFileSync(new URL('./reference-instrument.mjs',import.meta.url),'utf8');
 assert.ok(!/^import[^;]*(mechanism-model|iris01)/m.test(source),'Old model import must not return');
 assert.deepEqual(Object.keys(referenceRecipes).sort(),['04','05','11','14','27']);
});
test('new reference instruments have finite solids and independent opening poses',()=>{
 for(const concept of Object.keys(referenceRecipes)){
  const m=createReferenceInstrument({concept});assert.equal(m.parts.length,concept==='27'?48:40);
  assert.equal(m.parts.filter(p=>p.name.startsWith('Rigid iris blade')).length,referenceRecipes[concept].blades);
  assert.equal(m.whiteprint.stats.nonManifoldEdges,0);
  for(const p of m.parts){const a=p.geometry.attributes.position.array;assert.ok(a.every(Number.isFinite));assert.ok(p.geometry.userData.cadEdges.length);}
  for(const drive of [0,.5,1,.5,0]){m.update(drive);for(const p of m.parts)assert.ok(p.matrixWorld.elements.every(Number.isFinite));}
  m.dispose();
 }
});
