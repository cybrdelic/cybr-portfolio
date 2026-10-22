import * as THREE from './vendor/three-r180/three.module.min.js';

// Rays intersect a baked height field of the real terrain in object space.
// No screen-space background lookup: orbit cannot drag scenery across water.
export function poolMaterial(fieldBuffer,skyTexture){
  const field=new THREE.DataTexture(new Float32Array(fieldBuffer),901,901,THREE.RGBAFormat,THREE.FloatType);
  field.minFilter=field.magFilter=THREE.LinearFilter;field.needsUpdate=true;
  return new THREE.ShaderMaterial({
    uniforms:{bed:{value:field},sky:{value:skyTexture}},toneMapped:false,
    vertexShader:`varying vec3 pWorld;
      void main(){vec4 p=modelMatrix*vec4(position,1.);pWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader:`precision highp float;
      uniform sampler2D bed;uniform sampler2D sky;varying vec3 pWorld;
      vec4 floorAt(vec2 p){return texture2D(bed,p/4.53+.5);}
      void main(){
        vec3 incident=normalize(pWorld-cameraPosition);
        vec2 q=pWorld.xz;
        vec2 slope=vec2(.014*cos(dot(q,vec2(44.,29.)))+.008*cos(dot(q,vec2(-79.,33.))),
                        .010*cos(dot(q,vec2(44.,29.)))+.012*cos(dot(q,vec2(-79.,33.))));
        vec3 n=normalize(vec3(-slope.x,1.,-slope.y));
        vec3 ray=refract(incident,n,1./1.333);
        float t=0.;vec3 hit=pWorld;vec4 sampleBed=floorAt(q);
        for(int i=0;i<72;i++){
          hit=pWorld+ray*t;sampleBed=floorAt(hit.xz);
          float gap=hit.y-sampleBed.a;
          if(gap<.001)break;
          t+=clamp(gap*.65,.002,.07);
        }
        vec3 transmittance=exp(-vec3(2.7,.63,.40)*t);
        vec3 scatter=vec3(.012,.22,.19);
        vec3 submerged=sampleBed.rgb*transmittance+scatter*(1.-transmittance);
        vec3 reflected=reflect(incident,n);
        vec2 uv=vec2(fract(atan(-reflected.z,reflected.x)/6.283185+1.),acos(clamp(reflected.y,-1.,1.))/3.141593);
        vec3 atmosphere=texture2D(sky,uv).rgb;
        // Match the native surface bake's white balance and exposure curve.
        atmosphere=max(atmosphere/vec3(1.11470179,.97639386,.89669542)*1.9,vec3(0.));
        atmosphere=atmosphere*atmosphere/(atmosphere+.035);
        float peak=max(.00001,max(atmosphere.r,max(atmosphere.g,atmosphere.b)));
        atmosphere*=(1.-exp(-peak))/peak;
        // Shore and ridge reflections also intersect the object-space field.
        for(int j=1;j<64;j++){
          vec3 r=pWorld+reflected*(float(j)*.045)+vec3(0.,.003,0.);
          if(max(abs(r.x),abs(r.z))>2.24)break;
          vec4 bank=floorAt(r.xz);
          if(bank.a>r.y){atmosphere=bank.rgb;break;}
        }
        float fresnel=.0204+.9796*pow(1.-max(0.,dot(-incident,n)),5.);
        vec3 result=mix(submerged,atmosphere,fresnel);
        vec3 sun=normalize(vec3(-.8,.28,-.4));
        float glint=pow(max(0.,dot(reflect(-sun,n),-incident)),520.);
        result+=vec3(1.,.91,.73)*glint*.22;
        gl_FragColor=vec4(result,1.);
        #include <colorspace_fragment>
      }`
  });
}
