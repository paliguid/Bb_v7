import { FOOTPRINTS, footprintBounds } from './footprints.js';
import { dist, round6 } from './geometry.js';
import { textWidth } from './font.js';
import { makePart, nextRef, partPads, pid } from './model.js';

/** Pure editing operations on a document draft. Each mutates `d` and returns nothing unless noted. */

const near = (a, b) => Math.abs(a.x - b.x) < 0.02 && Math.abs(a.y - b.y) < 0.02;

/** Drag any unselected track endpoint that sat exactly on a point that moved. */
function stickTracks(d, base, skipIds, moves) {
  if (!moves.length) return;
  const bt = new Map(base.tracks.map((t) => [t.id, t]));
  for (const t of d.tracks) {
    if (skipIds.has(t.id)) continue;
    const b = bt.get(t.id);
    if (!b) continue;
    for (const end of ['a', 'b']) {
      const m = moves.find((mv) => near(mv.from, b[end]));
      if (m) t[end] = { x: round6(m.to.x), y: round6(m.to.y) };
    }
  }
}

const padMoves = (basePart, newPart) => {
  const before = partPads(basePart), after = partPads(newPart);
  return before.map((p, i) => ({ from: { x: p.x, y: p.y }, to: { x: after[i].x, y: after[i].y } }));
};

/** Move objects by (dx,dy) relative to `base` (the document before the gesture started). */
export function applyTranslate(d, base, ids, dx, dy, attach = true) {
  const set = new Set(ids);
  const moves = [];
  const bp = new Map(base.parts.map((p) => [p.id, p]));
  for (const p of d.parts) {
    const b = bp.get(p.id);
    if (!set.has(p.id) || p.locked || !b) continue;
    p.x = round6(b.x + dx); p.y = round6(b.y + dy);
    moves.push(...padMoves(b, p));
  }
  const bv = new Map(base.vias.map((v) => [v.id, v]));
  for (const v of d.vias) {
    const b = bv.get(v.id);
    if (!set.has(v.id) || !b) continue;
    v.x = round6(b.x + dx); v.y = round6(b.y + dy);
    moves.push({ from: { x: b.x, y: b.y }, to: { x: v.x, y: v.y } });
  }
  const bx = new Map(base.texts.map((t) => [t.id, t]));
  for (const t of d.texts) {
    const b = bx.get(t.id);
    if (set.has(t.id) && b) { t.x = round6(b.x + dx); t.y = round6(b.y + dy); }
  }
  const bt = new Map(base.tracks.map((t) => [t.id, t]));
  for (const t of d.tracks) {
    const b = bt.get(t.id);
    if (!set.has(t.id) || !b) continue;
    t.a = { x: round6(b.a.x + dx), y: round6(b.a.y + dy) };
    t.b = { x: round6(b.b.x + dx), y: round6(b.b.y + dy) };
    moves.push({ from: b.a, to: t.a }, { from: b.b, to: t.b });
  }
  if (attach) stickTracks(d, base, set, moves);
}

/** Change a part's rotation / side / position, keeping attached track ends glued to their pads. */
export function reshapePart(d, id, patch, attach = true) {
  const base = structuredClone(d);
  const part = d.parts.find((p) => p.id === id);
  if (!part) return;
  Object.assign(part, patch);
  const b = base.parts.find((p) => p.id === id);
  if (attach && ('x' in patch || 'y' in patch || 'rot' in patch || 'side' in patch)) stickTracks(d, base, new Set(), padMoves(b, part));
}

export function rotateParts(d, ids, attach = true) {
  for (const id of ids) {
    const p = d.parts.find((q) => q.id === id);
    if (p && !p.locked) reshapePart(d, id, { rot: (((p.rot ?? 0) + 90) % 360) }, attach);
  }
}
export function flipParts(d, ids, attach = true) {
  for (const id of ids) {
    const p = d.parts.find((q) => q.id === id);
    if (p && !p.locked) reshapePart(d, id, { side: p.side === 'bottom' ? 'top' : 'bottom' }, attach);
  }
}

export function flipTrackLayer(d, ids) {
  for (const t of d.tracks) if (ids.includes(t.id)) t.layer = t.layer === 'top' ? 'bottom' : 'top';
}

