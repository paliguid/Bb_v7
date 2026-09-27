import { CATALOG } from '../lib/catalog.js';
import { Circuit, pinKey } from '../lib/circuit.js';
import { formatValue } from '../lib/units.js';
import { CATALOG_FOOTPRINTS, FOOTPRINTS, footprintBounds } from './footprints.js';
import { cloneDoc, makePart, nextRef } from './model.js';
import { snapTo } from './geometry.js';

function valueOf(part) {
  const p = part.props ?? {};
  switch (part.type) {
    case 'resistor': return formatValue(p.resistance, 'Ω');
    case 'capacitor': return formatValue(p.capacitance, 'F');
    case 'potentiometer': return formatValue(p.resistance, 'Ω');
    case 'battery': case 'supply': return p.voltage != null ? formatValue(p.voltage, 'V') : '';
    case 'led': return p.color ?? '';
    case 'transistor': return '2N2222';
    case 'diode': return '1N4148';
    default: return '';
  }
}

/**
 * Reads a breadboard document and returns what a PCB needs to know:
 * which parts to build and which pins must be joined (the netlist).
 */
export function extractNetlist(bbDoc) {
  const circuit = new Circuit(bbDoc.parts, bbDoc.wires);
  const parts = [];
  const byNet = new Map();

  for (const part of bbDoc.parts) {
    const map = CATALOG_FOOTPRINTS[part.type];
    if (!map) continue;
    parts.push({ srcId: part.id, type: part.type, fp: map.fp, prefix: map.prefix, value: valueOf(part), map: map.map });
    for (const pin of CATALOG[part.type].pins) {
      const net = circuit.keyToNet.get(pinKey(part.id, pin.name));
      if (net == null) continue;
      if (!byNet.has(net)) byNet.set(net, []);
      byNet.get(net).push({ srcId: part.id, pin: pin.name });
    }
  }
  // a "ground" symbol in the circuit names its net GND
  const groundNets = new Set();
  for (const part of bbDoc.parts) {
    if (part.type !== 'ground') continue;
    const net = circuit.keyToNet.get(pinKey(part.id, 'gnd'));
    if (net != null) groundNets.add(net);
  }

  const source = bbDoc.parts.find((p) => CATALOG[p.type]?.groundPin);
  const posNet = source ? circuit.keyToNet.get(pinKey(source.id, source.type === 'funcgen' ? 'out' : 'pos')) : null;
  const gndNet = source ? circuit.keyToNet.get(pinKey(source.id, CATALOG[source.type].groundPin)) : null;

  const nets = [];
  let k = 1;
  for (const [id, pins] of byNet) {
    if (pins.length < 2) continue;
    let name;
    if (groundNets.has(id) || id === gndNet) name = 'GND';
    else if (id === posNet) name = 'VCC';
    else name = `N${k++}`;
    nets.push({ name, pins });
  }
  return { parts, nets };
}

/** Pack new parts in rows so the imported board starts out tidy. */
function shelfPlace(doc, fresh, gridSize) {
  const items = fresh.map((part) => {
    const b = footprintBounds(FOOTPRINTS[part.fp]);
    return { part, b, w: b.w + 3, h: b.h + 4 };
  }).sort((p, q) => q.h - p.h);
  const area = items.reduce((s, it) => s + it.w * it.h, 0);
  const maxW = Math.max(doc.board.w - 8, Math.sqrt(area) * 1.5, 30);
  let x = 4, y = 4, rowH = 0, right = 0;
  for (const it of items) {
    if (x + it.w > maxW + 4 && x > 4) { x = 4; y += rowH; rowH = 0; }
    const cx = x + it.w / 2, cy = y + it.h / 2;
    it.part.x = snapTo(cx - (it.b.x0 + it.b.x1) / 2, gridSize);
    it.part.y = snapTo(cy - (it.b.y0 + it.b.y1) / 2, gridSize);
    x += it.w; rowH = Math.max(rowH, it.h); right = Math.max(right, x);
  }
  return { right: right + 1, bottom: y + rowH + 1 };
}

/**
 * Merge a breadboard netlist into a PCB document. Parts that were imported
 * before (matched by srcId) keep their placement and routing; only the netlist
 * is refreshed, so you can keep editing the circuit and re-sync.
 */
export function applyImport(pcb, imp) {
  const doc = cloneDoc(pcb);
  const idFor = new Map(doc.parts.filter((p) => p.srcId).map((p) => [p.srcId, p.id]));
  const fresh = [];
  for (const ip of imp.parts) {
    if (idFor.has(ip.srcId)) continue;
    const part = makePart(doc, ip.fp, 0, 0, { prefix: ip.prefix, srcId: ip.srcId, value: ip.value });
    doc.parts.push(part);
    idFor.set(ip.srcId, part.id);
    fresh.push(part);
  }
  const wasEmpty = fresh.length === doc.parts.length;
  if (fresh.length) {
    const { right, bottom } = shelfPlace(doc, fresh, doc.grid.size);
    if (wasEmpty) {
      doc.board.w = Math.max(40, Math.ceil(right / 5) * 5);
      doc.board.h = Math.max(30, Math.ceil(bottom / 5) * 5);
    }
  }
  const mapOf = new Map(imp.parts.map((p) => [p.srcId, p.map]));
  const partById = new Map(doc.parts.map((p) => [p.id, p]));
  const nets = [];
  for (const net of imp.nets) {
    const pads = [];
    for (const { srcId, pin } of net.pins) {
      const partId = idFor.get(srcId);
      const part = partById.get(partId);
      if (!part) continue;
      const pad = mapOf.get(srcId)?.[pin] ?? pin;
      if (FOOTPRINTS[part.fp].pads.some((p) => p.n === pad)) pads.push({ part: partId, pad });
    }
    if (pads.length >= 2) nets.push({ name: net.name, pads });
  }
  doc.netlist = { nets, source: 'breadboard' };
  for (const n of nets) {
    if ((n.name === 'VCC' || n.name === 'GND') && doc.netWidths[n.name] == null) doc.netWidths[n.name] = 0.8;
  }
  doc.parts.forEach((p) => { if (!p.ref) p.ref = nextRef(doc, FOOTPRINTS[p.fp].prefix); });
  return doc;
}
