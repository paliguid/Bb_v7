import { bbox, bboxOverlap, dist, edgeGap, gap } from './geometry.js';
import { partPads } from './model.js';

/**
 * Copper connectivity + design rule checking.
 *
 * Connectivity is derived purely from geometry: two copper items are on the
 * same node if they overlap on a shared layer. Through-hole pads and vias are
 * on both layers. That "computed" connectivity is then compared with the
 * intended netlist (if there is one) to find opens and shorts.
 */

const TOUCH = 1e-4;

export function padShape(p) {
  if (p.shape === 'rect') return { t: 'r', cx: p.x, cy: p.y, hw: p.w / 2, hh: p.h / 2 };
  const long = Math.max(p.w, p.h), short = Math.min(p.w, p.h);
  const half = (long - short) / 2;
  const dx = p.w >= p.h ? half : 0, dy = p.w >= p.h ? 0 : half;
  return { t: 's', a: { x: p.x - dx, y: p.y - dy }, b: { x: p.x + dx, y: p.y + dy }, r: short / 2 };
}
export const trackShape = (t) => ({ t: 's', a: t.a, b: t.b, r: t.width / 2 });
export const viaShape = (v) => ({ t: 's', a: { x: v.x, y: v.y }, b: { x: v.x, y: v.y }, r: v.dia / 2 });

export function copperItems(doc) {
  const items = [];
  for (const part of doc.parts) {
    for (const p of partPads(part)) {
      items.push({ id: p.id, kind: 'pad', layers: ['top', 'bottom'], shape: padShape(p), x: p.x, y: p.y, pad: p, partId: part.id });
    }
  }
  for (const v of doc.vias) items.push({ id: v.id, kind: 'via', layers: ['top', 'bottom'], shape: viaShape(v), x: v.x, y: v.y, via: v });
  for (const t of doc.tracks) {
    items.push({ id: t.id, kind: 'track', layers: [t.layer], shape: trackShape(t), x: (t.a.x + t.b.x) / 2, y: (t.a.y + t.b.y) / 2, track: t });
  }
  for (const it of items) it.box = bbox(it.shape);
  return items;
}

const shareLayer = (a, b) => a.layers.some((l) => b.layers.includes(l));

class DSU {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(a, b) { this.p[this.find(a)] = this.find(b); }
}

