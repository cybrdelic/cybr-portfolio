// Separate pipeline, not a feature branch in the ordinary gallery shader.
export function instancedShader(source,traversal,stackCapacity=64){
  if(!Number.isInteger(stackCapacity)||stackCapacity<2||stackCapacity>64)throw Error('Invalid traversal stack capacity');
  if(!source.includes('fn trace(')||!source.includes('fn lightHit('))throw Error('Trace shader contract changed');
  let s=source.replace('bary:vec2f }','bary:vec2f, instance:u32 }');
  s=s.slice(0,s.indexOf('fn trace('))+traversal+'\n'+s.slice(s.indexOf('fn lightHit('));
  s=s.replaceAll('array<u32,64>',`array<u32,${stackCapacity}>`);
  s=s.replaceAll('return n*inverseSqrt(lengthSquared);','return instanceNormal(h,n*inverseSqrt(lengthSquared));');
  // Exact two-word medium keys avoid wrapping instance*boundary at a million.
  s=s.replace('ids:array<u32,16>','ids:array<vec2u,16>').replaceAll('boundary:u32','boundary:vec2u');
  s=s.replace('var exitBoundary=0u;','var exitBoundary=vec2u(0);');
  s=s.replace('if((*stack).ids[s]==boundary)','if(all((*stack).ids[s]==boundary))');
  s=s.replaceAll('let boundary=u32(attributes[hit.id].n0.w);','let boundary=vec2u(u32(attributes[hit.id].n0.w),instanceIdentity(hit));');
  s=s.replaceAll('let boundary=u32(attributes[h.id].n0.w);','let boundary=vec2u(u32(attributes[h.id].n0.w),instanceIdentity(h));');
  s=s.replaceAll('let id=u32(attributes[hit.id].n0.w);','let id=vec2u(u32(attributes[hit.id].n0.w),instanceIdentity(hit));');
  s=s.replaceAll('let id=u32(attributes[h.id].n0.w);','let id=vec2u(u32(attributes[h.id].n0.w),instanceIdentity(h));');
  // Integer instance IDs stay exactly representable in FP32. History also
  // rejects positions/normals; do not overflow a packed material*instance ID.
  s=s.replace('surface=triangles[guide.id].p.w+3.;','surface=f32(instanceIdentity(guide))+3.;');
  s=s.replaceAll('surface=triangles[hit.id].p.w+3.;','surface=f32(instanceIdentity(hit))+3.;');
  s=s.replaceAll('surface=triangles[h.id].p.w+3.;','surface=f32(instanceIdentity(h))+3.;');
  s=s.replaceAll('selectedDistance-.0003','selectedDistance-(max(nodes[0].low.w,1e-6)*.0003)');
  // Scale-relative intersection test: tiny triangles in the million view
  // must not disappear because of a fixed world-space determinant cutoff.
  s=s.replace('if(abs(det)<1e-10)','if(abs(det)<1e-8*length(tr.e1.xyz)*length(tr.e2.xyz))');
  s=s.replaceAll('0.00001','(max(nodes[0].low.w,1e-6)*0.00001)');
  s=s.replaceAll('*.0001','*(max(nodes[0].low.w,1e-6)*.0001)').replaceAll('distance-.0003','distance-(max(nodes[0].low.w,1e-6)*.0003)');
  s=s.replace('geometricNormal*select(-.0001,.0001,','geometricNormal*max(nodes[0].low.w,1e-6)*select(-.0001,.0001,');
  s=s.replace('if(lengthSquared<1e-20){return vec3f(0,1,0);}','if(lengthSquared<1e-35){return vec3f(0,1,0);}');
  s=s.replace('triangles[hit.id].p.w==triangles[guide.id].p.w&&','instanceIdentity(hit)==instanceIdentity(guide)&&triangles[hit.id].p.w==triangles[guide.id].p.w&&');
  return s;
}
