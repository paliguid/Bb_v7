import { D2R } from './math3.js';
import * as K from './meshkit.js';
import { materialOf, materialOptions } from './materials.js';

/**
 * The mechanical part catalog. Units for user-facing parameters: mm, degrees, kg, N, N·m, rpm.
 * Physics functions return SI (kg, kg·m², m). Meshes are in mm with the rotation axis along +Z.
 */
const P = (key, label, def, o = {}) => ({ key, label, def, type: 'number', ...o });
const N = (key, label, def, unit, min, max, step) => P(key, label, def, { unit, min, max, step });
const B = (key, label, def) => P(key, label, def, { type: 'bool' });
const S = (key, label, def, options) => P(key, label, def, { type: 'select', options: options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)) });
const MAT = (def = 'steel') => P('material', 'Material', def, { type: 'material', options: materialOptions() });

const MOUNT = [P('shaft', 'On shaft', '', { type: 'part', of: ['shaft'] }), N('axial', 'Axial offset', 0, 'mm', -1000, 1000, 1), N('phase', 'Phase', 0, '°', -360, 360, 1)];
const PI = Math.PI;
const m = (mm) => mm / 1000;

const discJ = (rho, ro, ri, w) => { const M = rho * PI * (ro * ro - ri * ri) * w; return { M, J: 0.5 * M * (ro * ro + ri * ri) }; };

export const MOTOR_PRESETS = {
  'Hobby DC motor (6 V)': { V: 6, R: 2.2, Kt: 0.0045, Jr: 1.5e-6, tauNL: 0.0006, Rth: 8, Cth: 12, ratedI: 1.2, bodyDia: 28, bodyLen: 38 },
  'Micro gearmotor motor (N20, 6 V)': { V: 6, R: 10, Kt: 0.0025, Jr: 2e-7, tauNL: 0.0001, Rth: 25, Cth: 3, ratedI: 0.25, bodyDia: 12, bodyLen: 15 },
  'Cordless drill motor (12 V)': { V: 12, R: 0.45, Kt: 0.011, Jr: 2.5e-5, tauNL: 0.004, Rth: 2.5, Cth: 120, ratedI: 12, bodyDia: 36, bodyLen: 60 },
  'Wiper motor (12 V)': { V: 12, R: 1.0, Kt: 0.05, Jr: 2e-4, tauNL: 0.02, Rth: 1.8, Cth: 300, ratedI: 6, bodyDia: 60, bodyLen: 80 },
  'RC brushed motor (540, 7.2 V)': { V: 7.2, R: 0.25, Kt: 0.0032, Jr: 8e-6, tauNL: 0.002, Rth: 3, Cth: 60, ratedI: 15, bodyDia: 36, bodyLen: 55 },
  'E-scooter hub motor (36 V)': { V: 36, R: 0.12, Kt: 0.09, Jr: 0.004, tauNL: 0.15, Rth: 0.8, Cth: 1500, ratedI: 15, bodyDia: 100, bodyLen: 50 },
  'EV traction motor (48 V)': { V: 48, R: 0.08, Kt: 0.2, Jr: 0.02, tauNL: 0.5, Rth: 0.25, Cth: 8000, ratedI: 250, bodyDia: 180, bodyLen: 200 },
  'Breadboard circuit motor': { V: 9, R: 25, Kt: 0.012, Jr: 2.2e-6, tauNL: 2e-5, Rth: 20, Cth: 8, ratedI: 0.3, bodyDia: 24, bodyLen: 30 },
};

const bodyMesh = (dia, len, back = true) => K.merge([
  K.transformMesh(K.cylinder(dia / 2, len, 40), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, back ? -len / 2 - 1 : len / 2, 1]),
  K.transformMesh(K.cylinder(dia * 0.18, 4, 24), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1]),
]);

