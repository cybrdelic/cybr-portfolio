// Skip invisible transmission read targets only after a conservative native
// mesh bound proves that no optical surface can reach the current camera.
export function opticalGeometryInView({THREE,objects,camera}){
  camera.updateMatrixWorld();
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  return objects.some(object=>{
    if(!object.visible)return false;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    if(!materials.some(material=>(material.userData?.cadTransmission??material.transmission??0)>0))return false;
    return frustum.intersectsObject(object);
  });
}
