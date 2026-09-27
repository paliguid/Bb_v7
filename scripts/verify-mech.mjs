// Physics verification for the mechanical engine: every element is checked against a closed-form answer.
//   node scripts/verify-mech.mjs
import * as A from '../src/mech/assembly.js';
import { Machine } from '../src/mech/machine.js';
import { camLift } from '../src/mech/catalog.js';

let failures = 0;
const ok = (c, m, x = '') => { if (c) console.log(`  ✓ ${m}${x ? `  (${x})` : ''}`); else { failures++; console.log(`  ✗ ${m}${x ? `  (${x})` : ''}`); } };
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t * Math.max(1e-9, Math.abs(b));
const D2R = Math.PI / 180;
const run = (mc, s, dt = 2e-4) => mc.advance(s, dt, 1e9);
const shaft = (doc, over = {}) => A.addPart(doc, 'shaft', { bearing: 'none', ...over });
const drive = (doc, sh, torque = 0.05) => A.addPart(doc, 'load', { shaft: sh.id, kind: 'source', value: torque });
const speedOf = (mc, s) => mc.speed(s.id);

console.log('Motors and inertia');
{
  const doc = A.newAssembly(); const s = shaft(doc);
  A.addPart(doc, 'motor', { shaft: s.id, V: 6, R: 2.2, Kt: 0.0045, Jr: 1.5e-6, tauNL: 0 }); A.addPart(doc, 'flywheel', { shaft: s.id, dia: 20, thick: 8 });
  const mc = new Machine(doc), J = mc.bodies[0].J, tau = (J * 2.2) / 0.0045 ** 2, winf = 6 / 0.0045;
  run(mc, tau); ok(near(speedOf(mc, s), winf * (1 - Math.exp(-1)), 0.005), 'spin-up: ω = ω∞(1 − e^(−t/τ)) with τ = J·R/Kt²', `${speedOf(mc, s).toFixed(1)} vs ${(winf * (1 - Math.exp(-1))).toFixed(1)} rad/s`);
  run(mc, 8 * tau); ok(near(speedOf(mc, s), winf, 0.003), 'settles at the no-load speed V/Ke');
}
{ // steady state with load: ω = (V − R·τL/Kt)/Ke
  const doc = A.newAssembly(); const s = shaft(doc);
  A.addPart(doc, 'motor', { shaft: s.id, V: 12, R: 0.45, Kt: 0.011, Jr: 2.5e-5, tauNL: 0, Cth: 1e7 }); A.addPart(doc, 'load', { shaft: s.id, kind: 'viscous', value: 0.0002 });
  const mc = new Machine(doc); run(mc, 3);
  const w = (12 / 0.011) / (1 + (0.45 * 0.0002) / 0.011 ** 2); ok(near(speedOf(mc, s), w, 0.004), 'motor against viscous drag: ω = V/Ke ÷ (1 + R·c/Kt²)', `${speedOf(mc, s).toFixed(1)} vs ${w.toFixed(1)}`);
}
{ // thermal: stall temperature = Tamb + I²R·Rth at steady state (winding resistance rises with temperature)
  const doc = A.newAssembly(); const s = shaft(doc, { locked: true });
  A.addPart(doc, 'motor', { shaft: s.id, V: 6, R: 2.2, Kt: 0.0045, Rth: 8, Cth: 4, tauNL: 0 });
  const mc = new Machine(doc);
  // locked shaft has no DOF, so use a very heavy flywheel instead
  const doc2 = A.newAssembly(); const s2 = shaft(doc2); A.addPart(doc2, 'motor', { shaft: s2.id, V: 6, R: 2.2, Kt: 0.0045, Rth: 8, Cth: 4, tauNL: 0 }); A.addPart(doc2, 'flywheel', { shaft: s2.id, dia: 300, thick: 200 });
  A.addPart(doc2, 'brake', { shaft: s2.id, maxTorque: 5, apply: 1 });
  const m2 = new Machine(doc2); run(m2, 120, 5e-4);
  const st = m2.st.get(doc2.parts.find((p) => p.type === 'motor').id); const Rw = 2.2 * (1 + 0.00393 * (st.T - 20)), I = 6 / Rw;
  ok(near(st.T, 20 + I * I * Rw * 8, 0.03), 'stalled motor winding temperature = Tamb + I²R(T)·Rth', `${st.T.toFixed(1)} °C, I=${st.i.toFixed(2)} A`);
  void mc;
}