export function analyze(doc) {
  const items = copperItems(doc);
  const n = items.length;
  const dsu = new DSU(n);
  const { rules } = doc;
  const reach = Math.max(rules.clearance, 0.01);

  // ---- 1. connectivity -----------------------------------------------------
  const near = []; // pairs whose bounding boxes are within clearance range, on a shared layer
  for (let i = 0; i < n; i++) {
    const a = items[i];
    const boxA = { x0: a.box.x0 - reach, y0: a.box.y0 - reach, x1: a.box.x1 + reach, y1: a.box.y1 + reach };
    for (let j = i + 1; j < n; j++) {
      const b = items[j];
      if (!shareLayer(a, b) || !bboxOverlap(boxA, b.box)) continue;
      const g = gap(a.shape, b.shape);
      near.push([i, j, g]);
      if (g <= TOUCH) dsu.union(i, j);
    }
  }
  const root = items.map((_, i) => dsu.find(i));
  const clusterOf = new Map(items.map((it, i) => [it.id, root[i]]));

  // ---- 2. intended nets -> pads -> clusters --------------------------------
  const padNet = new Map(); // padId -> net name
  const nets = [];
  if (doc.netlist) {
    for (const net of doc.netlist.nets) {
      const pads = [];
      for (const ref of net.pads) {
        const id = `${ref.part}#${ref.pad}`;
        const item = items.find((it) => it.id === id);
        if (!item) continue;
        padNet.set(id, net.name);
        pads.push({ id, x: item.x, y: item.y, cluster: clusterOf.get(id), ref: item.pad.ref, n: item.pad.n });
      }
      nets.push({ name: net.name, pads });
    }
  }

  const clusterNets = new Map(); // cluster -> Set(net names)
  for (const it of items) {
    const name = padNet.get(it.id);
    if (!name) continue;
    const c = clusterOf.get(it.id);
    if (!clusterNets.has(c)) clusterNets.set(c, new Set());
    clusterNets.get(c).add(name);
  }

  // net name for any copper item: the intended net of its cluster (if unambiguous)
  const itemNet = new Map();
  for (const it of items) {
    const set = clusterNets.get(clusterOf.get(it.id));
    itemNet.set(it.id, set && set.size === 1 ? [...set][0] : set && set.size > 1 ? '(short)' : null);
  }

  // ---- 3. ratsnest: minimum spanning tree over the clusters of each net -----
  const airwires = [];
  const netStatus = [];
  for (const net of nets) {
    const byCluster = new Map();
    for (const p of net.pads) {
      if (!byCluster.has(p.cluster)) byCluster.set(p.cluster, []);
      byCluster.get(p.cluster).push(p);
    }
    const groups = [...byCluster.values()];
    if (groups.length > 1) {
      const inTree = new Set([0]);
      while (inTree.size < groups.length) {
        let best = null;
        for (const i of inTree) {
          for (let j = 0; j < groups.length; j++) {
            if (inTree.has(j)) continue;
            for (const pa of groups[i]) for (const pb of groups[j]) {
              const d = dist(pa, pb);
              if (!best || d < best.d) best = { d, j, pa, pb };
            }
          }
        }
        inTree.add(best.j);
        airwires.push({ net: net.name, a: { x: best.pa.x, y: best.pa.y }, b: { x: best.pb.x, y: best.pb.y }, padA: best.pa.id, padB: best.pb.id, length: best.d });
      }
    }
    netStatus.push({ name: net.name, pads: net.pads.length, islands: groups.length, routed: groups.length <= 1, width: doc.netWidths?.[net.name] ?? null });
  }

  // ---- 4. design rule check -------------------------------------------------
  const drc = [];
  const add = (rule, level, x, y, msg, ids = []) =>
    drc.push({ id: `${rule}:${ids.join('|') || `${x.toFixed(2)},${y.toFixed(2)}`}`, rule, level, x, y, msg, ids });

  // shorts between intended nets
  for (const [c, set] of clusterNets) {
    if (set.size < 2) continue;
    const list = [...set];
    const at = items.find((it) => clusterOf.get(it.id) === c && padNet.get(it.id) === list[1]) ?? items[0];
    add('short', 'error', at.x, at.y, `Short circuit: ${list.join(' and ')} are joined by copper`, [at.id]);
  }
  // opens
  for (const w of airwires) {
    add('unrouted', 'error', (w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2, `Net ${w.net} is not fully connected (${w.length.toFixed(1)} mm to go)`, [w.padA, w.padB]);
  }
  // clearance between different copper nodes
  for (const [i, j, g] of near) {
    if (root[i] === root[j]) continue;
    if (g < rules.clearance - TOUCH) {
      const a = items[i], b = items[j];
      add('clearance', 'error', (a.x + b.x) / 2, (a.y + b.y) / 2,
        `Clearance ${Math.max(g, 0).toFixed(2)} mm is below the ${rules.clearance} mm rule`, [a.id, b.id]);
    }
  }
  for (const it of items) {
    if (it.kind === 'track') {
      const t = it.track;
      if (t.width < rules.minWidth - TOUCH) add('min-width', 'error', it.x, it.y, `Track ${t.width} mm is narrower than the ${rules.minWidth} mm rule`, [it.id]);
      if (dist(t.a, t.b) < 1e-6) add('zero-length', 'warn', it.x, it.y, 'Zero-length track', [it.id]);
    } else {
      const ring = it.kind === 'via'
        ? (it.via.dia - it.via.drill) / 2
        : (Math.min(it.pad.w, it.pad.h) - it.pad.drill) / 2;
      if (ring < rules.minAnnular - TOUCH) {
        add('annular', 'error', it.x, it.y, `Copper ring ${ring.toFixed(2)} mm is below the ${rules.minAnnular} mm rule`, [it.id]);
      }
    }
    const room = edgeGap(it.shape, doc.board);
    if (room < rules.edgeClearance - TOUCH) {
      add('edge', 'error', it.x, it.y, room < 0 ? 'Copper extends past the board edge' : `Only ${room.toFixed(2)} mm from the board edge (rule ${rules.edgeClearance} mm)`, [it.id]);
    }
  }
  // dangling track ends (a track end that touches nothing else)
  for (const it of items) {
    if (it.kind !== 'track') continue;
    for (const end of [it.track.a, it.track.b]) {
      const probe = { t: 's', a: end, b: end, r: it.track.width / 2 };
      const touching = items.some((o) => o !== it && shareLayer(it, o) && bboxOverlap(bbox(probe, TOUCH), o.box) && gap(probe, o.shape) <= TOUCH);
      if (!touching) {
        add('dangling', 'warn', end.x, end.y, 'Track end is not connected to anything', [it.id]);
        break;
      }
    }
  }

  const errors = drc.filter((d) => d.level === 'error').length;
  const trackLength = doc.tracks.reduce((s, t) => s + dist(t.a, t.b), 0);
  return {
    items, clusterOf, itemNet, nets: netStatus, airwires, drc,
    stats: {
      errors, warnings: drc.length - errors,
      unrouted: airwires.length,
      shorts: drc.filter((d) => d.rule === 'short').length,
      trackLength,
    },
  };
}
