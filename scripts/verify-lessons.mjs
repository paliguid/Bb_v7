// Headless check that every lesson step can actually be completed, and that the
// Circuit Check rules fire on the mistakes they claim to catch.
//   node scripts/verify-lessons.mjs
import { LESSONS } from '../src/lib/lessons.js';
import { Circuit } from '../src/lib/circuit.js';
import { CATALOG } from '../src/lib/catalog.js';
import { computeInsertion } from '../src/lib/placement.js';
import { diagnose } from '../src/lib/diagnose.js';
import { seat, wire, hole, pinRef, loose, board } from '../src/lib/examples.js';
import { firstOf } from '../src/lib/inspect.js';

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { failures++; console.log(`  ✗ ${msg}`); } };

const DT = 1e-3;
const sim = (circuit, seconds) => { for (let i = 0; i < Math.round(seconds / DT); i++) circuit.step(DT); };
const rebuild = (doc) => new Circuit(doc.parts, doc.wires);
const seatAgain = (part) => { part.inserted = computeInsertion(part, { id: 'board', x: 0, z: 0 }); };
const resetAll = (doc, circuit) => {
  circuit.reset();
  for (const p of doc.parts) { p.state = CATALOG[p.type].state(); p.mem = {}; }
};

// One entry per checkable step: what a person would do, and how long to let it settle.
const ACTIONS = {
  basics: {
    1: { pre: (s) => { s.mode = 'nets'; }, secs: 0.1 },
    2: { act: (d) => d.parts.push(seat('resistor', 'B6')), secs: 0.1 },
    3: { act: (d) => d.parts.push(seat('led', 'B10')), secs: 0.1 },
  },
  'first-led': {
    1: { act: (d) => d.parts.push(seat('resistor', 'B6', { props: { resistance: 470 } })), secs: 0.1 },
    2: { act: (d) => d.parts.push(seat('led', 'B10', { props: { color: 'red' } })), secs: 0.1 },
    3: { act: (d) => { d.wires.push(wire(hole('tpos8'), hole('A6')), wire(hole('A11'), hole('tneg12'))); }, secs: 0.6 },
    4: { act: (d) => { const l = firstOf(d, 'led'); l.rot += Math.PI; seatAgain(l); }, secs: 0.6 },
    5: { act: (d) => { const l = firstOf(d, 'led'); l.rot += Math.PI; seatAgain(l); }, secs: 0.6 },
    6: { act: (d) => { firstOf(d, 'resistor').props.resistance = 10; }, secs: 1.5 },
    7: { act: (d, c) => { firstOf(d, 'resistor').props.resistance = 470; resetAll(d, c); }, secs: 0.6 },
  },
  'ohms-law': {
    2: { act: (d) => { firstOf(d, 'supply').props.voltage = 9; }, secs: 0.1 },
    4: { act: (d) => { firstOf(d, 'resistor').props.resistance = 2000; }, secs: 0.1 },
    6: { act: (d) => { firstOf(d, 'resistor').props.resistance = 100; }, secs: 0.1 },
  },
  'rc-circuit': {
    1: { act: (d, c, s) => { s.running = true; }, secs: 0.6 },
    3: { act: () => {}, secs: 5.2 },
    4: { act: (d) => { firstOf(d, 'capacitor').props.capacitance = 1e-3; }, secs: 0.1 },
    5: { act: (d, c) => { resetAll(d, c); }, secs: 10, note: 'reset then run 10 s' },
  },
  'transistor-switch': {
    1: { act: (d) => { firstOf(d, 'ldr').props.light = 0.02; }, secs: 1.0 },
    2: { act: (d) => { firstOf(d, 'ldr').props.light = 0.9; }, secs: 1.0 },
    4: { act: (d, c, s) => { s.events.add('prop:potentiometer:wiper'); }, secs: 0.1 },
  },
  'challenge-two-leds': {
    1: {
      act: (d) => {
        d.parts.push(seat('resistor', 'B6', { props: { resistance: 470 } }));
        d.parts.push(seat('led', 'B10'));
        d.parts.push(seat('led', 'C11'));
        d.wires.push(wire(hole('tpos8'), hole('A6')), wire(hole('A12'), hole('tneg13')));
      },
      secs: 0.8,
    },
    2: { act: (d, c, s) => { s.events.add('doctor'); }, secs: 0.2 },
  },
};

