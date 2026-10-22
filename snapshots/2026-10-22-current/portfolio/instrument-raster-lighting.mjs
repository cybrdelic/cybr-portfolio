// Actual opaque geometry supplies the studio shadows. The existing HDR/PMREM
// supplies environment lighting; this module does not estimate bounce GI.
export const RASTER_SHADOW_RESOLUTION=2048;
export const RASTER_KEY_DIRECTION=Object.freeze([-.55,-.72,1.1]);
const add=(a,b)=>a.map((v,i)=>v+b[i]),scale=(a,k)=>a.map(v=>v*k),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>{const n=Math.hypot(...v);if(n<1e-10)throw Error('Invalid studio light direction');return scale(v,1/n);};
export function shadowBasis(direction=RASTER_KEY_DIRECTION){const w=unit(direction),z=[0,0,1];if(Math.abs(dot(w,z))>.999)throw Error('Studio key direction cannot be parallel to Z-up');const u=unit(cross(z,w)),v=cross(w,u);return{u,v,w};}
export function boxCorners(box){const corners=[];for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)corners.push([x?box.max[0]:box.min[0],y?box.max[1]:box.min[1],z?box.max[2]:box.min[2]]);return corners;}
export function shadowCameraCoordinates(point,fit){const relative=point.map((v,i)=>v-fit.target[i]);return[dot(relative,fit.basis.u),dot(relative,fit.basis.v),fit.distance-dot(relative,fit.basis.w)];}
export function fitRasterShadowBounds(boxes,{resolution=RASTER_SHADOW_RESOLUTION,direction=RASTER_KEY_DIRECTION,paddingMM=12,extentQuantumMM=8}={}){
 if(!boxes.length||!Number.isInteger(resolution)||resolution<1||!(paddingMM>0)||!(extentQuantumMM>0))throw Error('Invalid shadow bounds or sampling policy');
 const basis=shadowBasis(direction),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(const box of boxes){if(box.min.length!==3||box.max.length!==3||box.min.some((v,i)=>!Number.isFinite(v)||!Number.isFinite(box.max[i])||v>box.max[i]))throw Error('Invalid world-space geometry bounds');for(const p of boxCorners(box)){const q=[dot(p,basis.u),dot(p,basis.v),dot(p,basis.w)];for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],q[k]);hi[k]=Math.max(hi[k],q[k]);}}}
 const span=hi.map((v,i)=>v-lo[i]),padding=Math.max(paddingMM,Math.max(...span)*.035);
 const extents=span.map(v=>Math.ceil((v+padding*2)/extentQuantumMM)*extentQuantumMM);
 const texels=[extents[0]/resolution,extents[1]/resolution];
 const center=lo.map((v,i)=>(v+hi[i])/2);
 center[0]=Math.round(center[0]/texels[0])*texels[0];center[1]=Math.round(center[1]/texels[1])*texels[1];
 center[2]=Math.round(center[2]/extentQuantumMM)*extentQuantumMM;
 const target=add(add(scale(basis.u,center[0]),scale(basis.v,center[1])),scale(basis.w,center[2]));
 const distance=Math.max(500,extents[2]+128),position=add(target,scale(basis.w,distance));
 return{basis,target,position,distance,centerLight:center,extents,texelSizeMM:texels,resolution,paddingMM:padding,lightSpaceBounds:[lo,hi],camera:{left:-extents[0]/2,right:extents[0]/2,bottom:-extents[1]/2,top:extents[1]/2,near:distance-extents[2]/2,far:distance+extents[2]/2,up:[0,0,1]}};
}

