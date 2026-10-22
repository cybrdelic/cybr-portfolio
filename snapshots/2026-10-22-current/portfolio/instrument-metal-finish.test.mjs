import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import{bindMetalFinish,evaluateMetalFinish,metalFinishMetric,perturbMetalFinishNormal,metalFinishResolution,reconstructMetalFinishCoordinates,metalFinishAnisotropy,METAL_FINISH_PROFILES,METAL_FINISH_MAX_SLOPE,METAL_FINISH_ROUGHNESS_LIMIT}from './instrument-metal-finish.mjs';
import{bindRasterCamera}from './instrument-raster-camera.mjs';
import{setupRasterThickness}from './instrument-raster-thickness.mjs';
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const closeVector=(a,b,tolerance=1e-9)=>a.forEach((value,i)=>close(value,b[i],tolerance));
const sample=(style,u,v,extra={})=>evaluateMetalFinish({style,u,v,...extra});

test('analytic millimeter slopes agree with centered finite differences of actual heights',()=>{
  const epsilon=1e-6;
  for(const style of[1,2,3,4])for(let i=0;i<40;i++){
    const u=.037+i*.173,v=.041+i*.127,result=sample(style,u,v);
    const du=(sample(style,u+epsilon,v).height-sample(style,u-epsilon,v).height)/(2*epsilon);
    const dv=(sample(style,u,v+epsilon).height-sample(style,u,v-epsilon).height)/(2*epsilon);
    closeVector(result.slope,[du,dv],2e-7);
  }
});

test('turned cap finish ignores angular U seams; crossed groove cells close at integer periods',()=>{
  for(const v of[0,.013,.2,1.7,17.35]){
    const left=sample(2,-10000,v),right=sample(2,10000,v);
    assert.deepEqual(left,right);assert.equal(left.slope[0],0);
  }
  for(const style of[3,4])for(let i=0;i<30;i++){
    const u=i*.139,v=i*.083,pitch=METAL_FINISH_PROFILES[style].pitch;
    const a=sample(style,u,v),b=sample(style,u+17*pitch,v);
    close(a.height,b.height,1e-12);closeVector(a.slope,b.slope,1e-11);close(a.roughness,b.roughness,1e-12);
  }
});

test('large flat annulus triangles reconstruct exact radius and a varying radial gradient',()=>{
  const angularLength=2*Math.PI*40,chart=[1,angularLength];
  const reconstruct=position=>reconstructMetalFinishCoordinates({uv:[angularLength/8,40],localPosition:position,chart});
  // This edge joins [0,40,0] and [0,0,40]. Interpolating both corner radii
  // gives 40mm at the midpoint, although its actual radius is sqrt(800).
  const midpoint=reconstruct([0,20,20]);close(midpoint[1],Math.sqrt(800));
  assert.ok(40-midpoint[1]>11);
  const epsilon=1e-4,gradients=[];
  for(const point of[[0,30,8],[0,8,30],[0,17,17]]){
    const shifted=(axis,amount)=>point.map((value,i)=>value+(i===axis?amount:0));
    const coordinateDerivative=axis=>{
      const plus=reconstruct(shifted(axis,epsilon/2)),minus=reconstruct(shifted(axis,-epsilon/2));
      return plus.map((value,i)=>value-minus[i]);
    };
    const metric=metalFinishMetric({positionDx:[0,epsilon,0],positionDy:[0,0,epsilon],uvDx:coordinateDerivative(1),uvDy:coordinateDerivative(2),normal:[1,0,0]});
    const radius=Math.hypot(point[1],point[2]),radial=[0,point[1]/radius,point[2]/radius];
    closeVector(metric.gradientV,radial,1e-8);gradients.push(metric.gradientV);
    const n=perturbMetalFinishNormal({normal:[1,0,0],slope:[0,.1],...metric});
    closeVector(n,new THREE.Vector3(1,-radial[1]*.1,-radial[2]*.1).normalize().toArray(),1e-8);
  }
  // A linearly interpolated radius has one constant gradient per triangle.
  // The reconstructed direction follows position, including within one face.
  assert.ok(Math.abs(gradients[0][1]-gradients[1][1])>.7);
});

