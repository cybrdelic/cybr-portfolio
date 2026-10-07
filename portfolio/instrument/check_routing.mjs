import fs from 'node:fs';
import {span,takeup,takeupForLength,internal,length,distance} from '../instrument-routing.js';
const spec=JSON.parse(fs.readFileSync(new URL('../instrument-route.json',import.meta.url))),names=Object.keys(spec.ports);
const exploded=[-245,-104,9,111,220,345];
function joins(offsets){return names.slice(0,-1).map((name,i)=>span(spec.ports[name][1].map((v,k)=>v+(k===0?offsets[i]:0)),spec.ports[names[i+1]][0].map((v,k)=>v+(k===0?offsets[i+1]:0))));}
const reference=joins(exploded).reduce((s,p)=>s+length(p),0)+length(takeup(1));
const states=[];
for(let s=0;s<=20;s++){
  const offsets=exploded.map((x,i)=>x+(spec.assembled[i]-x)*s/20),external=joins(offsets),externalLength=external.reduce((sum,p)=>sum+length(p),0);
  const coil=takeupForLength(reference-externalLength),parts=[{name:'geo',points:coil.map(p=>[p[0]+offsets[0],p[1],p[2]])}];
  external.forEach((points,i)=>{parts.push({name:`${names[i]}-${names[i+1]}`,points});parts.push({name:names[i+1],points:internal(names[i+1],spec.ports[names[i+1]]).map(p=>[p[0]+offsets[i+1],p[1],p[2]])});});
  const error=Math.abs(length(coil)+externalLength-reference);
  if(error>.001)throw Error('Cable length changed');
  for(let i=1;i<parts.length;i++)if(distance(parts[i-1].points.at(-1),parts[i].points[0])>1e-6)throw Error('Disconnected cable');
  let minRadius=Infinity,worstPart='';
  for(const {points} of parts)for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1],ab=b.map((x,k)=>x-a[k]),bc=c.map((x,k)=>x-b[k]);
    const cross=[ab[1]*bc[2]-ab[2]*bc[1],ab[2]*bc[0]-ab[0]*bc[2],ab[0]*bc[1]-ab[1]*bc[0]],area=Math.hypot(...cross);
    if(area>1e-9){const radius=distance(a,b)*distance(b,c)*distance(a,c)/(2*area);if(radius<minRadius){minRadius=radius;worstPart=parts.find(p=>p.points===points).name;}}
  }
  let separation=Infinity;const arc=[0];for(let i=1;i<coil.length;i++)arc.push(arc[i-1]+distance(coil[i-1],coil[i]));
  for(let i=0;i<coil.length;i++)for(let j=i+1;j<coil.length;j++)if(arc[j]-arc[i]>15)separation=Math.min(separation,distance(coil[i],coil[j]));
  states.push({progress:s/20,offsets,lengthError:error,minBendRadius:minRadius,worstPart,coilSeparation:separation,parts});
}
const out=process.argv[2];if(out)fs.writeFileSync(out,JSON.stringify({spec,states}));
console.log(JSON.stringify({states:states.length,maxLengthError:Math.max(...states.map(s=>s.lengthError)),coilSeparation:Math.min(...states.map(s=>s.coilSeparation)),worst:states.map(({progress,minBendRadius,worstPart})=>({progress,minBendRadius,worstPart})).sort((a,b)=>a.minBendRadius-b.minBendRadius).slice(0,2),path:out}));
