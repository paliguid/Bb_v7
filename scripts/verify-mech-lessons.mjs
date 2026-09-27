// Headless check that every mechanical lesson step is reachable against the real Machine,
// mirroring how MechEditor actually drives the simulation: structural doc edits rebuild the
// Machine; control edits (duty, apply, …) mutate the live Machine directly and keep running.
//   node scripts/verify-mech-lessons.mjs
import { LESSONS } from '../src/lib/lessons.js';
import { Machine } from '../src/mech/machine.js';
import { addPart, connect } from '../src/mech/assembly.js';
import { getMechPreset } from '../src/mech/presets.js';

let failures = 0;
const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { failures++; console.log(`  ✗ ${m}`); } };

/** A little harness standing in for MechEditor: `edit` mutates the doc structurally (rebuilds),
 * `control` mutates a live part field through Machine.setControl (no rebuild), `run` advances time. */
function harness(doc) {
  let mc = new Machine(doc);
  return {
    doc, get mc() { return mc; },
    edit(fn) { fn(doc); mc = new Machine(doc); },
    control(partId, key, value) { const part = doc.parts.find((p) => p.id === partId); part[key] = value; mc.setControl(partId, key, value); },
    run(seconds, dt = 2e-4) { mc.advance(seconds, dt, 2e6); },
  };
}

const ACTIONS = {
  'mech-gears': {
    0: (h) => h.edit((d) => addPart(d, 'motor', { shaft: d.parts[0].id })),
    1: (h) => h.edit((d) => { const s2 = addPart(d, 'shaft', { x: 45, y: 0 }); addPart(d, 'gear', { shaft: d.parts[0].id, teeth: 20 }); addPart(d, 'gear', { shaft: s2.id, teeth: 40 }); }),
    2: (h) => h.edit((d) => { const gs = d.parts.filter((p) => p.type === 'gear'); const r = connect(d, gs[0].id, gs[1].id); if (r.error) throw new Error(r.error); }),
    3: (h) => h.run(0.6),
  },
  'mech-motor-load': {
    1: (h) => h.run(1.2),
    2: (h) => h.control(h.doc.parts.find((p) => p.type === 'brake').id, 'apply', 0.6),
    4: (h) => { h.control(h.doc.parts.find((p) => p.type === 'brake').id, 'apply', 1); h.run(220, 5e-4); },
  },
  'mech-linear': {
    0: (h) => h.run(0.6),
    1: (h) => h.control(h.doc.parts.find((p) => p.type === 'motor').id, 'duty', -0.1),
    2: (h) => h.edit((d) => Object.assign(d, getMechPreset('screw').build())),
    4: (h) => h.edit((d) => Object.assign(d, getMechPreset('crank-slider').build())),
  },
  'mech-vehicle': {
    1: (h) => h.edit((d) => {
      const veh = d.parts.find((p) => p.type === 'vehicle');
      const ax = addPart(d, 'shaft', { x: 0, y: -20, rx: 180, carrier: veh.id });
      addPart(d, 'motor', { shaft: ax.id, V: 7.2, R: 0.25, Kt: 0.0032, Jr: 8e-6, ratedI: 15, duty: 0.6 });
    }),
    2: (h) => h.edit((d) => {
      const veh = d.parts.find((p) => p.type === 'vehicle'), ax = d.parts.find((p) => p.type === 'shaft');
      const w = addPart(d, 'wheel', { shaft: ax.id, dia: 70, mass: 0.1, crr: 0.01 });
      const r = connect(d, w.id, veh.id); if (r.error) throw new Error(r.error);
    }),
    3: (h) => h.run(3),
    4: (h) => { for (const p of h.doc.parts.filter((q) => q.type === 'wheel')) p.mu = 1.2; h.doc.parts.find((q) => q.type === 'vehicle').mass = 2; h.edit(() => {}); h.run(1); },
  },
};

for (const lesson of LESSONS.filter((l) => l.bench === 'mech')) {
  console.log(`\n${lesson.title}`);
  const h = harness(lesson.setup());
  ok(Array.isArray(h.doc.parts), 'setup builds a document');
  const events = new Set();
  const actions = ACTIONS[lesson.id] ?? {};
  lesson.steps.forEach((step, i) => {
    if (step.quiz) { ok(step.quiz.answer >= 0 && step.quiz.answer < step.quiz.options.length, `step ${i + 1} quiz has a valid answer`); return; }
    if (!step.check) return;
    const ctx = () => ({ mech: h.doc, machine: h.mc, events });
    const a = actions[i];
    if (!a) { ok(false, `step ${i + 1} "${step.title}" has no scripted action`); return; }
    // A final "does everything pass" step is allowed to already be true — it isn't a discrete fix.
    if (step.title !== 'Pass the check') ok(!step.check(ctx()), `step ${i + 1} "${step.title}" starts incomplete`);
    a(h);
    ok(step.check(ctx()), `step ${i + 1} "${step.title}" completes`);
  });
  if (lesson.solution) { const sol = lesson.solution(); const m = new Machine(sol); m.advance(0.3, 2e-4, 1e9); ok(sol.parts.length > 0 && Number.isFinite(m.t), 'solution loads and runs'); }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll mechanical lesson checks passed');
process.exit(failures ? 1 : 0);
