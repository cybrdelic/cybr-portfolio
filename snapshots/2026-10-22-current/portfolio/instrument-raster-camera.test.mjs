import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three-r180/three.module.min.js';
import { inverseProjectionRay, dielectricTransmission } from './instrument-raster-optics.mjs';
import { bindRasterCamera, mixedCameraViewDirection } from './instrument-raster-camera.mjs';

const nearVector = (actual, expected, tolerance = 1e-12) =>
  assert.ok(new THREE.Vector3(...actual).distanceTo(new THREE.Vector3(...expected)) < tolerance);

test('actual mixed view vector agrees with independent inverse-projection rays through rotated and translated cameras', () => {
  const aspect = 1.7, distance = 30;
  const orthographic = new THREE.OrthographicCamera(-10 * aspect, 10 * aspect, 10, -10, .1, 1000);
  const perspective = new THREE.PerspectiveCamera(40, aspect, .1, 1000);
  const camera = new THREE.Camera();
  for (const [eye, look] of [[[2, 3, 30], [0, 0, 0]], [[-17, 22, 11], [4, -3, 1]]]) {
    camera.position.fromArray(eye);camera.up.set(0, 0, 1);camera.lookAt(new THREE.Vector3(...look));camera.updateMatrixWorld();
    for (const blend of [0, .2, .4, .7, 1]) {
      for (let i = 0; i < 16; i++) camera.projectionMatrix.elements[i] =
        orthographic.projectionMatrix.elements[i] * (1 - blend) + perspective.projectionMatrix.elements[i] * blend / distance;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      for (const pixel of [[100, 220], [510, 300], [930, 410]]) {
        const ray = inverseProjectionRay(camera, pixel, [1020, 600]);
        const point = new THREE.Vector3(...ray.origin).addScaledVector(new THREE.Vector3(...ray.direction), 20);
        const viewPosition = point.clone().applyMatrix4(camera.matrixWorldInverse).negate();
        const view = new THREE.Vector3(...mixedCameraViewDirection(viewPosition, camera.projectionMatrix)).transformDirection(camera.matrixWorld);
        nearVector(view.toArray(), ray.direction.map(value => -value));
      }
    }
  }
});

test('orthographic view is constant, perspective view is geometric, and positive projection scaling preserves both', () => {
  const ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, .1, 1000);
  const perspective = new THREE.PerspectiveCamera(45, 1, .1, 1000);
  for (const point of [[-250, 140, 30], [0, 0, 12], [250, -70, 400]]) {
    for (const scale of [.03, 1, 7]) {
      nearVector(mixedCameraViewDirection(point, ortho.projectionMatrix.elements.map(value => value * scale)), [0, 0, 1]);
      nearVector(mixedCameraViewDirection(point, perspective.projectionMatrix.elements.map(value => value * scale)),
        new THREE.Vector3(...point).normalize().toArray());
    }
  }
});

