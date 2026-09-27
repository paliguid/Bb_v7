import { FOOTPRINTS } from './footprints.js';
import { rotPoint, round6 } from './geometry.js';

let counter = 0;
export const pid = (prefix) => `${prefix}${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}`;

export const DEFAULT_RULES = {
  clearance: 0.3,       // minimum gap between copper of different nets
  minWidth: 0.25,       // minimum track width
  minAnnular: 0.15,     // minimum copper ring around a drill
  edgeClearance: 0.5,   // copper to board edge
  trackWidth: 0.5,      // default width for new tracks
  viaDia: 0.9,
  viaDrill: 0.5,
  maskExpansion: 0.1,   // solder-mask opening margin around pads
};

export const RULE_PRESETS = {
  'Home etch / hobby': { clearance: 0.4, minWidth: 0.4, minAnnular: 0.25, edgeClearance: 0.6, trackWidth: 0.6, viaDia: 1.2, viaDrill: 0.7, maskExpansion: 0.1 },
  'Standard fab': { ...DEFAULT_RULES },
  'Fine pitch fab': { clearance: 0.15, minWidth: 0.15, minAnnular: 0.13, edgeClearance: 0.3, trackWidth: 0.25, viaDia: 0.6, viaDrill: 0.3, maskExpansion: 0.05 },
};

export const TRACK_WIDTHS = [0.25, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2, 3];
export const GRID_SIZES = [0.1, 0.25, 0.5, 1.0, 1.27, 2.54];

export function newPcb() {
  return {
    version: 1,
    board: { w: 60, h: 40, r: 2 },
    rules: { ...DEFAULT_RULES },
    grid: { size: 1.27, snap: true, snapPads: true },
    parts: [],
    tracks: [],
    vias: [],
    texts: [],
    netlist: null,      // { nets: [{ name, pads: [{ part, pad }] }] }  — the intended connections
    netWidths: {},      // per-net track width override
  };
}

export const cloneDoc = (doc) => structuredClone(doc);

export function deserializePcb(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.parts)) throw new Error('Not a BreadBai PCB file');
  const base = newPcb();
  return {
    ...base, ...raw,
    board: { ...base.board, ...raw.board },
    rules: { ...base.rules, ...raw.rules },
    grid: { ...base.grid, ...raw.grid },
    parts: raw.parts.filter((p) => FOOTPRINTS[p.fp]),
    tracks: raw.tracks ?? [], vias: raw.vias ?? [], texts: raw.texts ?? [],
    netWidths: raw.netWidths ?? {},
  };
}
export const serializePcb = (doc) => JSON.stringify(doc, null, 2);

/** World position of a footprint-local point. */
export function toWorld(part, p) {
  const m = part.side === 'bottom' ? { x: -p.x, y: p.y } : p;
  const r = rotPoint(m, part.rot ?? 0);
  return { x: round6(part.x + r.x), y: round6(part.y + r.y) };
}

export function partPads(part) {
  const fp = FOOTPRINTS[part.fp];
  if (!fp) return [];
  const swap = Math.round(part.rot ?? 0) % 180 !== 0;
  return fp.pads.map((pd) => {
    const w = toWorld(part, pd);
    return {
      id: `${part.id}#${pd.n}`, partId: part.id, ref: part.ref, n: pd.n,
      x: w.x, y: w.y, shape: pd.shape,
      w: swap ? pd.h : pd.w, h: swap ? pd.w : pd.h, drill: pd.drill,
    };
  });
}

export function nextRef(doc, prefix) {
  const used = new Set(doc.parts.map((p) => p.ref));
  for (let i = 1; ; i++) if (!used.has(prefix + i)) return prefix + i;
}

export function makePart(doc, fpId, x, y, extra = {}) {
  const fp = FOOTPRINTS[fpId];
  return {
    id: pid('p'), fp: fpId, ref: nextRef(doc, extra.prefix ?? fp.prefix), value: '',
    x, y, rot: 0, side: 'top', locked: false, ...extra,
  };
}

export const findObject = (doc, id) =>
  doc.parts.find((o) => o.id === id) ?? doc.tracks.find((o) => o.id === id)
  ?? doc.vias.find((o) => o.id === id) ?? doc.texts.find((o) => o.id === id) ?? null;

export const kindOf = (doc, id) =>
  doc.parts.some((o) => o.id === id) ? 'part'
    : doc.tracks.some((o) => o.id === id) ? 'track'
      : doc.vias.some((o) => o.id === id) ? 'via'
        : doc.texts.some((o) => o.id === id) ? 'text' : null;

/** Pad lookup by { part, pad } as stored in the netlist. */
export function padIndex(doc) {
  const map = new Map();
  for (const part of doc.parts) for (const p of partPads(part)) map.set(`${part.id}#${p.n}`, p);
  return map;
}
