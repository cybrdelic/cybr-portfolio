import * as T from './vendor/three-r180/three.module.min.js';

// Conservative projected proxy bounds, in bottom-left drawing-buffer pixels.
// A near-plane intersection makes a finite corner projection unsafe: redraw
// the full target in that case rather than clipping newly visible pixels.
export function createElementsProjectedRegion(){
 const transform=new T.Matrix4(),point=new T.Vector4();
 return function projectedRegion(mesh,camera,width,height){
  if(!mesh?.geometry||!camera||!(width>0&&height>0))return null;
  mesh.updateWorldMatrix(true,false);camera.updateMatrixWorld();
  if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
  const box=mesh.geometry.boundingBox;if(!box||box.isEmpty())return null;
  transform.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(mesh.matrixWorld);
  let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
  for(let i=0;i<8;i++){
   point.set(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z,1).applyMatrix4(transform);
   if(!point.toArray().every(Number.isFinite)||point.w<=0||point.z<=-point.w)return null;
   const x=(point.x/point.w*.5+.5)*width,y=(point.y/point.w*.5+.5)*height;
   left=Math.min(left,x);right=Math.max(right,x);bottom=Math.min(bottom,y);top=Math.max(top,y);
  }
  left=Math.max(0,Math.floor(left));right=Math.min(width,Math.ceil(right));
  bottom=Math.max(0,Math.floor(bottom));top=Math.min(height,Math.ceil(top));
  return right>left&&top>bottom?{x:left,y:bottom,width:right-left,height:top-bottom}:null;
 };
}
