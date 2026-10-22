import * as T from './vendor/three-r180/three.module.min.js';
import {trimWaterInterface} from './native-springs-boundary.mjs';
import {createSpringVapor} from './direction11-spring-vapor.mjs';
import {loadTextureAssets} from './texture-asset-load.mjs';

// Ground has refracted-sun transport and a different relief/albedo expression
// from rocks. Identical scale alone is NOT an identical shader program.
export const nativeRockShaderKey=(materialIndex,scale)=>`native-springs-rock-triplanar-${scale}/source-material-${materialIndex}`;

// Browser reconstruction of source-authored ripple slopes. No beauty image.
export async function applyNativeSpringsFinish(root,meta,{prepareTexture}={}){
 const bakeBase=meta.sunBakeBase||'./assets/direction11-springs-sun/';
 const sunMeta=await fetch(bakeBase+'manifest.json').then(r=>{if(!r.ok)throw Error('Water sunlight bake unavailable');return r.json();});
 if(sunMeta.sourceFile!==meta.file)throw Error('Water sunlight bake does not match source geometry');
 const sunResponse=await fetch(bakeBase+'visibility.rgba.gz');if(!sunResponse.ok)throw Error('Water sunlight data unavailable');
 const sunBytes=new Uint8Array(await new Response(sunResponse.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
 if(sunBytes.length!==sunMeta.size**2*4)throw Error('Truncated water sunlight bake');
 const sunVisibility=new T.DataTexture(sunBytes,sunMeta.size,sunMeta.size);sunVisibility.minFilter=sunVisibility.magFilter=T.LinearFilter;sunVisibility.needsUpdate=true;prepareTexture?.(sunVisibility);
 const source='../cybr-scenes/environments/engines/hot/cybr-geo/examples/desert_hot_springs/assets/';
 const response=await fetch(source+'ripple_modes.json');if(!response.ok)throw Error('Native ripple modes unavailable');
 const modes=(await response.json()).modes_kx_ky_amplitude_phase,size=512,data=new Float32Array(size*size*4);
 for(let y=0;y<size;y++){
  for(let x=0;x<size;x++){
   const px=x/(size-1)*24-12,py=y/(size-1)*24-12;let dx=0,dy=0;
   for(const [kx,ky,a,phase] of modes){const s=a*Math.cos(kx*px+ky*py+phase);dx+=kx*s;dy+=ky*s;}
   const n=new T.Vector3(-dx,-dy,1).normalize(),i=(y*size+x)*4;
   // Source slopes are smaller than an 8-bit normal-map quantization step.
   // Preserve them instead of turning the surface into flat, stepped bands.
   data[i]=n.x*.5+.5;data[i+1]=n.y*.5+.5;data[i+2]=n.z*.5+.5;data[i+3]=1;
  }
  if(y%32===0)await new Promise(resolve=>setTimeout(resolve,0));
 }
 const ripple=new T.DataTexture(data,size,size,T.RGBAFormat,T.FloatType);ripple.generateMipmaps=true;ripple.minFilter=T.LinearMipmapLinearFilter;ripple.magFilter=T.LinearFilter;ripple.needsUpdate=true;prepareTexture?.(ripple);
 const rockBase='../cybr-scenes/environments/engines/geode/assets/inputs/cybr-geo/examples/desert_hot_springs_v3/assets/';
 let rock,relief;
 try{[rock,relief]=await loadTextureAssets(new T.TextureLoader(),['brown_mud_rocks_01_diff_2k.jpg','brown_mud_rocks_01_disp_2k.jpg'].map(f=>rockBase+f));}
 catch(error){ripple.dispose();sunVisibility.dispose();throw error;}
 rock.colorSpace=T.SRGBColorSpace;for(const t of [rock,relief]){t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=4;prepareTexture?.(t);}
 const patched=new Set();
 for(const mesh of root.children){const record=meta.meshes.find(m=>m.name===mesh.name);if(!record)continue;const mat=mesh.material;
  // Source shade() perturbations sampled at sparse vertices are not valid
  // interpolation normals. Keep topology normals; reconstruct relief per pixel.
  if(record.material===0||record.material===5)mesh.geometry.computeVertexNormals();
  if(record.material===0){const before=mesh.onBeforeRender;mesh.onBeforeRender=function(...args){before?.apply(this,args);if(mat.userData.waterSunMix)mat.userData.waterSunMix.value=root.userData.waterSunBlend??1;};}
  if([6,7].includes(record.material)){
   mat.userData.springPool=record.material===6?0:1;
   // A closed water box must not smooth the upper interface into its walls.
   // That creates metre-wide diagonal refraction bands on otherwise flat water.
   trimWaterInterface(mesh.geometry,record.material===7?1:0);
   mesh.geometry.computeVertexNormals();const normals=mesh.geometry.attributes.normal;
   for(let i=0;i<normals.count;i++)if(normals.getY(i)>.7)normals.setXYZ(i,0,1,0);normals.needsUpdate=true;
   const p=mesh.geometry.attributes.position,uv=new Float32Array(p.count*2);for(let i=0;i<p.count;i++){uv[i*2]=(p.getX(i)+12)/24;uv[i*2+1]=(-p.getZ(i)+12)/24;}mesh.geometry.setAttribute('uv',new T.BufferAttribute(uv,2));
   // Presentation wind state: 2.4 mm RMS from the source's 0.6 mm profile.
   mat.normalMap=ripple;mat.normalScale.set(4,4);mat.color.setRGB(1,1,1);mat.roughness=.025;mat.ior=1.333;
   // The export's sourceDepth is the closed volume's bounding box, not the
   // optical distance to the visible bed. Using it refracts the red terrace
   // across the entire pool in Three's screen-space transmission pass.
   // The direct-light bake already records the actual bed depth in G (0–4m).
   // Reuse it for transmission instead of refracting every shoreline pixel
   // through a constant 65cm slab. This is still screen-space transmission.
   mat.thickness=1;mat.attenuationColor.setRGB(.42,.69,.64);mat.attenuationDistance=1.8;mat.envMapIntensity=1.2;
   // The shader below replaces uniform thickness. UNorm bed.g/bed.a are at
   // most1 and the denominator is clamped to.25: max optical distance=4/.25.
   // Consumers must use this bound, not the unrelated uniform thickness=1.
   mat.userData.transmissionThicknessBounds={max:16,source:'native-pool-bed-depth-v1'};
   const waterCompile=mat.onBeforeCompile;
   mat.onBeforeCompile=shader=>{
    waterCompile.call(mat,shader);shader.uniforms.poolBedDepth={value:sunVisibility};
    shader.vertexShader='varying vec2 poolBedXZ;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npoolBedXZ=position.xz;');
    shader.fragmentShader='varying vec2 poolBedXZ;uniform sampler2D poolBedDepth;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_fragment>',T.ShaderChunk.transmission_fragment.replace('material.thickness = thickness;',`vec4 bed=texture2D(poolBedDepth,clamp((poolBedXZ-vec2(-12.,-14.))/24.,0.,1.));
      vec3 transmittedDirection=refract(-geometryViewDir,normal,1./1.333);
      material.thickness=bed.g*4.*bed.a/max(abs(dot(transmittedDirection,normal)),.25);`));
   };
   mat.customProgramCacheKey=()=> 'native-pool-bed-depth-v1';mat.needsUpdate=true;
  }
  if([0,1,2,5].includes(record.material)&&!patched.has(mat)){
   patched.add(mat);mat.normalMap=null;mat.map=null;mat.metalnessMap=null;mat.metalness=0;mat.roughness=.92;
   const previous=mat.onBeforeCompile,scale=record.material===5?.06:1.8;
   mat.onBeforeCompile=shader=>{
    previous.call(mat,shader);shader.uniforms.nativeRock={value:rock};shader.uniforms.nativeRelief={value:relief};shader.uniforms.nativeSunVisibility={value:sunVisibility};shader.uniforms.nativeSunMix={value:1};mat.userData.waterSunMix=shader.uniforms.nativeSunMix;
    shader.vertexShader='varying vec3 nativePoint; varying vec3 nativeNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nnativePoint=position;nativeNormal=normal;');
    shader.fragmentShader=`varying vec3 nativePoint;varying vec3 nativeNormal;uniform sampler2D nativeRock;uniform sampler2D nativeRelief;uniform sampler2D nativeSunVisibility;uniform float nativeSunMix;\n`+shader.fragmentShader;
    if(record.material===0){
     const shadow='getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';
     const lighting=T.ShaderChunk.lights_fragment_begin
      .replace('getDirectionalLightInfo( directionalLight, directLight );',`getDirectionalLightInfo( directionalLight, directLight );
       #if UNROLLED_LOOP_INDEX == 0
       vec3 interfaceNormal=normalize(mat3(viewMatrix)*vec3(0.,1.,0.));
       vec3 bentLight=-refract(-directLight.direction,interfaceNormal,1./1.333);
       directLight.direction=normalize(mix(directLight.direction,bentLight,waterSunWeight));
       directLight.color*=mix(vec3(1.),.98*exp(-vec3(.08,.025,.015)*waterSun.g*4.),waterSunWeight);
       #endif`)
      .replace(shadow,`mix(${shadow},waterSun.r,waterSunWeight)`);
     shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',`vec2 sunUV=(nativePoint.xz-vec2(-12.,-14.))/24.;
      vec4 waterSun=texture2D(nativeSunVisibility,clamp(sunUV,0.,1.));
      float waterSunWeight=nativeSunMix*waterSun.a*step(nativePoint.y,mix(.055,.245,waterSun.b))*step(0.,sunUV.x)*step(0.,sunUV.y)*step(sunUV.x,1.)*step(sunUV.y,1.);
      ${lighting}`);
    }
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 weights=pow(abs(normalize(nativeNormal)),vec3(4.));weights/=max(dot(weights,vec3(1.)),.001);
      vec3 p=nativePoint*${scale.toFixed(3)};
      vec3 grain=texture2D(nativeRock,p.yz).rgb*weights.x+texture2D(nativeRock,p.xz).rgb*weights.y+texture2D(nativeRock,p.xy).rgb*weights.z;
      diffuseColor.rgb*=mix(vec3(1.),clamp(vec3(.75)+grain*.65,vec3(.65),vec3(1.2)),${record.material===0?'0.22':'1.0'});
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      float h=texture2D(nativeRelief,p.yz).r*weights.x+texture2D(nativeRelief,p.xz).r*weights.y+texture2D(nativeRelief,p.xy).r*weights.z;
      vec3 qx=dFdx(vViewPosition),qy=dFdy(vViewPosition);vec3 rx=cross(qy,normal),ry=cross(normal,qx);float det=dot(qx,rx);
      normal=normalize(abs(det)*normal-sign(det)*(dFdx(h)*rx+dFdy(h)*ry)*${record.material===5?'2.0':record.material===0?'.012':'.045'});
    `);
   };mat.customProgramCacheKey=()=>nativeRockShaderKey(record.material,scale);mat.needsUpdate=true;
  }
 }
 const vapor=createSpringVapor();root.add(vapor.mesh);
 return {dispose(){root.remove(vapor.mesh);vapor.dispose();ripple.dispose();rock.dispose();relief.dispose();sunVisibility.dispose();}};
}
