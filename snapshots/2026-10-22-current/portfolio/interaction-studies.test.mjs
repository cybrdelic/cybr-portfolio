import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projects,nearestIndex} from './interaction-data.mjs';
test('all six projects link to retained pages and nonempty original media',()=>{
 assert.equal(projects.length,6);assert.equal(new Set(projects.map(p=>p.id)).size,6);
 for(const p of projects)for(const path of [`assets/${p.image}`,`${p.id}.html`])assert.ok(fs.statSync(new URL(path,import.meta.url)).size>0,path);
});
test('scrub selection uses actual variable card centers',()=>{
 assert.equal(nearestIndex([300,940,1580],600),0);assert.equal(nearestIndex([300,940,1580],650),1);assert.equal(nearestIndex([300,940,1580],1500),2);
});
test('reveal images and local entry dependencies exist',()=>{
 const html=fs.readFileSync(new URL('interaction-studies.html',import.meta.url),'utf8');
 for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g))assert.ok(fs.existsSync(new URL(match[1],import.meta.url)),match[1]);
 assert.match(html,/type="range"/);assert.match(html,/<dialog/);
});
