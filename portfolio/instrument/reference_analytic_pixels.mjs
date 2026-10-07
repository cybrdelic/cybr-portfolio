/** Reproduce optical rays from the public mixed-projection camera receipt.
 * True opaque CAD hits are added by the integrated shared hierarchy; this
 * standalone reference does not pretend screen-visible pixels are 3D hits. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createNativeOpticalKernel,createTriangleDuctBoundary,traceNativeOpticalRay} from '../instrument-analytic-optics.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),receipt=path.join(root,'output/geo-working/pbr-credible');
const sourceBytes=await readFile(path.join(receipt,'native-reference-water.json')),source=JSON.parse(sourceBytes),reference=source.opticalReference;
if(!reference)throw Error('Public camera inverse/module reference is absent');
const recipe=JSON.parse(await readFile(path.join(root,'assets/instrument-optical-primitives-v1/primitives.json'))),bytes=await readFile(path.join(root,'assets/instrument-optical-primitives-v1/native-water-cable-boundary.bin'));
const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(4,true),triangles=view.getUint32(8,true),positions=new Float32Array(count*3),normals=new Float32Array(count*3),indices=new Uint32Array(triangles*3);
for(let i=0;i<count*3;i++){positions[i]=view.getFloat32(16+i*4,true);normals[i]=view.getFloat32(16+count*12+i*4,true);}for(let i=0;i<triangles*3;i++)indices[i]=view.getUint32(16+count*24+i*4,true);
const kernel=createNativeOpticalKernel(recipe,{ductBoundary:createTriangleDuctBoundary({positions,indices,normals})});
const point=(m,p)=>{const v=[0,1,2,3].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]);return v.slice(0,3).map(x=>x/v[3]);};
const unit=v=>v.map(x=>x/Math.hypot(...v)),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const localPoint=(m,p)=>{const q=sub(p,m.slice(12,15));return [0,1,2].map(c=>m[c*4]*q[0]+m[c*4+1]*q[1]+m[c*4+2]*q[2]);};
const localDirection=(m,d)=>unit([0,1,2].map(c=>m[c*4]*d[0]+m[c*4+1]*d[1]+m[c*4+2]*d[2]));
const module=reference.modules.find(m=>m.name==='elements'),pixels=[[934,245],[1004,295],[990,400],[927,327]],rows=[];
for(const pixel of pixels){
  const ndc=[(pixel[0]+.5)/reference.viewport[0]*2-1,1-(pixel[1]+.5)/reference.viewport[1]*2];
  const near=point(reference.cameraWorld,point(reference.projectionInverse,[...ndc,-1])),far=point(reference.cameraWorld,point(reference.projectionInverse,[...ndc,1])),worldDirection=unit(sub(far,near));
  const origin=localPoint(module.world,near),direction=localDirection(module.world,worldDirection),straightEvents=kernel.allEvents(origin,direction,{module:1}),trace=traceNativeOpticalRay({kernel,origin,direction,module:1,maxInterfaces:16});
  rows.push({pixelTopLeft:pixel,worldOriginMM:near,worldDirectionUnit:worldDirection,localOriginMM:origin,localDirectionUnit:direction,
    straightEvents:straightEvents.map(e=>({solidId:e.solidId,primitiveId:e.primitiveId,distanceMM:e.distance,pointMM:e.point,outwardNormal:e.normal,entering:e.entering})),
    refracted:{interfaceCount:trace.events.length,exhausted:trace.exhausted,exitPointLocalMM:trace.point,outgoingLocalUnit:trace.direction,transmittedFresnelWeight:trace.weight,
      events:trace.events.map(e=>({solidId:e.solidId,primitiveId:e.primitiveId,pointMM:e.point,outwardNormal:e.normal,incidentMedium:e.incidentMedium,targetMedium:e.targetMedium,tir:e.tir,fresnel:e.fresnel}))}});
}
const result={schema:1,method:'Pixel-center primary rays from captured exact mixed projection and module rigid matrix; native CSG boundary CPU reference',sourceCameraReceiptSHA256:createHash('sha256').update(sourceBytes).digest('hex'),progress:source.progress,viewport:reference.viewport,sourceGeometryHash:source.geometryHash,primitiveSourceDescriptorSHA256:recipe.sourceDescriptorSHA256,solidIds:{glass:1,water:2,air:0},ior:{air:1,glass:1.52,water:1.333},sourceDepthReads:0,opaqueHitsEvaluated:false,limitations:['Standalone optical-only trace can continue past an actual opaque CAD intercept; integrated shared BVH must stop at nearest true opaque surface.','Swept cable exclusion uses unchanged native tessellation, not exact rational BREP evaluation.','Fresnel follows one transmitted path with TIR; no recursive split reflection integrator or multi-bounce GI claim.'],rays:rows};
const destination=path.join(receipt,'analytic-optics-pixel-reference.json');await writeFile(destination,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({path:destination,rays:rows.length,interfaces:rows.map(r=>r.refracted.interfaceCount),exhausted:rows.map(r=>r.refracted.exhausted)}));