test('analytic charts preserve linear axes, safely unwrap polar seams, and close full-circle crossing grooves',()=>{
  assert.deepEqual(reconstructMetalFinishCoordinates({uv:[2,3],localPosition:[7,11,13],chart:[0,0]}),[2,3]);
  const circumference=256*.65,angle=-.49*2*Math.PI,point=[7,31*Math.cos(angle),31*Math.sin(angle)];
  const uv=[.51*circumference,7];
  closeVector(reconstructMetalFinishCoordinates({uv,localPosition:point,chart:[2,circumference]}),[.51*circumference,7]);
  closeVector(reconstructMetalFinishCoordinates({uv:[7,.51*circumference],localPosition:point,chart:[3,circumference]}),[7,.51*circumference]);
  const a=reconstructMetalFinishCoordinates({uv,localPosition:point,chart:[2,circumference]});
  const b=reconstructMetalFinishCoordinates({uv:[uv[0]+circumference,uv[1]],localPosition:point,chart:[2,circumference]});
  const first=sample(4,...a),second=sample(4,...b);
  close(first.height,second.height,1e-12);closeVector(first.slope,second.slope,1e-10);close(first.roughness,second.roughness,1e-12);
  closeVector(reconstructMetalFinishCoordinates({uv:[0,0],localPosition:[0,0,0],chart:[1,1]}),[0,0]);
  assert.throws(()=>reconstructMetalFinishCoordinates({uv:[0,0],localPosition:[0,0,0],chart:[1,0]}));
});

test('protected style zero remains isotropic when its metal material batch enables anisotropy',()=>{
  for(const anisotropy of[.22,.32,.45,.48])for(const roughness of[.17,.33,.48]){
    assert.deepEqual(metalFinishAnisotropy({style:0,anisotropy,roughness}),{anisotropy:0,alphaT:roughness*roughness});
    for(const style of[1,2])close(metalFinishAnisotropy({style,anisotropy,roughness}).anisotropy,anisotropy);
    for(const style of[3,4])close(metalFinishAnisotropy({style,anisotropy,roughness}).anisotropy,anisotropy*.18);
  }
});

test('each roughness pattern preserves its authored mean and stays within the bounded modulation',()=>{
  for(const style of[1,2,3,4])for(const roughness of[.17,.24,.32,.34,.48])for(const footprint of[0,.01,.07,.2,2]){
    const period=style===1?.48:style===2?4:METAL_FINISH_PROFILES[style].pitch;
    let sum=0;
    for(let i=0;i<1024;i++){
      const result=sample(style,.371,period*(i+.5)/1024,{roughness,dx:[footprint,0],dy:[0,footprint]});
      assert.ok(Math.abs(result.variation)<=METAL_FINISH_ROUGHNESS_LIMIT);
      assert.ok(result.roughness>=roughness*(1-METAL_FINISH_ROUGHNESS_LIMIT)&&result.roughness<=roughness*(1+METAL_FINISH_ROUGHNESS_LIMIT));
      sum+=result.roughness;
    }
    close(sum/1024,roughness,1e-12);
  }
});

test('harmonic detail converges to the exact base material before Nyquist and never creates unresolved slopes',()=>{
  let previous=1;
  for(const footprint of[0,.1,.18,.2,.3,.4,.49,.5,1,100]){
    const resolved=metalFinishResolution(footprint);assert.ok(resolved<=previous&&resolved>=0);previous=resolved;
    if(footprint>=.5)assert.equal(resolved,0);
  }
  for(const style of[0,1,2,3,4])for(const u of[-37.5,0,.027,9.75])for(const v of[-33,0,.127,18.4]){
    const result=sample(style,u,v,{dx:[20,0],dy:[0,20],roughness:.24});
    assert.equal(result.height,0);closeVector(result.slope,[0,0]);assert.equal(result.variation,0);assert.equal(result.roughness,.24);
  }
  assert.throws(()=>metalFinishResolution(-1));assert.throws(()=>sample(1,NaN,0));assert.throws(()=>sample(5,0,0));assert.throws(()=>sample(1,0,0,{dx:[NaN,0]}));
});

