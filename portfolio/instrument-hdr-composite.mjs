/** Blend the scene's premultiplied fire radiance in linear HDR, then apply
 * the same Three ACES/display transform once to the complete scene. */
export function createHdrComposite(THREE){
 const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false,samples:4});
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,2,0,0,2],2));
 const material=new THREE.ShaderMaterial({uniforms:{source:{value:target.texture}},depthTest:false,depthWrite:false,
  vertexShader:'varying vec2 screenUV;void main(){screenUV=uv;gl_Position=vec4(position,1.);}',
  fragmentShader:`uniform sampler2D source;varying vec2 screenUV;
void main(){gl_FragColor=vec4(texture2D(source,screenUV).rgb,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
 const display=new THREE.Scene(),camera=new THREE.Camera(),mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;display.add(mesh);
 const size=new THREE.Vector2();
 let hasFrame=false;
 return{render(renderer,scene,sceneCamera,paper){
   renderer.getDrawingBufferSize(size);if(target.width!==size.x||target.height!==size.y)target.setSize(size.x,size.y);
   const previous=renderer.getRenderTarget(),background=scene.background;
   let calls=0,triangles=0;
   try{
    scene.background=paper;renderer.setRenderTarget(target);renderer.render(scene,sceneCamera);
    calls+=renderer.info.render.calls;triangles+=renderer.info.render.triangles;
    renderer.setRenderTarget(previous);renderer.render(display,camera);hasFrame=true;
    calls+=renderer.info.render.calls;triangles+=renderer.info.render.triangles;
   }finally{scene.background=background;renderer.setRenderTarget(previous);}
   return{calls,triangles};
  },present(renderer){
   renderer.getDrawingBufferSize(size);
   if(!hasFrame||target.width!==size.x||target.height!==size.y)return false;
   renderer.render(display,camera);
   return{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
  },dispose(){target.dispose();geometry.dispose();material.dispose();}};
}
