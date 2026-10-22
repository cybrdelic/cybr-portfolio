import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScene, updateScene } from './instrument-trace-scene.mjs';
import { capturePreviousMatrices, packTemporalMotions, reprojectPoint, reprojectNormal } from './instrument-trace-motion.mjs';

const identity = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function pose(translation, axis, angle) {
  const length = Math.hypot(...axis), [x,y,z] = axis.map(v => v / length);
  const c = Math.cos(angle), s = Math.sin(angle), t = 1-c;
  return [t*x*x+c,t*x*y+s*z,t*x*z-s*y,0,
    t*x*y-s*z,t*y*y+c,t*y*z+s*x,0,
    t*x*z+s*y,t*y*z-s*x,t*z*z+c,0,...translation,1];
}
function transform(matrix, local, scale, normal = false) {
  return [0,1,2].map(k => matrix[k]*local[0]+matrix[k+4]*local[1]+matrix[k+8]*local[2]+(normal?0:matrix[k+12]*scale));
}
function near(actual, expected, tolerance = 2e-7) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v,k) => assert.ok(Math.abs(v-expected[k]) <= tolerance, `axis ${k}: ${v} != ${expected[k]}`));
}
function triangle(matrix, dynamic = false) {
  return { matrix, dynamic, positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]),
    normals: new Float32Array([0,0,1, 0,0,1, 0,0,1]), indices: new Uint32Array([0,1,2]), materialIndex: 0 };
}

test('captures previous poses before scene updates without matrix aliasing', () => {
  const meshes = [triangle(pose([10,20,30],[0,0,1],.2)), triangle(identity(),true)];
  const scene = buildScene({ meshes });
  const previous = capturePreviousMatrices(scene), original = previous.map(m => m.slice());
  meshes[0].matrix = pose([70,-20,40],[0,1,0],-.4);
  updateScene(scene,meshes);
  assert.deepEqual(previous,original);
  assert.notDeepEqual(scene.acceleration.templates[0].matrix,previous[0]);
  previous[0][12] = -999;
  assert.equal(scene.acceleration.templates[0].matrix[12],70);
});

test('packs native guide identities, normalized translations and a reserved invalid miss record', () => {
  const matrices = [identity(),pose([10,20,-30],[0,0,1],Math.PI/2)];
  const records = packTemporalMotions(matrices,matrices.map(matrix => ({matrix})),{scale:.002});
  assert.equal(records.length,48);
  assert.deepEqual(Array.from(records.subarray(0,16)),Array(16).fill(0));
  near(records.subarray(16,20),[0,0,0,1]);
  near(records.subarray(36,39),[.02,.04,-.06]);
  near(records.subarray(44,47),[.02,.04,-.06]);
  assert.equal(records[23],1);assert.equal(records[39],1);
  assert.equal(records[31],0);assert.equal(records[47],0);
});

test('reprojects translated, differently rotated CAD points into the exact previous rigid pose', () => {
  const previous = pose([-12,30,9],[0,1,0],-Math.PI/3);
  const current = pose([100,-40,20],[0,0,1],.7), local = [.02,-.09,.055], scale = .005;
  const records = packTemporalMotions([previous],[{matrix:current}]);
  const currentPoint = transform(current,local,scale), previousPoint = transform(previous,local,scale);
  near(reprojectPoint(records,1,currentPoint),previousPoint);
  near(reprojectPoint(records,1,previousPoint,{reverse:true}),currentPoint);
});

test('normal reprojection uses rotations only and has a reciprocal inverse', () => {
  const previous = pose([5000,-4000,2000],[1,2,-1],1.7);
  const current = pose([-8000,9000,3000],[2,-1,3],-.8), normal = [.2,.4,Math.sqrt(.8)];
  const records = packTemporalMotions([previous],[{matrix:current}]);
  const from = transform(current,normal,.005,true), to = transform(previous,normal,.005,true);
  near(reprojectNormal(records,1,from),to);
  near(reprojectNormal(records,1,to,{reverse:true}),from);
  assert.ok(Math.abs(Math.hypot(...reprojectNormal(records,1,from))-1)<1e-10);
});

test('deformation rejects cable history while rigid parts keep their valid motion', () => {
  const matrices = [identity(),pose([10,0,0],[0,1,0],.4)];
  const meshes = matrices.map((matrix,i) => ({matrix,dynamic:i===1}));
  const stable = packTemporalMotions(matrices,meshes);
  assert.equal(stable[39],1);
  const changed = packTemporalMotions(matrices,meshes,{geometryChanged:true});
  assert.equal(changed[23],1);assert.equal(changed[39],0);
  assert.equal(reprojectPoint(changed,2,[1,2,3]),null);
  assert.equal(reprojectNormal(changed,2,[0,0,1]),null);
  near(reprojectPoint(changed,1,[1,2,3]),[1,2,3]);
});

test('temporal packing rejects reflections, nonrigid transforms and mismatched instance counts', () => {
  const reflected = identity();reflected[0]=-1;
  const scaled = identity();scaled[5]=1.01;
  const sheared = identity();sheared[4]=.01;
  const nonaffine = identity();nonaffine[3]=.01;
  const invalid = identity();invalid[12]=NaN;
  for(const matrix of [reflected,scaled,sheared,nonaffine,invalid]) {
    assert.throws(() => packTemporalMotions([identity()],[{matrix}]));
    assert.throws(() => packTemporalMotions([matrix],[{matrix:identity()}]));
  }
  assert.throws(() => packTemporalMotions([],[{matrix:identity()}]),/order\/count/);
  assert.throws(() => packTemporalMotions([identity()],[{matrix:identity()}],{scale:0}),/unit scale/);
  const huge = identity();huge[12]=1e100;
  assert.throws(() => packTemporalMotions([identity()],[{matrix:huge}]),/FP32 range/);
});
