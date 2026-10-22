import * as T from './vendor/three-r180/three.module.min.js';

// A local participating volume above the source pool, not a camera-facing
// fog card. Its bounds and density are expressed in metres in pool space.
export function createSpringVapor(){
 const geometry=new T.BoxGeometry(5,3,4),eye={value:new T.Vector3()};
 const material=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.FrontSide,uniforms:{localEye:eye},
 vertexShader:`varying vec3 localPoint;
 #include <common>
 #include <logdepthbuf_pars_vertex>
 void main(){localPoint=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
 #include <logdepthbuf_vertex>
 }`,
 fragmentShader:`precision highp float;varying vec3 localPoint;uniform vec3 localEye;
 #include <logdepthbuf_pars_fragment>
 float density(vec3 p){
  float h=(p.y+1.5)/3.;float width=.22+.6*h;
  vec2 bend=vec2(.5*sin(h*7.),.35*cos(h*6.));
  vec2 q=p.xz-bend;
  float plume=exp(-dot(q,q)/(width*width));
  vec2 r=q-vec2(1.1,-.65);plume+=.65*exp(-dot(r,r)/(width*width*.55));
  float eddies=.65+.25*sin(p.x*7.+sin(p.y*6.))*sin(p.z*6.-p.y*9.);
  return plume*eddies*smoothstep(0.,.12,h)*(1.-smoothstep(.55,1.,h));
 }
 void main(){
  #include <logdepthbuf_fragment>
  vec3 ray=normalize(localPoint-localEye),safeRay=sign(ray)*max(abs(ray),vec3(.00001));
  vec3 a=(-vec3(2.5,1.5,2.)-localEye)/safeRay,b=(vec3(2.5,1.5,2.)-localEye)/safeRay;
  vec3 lo=min(a,b),hi=max(a,b);float start=max(max(lo.x,lo.y),lo.z),end=min(min(hi.x,hi.y),hi.z);
  start=max(start,0.);float stepSize=max(end-start,0.)/16.,opticalDepth=0.;
  for(int i=0;i<16;i++){vec3 p=localEye+ray*(start+(float(i)+.5)*stepSize);opticalDepth+=density(p)*stepSize;}
  float alpha=1.-exp(-opticalDepth*1.8);if(alpha<.003)discard;
  gl_FragColor=vec4(vec3(1.05,.91,.72),alpha*.78);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`});
 const mesh=new T.Mesh(geometry,material);mesh.name='Pool / rising vapor volume';mesh.position.set(1.8,1.57,-1);
 const cameraWorld=new T.Vector3();mesh.onBeforeRender=(_renderer,_scene,camera)=>{camera.getWorldPosition(cameraWorld);eye.value.copy(mesh.worldToLocal(cameraWorld));};
 return {mesh,dispose(){geometry.dispose();material.dispose();}};
}