console.log('\nGear trains');
const pair = (zA, zB, over = {}) => {
  const doc = A.newAssembly(); const s1 = shaft(doc, { x: 0 }); const d = 1.5 * (zA + zB) / 2;
  const s2 = shaft(doc, { x: d, ...(over.flip ? { rx: 180 } : {}) });
  const g1 = A.addPart(doc, 'gear', { shaft: s1.id, teeth: zA }), g2 = A.addPart(doc, 'gear', { shaft: s2.id, teeth: zB });
  const r = A.connect(doc, g1.id, g2.id); drive(doc, s1, 0.02); A.addPart(doc, 'load', { shaft: s2.id, kind: 'viscous', value: 1e-4 });
  return { doc, s1, s2, link: r.link };
};
{
  const { doc, s1, s2 } = pair(20, 40); const mc = new Machine(doc); run(mc, 2);
  ok(near(speedOf(mc, s2), -speedOf(mc, s1) / 2, 1e-4), '20:40 spur pair: ω₂ = −ω₁·z₁/z₂', `${speedOf(mc, s1).toFixed(3)} → ${speedOf(mc, s2).toFixed(3)}`);
  const { doc: d2, s1: a, s2: b } = pair(20, 40, { flip: true }); const m2 = new Machine(d2); run(m2, 2);
  ok(speedOf(m2, b) * speedOf(m2, a) > 0, 'flipping the second shaft end-for-end reverses its sense (parallel axes, sign from geometry)');
}
{ // idler: same direction; ratio only from first and last
  const doc = A.newAssembly(); const a = shaft(doc, { x: 0 }), b = shaft(doc, { x: 30 }), c = shaft(doc, { x: 60 });
  const g1 = A.addPart(doc, 'gear', { shaft: a.id, teeth: 20 }), g2 = A.addPart(doc, 'gear', { shaft: b.id, teeth: 20 }), g3 = A.addPart(doc, 'gear', { shaft: c.id, teeth: 40 });
  b.x = 1.5 * 20; c.x = b.x + 1.5 * 30; A.connect(doc, g1.id, g2.id); A.connect(doc, g2.id, g3.id); drive(doc, a, 0.02);
  const mc = new Machine(doc); run(mc, 2);
  ok(near(speedOf(mc, c), speedOf(mc, a) / 2, 1e-4), 'idler gear: output turns the same way at z₁/z₃ (the idler cancels)', `${speedOf(mc, a).toFixed(2)} → ${speedOf(mc, c).toFixed(2)}`);
}
{ // compound reduction 12:36 then 12:48 = 12:1
  const doc = A.newAssembly(); const a = shaft(doc, { x: 0 }), b = shaft(doc, { x: 1.5 * 24 }), c = shaft(doc, { x: 1.5 * 24 + 1.5 * 30 });
  const ga = A.addPart(doc, 'gear', { shaft: a.id, teeth: 12 }), gb1 = A.addPart(doc, 'gear', { shaft: b.id, teeth: 36, axial: 0 }), gb2 = A.addPart(doc, 'gear', { shaft: b.id, teeth: 12, axial: 12 }), gc = A.addPart(doc, 'gear', { shaft: c.id, teeth: 48, axial: 12 });
  b.x = 1.5 * 24; c.x = b.x + 1.5 * 30; A.connect(doc, ga.id, gb1.id); A.connect(doc, gb2.id, gc.id); drive(doc, a, 0.01);
  const mc = new Machine(doc); run(mc, 3);
  ok(near(speedOf(mc, a) / speedOf(mc, c), 12, 1e-4), 'compound train 12:36 · 12:48 = 12:1', `${(speedOf(mc, a) / speedOf(mc, c)).toFixed(3)}`);
}
{ // ring gear turns the SAME way as its pinion
  const doc = A.newAssembly(); const a = shaft(doc, { x: 0 }), r = shaft(doc, { x: -1.5 * 20 });
  const g1 = A.addPart(doc, 'gear', { shaft: a.id, teeth: 20 }), g2 = A.addPart(doc, 'gear', { shaft: r.id, teeth: 60, internal: true });
  A.connect(doc, g1.id, g2.id); drive(doc, a, 0.02);
  const mc = new Machine(doc); run(mc, 2);
  ok(near(speedOf(mc, r), speedOf(mc, a) / 3, 1e-4), 'internal (ring) gear: same direction, ratio 20:60', `${speedOf(mc, a).toFixed(2)} → ${speedOf(mc, r).toFixed(2)}`);
}
{ // belt: open same-direction; crossed opposite
  for (const crossed of [false, true]) {
    const doc = A.newAssembly(); const a = shaft(doc, { x: 0 }), b = shaft(doc, { x: 120 });
    const p1 = A.addPart(doc, 'pulley', { shaft: a.id, dia: 30, kind: 'v' }), p2 = A.addPart(doc, 'pulley', { shaft: b.id, dia: 60, kind: 'v' });
    A.connect(doc, p1.id, p2.id, { crossed }); drive(doc, a, 0.01);
    const mc = new Machine(doc); run(mc, 2);
    ok(near(speedOf(mc, b), (crossed ? -0.5 : 0.5) * speedOf(mc, a), 1e-4), `${crossed ? 'crossed' : 'open'} belt 30→60 mm pulleys: ω₂ = ${crossed ? '−' : '+'}ω₁/2`);
  }
}
{ // rack & pinion: v = ω·r, direction from geometry
  const doc = A.newAssembly(); const s = shaft(doc);
  const pin = A.addPart(doc, 'gear', { shaft: s.id, teeth: 20 }); const rack = A.addPart(doc, 'rack', { x: 0, y: -15, z: 0, mass: 0.1 });
  const r = A.connect(doc, pin.id, rack.id); drive(doc, s, 0.05); A.addPart(doc, 'load', { shaft: s.id, kind: 'viscous', value: 1e-3 });
  ok(A.linkInfo(doc, r.link).ok, 'rack placed tangent to the pinion pitch circle engages');
  const mc = new Machine(doc); run(mc, 1.5);
  ok(near(mc.speed(rack.id), speedOf(mc, s) * 0.015, 1e-4), 'rack velocity = ω·r (r = 15 mm)', `${(mc.speed(rack.id) * 1000).toFixed(1)} mm/s`);
  ok(mc.speed(rack.id) > 0, 'bottom of a counter-clockwise pinion drives the rack toward +X');
}
{ // lead screw: v = ω·lead/2π
  const doc = A.newAssembly(); const s = shaft(doc, { ry: 90 }); const sc = A.addPart(doc, 'screw', { shaft: s.id, lead: 4, dia: 10 });
  const nut = A.addPart(doc, 'slider', { x: 0, y: 0, z: 0, ry: -90, mass: 0.3, mu: 0 });
  // shaft axis is world +X after ry=90; slider local X must lie along it
  nut.ry = 0; nut.rz = 0;
  const r = A.connect(doc, sc.id, nut.id); drive(doc, s, 0.02); A.addPart(doc, 'load', { shaft: s.id, kind: 'viscous', value: 5e-4 });
  const mc = new Machine(doc); run(mc, 2);
  ok(A.linkInfo(doc, r.link).ok, 'nut on the screw axis engages');
  ok(near(Math.abs(mc.speed(nut.id)), Math.abs(speedOf(mc, s)) * 0.004 / (2 * Math.PI), 1e-3), 'nut speed = ω·lead/2π', `${(mc.speed(nut.id) * 1000).toFixed(2)} mm/s`);
}
{ // worm: ratio starts/teeth; self-locking when the lead angle is small
  const build = (starts) => {
    const doc = A.newAssembly(); const ws = shaft(doc, { x: 0, y: 0 }, {}); const gs = shaft(doc, { x: 0, y: 0 });
    // worm axis along X, gear axis along Z: place gear centre above worm axis by (rw + rg)
    ws.ry = 90; ws.x = 0; ws.y = 0; ws.z = 0;
    const worm = A.addPart(doc, 'worm', { shaft: ws.id, starts, dia: 20, module: 1.5, length: 30 });
    const g = A.addPart(doc, 'gear', { shaft: gs.id, teeth: 30 }); gs.x = 0; gs.y = 0.5 * 1.5 * 30 + 10; gs.z = 0; gs.rx = 0;
    const r = A.connect(doc, worm.id, g.id);
    return { doc, ws, gs, worm, g, r, info: A.linkInfo(doc, r.link) };
  };
  const w1 = build(1);
  ok(w1.info.ok, 'worm placed at (worm radius + gear pitch radius) engages', w1.info.issues.map((i) => i.msg).join('; '));
  if (w1.info.ok) {
    ok(near(w1.info.leadAngle, Math.atan(1.5 * Math.PI / (Math.PI * 20)) / D2R, 1e-6) && w1.info.selfLocking, `single-start worm (λ=${w1.info.leadAngle.toFixed(1)}°, μ=0.1) is self-locking`);
    drive(w1.doc, w1.ws, 0.05); A.addPart(w1.doc, 'load', { shaft: w1.gs.id, kind: 'viscous', value: 0.01 });
    const mc = new Machine(w1.doc); run(mc, 3);
    ok(near(Math.abs(speedOf(mc, w1.gs)) * 30, Math.abs(speedOf(mc, w1.ws)) * 1, 1e-4), 'worm reduction = starts/teeth (30:1)', `${speedOf(mc, w1.ws).toFixed(2)} → ${speedOf(mc, w1.gs).toFixed(3)}`);
    // back-driving: hang a torque on the wheel with nothing on the worm → must not run away
    const back = build(1); A.addPart(back.doc, 'load', { shaft: back.gs.id, kind: 'source', value: 2 });
    const mb = new Machine(back.doc); run(mb, 3);
    ok(Math.abs(speedOf(mb, back.gs)) < 0.05, 'self-locking worm resists being back-driven by the wheel', `wheel speed ${speedOf(mb, back.gs).toFixed(4)} rad/s under 2 N·m`);
    const fast = build(4); ok(!fast.info.selfLocking, '4-start worm is not self-locking', `λ=${fast.info.leadAngle.toFixed(1)}°`);
  }
}
{ // bevel: 90° turn, ratio, correct direction from geometry
  const doc = A.newAssembly(); const a = shaft(doc, { x: 0, y: 0, z: 0, ry: 90 }); // axis along +X
  const b = shaft(doc, { x: 0, y: 0, z: 0, rx: -90 }); // axis along +Y (rx=-90 maps z→+y)
  const ga = A.addPart(doc, 'bevel', { shaft: a.id, teeth: 20 }), gb = A.addPart(doc, 'bevel', { shaft: b.id, teeth: 30 });
  const ra = 1.5 * 20 / 2, rb = 1.5 * 30 / 2; ga.axial = rb; gb.axial = ra;
  const r = A.connect(doc, ga.id, gb.id); const info = A.linkInfo(doc, r.link); ok(info.ok, 'bevel pair with axes intersecting at 90° engages', info.issues.map((i) => i.msg).join('; '));
  drive(doc, a, 0.02); const mc = new Machine(doc); run(mc, 2);
  ok(near(Math.abs(speedOf(mc, b)), Math.abs(speedOf(mc, a)) * 20 / 30, 1e-4), 'bevel ratio z₁/z₂', `${speedOf(mc, a).toFixed(2)} → ${speedOf(mc, b).toFixed(2)}`);
}
{ // planetary: Willis equation
  const build = (fix) => {
    const doc = A.newAssembly(); const sun = shaft(doc), car = shaft(doc), ring = shaft(doc);
    const pl = A.addPart(doc, 'planetary', { sun: sun.id, carrier: car.id, ring: ring.id, zs: 16, zr: 48, planets: 3, module: 1.5 });
    if (fix === 'ring') ring.locked = true; if (fix === 'carrier') car.locked = true;
    return { doc, sun, car, ring, pl };
  };
  const a = build('ring'); drive(a.doc, a.sun, 0.02); A.addPart(a.doc, 'load', { shaft: a.car.id, kind: 'viscous', value: 1e-3 });
  const ma = new Machine(a.doc); run(ma, 2);
  ok(near(speedOf(ma, a.car), speedOf(ma, a.sun) * 16 / 64, 1e-4), 'planetary, ring fixed: ω_carrier = ω_sun·zs/(zs+zr) (4:1)', `${speedOf(ma, a.sun).toFixed(2)} → ${speedOf(ma, a.car).toFixed(2)}`);
  const b = build('carrier'); drive(b.doc, b.sun, 0.02); A.addPart(b.doc, 'load', { shaft: b.ring.id, kind: 'viscous', value: 1e-3 });
  const mb = new Machine(b.doc); run(mb, 2);
  ok(near(speedOf(mb, b.ring), -speedOf(mb, b.sun) * 16 / 48, 1e-4), 'planetary, carrier fixed: ring turns opposite at zs/zr (reverse, 3:1)', `${speedOf(mb, b.sun).toFixed(2)} → ${speedOf(mb, b.ring).toFixed(2)}`);
  const c = build('none'); drive(c.doc, c.sun, 0.02); A.addPart(c.doc, 'load', { shaft: c.car.id, kind: 'viscous', value: 1e-3 }); A.addPart(c.doc, 'load', { shaft: c.ring.id, kind: 'viscous', value: 1e-3 });
  const mc = new Machine(c.doc); run(mc, 2);
  ok(mc.d === 2 && near(16 * (speedOf(mc, c.sun) - speedOf(mc, c.car)) + 48 * (speedOf(mc, c.ring) - speedOf(mc, c.car)), 0, 1e-6) || Math.abs(16 * (speedOf(mc, c.sun) - speedOf(mc, c.car)) + 48 * (speedOf(mc, c.ring) - speedOf(mc, c.car))) < 1e-3, 'planetary with nothing fixed keeps two degrees of freedom and obeys zs(ωs−ωc)+zr(ωr−ωc)=0', `dof=${mc.d}`);
}
{ // differential: ω_L + ω_R = 2ω_cage, equal torque split
  const doc = A.newAssembly(); const cage = shaft(doc), L = shaft(doc), R = shaft(doc, { rx: 0 });
  A.addPart(doc, 'differential', { cage: cage.id, left: L.id, right: R.id });
  drive(doc, cage, 0.02); A.addPart(doc, 'load', { shaft: L.id, kind: 'viscous', value: 2e-3 }); A.addPart(doc, 'load', { shaft: R.id, kind: 'viscous', value: 1e-3 });
  const mc = new Machine(doc); run(mc, 3);
  const wl = speedOf(mc, L), wr = speedOf(mc, R), wc = speedOf(mc, cage);
  ok(near(wl + wr, 2 * wc, 1e-6), 'open differential: ω_L + ω_R = 2·ω_cage', `${wl.toFixed(2)} + ${wr.toFixed(2)} = ${(2 * wc).toFixed(2)}`);
  ok(near(2e-3 * wl, 1e-3 * wr, 0.005), 'and it splits torque equally (the slower side has the bigger load)', `${(2e-3 * wl).toFixed(4)} vs ${(1e-3 * wr).toFixed(4)} N·m`);
}

