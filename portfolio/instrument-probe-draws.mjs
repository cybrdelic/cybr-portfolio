// Match Three r180's opaque render-list order, then split its original index
// intervals. No vertex, normal, material or pixel resolution is changed.
export function planProbeDraws({THREE,scene,meshes,camera,maxTriangles=8192,sortObjects=true}){
  if(!Number.isInteger(maxTriangles)||maxTriangles<1)throw Error('Invalid probe triangle budget');
  const allowed=new Set(meshes),items=[],projection=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  const frustum=new THREE.Frustum().setFromProjectionMatrix(projection),position=new THREE.Vector3();
  function visit(object,groupOrder=0){
    if(!object.visible)return;
    if(object.isGroup)groupOrder=object.renderOrder;
    if(allowed.has(object)&&object.layers.test(camera.layers)&&(!object.frustumCulled||frustum.intersectsObject(object))){
      const geometry=object.geometry,total=geometry.index?.count??geometry.attributes.position.count;
      const start=geometry.drawRange.start,end=Math.min(total,start+geometry.drawRange.count);
      const z=position.setFromMatrixPosition(object.matrixWorld).applyMatrix4(projection).z;
      const add=(material,group)=>{
        if(!material?.visible)return;
        const first=Math.max(start,group?.start??0),last=Math.min(end,group?group.start+group.count:total);
        if(last>first)items.push({object,material,start:first,count:last-first,groupOrder,renderOrder:object.renderOrder,z,id:object.id});
      };
      if(Array.isArray(object.material))for(const group of geometry.groups)add(object.material[group.materialIndex],group);
      else add(object.material);
    }
    for(const child of object.children)visit(child,groupOrder);
  }
  visit(scene);
  if(sortObjects)items.sort((a,b)=>a.groupOrder-b.groupOrder||a.renderOrder-b.renderOrder||a.material.id-b.material.id||a.z-b.z||a.id-b.id);
  const draws=[];
  for(const item of items){
    if(item.start%3||item.count%3)throw Error('Probe source is not an aligned triangle interval');
    for(let offset=0;offset<item.count;offset+=maxTriangles*3)
      draws.push({...item,start:item.start+offset,count:Math.min(maxTriangles*3,item.count-offset)});
  }
  return draws;
}

// This is the vendored r180 equirectangular conversion shader and native cube
// size, split into six submissions instead of CubeCamera.update's one task.
export function createProbeBackground(THREE,renderer,environment){
  if(![THREE.EquirectangularReflectionMapping,THREE.EquirectangularRefractionMapping].includes(environment.mapping))return null;
  const target=new THREE.WebGLCubeRenderTarget(environment.image.height/2);
  Object.assign(target.texture,{type:environment.type,colorSpace:environment.colorSpace,
    generateMipmaps:environment.generateMipmaps,minFilter:environment.minFilter,magFilter:environment.magFilter,
    mapping:environment.mapping===THREE.EquirectangularReflectionMapping?THREE.CubeReflectionMapping:THREE.CubeRefractionMapping});
  const geometry=new THREE.BoxGeometry(5,5,5),material=new THREE.ShaderMaterial({name:'CubemapFromEquirect',side:THREE.BackSide,blending:THREE.NoBlending,
    uniforms:{tEquirect:{value:environment}},
    vertexShader:`varying vec3 vWorldDirection;
vec3 transformDirection(in vec3 dir,in mat4 matrix){return normalize((matrix*vec4(dir,0.0)).xyz);}
void main(){vWorldDirection=transformDirection(position,modelMatrix);
#include <begin_vertex>
#include <project_vertex>
}`,
    fragmentShader:`uniform sampler2D tEquirect;varying vec3 vWorldDirection;
#include <common>
void main(){vec3 direction=normalize(vWorldDirection);vec2 sampleUV=equirectUv(direction);gl_FragColor=texture2D(tEquirect,sampleUV);}`});
  const mesh=new THREE.Mesh(geometry,material),camera=new THREE.CubeCamera(1,10,target);
  let face=0,disposed=false;
  function prepareCamera(){camera.updateMatrixWorld();if(camera.coordinateSystem!==renderer.coordinateSystem){camera.coordinateSystem=renderer.coordinateSystem;camera.updateCoordinateSystem();}}
  return{get ready(){return face===6;},get face(){return face;},texture:target.texture,
    async prepare(){prepareCamera();await renderer.compileAsync?.(mesh,camera.children[0]);},
    step(){
      if(disposed||face===6)return false;prepareCamera();
      const minimum=environment.minFilter,mipmaps=target.texture.generateMipmaps;
      try{
        if(minimum===THREE.LinearMipmapLinearFilter)environment.minFilter=THREE.LinearFilter;
        target.texture.generateMipmaps=face===5?environment.generateMipmaps:false;
        renderer.setRenderTarget(target,face,camera.activeMipmapLevel);renderer.render(mesh,camera.children[face]);face++;
      }finally{environment.minFilter=minimum;target.texture.generateMipmaps=mipmaps;}
      if(face===6)target.texture.needsPMREMUpdate=true;
      return true;
    },dispose(){if(disposed)return;disposed=true;target.dispose();geometry.dispose();material.dispose();}};
}
