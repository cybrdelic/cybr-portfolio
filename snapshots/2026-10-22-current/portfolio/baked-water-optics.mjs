// Fixed-camera, geometry-derived exits. Transport records are baked offline;
// environment lighting and the editorial backing remain live.
export function createBakedWaterOptics(T,renderer){
 const depth={value:10},bounds=new T.Box3(),matrix=new T.Matrix4();let installed;
 function prepare(mesh){if(installed===mesh)return;if(!mesh.userData.bakedOptics)throw Error('Water transport bake missing');installed=mesh;
  const m=mesh.material,previous=m.onBeforeCompile;
  m.onBeforeCompile=shader=>{previous.call(m,shader);shader.uniforms.waterBackdropDepth=depth;
   const varyings='varying vec3 waterExitPoint; varying vec3 waterExitDirection; varying vec3 waterReturnPoint; varying vec3 waterReturnDirection; varying vec2 waterWeights;';
   shader.vertexShader=`attribute vec3 opticalExit;attribute vec3 opticalDirection;attribute vec3 opticalReturn;attribute vec3 opticalReflection;attribute vec2 opticalWeight;${varyings}\n`+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
    waterExitPoint=(modelViewMatrix*vec4(opticalExit,1.)).xyz;
    waterExitDirection=mat3(modelViewMatrix)*opticalDirection;
    waterReturnPoint=(modelViewMatrix*vec4(opticalReturn,1.)).xyz;
    waterReturnDirection=mat3(modelViewMatrix)*opticalReflection;
    waterWeights=vec2(opticalWeight.x,opticalWeight.y*length(modelMatrix[0].xyz));`);
   shader.fragmentShader=varyings+'\nuniform float waterBackdropDepth;\n'+shader.fragmentShader;
   // The stock volume sample is not used by this geometry-derived solution.
   // Initialize its material fields without running a redundant screen ray.
   shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_fragment>',`
    #ifdef USE_TRANSMISSION
    material.transmission=transmission;
    material.transmissionAlpha=1.;
    material.thickness=thickness;
    material.attenuationDistance=attenuationDistance;
    material.attenuationColor=attenuationColor;
    vec3 v=normalize(cameraPosition-vWorldPosition);
    vec3 n=inverseTransformDirection(normal,viewMatrix);
    vec3 lightThrough=vec3(0.),lightReturn=vec3(0.);
    for(int branch=0;branch<2;branch++){
     vec3 p=branch==0?waterExitPoint:waterReturnPoint;
     vec3 d=normalize(branch==0?waterExitDirection:waterReturnDirection);
     vec3 radiance=vec3(0.);
     #ifdef ENVMAP_TYPE_CUBE_UV
     radiance=textureCubeUV(envMap,envMapRotation*inverseTransformDirection(d,viewMatrix),material.roughness).rgb*envMapIntensity;
     #endif
     if(d.z<-.0001){vec3 q=p+d*max(0.,(-waterBackdropDepth-p.z)/d.z);vec4 clip=projectionMatrix*vec4(q,1.);vec2 uv=clip.xy/clip.w*.5+.5;
      if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.))))radiance=getTransmissionSample(uv,material.roughness,material.ior).rgb;
     }
     if(branch==0)lightThrough=radiance;else lightReturn=radiance;
    }
    vec3 entryF=EnvironmentBRDF(n,v,material.specularColor,material.specularF90,material.roughness);
    totalDiffuse=(1.-entryF)*mix(lightThrough,lightReturn,clamp(waterWeights.x,0.,1.))*volumeAttenuation(waterWeights.y,material.attenuationColor,material.attenuationDistance);
    #endif`);
  };m.customProgramCacheKey=()=> 'geometry-baked-water-v2';m.needsUpdate=true;
 }
 return {prepare,prepareProgram:async(mesh)=>prepare(mesh),render(mesh,camera){prepare(mesh);mesh.updateWorldMatrix(true,false);camera.updateMatrixWorld();matrix.multiplyMatrices(camera.matrixWorldInverse,mesh.matrixWorld);bounds.copy(mesh.geometry.boundingBox).applyMatrix4(matrix);depth.value=-bounds.min.z+.5;},dispose(){}};
}
