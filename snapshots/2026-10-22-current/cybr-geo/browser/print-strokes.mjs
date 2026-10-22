// Screen-space CAD strokes. Unlike native WebGL lines, width is reliable on
// Windows/ANGLE. The segments stay in object space and retain depth testing.
export function createPrintStrokes(T,positions,{color,width=1.8,opacity=1}={}){
 const geometry=new T.InstancedBufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute([0,-1,0,1,-1,0,1,1,0,0,1,0],3));
 geometry.setIndex([0,1,2,0,2,3]);
 const starts=[],ends=[];
 for(let i=0;i<positions.length;i+=6){starts.push(...positions.slice(i,i+3));ends.push(...positions.slice(i+3,i+6));}
 geometry.setAttribute('start',new T.InstancedBufferAttribute(new Float32Array(starts),3));
 geometry.setAttribute('end',new T.InstancedBufferAttribute(new Float32Array(ends),3));geometry.instanceCount=starts.length/3;
 const material=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,
 uniforms:{ink:{value:new T.Color(color)},alpha:{value:opacity},width:{value:width},viewport:{value:new T.Vector2(1,1)}},
 vertexShader:`attribute vec3 start;attribute vec3 end;uniform vec2 viewport;uniform float width;varying float side;
 #include <common>
 #include <logdepthbuf_pars_vertex>
 void main(){vec4 a=projectionMatrix*modelViewMatrix*vec4(start,1.);vec4 b=projectionMatrix*modelViewMatrix*vec4(end,1.);
 vec2 delta=(b.xy/b.w-a.xy/a.w)*viewport;float len=length(delta);vec2 n=len>0.0001?vec2(-delta.y,delta.x)/len:vec2(0.,1.);
 gl_Position=mix(a,b,position.x);gl_Position.xy+=n*position.y*(width+1.)/viewport*gl_Position.w;side=position.y;
 if(a.w<=0.||b.w<=0.||len<0.0001)gl_Position=vec4(2.,2.,2.,1.);
 #include <logdepthbuf_vertex>
 }`,
 fragmentShader:`uniform vec3 ink;uniform float alpha;uniform float width;varying float side;
 #include <logdepthbuf_pars_fragment>
 void main(){
 #include <logdepthbuf_fragment>
 float coverage=1.-smoothstep(width/(width+1.),1.,abs(side));gl_FragColor=vec4(ink,alpha*coverage);
 }`});
 const mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;
 mesh.onBeforeRender=renderer=>{renderer.getDrawingBufferSize(material.uniforms.viewport.value);material.uniforms.width.value=width*renderer.getPixelRatio();};
 return {mesh,geometry,material};
}
