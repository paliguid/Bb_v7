import { addCustomFromPrimitives, addPart, autoPhase, connect, newAssembly } from './assembly.js';

/**
 * Ready-made machines. Every preset is a real assembly (edit anything) that meshes correctly and runs.
 * Geometry convention: shafts point along +Z, gears lie in the XY plane, gravity pulls toward −Y.
 */
const M = 1.5; // default gear module (mm)
const cd = (za, zb, m = M) => (m * (za + zb)) / 2;

function tools(doc) {
  const shaft = (x, y, o = {}) => addPart(doc, 'shaft', { x, y, z: 0, length: 120, dia: 8, ...o });
  const gear = (sh, teeth, o = {}) => addPart(doc, 'gear', { shaft: sh.id, teeth, module: M, ...o });
  const link = (a, b, o) => { const r = connect(doc, a.id, b.id, o); if (r.error) throw new Error(`${doc.name}: ${r.error}`); return r.link; };
  const motor = (sh, o = {}) => addPart(doc, 'motor', { shaft: sh.id, axial: -50, ...o });
  return { shaft, gear, link, motor };
}
const preset = (id, name, cat, blurb, build) => ({ id, name, cat, blurb, build: () => { const doc = newAssembly(name); build(doc, tools(doc)); autoPhase(doc); return doc; } });

/** Two-stage compound reduction 12:36 then 12:48 = 12:1. Returns the input and output shafts. */
function reducer(doc, t, x0, y0) {
  const a = t.shaft(x0, y0), b = t.shaft(x0 + cd(12, 36), y0), c = t.shaft(x0 + cd(12, 36) + cd(12, 48), y0);
  const ga = t.gear(a, 12, { axial: 0 }), gb1 = t.gear(b, 36, { axial: 0 }), gb2 = t.gear(b, 12, { axial: 12 }), gc = t.gear(c, 48, { axial: 12 });
  t.link(ga, gb1); t.link(gb2, gc);
  return { a, b, c, gc };
}

const MOTOR = { V: 6, R: 2.2, Kt: 0.0045, Jr: 1.5e-6, tauNL: 0.0006, Rth: 8, Cth: 12, ratedI: 1.2 };

