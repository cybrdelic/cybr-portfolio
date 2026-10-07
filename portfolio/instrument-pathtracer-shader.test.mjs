import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instrumentTraceShader, filterShader } from './instrument-pathtracer.js';
import * as THREE from './vendor/three-r180/three.module.min.js';

const source = await readFile(new URL('../cybr-light/browser/trace.wgsl', import.meta.url), 'utf8');
const traversal = await readFile(new URL('../cybr-light/browser/trace-instances.wgsl', import.meta.url), 'utf8');
const shader = instrumentTraceShader(source, traversal);
test('current CYBR LIGHT transport retains nested dielectric identities and absorption', () => {
  assert.match(shader, /struct MediumStack \{ count:u32,ids:array<vec2u,16>,values:array<vec4f,16>/);
  assert.match(shader, /vec2u\(u32\(attributes\[hit.id\].n0.w\),instanceIdentity\(hit\)\)/);
  assert.match(shader, /commitMedium\(&media,boundary,entering,inside\)/);
  assert.match(shader, /throughput\*=exp\(-medium\*min\(hit.t,lamp\)\)/);
  assert.match(shader, /fn dielectricFresnel\(cosine:f32,etaI:f32,etaT:f32\)/);
  assert.match(shader, /fn visibleGGX\(/);
  assert.match(shader, /fn bsdf\(/);
  assert.match(shader, /fn mis\(/);
});
test('all primary and transmitted guide rays use the original camera inverse projection', () => {
  assert.match(shader, /inverseProjection:mat4x4f, cameraWorld:mat4x4f/);
  assert.match(shader, /let nearPoint=u.cameraWorld\*vec4f\(a.xyz\/a.w,1.\)/);
  assert.match(shader, /PrimaryRay\(nearPoint.xyz\*u.settings.y,normalize\(farPoint.xyz-nearPoint.xyz\)\)/);
  assert.match(shader, /let guideOrigin=pathRay.origin;let guide=trace\(guideOrigin/);
  assert.match(shader, /var origin=pathRay.origin;var direction=pathDirection/);
  assert.match(shader, /var go=stableOrigin;var gd=stableDirection/);
  assert.doesNotMatch(shader, /trace\(u.eye.xyz,guideDirection/);
  assert.doesNotMatch(shader, /var origin=u.eye.xyz|var go=u.eye.xyz|fn camera\(xy:vec2f\)/);
});
test('reconstruction guides are center-pixel rays computed once per camera pose', () => {
  assert.match(shader, /if\(u.size.z==0u\)\{let centerRay=primaryRay\(vec2f\(gid.xy\)\+\.5\)/);
  assert.match(shader, /stableGuide=trace\(stableOrigin,stableDirection,1e20,false\)/);
  assert.match(shader, /if\(u.size.z>0u\)\{guidePos=samples\[index\].position;guideNormal=samples\[index\].normal/);
  assert.match(shader, /if\(stableReflection&&stableGuide.id>=0&&u.size.z==0u\)/);
  assert.match(shader, /secondary=samples\[index\].secondary;secondaryNormal=samples\[index\].secondaryNormal/);
  assert.match(shader, /secondaryNormal=vec4f\(n,m.base.w\);break/);
  // Transport still traces fresh jittered primary rays and averages all RGB
  // contributions; only reconstruction metadata is cached across samples.
  assert.match(shader, /let pathRay=primaryRay\(vec2f\(gid.xy\)\+vec2f\(random\(&seed\),random\(&seed\)\)\)/);
  assert.doesNotMatch(shader, /clamp\(radiance|radiance=min|throughput=min/);
});
test('rough terrain through glass gets multiscale support without crossing refracted boundaries', () => {
  assert.match(filterShader, /contentRoughness=select\(center.normal.w,center.secondaryNormal.w,transmitted\)/);
  assert.match(filterShader, /optical&&!transmitted&&step>1u/);
  assert.match(filterShader, /abs\(center.secondary.w-other.secondary.w\)>\.1/);
  assert.match(filterShader, /dot\(center.secondaryNormal.xyz,other.secondaryNormal.xyz\)<\.95/);
  assert.match(filterShader, /history\[i\].moments.z\+history\[j\].moments.z/);
  assert.doesNotMatch(filterShader, /value.w\+input\[j\].w/);
});
test('moving poses get independent random samples and independent optical motion guides', () => {
  assert.match(shader, /u32\(u.settings.w\)\*6271u/);
  assert.doesNotMatch(shader, /u.size.z\*6271u/);
  assert.ok(shader.includes('reflection=vec4f(start+reflected*rh.t,f32(instanceIdentity(rh))+3.)'));
  assert.match(shader, /secondary=vec4f\(gd,-1.\)/);
  assert.match(shader, /for\(var depth=0u;depth<16u;depth\+\+\)/);
  assert.match(shader, /gd=normalize\(reflect\(gd,geometricNormal\)\)/);
  assert.match(shader, /samples\[index\].moments.zw,u.size.z>0u/);
  assert.match(shader, /secondary,secondaryNormal,reflection,reflectionNormal\)/);
});
test('real HDR lighting branch remains reachable with the lab floor and lamp disabled', () => {
  assert.match(shader, /@binding\(8\) var environmentTexture:texture_2d<f32>/);
  assert.match(shader, /textureLoad\(environmentTexture/);
  assert.ok(shader.includes('@binding(9) var<storage,read> environmentDistribution:array<f32>'),'The original HDR CDF must be bound');
  assert.ok(shader.includes('environmentDistribution[6]*mass/solidAngle+environmentDistribution[7]/(4.*PI)'),'MIS must use the same full-support mixture density as sampling');
  assert.match(shader, /fn areaSelection\(\)->f32\{return 0.;\}/);
  assert.match(shader, /if\(lighting.info.x>.5&&lighting.info.y>0.\)/);
  // With info.x=1 and info.y=0, source-light sampling is skipped, portals=0
  // and areaSelection=0 skip the analytic lamp; environment NEE is selected.
  const info = { x: 1, y: 0 }, flags = { z: 0 }, area = 0;
  const branch = info.x > .5 && info.y > 0 ? 'source' : flags.z > .5 ? 'portal' : area >= 1 || .5 < area ? 'lamp' : 'environment';
  assert.equal(branch, 'environment');
  assert.match(shader, /let wi=sampleEnvironment\(&seed\)/);
  assert.match(shader, /if\(lighting.info.x>.5\|\|lighting.info.z>.5\|\|d.y<=0.0\)\{return 1e20;\}/);
  assert.match(shader, /if\(lighting.info.x<.5&&abs\(d.y\)>1e-8\)/);
  assert.match(shader, /if\(guide.id==-1\)\{samples\[index\]=Pixel\(vec4f\(0\)/);
});
test('finish roughness is interpolated separately from authored vertex albedo', () => {
  assert.match(shader, /m.base.w\*=a.c0.w\*\(1.-h.bary.x-h.bary.y\)\+a.c1.w\*h.bary.x\+a.c2.w\*h.bary.y/);
  assert.match(shader, /fn vertexColor\(h:Hit\)/);
  assert.equal(/vSurfaceAO|cadVisibility|@.*occlusion/.test(shader),false,'Raster AO must not enter path-traced shading');
});
function ray(camera, xy, size) {
  const ndc = [xy[0] / size[0] * 2 - 1, 1 - xy[1] / size[1] * 2];
  const point = z => new THREE.Vector3(ndc[0], ndc[1], z).applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld);
  const origin = point(-1), end = point(1);
  return { origin, direction: end.sub(origin).normalize() };
}
test('inverse-projection rays reproduce orthographic, perspective and mixed camera framing', () => {
  const ortho = new THREE.OrthographicCamera(-200,200,100,-100,.05,7000);
  const persp = new THREE.PerspectiveCamera(40,2,.05,7000);
  const camera = new THREE.Camera();camera.position.set(730,-520,360);camera.up.set(0,0,1);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  for (const blend of [0,.15,.5,.85,1]) {
    for (let i=0;i<16;i++) camera.projectionMatrix.elements[i]=ortho.projectionMatrix.elements[i]*(1-blend)+persp.projectionMatrix.elements[i]*blend/970;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    for (const xy of [[50,100],[600,340],[1099,570]]) {
      const r=ray(camera,xy,[1200,600]),point=r.origin.clone().addScaledVector(r.direction,400),projected=point.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      assert.ok(Math.abs(projected.x-(xy[0]/1200*2-1))<1e-9);
      assert.ok(Math.abs(projected.y-(1-xy[1]/600*2))<1e-9);
    }
    if(blend===0){const a=ray(camera,[200,300],[1200,600]),b=ray(camera,[1000,300],[1200,600]);assert.ok(a.direction.distanceTo(b.direction)<1e-12);assert.ok(a.origin.distanceTo(b.origin)>250);}
  }
});
