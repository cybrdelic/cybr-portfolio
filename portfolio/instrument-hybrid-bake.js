import {loadPathBake} from './instrument-path-bake.js?v=4';

export async function loadHybridBake(groups,schedule,geometryHash){
 const base='./assets/instrument-targeted-path/';
 const proof=await fetch(base+'reuse-proof.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Missing four-module reuse proof');return r.json();});
 if(proof.targetGeometry!==geometryHash||!proof.geometryVerified)throw Error('Unverified hybrid geometry');
 const original=await loadPathBake(groups,schedule,proof.originalGeometry,{base:'./assets/instrument-path-light/',modules:['geo','light','elements','song']});
 let replacements;
 try{replacements=await loadPathBake(groups,schedule,geometryHash,{base,modules:['combat','scenes']});}
 catch(error){original.dispose();throw error;}
 const layers=[original,replacements];
 return {
  requestProgress(p){layers.forEach(l=>l.requestProgress(p));},
  // The complete original path controls motion; missing replacement views use
  // their physical-material fallback, never clamp scroll to a partial bake.
  resolveProgress(p){return original.resolveProgress(p);},
  setProgress(p){layers.forEach(l=>l.setProgress(p));},
  prepare(){layers.forEach(l=>l.prepare());},
  snapshot(){const values=layers.map(l=>l.snapshot());return {type:'verified four-module reuse + targeted Combat/Scenes',pending:values.some(v=>v.pending),failed:values.find(v=>v.failed)?.failed||null,complete:values.every(v=>v.complete),layers:values};},
  dispose(){layers.forEach(l=>l.dispose());}
 };
}
