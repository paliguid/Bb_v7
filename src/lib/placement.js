import { CATALOG } from './catalog.js';
import { BOARD, HOLES, holeByName } from './board.js';

/** Rotates a local pin offset into board space (matches Object3D.rotation.y). */
export const rotateXZ = (p, rot) => ({
  x: p.x * Math.cos(rot) + p.z * Math.sin(rot),
  z: -p.x * Math.sin(rot) + p.z * Math.cos(rot),
});

export function pinWorld(part, pinDef) {
  const r = rotateXZ(pinDef, part.rot ?? 0);
  return { x: part.x + r.x, z: part.z + r.z };
}

/** Which holes each of a part's leads is sitting in. */
export function computeInsertion(part, board, tolerance = 1.5) {
  const def = CATALOG[part.type];
  const inserted = {};
  if (!def || def.board) return inserted;
  for (const pinDef of def.pins) {
    const w = pinWorld(part, pinDef);
    let best = null;
    for (const hole of HOLES()) {
      const d = Math.hypot(w.x - (board.x + hole.x), w.z - (board.z + hole.z));
      if (d < tolerance && (!best || d < best.d)) best = { d, hole };
    }
    if (best) inserted[pinDef.name] = `h:${board.id}:${best.hole.group}`;
  }
  return inserted;
}

/** Origin that puts pin `pinIndex` exactly into the named hole. */
export function originForHole(type, holeName, rot = 0, pinIndex = 0, board = { x: 0, z: 0 }) {
  const def = CATALOG[type];
  const hole = holeByName(holeName);
  if (!hole) throw new Error(`unknown hole ${holeName}`);
  const r = rotateXZ(def.pins[pinIndex], rot);
  return { x: board.x + hole.x - r.x, z: board.z + hole.z - r.z, y: BOARD.h };
}
