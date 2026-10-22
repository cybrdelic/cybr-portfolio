export const projects=[
 {id:'geo',title:'GEO',category:'Geometry / mechanisms',image:'e2b07a1b39ec.webp',description:'ORBIT combines a geared inspection wrist, opposed-screw gripper, hollow palm and removable housing. Geometry, internal structure and assembly are part of the same study.'},
 {id:'scenes',title:'Scenes',category:'Architecture / environments',image:'8a06f9884912.webp',description:'Places built from geometry: vaulted rooms, mineral pools, basalt shores, flooded crystal and forest water.'},
 {id:'light',title:'Light',category:'Spectral rendering',image:'b646f09e8542.webp',description:'A native spectral renderer exploring metal highlights, absorbing glass, caustics and the atmosphere between objects.'},
 {id:'elements',title:'Elements',category:'Matter / simulation',image:'3eb2a952f664.webp',description:'Seven materials. One mark. The same interlocked silhouette ignites, suspends, fractures, disperses and falls.'},
 {id:'combat',title:'CONTACT',category:'Movement / combat',image:'38615fb85c05.webp',description:'Cleaves, counters, bounds and recoveries. Original movement built around contact, balance and a readable silhouette.'},
 {id:'song',title:'Lacuna',category:'Composition / instruments',image:'25e2546144d4.webp',description:'Original scores, calibrated sample instruments and performances that can be traced back to each note.'}
];
export function nearestIndex(centers,position){return centers.reduce((best,c,i)=>Math.abs(c-position)<Math.abs(centers[best]-position)?i:best,0);}
