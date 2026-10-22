import test from 'node:test';
import assert from 'node:assert/strict';
import {studioCopy} from './direction11-copy.mjs';
import {chapters} from './directions-state.mjs';
import {createStudioLettering} from './studio-lettering.mjs';
test('every chapter has its own approved copy and solid project label',()=>{
 const sign=createStudioLettering();
 for(const {key,name} of chapters){
  assert.ok(studioCopy[key].title.endsWith('.'));
  assert.ok(studioCopy[key].description.length>15);
  sign.setText(name);
  assert.equal(sign.root.children.filter(o=>o.visible).length,name.length);
 }
 const count=sign.root.children.length;sign.setText('GEO');sign.setText('LIGHT');
 assert.equal(sign.root.children.length,count,'revisiting chapters must reuse their geometry');sign.dispose();
 assert.equal(new Set(Object.values(studioCopy).map(x=>x.title)).size,7);
});
