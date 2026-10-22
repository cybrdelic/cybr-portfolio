import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './vendor/three-r180/three.module.min.js';
import {installTransmissionRegion} from './transmission-region.mjs';
import {readFileSync} from 'node:fs';
import {nativeRockShaderKey} from './native-springs-finish.mjs';

function fixture(scene,{width=1200,height=900}={}){
 const camera=new T.PerspectiveCamera(45,width/height,.1,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);
 const target={width,height,texture:{type:T.HalfFloatType},samples:4,scissor:new T.Vector4(0,0,width,height),scissorTest:false};
 const calls=[];
 const renderer={setRenderTarget(next){if(next)calls.push({rect:next.scissor.toArray(),enabled:next.scissorTest});return next;},
  render(){this.setRenderTarget(target);this.setRenderTarget(null);return 'rendered';}};
 const originalRender=renderer.render,originalTarget=renderer.setRenderTarget;
 const region=installTransmissionRegion(T,renderer);
 return {camera,target,calls,renderer,region,originalRender,originalTarget,
  draw(){calls.length=0;assert.equal(renderer.render(scene,camera),'rendered');return calls[0];}};
}
function instances(transforms,{count=transforms.length,thickness=.8,rootScale=1}={}){
 const scene=new T.Scene(),geometry=new T.SphereGeometry(1,12,8),material=new T.MeshPhysicalMaterial({transmission:1,thickness,roughness:.025,ior:1.333});
 const mesh=new T.InstancedMesh(geometry,material,transforms.length);mesh.scale.setScalar(rootScale);
 transforms.forEach((matrix,index)=>mesh.setMatrixAt(index,matrix));mesh.count=count;scene.add(mesh);
 return {scene,geometry,material,mesh,dispose(){geometry.dispose();material.dispose();}};
}
const transform=(x,y,z,s=.05)=>new T.Matrix4().compose(new T.Vector3(x,y,z),new T.Quaternion(),new T.Vector3(s,s,s));

test('small transmissive instances use a conservative ROI instead of disabling it globally',()=>{
 const data=instances([transform(-.2,0,0),transform(.3,.5,0)]),f=fixture(data.scene);
 const draw=f.draw();assert.equal(draw.enabled,true);
 assert.ok(draw.rect[2]<f.target.width*.5);assert.ok(draw.rect[3]<f.target.height*.5);
 assert.deepEqual(f.target.scissor.toArray(),[0,0,1200,900]);assert.equal(f.target.scissorTest,false);
 f.region.dispose();assert.equal(f.renderer.render,f.originalRender);assert.equal(f.renderer.setRenderTarget,f.originalTarget);data.dispose();
});

test('instance bounds contain explicit baked geometry with the same shader model-matrix expansion',()=>{
 const matrices=[transform(-.6,.4,.2,.03),transform(.7,-.2,-.4,.11),new T.Matrix4().compose(new T.Vector3(.2,.3,.1),new T.Quaternion().setFromEuler(new T.Euler(.2,.4,.7)),new T.Vector3(.07,.13,.2))];
 const data=instances(matrices,{rootScale:1.3}),f=fixture(data.scene),referenceScene=new T.Scene(),baked=[];
 for(const matrix of matrices){
  // Bake only instance transforms into vertices: modelMatrix and therefore
  // physical ray-length scale remain identical to the instanced shader.
  const geometry=data.geometry.clone().applyMatrix4(matrix),mesh=new T.Mesh(geometry,data.material);mesh.scale.copy(data.mesh.scale);
  referenceScene.add(mesh);baked.push(geometry);
 }
 const reference=fixture(referenceScene);
 for(const [x,y] of [[0,0],[1,-.3],[-.6,.8]]){
  data.mesh.position.set(x,y,0);referenceScene.children.forEach(mesh=>mesh.position.set(x,y,0));
  const actual=f.draw(),expected=reference.draw();assert.equal(actual.enabled,true);assert.equal(expected.enabled,true);
  // Transforming a source AABB is intentionally conservative under rotation;
  // the tighter vertex-baked envelope must be contained, not pixel-identical.
  assert.ok(actual.rect[0]<=expected.rect[0]);assert.ok(actual.rect[1]<=expected.rect[1]);
  assert.ok(actual.rect[0]+actual.rect[2]>=expected.rect[0]+expected.rect[2]);
  assert.ok(actual.rect[1]+actual.rect[3]>=expected.rect[1]+expected.rect[3]);
 }
 f.region.dispose();reference.region.dispose();baked.forEach(geometry=>geometry.dispose());data.dispose();
});

