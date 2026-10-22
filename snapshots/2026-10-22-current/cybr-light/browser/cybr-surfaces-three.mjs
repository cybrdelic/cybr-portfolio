// Raster consumer of the same linear half-float CYBR MATERIAL runtime maps.
// THREE is injected so applications do not accidentally load another engine.
export async function applyCybrSurfacesThree(T,root,{anisotropy=4,manifestURL,cooperative=false,prepareTexture}={}){
 const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
 const url=manifestURL?new URL(manifestURL,import.meta.url):new URL('./assets/cybr-surfaces/manifest.json',import.meta.url);
 const response=await fetch(url);if(!response.ok)throw Error('CYBR MATERIAL manifest unavailable');
 const manifest=await response.json(),materials=new Set(),textures=[],geometries=[],mapped=new Map(),originalMaterials=[];
 root.traverse(o=>{if(o.isMesh&&o.material?.userData.cybrMaterial)materials.add(o.material);});
 try{for(const material of materials){
  const d=manifest.materials.find(d=>d.id===material.userData.cybrMaterial);if(!d)throw Error('Missing surface '+material.userData.cybrMaterial);
  let maps=mapped.get(d.id);
  if(!maps){maps=await Promise.all(d.runtimeMaps.map(async map=>{
   const res=await fetch(new URL(map.file,url));if(!res.ok)throw Error('Missing surface map '+map.file);
   const bytes=await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(bytes.byteLength!==map.bytes)throw Error('Truncated surface map '+map.file);
   const data=new Uint16Array(bytes),size=d.runtimeSize;
   const texture=new T.DataTexture(data.subarray(0,size*size*4),size,size,T.RGBAFormat,T.HalfFloatType);
   texture.mipmaps=[];let offset=0;for(let n=size;n>=1;n/=2){texture.mipmaps.push({data:data.subarray(offset,offset+n*n*4),width:n,height:n});offset+=n*n*4;}
   texture.generateMipmaps=false;texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;texture.anisotropy=anisotropy;texture.needsUpdate=true;textures.push(texture);return texture;
  }));mapped.set(d.id,maps);if(prepareTexture)for(const texture of maps){if(cooperative)await yieldTask();prepareTexture(texture);}}
  originalMaterials.push({material,color:material.color.clone(),map:material.map,roughnessMap:material.roughnessMap,metalnessMap:material.metalnessMap,normalMap:material.normalMap,roughness:material.roughness,metalness:material.metalness});
  const meshes=[];root.traverse(mesh=>{if(mesh.material===material&&mesh.geometry&&!mesh.geometry.attributes.uv)meshes.push(mesh);});
  for(const mesh of meshes){if(cooperative)await yieldTask();
   const original=mesh.geometry,g=original.index?original.toNonIndexed():original.clone(),p=g.attributes.position,uv=new Float32Array(p.count*2),scale=(material.userData.cybrMetresPerUnit??1)/d.tile_m;
   const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),n=new T.Vector3();
   for(let i=0;i<p.count;i+=3){if(cooperative&&i>0&&i%12288===0)await yieldTask();a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);n.crossVectors(b.sub(a),c.sub(a));const x=Math.abs(n.x),y=Math.abs(n.y),z=Math.abs(n.z),axis=x>=y&&x>=z?0:y>=z?1:2;for(let k=0;k<3;k++){a.fromBufferAttribute(p,i+k);uv[(i+k)*2]=(axis===0?a.y:a.x)*scale;uv[(i+k)*2+1]=(axis===2?a.y:a.z)*scale;}}
   g.setAttribute('uv',new T.BufferAttribute(uv,2));mesh.geometry=g;geometries.push({mesh,original,g});
  }
  material.color.setRGB(1,1,1);material.map=maps[0];material.roughnessMap=maps[1];material.metalnessMap=maps[1];material.normalMap=maps[2];material.roughness=1;material.metalness=1;material.needsUpdate=true;
 }}catch(e){dispose();throw e;}
 function dispose(){for(const t of textures)t.dispose();for(const {mesh,original,g} of geometries){mesh.geometry=original;g.dispose();}for(const {material,...state} of originalMaterials){material.color.copy(state.color);delete state.color;Object.assign(material,state);material.needsUpdate=true;}}
 return {count:mapped.size,dispose};
}