export function setupRasterLighting({THREE,renderer,scene,objects=[],cableMeshes=[],groups,schedule=()=>{},studio=true}){
 const tracked=[...new Set([...objects,...cableMeshes])],dynamic=new Set(cableMeshes);
 const oldShadow={enabled:renderer.shadowMap.enabled,type:renderer.shadowMap.type,autoUpdate:renderer.shadowMap.autoUpdate,needsUpdate:renderer.shadowMap.needsUpdate};
 const previousFlags=tracked.map(object=>({object,castShadow:object.castShadow,receiveShadow:object.receiveShadow}));
 let opaqueCount=0,opticalCount=0;
 for(const object of tracked){const materials=Array.isArray(object.material)?object.material:[object.material];const optical=materials.some(m=>m&&((m.userData?.cadTransmission??m.transmission??0)>0||(m.opacity??1)<1||m.transparent));object.castShadow=!optical;object.receiveShadow=!optical;if(optical)opticalCount++;else opaqueCount++;}
 const key=new THREE.DirectionalLight(new THREE.Color(1,1,1),studio?.95:.8);key.name='CYBR raster studio key';key.castShadow=true;
 key.shadow.mapSize.set(RASTER_SHADOW_RESOLUTION,RASTER_SHADOW_RESOLUTION);key.shadow.bias=-.00005;key.shadow.normalBias=.16;key.shadow.radius=1;key.shadow.autoUpdate=false;key.shadow.camera.up.set(0,0,1);
 const fill=new THREE.DirectionalLight(studio?new THREE.Color(1,1,1):new THREE.Color(.72,.8,1),studio?.075:.16);fill.name='CYBR raster studio fill';fill.castShadow=false;
 scene.add(key,key.target,fill,fill.target);
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
 let disposed=false,lastFit=null,pending=false,requests=0,observed=0,lastProgress=null,lastMoving=false,lastFitTime=null;
 const point=new THREE.Vector3(),worldBox=new THREE.Box3();
 function observe(){if(pending&&!renderer.shadowMap.needsUpdate&&!key.shadow.needsUpdate){pending=false;observed++;}}
 function request(){renderer.shadowMap.needsUpdate=true;key.shadow.needsUpdate=true;pending=true;requests++;schedule();}
 function worldPosition(object,value){object.position.fromArray(value);object.parent?.worldToLocal(object.position);}
 function collectBounds(geometryChanged){scene.updateMatrixWorld(true);const boxes=[];for(const object of tracked){const geometry=object.geometry;if(!geometry?.attributes?.position)continue;if(!geometry.boundingBox||(geometryChanged&&dynamic.has(object)))geometry.computeBoundingBox();if(!geometry.boundingBox||geometry.boundingBox.isEmpty())continue;worldBox.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);boxes.push({min:worldBox.min.toArray(),max:worldBox.max.toArray()});}return boxes;}
 function update(camera,{progress,moving=false,geometryChanged=false,now=0}={}){
  if(disposed)return false;observe();lastProgress=progress??lastProgress;lastMoving=!!moving;
  if(lastFit&&!geometryChanged)return false;
  const boxes=collectBounds(geometryChanged);if(!boxes.length)return false;
  lastFit=fitRasterShadowBounds(boxes);lastFitTime=now;
  worldPosition(key,lastFit.position);worldPosition(key.target,lastFit.target);
  const {up,...projection}=lastFit.camera;Object.assign(key.shadow.camera,projection);key.shadow.camera.up.set(...up);key.shadow.camera.updateProjectionMatrix();
  const fillDirection=unit([.75,.4,.65]);point.fromArray(add(lastFit.target,scale(fillDirection,lastFit.distance)));worldPosition(fill,point.toArray());worldPosition(fill.target,lastFit.target);
  key.updateMatrixWorld();key.target.updateMatrixWorld();fill.updateMatrixWorld();fill.target.updateMatrixWorld();request();return true;
 }
 function needsFrame(){if(disposed)return false;observe();return pending||!lastFit;}
 function snapshot(){observe();return{enabled:!disposed,lighting:studio?'sculptural strip studio plus grazing shadow key':'original HDR IBL plus restrained direct studio key/fill',bounceGI:false,keyIntensity:key.intensity,fillIntensity:fill.intensity,keyDirection:[...RASTER_KEY_DIRECTION],fillColor:fill.color.toArray(),shadowType:'2048 PCFSoft on actual opaque CAD and cables',shadowMapSize:[RASTER_SHADOW_RESOLUTION,RASTER_SHADOW_RESOLUTION],opaqueCasters:opaqueCount,opticalNonCasters:opticalCount,trackedObjects:tracked.length,groups:groups?.size??groups?.length??null,shadowAutoUpdate:false,shadowUpdateRequests:requests,shadowUpdatesObserved:observed,pendingShadowUpdate:pending,progress:lastProgress,moving:lastMoving,lastFitTime,fit:lastFit?{camera:lastFit.camera,target:lastFit.target,extents:lastFit.extents,texelSizeMM:lastFit.texelSizeMM}:null};}
 function dispose(){if(disposed)return;disposed=true;scene.remove(key,key.target,fill,fill.target);key.shadow.dispose();for(const record of previousFlags){record.object.castShadow=record.castShadow;record.object.receiveShadow=record.receiveShadow;}Object.assign(renderer.shadowMap,oldShadow);}
 schedule();return{update,needsFrame,snapshot,dispose};
}