/** Extent of a movable object in board mm. */
export function objBox(o) {
  if ('fp' in o) {
    const b = footprintBounds(FOOTPRINTS[o.fp]);
    const swap = Math.round(o.rot ?? 0) % 180 !== 0;
    const flipX = o.side === 'bottom';
    const cx = flipX ? -(b.x0 + b.x1) / 2 : (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const rc = swap ? { x: -cy, y: cx } : { x: cx, y: cy };
    const rr = ((Math.round(o.rot ?? 0) % 360) + 360) % 360;
    const c = rr === 180 ? { x: -cx, y: -cy } : rr === 270 ? { x: cy, y: -cx } : rc;
    const w = swap ? b.h : b.w, h = swap ? b.w : b.h;
    return { x0: o.x + c.x - w / 2, x1: o.x + c.x + w / 2, y0: o.y + c.y - h / 2, y1: o.y + c.y + h / 2 };
  }
  if ('dia' in o) return { x0: o.x - o.dia / 2, x1: o.x + o.dia / 2, y0: o.y - o.dia / 2, y1: o.y + o.dia / 2 };
  const w = textWidth(o.text, o.size);
  const rot = Math.round(o.rot ?? 0) % 180 !== 0;
  const hw = (rot ? o.size : w) / 2, hh = (rot ? w : o.size) / 2;
  return { x0: o.x - hw, x1: o.x + hw, y0: o.y - hh, y1: o.y + hh };
}

const movable = (d, ids) => [...d.parts, ...d.vias, ...d.texts].filter((o) => ids.includes(o.id));

export function alignObjects(d, ids, axis, how) {
  const objs = movable(d, ids);
  if (objs.length < 2) return;
  const lo = axis === 'x' ? 'x0' : 'y0', hi = axis === 'x' ? 'x1' : 'y1';
  const boxes = objs.map(objBox);
  const target = how === 'min' ? Math.min(...boxes.map((b) => b[lo]))
    : how === 'max' ? Math.max(...boxes.map((b) => b[hi]))
      : (Math.min(...boxes.map((b) => b[lo])) + Math.max(...boxes.map((b) => b[hi]))) / 2;
  const base = structuredClone(d);
  objs.forEach((o, i) => {
    const b = boxes[i];
    const cur = how === 'min' ? b[lo] : how === 'max' ? b[hi] : (b[lo] + b[hi]) / 2;
    const delta = target - cur;
    applyTranslate(d, base, [o.id], axis === 'x' ? delta : 0, axis === 'y' ? delta : 0, true);
  });
}

export function distributeObjects(d, ids, axis) {
  const objs = movable(d, ids);
  if (objs.length < 3) return;
  const center = (o) => { const b = objBox(o); return axis === 'x' ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2; };
  const sorted = [...objs].sort((p, q) => center(p) - center(q));
  const first = center(sorted[0]), last = center(sorted.at(-1));
  const base = structuredClone(d);
  sorted.forEach((o, i) => {
    const want = first + ((last - first) * i) / (sorted.length - 1);
    const delta = want - center(o);
    applyTranslate(d, base, [o.id], axis === 'x' ? delta : 0, axis === 'y' ? delta : 0, true);
  });
}

export function duplicateObjects(d, ids, offset = 2.54) {
  const out = [];
  for (const p of [...d.parts]) {
    if (!ids.includes(p.id)) continue;
    const c = { ...structuredClone(p), id: pid('p'), x: round6(p.x + offset), y: round6(p.y + offset) };
    delete c.srcId;
    c.ref = nextRef(d, FOOTPRINTS[p.fp].prefix);
    d.parts.push(c); out.push(c.id);
  }
  for (const v of [...d.vias]) if (ids.includes(v.id)) { const c = { ...v, id: pid('v'), x: v.x + offset, y: v.y + offset }; d.vias.push(c); out.push(c.id); }
  for (const t of [...d.texts]) if (ids.includes(t.id)) { const c = { ...t, id: pid('x'), x: t.x + offset, y: t.y + offset }; d.texts.push(c); out.push(c.id); }
  for (const t of [...d.tracks]) if (ids.includes(t.id)) {
    const c = { ...structuredClone(t), id: pid('t') };
    c.a = { x: t.a.x + offset, y: t.a.y + offset }; c.b = { x: t.b.x + offset, y: t.b.y + offset };
    d.tracks.push(c); out.push(c.id);
  }
  return out;
}

export function removeObjects(d, ids) {
  const set = new Set(ids);
  const gone = new Set(d.parts.filter((p) => set.has(p.id)).map((p) => p.id));
  d.parts = d.parts.filter((p) => !set.has(p.id));
  d.tracks = d.tracks.filter((t) => !set.has(t.id));
  d.vias = d.vias.filter((v) => !set.has(v.id));
  d.texts = d.texts.filter((t) => !set.has(t.id));
  if (d.netlist && gone.size) {
    d.netlist.nets = d.netlist.nets
      .map((n) => ({ ...n, pads: n.pads.filter((p) => !gone.has(p.part)) }))
      .filter((n) => n.pads.length >= 2);
  }
}

/** All tracks (and vias) electrically chained to `trackId` by shared endpoints on the same layer. */
export function selectRun(d, trackId) {
  const start = d.tracks.find((t) => t.id === trackId);
  if (!start) return [];
  const seen = new Set([start.id]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.pop();
    for (const t of d.tracks) {
      if (seen.has(t.id) || t.layer !== cur.layer) continue;
      if ([cur.a, cur.b].some((p) => near(p, t.a) || near(p, t.b))) { seen.add(t.id); queue.push(t); }
    }
  }
  return [...seen];
}

export function addMountingHoles(d, inset = 3.5) {
  const { w, h } = d.board;
  const spots = [[inset, inset], [w - inset, inset], [inset, h - inset], [w - inset, h - inset]];
  for (const [x, y] of spots) d.parts.push(makePart(d, 'mount-m3', x, y));
}

export function boardExtent(d) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, r = 0) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  for (const p of d.parts) for (const pad of partPads(p)) add(pad.x, pad.y, Math.max(pad.w, pad.h) / 2);
  for (const p of d.parts) { const b = objBox(p); add(b.x0, b.y0); add(b.x1, b.y1); }
  for (const v of d.vias) add(v.x, v.y, v.dia / 2);
  for (const t of d.tracks) { add(t.a.x, t.a.y, t.width / 2); add(t.b.x, t.b.y, t.width / 2); }
  for (const t of d.texts) { const b = objBox(t); add(b.x0, b.y0); add(b.x1, b.y1); }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** Resize the board around everything on it (plus a margin), shifting all objects so the margin is even. */