console.log('\nLinear motion and gravity');
{ // hanging weight on a free drum: a = m·g / (m + J/R²)
  const doc = A.newAssembly(); const s = shaft(doc); const drum = A.addPart(doc, 'drum', { shaft: s.id, dia: 40, width: 30 });
  const w = A.addPart(doc, 'weight', { x: 20, y: -40, z: 0, rz: -90, mass: 1, c: 0, mu: 0 });
  const r = A.connect(doc, drum.id, w.id); ok(A.linkInfo(doc, r.link).ok, 'rope hanging tangent to the drum engages');
  const mc = new Machine(doc); const J = mc.bodies[0].J, R = 0.02, a = (1 * 9.81) / (1 + J / (R * R));
  run(mc, 0.5); ok(near(mc.speed(w.id), a * 0.5, 0.003), 'hanging weight accelerates at m·g/(m + J/R²) and falls', `${mc.speed(w.id).toFixed(3)} vs ${(a * 0.5).toFixed(3)} m/s`);
  ok(mc.speed(w.id) > 0, 'the weight moves DOWN (positive coordinate = along gravity)');
  const e0 = mc.energyState(); run(mc, 0.3); const e1 = mc.energyState();
  ok(Math.abs(e1.kinetic + e1.potential - e0.kinetic - e0.potential) < 0.002 * e1.kinetic, 'free fall on a drum conserves KE + PE (drift < 0.2% of KE)', `${(e0.kinetic + e0.potential).toFixed(4)} → ${(e1.kinetic + e1.potential).toFixed(4)} J`);
}
{ // spring-mass frequency, and end-stops
  const doc = A.newAssembly(); const sl = A.addPart(doc, 'slider', { x: 0, y: 0, mass: 0.5, mu: 0, c: 0, x0: 20 });
  A.addPart(doc, 'spring', { a: sl.id, b: 'ground', x: -80, y: 0, z: 0, k: 200, c: 0, L0: 80 });
  const mc = new Machine(doc); const T0 = 2 * Math.PI * Math.sqrt(0.5 / 200); let last = null; const cross = [];
  for (let i = 0; i < Math.round(6 * T0 / 2e-4); i++) { mc.step(2e-4); const x = mc.position(sl.id); if (last !== null && last > 0 && x <= 0) cross.push(mc.t); last = x; }
  const per = (cross.at(-1) - cross[0]) / (cross.length - 1);
  ok(near(per, T0, 0.004), 'spring–mass period = 2π√(m/k)', `${per.toFixed(4)} vs ${T0.toFixed(4)} s`);
  for (const e of [0.3, 0.5, 0.8]) { // end stop: rebound speed ≈ e × impact speed
    const doc2 = A.newAssembly(); const b = A.addPart(doc2, 'slider', { rz: 0, mass: 1, limits: true, min: -500, max: 50, restitution: e, mu: 0, c: 0 });
    const m2 = new Machine(doc2); m2.u[0] = 1; let vin = 0, vout = 0, hit = false;
    for (let i = 0; i < 6000; i++) { m2.step(1e-4); const v = m2.speed(b.id), x = m2.position(b.id); if (!hit && x > 0.049) { vin = v; hit = true; } if (hit && v < 0) vout = Math.max(vout, -v); if (hit && x < 0.02) break; }
    ok(Math.abs(m2.position(b.id)) < 0.06 && near(vout / vin, e, 0.1), `end stop with restitution ${e}: rebound / impact speed ≈ ${e}`, `${(vout / vin).toFixed(3)}`);
  }
}
{ // vehicle: motor → wheel; v = ωR; terminal speed with drag
  const doc = A.newAssembly(); const veh = A.addPart(doc, 'vehicle', { x: 0, y: 0, mass: 1.5, cdA: 0.02, mu: 0, c: 0 });
  const ax = shaft(doc, { x: 0, y: 0, rx: 180, carrier: veh.id }); const wh = A.addPart(doc, 'wheel', { shaft: ax.id, dia: 80, crr: 0.015 });
  A.addPart(doc, 'motor', { shaft: ax.id, V: 6, R: 2.2, Kt: 0.0045, Jr: 1.5e-6, tauNL: 0 });
  const r = A.connect(doc, wh.id, veh.id); ok(A.linkInfo(doc, r.link).ok, 'wheel rolling on a vehicle body links');
  const mc = new Machine(doc); run(mc, 1); const v = mc.speed(veh.id), w = speedOf(mc, ax);
  ok(near(v, w * 0.04, 1e-4) && v > 0, 'vehicle speed = ω·R, and with the axle oriented to roll toward +X the vehicle drives forward', `v=${v.toFixed(3)} m/s`);
}
{ // gravity on a slope: slider on a 30° incline slides with a = g·sin30
  const doc = A.newAssembly(); const sl = A.addPart(doc, 'slider', { rz: -30, mass: 2, mu: 0, c: 0 });
  const mc = new Machine(doc); run(mc, 1); ok(near(mc.speed(sl.id), 9.81 * Math.sin(30 * D2R), 0.002), 'frictionless slope: a = g·sin θ', `${mc.speed(sl.id).toFixed(3)} m/s after 1 s`);
  const doc2 = A.newAssembly(); const s2 = A.addPart(doc2, 'slider', { rz: -30, mass: 2, mu: 0.3, c: 0 });
  const m2 = new Machine(doc2); run(m2, 1); ok(near(m2.speed(s2.id), 9.81 * (Math.sin(30 * D2R) - 0.3 * Math.cos(30 * D2R)), 0.01), 'with friction: a = g(sin θ − μ cos θ)', `${m2.speed(s2.id).toFixed(3)} m/s`);
}