test('surface metric preserves physical slopes under pixel scale, rotation, and skew; degenerate charts stay finite',()=>{
  const normal=[0,0,1];
  for(const pixelScale of[1e-5,.01,1,10000]){
    const metric=metalFinishMetric({positionDx:[pixelScale,0,0],positionDy:[.3*pixelScale,.8*pixelScale,0],uvDx:[pixelScale,0],uvDy:[.3*pixelScale,.8*pixelScale],normal});
    assert.ok(metric.valid);closeVector(metric.gradientU,[1,0,0]);closeVector(metric.gradientV,[0,1,0]);
    const n=perturbMetalFinishNormal({normal,slope:[.12,-.18],...metric});
    closeVector(n,new THREE.Vector3(-.12,.18,1).normalize().toArray());
  }
  const rotation=new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1,2,3).normalize(),.91));
  const rotate=a=>new THREE.Vector3(...a).applyMatrix3(rotation).toArray();
  const metric=metalFinishMetric({positionDx:rotate([.12,0,0]),positionDy:rotate([.04,.17,0]),uvDx:[.12,0],uvDy:[.04,.17],normal:rotate(normal)});
  closeVector(metric.gradientU,rotate([1,0,0]));closeVector(metric.gradientV,rotate([0,1,0]));
  const rotated=perturbMetalFinishNormal({normal:rotate(normal),slope:[.12,-.18],...metric});
  closeVector(rotated,rotate(new THREE.Vector3(-.12,.18,1).normalize().toArray()));
  for(const positionDy of[[0,0,0],[1,0,0],[1,1e-8,0]]){
    const result=metalFinishMetric({positionDx:[1,0,0],positionDy,uvDx:[1,0],uvDy:[0,1],normal});
    assert.equal(result.valid,false);assert.ok([...result.gradientU,...result.gradientV].every(Number.isFinite));
    closeVector(perturbMetalFinishNormal({normal,slope:[100,-100],...result}),normal);
  }
});

test('normal perturbation has correct double-sided parity, bounded slopes, and no directional mean bias',()=>{
  const metric={gradientU:[1,0,0],gradientV:[0,1,0]};
  for(const slope of[[.1,.2],[-10,5],[0,0]]){
    const front=perturbMetalFinishNormal({normal:[0,0,1],slope,...metric});
    const back=perturbMetalFinishNormal({normal:[0,0,-1],slope,faceDirection:-1,...metric});
    closeVector(back,front.map(value=>-value));close(Math.hypot(...front),1);
    assert.ok(Math.hypot(front[0],front[1])/front[2]<=METAL_FINISH_MAX_SLOPE+1e-12);
  }
  for(const style of[1,2,3,4]){
    const pitch=style>=3?METAL_FINISH_PROFILES[style].pitch:40;
    const total=[0,0,0];
    for(let i=0;i<16384;i++){
      const u=style>=3?(i%128+.5)/128*pitch:.173;
      const v=style>=3?(Math.floor(i/128)+.5)/128*pitch:(i+.5)/16384*pitch;
      const n=perturbMetalFinishNormal({normal:[0,0,1],slope:sample(style,u,v).slope,...metric});
      n.forEach((value,k)=>total[k]+=value);
    }
    assert.ok(Math.abs(total[0]/16384)<2e-4&&Math.abs(total[1]/16384)<2e-4);
    assert.ok(total[2]/16384>.95);
  }
});

test('finish binds to the local r180 physical ABI and composes with real camera and CAD thickness hooks',()=>{
  const fresh=()=>({vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.physical.uniforms),defines:{USE_TRANSMISSION:''}});
  const scene=new THREE.Scene(),material=new THREE.MeshPhysicalMaterial({transmission:1,thickness:1.5,ior:1.47});
  const object=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);scene.add(object);
  const thickness=setupRasterThickness({THREE,renderer:{},scene,objects:[object],fullSize:new THREE.Vector2(32,32)});
  try{
    for(const order of['finish first','finish last']){
      const shader=fresh();
      if(order==='finish first')bindMetalFinish(shader,{THREE});
      bindRasterCamera(shader,THREE);assert.equal(thickness.bindShader(shader,material),true);
      if(order==='finish last')bindMetalFinish(shader,{THREE});
      assert.ok(shader.vertexShader.includes('vMetalFinishUv=metalUv'));
      assert.ok(shader.vertexShader.includes('vMetalFinishLocalPosition=metalLocalPosition'));
      assert.ok(shader.fragmentShader.indexOf('vec2 metalCoordinates=metalFinishCoordinates();')<shader.fragmentShader.indexOf('dFdx(metalCoordinates)'));
      assert.ok(shader.fragmentShader.includes('material.anisotropyT=metalFinishAcross'));
      assert.ok(shader.fragmentShader.indexOf('vec3 metalPx=')<shader.fragmentShader.indexOf('#include <lights_physical_fragment>'));
      assert.ok(shader.fragmentShader.includes('inverseTransformDirection(geometryViewDir, viewMatrix)'));
      assert.ok(shader.uniforms.cadThicknessField);
      assert.ok(!shader.fragmentShader.includes('nonPerturbedNormal='));
      assert.throws(()=>bindMetalFinish(shader,{THREE}),/already bound/);
    }
  }finally{thickness.dispose();object.geometry.dispose();material.dispose();}
  const bad=fresh();bad.fragmentShader=bad.fragmentShader.replace('#include <normal_fragment_maps>','');
  assert.throws(()=>bindMetalFinish(bad,{THREE}),/normal shader hook/);
});