export function fitBoardToParts(d, margin = 5) {
  const e = boardExtent(d);
  if (!e) return;
  const dx = margin - e.x0, dy = margin - e.y0;
  const snap = (v) => round6(Math.round(v * 2) / 2);
  const shift = (o) => { o.x = round6(o.x + dx); o.y = round6(o.y + dy); };
  d.parts.forEach(shift); d.vias.forEach(shift); d.texts.forEach(shift);
  for (const t of d.tracks) { t.a = { x: round6(t.a.x + dx), y: round6(t.a.y + dy) }; t.b = { x: round6(t.b.x + dx), y: round6(t.b.y + dy) }; }
  d.board.w = snap(Math.ceil(e.x1 - e.x0 + margin * 2));
  d.board.h = snap(Math.ceil(e.y1 - e.y0 + margin * 2));
}

/** Objects whose reference point / both track ends fall inside a box. */
export function objectsInBox(d, a, b) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const inside = (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  return [
    ...d.parts.filter(inside), ...d.vias.filter(inside), ...d.texts.filter(inside),
    ...d.tracks.filter((t) => inside(t.a) && inside(t.b)),
  ].map((o) => o.id);
}

/** Total track length for a net, used for readouts. */
export const lengthOf = (tracks) => tracks.reduce((s, t) => s + dist(t.a, t.b), 0);

/** Drag one end of a track to `to`; neighbouring track ends that were joined there follow. */
export function moveEndpoint(d, base, id, end, to, attach = true) {
  const bt = base.tracks.find((t) => t.id === id);
  if (!bt) return;
  const from = bt[end];
  const target = { x: round6(to.x), y: round6(to.y) };
  const t = d.tracks.find((q) => q.id === id);
  t[end] = target;
  if (attach) stickTracks(d, base, new Set([id]), [{ from, to: target }]);
}