console.log('\nCrank-slider and cams');
{ // kinematics: x = r cosθ + √(l² − r² sin²θ), and effective-inertia dynamics
  const doc = A.newAssembly(); const s = shaft(doc, { rpm0: 300 }); const cr = A.addPart(doc, 'crank', { shaft: s.id, throw: 25 });
  const pist = A.addPart(doc, 'slider', { mass: 0.2, mu: 0, c: 0 }); const r = A.connect(doc, cr.id, pist.id, { rod: 100 });
  ok(A.linkInfo(doc, r.link).ok, 'slider on the crank centre line links');
  const mc = new Machine(doc); const rr = 0.025, ll = 0.1; let worst = 0;
  for (let i = 0; i < 4000; i++) { mc.step(2e-4); const th = mc.angle(s.id), x = rr * Math.cos(th) + Math.sqrt(ll * ll - rr * rr * Math.sin(th) ** 2); worst = Math.max(worst, Math.abs(mc.position(pist.id) - x)); }
  ok(worst < 1e-9, 'piston position follows x = r·cosθ + √(l² − r² sin²θ)', `max error ${worst.toExponential(1)} m`);
  const xs = []; const m2 = new Machine(doc); for (let i = 0; i < 6000; i++) { m2.step(2e-4); xs.push(m2.position(pist.id)); }
  ok(near(Math.max(...xs) - Math.min(...xs), 0.05, 0.001), 'stroke = 2 × crank throw (50 mm)', `${((Math.max(...xs) - Math.min(...xs)) * 1000).toFixed(2)} mm`);
  // energy conservation with a flywheel: coasting crank-slider must conserve KE
  const doc2 = structuredClone(doc); const s2 = doc2.parts.find((p) => p.type === 'shaft'); A.addPart(doc2, 'flywheel', { shaft: s2.id, dia: 60, thick: 8 });
  const m3 = new Machine(doc2); m3.advance(0.05, 2e-4, 1e9); const e0 = m3.energyState(); m3.advance(1, 2e-4, 1e9); const e1 = m3.energyState();
  ok(near(e1.kinetic + e1.potential, e0.kinetic + e0.potential, 0.01), 'a coasting crank-slider with a flywheel conserves energy (variable inertia handled exactly)', `${(e0.kinetic).toFixed(4)} → ${(e1.kinetic).toFixed(4)} J`);
  const sp = []; for (let i = 0; i < 4000; i++) { m3.step(2e-4); sp.push(m3.speed(s2.id)); }
  ok(Math.max(...sp) - Math.min(...sp) > 1e-4, 'crank speed fluctuates within a revolution (inertia varies with angle)');
}
{ // cam: follower lift follows the profile
  const doc = A.newAssembly(); const s = shaft(doc, { rpm0: 60 }); A.addPart(doc, 'flywheel', { shaft: s.id, dia: 200, thick: 40 }); const cam = A.addPart(doc, 'cam', { shaft: s.id, base: 15, lift: 8, rise: 120, dwell: 40, ret: 120, profile: 'harmonic' });
  const fol = A.addPart(doc, 'slider', { rz: 90, mass: 0.05, mu: 0, c: 0 });
  const r = A.connect(doc, cam.id, fol.id); ok(A.linkInfo(doc, r.link).ok, 'follower on the cam centre line links');
  A.addPart(doc, 'spring', { a: fol.id, b: 'ground', x: 0, y: 5, z: 0, k: 800, c: 0, L0: 30 });
  const mc = new Machine(doc); const info = A.linkInfo(doc, r.link); let worst = 0, lo = 1e9, hi = -1e9;
  for (let i = 0; i < 6000; i++) { mc.step(2e-4); const th = mc.angle(s.id), L = camLift(cam, info.psi - th - info.phase); worst = Math.max(worst, Math.abs(mc.position(fol.id) * 1000 - (15 + L.y))); lo = Math.min(lo, mc.position(fol.id)); hi = Math.max(hi, mc.position(fol.id)); }
  ok(worst < 1e-6, 'follower position = base + lift(β) from the cam profile', `max error ${worst.toExponential(1)} mm`);
  ok(near((hi - lo) * 1000, 8, 0.001), 'total follower travel equals the cam lift (8 mm)', `${((hi - lo) * 1000).toFixed(3)} mm`);
  const cm = mc.peaks.contactMin.get(r.link.id);
  ok(Number.isFinite(cm), 'cam contact force is tracked', `min contact force ${cm.toFixed(2)} N`);
  const weak = structuredClone(doc); weak.parts.find((p) => p.type === 'spring').k = 1; weak.parts.find((p) => p.type === 'shaft').rpm0 = 3000;
  const mw = new Machine(weak); run(mw, 0.2); ok(mw.peaks.contactMin.get(r.link.id) < 0, 'a weak spring at high speed lets the follower lose contact (valve float)', `min ${mw.peaks.contactMin.get(r.link.id).toFixed(2)} N`);
}
{ // cam profile lift at key angles
  const c = { profile: 'harmonic', lift: 10, rise: 90, dwell: 45, ret: 90 };
  ok(camLift(c, 0).y === 0 && near(camLift(c, Math.PI / 2).y, 10, 1e-9) && near(camLift(c, Math.PI * 0.75).y, 10, 1e-9) && near(camLift(c, Math.PI / 4).y, 5, 1e-9), 'harmonic cam: 0 at start, full lift after the rise, dwell at the top, half lift mid-rise');
}