console.log('Lessons');
for (const lesson of LESSONS.filter((l) => !l.bench)) {
  console.log(`\n${lesson.title}`);
  const doc = lesson.setup();
  ok(doc.parts.length > 0, 'setup builds a document');
  let circuit = rebuild(doc);
  const state = { mode: 'standard', running: !lesson.startPaused, events: new Set(), selection: null };
  const ctx = () => ({ doc, circuit, ...state });
  sim(circuit, 0.3);
  if (lesson.startPaused) { /* stays at t=0 until "play" */ circuit.reset(); state.running = false; }

  const actions = ACTIONS[lesson.id] ?? {};
  lesson.steps.forEach((step, i) => {
    if (step.quiz) {
      ok(step.quiz.answer >= 0 && step.quiz.answer < step.quiz.options.length, `step ${i + 1} quiz has a valid answer`);
      return;
    }
    if (!step.check) return;
    const a = actions[i];
    if (!a) { ok(false, `step ${i + 1} "${step.title}" has no scripted action`); return; }
    state.events = new Set();
    a.pre?.(state);
    // the check must NOT already be satisfied before the person acts (unless the pre-condition is the action)
    if (!a.pre) ok(!step.check(ctx()), `step ${i + 1} "${step.title}" starts incomplete`);
    a.act?.(doc, circuit, state);
    circuit = rebuild(doc);
    // rc-circuit: restarting the clock is part of the action, paused clock advances only while running
    if (state.running) sim(circuit, a.secs ?? 0.5);
    ok(step.check(ctx()), `step ${i + 1} "${step.title}" completes${a.note ? ` (${a.note})` : ''}`);
  });
  if (lesson.solution) {
    const sol = lesson.solution();
    const c = rebuild(sol); sim(c, 0.5);
    ok(sol.parts.length > 0, 'solution circuit loads');
  }
}

// ------------------------------------------------------------------ Circuit Check
console.log('\nCircuit Check');
const rules = (doc, secs = 1) => { const c = rebuild(doc); sim(c, secs); return diagnose(doc, c).map((d) => d.rule); };
const battery = () => loose('battery', -68, 26, { rot: -Math.PI / 2 });
const rails = (b) => [wire(pinRef(b.id, 'pos'), hole('tpos3')), wire(pinRef(b.id, 'neg'), hole('tneg3'))];

{ // healthy first-light
  const b = battery();
  const doc = { parts: [board(), b, seat('resistor', 'B6', { props: { resistance: 470 } }), seat('led', 'B10')],
    wires: [...rails(b), wire(hole('tpos8'), hole('A6')), wire(hole('A11'), hole('tneg12'))] };
  const r = rules(doc);
  ok(!r.some((x) => x !== undefined && x !== 'info'), `healthy circuit raises nothing (${JSON.stringify(r)})`);
}
{ // LED straight across the battery → too much current / burnt
  const b = battery();
  const doc = { parts: [board(), b, seat('led', 'B10')], wires: [...rails(b), wire(hole('tpos8'), hole('A10')), wire(hole('A11'), hole('tneg12'))] };
  const r = rules(doc, 1.2);
  ok(r.includes('led-burnt') || r.includes('led-current'), `LED with no resistor is flagged (${r})`);
}
{ // LED backwards
  const b = battery();
  const led = seat('led', 'B10'); led.rot = Math.PI; seatAgain(led);
  const doc = { parts: [board(), b, seat('resistor', 'B6', { props: { resistance: 470 } }), led],
    wires: [...rails(b), wire(hole('tpos8'), hole('A6')), wire(hole('A11'), hole('tneg12'))] };
  ok(rules(doc).includes('led-reversed'), 'reversed LED is flagged');
}
{ // half-connected resistor (right leg in an empty strip)
  const b = battery();
  const doc = { parts: [board(), b, seat('resistor', 'B6')], wires: [...rails(b), wire(hole('tpos8'), hole('A6'))] };
  ok(rules(doc).includes('open-pin'), 'dead-end lead is flagged');
}
{ // battery shorted with a wire
  const b = battery();
  const doc = { parts: [board(), b], wires: [...rails(b), wire(hole('tpos8'), hole('tneg8'))] };
  ok(rules(doc, 0.2).includes('short'), 'short circuit is flagged');
}
{ // ammeter across the supply
  const s = loose('supply', -68, 28, { rot: -Math.PI / 2 });
  const a = loose('ammeter', 0, -46);
  const doc = { parts: [board(), s, a], wires: [
    ...[wire(pinRef(s.id, 'pos'), hole('tpos3')), wire(pinRef(s.id, 'neg'), hole('tneg3'))],
    wire(pinRef(a.id, 'pos'), hole('tpos10')), wire(pinRef(a.id, 'neg'), hole('tneg10'))] };
  const r = rules(doc, 0.2);
  ok(r.includes('ammeter-short'), `ammeter across a supply is flagged (${r})`);
}
{ // hot resistor
  const s = loose('supply', -68, 28, { rot: -Math.PI / 2, props: { voltage: 9 } });
  const doc = { parts: [board(), s, seat('resistor', 'B6', { props: { resistance: 100 } })], wires: [
    wire(pinRef(s.id, 'pos'), hole('tpos3')), wire(pinRef(s.id, 'neg'), hole('tneg3')),
    wire(hole('tpos8'), hole('A6')), wire(hole('A10'), hole('tneg12'))] };
  ok(rules(doc, 0.3).includes('resistor-hot'), 'over-power resistor is flagged');
}
{ // no power
  ok(rules({ parts: [board(), seat('resistor', 'B6')], wires: [] }, 0.1).includes('no-power'), 'missing power source is mentioned');
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
