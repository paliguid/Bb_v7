/**
 * Through-hole footprint library. Units are mm, origin at the part's centre.
 * Pad "n" is the pad number/name; catalog parts map their pins onto these.
 */
const pad = (n, x, y, o = {}) => ({
  n, x, y,
  shape: o.shape ?? 'round',
  w: o.w ?? 1.8,
  h: o.h ?? o.w ?? 1.8,
  drill: o.drill ?? 0.9,
});
const line = (x1, y1, x2, y2) => ({ t: 'line', x1, y1, x2, y2 });
const box = (w, h, x = 0, y = 0) => ({ t: 'rect', x, y, w, h });
const ring = (r, x = 0, y = 0) => ({ t: 'circle', x, y, r });

const axial = (pitch, bodyLen, bodyH, names = ['a', 'b']) => ({
  pads: [pad(names[0], -pitch / 2, 0, { shape: 'rect' }), pad(names[1], pitch / 2, 0)],
  silk: [box(bodyLen, bodyH), line(-pitch / 2 + 1.1, 0, -bodyLen / 2, 0), line(pitch / 2 - 1.1, 0, bodyLen / 2, 0)],
});

const header = (n) => {
  const x0 = -((n - 1) * 2.54) / 2;
  const pads = Array.from({ length: n }, (_, i) => pad(String(i + 1), x0 + i * 2.54, 0, { w: 1.7, drill: 1.0, shape: i === 0 ? 'rect' : 'round' }));
  return { pads, silk: [box(n * 2.54, 2.54)] };
};

const dip = (n) => {
  const half = n / 2;
  const y0 = -((half - 1) * 2.54) / 2;
  const pads = [];
  for (let i = 0; i < half; i++) pads.push(pad(String(i + 1), -3.81, y0 + i * 2.54, { w: 1.6, h: 1.6, drill: 0.8, shape: i === 0 ? 'rect' : 'round' }));
  for (let i = 0; i < half; i++) pads.push(pad(String(half + i + 1), 3.81, -y0 - i * 2.54, { w: 1.6, h: 1.6, drill: 0.8 }));
  const hh = (half * 2.54) / 2;
  return { pads, silk: [box(5.6, half * 2.54), line(-1, -hh, 1, -hh)] };
};

const seg7 = () => {
  const pads = [];
  for (let i = 0; i < 5; i++) pads.push(pad(String(i + 1), -5.08 + i * 2.54, 7.62, { w: 1.6, h: 1.6, drill: 0.8, shape: i === 0 ? 'rect' : 'round' }));
  for (let i = 0; i < 5; i++) pads.push(pad(String(i + 6), 5.08 - i * 2.54, -7.62, { w: 1.6, h: 1.6, drill: 0.8 }));
  return { pads, silk: [box(12.7, 19)] };
};