test('subpixel droplets retain the full model-matrix refraction distance',()=>{
 const data=instances([transform(0,0,0,.001)],{thickness:.8}),f=fixture(data.scene);
 const withThickness=f.draw().rect;data.material.thickness=0;const surfaceOnly=f.draw().rect;
 assert.ok(withThickness[2]>surfaceOnly[2]*2,'instance radius must not shrink the shared .8 transmission ray');
 assert.ok(withThickness[3]>surfaceOnly[3]*2);
 f.region.dispose();data.dispose();
});

test('animated instances and active counts are reread without trusting stale cached bounds',()=>{
 const data=instances([transform(-1,0,0),transform(100,0,0)],{count:1}),f=fixture(data.scene);
 const left=f.draw();assert.ok(left.rect[2]<600,'inactive far-away instances must not expand the ROI');
 data.mesh.computeBoundingBox();data.mesh.setMatrixAt(0,transform(1,0,0));data.mesh.instanceMatrix.needsUpdate=true;
 const right=f.draw();assert.ok(right.rect[0]>left.rect[0]);
 data.mesh.count=2;const both=f.draw();assert.ok(both.rect[2]>right.rect[2]);
 f.region.dispose();data.dispose();
});

test('unsafe instanced deformation and near-plane bounds retain the full-frame fallback',()=>{
 const data=instances([transform(0,0,0)]),f=fixture(data.scene);
 data.mesh.morphTexture={};assert.equal(f.draw().enabled,false);data.mesh.morphTexture=null;
 data.mesh.setMatrixAt(0,transform(0,0,9.5));assert.equal(f.draw().enabled,false);
 data.mesh.setMatrixAt(0,transform(0,0,0));data.material.roughness=.4;assert.equal(f.draw().enabled,false);
 data.material.roughness=.025;const invalid=new T.Matrix4();invalid.elements[0]=NaN;data.mesh.setMatrixAt(0,invalid);assert.equal(f.draw().enabled,false);
 data.mesh.setMatrixAt(0,transform(0,0,0));data.mesh.count=2;assert.equal(f.draw().enabled,false);
 f.region.dispose();data.dispose();
});

test('normal-mapped transmission bounds cover every ray direction at unchanged full resolution',()=>{
 const matrices=[transform(-.7,.2,0,.04),new T.Matrix4().compose(new T.Vector3(.45,-.25,.2),new T.Quaternion().setFromEuler(new T.Euler(.4,.6,.2)),new T.Vector3(.09,.04,.12))];
 const data=instances(matrices,{thickness:.8}),f=fixture(data.scene);
 data.mesh.scale.set(1.3,.7,1.1);data.mesh.rotation.set(.15,.3,-.2);
 const plain=f.draw();data.material.normalMap=new T.Texture();data.material.normalScale.set(100,100);
 const mapped=f.draw();assert.equal(mapped.enabled,true);assert.deepEqual(mapped.rect,plain.rect);
 assert.equal(f.target.width,1200);assert.equal(f.target.height,900);assert.equal(f.target.samples,4);
 const directions=[new T.Vector3(1,0,0),new T.Vector3(-1,0,0),new T.Vector3(0,1,0),new T.Vector3(0,-1,0),new T.Vector3(0,0,1),new T.Vector3(0,0,-1)];
 // Any perturbed normal can only select a direction inside this unit sphere;
 // include exact axis extrema and a dense sphere independent of normal-map UVs.
 for(let i=0;i<512;i++){
  const z=1-2*(i+.5)/512,angle=i*Math.PI*(3-Math.sqrt(5)),r=Math.sqrt(1-z*z);
  directions.push(new T.Vector3(r*Math.cos(angle),r*Math.sin(angle),z));
 }
 const scale=new T.Vector3().setFromMatrixScale(data.mesh.matrixWorld),box=data.geometry.boundingBox;
 for(const matrix of matrices){
  const model=new T.Matrix4().multiplyMatrices(data.mesh.matrixWorld,matrix);
  for(let corner=0;corner<8;corner++){
   const p=new T.Vector3(corner&1?box.max.x:box.min.x,corner&2?box.max.y:box.min.y,corner&4?box.max.z:box.min.z).applyMatrix4(model);
   for(const direction of directions){
    // Exact shader endpoint: world position + unit direction * thickness *
    // modelMatrix column lengths. Instance scale does not affect ray length.
    const endpoint=p.clone().add(direction.clone().multiply(scale).multiplyScalar(data.material.thickness)).project(f.camera);
    const x=(endpoint.x+1)*f.target.width*.5,y=(endpoint.y+1)*f.target.height*.5;
    assert.ok(x>=mapped.rect[0]&&x<=mapped.rect[0]+mapped.rect[2]);
    assert.ok(y>=mapped.rect[1]&&y<=mapped.rect[1]+mapped.rect[3]);
   }
  }
 }
 data.material.normalMap.dispose();f.region.dispose();data.dispose();
});

