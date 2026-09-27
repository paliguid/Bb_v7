// Verifies the mechanism-to-three.js rendering pipeline: the coordinate bridge, the world-pose
// math (including a shaft riding on a moving carrier), and which parts get material-based colour.
// This exists because the previous version of this pipeline had a wrong "up" axis that the other
// test suites never caught, since the jsdom UI tests stub MechStage out entirely (no WebGL in
// Node) — this script exercises the real math with no rendering context required.
//   node scripts/verify-mech-render.mjs
import * as THREE from 'three';
import { matrixToThree, toThreeV } from '../src/mech/three-bridge.js';
import { compose, apply, mul } from '../src/mech/math3.js';
import { worldMatrixFor } from '../src/mech/poses.js';
import { addPart, byId, newAssembly, restMatrix } from '../src/mech/assembly.js';
import { PART_TYPES } from '../src/mech/catalog.js';
import { Machine } from '../src/mech/machine.js';
import { getMechPreset } from '../src/mech/presets.js';

let failures = 0;
const ok = (c, m, x = '') => { if (c) console.log(`  ✓ ${m}${x ? `  (${x})` : ''}`); else { failures++; console.log(`  ✗ ${m}${x ? `  (${x})` : ''}`); } };
const near = (a, b, t = 1e-4) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));

console.log('Coordinate bridge');
{
  // Gravity is world -Y in the physics (machine.js: G_DIR = [0, -1, 0]). The renderer must treat
  // mech-Y as vertical too, or everything renders rotated relative to how it actually behaves.
  ok(toThreeV([0, -1, 0]).y === -1 && toThreeV([0, -1, 0]).x === 0 && toThreeV([0, -1, 0]).z === 0, 'gravity direction maps straight onto three.js -Y (no axis swap)');
  ok(toThreeV([5, 0, 0]).x === 5, 'X maps straight across');
  ok(toThreeV([0, 0, 7]).z === 7, 'Z maps straight across');

  const check = (name, M, local) => {
    const world = apply(M, local);
    const v = new THREE.Vector3(...local).applyMatrix4(matrixToThree(M));
    const e = toThreeV(world);
    ok(near(v.x, e.x) && near(v.y, e.y) && near(v.z, e.z), name);
  };
  check('a translated point matches', compose([5, -40, 0], [0, 0, 0]), [0, 0, 10]);
  check('a point rotated about Y matches', compose([0, 0, 0], [0, 90, 0]), [1, 0, 0]);
  check('a point rotated about X matches', compose([0, 0, 0], [37, 0, 0]), [0, 1, 0.3]);
  check('a full Euler rotation + translation matches', compose([1, -22, 3], [12, 34, 56]), [1, -2, 0.5]);
  const A = compose([1, 2, 3], [10, 20, 30]), B = compose([-2, 0, 1], [0, 45, 0]);
  const local = [3, -1, 2];
  const v3 = new THREE.Vector3(...local).applyMatrix4(new THREE.Matrix4().multiplyMatrices(matrixToThree(A), matrixToThree(B)));
  const e3 = toThreeV(apply(mul(A, B), local));
  ok(near(v3.x, e3.x) && near(v3.y, e3.y) && near(v3.z, e3.z), 'matrix composition survives the conversion (A·B in mech space matches three.js multiplying the converted matrices)');
  ok(matrixToThree(compose([1, 2, 3], [10, 20, 30])).elements[12] === 1 && matrixToThree(compose([1, 2, 3], [10, 20, 30])).elements[13] === 2, 'no unit rescale: a 1mm/2mm/3mm mech translation is exactly 1/2/3 three.js units');
}

console.log('\nWorld pose: static and shaft-mounted parts');
{
  const doc = newAssembly();
  const s1 = addPart(doc, 'shaft', { x: 10, y: -30, z: 0, ry: 90, bearing: 'none', rpm0: 500 });
  const gear = addPart(doc, 'gear', { shaft: s1.id, teeth: 20, axial: 5 });
  const frame = addPart(doc, 'frame', { x: 100, y: 0, z: 50 });
  const mc = new Machine(doc);
  const poses = mc.poses();

  ok(apply(worldMatrixFor(doc, frame, poses), [0, 0, 0]).every((v, i) => near(v, [100, 0, 50][i])), 'a static frame renders exactly at its authored x/y/z');
  const Ms = worldMatrixFor(doc, s1, poses);
  ok(apply(Ms, [0, 0, 0]).every((v, i) => near(v, [10, -30, 0][i])), 'a shaft with no motion renders at its rest position');
  const Mg = worldMatrixFor(doc, gear, poses);
  const gpos = apply(Mg, [0, 0, 0]);
  ok(near(gpos[1], -30) && !near(gpos[0], 10), 'a gear mounted with an axial offset renders shifted along its shaft, not at the shaft origin');

  mc.advance(0.3, 2e-4, 1e9);
  const poses2 = mc.poses();
  const theta = poses2.shaft[s1.id];
  ok(Math.abs(theta) > 0.01, 'the shaft has actually turned during the advance');
  const Mg2 = worldMatrixFor(doc, gear, poses2);
  ok(near(apply(Mg2, [0, 0, 0])[0], apply(Mg, [0, 0, 0])[0]) && near(apply(Mg2, [0, 0, 0])[1], apply(Mg, [0, 0, 0])[1]) && near(apply(Mg2, [0, 0, 0])[2], apply(Mg, [0, 0, 0])[2]), 'a gear’s own centre does not move as its shaft spins (only its orientation should change)');
  const rim = apply(Mg2, [gear.module * gear.teeth * 0.4, 0, 0]);
  const rim0 = apply(Mg, [gear.module * gear.teeth * 0.4, 0, 0]);
  ok(!near(rim[0], rim0[0]) || !near(rim[2], rim0[2]), 'a point on the gear’s rim does move as it spins');
}

