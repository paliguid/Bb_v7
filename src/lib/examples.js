import { CATALOG, makeProps } from './catalog.js';
import { computeInsertion, originForHole } from './placement.js';
import { holeByName } from './board.js';

let counter = 0;
export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export function makePart(type, extra = {}) {
  const def = CATALOG[type];
  return {
    id: extra.id ?? newId(type),
    type,
    x: 0, y: 0, z: 0, rot: 0,
    state: def.state(),
    mem: {},
    inserted: {},
    ...extra,
    props: { ...makeProps(type), ...(extra.props ?? {}) },
  };
}

export const BOARD_ID = 'board';

export function seat(type, holeName, opts = {}) {
  const rot = opts.rot ?? 0;
  const origin = originForHole(type, holeName, rot, opts.pin ?? 0);
  const part = makePart(type, { ...opts, rot, x: origin.x, z: origin.z, y: origin.y, props: opts.props });
  part.inserted = computeInsertion(part, { id: BOARD_ID, x: 0, z: 0 });
  return part;
}

export function loose(type, x, z, opts = {}) {
  return makePart(type, { ...opts, x, z, y: 0, rot: opts.rot ?? 0 });
}

export const hole = (name) => {
  const h = holeByName(name);
  return { kind: 'hole', boardId: BOARD_ID, name, group: h.group };
};
export const pinRef = (partId, pin) => ({ kind: 'pin', partId, pin });

export const wire = (a, b, color = '#d8d8dc') => ({ id: newId('w'), a, b, color });

export function board() {
  return makePart('BreadBai', { id: BOARD_ID, x: 0, z: 0, y: 0 });
}

export const EXAMPLES = [
  {
    id: 'blank',
    name: 'Empty board',
    blurb: 'Just a BreadBai. Start from nothing.',
    build: () => ({ parts: [board()], wires: [] }),
  },
  {
    id: 'first-light',
    name: 'First light',
    blurb: 'A battery, a 470 Ω resistor and a red LED — the classic first circuit.',
    build: () => {
      const bb = board();
      const batt = loose('battery', -68, 26, { rot: -Math.PI / 2 });
      const r = seat('resistor', 'B6', { props: { resistance: 470 } });
      const led = seat('led', 'B10', { props: { color: 'red' } });
      return {
        parts: [bb, batt, r, led],
        wires: [
          wire(pinRef(batt.id, 'pos'), hole('tpos3'), '#ff453a'),
          wire(pinRef(batt.id, 'neg'), hole('tneg3'), '#48484a'),
          wire(hole('tpos8'), hole('A6'), '#ff453a'),
          wire(hole('A11'), hole('tneg12'), '#48484a'),
        ],
      };
    },
  },
  {
    id: 'button-buzzer',
    name: 'Button and buzzer',
    blurb: 'Press the button in the scene and the piezo sounds. Turn your volume up.',
    build: () => {
      const bb = board();
      const supply = loose('supply', -68, 28, { rot: -Math.PI / 2, props: { voltage: 5 } });
      const btn = seat('pushbutton', 'A8');
      const buzz = seat('buzzer', 'C16');
      return {
        parts: [bb, supply, btn, buzz],
        wires: [
          wire(pinRef(supply.id, 'pos'), hole('tpos3'), '#ff453a'),
          wire(pinRef(supply.id, 'neg'), hole('tneg3'), '#48484a'),
          wire(hole('tpos8'), hole('B8'), '#ff453a'),
          wire(hole('B10'), hole('B16'), '#ffd60a'),
          wire(hole('B18'), hole('tneg18'), '#48484a'),
        ],
      };
    },
  },
  {
    id: 'blinker',
    name: 'Transistor blinker',
    blurb: 'A 2 Hz square wave drives the base; the transistor switches the LED. Change the frequency and watch it follow.',
    build: () => {
      const bb = board();
      const batt = loose('battery', -68, 26, { rot: -Math.PI / 2 });
      const gen = loose('funcgen', 68, 26, { rot: Math.PI / 2, props: { frequency: 2, amplitude: 5 } });
      const q = seat('transistor', 'C14');
      const rb = seat('resistor', 'B11', { props: { resistance: 10e3 } });
      const rc = seat('resistor', 'H10', { props: { resistance: 470 } });
      const led = seat('led', 'H14', { props: { color: 'green' } });
      return {
        parts: [bb, batt, gen, q, rb, rc, led],
        wires: [
          wire(pinRef(batt.id, 'pos'), hole('tpos3'), '#ff453a'),
          wire(pinRef(batt.id, 'neg'), hole('tneg3'), '#48484a'),
          wire(hole('tpos6'), hole('bpos6'), '#ff453a'),
          wire(hole('tneg6'), hole('bneg6'), '#48484a'),
          wire(pinRef(gen.id, 'out'), hole('A11'), '#ffd60a'),
          wire(pinRef(gen.id, 'gnd'), hole('bneg22'), '#48484a'),
          wire(hole('bpos10'), hole('F10'), '#ff453a'),
          wire(hole('J15'), hole('D16'), '#30d158'),
          wire(hole('A14'), hole('tneg14'), '#48484a'),
        ],
      };
    },
  },
  {
    id: 'light-lamp',
    name: 'Light-sensitive lamp',
    blurb: 'A light sensor biases the transistor. Slide the light level up and the lamp glows; the trimmer sets the threshold.',
    build: () => {
      const bb = board();
      const batt = loose('battery', -68, 26, { rot: -Math.PI / 2 });
      const ldr = seat('ldr', 'A6', { props: { light: 0.5 } });
      const pot = seat('potentiometer', 'D10', { props: { resistance: 100e3, wiper: 0.5 } });
      const q = seat('transistor', 'C16');
      const rc = seat('resistor', 'H16', { props: { resistance: 470 } });
      const led = seat('led', 'H20', { props: { color: 'amber' } });
      return {
        parts: [bb, batt, ldr, pot, q, rc, led],
        wires: [
          wire(pinRef(batt.id, 'pos'), hole('tpos3'), '#ff453a'),
          wire(pinRef(batt.id, 'neg'), hole('tneg3'), '#48484a'),
          wire(hole('tpos6'), hole('bpos6'), '#ff453a'),
          wire(hole('tneg6'), hole('bneg6'), '#48484a'),
          wire(hole('tpos10'), hole('B6'), '#ff453a'),
          wire(hole('C8'), hole('A10'), '#ffd60a'),
          wire(hole('B11'), hole('tneg14'), '#48484a'),
          wire(hole('D8'), hole('A17'), '#ffd60a'),
          wire(hole('A16'), hole('tneg16'), '#48484a'),
          wire(hole('F16'), hole('bpos14'), '#ff453a'),
          wire(hole('J21'), hole('D18'), '#ff9f0a'),
        ],
      };
    },
  },
];

export const getExample = (id) => EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[1];
