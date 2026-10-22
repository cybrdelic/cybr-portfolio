// Instrument-only traversal specialization. The shared CYBR LIGHT transport
// and scene geometry stay unchanged; fail if its traversal ABI changes.
function checkOccurrences(source, before, expected = 1) {
  const count = source.split(before).length - 1;
  if (count !== expected) throw new Error(`CYBR instrument traversal contract changed: expected ${expected} occurrence(s) of ${before.slice(0, 80)}`);
}
function replaceChecked(source, before, after, expected = 1) {
  checkOccurrences(source, before, expected);
  return source.replaceAll(before, after);
}

const stackDeclaration = 'var stack:array<u32,64>;var count=1u;stack[0]=';
const childPush = 'if(av&&bv){stack[count]=select(node.links.x,node.links.y,a.x<b.x);stack[count+1u]=select(node.links.y,node.links.x,a.x<b.x);count+=2u;}else if(av){stack[count]=node.links.x;count++;}else if(bv){stack[count]=node.links.y;count++;}';
const cachedChildPush = 'if(av&&bv){stack[count]=select(node.links.x,node.links.y,a.x<b.x);nearStack[count]=select(a.x,b.x,a.x<b.x);stack[count+1u]=select(node.links.y,node.links.x,a.x<b.x);nearStack[count+1u]=select(b.x,a.x,a.x<b.x);count+=2u;}else if(av){stack[count]=node.links.x;nearStack[count]=a.x;count++;}else if(bv){stack[count]=node.links.y;nearStack[count]=b.x;count++;}';
const localPop = 'count--;let ni=stack[count];let node=nodes[ni];let range=boxDistance(node,o,inv);if(range.y<range.x||range.x>=hit.t){continue;}';
const topPop = 'count--;let node=nodes[stack[count]];let range=boxDistance(node,o,inv);if(range.y<range.x||range.x>=hit.t){continue;}';
const maskExpression = '(u32(tr.e1.w)&(nodes[instance].links.y>>24u))';

export function optimizeInstrumentTraversal(source, { cacheDistances = true } = {}) {
  if (typeof source !== 'string') throw new TypeError('Expected CYBR traversal WGSL source');
  if (typeof cacheDistances !== 'boolean') throw new TypeError('Expected boolean cacheDistances');
  let result = source.replaceAll('\r\n', '\n');
  // These literal intersection expressions are also contracts consumed by
  // instancedShader's scale-relative determinant and ray-epsilon patches.
  for (const contract of ['fn localTrace(o:vec3f,d:vec3f,limit:f32,anyHit:bool,root:u32,instance:u32)->Hit{',
    'fn trace(o:vec3f,d:vec3f,limit:f32,anyHit:bool)->Hit{', 'if(abs(det)<1e-10)', 'if(t>0.00001&&t<hit.t)']) {
    if (!result.includes(contract)) throw new Error(`CYBR instrument traversal contract changed: ${contract}`);
  }
  // Check the same complete ABI in both modes. Mask-only is the measured
  // default on adapters where a second private stack lowers occupancy.
  for (const [contract, count] of [[stackDeclaration + 'root;', 1], [stackDeclaration + '0u;', 1], [localPop, 1], [topPop, 1], [maskExpression, 1], [childPush, 2]]) checkOccurrences(result, contract, count);
  result = replaceChecked(result, 'var hit=Hit(limit,-1,vec2f(0),instance);', 'var hit=Hit(limit,-1,vec2f(0),instance);let instanceMask=nodes[instance].links.y>>24u;');
  result = replaceChecked(result, maskExpression, '(u32(tr.e1.w)&instanceMask)');
  if (!cacheDistances) return result;
  result = replaceChecked(result, stackDeclaration + 'root;',
    'var stack:array<u32,64>;var nearStack:array<f32,64>;var count=0u;let rootRange=boxDistance(nodes[root],o,inv);if(!(rootRange.y<rootRange.x||rootRange.x>=hit.t)){stack[0]=root;nearStack[0]=rootRange.x;count=1u;}');
  result = replaceChecked(result, stackDeclaration + '0u;',
    'var stack:array<u32,64>;var nearStack:array<f32,64>;var count=0u;let rootRange=boxDistance(nodes[0u],o,inv);if(!(rootRange.y<rootRange.x||rootRange.x>=hit.t)){stack[0]=0u;nearStack[0]=rootRange.x;count=1u;}');
  result = replaceChecked(result, localPop,
    'count--;if(nearStack[count]>=hit.t){continue;}let ni=stack[count];let node=nodes[ni];');
  result = replaceChecked(result, topPop,
    'count--;if(nearStack[count]>=hit.t){continue;}let node=nodes[stack[count]];');
  // Push far first so LIFO still visits near first, including the original
  // right-child-first tie behavior. Re-check its cached near distance against
  // the newest closest hit when popped; an intervening hit can prune it.
  result = replaceChecked(result, childPush, cachedChildPush, 2);
  return result;
}
