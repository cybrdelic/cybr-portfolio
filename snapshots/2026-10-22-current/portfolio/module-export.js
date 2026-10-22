// Self-contained GLB export of the actual visible module meshes, not a screenshot.
export async function exportModule(root,name){
  root.updateMatrixWorld(true);
  const doc={asset:{version:'2.0',generator:'CYBR module workshop'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}],images:[],textures:[],samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],extensionsUsed:['KHR_materials_transmission','KHR_materials_ior','KHR_materials_volume','KHR_texture_transform']};
  const chunks=[];let offset=0;const materialCache=new Map(),textureCache=new Map();
  function bufferView(data,target){const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength),padded=new Uint8Array(Math.ceil(bytes.length/4)*4);padded.set(bytes);const index=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length,...(target?{target}:{})});chunks.push(padded);offset+=padded.length;return index;}
  function accessor(attribute,target){const a=attribute.array,componentType=a instanceof Uint32Array?5125:a instanceof Uint16Array?5123:5126,index=doc.accessors.length;const min=Array(attribute.itemSize).fill(Infinity),max=Array(attribute.itemSize).fill(-Infinity);for(let i=0;i<a.length;i++){const j=i%attribute.itemSize;min[j]=Math.min(min[j],a[i]);max[j]=Math.max(max[j],a[i]);}doc.accessors.push({bufferView:bufferView(a,target),componentType,count:attribute.count,type:attribute.itemSize===1?'SCALAR':`VEC${attribute.itemSize}`,min,max});return index;}
  async function texture(t){
    if(!t)return undefined;
    if(!textureCache.has(t.uuid)){
      const canvas=document.createElement('canvas');canvas.width=t.image.width;canvas.height=t.image.height;const ctx=canvas.getContext('2d');
      // glTF texture upload does not flip Y. Match the Three.js sampler explicitly.
      if(t.flipY){ctx.translate(0,canvas.height);ctx.scale(1,-1);}ctx.drawImage(t.image,0,0);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const bytes=new Uint8Array(await blob.arrayBuffer());const source=doc.images.length;doc.images.push({bufferView:bufferView(bytes),mimeType:'image/png'});textureCache.set(t.uuid,doc.textures.length);doc.textures.push({sampler:0,source});
    }
    return {index:textureCache.get(t.uuid),extensions:{KHR_texture_transform:{scale:t.repeat.toArray(),offset:t.offset.toArray()}}};
  }
  async function material(m){
    if(materialCache.has(m.uuid))return materialCache.get(m.uuid);
    if(m.isShaderMaterial)throw new Error('This preview uses object-space water optics that GLB cannot preserve. Use the browser preview; a portable optical bake is still required.');
    const item={name:m.name||`material-${doc.materials.length}`,doubleSided:m.side===2,pbrMetallicRoughness:{baseColorFactor:[m.color.r,m.color.g,m.color.b,m.opacity],metallicFactor:m.metalness??0,roughnessFactor:m.roughness??1}};
    if(m.map)item.pbrMetallicRoughness.baseColorTexture=await texture(m.map);
    if(m.metalnessMap&&m.metalnessMap===m.roughnessMap)item.pbrMetallicRoughness.metallicRoughnessTexture=await texture(m.metalnessMap);
    if(m.normalMap)item.normalTexture={...await texture(m.normalMap),scale:m.normalScale.x};
    if(m.transmission){item.extensions={KHR_materials_transmission:{transmissionFactor:m.transmission},KHR_materials_ior:{ior:m.ior},KHR_materials_volume:{thicknessFactor:m.thickness,attenuationColor:m.attenuationColor.toArray(),attenuationDistance:m.attenuationDistance}};}
    else if(m.opacity<1)item.alphaMode='BLEND';
    const i=doc.materials.length;doc.materials.push(item);materialCache.set(m.uuid,i);return i;
  }
  const objects=[];root.traverseVisible(o=>{if(o.isMesh)objects.push(o);});
  for(const object of objects){
    const g=object.geometry,attributes={};for(const [key,id]of [['position','POSITION'],['normal','NORMAL'],['uv','TEXCOORD_0'],['color','COLOR_0']]){const a=g.getAttribute(key);if(a)attributes[id]=accessor(a,34962);}
    const primitive={attributes,material:await material(object.material)};if(g.index)primitive.indices=accessor(g.index,34963);
    const mesh=doc.meshes.length;doc.meshes.push({name:object.name||`part-${mesh}`,primitives:[primitive]});doc.scenes[0].nodes.push(doc.nodes.length);doc.nodes.push({mesh,matrix:object.matrixWorld.toArray()});
  }
  doc.buffers[0].byteLength=offset;const encoder=new TextEncoder(),json=encoder.encode(JSON.stringify(doc)),jsonSize=Math.ceil(json.length/4)*4;
  const out=new Uint8Array(12+8+jsonSize+8+offset),view=new DataView(out.buffer);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,out.length,true);view.setUint32(12,jsonSize,true);view.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jsonSize);out.set(json,20);view.setUint32(20+jsonSize,offset,true);view.setUint32(24+jsonSize,0x004e4942,true);let cursor=28+jsonSize;for(const chunk of chunks){out.set(chunk,cursor);cursor+=chunk.length;}
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([out],{type:'model/gltf-binary'}));link.href=url;link.download=name+'.glb';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  return {name,meshes:doc.meshes.length,bytes:out.length,note:'Geometry, UVs, PBR maps and water transmission exported. Preview-only procedural braid and strata shading are not embedded.'};
}