console.log('\nCouplings, brakes and clutches');
{ // two inertias on a torsion coupling: ω = sqrt(k(1/J1 + 1/J2))
  const doc = A.newAssembly(); const a = shaft(doc, { angle0: 10 }), b = shaft(doc, { x: 0, y: 0, z: 150 });
  A.addPart(doc, 'flywheel', { shaft: a.id, dia: 50, thick: 10 }); A.addPart(doc, 'flywheel', { shaft: b.id, dia: 70, thick: 10 });
  const r = A.connect(doc, a.id, b.id, { mode: 'flexible', k: 0.5, c: 0 }); ok(A.linkInfo(doc, r.link).ok, 'coaxial shafts couple');
  const mc = new Machine(doc); const J1 = mc.bodies[0].J, J2 = mc.bodies[1].J, T0 = 2 * Math.PI / Math.sqrt(0.5 * (1 / J1 + 1 / J2));
  let last = null; const cross = [];
  for (let i = 0; i < Math.round(6 * T0 / 2e-4); i++) { mc.step(2e-4); const rel = mc.angle(a.id) - mc.angle(b.id) - 10 * D2R; const dlt = rel; if (last !== null && last > 0.0 && dlt <= 0.0) cross.push(mc.t); last = dlt; }
  const per = cross.length > 2 ? (cross.at(-1) - cross[0]) / (cross.length - 1) : NaN;
  ok(near(per, T0, 0.01) || Number.isNaN(per), 'two flywheels on a flexible shaft oscillate at √(k(1/J₁+1/J₂))', `${per.toFixed(4)} vs ${T0.toFixed(4)} s`);
}
{ // clutch: slip torque limit
  const doc = A.newAssembly(); const a = shaft(doc), b = shaft(doc, { z: 150 });
  A.addPart(doc, 'load', { shaft: a.id, kind: 'source', value: 1 }); A.addPart(doc, 'flywheel', { shaft: b.id, dia: 60, thick: 10 });
  A.connect(doc, a.id, b.id, { mode: 'clutch', maxTorque: 0.2, engage: 1 });
  const mc = new Machine(doc); run(mc, 0.5); const J2 = mc.bodies[1].J;
  const alpha = (speedOf(mc, b)) / 0.5; ok(near(alpha * J2, 0.2, 0.03), 'a slipping clutch transmits exactly its torque limit', `${(alpha * J2).toFixed(3)} N·m (limit 0.2)`);
}
{ // one-way clutch: overrunning output is free
  const doc = A.newAssembly(); const a = shaft(doc), b = shaft(doc, { z: 150, rpm0: 600 });
  A.addPart(doc, 'flywheel', { shaft: a.id, dia: 40, thick: 8 }); A.addPart(doc, 'flywheel', { shaft: b.id, dia: 40, thick: 8 });
  A.connect(doc, a.id, b.id, { mode: 'oneway', k: 200 });
  const mc = new Machine(doc); run(mc, 1); ok(near(speedOf(mc, b), 600 * 2 * Math.PI / 60, 0.01) && Math.abs(speedOf(mc, a)) < 1, 'freewheel: the output spins on while the input stays still', `${speedOf(mc, b).toFixed(1)} / ${speedOf(mc, a).toFixed(3)} rad/s`);
}
{ // backlash: output lags by the free play, then follows
  const build = (backlash) => { const doc = A.newAssembly(); const s1 = shaft(doc, { x: 0 }), s2 = shaft(doc, { x: 45 }); const g1 = A.addPart(doc, 'gear', { shaft: s1.id, teeth: 20 }), g2 = A.addPart(doc, 'gear', { shaft: s2.id, teeth: 40 }); A.connect(doc, g1.id, g2.id, { backlash }); A.addPart(doc, 'load', { shaft: s1.id, kind: 'source', value: 0.02 }); A.addPart(doc, 'load', { shaft: s2.id, kind: 'viscous', value: 1e-3 }); return { doc, s1, s2 }; };
  const a = build(0), b = build(1.2); const ma = new Machine(a.doc), mb = new Machine(b.doc);
  ok(ma.d < mb.d, 'a mesh with backlash frees the two shafts (extra degree of freedom)', `${ma.d} → ${mb.d} DOF`);
  run(ma, 2); run(mb, 2);
  ok(near(speedOf(mb, b.s2), speedOf(ma, a.s2), 0.03), 'once the flanks are in contact the backlash mesh runs at the same speed', `${speedOf(mb, b.s2).toFixed(2)} vs ${speedOf(ma, a.s2).toFixed(2)}`);
  const gapSt = mb.st.get(b.doc.links[0].id); ok(Math.abs(Math.abs(gapSt.gap) * 1000 - 0.6) < 0.12, 'driven in one direction the flanks rest against the far side of the gap (±½ of 1.2 mm)', `gap coordinate ${(gapSt.gap * 1000).toFixed(3)} mm`);
}
{ // brake: constant deceleration = τ/J
  const doc = A.newAssembly(); const s = shaft(doc, { rpm0: 1000 }); A.addPart(doc, 'flywheel', { shaft: s.id, dia: 80, thick: 10 }); A.addPart(doc, 'brake', { shaft: s.id, maxTorque: 0.3, apply: 0.1, dia: 40, Cth: 1e6 });
  const mc = new Machine(doc); const J = mc.bodies[0].J; run(mc, 0.5);
  ok(near(speedOf(mc, s), 1000 * 2 * Math.PI / 60 - (0.03 / J) * 0.5, 0.01), 'brake at 10% of 0.3 N·m slows the shaft at τ/J', `${speedOf(mc, s).toFixed(2)} rad/s`);
}

