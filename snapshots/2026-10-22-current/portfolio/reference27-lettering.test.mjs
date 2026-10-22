import test from 'node:test';
import assert from 'node:assert/strict';
import {technicalLettering,geoLettering} from './reference27-lettering.mjs';
test('reference lettering covers every visible navigation glyph',()=>{
 for(const text of ['CYBRDELIC','WORK','ABOUT','GEO','LIGHT','MATERIAL','ELEMENTS','SONG','COMBAT','SCENES']){
  const svg=technicalLettering(text);assert.doesNotMatch(svg,/d=""/);assert.equal((svg.match(/<path /g)||[]).length,text.length);assert.match(svg,/aria-hidden="true"/);
 }
});
test('GEO is authored vector lettering, not a raster reference',()=>{
 assert.match(geoLettering,/viewBox="0 0 362 299"/);assert.doesNotMatch(geoLettering,/<image|data:|href=/);assert.equal((geoLettering.match(/<path /g)||[]).length,3);
});