test('shader hook uses per-render built-in projection, retains lighting, and supports opaque or transmission variants', () => {
  for (const optical of [false, true]) {
    const shader = { uniforms: {}, defines:optical?{USE_TRANSMISSION:''}:{},fragmentShader: (optical ? THREE.ShaderChunk.transmission_pars_fragment : '')
      + '\nvoid main() {\n#include <lights_fragment_begin>\n' + (optical?'#include <transmission_fragment>\n':'')+'}\n' };
    bindRasterCamera(shader, THREE);
    assert.match(shader.fragmentShader, /projectionMatrix\[2\]\[3\]/);
    assert.match(shader.fragmentShader, /projectionMatrix\[3\]\[3\]/);
    assert.match(shader.fragmentShader, /#ifndef USE_TRANSMISSION\nuniform mat4 projectionMatrix;\n#endif/);
    assert.match(shader.fragmentShader, /vec3 geometryPosition = - vViewPosition;/);
    assert.ok(!shader.fragmentShader.includes('( isOrthographic ) ?'));
    if(optical){assert.match(shader.fragmentShader,/vec3 v = inverseTransformDirection\(geometryViewDir, viewMatrix\);/);assert.ok(!shader.fragmentShader.includes('normalize( cameraPosition - pos )'));assert.match(shader.fragmentShader,/n, v, material.roughness, material.diffuseColor/);}
    assert.deepEqual(shader.uniforms, {}, 'Camera state must come from WebGLRenderer built-in upload, never a stale shared uniform');
  }
  const expanded = { fragmentShader: THREE.ShaderChunk.lights_fragment_begin };
  bindRasterCamera(expanded, THREE);assert.match(expanded.fragmentShader, /projectionMatrix\[2\]\[3\]/);
});

test('default and already-expanded transmission shaders share the corrected world-space incident vector',()=>{
 for(const expanded of[false,true]){
  const shader={defines:{USE_TRANSMISSION:''},uniforms:{workingTransmissionMap:{value:'current-opaque-radiance'}},fragmentShader:THREE.ShaderChunk.transmission_pars_fragment.replaceAll('transmissionSamplerMap','workingTransmissionMap')+'\nvoid main(){\n'+THREE.ShaderChunk.lights_fragment_begin+'\n'+(expanded?THREE.ShaderChunk.transmission_fragment:'#include <transmission_fragment>')+'\n}'};
  bindRasterCamera(shader,THREE);assert.equal((shader.fragmentShader.match(/vec3 v = inverseTransformDirection\(geometryViewDir, viewMatrix\);/g)||[]).length,1);assert.match(shader.fragmentShader,/workingTransmissionMap/);assert.equal(shader.uniforms.workingTransmissionMap.value,'current-opaque-radiance');
 }
});

test('glass Snell direction and Fresnel incidence agree with inverse projection, including an off-center orthographic pixel',()=>{
 const ortho=new THREE.OrthographicCamera(-17,17,10,-10,.1,1000),perspective=new THREE.PerspectiveCamera(40,1.7,.1,1000),camera=new THREE.Camera();camera.position.set(2,3,30);camera.up.set(0,0,1);camera.lookAt(0,0,0);camera.updateMatrixWorld();const normal=new THREE.Vector3(.3,-.4,1).normalize();let oldProjectionMismatch=0;
 for(const blend of[0,.2,.6,1]){
  for(let i=0;i<16;i++)camera.projectionMatrix.elements[i]=ortho.projectionMatrix.elements[i]*(1-blend)+perspective.projectionMatrix.elements[i]*blend/30;camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  for(const pixel of[[100,220],[510,300],[930,410]]){
   const ray=inverseProjectionRay(camera,pixel,[1020,600]),point=new THREE.Vector3(...ray.origin).addScaledVector(new THREE.Vector3(...ray.direction),20),viewPosition=point.clone().applyMatrix4(camera.matrixWorldInverse).negate(),worldView=new THREE.Vector3(...mixedCameraViewDirection(viewPosition,camera.projectionMatrix)).transformDirection(camera.matrixWorld);
   const expected=dielectricTransmission(ray.direction,normal.toArray(),1,1.52),transmitted=dielectricTransmission(worldView.clone().negate().toArray(),normal.toArray(),1,1.52);nearVector(transmitted.direction,expected.direction);closeIncidence(normal.dot(worldView),-normal.dot(new THREE.Vector3(...ray.direction)));
   const oldView=camera.position.clone().sub(point).normalize();if(blend<1&&oldView.distanceTo(worldView)>.001)oldProjectionMismatch++;
  }
 }
 assert.ok(oldProjectionMismatch>0,'the regression must expose the previous cameraPosition-based glass direction');
});
const closeIncidence=(a,b)=>assert.ok(Math.abs(a-b)<1e-12);

test('all six perspective probe views preserve their original incident direction and correct per-face world orientation',()=>{
 for(const direction of[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
  const camera=new THREE.PerspectiveCamera(90,1,.25,10000);camera.position.set(23,-11,49);camera.up.set(0,Math.abs(direction[1])===1?0:1,Math.abs(direction[1])===1?1:0);camera.lookAt(camera.position.clone().add(new THREE.Vector3(...direction)));camera.updateMatrixWorld();
  for(const pixel of[[16,39],[64,64],[108,87]]){const ray=inverseProjectionRay(camera,pixel,[128,128]),point=new THREE.Vector3(...ray.origin).addScaledVector(new THREE.Vector3(...ray.direction),17),viewPosition=point.clone().applyMatrix4(camera.matrixWorldInverse).negate(),worldView=new THREE.Vector3(...mixedCameraViewDirection(viewPosition,camera.projectionMatrix)).transformDirection(camera.matrixWorld);nearVector(worldView.toArray(),camera.position.clone().sub(point).normalize().toArray());nearVector(worldView.toArray(),ray.direction.map(value=>-value));}
 }
});

test('shader ABI drift and invalid numeric inputs fail explicitly', () => {
  assert.throws(() => bindRasterCamera({ fragmentShader: '#include <lights_fragment_begin>' },
    { ShaderChunk: { lights_fragment_begin: 'vec3 geometryViewDir = normalize(vViewPosition);' } }), /shader ABI/);
  assert.throws(() => bindRasterCamera({ fragmentShader: 'void main() {}' }, THREE), /unique physical/);
  assert.throws(() => bindRasterCamera({ fragmentShader: '#include <lights_fragment_begin>\n#include <lights_fragment_begin>' }, THREE), /Ambiguous/);
  assert.throws(()=>bindRasterCamera({defines:{USE_TRANSMISSION:''},fragmentShader:'#include <lights_fragment_begin>'},THREE),/unique transmission/);
  assert.throws(()=>bindRasterCamera({fragmentShader:'#include <lights_fragment_begin>\n#include <transmission_fragment>\n#include <transmission_fragment>'},THREE),/Ambiguous/);
  assert.throws(()=>bindRasterCamera({fragmentShader:'#include <lights_fragment_begin>\n#include <transmission_fragment>'},{ShaderChunk:{...THREE.ShaderChunk,transmission_fragment:'vec3 v = normalize(pos-cameraPosition);'}}),/transmission.*ABI/);
  assert.throws(()=>bindRasterCamera({defines:{USE_TRANSMISSION:''},fragmentShader:'#include <lights_fragment_begin>\n'+THREE.ShaderChunk.transmission_fragment.replace('normalize( cameraPosition - pos )','normalize( pos - cameraPosition )')},THREE),/unique transmission/);
  assert.throws(() => mixedCameraViewDirection([NaN, 0, 0], new THREE.Matrix4()), /Invalid/);
  assert.throws(() => mixedCameraViewDirection([0, 0, 0], new Float32Array(16)), /Degenerate/);
});