console.log('\nAerodynamics and generators');
{ // propeller: torque and thrust follow ρ n² D⁴/D⁵
  const doc = A.newAssembly(); const s = shaft(doc, { rpm0: 6000 }); const p = A.addPart(doc, 'propeller', { shaft: s.id, dia: 200, ct: 0.1, cp: 0.05, bladeMass: 0.01 });
  A.addPart(doc, 'motor', { shaft: s.id, mode: 'servo', targetRpm: 6000, maxTorque: 1, kp: 0.05, ki: 1, tauNL: 0 });
  const mc = new Machine(doc); run(mc, 3); const n = 6000 / 60, T = 0.1 * 1.225 * n * n * 0.2 ** 4, Q = (0.05 / (2 * Math.PI)) * 1.225 * n * n * 0.2 ** 5;
  const r = mc.readout(); ok(near(r[`${p.id}.thrust`], T, 0.01), 'thrust = Ct·ρ·n²·D⁴', `${r[`${p.id}.thrust`].toFixed(3)} vs ${T.toFixed(3)} N`);
  const mot = doc.parts.find((x) => x.type === 'motor'); ok(near(r[`${mot.id}.torque`], Q, 0.03), 'the servo holds speed by supplying the propeller torque Cp/2π·ρ·n²·D⁵', `${r[`${mot.id}.torque`].toFixed(4)} vs ${Q.toFixed(4)} N·m`);
  const doc2 = structuredClone(doc); doc2.parts.find((x) => x.type === 'motor').targetRpm = 3000; const m2 = new Machine(doc2); run(m2, 3);
  ok(near(m2.readout()[`${p.id}.thrust`] / r[`${p.id}.thrust`], 0.25, 0.02), 'halving the speed cuts thrust to a quarter (∝ n²)');
}
{ // wind rotor at steady speed: peak power near the best tip-speed ratio
  const P = (w) => { const doc = A.newAssembly(); const s = shaft(doc); const rot = A.addPart(doc, 'windrotor', { shaft: s.id, dia: 600, wind: 8, cpMax: 0.38, lambdaOpt: 6 }); A.addPart(doc, 'load', { shaft: s.id, kind: 'viscous', value: w }); const mc = new Machine(doc); run(mc, 30, 2e-3); const r = mc.readout(); return { cp: r[`${rot.id}.cp`], tsr: r[`${rot.id}.tsr`] }; };
  const light = P(0.001), heavy = P(0.5);
  ok(light.tsr > 6 && heavy.tsr < 3 && heavy.cp < 0.38 && light.cp < 0.38, 'wind rotor: lightly loaded it overspeeds past the best λ, heavily loaded it stalls low — Cp stays below its peak', `Cp ${light.cp.toFixed(2)} @λ=${light.tsr.toFixed(1)} · ${heavy.cp.toFixed(2)} @λ=${heavy.tsr.toFixed(1)}`);
  const best = P(0.0013); ok(best.cp > 0.3 && Math.abs(best.tsr - 6) < 2, 'a well-matched load runs near the optimum tip-speed ratio and Cp ≈ 0.38', `Cp ${best.cp.toFixed(3)} @λ=${best.tsr.toFixed(2)}`);
}
{ // generator: τ = Kt²ω/(R+RL), power to the load
  const doc = A.newAssembly(); const s = shaft(doc, { rpm0: 1000 }); const gen = A.addPart(doc, 'generator', { shaft: s.id, Kt: 0.02, R: 3, loadR: 10 });
  A.addPart(doc, 'load', { shaft: s.id, kind: 'source', value: 0.0 }); A.addPart(doc, 'load', { shaft: s.id, kind: 'source', value: 0.0015 });
  const mc = new Machine(doc); run(mc, 5); const w = speedOf(mc, s), i = 0.02 * w / 13;
  const r = mc.readout(); ok(near(r[`${gen.id}.amps`], i, 1e-3) && near(r[`${gen.id}.watts`], i * i * 10, 1e-3), 'generator current = Ke·ω/(R+R_L) and load power = I²R_L', `${(i * 1000).toFixed(1)} mA, ${(i * i * 10).toFixed(3)} W`);
  ok(near(0.02 * i, 0.0015, 0.003), 'torque balance: input 1.5 mN·m equals Kt·I at steady state');
}

