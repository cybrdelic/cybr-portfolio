// Screen-space two-interface water. Measures the visible back surface instead
// of inventing an exit from uniform thickness. Off-screen and overlapping
// interfaces remain a screen-space limitation; this is not full path tracing.
export function createWaterExitOptics(T,renderer){
 // This is a geometric record, not a colour image: filtered/resolved depth
 // invents exit surfaces between water and the cleared background. In
 // particular, MSAA resolution used to turn thin silhouettes into black TIR
 // fragments. Filter normals explicitly below, only across valid depths.
 const linear=renderer.extensions.has('OES_texture_float_linear');
 const target=new T.WebGLRenderTarget(1,1,{type:T.FloatType,minFilter:linear?T.LinearFilter:T.NearestFilter,magFilter:linear?T.LinearFilter:T.NearestFilter,samples:0});
 const frontTarget=target.clone();
 const material=new T.ShaderMaterial({side:T.BackSide,vertexShader:`varying vec3 exitNormal;varying float exitDepth;void main(){vec4 p=modelViewMatrix*vec4(position,1.);exitNormal=normalMatrix*normal;exitDepth=-p.z;gl_Position=projectionMatrix*p;}`,fragmentShader:`varying vec3 exitNormal;varying float exitDepth;void main(){gl_FragColor=vec4(normalize(exitNormal)*.5+.5,exitDepth);}`});
 const scene=new T.Scene(),proxy=new T.Mesh(new T.BufferGeometry(),material);proxy.matrixAutoUpdate=false;proxy.frustumCulled=false;scene.add(proxy);
 const size=new T.Vector2(),color=new T.Color(),backdropDepth={value:10},viewBounds=new T.Box3(),viewModel=new T.Matrix4();let installed,lastSignature='';
 function attach(mesh){if(installed===mesh)return;installed=mesh;const m=mesh.material,prior=m.onBeforeCompile;
  m.onBeforeCompile=shader=>{prior.call(m,shader);shader.uniforms.waterExit={value:target.texture};shader.uniforms.waterFront={value:frontTarget.texture};shader.uniforms.waterSize={value:size};shader.uniforms.waterBackdropDepth=backdropDepth;
   shader.fragmentShader=`uniform sampler2D waterExit;uniform sampler2D waterFront;uniform vec2 waterSize;uniform float waterBackdropDepth;
   vec4 waterInterface(sampler2D field,vec2 uv){
    ${linear?`vec4 center=texture2D(field,(floor(uv*waterSize)+.5)/waterSize);
    vec4 filtered=texture2D(field,uv);
    bool continuous=center.a>.0001&&abs(filtered.a-center.a)<max(.005,center.a*.002)&&dot(normalize(filtered.xyz*2.-1.),normalize(center.xyz*2.-1.))>.9;
    return continuous?filtered:center;`:`
    vec2 pixel=uv*waterSize-.5,base=floor(pixel),f=fract(pixel);
    vec4 reference=texture2D(field,uv),sum=vec4(0.);float weight=0.;
    if(reference.a<=0.)return reference;
    for(int y=0;y<2;y++)for(int x=0;x<2;x++){
     vec4 tap=texture2D(field,(base+vec2(float(x),float(y))+.5)/waterSize);
     float w=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
     w*=step(.0001,tap.a)*step(abs(tap.a-reference.a),max(.005,reference.a*.002));
     w*=smoothstep(.75,.9,dot(normalize(tap.xyz*2.-1.),normalize(reference.xyz*2.-1.)));
     sum+=tap*w;weight+=w;
    }
    return weight>.0001?sum/weight:reference;`}
   }
   `+shader.fragmentShader;
   const baseTransmission=T.ShaderChunk.transmission_fragment.replace('vec3 v = normalize( cameraPosition - pos );','vec3 v = isOrthographic ? inverseTransformDirection(vec3(0.,0.,1.),viewMatrix) : normalize(cameraPosition-pos);');
   shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_fragment>',`${baseTransmission}
    #ifdef USE_TRANSMISSION
    vec3 entry=-vViewPosition;
    vec3 incident=isOrthographic?vec3(0.,0.,-1.):normalize(entry);
    vec3 ray=refract(incident,normal,1.0/material.ior);
    vec2 exitUV=gl_FragCoord.xy/waterSize;
    vec4 back=waterInterface(waterExit,exitUV);
    vec3 exitPoint=entry;
    for(int k=0;k<6;k++){
      float travel=max(0.,(-back.a-entry.z)/min(-.0001,ray.z));
      exitPoint=entry+ray*travel;
      vec4 clip=projectionMatrix*vec4(exitPoint,1.);
      exitUV=clip.xy/clip.w*.5+.5;
      back=waterInterface(waterExit,clamp(exitUV,vec2(.001),vec2(.999)));
    }
    // Reject a non-converged lookup: a neighbouring fold is not this ray's
    // exit. Keep the base dielectric transport for missing/ambiguous exits.
    float exitResidual=abs(exitPoint.z+back.a);
    float exitTolerance=max(.01,.05*length(exitPoint-entry));
    float exitConfidence=1.-smoothstep(exitTolerance*.25,exitTolerance,exitResidual);
    if(back.a> -entry.z+.0001 && exitConfidence>0. && all(greaterThan(exitUV,vec2(0.))) && all(lessThan(exitUV,vec2(1.)))){
      vec3 exitN=normalize(back.xyz*2.-1.);
      // Filter the exit normal only within the same depth sheet. This is a
      // pixel-footprint filter, not a blur of the refracted title or silhouette.
      // Interpolate depth and normal together inside the same interface.
      // Filtering only normals left stair-stepped depths in the ray solve.
      if(dot(ray,exitN)<0.)exitN=-exitN;
      vec3 outgoing=refract(ray,-exitN,material.ior);
      float tir=1.-step(.00001,dot(outgoing,outgoing));
      float cosine=clamp(dot(ray,exitN),0.,1.);
      // Exact dielectric Fresnel approaches one continuously at the critical
      // angle. Schlick plus a hard TIR switch produced visible contour bands.
      float cosOut=sqrt(max(0.,1.-material.ior*material.ior*(1.-cosine*cosine)));
      float rs=(material.ior*cosine-cosOut)/max(.00001,material.ior*cosine+cosOut);
      float rp=(cosine-material.ior*cosOut)/max(.00001,cosine+material.ior*cosOut);
      float fExit=mix(.5*(rs*rs+rp*rp),1.,tir);
      vec3 reflected=reflect(ray,-exitN);
      // An internally reflected ray is still inside water. It must refract
      // through the entry interface before it can sample exterior radiance.
      vec3 returnPoint=exitPoint;vec2 returnUV=exitUV;vec4 front=vec4(0.);
      bool validReturn=false;
      // Solve the measured interface depth directly. The old fixed-step march
      // spent 32 samples covering only 1.9 world units, often never reaching
      // the other side of the sheet. Reject non-converged fold crossings.
      if(abs(reflected.z)>.001){
       front=reflected.z>0.?waterInterface(waterFront,returnUV):waterInterface(waterExit,returnUV);
       float travel=0.;
       for(int k=0;k<6;k++){
        travel=(-front.a-exitPoint.z)/reflected.z;
        returnPoint=exitPoint+reflected*max(0.,travel);
        vec4 clip=projectionMatrix*vec4(returnPoint,1.);returnUV=clip.xy/clip.w*.5+.5;
        if(travel<=.001||any(lessThan(returnUV,vec2(0.)))||any(greaterThan(returnUV,vec2(1.))))break;
        front=reflected.z>0.?waterInterface(waterFront,returnUV):waterInterface(waterExit,returnUV);
       }
       validReturn=travel>.001&&front.a>.0001&&abs(returnPoint.z+front.a)<.01&&all(greaterThan(returnUV,vec2(0.)))&&all(lessThan(returnUV,vec2(1.)));
      }
      vec3 returnNormal=normalize(front.xyz*2.-1.);
      if(dot(reflected,returnNormal)<0.)returnNormal=-returnNormal;
      vec3 escaped=refract(reflected,-returnNormal,material.ior);
      float escapes=validReturn?step(.00001,dot(escaped,escaped)):0.;
      vec3 environment=vec3(0.);
      #ifdef ENVMAP_TYPE_CUBE_UV
      environment=textureCubeUV(envMap,envMapRotation*inverseTransformDirection(normalize(escaped+normal*(1.-escapes)),viewMatrix),material.roughness).rgb*envMapIntensity;
      #endif
      if(escapes>.5&&escaped.z<-.0001){
       vec3 end=returnPoint+escaped*max(0.,(-waterBackdropDepth-returnPoint.z)/escaped.z);
       vec4 projected=projectionMatrix*vec4(end,1.);vec2 uv=projected.xy/projected.w*.5+.5;
       if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.))))environment=getTransmissionSample(uv,material.roughness,material.ior).rgb;
      }
      // All rays intersect the same editorial backdrop plane. Advancing each
      // by an arbitrary three units made the lettering swim with thickness.
      float backgroundTravel=max(0.,(-waterBackdropDepth-exitPoint.z)/min(-.0001,outgoing.z));
      vec4 bgClip=projectionMatrix*vec4(exitPoint+outgoing*backgroundTravel,1.);
      vec2 bgUV=bgClip.xy/bgClip.w*.5+.5;
      vec3 background=getTransmissionSample(clamp(bgUV,vec2(.001),vec2(.999)),material.roughness,material.ior).rgb;
      #ifdef ENVMAP_TYPE_CUBE_UV
      if(outgoing.z>=-.0001||any(lessThan(bgUV,vec2(0.)))||any(greaterThan(bgUV,vec2(1.))))background=textureCubeUV(envMap,envMapRotation*inverseTransformDirection(normalize(outgoing+normal*tir),viewMatrix),material.roughness).rgb*envMapIntensity;
      #endif
      vec3 entryF=EnvironmentBRDF(n,v,material.specularColor,material.specularF90,material.roughness);
      // More internal bounces need more interfaces than this buffer stores.
      // Do not invent a chrome mirror for that unresolved path.
      if(tir<.5||escapes>.5){
       vec3 internalRadiance=escapes>.5?environment:totalDiffuse/max(vec3(.001),vec3(1.)-entryF);
       vec3 resolved=(1.-entryF)*mix(background,internalRadiance,fExit)*volumeAttenuation(length(exitPoint-entry),material.attenuationColor,material.attenuationDistance);
       totalDiffuse=mix(totalDiffuse,resolved,exitConfidence);
      }
    }
    #endif`);
  };m.customProgramCacheKey=()=> 'measured-water-exit-v4';m.needsUpdate=true;
 }
 let preparation;
 async function prepareProgram(mesh,camera){
  attach(mesh);if(preparation)return preparation;
  preparation=(async()=>{
   renderer.getDrawingBufferSize(size);target.setSize(size.x,size.y);frontTarget.setSize(size.x,size.y);
   mesh.updateWorldMatrix(true,false);proxy.geometry=mesh.geometry;proxy.matrix.copy(mesh.matrixWorld);
   let previous=renderer.getRenderTarget(),shadow=renderer.shadowMap.enabled,ready;
   try{renderer.setRenderTarget(target);renderer.shadowMap.enabled=false;ready=renderer.compileAsync(scene,camera);}
   finally{renderer.setRenderTarget(previous);renderer.shadowMap.enabled=shadow;}
   await ready;await new Promise(resolve=>setTimeout(resolve,0));
   previous=renderer.getRenderTarget();shadow=renderer.shadowMap.enabled;const range={...mesh.geometry.drawRange};scene.userData.preparingBuffers=true;
   try{mesh.geometry.setDrawRange(range.start,3);renderer.setRenderTarget(target);renderer.shadowMap.enabled=false;renderer.render(scene,camera);}
   finally{mesh.geometry.setDrawRange(range.start,range.count);renderer.setRenderTarget(previous);renderer.shadowMap.enabled=shadow;scene.userData.preparingBuffers=false;}
  })();return preparation;
 }
 return {prepare:attach,prepareProgram,render(mesh,camera){attach(mesh);renderer.getDrawingBufferSize(size);if(target.width!==size.x||target.height!==size.y){target.setSize(size.x,size.y);frontTarget.setSize(size.x,size.y);}
  mesh.updateWorldMatrix(true,false);proxy.geometry=mesh.geometry;proxy.matrix.copy(mesh.matrixWorld);
  camera.updateMatrixWorld();
  // The editorial backing is directly behind the object, not thirty world
  // units away. That arbitrary distance magnified tiny exit-normal changes
  // into repeated black title contours across the entire liquid volume.
  if(mesh.geometry.boundingBox){viewModel.multiplyMatrices(camera.matrixWorldInverse,mesh.matrixWorld);viewBounds.copy(mesh.geometry.boundingBox).applyMatrix4(viewModel);backdropDepth.value=-viewBounds.min.z+.5;}
  // This buffer depends on geometry and camera, not scroll/UI progress or light.
  const g=mesh.geometry,signature=[mesh.uuid,g.uuid,g.attributes.position.version,g.attributes.normal.version,g.index?.version,g.drawRange.start,g.drawRange.count,size.x,size.y,...mesh.matrixWorld.elements,...camera.matrixWorld.elements,...camera.projectionMatrix.elements].join('/');
  if(signature===lastSignature)return;
  const previous=renderer.getRenderTarget(),alpha=renderer.getClearAlpha(),shadow=renderer.shadowMap.enabled;renderer.getClearColor(color);
  renderer.shadowMap.enabled=false;renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();renderer.render(scene,camera);
  material.side=T.FrontSide;renderer.setRenderTarget(frontTarget);renderer.clear();renderer.render(scene,camera);material.side=T.BackSide;
  renderer.setRenderTarget(previous);renderer.setClearColor(color,alpha);renderer.shadowMap.enabled=shadow;
  lastSignature=signature;
 },dispose(){target.dispose();frontTarget.dispose();material.dispose();}};
}
