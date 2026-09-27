import { CATALOG } from '../lib/catalog.js';

/**
 * Bridges a breadboard/PCB circuit and a mechanism so a simulated DC motor or generator can be
 * driven by real current, and a mechanical load can be felt back as an electrical one — without
 * either simulator knowing the other exists. Both sides already model an ideal motor
 * (torque = k·current, back-EMF = k·speed); a link just keeps their shared variable, speed, in sync.
 *
 *   bb   = { part }    a 'motor' part from the breadboard/PCB circuit (has .state.omega/.current)
 *   mech = { id }       a mech 'motor' or 'generator' part id, whose Machine index we drive
 *
 * Each simulated instant:
 *   1. the mechanism's shaft speed is written into the breadboard motor's state (sets back-EMF)
 *   2. the breadboard circuit is solved, giving a current
 *   3. that current becomes a torque (mech.Kt × i) fed into the mechanism for its own step
 *
 * Both simulators otherwise keep their own timestep; call coupleBefore/coupleAfter around
 * whichever one owns the shared clock (usually the mechanism, since it is stiffer).
 */

export function makeLink(bbPart, mechPartId, opts = {}) {
  return { id: `${bbPart.id}:${mechPartId}`, bbId: bbPart.id, mechId: mechPartId, gear: opts.gear ?? 1, sign: opts.sign ?? 1 };
}

/** Marks the breadboard part as externally driven (idempotent). */
export function armLink(bbPart) { bbPart.state.linked = true; }
export function disarmLink(bbPart) { bbPart.state.linked = false; }

/**
 * Before the mechanism steps: copy its current shaft speed into every linked breadboard motor so
 * the circuit sees the right back-EMF, then solve the circuit for that instant's current.
 */
export function syncToCircuit(links, bbDoc, circuit, mechDoc, machine) {
  for (const link of links) {
    const part = bbDoc.parts.find((p) => p.id === link.bbId);
    const mechPart = mechDoc.parts.find((p) => p.id === link.mechId);
    if (!part || !CATALOG[part.type] || !mechPart) continue;
    armLink(part);
    const w = machine.speed(mechPart.shaft) ?? 0;
    part.state.omega = link.sign * link.gear * w;
  }
}

/** After the circuit has solved: read the current each linked motor drew and hand it to the mechanism as torque. */
export function syncToMechanism(links, doc, machine) {
  for (const link of links) {
    const part = doc.parts.find((p) => p.id === link.bbId);
    if (!part) continue;
    const i = part.state.current ?? 0;
    const ke = part.props?.ke ?? 0;
    const torque = link.sign * link.gear * ke * i;
    machine.setMotorTorque(link.mechId, torque);
  }
}

/** One coupled step: mechanism and circuit advance together by dt. */
export function coupledStep(links, bbDoc, circuit, mechDoc, machine, dt) {
  syncToCircuit(links, bbDoc, circuit, mechDoc, machine);
  circuit.step(dt);
  syncToMechanism(links, bbDoc, machine);
  machine.step(dt);
}

/** Electrical + mechanical readout for a link, for a combined "Systems" scope. */
export function linkReadout(link, doc, machine) {
  const part = doc.parts.find((p) => p.id === link.bbId);
  if (!part) return null;
  const r = machine.readout();
  return {
    current: part.state.current ?? 0,
    voltage: (part.state.current ?? 0) * (part.props?.resistance ?? 0) + (part.props?.ke ?? 0) * (part.state.omega ?? 0),
    rpm: r[`${link.mechId}.rpm`],
    torque: r[`${link.mechId}.torque`] ?? r[`${link.mechId}.power`],
  };
}
