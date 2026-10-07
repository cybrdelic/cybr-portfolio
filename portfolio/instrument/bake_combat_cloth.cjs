// Evaluate the project's actual XPBD cage at the selected source pose.
// Source files are read-only; no replacement rig or garment is authored here.
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'../../cybr-combat/preview');
const doc=JSON.parse(fs.readFileSync(path.join(root,'scene.json'),'utf8'));
const raw=fs.readFileSync(path.join(root,'geometry.bin'));
const frame=Number(process.argv[2]),destination=process.argv[3];
const take=doc.sequence.find(s=>frame/doc.fps>=s[0]&&frame/doc.fps<s[1]);
if(!take||!destination)throw Error('Valid source frame and output required');
const start=Math.round(take[0]*doc.fps);
function array(s){return new Float32Array(raw.buffer.slice(raw.byteOffset+s.offset,raw.byteOffset+s.offset+s.bytes));}
const frames=doc.frames.map(f=>({...f,skins:f.skins.map(array),enemies:[]}));
const context=vm.createContext({Float32Array,Float64Array,Math,Map,module:{exports:{}}});
vm.runInContext(fs.readFileSync(path.join(root,'cloth.js'),'utf8')+'\nthis.Cage=ClothCage;',context);
vm.runInContext(fs.readFileSync(path.join(root,'playback.js'),'utf8')+'\nthis.Playback=PosePlayback;',context);
const playback=new context.Playback(frames,doc.playbackRig,doc.poseRows);
const cages=doc.cloth.map(a=>a.model==='male'?new context.Cage(a):null);
for(const c of cages)if(c)c.reset(frames[start].skins[c.asset.skin]);
const steps=Math.round((frame-start)*120/doc.fps);
for(let step=1;step<=steps;step++){
  const f=start+step*doc.fps/120,i=Math.floor(f),pose=playback.sample(i,Math.min(i+1,frame),f-i);
  for(const c of cages)if(c)c.step(pose.skins[c.asset.skin]);
}
const result={frame,start,steps,source:'CYBR Combat ClothCage at 120 Hz',cages:cages.map(c=>c?Array.from(c.displacement(frames[frame].skins[c.asset.skin])):null)};
fs.writeFileSync(destination,JSON.stringify(result));
console.log(JSON.stringify({frame,start,steps,cages:cages.filter(Boolean).length,output:destination}));