export const FOOTPRINTS = {
  'diode-7.62': {
    name: 'Diode DO-35 (7.62 mm, band = cathode)', cat: 'Semiconductor', prefix: 'D', ...axial(7.62, 4.2, 2.0, ['a', 'k']),
    silk: [...axial(7.62, 4.2, 2.0, ['a', 'k']).silk, line(1.2, -1, 1.2, 1)],
  },
  'axial-7.62': { name: 'Axial 7.62 mm (¼ W resistor, upright)', cat: 'Passive', prefix: 'R', ...axial(7.62, 4.2, 2.0) },
  'axial-10.16': { name: 'Axial 10.16 mm (¼ W resistor)', cat: 'Passive', prefix: 'R', ...axial(10.16, 6.4, 2.4) },
  'axial-12.7': { name: 'Axial 12.7 mm (½ W resistor)', cat: 'Passive', prefix: 'R', ...axial(12.7, 9.0, 3.2) },
  'radial-2.54': {
    name: 'Radial 2.54 mm (ceramic disc)', cat: 'Passive', prefix: 'C',
    pads: [pad('pos', -1.27, 0, { shape: 'rect' }), pad('neg', 1.27, 0)], silk: [ring(3.0)],
  },
  'radial-5.0': {
    name: 'Radial 5.0 mm (electrolytic Ø6.3)', cat: 'Passive', prefix: 'C',
    pads: [pad('pos', -2.5, 0, { shape: 'rect' }), pad('neg', 2.5, 0)], silk: [ring(3.4), line(-3.0, -2.6, -3.0, 2.6)],
  },
  'led-5mm': {
    name: 'LED 5 mm', cat: 'Semiconductor', prefix: 'D',
    pads: [pad('a', -1.27, 0, { shape: 'rect' }), pad('k', 1.27, 0)], silk: [ring(2.9), line(2.9, -1.5, 2.9, 1.5)],
  },
  'to92': {
    name: 'TO-92 (NPN 2N2222)', cat: 'Semiconductor', prefix: 'Q',
    pads: [pad('e', -2.54, 0, { w: 1.6, drill: 0.8 }), pad('b', 0, 0, { w: 1.6, drill: 0.8 }), pad('c', 2.54, 0, { w: 1.6, drill: 0.8 })],
    silk: [ring(2.6, 0, 0), line(-2.6, 1.6, 2.6, 1.6)],
  },
  'pot-trim': {
    name: 'Trimmer potentiometer (3 pin)', cat: 'Control', prefix: 'RV',
    pads: [pad('t1', -2.54, 0), pad('w', 0, 0), pad('t2', 2.54, 0)], silk: [box(9.5, 4.8)],
  },
  'ldr-5mm': {
    name: 'LDR 5 mm', cat: 'Control', prefix: 'LDR',
    pads: [pad('a', -2.54, 0), pad('b', 2.54, 0)], silk: [ring(2.6)],
  },
  'tact-6mm': {
    name: 'Tactile switch 6×6 mm', cat: 'Control', prefix: 'SW',
    pads: [pad('p1', -3.25, -2.25), pad('p2', -3.25, 2.25), pad('p3', 3.25, -2.25), pad('p4', 3.25, 2.25)], silk: [box(6, 6)],
  },
  'toggle-3': {
    name: 'Toggle switch (3 pin, 5.08 mm)', cat: 'Control', prefix: 'SW',
    pads: [pad('a', -5.08, 0, { w: 2.2, drill: 1.2 }), pad('com', 0, 0, { w: 2.2, drill: 1.2 }), pad('b', 5.08, 0, { w: 2.2, drill: 1.2 })],
    silk: [box(13, 5)],
  },
  'buzzer-12mm': {
    name: 'Piezo buzzer Ø12 mm', cat: 'Output', prefix: 'BZ',
    pads: [pad('pos', -3.8, 0, { shape: 'rect', w: 2.2, drill: 1.1 }), pad('neg', 3.8, 0, { w: 2.2, drill: 1.1 })], silk: [ring(6.2)],
  },
  'seg7-10': { name: '7-segment display (10 pin)', cat: 'Output', prefix: 'DS', ...seg7() },
  'header-1x2': { name: 'Pin header 1×2', cat: 'Connector', prefix: 'J', ...header(2) },
  'header-1x3': { name: 'Pin header 1×3', cat: 'Connector', prefix: 'J', ...header(3) },
  'header-1x4': { name: 'Pin header 1×4', cat: 'Connector', prefix: 'J', ...header(4) },
  'terminal-2': {
    name: 'Screw terminal 2 pin (5.08 mm)', cat: 'Connector', prefix: 'J',
    pads: [pad('1', -2.54, 0, { shape: 'rect', w: 2.6, drill: 1.3 }), pad('2', 2.54, 0, { w: 2.6, drill: 1.3 })], silk: [box(10.2, 7.6)],
  },
  'dip-8': { name: 'DIP-8 (IC socket)', cat: 'IC', prefix: 'U', ...dip(8) },
  'dip-14': { name: 'DIP-14 (IC socket)', cat: 'IC', prefix: 'U', ...dip(14) },
  'dip-16': { name: 'DIP-16 (IC socket)', cat: 'IC', prefix: 'U', ...dip(16) },
  'mount-m3': {
    name: 'Mounting hole M3', cat: 'Mechanical', prefix: 'H',
    pads: [pad('1', 0, 0, { w: 6, drill: 3.2 })], silk: [ring(3.6)],
  },
  'testpoint': {
    name: 'Test point', cat: 'Mechanical', prefix: 'TP',
    pads: [pad('1', 0, 0, { w: 2.0, drill: 1.0 })], silk: [],
  },
};

/** Which footprint each simulator part uses, and how its pins map onto pads. */
const two = { pos: '1', neg: '2' };
export const CATALOG_FOOTPRINTS = {
  resistor: { fp: 'axial-10.16', map: {} },
  diode: { fp: 'diode-7.62', map: {} },
  led: { fp: 'led-5mm', map: {} },
  capacitor: { fp: 'radial-5.0', map: {} },
  transistor: { fp: 'to92', map: {} },
  potentiometer: { fp: 'pot-trim', map: {} },
  ldr: { fp: 'ldr-5mm', map: {} },
  pushbutton: { fp: 'tact-6mm', map: {} },
  toggle: { fp: 'toggle-3', map: {} },
  buzzer: { fp: 'buzzer-12mm', map: {} },
  seg7: { fp: 'seg7-10', map: { e: '1', d: '2', com1: '3', c: '4', dp: '5', g: '6', f: '7', com2: '8', a: '9', b: '10' } },
  motor: { fp: 'header-1x2', map: two, prefix: 'M' },
  battery: { fp: 'terminal-2', map: two, prefix: 'BT' },
  supply: { fp: 'terminal-2', map: two, prefix: 'PS' },
  funcgen: { fp: 'header-1x2', map: { out: '1', gnd: '2' }, prefix: 'G' },
  voltmeter: { fp: 'header-1x2', map: two, prefix: 'TP' },
  ammeter: { fp: 'header-1x2', map: two, prefix: 'TP' },
};

export const footprintCategories = () => {
  const cats = {};
  for (const [id, fp] of Object.entries(FOOTPRINTS)) (cats[fp.cat] ??= []).push({ id, ...fp });
  return cats;
};

/** Extent of pads + silkscreen, used for placement, hit testing and the courtyard. */
export function footprintBounds(fp) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of fp.pads) { add(p.x - p.w / 2, p.y - p.h / 2); add(p.x + p.w / 2, p.y + p.h / 2); }
  for (const s of fp.silk) {
    if (s.t === 'rect') { add(s.x - s.w / 2, s.y - s.h / 2); add(s.x + s.w / 2, s.y + s.h / 2); }
    else if (s.t === 'circle') { add(s.x - s.r, s.y - s.r); add(s.x + s.r, s.y + s.r); }
    else { add(s.x1, s.y1); add(s.x2, s.y2); }
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