export const PART_TYPES = {
  /* ------------------------------------------------------------- structure */
  shaft: {
    name: 'Shaft', cat: 'Structure', mount: 'free', color: 0xb8bec6,
    hint: 'A rotating axis. Everything that spins sits on a shaft. Tick “Locked” to hold it still (for a fixed ring gear or a brake anchor).',
    params: [
      N('length', 'Length', 120, 'mm', 10, 800, 1), N('dia', 'Diameter', 8, 'mm', 2, 80, 0.5), MAT('steel'),
      S('bearing', 'Bearings', 'ball', [{ value: 'ball', label: 'Ball bearings (μ 0.002)' }, { value: 'sleeve', label: 'Oiled sleeve (μ 0.02)' }, { value: 'bushing', label: 'Dry bushing (μ 0.08)' }, { value: 'none', label: 'Frictionless (ideal)' }]),
      B('locked', 'Locked (fixed)', false), N('angle0', 'Start angle', 0, '°', -360, 360, 1), N('rpm0', 'Start speed', 0, 'rpm', -20000, 20000, 10),
      P('carrier', 'Rides on', '', { type: 'part', of: ['slider', 'vehicle'] }),
    ],
    mass: (p) => materialOf(p.material).rho * PI * m(p.dia / 2) ** 2 * m(p.length),
    inertia: (p) => 0.5 * materialOf(p.material).rho * PI * m(p.dia / 2) ** 4 * m(p.length),
    mesh: (p) => K.merge([K.cylinder(p.dia / 2, p.length, 24), K.transformMesh(K.box(Math.max(1.2, p.dia * 0.22), Math.max(1.2, p.dia * 0.22), p.length), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.dia / 2, 0, 0, 1])]),
  },
  frame: {
    name: 'Frame block', cat: 'Structure', mount: 'free', color: 0x505862,
    hint: 'A fixed block (baseplate, bracket, housing). Purely visual.',
    params: [N('w', 'Width (X)', 200, 'mm', 1, 2000, 1), N('h', 'Height (Y)', 10, 'mm', 1, 2000, 1), N('d', 'Depth (Z)', 100, 'mm', 1, 2000, 1), MAT('aluminum')],
    mass: (p) => materialOf(p.material).rho * m(p.w) * m(p.h) * m(p.d),
    mesh: (p) => K.box(p.w, p.h, p.d),
  },

  /* ---------------------------------------------------------------- power */
  motor: {
    name: 'DC motor', cat: 'Power', mount: 'shaft', spins: false, color: 0x3f6fb5,
    hint: 'Brushed permanent-magnet motor: torque = Kt·current, back-EMF = Ke·speed. It heats up under load; watch the winding temperature.',
    params: [
      ...MOUNT,
      S('mode', 'Drive', 'voltage', [{ value: 'voltage', label: 'Voltage (supply × duty)' }, { value: 'circuit', label: 'From a circuit (Systems)' }, { value: 'servo', label: 'Speed servo (PI, torque limited)' }, { value: 'torque', label: 'Torque command' }]),
      N('V', 'Supply voltage', 6, 'V', 0, 100, 0.5), N('duty', 'Duty / throttle', 1, '', -1, 1, 0.01),
      N('R', 'Winding resistance', 2.2, 'Ω', 0.005, 500, 0.01), N('Kt', 'Torque constant Kt', 0.0045, 'N·m/A', 0.0002, 1, 0.0001), N('Jr', 'Rotor inertia', 1.5e-6, 'kg·m²', 1e-8, 1, 1e-7),
      N('L', 'Inductance', 0, 'H', 0, 1, 0.0001), N('tauNL', 'Brush/bearing drag', 0.0006, 'N·m', 0, 5, 0.0001),
      N('Rth', 'Thermal resistance', 8, 'K/W', 0.05, 100, 0.1), N('Cth', 'Thermal mass', 12, 'J/K', 0.5, 20000, 1), N('ratedI', 'Rated current', 1.2, 'A', 0.01, 1000, 0.1),
      N('targetRpm', 'Servo target', 1000, 'rpm', -30000, 30000, 10), N('kp', 'Servo Kp', 0.01, 'N·m/(rad/s)', 0, 100, 0.001), N('ki', 'Servo Ki', 0.05, 'N·m/rad', 0, 1000, 0.01),
      N('maxTorque', 'Torque limit', 0.05, 'N·m', 0.0001, 1000, 0.001), N('torqueCmd', 'Torque command', 0, 'N·m', -1000, 1000, 0.001),
      N('bodyDia', 'Body diameter', 28, 'mm', 4, 300, 1), N('bodyLen', 'Body length', 38, 'mm', 4, 400, 1),
    ],
    presets: MOTOR_PRESETS, presetMap: (pr) => ({ V: pr.V, R: pr.R, Kt: pr.Kt, Jr: pr.Jr, tauNL: pr.tauNL, Rth: pr.Rth, Cth: pr.Cth, ratedI: pr.ratedI, bodyDia: pr.bodyDia, bodyLen: pr.bodyLen }),
    mass: (p) => 7800 * PI * m(p.bodyDia / 2) ** 2 * m(p.bodyLen) * 0.55,
    inertia: (p) => p.Jr,
    mesh: (p) => bodyMesh(p.bodyDia, p.bodyLen),
  },
  generator: {
    name: 'Generator', cat: 'Power', mount: 'shaft', spins: false, color: 0x3f8f6a,
    hint: 'Permanent-magnet generator into a resistive load: the load current brakes the shaft (torque = Kt·i). Try it under a wind rotor.',
    params: [
      ...MOUNT, N('Kt', 'Constant Ke = Kt', 0.02, 'V·s/rad', 0.0005, 2, 0.001), N('R', 'Winding resistance', 3, 'Ω', 0.01, 200, 0.1), N('loadR', 'Load resistance', 10, 'Ω', 0.1, 100000, 0.1),
      B('connected', 'Load connected', true), N('Jr', 'Rotor inertia', 4e-6, 'kg·m²', 1e-8, 1, 1e-7), N('bodyDia', 'Body diameter', 30, 'mm', 4, 300, 1), N('bodyLen', 'Body length', 40, 'mm', 4, 400, 1),
    ],
    mass: (p) => 7800 * PI * m(p.bodyDia / 2) ** 2 * m(p.bodyLen) * 0.55,
    inertia: (p) => p.Jr,
    mesh: (p) => bodyMesh(p.bodyDia, p.bodyLen),
  },
  handcrank: {
    name: 'Hand crank / torque source', cat: 'Power', mount: 'shaft', spins: true, color: 0xd98858,
    hint: 'A constant driving torque (a person turning a crank, a spring drive, an engine at fixed load). Set the torque, optionally limited to a maximum speed.',
    params: [...MOUNT, N('torque', 'Driving torque', 0.2, 'N·m', -500, 500, 0.01), N('maxRpm', 'Speed limit (governor)', 0, 'rpm', 0, 50000, 10), N('armLen', 'Handle radius', 60, 'mm', 10, 300, 1)],
    mass: () => 0.1, inertia: (p) => 0.1 * m(p.armLen) ** 2 / 3,
    mesh: (p) => K.merge([K.transformMesh(K.box(p.armLen, 8, 6), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.armLen / 2, 0, 0, 1]), K.transformMesh(K.cylinder(6, 30, 16), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.armLen, 0, 12, 1])]),
  },

  /* --------------------------------------------------------- transmission */
  gear: {
    name: 'Spur gear', cat: 'Transmission', mount: 'shaft', spins: true, color: 0x9aa3ad,
    hint: 'Involute spur gear. Two gears mesh when their module and pressure angle match and the centre distance is m·(z₁+z₂)/2.',
    params: [
      ...MOUNT, N('module', 'Module', 1.5, 'mm', 0.3, 20, 0.05), N('teeth', 'Teeth', 20, '', 6, 240, 1), N('width', 'Face width', 8, 'mm', 1, 100, 0.5),
      N('pressure', 'Pressure angle', 20, '°', 14.5, 25, 0.5), B('internal', 'Internal (ring) gear', false), N('bore', 'Bore', 6, 'mm', 0, 60, 0.5), MAT('steel'),
    ],
    gear: true,
    mass(p) { return this.geom(p).M; },
    inertia(p) { return this.geom(p).J; },
    geom(p) {
      const rho = materialOf(p.material).rho, rp = p.module * p.teeth / 2;
      if (p.internal) { const ro = rp + 5.25 * p.module, ri = rp + 0.6 * p.module; return discJ(rho, m(ro), m(ri), m(p.width)); }
      const re = rp - 0.125 * p.module, a = discJ(rho, m(re), 0, m(p.width)), h = discJ(rho, m(p.bore / 2), 0, m(p.width));
      return { M: a.M - h.M, J: a.J - h.J };
    },
    mesh: (p) => (p.internal ? K.ringGear(p.module, p.teeth, p.width, p.pressure) : K.spurGear(p.module, p.teeth, p.width, p.pressure)),
  },
  bevel: {
    name: 'Bevel gear', cat: 'Transmission', mount: 'shaft', spins: true, color: 0xb0a070,
    hint: 'Bevel gears turn the drive through 90°. Axes must intersect; each gear sits at the other’s pitch radius from the apex.',
    params: [...MOUNT, N('module', 'Module', 1.5, 'mm', 0.3, 20, 0.05), N('teeth', 'Teeth', 20, '', 6, 240, 1), N('width', 'Face width', 8, 'mm', 1, 100, 0.5), N('pressure', 'Pressure angle', 20, '°', 14.5, 25, 0.5), MAT('brass')],
    gear: true, bevel: true,
    mass(p) { return this.geom(p).M; }, inertia(p) { return this.geom(p).J; },
    geom(p) { return discJ(materialOf(p.material).rho, m(p.module * p.teeth / 2 * 0.85), 0, m(p.width)); },
    mesh: (p) => K.extrude(K.gearOutline(p.module, p.teeth, p.pressure), -p.width / 2, p.width / 2, { star: true, taper: 0.7 }),
  },
  worm: {
    name: 'Worm', cat: 'Transmission', mount: 'shaft', spins: true, color: 0xc9a86a,
    hint: 'A screw that drives a gear: huge reduction in one stage, and often self-locking (the gear cannot drive the worm back).',
    params: [...MOUNT, N('starts', 'Starts', 1, '', 1, 4, 1), N('module', 'Module', 1.5, 'mm', 0.3, 20, 0.05), N('dia', 'Pitch diameter', 14, 'mm', 4, 80, 0.5), N('length', 'Length', 30, 'mm', 6, 120, 1), S('hand', 'Hand', 'right', ['right', 'left']), N('mu', 'Thread friction μ', 0.1, '', 0.01, 0.5, 0.01), MAT('steel')],
    mass: (p) => materialOf(p.material).rho * PI * m(p.dia / 2) ** 2 * m(p.length) * 0.9,
    inertia: (p) => 0.5 * materialOf(p.material).rho * PI * m(p.dia / 2) ** 4 * m(p.length) * 0.9,
    mesh(p) {
      const turns = Math.max(3, Math.round(p.length / (Math.PI * p.module)));
      const parts = [K.cylinder(p.dia / 2 - p.module, p.length, 24)];
      const path = Array.from({ length: turns * 12 + 1 }, (_, i) => { const t = i / (turns * 12), a = t * turns * PI * 2 * (p.hand === 'left' ? -1 : 1); return [(p.dia / 2) * Math.cos(a), (p.dia / 2) * Math.sin(a), -p.length / 2 + t * p.length]; });
      parts.push(K.sweepTube(path, p.module * 0.55, 6));
      return K.merge(parts);
    },
  },
  pulley: {
    name: 'Pulley / sprocket', cat: 'Transmission', mount: 'shaft', spins: true, color: 0x9a9aa8,
    hint: 'Belt or chain wheel. Connect two pulleys with a belt: speed ratio = diameter ratio. Timing pulleys never slip.',
    params: [...MOUNT, N('dia', 'Pitch diameter', 40, 'mm', 6, 400, 0.5), N('width', 'Width', 10, 'mm', 2, 80, 0.5), S('kind', 'Kind', 'v', [{ value: 'flat', label: 'Flat belt' }, { value: 'v', label: 'V-belt' }, { value: 'timing', label: 'Timing belt (GT2)' }, { value: 'chain', label: 'Chain sprocket' }]), N('bore', 'Bore', 6, 'mm', 0, 60, 0.5), MAT('aluminum')],
    mass(p) { return this.geom(p).M; }, inertia(p) { return this.geom(p).J; },
    geom(p) { const rho = materialOf(p.material).rho, a = discJ(rho, m(p.dia / 2) * 0.92, 0, m(p.width)), h = discJ(rho, m(p.bore / 2), 0, m(p.width)); return { M: a.M - h.M, J: a.J - h.J }; },
    mesh(p) {
      const r = p.dia / 2, w = p.width;
      if (p.kind === 'timing' || p.kind === 'chain') {
        const pitch = p.kind === 'timing' ? 2 : 12.7, z = Math.max(8, Math.round((PI * p.dia) / pitch));
        return K.merge([K.spurGear((pitch * z) / PI / z, z, w * 0.6, 20), K.transformMesh(K.cylinder(r * 0.98, 1.2, 40), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, w / 2 - 0.6, 1]), K.transformMesh(K.cylinder(r * 0.98, 1.2, 40), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -w / 2 + 0.6, 1])]);
      }
      if (p.kind === 'flat') return K.merge([K.cylinder(r, w, 48)]);
      const g = Math.min(w * 0.4, r * 0.3);
      return K.lathe([[0, -w / 2], [r + 1.5, -w / 2], [r + 1.5, -g / 2 - w * 0.12], [r - g, 0], [r + 1.5, g / 2 + w * 0.12], [r + 1.5, w / 2], [0, w / 2]], 48);
    },
  },
  drum: {
    name: 'Rope drum', cat: 'Transmission', mount: 'shaft', spins: true, color: 0xa88a5a,
    hint: 'Winds a rope that carries a weight or slider (winch, elevator, crane).',
    params: [...MOUNT, N('dia', 'Drum diameter', 40, 'mm', 6, 400, 0.5), N('width', 'Width', 30, 'mm', 4, 200, 1), MAT('aluminum')],
    mass: (p) => discJ(materialOf(p.material).rho, m(p.dia / 2), 0, m(p.width)).M * 0.7,
    inertia: (p) => discJ(materialOf(p.material).rho, m(p.dia / 2), 0, m(p.width)).J * 0.7,
    mesh: (p) => K.merge([K.cylinder(p.dia / 2, p.width, 40), K.transformMesh(K.cylinder(p.dia / 2 + 6, 3, 40), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, p.width / 2 + 1.5, 1]), K.transformMesh(K.cylinder(p.dia / 2 + 6, 3, 40), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -p.width / 2 - 1.5, 1])]),
  },
  screw: {
    name: 'Lead screw', cat: 'Transmission', mount: 'shaft', spins: true, color: 0xb9b0a0,
    hint: 'Turns rotation into precise linear motion: travel per turn = lead. Friction makes screws inefficient — and self-locking when the lead is small.',
    params: [...MOUNT, N('lead', 'Lead (travel/rev)', 4, 'mm', 0.5, 50, 0.5), N('dia', 'Diameter', 10, 'mm', 3, 60, 0.5), N('length', 'Length', 200, 'mm', 20, 1000, 5), S('hand', 'Hand', 'right', ['right', 'left']), N('mu', 'Thread friction μ', 0.15, '', 0.02, 0.5, 0.01), MAT('steel')],
    mass: (p) => materialOf(p.material).rho * PI * m(p.dia / 2) ** 2 * m(p.length) * 0.85,
    inertia: (p) => 0.5 * materialOf(p.material).rho * PI * m(p.dia / 2) ** 4 * m(p.length) * 0.85,
    mesh(p) {
      const turns = Math.max(2, Math.round(p.length / p.lead / 2)), pts = Math.min(turns, 60) * 10;
      const path = Array.from({ length: pts + 1 }, (_, i) => { const t = i / pts, a = t * Math.min(turns, 60) * PI * 2 * (p.hand === 'left' ? -1 : 1); return [(p.dia / 2) * Math.cos(a), (p.dia / 2) * Math.sin(a), -p.length / 2 + t * p.length]; });
      return K.merge([K.cylinder(p.dia / 2 - 1, p.length, 20), K.sweepTube(path, 0.9, 5)]);
    },
  },
  planetary: {
    name: 'Planetary gearset', cat: 'Transmission', mount: 'assembly', spins: false, color: 0x8fa2c8,
    hint: 'Sun, planets on a carrier, and a ring, all on one axis. Ground one member, drive another, take output from the third: ratios from 3:1 to 10:1 in a tiny space.',
    params: [
      P('sun', 'Sun shaft', '', { type: 'part', of: ['shaft'], allowGround: true }), P('carrier', 'Carrier shaft', '', { type: 'part', of: ['shaft'], allowGround: true }), P('ring', 'Ring shaft', '', { type: 'part', of: ['shaft'], allowGround: true }),
      N('module', 'Module', 1.5, 'mm', 0.3, 10, 0.05), N('zs', 'Sun teeth', 16, '', 8, 100, 1), N('zr', 'Ring teeth', 48, '', 24, 300, 1), N('planets', 'Planets', 3, '', 2, 6, 1), N('width', 'Face width', 10, 'mm', 2, 60, 0.5), MAT('steel'),
      N('axial', 'Axial offset', 0, 'mm', -500, 500, 1),
    ],
    planet(p) { const zp = (p.zr - p.zs) / 2; const rho = materialOf(p.material).rho; const pj = discJ(rho, m(p.module * zp / 2), 0, m(p.width)); return { zp, ...pj, rc: m(p.module * (p.zs + zp) / 2) }; },
    mesh(p) {
      const zp = (p.zr - p.zs) / 2, rc = p.module * (p.zs + zp) / 2, out = [K.spurGear(p.module, p.zs, p.width), K.ringGear(p.module, p.zr, p.width)];
      for (let i = 0; i < p.planets; i++) { const a = (i / p.planets) * PI * 2; out.push(K.transformMesh(K.spurGear(p.module, zp, p.width), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, rc * Math.cos(a), rc * Math.sin(a), 0, 1])); }
      return K.merge(out);
    },
  },
  differential: {
    name: 'Differential', cat: 'Transmission', mount: 'assembly', spins: false, color: 0xc48a5a,
    hint: 'An open differential: the cage drives two axles that may turn at different speeds (ω_L + ω_R = 2·ω_cage) while sharing torque equally.',
    params: [P('cage', 'Cage shaft', '', { type: 'part', of: ['shaft'] }), P('left', 'Left axle', '', { type: 'part', of: ['shaft'] }), P('right', 'Right axle', '', { type: 'part', of: ['shaft'] }), N('size', 'Size', 40, 'mm', 10, 200, 1), N('axial', 'Axial offset', 0, 'mm', -500, 500, 1)],
    mesh: (p) => K.merge([K.sphere(p.size / 2, 24, 12), K.transformMesh(K.cylinder(p.size * 0.15, p.size * 1.6, 16), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])]),
  },

  /* -------------------------------------------------------------- rotating */
  flywheel: {
    name: 'Flywheel / rotor disc', cat: 'Rotating', mount: 'shaft', spins: true, color: 0x8d949e,
    hint: 'Stores kinetic energy (½Jω²). Heavier and wider = harder to spin up, harder to stop. Watch the burst-speed limit on fast rotors.',
    params: [...MOUNT, N('dia', 'Diameter', 100, 'mm', 10, 1500, 1), N('thick', 'Thickness', 12, 'mm', 1, 200, 0.5), N('inner', 'Inner diameter (ring)', 0, 'mm', 0, 1400, 1), N('bore', 'Bore', 8, 'mm', 0, 60, 0.5), MAT('steel')],
    geom(p) { const rho = materialOf(p.material).rho, ri = m(Math.max(p.inner, p.bore) / 2); return discJ(rho, m(p.dia / 2), ri, m(p.thick)); },
    mass(p) { return this.geom(p).M; }, inertia(p) { return this.geom(p).J; },
    mesh: (p) => (p.inner > 0 ? K.tube(p.dia / 2, p.inner / 2, p.thick, 56) : K.cylinder(p.dia / 2, p.thick, 56)),
  },
  crank: {
    name: 'Crank arm', cat: 'Rotating', mount: 'shaft', spins: true, color: 0xa2acb6,
    hint: 'An arm with a pin at the throw radius. Connect it to a slider with a rod to make a piston / crank-slider.',
    params: [...MOUNT, N('throw', 'Throw (crank radius)', 25, 'mm', 4, 300, 1), N('armW', 'Arm width', 10, 'mm', 3, 60, 0.5), N('armT', 'Arm thickness', 6, 'mm', 2, 30, 0.5), N('pinMass', 'Pin mass', 0.02, 'kg', 0, 20, 0.005), MAT('steel')],
    parts(p) { const rho = materialOf(p.material).rho, L = m(p.throw + p.armW / 2), Ma = rho * L * m(p.armW) * m(p.armT); return { Ma, L }; },
    mass(p) { return this.parts(p).Ma + p.pinMass; },
    inertia(p) { const { Ma, L } = this.parts(p); return Ma * L * L / 3 + p.pinMass * m(p.throw) ** 2; },
    eccentric(p) { const { Ma } = this.parts(p); return { m: Ma + p.pinMass, cx: (Ma * m(p.throw) / 2 + p.pinMass * m(p.throw)) / (Ma + p.pinMass || 1), cy: 0 }; },
    mesh: (p) => K.merge([K.transformMesh(K.box(p.throw + p.armW, p.armW, p.armT), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.throw / 2, 0, 0, 1]), K.transformMesh(K.cylinder(p.armW * 0.4, p.armT + 8, 16), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.throw, 0, 3, 1])]),
  },
  cam: {
    name: 'Cam', cat: 'Rotating', mount: 'shaft', spins: true, color: 0xc9a25a,
    hint: 'A shaped disc that pushes a follower. The profile sets the motion: rise, dwell, return. Connect it to a slider with a spring to make a valve train.',
    params: [...MOUNT, N('base', 'Base radius', 15, 'mm', 4, 200, 0.5), N('lift', 'Lift', 8, 'mm', 0.5, 80, 0.5), S('profile', 'Profile', 'harmonic', [{ value: 'harmonic', label: 'Harmonic (simple)' }, { value: 'cycloidal', label: 'Cycloidal (smooth accel)' }, { value: 'eccentric', label: 'Eccentric circle' }]), N('rise', 'Rise angle', 120, '°', 10, 170, 5), N('dwell', 'Dwell at top', 40, '°', 0, 170, 5), N('ret', 'Return angle', 120, '°', 10, 170, 5), N('width', 'Width', 8, 'mm', 2, 60, 0.5), MAT('steel')],
    lift(p, beta) { return camLift(p, beta); },
    geom(p) { const rho = materialOf(p.material).rho; return discJ(rho, m(p.base + p.lift / 2), 0, m(p.width)); },
    mass(p) { return this.geom(p).M; }, inertia(p) { return this.geom(p).J; },
    mesh: (p) => K.camMesh((a) => p.base + camLift(p, a).y, p.width),
  },
  arm: {
    name: 'Pendulum / robot arm', cat: 'Rotating', mount: 'shaft', spins: true, color: 0x7fa3d1,
    hint: 'A rod with a weight at the end. Gravity pulls it down: try it as a pendulum, a balance arm or a robot joint.',
    params: [...MOUNT, N('length', 'Length', 120, 'mm', 10, 1000, 1), N('width', 'Bar width', 12, 'mm', 2, 60, 0.5), N('thick', 'Bar thickness', 6, 'mm', 1, 40, 0.5), N('bob', 'End weight', 0.3, 'kg', 0, 100, 0.01), MAT('aluminum')],
    bar(p) { return materialOf(p.material).rho * m(p.length) * m(p.width) * m(p.thick); },
    mass(p) { return this.bar(p) + p.bob; },
    inertia(p) { const L = m(p.length); return this.bar(p) * L * L / 3 + p.bob * L * L; },
    eccentric(p) { const L = m(p.length), M = this.bar(p) + p.bob; return { m: M, cx: (this.bar(p) * L / 2 + p.bob * L) / M, cy: 0 }; },
    mesh: (p) => K.merge([K.transformMesh(K.box(p.length, p.width, p.thick), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.length / 2, 0, 0, 1]), K.transformMesh(K.sphere(Math.max(5, Math.cbrt(p.bob) * 22), 20, 12), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.length, 0, 0, 1])]),
  },
  wheel: {
    name: 'Wheel (with tyre)', cat: 'Rotating', mount: 'shaft', spins: true, color: 0x2b2b2e,
    hint: 'A tyre on a rim. Connect it to a vehicle body: the vehicle moves ω·R per second, and rolling resistance acts at the tyre.',
    params: [...MOUNT, N('dia', 'Outer diameter', 80, 'mm', 20, 800, 1), N('width', 'Width', 20, 'mm', 4, 200, 1), N('mass', 'Mass', 0.15, 'kg', 0.005, 200, 0.005), N('crr', 'Rolling resistance Crr', 0.015, '', 0.002, 0.1, 0.001), N('mu', 'Tyre grip μ', 0.9, '', 0.1, 1.5, 0.05)],
    mass: (p) => p.mass, inertia: (p) => 0.5 * p.mass * m(p.dia / 2) ** 2 * 0.9,
    mesh: (p) => K.merge([K.tube(p.dia / 2, p.dia / 2 - 8, p.width, 40), K.cylinder(p.dia / 2 - 8, p.width * 0.35, 40)]),
  },
  propeller: {
    name: 'Propeller / fan', cat: 'Rotating', mount: 'shaft', spins: true, color: 0xdcdfe6,
    hint: 'Air load: torque ∝ ρ·n²·D⁵, thrust ∝ ρ·n²·D⁴. Point its thrust at a slider to lift or push it.',
    params: [...MOUNT, N('dia', 'Diameter', 200, 'mm', 30, 3000, 5), N('blades', 'Blades', 3, '', 2, 8, 1), N('pitch', 'Blade pitch', 20, '°', 0, 45, 1), N('bladeMass', 'Mass per blade', 0.01, 'kg', 0.0005, 5, 0.001), N('ct', 'Thrust coeff Ct', 0.1, '', 0.01, 0.4, 0.005), N('cp', 'Power coeff Cp', 0.05, '', 0.005, 0.3, 0.005), S('hand', 'Thrust direction', '1', [{ value: '1', label: '+Z when spinning +' }, { value: '-1', label: '−Z when spinning +' }]), P('target', 'Push this slider', '', { type: 'part', of: ['slider', 'vehicle'] })],
    mass: (p) => p.bladeMass * p.blades + 0.01, inertia: (p) => p.blades * p.bladeMass * m(p.dia / 2) ** 2 / 3 + 1e-6,
    mesh(p) { const out = [K.cylinder(8, 12, 20)]; for (let i = 0; i < p.blades; i++) out.push(K.transformMesh(K.blade(p.dia / 2 - 8, p.dia * 0.09, p.dia * 0.045, 1.5, p.pitch + 12, p.pitch - 6), [Math.cos((i / p.blades) * PI * 2), Math.sin((i / p.blades) * PI * 2), 0, 0, -Math.sin((i / p.blades) * PI * 2), Math.cos((i / p.blades) * PI * 2), 0, 0, 0, 0, 1, 0, 8 * Math.cos((i / p.blades) * PI * 2), 8 * Math.sin((i / p.blades) * PI * 2), 0, 1])); return K.merge(out); },
  },
  windrotor: {
    name: 'Wind rotor (turbine)', cat: 'Rotating', mount: 'shaft', spins: true, color: 0xe6e9ee,
    hint: 'Extracts power from wind: P = ½ρAv³·Cp(λ), λ = tip speed ÷ wind speed. It has a best tip-speed ratio and a peak Cp below the Betz limit (0.593).',
    params: [...MOUNT, N('dia', 'Rotor diameter', 600, 'mm', 100, 6000, 10), N('blades', 'Blades', 3, '', 2, 6, 1), N('bladeMass', 'Mass per blade', 0.08, 'kg', 0.005, 50, 0.005), N('wind', 'Wind speed', 8, 'm/s', 0, 40, 0.5), N('cpMax', 'Peak Cp', 0.38, '', 0.1, 0.55, 0.01), N('lambdaOpt', 'Best tip-speed ratio', 6, '', 1, 12, 0.5), S('dir', 'Spin direction', '1', [{ value: '1', label: 'Positive' }, { value: '-1', label: 'Negative' }])],
    mass: (p) => p.bladeMass * p.blades + 0.05, inertia: (p) => p.blades * p.bladeMass * m(p.dia / 2) ** 2 / 3,
    mesh(p) { const out = [K.cylinder(14, 30, 24)]; for (let i = 0; i < p.blades; i++) { const a = (i / p.blades) * PI * 2; out.push(K.transformMesh(K.blade(p.dia / 2 - 14, p.dia * 0.06, p.dia * 0.025, 3, 25, 4), [Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 14 * Math.cos(a), 14 * Math.sin(a), 0, 1])); } return K.merge(out); },
  },
  brake: {
    name: 'Disc brake', cat: 'Rotating', mount: 'shaft', spins: true, color: 0x70767f,
    hint: 'Friction brake: torque = μ·clamp force·effective radius. Drive it with the Brake control (0–1). It turns kinetic energy into heat.',
    params: [...MOUNT, N('dia', 'Disc diameter', 80, 'mm', 20, 500, 1), N('maxTorque', 'Max braking torque', 1, 'N·m', 0.001, 1000, 0.01), N('apply', 'Apply', 0, '', 0, 1, 0.01), N('Cth', 'Thermal mass', 300, 'J/K', 5, 50000, 5), MAT('cast-iron')],
    geom(p) { return discJ(materialOf(p.material).rho, m(p.dia / 2), m(p.dia / 4), m(6)); },
    mass(p) { return this.geom(p).M; }, inertia(p) { return this.geom(p).J; },
    mesh: (p) => K.merge([K.tube(p.dia / 2, p.dia / 4, 6, 48), K.transformMesh(K.box(12, 20, 14), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.dia / 2 - 4, 0, 0, 1])]),
  },
  torsionspring: {
    name: 'Torsion spring', cat: 'Rotating', mount: 'shaft', spins: true, color: 0xc0c4cc,
    hint: 'A spring on the shaft: torque = −k·(angle − rest angle) − c·speed. Makes clock springs, return springs and oscillators.',
    params: [...MOUNT, N('k', 'Stiffness k', 0.05, 'N·m/rad', 0.0001, 1000, 0.01), N('c', 'Damping c', 0.0005, 'N·m·s/rad', 0, 100, 0.0005), N('rest', 'Rest angle', 0, '°', -1080, 1080, 5), N('dia', 'Coil diameter', 30, 'mm', 6, 200, 1)],
    mass: () => 0.02, inertia: () => 1e-7,
    mesh: (p) => K.helixSpring(p.dia / 2, 1.2, 5, 16, 10),
  },
  load: {
    name: 'Load (drag)', cat: 'Loads', mount: 'shaft', spins: true, color: 0x7a5d5d,
    hint: 'A generic mechanical load on a shaft: viscous (∝ speed), dry friction (constant), fan-law (∝ speed²), or a driving torque.',
    params: [...MOUNT, S('kind', 'Kind', 'viscous', [{ value: 'viscous', label: 'Viscous  c·ω' }, { value: 'coulomb', label: 'Dry friction  τ₀' }, { value: 'quadratic', label: 'Fan law  k·ω²' }, { value: 'source', label: 'Driving torque' }]), N('value', 'Value', 0.001, 'SI', -100, 100, 0.0001)],
    mass: () => 0, inertia: () => 0,
    mesh: () => K.merge([K.cylinder(9, 8, 20)]),
  },

  /* ---------------------------------------------------------------- linear */
  slider: {
    name: 'Slider / carriage', cat: 'Linear', mount: 'free', slides: true, color: 0x6a8fbf,
    hint: 'A mass on a linear guide, moving along its local X axis. Rotate it to slide up, down or on a slope. Set end stops to limit travel.',
    params: [N('mass', 'Mass', 0.5, 'kg', 0.001, 5000, 0.01), N('x0', 'Start position', 0, 'mm', -5000, 5000, 1), B('limits', 'End stops', false), N('min', 'Min travel', -100, 'mm', -5000, 5000, 1), N('max', 'Max travel', 100, 'mm', -5000, 5000, 1), N('mu', 'Guide friction μ', 0.05, '', 0, 1, 0.01), N('c', 'Viscous damping', 0, 'N·s/m', 0, 1e5, 0.1), N('w', 'Body length', 60, 'mm', 4, 1000, 1), N('h', 'Body height', 20, 'mm', 2, 500, 1), N('d', 'Body depth', 30, 'mm', 2, 500, 1), N('restitution', 'Bounce (0–1)', 0.3, '', 0, 1, 0.05), P('material', 'Body material', 'aluminum', { type: 'material', options: materialOptions() })],
    mass: (p) => p.mass, mesh: (p) => K.box(p.w, p.h, p.d),
  },
  rack: {
    name: 'Rack', cat: 'Linear', mount: 'free', slides: true, color: 0x9aa3ad,
    hint: 'A toothed bar that meshes with a pinion gear: rotation ↔ straight-line motion (v = ω·r). Place it tangent to the pinion’s pitch circle.',
    params: [N('mass', 'Mass', 0.2, 'kg', 0.001, 5000, 0.01), N('x0', 'Start position', 0, 'mm', -5000, 5000, 1), B('limits', 'End stops', false), N('min', 'Min travel', -100, 'mm', -5000, 5000, 1), N('max', 'Max travel', 100, 'mm', -5000, 5000, 1), N('mu', 'Guide friction μ', 0.08, '', 0, 1, 0.01), N('c', 'Viscous damping', 0, 'N·s/m', 0, 1e5, 0.1), N('module', 'Module', 1.5, 'mm', 0.3, 20, 0.05), N('length', 'Length', 150, 'mm', 20, 2000, 1), N('width', 'Face width', 8, 'mm', 1, 100, 0.5), N('pressure', 'Pressure angle', 20, '°', 14.5, 25, 0.5), N('restitution', 'Bounce (0–1)', 0.3, '', 0, 1, 0.05), MAT('steel')],
    mass: (p) => p.mass, mesh: (p) => K.rackMesh(p.module, p.length, p.width, 6, p.pressure),
  },
  weight: {
    name: 'Hanging weight', cat: 'Linear', mount: 'free', slides: true, color: 0xb04a4a,
    hint: 'A mass on a rope. Its axis points DOWN (gravity pulls it along +X when rotated −90° about Z). Connect it to a rope drum.',
    params: [N('mass', 'Mass', 1, 'kg', 0.001, 5000, 0.01), N('x0', 'Start position', 0, 'mm', -5000, 5000, 1), B('limits', 'Floor / ceiling', false), N('min', 'Min travel', 0, 'mm', -5000, 5000, 1), N('max', 'Max travel', 500, 'mm', -5000, 5000, 1), N('mu', 'Guide friction μ', 0, '', 0, 1, 0.01), N('c', 'Air damping', 0.02, 'N·s/m', 0, 1e5, 0.01), N('restitution', 'Bounce (0–1)', 0.1, '', 0, 1, 0.05), N('dia', 'Diameter', 30, 'mm', 5, 300, 1)],
    mass: (p) => p.mass, mesh: (p) => K.merge([K.cylinder(p.dia / 2, Math.max(8, p.dia * 0.8), 28)]),
  },
  vehicle: {
    name: 'Vehicle body', cat: 'Linear', mount: 'free', slides: true, color: 0xd6644a,
    hint: 'A chassis that rolls along +X carrying its shafts and wheels. Rolling resistance and aerodynamic drag act on it; rotate the body about Z to drive up a slope.',
    params: [N('mass', 'Mass', 1.5, 'kg', 0.01, 50000, 0.05), N('x0', 'Start position', 0, 'mm', -50000, 50000, 10), B('limits', 'Track ends', false), N('min', 'Min travel', -1000, 'mm', -50000, 50000, 10), N('max', 'Max travel', 5000, 'mm', -50000, 50000, 10), N('cdA', 'Drag  Cd·A', 0.05, 'm²', 0, 5, 0.005), N('mu', 'Bearing friction μ', 0, '', 0, 1, 0.01), N('c', 'Viscous damping', 0, 'N·s/m', 0, 1e5, 0.1), N('w', 'Length', 160, 'mm', 20, 6000, 5), N('h', 'Height', 30, 'mm', 4, 2000, 1), N('d', 'Width', 90, 'mm', 10, 2500, 1), N('restitution', 'Bounce (0–1)', 0.2, '', 0, 1, 0.05)],
    mass: (p) => p.mass, mesh: (p) => K.box(p.w, p.h, p.d),
  },
  spring: {
    name: 'Spring / damper', cat: 'Linear', mount: 'link', color: 0xc4c8d0,
    hint: 'Linear spring and damper between two sliders (or between a slider and the ground point where this part sits).',
    params: [P('a', 'End A (slider)', '', { type: 'part', of: ['slider', 'rack', 'weight', 'vehicle'] }), P('b', 'End B (slider or ground)', '', { type: 'part', of: ['slider', 'rack', 'weight', 'vehicle'], allowGround: true }), N('k', 'Stiffness k', 200, 'N/m', 0, 1e7, 1), N('c', 'Damping c', 0.5, 'N·s/m', 0, 1e5, 0.1), N('L0', 'Free length', 80, 'mm', 1, 2000, 1), N('coilR', 'Coil radius', 8, 'mm', 2, 100, 0.5)],
    mass: () => 0,
  },

  /* ---------------------------------------------------------------- custom */
  custom: {
    name: 'Custom 3D part', cat: 'Model', mount: 'custom', color: 0x86c98a,
    hint: 'Your own model: build it from primitives or import an STL/OBJ. Mass, centre of mass and inertia come from the real mesh and the material’s density.',
    params: [
      S('attach', 'Attach as', 'static', [{ value: 'static', label: 'Fixed decoration' }, { value: 'shaft', label: 'Rotating on a shaft' }, { value: 'slider', label: 'Sliding along X' }]),
      P('shaft', 'On shaft', '', { type: 'part', of: ['shaft'] }), N('axial', 'Axial offset', 0, 'mm', -1000, 1000, 1), N('phase', 'Phase', 0, '°', -360, 360, 1),
      MAT('aluminum'), N('massOverride', 'Mass override (0 = from mesh)', 0, 'kg', 0, 5000, 0.001),
      N('x0', 'Start position (slider)', 0, 'mm', -5000, 5000, 1), B('limits', 'End stops (slider)', false), N('min', 'Min travel', -100, 'mm', -5000, 5000, 1), N('max', 'Max travel', 100, 'mm', -5000, 5000, 1), N('mu', 'Guide friction μ', 0.05, '', 0, 1, 0.01), N('c', 'Viscous damping', 0, 'N·s/m', 0, 1e5, 0.1), N('restitution', 'Bounce', 0.3, '', 0, 1, 0.05),
    ],
    model: true,
  },
};