export const MECH_PRESETS = [
  /* ------------------------------------------------------------- gear trains */
  preset('gear-pair', 'Two-gear reduction (3:1)', 'Gear trains', 'A 12-tooth pinion drives a 36-tooth gear: a third of the speed, three times the torque.', (doc, { shaft, gear, link, motor }) => {
    const a = shaft(0, 0), b = shaft(cd(12, 36), 0);
    motor(a, MOTOR); const g1 = gear(a, 12), g2 = gear(b, 36);
    addPart(doc, 'load', { shaft: b.id, kind: 'viscous', value: 0.0004 });
    link(g1, g2);
  }),
  preset('idler', 'Idler gear (same direction)', 'Gear trains', 'Three gears in a row: the middle idler reverses the direction twice, so the output turns the same way as the input.', (doc, { shaft, gear, link, motor }) => {
    const a = shaft(0, 0), b = shaft(cd(16, 20), 0), c = shaft(cd(16, 20) + cd(20, 40), 0);
    motor(a, MOTOR); const g1 = gear(a, 16), g2 = gear(b, 20), g3 = gear(c, 40);
    addPart(doc, 'load', { shaft: c.id, kind: 'viscous', value: 0.0004 });
    link(g1, g2); link(g2, g3);
  }),
  preset('compound', 'Compound gearbox (12:1)', 'Gear trains', 'Two reduction stages on a shared intermediate shaft: 12:36 then 12:48 multiplies to 12:1.', (doc, { shaft, gear, link, motor }) => {
    const a = shaft(0, 0), b = shaft(cd(12, 36), 0), c = shaft(cd(12, 36) + cd(12, 48), 0);
    motor(a, { ...MOTOR, V: 6 });
    const ga = gear(a, 12, { axial: 0 }), gb1 = gear(b, 36, { axial: 0 }), gb2 = gear(b, 12, { axial: 12 }), gc = gear(c, 48, { axial: 12 });
    addPart(doc, 'flywheel', { shaft: c.id, dia: 50, thick: 8, axial: -20 });
    link(ga, gb1); link(gb2, gc);
  }),
  preset('backlash', 'Gears with backlash', 'Gear trains', 'A 1.2 mm gap between the flanks: the output lags and rattles when the load reverses. Watch the tooth force spike.', (doc, { shaft, gear, link, motor }) => {
    const a = shaft(0, 0), b = shaft(cd(20, 40), 0);
    motor(a, { ...MOTOR, mode: 'voltage' }); const g1 = gear(a, 20), g2 = gear(b, 40);
    addPart(doc, 'flywheel', { shaft: b.id, dia: 60, thick: 8 });
    link(g1, g2, { backlash: 1.2 });
  }),
  preset('ring-gear', 'Pinion inside a ring gear', 'Gear trains', 'Internal gears turn the same way as their pinion, and they are compact: a 20-tooth pinion in a 60-tooth ring.', (doc, { shaft, gear, link, motor }) => {
    const a = shaft(0, 0), r = shaft(-cd(60, -20), 0, { length: 30 });
    motor(a, MOTOR); const p = gear(a, 20), ring = gear(r, 60, { internal: true, width: 8 });
    addPart(doc, 'load', { shaft: r.id, kind: 'viscous', value: 0.001 });
    link(p, ring);
  }),
  preset('planetary', 'Planetary reducer (4:1)', 'Gear trains', 'Ring fixed, sun driven, carrier out: ω_carrier = ω_sun · zs/(zs+zr). Change what is locked to get other ratios — even reverse.', (doc, { shaft }) => {
    const sun = shaft(0, 0, { z: -50, length: 100, dia: 8 }), car = shaft(0, 0, { z: 50, length: 100, dia: 12 }), ring = shaft(0, 0, { z: 0, length: 6, dia: 3, locked: true });
    addPart(doc, 'planetary', { sun: sun.id, carrier: car.id, ring: ring.id, zs: 16, zr: 48, planets: 3, module: M, axial: 50 });
    addPart(doc, 'motor', { shaft: sun.id, axial: -45, ...MOTOR });
    addPart(doc, 'flywheel', { shaft: car.id, axial: 30, dia: 60, thick: 8 });
  }),
  preset('differential', 'Open differential', 'Gear trains', 'The cage drives two axles: ω_L + ω_R = 2·ω_cage, with equal torque. The lightly loaded side spins faster.', (doc, { shaft }) => {
    const cage = shaft(0, 0, { z: 0, length: 40, dia: 30 }), L = shaft(0, 0, { z: -60, length: 100, dia: 8 }), R = shaft(0, 0, { z: 60, length: 100, dia: 8 });
    addPart(doc, 'differential', { cage: cage.id, left: L.id, right: R.id, size: 44 });
    addPart(doc, 'motor', { shaft: cage.id, axial: -30, ...MOTOR, V: 6 });
    addPart(doc, 'load', { shaft: L.id, axial: -20, kind: 'viscous', value: 0.0008 });
    addPart(doc, 'load', { shaft: R.id, axial: 20, kind: 'viscous', value: 0.0002 });
    addPart(doc, 'flywheel', { shaft: L.id, axial: -40, dia: 40, thick: 6 }); addPart(doc, 'flywheel', { shaft: R.id, axial: 40, dia: 40, thick: 6 });
  }),
  preset('worm', 'Worm drive (self-locking)', 'Gear trains', 'A single-start worm and a 30-tooth wheel: 30:1 in one stage — and the wheel cannot drive the worm back, so a load stays put.', (doc, { shaft, gear, link }) => {
    const ws = shaft(0, 0, { ry: 90, length: 120 }), gs = shaft(0, 0.5 * M * 30 + 10, { length: 60 });
    const worm = addPart(doc, 'worm', { shaft: ws.id, starts: 1, dia: 20, module: M, length: 36 }), wheel = gear(gs, 30);
    addPart(doc, 'motor', { shaft: ws.id, axial: -60, ...MOTOR });
    addPart(doc, 'flywheel', { shaft: gs.id, dia: 60, thick: 8, axial: 15 });
    link(worm, wheel);
  }),
  preset('bevel', 'Bevel gears (90° drive)', 'Gear trains', 'Bevel gears turn the drive through a right angle. Their shafts must intersect and each gear sits at the other’s pitch radius from the apex.', (doc, { shaft }) => {
    const a = shaft(0, 0, { ry: 90, x: -40, length: 100 }), b = shaft(0, 0, { rx: -90, y: -40, length: 100 });
    const ra = M * 20 / 2, rb = M * 30 / 2;
    const ga = addPart(doc, 'bevel', { shaft: a.id, teeth: 20, module: M, axial: rb + 40 }), gb = addPart(doc, 'bevel', { shaft: b.id, teeth: 30, module: M, axial: ra + 40 });
    addPart(doc, 'motor', { shaft: a.id, axial: -30, ...MOTOR });
    addPart(doc, 'flywheel', { shaft: b.id, axial: -30, dia: 50, thick: 8 });
    const r = connect(doc, ga.id, gb.id); if (r.error) throw new Error(r.error);
  }),
  preset('belt', 'V-belt drive (2:1)', 'Gear trains', 'A 30 mm pulley drives a 60 mm pulley. Belts absorb shock and slip when overloaded — try a big load and read the Mechanical Check.', (doc, { shaft, link, motor }) => {
    const a = shaft(0, 0), b = shaft(120, 0);
    motor(a, MOTOR); const p1 = addPart(doc, 'pulley', { shaft: a.id, dia: 30, kind: 'v' }), p2 = addPart(doc, 'pulley', { shaft: b.id, dia: 60, kind: 'v' });
    addPart(doc, 'load', { shaft: b.id, kind: 'viscous', value: 0.0006 });
    link(p1, p2, { tension: 60 });
  }),
  preset('crossed-belt', 'Crossed belt (reverses)', 'Gear trains', 'Crossing the belt makes the driven pulley turn the opposite way.', (doc, { shaft, link, motor }) => {
    const a = shaft(0, 0), b = shaft(110, 0);
    motor(a, MOTOR); const p1 = addPart(doc, 'pulley', { shaft: a.id, dia: 36, kind: 'flat' }), p2 = addPart(doc, 'pulley', { shaft: b.id, dia: 36, kind: 'flat' });
    addPart(doc, 'flywheel', { shaft: b.id, dia: 50, thick: 8, axial: 30 });
    link(p1, p2, { crossed: true });
  }),
  preset('timing', 'Timing-belt drive (no slip)', 'Gear trains', 'A toothed belt keeps exact ratio and phase — used in 3D printers and cameras.', (doc, { shaft, link, motor }) => {
    const a = shaft(0, 0), b = shaft(90, 0);
    motor(a, MOTOR); const p1 = addPart(doc, 'pulley', { shaft: a.id, dia: 16, kind: 'timing', width: 8 }), p2 = addPart(doc, 'pulley', { shaft: b.id, dia: 48, kind: 'timing', width: 8 });
    addPart(doc, 'flywheel', { shaft: b.id, dia: 50, thick: 6, axial: 25 });
    link(p1, p2, { tension: 30 });
  }),

  /* ------------------------------------------------------------ linear motion */
  preset('rack', 'Rack and pinion', 'Linear motion', 'A pinion on a rack turns rotation into travel: v = ω·r. A 12:1 gearbox keeps it controllable; drive it either way with the motor’s duty slider and it stops on its end stops.', (doc, t) => {
    const { a, c } = reducer(doc, t, 0, 0);
    t.motor(a, { ...MOTOR, V: 6, duty: 0.1 });
    const pin = t.gear(c, 20, { axial: -10 });
    const rack = addPart(doc, 'rack', { x: c.x, y: -M * 20 / 2, z: -10, length: 220, mass: 0.15, limits: true, min: -90, max: 90, module: M });
    t.link(pin, rack);
  }),
  preset('screw', 'Lead-screw stage', 'Linear motion', 'A 4 mm-lead screw moves a carriage 4 mm per turn. The motor stalls at the end stop — watch the current and temperature.', (doc, { shaft, link }) => {
    const s = shaft(0, 0, { ry: 90, length: 220, dia: 10 });
    const sc = addPart(doc, 'screw', { shaft: s.id, lead: 4, dia: 10, length: 180 });
    const car = addPart(doc, 'slider', { x: 0, y: 0, z: 0, mass: 0.4, limits: true, min: -70, max: 70, w: 30, h: 24, d: 24, mu: 0.02 });
    addPart(doc, 'motor', { shaft: s.id, axial: -110, ...MOTOR, V: 6, duty: 0.08 });
    link(sc, car);
  }),
  preset('crank-slider', 'Crank-slider (piston engine)', 'Linear motion', 'A crank and a 100 mm rod drive a piston with stroke 2×throw. The crank’s effective inertia swings each revolution, so the flywheel smooths the speed.', (doc, { shaft, link }) => {
    const s = shaft(0, 0, { rpm0: 200 });
    const cr = addPart(doc, 'crank', { shaft: s.id, throw: 25 }); addPart(doc, 'flywheel', { shaft: s.id, dia: 80, thick: 10, axial: -20 });
    const piston = addPart(doc, 'slider', { mass: 0.15, mu: 0.02, w: 40, h: 26, d: 26 });
    addPart(doc, 'load', { shaft: s.id, kind: 'source', value: 0.04 });
    addPart(doc, 'load', { shaft: s.id, kind: 'viscous', value: 0.0004 });
    link(cr, piston, { rod: 100 });
  }),
  preset('cam', 'Cam and spring follower (valve train)', 'Linear motion', 'A harmonic cam lifts a spring-loaded follower 8 mm. Raise the cam speed until the follower floats off the cam.', (doc, { shaft, link }) => {
    const s = shaft(0, 0, { rpm0: 300 });
    const cam = addPart(doc, 'cam', { shaft: s.id, base: 15, lift: 8, rise: 120, dwell: 50, ret: 120, profile: 'harmonic' });
    addPart(doc, 'flywheel', { shaft: s.id, dia: 90, thick: 14, axial: -25 });
    addPart(doc, 'motor', { shaft: s.id, axial: -60, mode: 'servo', targetRpm: 300, maxTorque: 0.2, kp: 0.05, ki: 0.5, Kt: 0.02, R: 1 });
    const fol = addPart(doc, 'slider', { rz: 90, mass: 0.04, mu: 0.01, w: 30, h: 8, d: 12 });
    addPart(doc, 'spring', { a: fol.id, b: 'ground', x: 0, y: 55, z: 0, k: 900, c: 1, L0: 60, coilR: 6 });
    link(cam, fol);
  }),

  /* --------------------------------------------------------- energy & dynamics */
  preset('flywheel', 'Flywheel spin-up', 'Dynamics', 'A motor accelerates a steel flywheel exponentially with time constant τ = J·R/Kt². Change the mass and watch τ scale.', (doc, { shaft, motor }) => {
    const s = shaft(0, 0); motor(s, MOTOR); addPart(doc, 'flywheel', { shaft: s.id, dia: 90, thick: 14 });
  }),
  preset('dyno', 'Motor test bench (brake)', 'Dynamics', 'Load a motor with a brake and read its torque-speed curve: torque falls linearly with speed, current rises, and the winding heats.', (doc, { shaft, motor }) => {
    const s = shaft(0, 0); motor(s, { ...MOTOR, V: 12, R: 0.9, Kt: 0.011, Jr: 2.5e-5, Rth: 4, Cth: 60, ratedI: 4 }); addPart(doc, 'flywheel', { shaft: s.id, dia: 50, thick: 8 });
    addPart(doc, 'brake', { shaft: s.id, axial: 30, maxTorque: 0.25, apply: 0.4 });
  }),
  preset('pendulum', 'Pendulum', 'Dynamics', 'A 200 mm arm with a 0.5 kg weight: period T = 2π√(J/mgl). Its start angle is 30° off the hang position.', (doc, { shaft }) => {
    const s = shaft(0, 0, { bearing: 'ball', length: 60 }); addPart(doc, 'arm', { shaft: s.id, length: 200, bob: 0.5, phase: -60 });
  }),
  preset('torsion', 'Torsion oscillator', 'Dynamics', 'A flywheel on a torsion spring: f = (1/2π)√(k/J). Add damping and watch the oscillation die out.', (doc, { shaft }) => {
    const s = shaft(0, 0, { angle0: 40 }); addPart(doc, 'torsionspring', { shaft: s.id, k: 0.15, c: 0.002 }); addPart(doc, 'flywheel', { shaft: s.id, dia: 70, thick: 10 });
  }),
  preset('flexible-shaft', 'Torsional vibration (flexible coupling)', 'Dynamics', 'Two flywheels joined by a springy coupling. A sudden drive torque makes the far flywheel overshoot and ring.', (doc, { shaft, link }) => {
    const a = shaft(0, 0, { z: -60 }), b = shaft(0, 0, { z: 100 });
    addPart(doc, 'flywheel', { shaft: a.id, dia: 60, thick: 10 }); addPart(doc, 'flywheel', { shaft: b.id, dia: 80, thick: 10 });
    addPart(doc, 'load', { shaft: a.id, kind: 'source', value: 0.1, axial: -30 });
    addPart(doc, 'load', { shaft: b.id, kind: 'viscous', value: 0.002, axial: 30 });
    link(a, b, { mode: 'flexible', k: 3, c: 0.01 });
  }),
  preset('clutch', 'Clutch and brake', 'Dynamics', 'A friction clutch limits the torque that reaches the load flywheel; the brake stops it. Slip turns energy into heat.', (doc, { shaft, motor, link }) => {
    const a = shaft(0, 0, { z: -60 }), b = shaft(0, 0, { z: 100 });
    motor(a, MOTOR); addPart(doc, 'flywheel', { shaft: a.id, dia: 50, thick: 8 }); addPart(doc, 'flywheel', { shaft: b.id, dia: 90, thick: 14 });
    addPart(doc, 'brake', { shaft: b.id, axial: 35, maxTorque: 0.4, apply: 0 });
    link(a, b, { mode: 'clutch', maxTorque: 0.02, engage: 1 });
  }),
  preset('freewheel', 'Freewheel (one-way clutch)', 'Dynamics', 'Like a bicycle hub: the drive pushes the output, but the output can spin faster than the drive without dragging it.', (doc, { shaft, motor, link }) => {
    const a = shaft(0, 0, { z: -60 }), b = shaft(0, 0, { z: 100, rpm0: 900 });
    motor(a, MOTOR); addPart(doc, 'flywheel', { shaft: a.id, dia: 40, thick: 8 }); addPart(doc, 'flywheel', { shaft: b.id, dia: 80, thick: 12 });
    link(a, b, { mode: 'oneway', k: 100 });
  }),

  /* ------------------------------------------------------------- applications */
  preset('winch', 'Winch (motor, gearbox, drum, weight)', 'Applications', 'A 1 kg load on a 40 mm drum through a 12:1 gearbox. Raise it with positive duty, hold it with the brake; the Mechanical Check reports whether the gears and shafts cope.', (doc, t) => {
    const { a, c } = reducer(doc, t, 0, 0);
    t.motor(a, { V: 12, R: 0.9, Kt: 0.011, Jr: 2.5e-5, tauNL: 0.004, Rth: 4, Cth: 60, ratedI: 6, duty: 0.25 });
    const drum = addPart(doc, 'drum', { shaft: c.id, dia: 40, axial: -22 });
    addPart(doc, 'brake', { shaft: c.id, axial: -45, maxTorque: 2, apply: 0, dia: 50 });
    const w = addPart(doc, 'weight', { x: c.x + 20, y: -80, z: -22, rz: -90, mass: 1, limits: true, min: -700, max: 700 });
    t.link(drum, w);
  }),
  preset('arm-worm', 'Robot arm with worm drive (holds position)', 'Applications', 'A motor, worm and wheel move an arm against gravity. Because the worm is self-locking the arm stays put with the power off.', (doc, { shaft, gear, link }) => {
    const ws = shaft(0, 0, { ry: 90, length: 120 }), gs = shaft(0, 0.5 * M * 30 + 10, { length: 60 });
    const worm = addPart(doc, 'worm', { shaft: ws.id, starts: 1, dia: 20, module: M, length: 36 }), wheel = gear(gs, 30);
    addPart(doc, 'motor', { shaft: ws.id, axial: -60, ...MOTOR, V: 6, duty: 0 });
    addPart(doc, 'arm', { shaft: gs.id, axial: 20, length: 150, bob: 0.3, phase: -90 });
    link(worm, wheel);
  }),
  preset('robot-joint', 'Robot joint (geared motor lifts an arm)', 'Applications', 'A drill-class motor and a two-stage gearbox lift a 0.4 kg arm. At low duty it stalls and holds the arm at the angle where motor torque equals gravity torque — and heats up doing it. Raise the duty and it swings over the top.', (doc, { shaft, gear, link, motor }) => {
    const a = shaft(0, 0), b = shaft(cd(12, 40), 0), c = shaft(cd(12, 40) + cd(12, 40), 0);
    motor(a, { V: 12, R: 0.45, Kt: 0.011, Jr: 2.5e-5, tauNL: 0.004, Rth: 2.5, Cth: 120, ratedI: 12, duty: 0.15 });
    const g1 = gear(a, 12, { axial: 0 }), g2 = gear(b, 40, { axial: 0 }), g3 = gear(b, 12, { axial: 12 }), g4 = gear(c, 40, { axial: 12 });
    addPart(doc, 'arm', { shaft: c.id, axial: 30, length: 180, bob: 0.4, phase: -90 });
    link(g1, g2); link(g3, g4);
  }),
  preset('car', 'Electric car (motor, gears, wheels)', 'Applications', 'A small EV: motor → 4:1 gears → axle → two wheels. It accelerates against rolling resistance and aerodynamic drag until the motor’s back-EMF wins.', (doc, { link }) => {
    const veh = addPart(doc, 'vehicle', { x: 0, y: 0, z: 0, mass: 1.6, cdA: 0.03, w: 190, h: 22, d: 80, limits: true, min: -500, max: 60000 });
    const axle = addPart(doc, 'shaft', { x: -60, y: -22, z: 0, rx: 180, length: 110, dia: 6, carrier: veh.id }), axle2 = addPart(doc, 'shaft', { x: 60, y: -22, z: 0, rx: 180, length: 110, dia: 6, carrier: veh.id });
    const mshaft = addPart(doc, 'shaft', { x: -60 + cd(12, 48), y: -22, z: 0, length: 60, dia: 5, carrier: veh.id });
    const gp = addPart(doc, 'gear', { shaft: mshaft.id, teeth: 12, module: M, axial: 0 }), gw = addPart(doc, 'gear', { shaft: axle.id, teeth: 48, module: M, axial: 0, width: 6 });
    addPart(doc, 'motor', { shaft: mshaft.id, axial: 30, V: 7.2, R: 0.25, Kt: 0.0032, Jr: 8e-6, tauNL: 0.002, ratedI: 15, Rth: 3, Cth: 60, duty: 0.8 });
    const w1 = addPart(doc, 'wheel', { shaft: axle.id, axial: 45, dia: 70, mass: 0.1 }), w2 = addPart(doc, 'wheel', { shaft: axle.id, axial: -45, dia: 70, mass: 0.1 });
    const w3 = addPart(doc, 'wheel', { shaft: axle2.id, axial: 45, dia: 70, mass: 0.1 }), w4 = addPart(doc, 'wheel', { shaft: axle2.id, axial: -45, dia: 70, mass: 0.1 });
    link(gp, gw); link(w1, veh); link(w2, veh); link(w3, veh); link(w4, veh);
  }),
  preset('turbo-car', 'Turbo twin-speed RC racer', 'Applications', 'A drill-class motor with a flywheel drives a real 2-speed gearbox — two clutch-selectable gear shafts, like a synchro box — into an open differential and two rear wheels; the front wheels roll free. Engage the low-gear clutch to launch, switch to the high-gear clutch to cruise, and use the brake to stop. Duty also goes negative for reverse.', (doc, { shaft, gear, link, motor }) => {
    const veh = addPart(doc, 'vehicle', { mass: 2.1, cdA: 0.035, w: 300, h: 30, d: 110, limits: true, min: -1000, max: 100000 });

    const frontAxle = addPart(doc, 'shaft', { x: -110, y: -26, z: 0, rx: 180, length: 130, dia: 6, carrier: veh.id, bearing: 'ball' });
    const fw1 = addPart(doc, 'wheel', { shaft: frontAxle.id, axial: 55, dia: 78, width: 22, mass: 0.09, crr: 0.012, mu: 1.0 });
    const fw2 = addPart(doc, 'wheel', { shaft: frontAxle.id, axial: -55, dia: 78, width: 22, mass: 0.09, crr: 0.012, mu: 1.0 });
    link(fw1, veh); link(fw2, veh);

    const DY = -15; // the whole drivetrain (motor -> gearbox -> diff cage) runs along this one y line
    const mshaft = shaft(-30, DY, { length: 70, dia: 5, bearing: 'ball' });
    motor(mshaft, { axial: -45, mode: 'voltage', V: 12, R: 0.45, Kt: 0.011, Jr: 2.5e-5, tauNL: 0.003, Rth: 2.5, Cth: 120, ratedI: 12, duty: 0 });
    addPart(doc, 'flywheel', { shaft: mshaft.id, axial: -8, dia: 34, thick: 7 });

    // Low and high stages share a tooth sum of 56, so both give the SAME centre distance from the motor
    // shaft — that lets the low-gear shaft, high-gear shaft and the single output shaft all sit on one
    // common axis, so each gear shaft can be selectively coupled to the output through its own clutch.
    const loPinionZ = 12, loGearZ = 44, hiPinionZ = 22, hiGearZ = 34, CD = cd(loPinionZ, loGearZ);
    const mPinionLo = gear(mshaft, loPinionZ, { width: 8, axial: -30 });
    const mPinionHi = gear(mshaft, hiPinionZ, { width: 8, axial: 30 });

    const loShaft = shaft(-30 + CD, DY, { z: -35, length: 40, dia: 5, bearing: 'ball' });
    const hiShaft = shaft(-30 + CD, DY, { z: 35, length: 40, dia: 5, bearing: 'ball' });
    const outShaft = shaft(-30 + CD, DY, { z: 0, length: 40, dia: 6, bearing: 'ball' });

    const loGear = gear(loShaft, loGearZ, { width: 8, axial: 5 });
    const hiGear = gear(hiShaft, hiGearZ, { width: 8, axial: -5 });
    link(mPinionLo, loGear); link(mPinionHi, hiGear);

    link(loShaft, outShaft, { mode: 'clutch', maxTorque: 1.5, engage: 1, k: 5, c: 0.02 });
    link(hiShaft, outShaft, { mode: 'clutch', maxTorque: 1.5, engage: 0, k: 5, c: 0.02 });

    addPart(doc, 'brake', { shaft: outShaft.id, axial: 15, dia: 40, maxTorque: 1.5, apply: 0 });

    const rearLeft = shaft(-30 + CD + 90, -26, { z: -70, rx: 180, length: 100, dia: 6, carrier: veh.id, bearing: 'ball' });
    const rearRight = shaft(-30 + CD + 90, -26, { z: 70, rx: 180, length: 100, dia: 6, carrier: veh.id, bearing: 'ball' });
    addPart(doc, 'differential', { cage: outShaft.id, left: rearLeft.id, right: rearRight.id, size: 30, axial: 15 });

    const rw1 = addPart(doc, 'wheel', { shaft: rearLeft.id, axial: -55, dia: 84, width: 26, mass: 0.11, crr: 0.014, mu: 1.15 });
    const rw2 = addPart(doc, 'wheel', { shaft: rearRight.id, axial: 55, dia: 84, width: 26, mass: 0.11, crr: 0.014, mu: 1.15 });
    link(rw1, veh); link(rw2, veh);
  }),
  preset('fan', 'Fan / propeller', 'Applications', 'A 200 mm propeller on a hobby motor: torque ∝ n²D⁵, thrust ∝ n²D⁴. Halving the speed cuts thrust to a quarter.', (doc, { shaft, motor }) => {
    const s = shaft(0, 0); motor(s, MOTOR); addPart(doc, 'propeller', { shaft: s.id, dia: 200, blades: 3, pitch: 20, axial: 30 });
  }),
  preset('lift-test', 'Propeller lift test stand', 'Applications', 'A 150 mm prop pushes a 0.25 kg carriage up a vertical rail. Thrust versus weight decides whether it climbs — the heart of every drone design.', (doc, { shaft }) => {
    const s = shaft(0, -40, { rx: -90, length: 100 });
    addPart(doc, 'motor', { shaft: s.id, axial: -40, V: 7.2, R: 0.25, Kt: 0.0032, Jr: 8e-6, tauNL: 0.002, ratedI: 15, Rth: 3, Cth: 60, duty: 0.9 });
    const p = addPart(doc, 'propeller', { shaft: s.id, axial: 30, dia: 150, blades: 2, pitch: 22, ct: 0.1, cp: 0.05 });
    const car = addPart(doc, 'slider', { x: 0, y: -40, z: 0, rz: 90, mass: 0.22, limits: true, min: 0, max: 600, w: 40, h: 14, d: 30, mu: 0.01, restitution: 0.2 });
    p.target = car.id;
    const rail = addPart(doc, 'frame', { x: 0, y: 200, z: -30, w: 6, h: 520, d: 6 });
    void rail;
  }),
  preset('wind', 'Wind turbine and generator', 'Applications', 'A 600 mm rotor in 8 m/s wind drives a generator into a load. Tune the load so the rotor runs near its best tip-speed ratio (λ ≈ 6).', (doc, { shaft }) => {
    const s = shaft(0, 0, { length: 100 });
    addPart(doc, 'windrotor', { shaft: s.id, axial: 40, dia: 600, blades: 3, wind: 8, cpMax: 0.38, lambdaOpt: 6 });
    addPart(doc, 'generator', { shaft: s.id, axial: -30, Kt: 0.1, R: 2, loadR: 3, Jr: 1e-4, bodyDia: 50, bodyLen: 60 });
  }),
  preset('custom-flywheel', 'Custom flywheel modelled from primitives', 'Model your own', 'A spoked flywheel built from a rim (tube), a hub and four spokes. Its mass and inertia come straight from the mesh and steel’s density.', (doc, { shaft, motor }) => {
    const s = shaft(0, 0); motor(s, MOTOR);
    const spokes = [0, 90].map((a) => ({ k: 'box', w: 96, h: 8, d: 6, rz: a }));
    addCustomFromPrimitives(doc, [{ k: 'tube', dia: 110, inner: 96, h: 14 }, { k: 'cylinder', dia: 22, h: 14 }, ...spokes], { attach: 'shaft', shaft: s.id, material: 'steel', name: 'Spoked flywheel' });
  }),
  preset('lever-mixer', 'Hand crank, gears and flywheel', 'Applications', 'A hand crank (constant torque) through a 1:4 speed-up into a flywheel: how a hand-cranked torch or toy stores energy.', (doc, { shaft, gear, link }) => {
    const a = shaft(0, 0), b = shaft(cd(48, 12), 0);
    addPart(doc, 'handcrank', { shaft: a.id, torque: 0.25, maxRpm: 90, axial: 50 });
    const g1 = gear(a, 48), g2 = gear(b, 12); addPart(doc, 'flywheel', { shaft: b.id, dia: 80, thick: 14, axial: 18 });
    link(g1, g2);
  }),
];

export const MECH_PRESET_CATEGORIES = [...new Set(MECH_PRESETS.map((p) => p.cat))];
export const getMechPreset = (id) => MECH_PRESETS.find((p) => p.id === id) ?? null;