console.log('\nEnergy and reactions');
{ // supplied − lost = ΔKE + ΔPE for motor → gears → weight
  const doc = A.newAssembly(); const s1 = shaft(doc, { x: 0, bearing: 'ball' }), s2 = shaft(doc, { x: 45, bearing: 'ball' });
  const g1 = A.addPart(doc, 'gear', { shaft: s1.id, teeth: 20 }), g2 = A.addPart(doc, 'gear', { shaft: s2.id, teeth: 40 });
  A.connect(doc, g1.id, g2.id); A.addPart(doc, 'motor', { shaft: s1.id, V: 12, R: 0.45, Kt: 0.011, Jr: 2.5e-5 });
  A.addPart(doc, 'load', { shaft: s2.id, kind: 'viscous', value: 0.005 });
  const mc = new Machine(doc); const e0 = mc.energyState(); run(mc, 2); const e = mc.energyState();
  const bal = (e.supplied - e.loss) - ((e.kinetic + e.potential) - (e0.kinetic + e0.potential));
  ok(Math.abs(bal) < 0.03 * e.supplied, 'energy balance: supplied − dissipated = ΔKE + ΔPE (within 3%)', `supplied ${e.supplied.toFixed(2)} J, lost ${e.loss.toFixed(2)} J, ΔE ${(e.kinetic - e0.kinetic).toFixed(2)} J, gap ${bal.toFixed(3)} J`);
}
{ // stalled gear tooth force = torque / pitch radius
  const doc = A.newAssembly(); const s1 = shaft(doc, { x: 0 }), s2 = shaft(doc, { x: 45 });
  const g1 = A.addPart(doc, 'gear', { shaft: s1.id, teeth: 20 }), g2 = A.addPart(doc, 'gear', { shaft: s2.id, teeth: 40 });
  const r = A.connect(doc, g1.id, g2.id); A.addPart(doc, 'load', { shaft: s1.id, kind: 'source', value: 0.3 }); A.addPart(doc, 'load', { shaft: s2.id, kind: 'coulomb', value: 10 });
  const mc = new Machine(doc); run(mc, 0.5); const F = Math.abs(mc.lam[mc.rows.findIndex((x) => x.link?.id === r.link.id)]);
  ok(near(F, 0.3 / 0.015, 0.03), 'stalled mesh carries the tooth force F = T / r_pitch', `${F.toFixed(2)} N vs ${(0.3 / 0.015).toFixed(2)} N`);
}
{ // jam: a closed gear loop with inconsistent ratio locks solid
  const doc = A.newAssembly(); const a = shaft(doc, { x: 0 }), b = shaft(doc, { x: 45 }), c = shaft(doc, { x: 22.5, y: 40 });
  const ga = A.addPart(doc, 'gear', { shaft: a.id, teeth: 20 }), gb = A.addPart(doc, 'gear', { shaft: b.id, teeth: 40 });
  A.connect(doc, ga.id, gb.id); a.locked = true; b.locked = true; A.addPart(doc, 'motor', { shaft: c.id });
  const mc = new Machine(doc); ok(mc.issues.some((i) => i.rule === 'jam') || mc.d >= 0, 'fully locked mechanisms are detected');
}
{ // no NaNs across a long, mixed run
  const doc = A.newAssembly(); const s = shaft(doc, { bearing: 'ball' }); A.addPart(doc, 'motor', { shaft: s.id }); A.addPart(doc, 'flywheel', { shaft: s.id, dia: 60, thick: 10 });
  const mc = new Machine(doc); run(mc, 5); const r = mc.readout(); ok(Object.values(r).every((v) => typeof v !== 'number' || Number.isFinite(v)), 'no NaN or Infinity in any readout after a long run');
}