console.log('\nWorld pose: sliders and a shaft riding a moving vehicle');
{
  const doc = getMechPreset('car').build();
  const veh = doc.parts.find((p) => p.type === 'vehicle');
  const axle = doc.parts.find((p) => p.type === 'shaft');
  const wheel = doc.parts.find((p) => p.type === 'wheel');
  const mc = new Machine(doc);

  const poses0 = mc.poses();
  ok(near(apply(worldMatrixFor(doc, axle, poses0), [0, 0, 0])[0], axle.x), 'before the vehicle moves, the axle renders at its authored rest position');

  mc.advance(2, 2e-4, 1e9);
  const poses = mc.poses();
  const vehQ = poses.slider[veh.id];
  ok(vehQ > 500, 'the vehicle has actually driven forward', `${vehQ.toFixed(0)} mm`);

  const axlePos = apply(worldMatrixFor(doc, axle, poses), [0, 0, 0]);
  ok(near(axlePos[0], axle.x + vehQ, 1e-6), 'the axle shaft moves WITH the vehicle body, not frozen at its rest position', `${axlePos[0].toFixed(1)} vs expected ${(axle.x + vehQ).toFixed(1)}`);

  const wheelPos = apply(worldMatrixFor(doc, wheel, poses), [0, 0, 0]);
  ok(near(wheelPos[0], axlePos[0], 1e-6), 'a wheel mounted on that axle moves along with it too');

  const rest = apply(restMatrix(veh), [0, 0, 0]);
  ok(near(apply(worldMatrixFor(doc, veh, poses0), [0, 0, 0])[0], rest[0]), 'the vehicle itself starts at its rest position');
  ok(apply(worldMatrixFor(doc, veh, poses), [0, 0, 0])[0] > 500, 'and the vehicle body itself has moved forward by the same amount');
}
{
  // A plain slider (rack) and a "leaf" body (a crank-driven piston) must render at their true
  // millimetre displacement — a stray unit conversion here would make them look frozen.
  const doc = getMechPreset('rack').build();
  const rack = doc.parts.find((p) => p.type === 'rack');
  const mc = new Machine(doc);
  mc.advance(2, 2e-4, 1e9);
  const poses = mc.poses();
  const reportedMm = mc.readout()[`${rack.id}.pos`];
  const renderedX = apply(worldMatrixFor(doc, rack, poses), [0, 0, 0])[0];
  ok(near(renderedX, rack.x + reportedMm, 1e-6), 'a slider renders at its full physics displacement in millimetres, not 1/1000th of it', `moved ${reportedMm.toFixed(1)} mm, rendered offset ${(renderedX - rack.x).toFixed(1)} mm`);
}
{
  const doc = getMechPreset('crank-slider').build();
  const piston = doc.parts.find((p) => p.type === 'slider');
  const mc = new Machine(doc);
  mc.advance(0.3, 2e-4, 1e9);
  const poses = mc.poses();
  const reportedMm = mc.readout()[`${piston.id}.pos`];
  const renderedX = apply(worldMatrixFor(doc, piston, poses), [0, 0, 0])[0];
  ok(near(renderedX, piston.x + reportedMm, 1e-6), 'a crank-driven piston (a "leaf" body, not a plain slider) also renders at its true displacement');
}

console.log('\nMaterial colour: only parts with a material parameter use it');
{
  const withMaterial = ['shaft', 'gear', 'bevel', 'worm', 'pulley', 'drum', 'screw', 'flywheel', 'crank', 'cam', 'arm', 'rack', 'brake', 'frame', 'custom', 'planetary'];
  const withoutMaterial = ['motor', 'generator', 'handcrank', 'wheel', 'propeller', 'windrotor', 'torsionspring', 'load', 'weight', 'vehicle', 'spring', 'differential'];
  for (const t of withMaterial) {
    const def = PART_TYPES[t];
    ok(def.params.some((p) => p.type === 'material'), `${t} has a material parameter (so it should render in that material's real colour)`);
  }
  for (const t of withoutMaterial) {
    const def = PART_TYPES[t];
    ok(!def.params.some((p) => p.type === 'material'), `${t} has no material parameter (so it must keep its own catalog colour, not generic steel grey)`);
  }
}

console.log(failures ? `\n${failures} render check(s) FAILED` : '\nAll mechanical rendering checks passed');
process.exit(failures ? 1 : 0);
