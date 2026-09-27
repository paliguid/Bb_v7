import { VT, stampDiode } from './solver.js';
import { formatValue } from './units.js';

export const G = 2.54; // 0.1 inch — the pitch everything on a BreadBai obeys

const pin = (name, x, z, label = name) => ({ name, x, z, label });
const R_OPEN = 1e11;
const R_CLOSED = 2e-3;

/** Forward voltage and tint for each LED colour, measured-ish at 20 mA. */
export const LED_COLORS = {
  red: { vf: 1.85, tint: '#ff2d2d', glow: '#ff5a4a' },
  amber: { vf: 2.0, tint: '#ff9d1c', glow: '#ffb64d' },
  yellow: { vf: 2.05, tint: '#ffdd28', glow: '#ffe870' },
  green: { vf: 2.15, tint: '#2fd45e', glow: '#6cff9a' },
  blue: { vf: 3.0, tint: '#2f7dff', glow: '#79b0ff' },
  white: { vf: 3.1, tint: '#eef3ff', glow: '#ffffff' },
};

const diodeIs = (vf, n = 2) => 0.02 / Math.exp(vf / (n * VT));

const defs = {
  BreadBai: {
    name: 'BreadBoard',
    group: 'Boards',
    hint: 'Half-size 830 point board. Strips of five holes, plus four power rails.',
    pins: [],
    board: true,
    props: [],
    defaults: {},
    footprint: { w: 88, d: 58 },
  },

  battery: {
    name: '9 V battery',
    group: 'Power',
    hint: 'A real alkaline block: it sags under load through its internal resistance.',
    pins: [pin('pos', -G, 0, '+'), pin('neg', G, 0, '−')],
    groundPin: 'neg',
    vsCount: 1,
    props: [
      { key: 'voltage', label: 'Voltage', type: 'value', unit: 'V', min: 0.1, max: 24, step: 0.1, default: 9 },
      { key: 'esr', label: 'Internal resistance', type: 'value', unit: 'Ω', min: 0.01, max: 50, default: 1.7 },
    ],
    defaults: { voltage: 9, esr: 1.7 },
    internalNodes: 1,
    stamp({ sys, nodes, internal, branches, props }) {
      sys.addVS(branches[0], internal[0], nodes.neg, props.voltage);
      sys.addR(internal[0], nodes.pos, props.esr);
    },
    post({ sys, nodes, branches, state }) {
      state.current = -sys.branchCurrent(branches[0]);
      state.terminal = sys.vd(nodes.pos, nodes.neg);
    },
    readout: (p) => `${formatValue(p.state?.terminal ?? p.props.voltage, 'V')} · ${formatValue(Math.abs(p.state?.current ?? 0), 'A')}`,
  },

  supply: {
    name: 'Bench supply',
    group: 'Power',
    hint: 'Adjustable 0–30 V source with a live readout. Drag the dial in the inspector.',
    pins: [pin('pos', -G, 0, '+'), pin('neg', G, 0, '−')],
    groundPin: 'neg',
    vsCount: 1,
    props: [
      { key: 'voltage', label: 'Output', type: 'slider', unit: 'V', min: 0, max: 30, step: 0.1, default: 5, live: true },
    ],
    defaults: { voltage: 5 },
    internalNodes: 1,
    stamp({ sys, nodes, internal, branches, props }) {
      sys.addVS(branches[0], internal[0], nodes.neg, props.voltage);
      sys.addR(internal[0], nodes.pos, 0.05);
    },
    post({ sys, branches, state }) { state.current = -sys.branchCurrent(branches[0]); },
    readout: (p) => `${formatValue(p.props.voltage, 'V')} · ${formatValue(Math.abs(p.state?.current ?? 0), 'A')}`,
  },

  ground: {
    name: 'Ground',
    group: 'Power',
    hint: 'Defines the 0 V reference. Every circuit needs exactly one.',
    pins: [pin('gnd', 0, 0, 'GND')],
    props: [],
    defaults: {},
    stamp({ sys, nodes }) { sys.addR(nodes.gnd, -1, 1e-4); },
  },

  resistor: {
    name: 'Resistor',
    group: 'Passive',
    hint: 'Carbon film, quarter watt. The colour bands follow the value you set.',
    pins: [pin('a', -2 * G, 0), pin('b', 2 * G, 0)],
    props: [
      {
        key: 'resistance', label: 'Resistance', type: 'value', unit: 'Ω', min: 0.1, max: 1e7, default: 220,
        presets: [10, 100, 220, 330, 470, 1e3, 2.2e3, 4.7e3, 10e3, 47e3, 100e3, 1e6],
      },
      { key: 'tolerance', label: 'Tolerance', type: 'select', default: 5, options: [{ value: 1, label: '±1 %' }, { value: 5, label: '±5 %' }, { value: 10, label: '±10 %' }] },
    ],
    defaults: { resistance: 220, tolerance: 5 },
    stamp({ sys, nodes, props }) { sys.addR(nodes.a, nodes.b, props.resistance); },
    post({ sys, nodes, props, state }) {
      state.voltage = sys.vd(nodes.a, nodes.b);
      state.current = state.voltage / props.resistance;
      state.power = state.voltage * state.current;
    },
    readout: (p) => `${formatValue(p.props.resistance, 'Ω')} · ${formatValue(Math.abs(p.state?.current ?? 0), 'A')}`,
  },

  led: {
    name: 'LED',
    group: 'Output',
    hint: 'Diffused 5 mm. Lights from about 2 mA and burns out past 40 mA — add a series resistor.',
    pins: [pin('a', -G / 2, 0, 'anode'), pin('k', G / 2, 0, 'cathode')],
    props: [
      { key: 'color', label: 'Colour', type: 'select', default: 'red', options: Object.keys(LED_COLORS).map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })) },
    ],
    defaults: { color: 'red' },
    internalNodes: 1,
    state: () => ({ brightness: 0, current: 0, burnt: false }),
    resetState: (s) => { s.brightness = 0; s.current = 0; s.burnt = false; },
    stamp({ sys, nodes, internal, props, mem, state }) {
      if (state.burnt) { sys.addR(nodes.a, nodes.k, R_OPEN); return; }
      const { vf } = LED_COLORS[props.color] ?? LED_COLORS.red;
      stampDiode(sys, nodes.a, internal[0], diodeIs(vf), 2 * VT, mem, 'd');
      sys.addR(internal[0], nodes.k, 12);
    },
    post({ sys, nodes, internal, state }) {
      const i = sys.vd(internal[0], nodes.k) / 12;
      state.current = i;
      state.voltage = sys.vd(nodes.a, nodes.k);
      if (i > 0.045) state.overload = (state.overload ?? 0) + 1; else state.overload = 0;
      if (state.overload > 400) state.burnt = true;
      const target = state.burnt ? 0 : Math.max(0, Math.min(1, Math.pow(Math.max(i, 0) / 0.018, 0.55)));
      state.brightness += (target - state.brightness) * 0.35;
    },
    readout: (p) => (p.state?.burnt ? 'Burnt out' : `${formatValue(p.state?.current ?? 0, 'A')} · ${formatValue(p.state?.voltage ?? 0, 'V')}`),
  },

  diode: {
    name: 'Diode 1N4148',
    group: 'Passive',
    hint: 'Signal diode. Conducts one way from roughly 0.6 V, blocks the other.',
    pins: [pin('a', -1.5 * G, 0, 'anode'), pin('k', 1.5 * G, 0, 'cathode')],
    props: [],
    defaults: {},
    stamp({ sys, nodes, mem, state }) { state.current = stampDiode(sys, nodes.a, nodes.k, 2.5e-9, 1.8 * VT, mem, 'd'); },
    post({ sys, nodes, state }) { state.voltage = sys.vd(nodes.a, nodes.k); },
    readout: (p) => `${formatValue(p.state?.current ?? 0, 'A')}`,
  },

  capacitor: {
    name: 'Capacitor',
    group: 'Passive',
    hint: 'Electrolytic. Charges and discharges over time — watch it with a scope.',
    pins: [pin('pos', -G / 2, 0, '+'), pin('neg', G / 2, 0, '−')],
    props: [
      {
        key: 'capacitance', label: 'Capacitance', type: 'value', unit: 'F', min: 1e-12, max: 1e-1, default: 100e-6,
        presets: [100e-9, 1e-6, 10e-6, 47e-6, 100e-6, 470e-6, 1e-3],
      },
    ],
    defaults: { capacitance: 100e-6 },
    state: () => ({ v: 0 }),
    resetState: (s) => { s.v = 0; },
    stamp({ sys, nodes, props, dt, state }) {
      const geq = props.capacitance / dt;
      sys.addG(nodes.pos, nodes.neg, geq);
      sys.addI(nodes.pos, nodes.neg, -geq * (state.v ?? 0));
      sys.addR(nodes.pos, nodes.neg, 2e7); // leakage
    },
    post({ sys, nodes, props, dt, state }) {
      const vNow = sys.vd(nodes.pos, nodes.neg);
      state.current = (props.capacitance / dt) * (vNow - (state.v ?? 0));
      state.v = vNow;
      state.charge = props.capacitance * vNow;
    },
    readout: (p) => `${formatValue(p.props.capacitance, 'F')} · ${formatValue(p.state?.v ?? 0, 'V')}`,
  },

  pushbutton: {
    name: 'Push button',
    group: 'Control',
    hint: 'Tactile switch. Click it in the scene to press, or hold the space bar.',
    pins: [pin('p1', -G, -1.5 * G), pin('p2', -G, 1.5 * G), pin('p3', G, -1.5 * G), pin('p4', G, 1.5 * G)],
    props: [
      { key: 'latching', label: 'Stays down', type: 'bool', default: false },
    ],
    defaults: { latching: false },
    state: () => ({ pressed: false }),
    resetState: (s) => { s.pressed = false; },
    clickable: true,
    onPress(part) { part.state.pressed = part.props.latching ? !part.state.pressed : true; },
    onRelease(part) { if (!part.props.latching) part.state.pressed = false; },
    stamp({ sys, nodes, state }) {
      sys.addR(nodes.p1, nodes.p2, R_CLOSED);
      sys.addR(nodes.p3, nodes.p4, R_CLOSED);
      sys.addR(nodes.p1, nodes.p3, state.pressed ? R_CLOSED * 20 : R_OPEN);
    },
    readout: (p) => (p.state?.pressed ? 'Pressed' : 'Released'),
  },

  toggle: {
    name: 'Toggle switch',
    group: 'Control',
    hint: 'Single pole, double throw. Common connects to one side or the other.',
    pins: [pin('a', -G, 0, 'A'), pin('com', 0, 0, 'COM'), pin('b', G, 0, 'B')],
    props: [{ key: 'mode', label: 'Wiring', type: 'select', default: 'spdt', options: [{ value: 'spdt', label: 'SPDT (A / B)' }, { value: 'spst', label: 'SPST (on / off)' }] }],
    defaults: { mode: 'spdt' },
    state: () => ({ on: false }),
    clickable: true,
    onPress(part) { part.state.on = !part.state.on; },
    stamp({ sys, nodes, state, props }) {
      const on = state.on;
      sys.addR(nodes.com, nodes.a, on ? R_OPEN : R_CLOSED);
      if (props.mode === 'spdt') sys.addR(nodes.com, nodes.b, on ? R_CLOSED : R_OPEN);
    },
    readout: (p) => (p.state?.on ? 'COM → B' : 'COM → A'),
  },

  potentiometer: {
    name: 'Potentiometer',
    group: 'Control',
    hint: 'Drag the knob in the scene to sweep the wiper between the two ends.',
    pins: [pin('t1', -G, 0, '1'), pin('w', 0, 0, 'wiper'), pin('t2', G, 0, '2')],
    props: [
      { key: 'resistance', label: 'Track', type: 'value', unit: 'Ω', min: 100, max: 1e6, default: 10e3, presets: [1e3, 5e3, 10e3, 50e3, 100e3] },
      { key: 'wiper', label: 'Position', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, live: true, percent: true },
    ],
    defaults: { resistance: 10e3, wiper: 0.5 },
    draggableKnob: true,
    stamp({ sys, nodes, props }) {
      const total = props.resistance;
      const w = Math.min(0.999, Math.max(0.001, props.wiper));
      sys.addR(nodes.t1, nodes.w, total * w);
      sys.addR(nodes.w, nodes.t2, total * (1 - w));
    },
    post({ sys, nodes, state }) { state.wiperV = sys.v(nodes.w); },
    readout: (p) => `${Math.round(p.props.wiper * 100)}% · ${formatValue(p.props.resistance * p.props.wiper, 'Ω')}`,
  },

  ldr: {
    name: 'Light sensor',
    group: 'Input',
    hint: 'Light dependent resistor. Bright light drops it to a few hundred ohms.',
    pins: [pin('a', -G, 0), pin('b', G, 0)],
    props: [
      { key: 'light', label: 'Light level', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, live: true, percent: true },
    ],
    defaults: { light: 0.5 },
    stamp({ sys, nodes, props, state }) {
      const r = 1e6 * Math.pow(10, -3.4 * props.light);
      state.resistance = r;
      sys.addR(nodes.a, nodes.b, r);
    },
    readout: (p) => formatValue(p.state?.resistance ?? 1e6, 'Ω'),
  },

  transistor: {
    name: 'NPN transistor',
    group: 'Active',
    hint: '2N2222. A small base current switches a much larger collector current.',
    pins: [pin('e', -G, 0, 'E'), pin('b', 0, 0, 'B'), pin('c', G, 0, 'C')],
    props: [
      { key: 'beta', label: 'Gain (hFE)', type: 'value', min: 10, max: 800, default: 200 },
    ],
    defaults: { beta: 200 },
    stamp({ sys, nodes, props, mem, state }) {
      const Is = 1e-14, BF = props.beta, BR = 3;
      const { b, c, e } = nodes;
      const lim = (v, key) => {
        const old = mem[key] ?? 0;
        let nv = v;
        if (nv > 0.3 && Math.abs(nv - old) > 2 * VT) {
          const arg = 1 + (nv - old) / VT;
          nv = old > 0 ? (arg > 0 ? old + VT * Math.log(arg) : old - 10 * VT) : VT * Math.log(Math.max(nv / VT, 1e-3));
        }
        nv = Math.max(Math.min(nv, 1.2), -60);
        mem[key] = nv;
        return nv;
      };
      const vbe = lim(sys.vd(b, e), 'vbe');
      const vbc = lim(sys.vd(b, c), 'vbc');
      const efe = Math.exp(Math.min(vbe / VT, 60));
      const efc = Math.exp(Math.min(vbc / VT, 60));

      const ibe = (Is / BF) * (efe - 1), gbe = Math.max((Is / (BF * VT)) * efe, 1e-12);
      const ibc = (Is / BR) * (efc - 1), gbc = Math.max((Is / (BR * VT)) * efc, 1e-12);
      const ict = Is * (efe - efc);
      const gif = Math.max((Is / VT) * efe, 1e-12);
      const gir = Math.max((Is / VT) * efc, 1e-12);

      sys.addG(b, e, gbe); sys.addI(b, e, ibe - gbe * vbe);
      sys.addG(b, c, gbc); sys.addI(b, c, ibc - gbc * vbc);
      sys.addVCCS(c, e, b, e, gif);
      sys.addVCCS(c, e, b, c, -gir);
      sys.addI(c, e, ict - gif * vbe + gir * vbc);

      state.ic = ict - ibc;
      state.ib = ibe + ibc;
    },
    post({ sys, nodes, state }) {
      state.vce = sys.vd(nodes.c, nodes.e);
      state.vbe = sys.vd(nodes.b, nodes.e);
      state.saturated = state.vce < 0.25 && state.ic > 1e-4;
    },
    readout: (p) => `Ic ${formatValue(p.state?.ic ?? 0, 'A')} · Vce ${formatValue(p.state?.vce ?? 0, 'V')}`,
  },

  buzzer: {
    name: 'Piezo buzzer',
    group: 'Output',
    hint: 'Sounds whenever it sees more than about 1.5 V. Audio plays through your speakers.',
    pins: [pin('pos', -G, 0, '+'), pin('neg', G, 0, '−')],
    props: [
      { key: 'frequency', label: 'Tone', type: 'value', unit: 'Hz', min: 100, max: 4000, default: 2300 },
      { key: 'resistance', label: 'Impedance', type: 'value', unit: 'Ω', min: 8, max: 2000, default: 120 },
    ],
    defaults: { frequency: 2300, resistance: 120 },
    stamp({ sys, nodes, props }) { sys.addR(nodes.pos, nodes.neg, props.resistance); },
    post({ sys, nodes, state }) {
      const v = sys.vd(nodes.pos, nodes.neg);
      state.voltage = v;
      state.level = Math.max(0, Math.min(1, (Math.abs(v) - 1.2) / 4));
      state.sounding = state.level > 0.02;
    },
    readout: (p) => (p.state?.sounding ? `Sounding · ${formatValue(p.props.frequency, 'Hz')}` : 'Silent'),
  },

  motor: {
    name: 'DC motor',
    group: 'Output',
    hint: 'Spins up with inertia and back-EMF, so it coasts when you cut the power.',
    pins: [pin('pos', -G, 0, '+'), pin('neg', G, 0, '−')],
    props: [
      { key: 'resistance', label: 'Winding', type: 'value', unit: 'Ω', min: 1, max: 200, default: 25 },
      { key: 'ke', label: 'Motor constant', type: 'value', unit: 'V·s', min: 0.001, max: 0.1, step: 0.001, default: 0.012 },
      { key: 'load', label: 'Mechanical load', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.15, live: true, percent: true },
    ],
    defaults: { resistance: 25, ke: 0.012, load: 0.15 },
    state: () => ({ omega: 0, angle: 0 }),
    resetState: (s) => { s.omega = 0; s.angle = 0; },
    stamp({ sys, nodes, props, state }) {
      sys.addR(nodes.pos, nodes.neg, props.resistance);
      // Back-EMF appears as a current source opposing the applied voltage.
      sys.addI(nodes.pos, nodes.neg, -(props.ke * (state.omega ?? 0)) / props.resistance);
    },
    post({ sys, nodes, props, dt, state }) {
      const v = sys.vd(nodes.pos, nodes.neg);
      const i = (v - props.ke * state.omega) / props.resistance;
      state.current = i;
      if (state.linked) {
        // A Systems link drives this motor from a real mechanism: that mechanism owns speed and
        // inertia, so this model only supplies the electrical side (current in, torque = ke·i out).
        state.angle = (state.angle + state.omega * dt) % (Math.PI * 2);
        state.rpm = (state.omega * 60) / (Math.PI * 2);
        return;
      }
      const J = 2.2e-6;
      const damping = 1e-6 + props.load * 8e-6;
      const torque = props.ke * i - damping * state.omega;
      state.omega += (torque / J) * dt;
      if (Math.abs(state.omega) < 0.05 && Math.abs(v) < 0.05) state.omega = 0;
      state.angle = (state.angle + state.omega * dt) % (Math.PI * 2);
      state.rpm = (state.omega * 60) / (Math.PI * 2);
    },
    readout: (p) => `${Math.round(Math.abs(p.state?.rpm ?? 0))} rpm · ${formatValue(Math.abs(p.state?.current ?? 0), 'A')}`,
  },

  seg7: {
    name: '7-segment display',
    group: 'Output',
    hint: 'Common cathode. Drive each segment pin high through a resistor.',
    pins: [
      pin('e', -2 * G, 3 * G), pin('d', -G, 3 * G), pin('com1', 0, 3 * G, 'COM'), pin('c', G, 3 * G), pin('dp', 2 * G, 3 * G),
      pin('g', -2 * G, -3 * G), pin('f', -G, -3 * G), pin('com2', 0, -3 * G, 'COM'), pin('a', G, -3 * G), pin('b', 2 * G, -3 * G),
    ],
    props: [
      { key: 'common', label: 'Common', type: 'select', default: 'cathode', options: [{ value: 'cathode', label: 'Cathode' }, { value: 'anode', label: 'Anode' }] },
    ],
    defaults: { common: 'cathode' },
    segments: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'],
    internalNodes: 8,
    state: () => ({ lit: {} }),
    stamp({ sys, nodes, internal, props, mem, state }) {
      sys.addR(nodes.com1, nodes.com2, R_CLOSED);
      defs.seg7.segments.forEach((s, idx) => {
        const mid = internal[idx];
        const anodeSide = props.common === 'cathode' ? nodes[s] : nodes.com1;
        const cathodeSide = props.common === 'cathode' ? nodes.com1 : nodes[s];
        if (props.common === 'cathode') {
          stampDiode(sys, anodeSide, mid, diodeIs(1.9), 2 * VT, mem, s);
          sys.addR(mid, cathodeSide, 18);
        } else {
          stampDiode(sys, anodeSide, mid, diodeIs(1.9), 2 * VT, mem, s);
          sys.addR(mid, cathodeSide, 18);
        }
      });
      state.internalRefs = internal;
    },
    post({ sys, nodes, internal, props, state }) {
      if (!state.lit) state.lit = {};
      defs.seg7.segments.forEach((s, idx) => {
        const cathodeSide = props.common === 'cathode' ? nodes.com1 : nodes[s];
        const i = sys.vd(internal[idx], cathodeSide) / 18;
        const target = Math.max(0, Math.min(1, Math.pow(Math.max(i, 0) / 0.012, 0.6)));
        state.lit[s] = (state.lit[s] ?? 0) + (target - (state.lit[s] ?? 0)) * 0.4;
      });
    },
    readout: (p) => {
      const lit = p.state?.lit ?? {};
      const on = defs.seg7.segments.filter((s) => (lit[s] ?? 0) > 0.4);
      return on.length ? `Segments ${on.join(' ')}` : 'Dark';
    },
  },

  voltmeter: {
    name: 'Voltmeter',
    group: 'Instruments',
    hint: 'Ten megohm input, so you can hang it anywhere without disturbing the circuit.',
    pins: [pin('pos', -1.5 * G, 0, '+'), pin('neg', 1.5 * G, 0, '−')],
    props: [],
    defaults: {},
    instrument: true,
    stamp({ sys, nodes }) { sys.addR(nodes.pos, nodes.neg, 1e7); },
    post({ sys, nodes, state }) { state.reading = sys.vd(nodes.pos, nodes.neg); },
    display: (p) => formatValue(p.state?.reading ?? 0, 'V'),
    readout: (p) => formatValue(p.state?.reading ?? 0, 'V'),
  },

  ammeter: {
    name: 'Ammeter',
    group: 'Instruments',
    hint: 'Wire it in series. It behaves as a near perfect short.',
    pins: [pin('pos', -1.5 * G, 0, '+'), pin('neg', 1.5 * G, 0, '−')],
    props: [],
    defaults: {},
    instrument: true,
    vsCount: 1,
    stamp({ sys, nodes, branches }) { sys.addVS(branches[0], nodes.pos, nodes.neg, 0); },
    post({ sys, branches, state }) { state.reading = sys.branchCurrent(branches[0]); },
    display: (p) => formatValue(p.state?.reading ?? 0, 'A'),
    readout: (p) => formatValue(p.state?.reading ?? 0, 'A'),
  },

  funcgen: {
    name: 'Signal generator',
    group: 'Power',
    hint: 'Square, sine or triangle output for clocking and blinking things.',
    pins: [pin('out', -1.5 * G, 0, 'OUT'), pin('gnd', 1.5 * G, 0, 'GND')],
    groundPin: 'gnd',
    vsCount: 1,
    props: [
      { key: 'wave', label: 'Waveform', type: 'select', default: 'square', options: [{ value: 'square', label: 'Square' }, { value: 'sine', label: 'Sine' }, { value: 'triangle', label: 'Triangle' }] },
      { key: 'frequency', label: 'Frequency', type: 'slider', unit: 'Hz', min: 0.1, max: 200, step: 0.1, default: 2, live: true },
      { key: 'amplitude', label: 'Amplitude', type: 'slider', unit: 'V', min: 0, max: 15, step: 0.1, default: 5, live: true },
      { key: 'offset', label: 'Offset', type: 'slider', unit: 'V', min: -10, max: 10, step: 0.1, default: 0, live: true },
      { key: 'duty', label: 'Duty cycle', type: 'slider', min: 0.02, max: 0.98, step: 0.01, default: 0.5, live: true, percent: true },
    ],
    defaults: { wave: 'square', frequency: 2, amplitude: 5, offset: 0, duty: 0.5 },
    internalNodes: 1,
    stamp({ sys, nodes, internal, branches, props, time, state }) {
      const phase = (time * props.frequency) % 1;
      let v;
      if (props.wave === 'square') v = phase < props.duty ? props.amplitude : 0;
      else if (props.wave === 'sine') v = props.amplitude * 0.5 * (1 + Math.sin(phase * Math.PI * 2));
      else v = props.amplitude * (phase < 0.5 ? phase * 2 : 2 - phase * 2);
      v += props.offset;
      state.output = v;
      sys.addVS(branches[0], internal[0], nodes.gnd, v);
      sys.addR(internal[0], nodes.out, 1);
    },
    post({ sys, branches, state }) { state.current = -sys.branchCurrent(branches[0]); },
    readout: (p) => `${formatValue(p.state?.output ?? 0, 'V')} @ ${formatValue(p.props.frequency, 'Hz')}`,
  },
};

// Fill in defaults each definition can rely on.
for (const [id, def] of Object.entries(defs)) {
  def.id = id;
  def.defaults = def.defaults ?? {};
  def.props = def.props ?? [];
  if (!def.state) def.state = () => ({});
}

export const CATALOG = defs;
export const GROUPS = ['Boards', 'Power', 'Passive', 'Active', 'Control', 'Input', 'Output', 'Instruments'];

export function makeProps(type) {
  const def = CATALOG[type];
  const out = {};
  for (const p of def.props) out[p.key] = p.default;
  return { ...def.defaults, ...out };
}