/** Cam lift (mm) and derivatives w.r.t. the cam-local angle β (rad). Rise → dwell → return → base dwell. */
export function camLift(p, beta) {
  if (p.profile === 'eccentric') { const e = p.lift / 2, b = ((beta % (2 * PI)) + 2 * PI) % (2 * PI); return { y: e * (1 - Math.cos(b)), dy: e * Math.sin(b), ddy: e * Math.cos(b) }; }
  const b = ((beta % (2 * PI)) + 2 * PI) % (2 * PI), r = p.rise * D2R, d = p.dwell * D2R, t = p.ret * D2R, h = p.lift;
  const seg = (s, len, dir) => {
    const u = s / len;
    if (p.profile === 'cycloidal') {
      const y = u - Math.sin(2 * PI * u) / (2 * PI), dy = (1 - Math.cos(2 * PI * u)) / len, ddy = (2 * PI * Math.sin(2 * PI * u)) / (len * len);
      return dir > 0 ? { y: h * y, dy: h * dy, ddy: h * ddy } : { y: h * (1 - y), dy: -h * dy, ddy: -h * ddy };
    }
    const y = (1 - Math.cos(PI * u)) / 2, dy = (PI * Math.sin(PI * u)) / (2 * len), ddy = (PI * PI * Math.cos(PI * u)) / (2 * len * len);
    return dir > 0 ? { y: h * y, dy: h * dy, ddy: h * ddy } : { y: h * (1 - y), dy: -h * dy, ddy: -h * ddy };
  };
  if (b < r) return seg(b, r, 1);
  if (b < r + d) return { y: h, dy: 0, ddy: 0 };
  if (b < r + d + t) return seg(b - r - d, t, -1);
  return { y: 0, dy: 0, ddy: 0 };
}

export const CATEGORIES = ['Structure', 'Power', 'Transmission', 'Rotating', 'Linear', 'Loads', 'Model'];

export function paramDefaults(type) {
  const out = {};
  for (const prm of PART_TYPES[type].params) out[prm.key] = prm.def;
  return out;
}
