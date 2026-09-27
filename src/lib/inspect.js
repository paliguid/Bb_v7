import { CATALOG } from './catalog.js';
import { pinKey } from './circuit.js';

/** Small read-only helpers for asking questions about a document + solved circuit. */

export const partsOf = (doc, type) => doc.parts.filter((p) => p.type === type);
export const firstOf = (doc, type) => doc.parts.find((p) => p.type === type) ?? null;

export const seatedCount = (part) => Object.values(part.inserted ?? {}).filter(Boolean).length;

/** True when every lead of the part is pushed into a hole. */
export function isSeated(part) {
  const def = CATALOG[part.type];
  return def.pins.length > 0 && seatedCount(part) === def.pins.length;
}

export const netOf = (circuit, part, pin) => circuit?.keyToNet.get(pinKey(part.id, pin));

export function sharesNet(circuit, a, pinA, b, pinB) {
  const x = netOf(circuit, a, pinA);
  const y = netOf(circuit, b, pinB);
  return x != null && x === y;
}

/** True when any pin of `a` shares a net with any pin of `b`. */
export function touches(circuit, a, b) {
  for (const pa of CATALOG[a.type].pins) {
    for (const pb of CATALOG[b.type].pins) {
      if (sharesNet(circuit, a, pa.name, b, pb.name)) return true;
    }
  }
  return false;
}

/** How many part pins live on each net — a pin alone on its net is a dead end. */
export function pinPopulation(circuit) {
  const counts = new Map();
  for (const [key, net] of circuit.keyToNet) {
    if (key.startsWith('p:')) counts.set(net, (counts.get(net) ?? 0) + 1);
  }
  return counts;
}