test('normal-map ROI still rejects vertex displacement, thickness maps, rough transmission, and dispersion',()=>{
 const data=instances([transform(0,0,0)]),f=fixture(data.scene),texture=new T.Texture();data.material.normalMap=texture;
 assert.equal(f.draw().enabled,true);
 for(const property of ['displacementMap','thicknessMap']){data.material[property]=texture;assert.equal(f.draw().enabled,false,property);data.material[property]=null;}
 data.material.roughness=.11;assert.equal(f.draw().enabled,false);data.material.roughness=.025;
 data.material.dispersion=.01;assert.equal(f.draw().enabled,false);data.material.dispersion=0;assert.equal(f.draw().enabled,true);
 texture.dispose();f.region.dispose();data.dispose();
});

test('shader-overridden pool thickness uses its explicit16-unit contract, not uniform thickness1',()=>{
 const data=instances([transform(0,0,0)],{thickness:1}),f=fixture(data.scene);
 assert.equal(f.draw().enabled,true);
 data.material.userData.transmissionThicknessBounds={max:16,source:'native-pool-bed-depth-v1'};
 assert.equal(f.draw().enabled,false,'a16-unit bound crosses the near plane and must keep full-frame rendering');
 f.camera.position.z=80;f.camera.lookAt(0,0,0);const draw=f.draw();assert.equal(draw.enabled,true);
 const p=new T.Vector3();
 for(let i=0;i<1024;i++){
  const z=1-2*(i+.5)/1024,angle=i*Math.PI*(3-Math.sqrt(5)),r=Math.sqrt(1-z*z);
  p.set(r*Math.cos(angle),r*Math.sin(angle),z).multiplyScalar(16).project(f.camera);
  const x=(p.x+1)*f.target.width*.5,y=(p.y+1)*f.target.height*.5;
  assert.ok(x>=draw.rect[0]&&x<=draw.rect[0]+draw.rect[2]);assert.ok(y>=draw.rect[1]&&y<=draw.rect[1]+draw.rect[3]);
 }
 assert.equal(data.material.thickness,1,'the optimization must not change optical transport');
 f.region.dispose();data.dispose();
});

test('unknown or invalid custom thickness bounds safely disable cropping while standard materials retain ROI',()=>{
 const data=instances([transform(0,0,0)]),f=fixture(data.scene);const baseline=f.draw();assert.equal(baseline.enabled,true);
 for(const contract of [undefined,null,{}, {max:NaN},{max:Infinity},{max:-1},{max:'16'}]){
  data.material.userData.transmissionThicknessBounds=contract;assert.equal(f.draw().enabled,false);
 }
 delete data.material.userData.transmissionThicknessBounds;assert.deepEqual(f.draw(),baseline);
 f.region.dispose();data.dispose();
});

test('native pool contract follows its shader bound and distinct native terrain code has distinct cache keys',()=>{
 const source=readFileSync(new URL('./native-springs-finish.mjs',import.meta.url),'utf8');
 assert.match(source,/transmissionThicknessBounds=\{max:16,source:'native-pool-bed-depth-v1'\}/);
 assert.ok(source.includes('material.thickness=bed.g*4.*bed.a/max(abs(dot(transmittedDirection,normal)),.25);'));
 assert.equal(4/.25,16);assert.match(source,/customProgramCacheKey=\(\)=>nativeRockShaderKey\(record\.material,scale\)/);
 assert.ok(source.includes('if(record.material===0){'),'ground-only sunlight transport is a separate generated program');
 assert.notEqual(nativeRockShaderKey(0,1.8),nativeRockShaderKey(1,1.8));
 assert.notEqual(nativeRockShaderKey(0,1.8),nativeRockShaderKey(2,1.8));
 assert.notEqual(nativeRockShaderKey(1,1.8),nativeRockShaderKey(5,.06));
 assert.equal(nativeRockShaderKey(0,1.8),nativeRockShaderKey(0,1.8));
});
