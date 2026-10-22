import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
test('three chapters and six directly accessible project previews',()=>{
 assert.equal([...html.matchAll(/data-stop=/g)].length,3);
 const shelf=html.match(/<nav class="project-shelf"[\s\S]*?<\/nav>/)[0];
 assert.equal([...shelf.matchAll(/<a href=/g)].length,6);
 for(const [,src] of shelf.matchAll(/<img src="([^"]+)"/g))assert.ok(existsSync(new URL(src,import.meta.url)),src);
 assert.ok(!html.includes('<dialog'));
});
test('presentation uses concrete subjects rather than the removed slogans',()=>{
 for(const copy of ['With consequence','Light, by design','Six ways','NO SIMPLIFIED','NO INDEPENDENT'])assert.ok(!html.includes(copy),copy);
 assert.ok(html.includes('mask-type:luminance'));
});
