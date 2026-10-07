import * as THREE from './vendor/three-r180/three.module.min.js';
// Measure the first back-facing interface of each real volume. This corrects
// constant slab thickness without pretending screen-space transport is tracing.
export function volumeDepth(mesh){
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,format:THREE.RedFormat,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,generateMipmaps:false});
  const uniforms={volumeBackDepth:{value:target.texture},volumeBufferSize:{value:new THREE.Vector2(1,1)}};
  const material=new THREE.ShaderMaterial({side:THREE.BackSide,vertexShader:'varying float viewDepth; void main(){vec4 p=modelViewMatrix*vec4(position,1.);viewDepth=-p.z;gl_Position=projectionMatrix*p;}',fragmentShader:'varying float viewDepth;void main(){gl_FragColor=vec4(viewDepth,0.,0.,1.);}'});
  const proxy=new THREE.Mesh(mesh.geometry,material);proxy.matrixAutoUpdate=false;proxy.frustumCulled=false;
  const scene=new THREE.Scene();scene.add(proxy);
  const compile=mesh.material.onBeforeCompile;
  mesh.material.onBeforeCompile=shader=>{
    compile.call(mesh.material,shader);Object.assign(shader.uniforms,uniforms);
    shader.fragmentShader='uniform sampler2D volumeBackDepth;uniform vec2 volumeBufferSize;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_fragment>',`
      float exitDepth=texture2D(volumeBackDepth,gl_FragCoord.xy/volumeBufferSize).r;
      material.thickness=clamp((exitDepth-vViewPosition.z)*length(vViewPosition)/max(.001,vViewPosition.z),0.,80.);
      #include <transmission_fragment>`);
  };
  mesh.material.forceSinglePass=true;mesh.material.needsUpdate=true;
  return {render(renderer,camera,size){
    if(target.width!==size.x||target.height!==size.y)target.setSize(size.x,size.y);
    uniforms.volumeBufferSize.value.copy(size);mesh.updateWorldMatrix(true,false);proxy.matrix.copy(mesh.matrixWorld);
    const color=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
    renderer.setClearColor(0,0);renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.setRenderTarget(null);renderer.setClearColor(color,alpha);
    return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
  }};
}
