// Physics check for the breadboard↔mechanism coupling ("Systems").
//   node scripts/verify-systems.mjs
import { Circuit } from '../src/lib/circuit.js';
import { seat, wire, hole, pinRef, loose, board, makePart } from '../src/lib/examples.js';
import * as A from '../src/mech/assembly.js';
import { Machine } from '../src/mech/machine.js';
import { coupledStep, makeLink } from '../src/systems/couple.js';

let failures = 0;
const ok = (c, m, x = '') => { if (c) console.log(`  ✓ ${m}${x ? `  (${x})` : ''}`); else { failures++; console.log(`  ✗ ${m}${x ? `  (${x})` : ''}`); } };
const near = (a, b, t = 0.02) => Math.abs(a - b) <= t * Math.max(1e-9, Math.abs(b));

console.log('Breadboard motor driving a mechanical flywheel');
{
  // Breadboard: 9 V battery -> motor (ke=0.02, R=6 Ω). Mechanism: a bare shaft + flywheel, motor
  // torque supplied only via the link (mode: 'circuit'), so ALL electrical behaviour comes from
  // the breadboard part. Expect the same first-order response as a standalone motor+flywheel:
  // τ = J·R/ke², ω∞ = V/ke — because ke(breadboard) === Kt(mech) by construction.
  const bat = loose('battery', -68, 26, { rot: -Math.PI / 2, props: { voltage: 9, esr: 0 } });
  const mot = seat('motor', 'B10', { props: { resistance: 6, ke: 0.02, load: 0 } });
  const bbDoc = { parts: [board(), bat, mot], wires: [wire(pinRef(bat.id, 'pos'), hole('tpos3'), '#f00'), wire(pinRef(bat.id, 'neg'), hole('tneg3'), '#000'), wire(hole('tpos8'), hole('B10')), wire(hole('B10'), hole('tneg12'))] };
  // give the motor both leads on the board properly: simpler to wire pins directly
  bbDoc.wires = [wire(pinRef(bat.id, 'pos'), hole('tpos3'), '#f00'), wire(pinRef(bat.id, 'neg'), hole('tneg3'), '#000'), wire(hole('tpos8'), pinRef(mot.id, 'pos')), wire(pinRef(mot.id, 'neg'), hole('tneg12'))];
  const circuit = new Circuit(bbDoc.parts, bbDoc.wires);

  const mDoc = A.newAssembly(); const shaft = A.addPart(mDoc, 'shaft', { bearing: 'none' });
  A.addPart(mDoc, 'motor', { shaft: shaft.id, mode: 'circuit', Kt: 0.02, tauNL: 0 });
  const fw = A.addPart(mDoc, 'flywheel', { shaft: shaft.id, dia: 40, thick: 10 });
  const machine = new Machine(mDoc);
  const mechMotorId = mDoc.parts.find((p) => p.type === 'motor').id;
  const links = [makeLink(mot, mechMotorId)];

  const J = machine.bodies[0].J, R = 6, ke = 0.02, tau = (J * R) / (ke * ke), winf = 9 / ke;
  const dt = 5e-5, steps = Math.round(tau / dt);
  for (let i = 0; i < steps; i++) coupledStep(links, bbDoc, circuit, mDoc, machine, dt);
  ok(near(machine.speed(shaft.id), winf * (1 - Math.exp(-1)), 0.01), 'coupled system reaches 63% of no-load speed after τ = J·R/ke²', `${machine.speed(shaft.id).toFixed(1)} vs ${(winf * (1 - Math.exp(-1))).toFixed(1)} rad/s`);
  for (let i = 0; i < steps * 8; i++) coupledStep(links, bbDoc, circuit, mDoc, machine, dt);
  ok(near(machine.speed(shaft.id), winf, 0.02), 'and settles at V/ke — the mechanism, not the breadboard model, owns the inertia', `${machine.speed(shaft.id).toFixed(1)} vs ${winf.toFixed(1)} rad/s`);
  ok(near(mot.state.current, 0, 0.5) || Math.abs(mot.state.current) < 0.05, 'no-load steady state draws almost no current', `${(mot.state.current * 1000).toFixed(1)} mA`);
  void fw;
}

console.log('\nMechanical load feeds back into the electrical current');
{
  const bat = loose('battery', -68, 26, { rot: -Math.PI / 2, props: { voltage: 9, esr: 0 } });
  const mot = seat('motor', 'B10', { props: { resistance: 6, ke: 0.02, load: 0 } });
  const bbDoc = { parts: [board(), bat, mot], wires: [wire(pinRef(bat.id, 'pos'), hole('tpos3'), '#f00'), wire(pinRef(bat.id, 'neg'), hole('tneg3'), '#000'), wire(hole('tpos8'), pinRef(mot.id, 'pos')), wire(pinRef(mot.id, 'neg'), hole('tneg12'))] };
  const circuit = new Circuit(bbDoc.parts, bbDoc.wires);
  const mDoc = A.newAssembly(); const shaft = A.addPart(mDoc, 'shaft', { bearing: 'none' });
  A.addPart(mDoc, 'motor', { shaft: shaft.id, mode: 'circuit', Kt: 0.02, tauNL: 0 });
  A.addPart(mDoc, 'flywheel', { shaft: shaft.id, dia: 30, thick: 6 });
  A.addPart(mDoc, 'load', { shaft: shaft.id, kind: 'viscous', value: 0.002 }); // a mechanical drag with no electrical equivalent
  const machine = new Machine(mDoc);
  const mechMotorId = mDoc.parts.find((p) => p.type === 'motor').id;
  const links = [makeLink(mot, mechMotorId)];
  const dt = 5e-5;
  for (let i = 0; i < 200000; i++) coupledStep(links, bbDoc, circuit, mDoc, machine, dt);
  const w = machine.speed(shaft.id), iExpected = 0.002 * w / 0.02; // steady state: ke·i = drag torque
  ok(near(mot.state.current, iExpected, 0.02), 'a purely mechanical load on the shaft shows up as current on the breadboard', `${(mot.state.current * 1000).toFixed(1)} mA vs ${(iExpected * 1000).toFixed(1)} mA`);
  ok(w > 1 && w < 9 / 0.02, 'the loaded speed sits below the no-load speed', `${w.toFixed(1)} rad/s`);
}

console.log('\nStandalone breadboard motor is unaffected when not linked');
{
  const bat = loose('battery', -68, 26, { rot: -Math.PI / 2, props: { voltage: 9 } });
  const mot = seat('motor', 'B10', { props: { resistance: 25, ke: 0.012, load: 0.15 } });
  const doc = { parts: [board(), bat, mot], wires: [wire(pinRef(bat.id, 'pos'), hole('tpos3')), wire(pinRef(bat.id, 'neg'), hole('tneg3')), wire(hole('tpos8'), pinRef(mot.id, 'pos')), wire(pinRef(mot.id, 'neg'), hole('tneg12'))] };
  const c = new Circuit(doc.parts, doc.wires);
  for (let i = 0; i < 20000; i++) c.step(1e-4);
  ok(mot.state.omega > 0 && !mot.state.linked, 'a motor never given a Systems link still spins under its own built-in model', `${mot.state.rpm.toFixed(0)} rpm`);
}

console.log(failures ? `\n${failures} systems check(s) FAILED` : '\nAll systems checks passed');
process.exit(failures ? 1 : 0);