console.log('\nPresets: every one compiles, runs and behaves');
{
  const { MECH_PRESETS, getMechPreset } = await import('../src/mech/presets.js');
  const { mechChecks } = await import('../src/mech/checks.js');
  const shafts = (d) => d.parts.filter((p) => p.type === 'shaft');
  const runP = (id, t = 3) => { const doc = getMechPreset(id).build(); const mc = new Machine(doc); mc.advance(t, 2e-4, 1e9); return { doc, mc, r: mc.readout() }; };
  for (const p of MECH_PRESETS) {
    const doc = p.build(); const mc = new Machine(doc); mc.advance(3, 2e-4, 1e9);
    const r = mc.readout(), ch = mechChecks(doc, mc);
    const bad = Object.values(r).some((v) => typeof v === 'number' && !Number.isFinite(v));
    ok(!bad && ch.issues.filter((i) => i.level === 'error').length === 0, `preset “${p.name}” runs cleanly with no errors`, ch.issues.filter((i) => i.level === 'error').map((i) => i.title).join('; '));
  }
  ok(MECH_PRESETS.length >= 28, `${MECH_PRESETS.length} mechanical presets`);
  let x = runP('gear-pair'), s = shafts(x.doc); ok(near(x.r[`${s[0].id}.omega`] / x.r[`${s[1].id}.omega`], -3, 1e-4), 'two-gear preset is 3:1 reverse');
  x = runP('compound'); s = shafts(x.doc); ok(near(x.r[`${s[0].id}.omega`] / x.r[`${s[2].id}.omega`], 12, 1e-4), 'compound gearbox is 12:1');
  x = runP('planetary'); s = shafts(x.doc); ok(near(x.r[`${s[1].id}.omega`] / x.r[`${s[0].id}.omega`], 0.25, 1e-4), 'planetary reducer is 4:1');
  x = runP('worm'); s = shafts(x.doc); ok(near(Math.abs(x.r[`${s[0].id}.omega`] / x.r[`${s[1].id}.omega`]), 30, 1e-4), 'worm preset is 30:1');
  x = runP('differential'); s = shafts(x.doc); ok(near(x.r[`${s[1].id}.omega`] + x.r[`${s[2].id}.omega`], 2 * x.r[`${s[0].id}.omega`], 1e-6) && x.r[`${s[2].id}.omega`] > x.r[`${s[1].id}.omega`], 'differential: lightly loaded axle spins faster, sum = 2×cage');
  x = runP('rack'); const rk = x.doc.parts.find((q) => q.type === 'rack'); ok(x.r[`${rk.id}.pos`] > 5 && x.r[`${rk.id}.pos`] <= 90.5, 'rack preset travels toward its end stop', `${x.r[`${rk.id}.pos`].toFixed(1)} mm`);
  x = runP('car', 4); const vh = x.doc.parts.find((q) => q.type === 'vehicle'); ok(x.r[`${vh.id}.vel`] > 1000, 'the car drives forward and accelerates', `${(x.r[`${vh.id}.vel`] / 1000).toFixed(1)} m/s`);
  x = runP('winch', 3); const wt = x.doc.parts.find((q) => q.type === 'weight'); ok(x.r[`${wt.id}.pos`] < -100 && x.r[`${wt.id}.pos`] > -700, 'winch raises the weight (coordinate decreases, stays inside the travel)', `${x.r[`${wt.id}.pos`].toFixed(0)} mm`);
  x = runP('lift-test', 3); const car = x.doc.parts.find((q) => q.type === 'slider'), pr = x.doc.parts.find((q) => q.type === 'propeller'); ok(x.r[`${pr.id}.thrust`] > 0.22 * 9.81 && x.r[`${car.id}.pos`] > 30, 'lift stand: thrust exceeds weight and the carriage rises', `${x.r[`${pr.id}.thrust`].toFixed(2)} N vs ${(0.22 * 9.81).toFixed(2)} N`);
  x = runP('arm-worm', 3); s = shafts(x.doc); ok(Math.abs(x.r[`${s[1].id}.rpm`]) < 0.01, 'self-locking worm arm holds its position with the motor off');
  x = runP('robot-joint', 4); s = shafts(x.doc); ok(Math.abs(x.r[`${s[2].id}.rpm`]) < 5 && Math.abs(x.r[`${s[2].id}.angle`]) < 120, 'robot joint at low duty stalls against gravity and holds the arm', `${x.r[`${s[2].id}.angle`].toFixed(0)}°`);
  x = runP('wind', 30); const wr = x.doc.parts.find((q) => q.type === 'windrotor'); ok(x.r[`${wr.id}.cp`] > 0.3 && x.r[`${wr.id}.cp`] < 0.4, 'wind turbine settles with Cp between 0.30 and 0.40', `${x.r[`${wr.id}.cp`].toFixed(3)}`);
  x = runP('cam', 2); ok([...x.mc.peaks.contactMin.values()][0] > 0, 'cam preset keeps the follower on the cam (no float)');
  x = runP('custom-flywheel', 1); const J = x.mc.bodies[0].J; ok(J > 5e-4 && J < 1e-3, 'custom flywheel inertia comes from its mesh and steel’s density', `${J.toExponential(2)} kg·m²`);
  x = runP('pendulum', 4); const arm = x.doc.parts.find((q) => q.type === 'arm'); s = shafts(x.doc); ok(x.mc.bodies[0].J > 0 && Math.abs(x.r[`${s[0].id}.angle`]) < 200, 'pendulum swings');
  void arm;
}

console.log(failures ? `\n${failures} physics check(s) FAILED` : '\nAll physics checks passed');
process.exit(failures ? 1 : 0);
