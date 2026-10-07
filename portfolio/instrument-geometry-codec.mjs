// Lossless transfer layout only. Reconstruct the original typed-array bytes
// before Three sees them; no quantization, topology or material changes.
export function geometrySegments(meshes) {
  const strides={positions:3,normals:3,indices:1,uv:2,occlusion:1,finish:2,colors:3};
  return meshes.flatMap(mesh=>Object.entries(strides).flatMap(([key,stride])=>{
    const spec=mesh[key];
    if(!spec)return [];
    if(!['float32','uint32','int16'].includes(spec.dtype))throw Error('Unsupported CAD attribute type');
    return [{offset:spec.offset,count:spec.count,width:spec.dtype==='int16'?2:4,stride}];
  })).sort((a,b)=>a.offset-b.offset);
}

export function restoreGeometryBytes(buffer,segments) {
  const source=new Uint8Array(buffer),output=source.slice();
  let end=0;
  for(const {offset,count,width,stride} of segments){
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(count)||offset<end||count<0||
       ![2,4].includes(width)||offset%width||![1,2,3].includes(stride)||offset+count*width>source.byteLength)
      throw Error('Invalid lossless CAD segment');
    const words=width===4?new Uint32Array(output.buffer,offset,count):new Uint16Array(output.buffer,offset,count);
    for(let i=0;i<count;i++){
      let word=source[offset+i]|source[offset+count+i]<<8;
      if(width===4)word|=source[offset+count*2+i]<<16|source[offset+count*3+i]<<24;
      words[i]=i<stride?word:word^words[i-stride];
    }
    end=offset+count*width;
  }
  return output.buffer;
}
