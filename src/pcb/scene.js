import { FOOTPRINTS, footprintBounds } from './footprints.js';
import { partPads, toWorld } from './model.js';
import { strokeText } from './font.js';

export const SILK_W = 0.15;

/** Expand a footprint's silk primitives into world-space lines and circles. */
function partSilk(part) {
  const fp = FOOTPRINTS[part.fp];
  const out = [];
  const W = (x, y) => toWorld(part, { x, y });
  for (const s of fp.silk) {
    if (s.t === 'line') { const a = W(s.x1, s.y1), b = W(s.x2, s.y2); out.push({ k: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y }); }
    else if (s.t === 'circle') { const c = W(s.x, s.y); out.push({ k: 'circle', x: c.x, y: c.y, r: s.r }); }
    else if (s.t === 'rect') {
      const hw = s.w / 2, hh = s.h / 2;
      const c = [W(s.x - hw, s.y - hh), W(s.x + hw, s.y - hh), W(s.x + hw, s.y + hh), W(s.x - hw, s.y + hh)];
      for (let i = 0; i < 4; i++) out.push({ k: 'line', x1: c[i].x, y1: c[i].y, x2: c[(i + 1) % 4].x, y2: c[(i + 1) % 4].y });
    }
  }
  return out;
}

/** Where a part's reference designator sits: just above its outline. */
export function refPosition(part) {
  const b = footprintBounds(FOOTPRINTS[part.fp]);
  const off = { x: 0, y: -(b.h / 2) - 1.1 };
  const w = toWorld({ ...part, x: 0, y: 0 }, off);
  return { x: part.x + w.x, y: part.y + w.y };
}

/**
 * Everything drawable, in board millimetres. The editor renders this and the
 * exporters (SVG, Gerber) consume the very same primitives, so what you see is what you ship.
 */
export function buildScene(doc) {
  const pads = doc.parts.flatMap(partPads);
  const silk = { top: [], bottom: [] };
  const push = (side, items) => silk[side === 'bottom' ? 'bottom' : 'top'].push(...items);

  for (const part of doc.parts) {
    const side = part.side === 'bottom' ? 'bottom' : 'top';
    push(side, partSilk(part));
    if (part.showRef !== false) {
      const p = refPosition(part);
      push(side, strokeText(part.ref, { x: p.x, y: p.y, h: 1, mirror: side === 'bottom' })
        .map((l) => ({ k: 'line', ...l })));
    }
  }
  for (const t of doc.texts) {
    const side = t.layer === 'bottom' ? 'bottom' : 'top';
    push(side, strokeText(t.text, { x: t.x, y: t.y, h: t.size, rot: t.rot ?? 0, mirror: side === 'bottom' })
      .map((l) => ({ k: 'line', ...l, textId: t.id })));
  }

  return {
    board: doc.board,
    pads,
    tracks: { top: doc.tracks.filter((t) => t.layer === 'top'), bottom: doc.tracks.filter((t) => t.layer === 'bottom') },
    vias: doc.vias,
    silk,
  };
}
