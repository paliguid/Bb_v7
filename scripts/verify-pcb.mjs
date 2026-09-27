// Headless checks for the PCB workbench: footprints, routing, connectivity, DRC, import, and manufacturing output.
//   node scripts/verify-pcb.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FOOTPRINTS, CATALOG_FOOTPRINTS } from '../src/pcb/footprints.js';
import { newPcb, makePart, partPads, pid, serializePcb, deserializePcb } from '../src/pcb/model.js';
import { analyze } from '../src/pcb/analysis.js';
import { routePath } from '../src/pcb/routing.js';
import { extractNetlist, applyImport } from '../src/pcb/netlist.js';
import { fabPackage, svgString, zipStore, excellon } from '../src/pcb/export.js';
import { strokeText, textWidth } from '../src/pcb/font.js';
import { getExample } from '../src/lib/examples.js';
import { LESSONS } from '../src/lib/lessons.js';
import { RULE_PRESETS } from '../src/pcb/model.js';
import { applyTranslate, alignObjects, distributeObjects, duplicateObjects, removeObjects, rotateParts, flipParts, selectRun, addMountingHoles, fitBoardToParts, objectsInBox, reshapePart } from '../src/pcb/edit.js';
import { CATALOG } from '../src/lib/catalog.js';

let failures = 0;
const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { failures++; console.log(`  ✗ ${m}`); } };
const rules = (d) => analyze(d).drc.map((x) => x.rule);
const track = (layer, a, b, width = 0.5) => ({ id: pid('t'), layer, width, a, b });
const routeTracks = (layer, from, to, mode, flip, width) => {
  const pts = routePath(from, to, mode, flip);
  return pts.slice(1).map((p, i) => track(layer, pts[i], p, width));
};

console.log('Footprints');
ok(Object.keys(FOOTPRINTS).length >= 20, `${Object.keys(FOOTPRINTS).length} footprints in the library`);
for (const [type, m] of Object.entries(CATALOG_FOOTPRINTS)) {
  const fp = FOOTPRINTS[m.fp];
  const pads = new Set(fp.pads.map((p) => p.n));
  const missing = CATALOG[type].pins.filter((p) => !pads.has(m.map[p.name] ?? p.name));
  ok(fp && missing.length === 0, `${type} → ${m.fp}: every pin has a pad`);
}
for (const [id, fp] of Object.entries(FOOTPRINTS)) {
  if (new Set(fp.pads.map((p) => p.n)).size !== fp.pads.length) ok(false, `${id} has duplicate pad names`);
  if (fp.pads.some((p) => p.drill >= Math.min(p.w, p.h))) ok(false, `${id} has a pad smaller than its drill`);
}

console.log('\nRouting modes');
{
  const from = { x: 0, y: 0 }, to = { x: 10, y: 4 };
  for (const flip of [false, true]) {
    const p45 = routePath(from, to, '45', flip);
    const angles = p45.slice(1).map((q, i) => Math.atan2(q.y - p45[i].y, q.x - p45[i].x) * 180 / Math.PI);
    ok(p45.at(-1).x === 10 && p45.at(-1).y === 4 && angles.every((a) => Math.abs(a / 45 - Math.round(a / 45)) < 1e-9), `45° route lands exactly on target and uses only 45° angles (flip=${flip})`);
  }
  const p90 = routePath(from, to, '90', false);
  ok(p90.length === 3 && p90.slice(1).every((q, i) => q.x === p90[i].x || q.y === p90[i].y), '90° route is orthogonal');
  ok(routePath(from, to, 'free').length === 2, 'free route is one straight segment');
  ok(routePath(from, { x: 5, y: 5 }, '45').length === 2, 'a pure diagonal needs no dog-leg');
  ok(routePath(from, from, '45').length === 1, 'zero-length route collapses');
}

console.log('\nImport from the breadboard');
const bb = getExample('first-light').build();
const imp = extractNetlist(bb);
ok(imp.parts.length === 3, `3 physical parts found (${imp.parts.map((p) => p.type).join(', ')})`);
ok(imp.nets.length === 3 && imp.nets.every((n) => n.pins.length === 2), `3 nets of 2 pins (${imp.nets.map((n) => n.name).join(', ')})`);
ok(['VCC', 'GND'].every((n) => imp.nets.some((x) => x.name === n)), 'supply nets are named VCC and GND');
let pcb = applyImport(newPcb(), imp);
ok(pcb.parts.length === 3 && pcb.netlist.nets.length === 3, 'parts and netlist land in the PCB document');
ok(pcb.board.w >= 40 && pcb.board.h >= 30, `board auto-sized to ${pcb.board.w}×${pcb.board.h} mm`);
ok(pcb.parts.map((p) => p.ref).sort().join() === 'BT1,D1,R1', `references assigned (${pcb.parts.map((p) => p.ref).join(', ')})`);
ok(pcb.netWidths.VCC === 0.8 && pcb.netWidths.GND === 0.8, 'power nets get a wider default track');
let a = analyze(pcb);
ok(a.airwires.length === 3, `ratsnest has 3 airwires (got ${a.airwires.length})`);
ok(a.drc.filter((d) => d.rule !== 'unrouted').length === 0, `fresh import breaks no other rule (${rules(pcb).filter((r) => r !== 'unrouted')})`);
const again = applyImport(pcb, imp);
ok(again.parts.length === 3, 're-importing keeps placements and adds no duplicates');

console.log('\nRouting a real board');
const doc = newPcb();
doc.board = { w: 40, h: 30, r: 2 };
const R1 = makePart(doc, 'axial-10.16', 20, 10, { srcId: 'r' });
const D1 = makePart(doc, 'led-5mm', 20, 20, { srcId: 'd' });
const BT1 = makePart(doc, 'terminal-2', 8, 15, { srcId: 'b', prefix: 'BT' });
doc.parts.push(R1, D1, BT1);
doc.netlist = { nets: [
  { name: 'VCC', pads: [{ part: BT1.id, pad: '1' }, { part: R1.id, pad: 'a' }] },
  { name: 'N1', pads: [{ part: R1.id, pad: 'b' }, { part: D1.id, pad: 'a' }] },
  { name: 'GND', pads: [{ part: D1.id, pad: 'k' }, { part: BT1.id, pad: '2' }] },
] };
const pad = (part, n) => partPads(part).find((p) => p.n === n);
ok(analyze(doc).airwires.length === 3, 'three unrouted connections before routing');

doc.tracks.push(...routeTracks('top', pad(BT1, '1'), pad(R1, 'a'), '45', true, 0.8));
a = analyze(doc);
ok(a.airwires.length === 2, 'routing VCC removes its airwire');
ok(a.itemNet.get(doc.tracks[0].id) === 'VCC', 'the track knows it belongs to VCC');
doc.tracks.push(...routeTracks('top', pad(R1, 'b'), pad(D1, 'a'), '45', false, 0.5));
doc.tracks.push(...routeTracks('bottom', pad(D1, 'k'), pad(BT1, '2'), '90', true, 0.8));
a = analyze(doc);
ok(a.airwires.length === 0, 'all three nets are connected');
ok(a.stats.errors === 0, `DRC is clean (${a.drc.map((d) => d.msg).join('; ') || 'no violations'})`);
ok(a.stats.trackLength > 20, `track length is measured (${a.stats.trackLength.toFixed(1)} mm)`);
{ // the bottom GND track crosses the top N1 track without joining it — different layers
  const cross = analyze(doc);
  ok(cross.stats.shorts === 0, 'tracks crossing on different layers do not short');
}

console.log('\nDesign rules catch mistakes');
const mutate = (fn) => { const d = structuredClone(doc); fn(d); return d; };
ok(rules(mutate((d) => d.tracks.push(track('top', { x: 30, y: 5 }, { x: 33, y: 5 }, 0.1)))).includes('min-width'), 'track thinner than the rule');
ok(rules(mutate((d) => d.tracks.push(track('top', { x: 30, y: 5 }, { x: 33, y: 5 })))).includes('dangling'), 'track end connected to nothing');
{ // routing GND on the SAME layer across N1 → short
  const d = mutate((x) => { x.tracks = x.tracks.filter((t) => t.layer === 'top'); x.tracks.push(...routeTracks('top', pad(D1, 'k'), pad(BT1, '2'), '45', true, 0.8)); });
  const r = analyze(d);
  ok(r.stats.shorts >= 1 && r.drc.some((x) => x.rule === 'short' && /GND/.test(x.msg) && /N1/.test(x.msg)), 'same-layer crossing is reported as a short between GND and N1');
}
{ // a track that passes close to (but does not touch) an unrelated pad
  const d = mutate((x) => x.tracks.push(track('top', { x: 30, y: 24 }, { x: 30, y: 27 })));
  d.parts.push(makePart(d, 'testpoint', 31.4, 25.5));
  ok(rules(d).includes('clearance'), 'copper closer than the clearance rule');
}
ok(rules(mutate((d) => d.tracks.push(track('top', { x: 39.9, y: 5 }, { x: 36, y: 5 })))).includes('edge'), 'copper hugging the board edge');
ok(rules(mutate((d) => d.tracks.push(track('top', { x: 45, y: 5 }, { x: 41, y: 5 })))).includes('edge'), 'copper outside the board');
ok(rules(mutate((d) => d.vias.push({ id: pid('v'), x: 30, y: 8, dia: 0.6, drill: 0.5 }))).includes('annular'), 'via with too thin a copper ring');
{ // vias join layers
  const d = mutate((x) => {
    x.netlist.nets.push({ name: 'X', pads: [{ part: R1.id, pad: 'a' }, { part: D1.id, pad: 'k' }] });
  });
  ok(analyze(d).nets.find((n) => n.name === 'X') !== undefined, 'extra nets are tracked');
}
{
  const d = newPcb(); d.board = { w: 30, h: 30, r: 0 };
  const a1 = makePart(d, 'testpoint', 10, 10), a2 = makePart(d, 'testpoint', 20, 10);
  d.parts.push(a1, a2);
  d.netlist = { nets: [{ name: 'S', pads: [{ part: a1.id, pad: '1' }, { part: a2.id, pad: '1' }] }] };
  const via = { id: pid('v'), x: 15, y: 10, dia: 1, drill: 0.5 };
  d.vias.push(via);
  d.tracks.push(track('top', { x: 10, y: 10 }, { x: 15, y: 10 }), track('bottom', { x: 15, y: 10 }, { x: 20, y: 10 }));
  ok(analyze(d).airwires.length === 0, 'a via joins a top track to a bottom track');
  d.vias = [];
  ok(analyze(d).airwires.length === 1, 'without the via the net is open again');
}

console.log('\nEditing operations');
{
  const d = structuredClone(doc);
  const base = structuredClone(d);
  const r1 = d.parts.find((p) => p.id === R1.id);
  const attachedBefore = d.tracks.filter((t) => [t.a, t.b].some((e) => Math.hypot(e.x - pad(R1, 'a').x, e.y - pad(R1, 'a').y) < 0.02));
  applyTranslate(d, base, [R1.id], 2.54, 1.27, true);
  ok(r1.x === 22.54 && r1.y === 11.27, 'moving a part moves it by the delta (from the gesture start, no drift)');
  const newPadA = partPads(r1).find((p) => p.n === 'a');
  const stillTouching = d.tracks.filter((t) => [t.a, t.b].some((e) => Math.hypot(e.x - newPadA.x, e.y - newPadA.y) < 0.02));
  ok(attachedBefore.length > 0 && stillTouching.length === attachedBefore.length, 'tracks stay attached to the part’s pads when it moves');
  ok(analyze(d).airwires.length === 0, 'the board is still fully connected after the move');
  const d2 = structuredClone(doc);
  applyTranslate(d2, structuredClone(d2), [R1.id], 5, 0, false);
  ok(analyze(d2).airwires.length > 0, 'with “keep attached” off, moving a part opens its nets');
  const d3 = structuredClone(doc);
  rotateParts(d3, [R1.id]);
  ok(d3.parts.find((p) => p.id === R1.id).rot === 90 && analyze(d3).airwires.length === 0, 'rotating a part keeps its tracks glued to the rotated pads');
  const d4 = structuredClone(doc);
  flipParts(d4, [D1.id]);
  ok(d4.parts.find((p) => p.id === D1.id).side === 'bottom' && analyze(d4).airwires.length === 0, 'flipping a part to the bottom keeps it connected');
  const d5 = structuredClone(doc);
  d5.parts.find((p) => p.id === R1.id).locked = true;
  applyTranslate(d5, structuredClone(d5), [R1.id], 9, 9, true);
  ok(d5.parts.find((p) => p.id === R1.id).x === 20, 'locked parts refuse to move');
  const d6 = structuredClone(doc);
  const dup = duplicateObjects(d6, [R1.id]);
  ok(dup.length === 1 && d6.parts.length === 4 && d6.parts.at(-1).ref === 'R2' && !d6.parts.at(-1).srcId, 'duplicate creates R2 with a fresh reference');
  removeObjects(d6, [R1.id]);
  ok(!d6.parts.some((p) => p.id === R1.id) && d6.netlist.nets.every((n) => n.pads.every((q) => q.part !== R1.id)), 'deleting a part also removes it from the netlist');
  const d7 = structuredClone(doc);
  const run = selectRun(d7, d7.tracks[0].id);
  ok(run.length === routePath(pad(BT1, '1'), pad(R1, 'a'), '45', true).length - 1, `“select whole run” follows connected segments (${run.length})`);
  const d8 = newPcb();
  const p1 = makePart(d8, 'testpoint', 10, 10), p2 = makePart(d8, 'testpoint', 20, 14), p3 = makePart(d8, 'testpoint', 40, 20);
  d8.parts.push(p1, p2, p3);
  alignObjects(d8, [p1.id, p2.id, p3.id], 'y', 'min');
  ok(d8.parts.every((p) => Math.abs(p.y - d8.parts[0].y) < 1e-9), 'align tops puts every part on one line');
  distributeObjects(d8, [p1.id, p2.id, p3.id], 'x');
  ok(Math.abs(d8.parts[1].x - 25) < 1e-6, 'distribute spaces the middle part evenly');
  const d9 = newPcb(); d9.board = { w: 50, h: 40, r: 0 };
  addMountingHoles(d9, 3.5);
  ok(d9.parts.length === 4 && d9.parts.every((p) => p.fp === 'mount-m3') && analyze(d9).drc.length === 0, 'four mounting holes land in the corners and pass the DRC');
  const d10 = structuredClone(doc);
  fitBoardToParts(d10, 5);
  ok(analyze(d10).stats.errors === 0 && d10.board.w <= doc.board.w, `“fit to parts” resizes the board to ${d10.board.w}×${d10.board.h} mm and stays DRC-clean`);
  ok(objectsInBox(doc, { x: 0, y: 0 }, { x: 15, y: 30 }).includes(BT1.id) && !objectsInBox(doc, { x: 0, y: 0 }, { x: 15, y: 30 }).includes(D1.id), 'box selection picks only what is inside');
  const d11 = structuredClone(doc);
  reshapePart(d11, R1.id, { x: 22, y: 10 });
  ok(analyze(d11).airwires.length === 0, 'typing a new X coordinate drags attached tracks along');
}

console.log('\nPCB lessons');
{
  const run = (id, actions) => {
    const lesson = LESSONS.find((l) => l.id === id);
    const d = lesson.setup();
    const state = { events: new Set() };
    const ctx = () => ({ pcb: d, analysis: analyze(d), events: state.events });
    console.log(` ${lesson.title}`);
    lesson.steps.forEach((step, i) => {
      if (step.quiz) { ok(step.quiz.answer < step.quiz.options.length, `step ${i + 1} quiz is valid`); return; }
      if (!step.check) return;
      const a = actions[i];
      if (!a) { ok(false, `step ${i + 1} "${step.title}" has no scripted action`); return; }
      state.events = new Set();
      ok(!step.check(ctx()), `step ${i + 1} "${step.title}" starts incomplete`);
      a(d, state);
      ok(step.check(ctx()), `step ${i + 1} "${step.title}" completes`);
    });
    return d;
  };
  const solved = LESSONS.find((l) => l.id === 'pcb-first-board').solution();
  ok(analyze(solved).stats.errors === 0 && analyze(solved).stats.unrouted === 0, 'the reference board is DRC-clean and fully routed');
  ok(analyze({ ...solved, rules: { ...solved.rules, ...RULE_PRESETS['Home etch / hobby'] } }).stats.errors === 0, 'the reference board also passes the hobby-etch rules');

  run('pcb-first-board', {
    1: (d) => d.tracks.push(solved.tracks[0]),
    2: (d) => { d.tracks = structuredClone(solved.tracks); },
    4: (d) => { Object.assign(d.rules, RULE_PRESETS['Home etch / hobby']); },
    6: (d, st) => st.events.add('export'),
  });
  const after = run('pcb-controls', {
    1: (d) => { d.grid.size = 0.5; },
    2: (d) => d.vias.push({ id: pid('v'), x: 30, y: 8, dia: 0.9, drill: 0.5 }),
    3: (d) => { d.netWidths.VCC = 1.2; const a = analyze(d); for (const t of d.tracks) if (a.itemNet.get(t.id) === 'VCC') t.width = 1.2; },
    4: (d) => addMountingHoles(d, 3.5),
    5: (d) => d.texts.push({ id: pid('x'), text: '+9V', x: 30, y: 26, size: 1.5, layer: 'top', rot: 0 }),
    6: (d, st) => st.events.add('export'),
  });
  ok(analyze(after).stats.errors === 0, 'after every step the board is still DRC-clean');
}

console.log('\nFiles');
const round = deserializePcb(JSON.parse(serializePcb(doc)));
ok(round.parts.length === 3 && round.tracks.length === doc.tracks.length && round.netlist.nets.length === 3, 'save → load round trip');
ok((() => { try { deserializePcb({}); return false; } catch { return true; } })(), 'garbage files are rejected');

const files = fabPackage(doc, 'demo');
ok(files.length === 8, `fab package has ${files.length} files: ${files.map((f) => f.name).join(', ')}`);
const byName = Object.fromEntries(files.map((f) => [f.name.replace('demo', ''), f.data]));
const cu = byName['-F_Cu.gbr'];
ok(/%MOMM\*%/.test(cu) && /%FSLAX46Y46\*%/.test(cu) && cu.trim().endsWith('M02*'), 'Gerber header and footer are present');
ok(new Set(cu.match(/%ADD\d+[A-Z],[^*]+\*%/g)).size >= 3, 'apertures defined for tracks and pads');
{
  const coords = [...cu.matchAll(/X(-?\d+)Y(-?\d+)D0[123]/g)].map((m) => [+m[1] / 1e6, +m[2] / 1e6]);
  ok(coords.length > 10 && coords.every(([x, y]) => x >= 0 && x <= 40 && y >= 0 && y <= 30), `${coords.length} coordinates, all inside the 40×30 mm board`);
}
ok((cu.match(/D03\*/g) ?? []).length === 6, `top copper flashes every one of the 6 pads (${(cu.match(/D03\*/g) ?? []).length})`);
ok((byName['-B_Cu.gbr'].match(/D01\*/g) ?? []).length >= 1, 'bottom copper contains the GND track');
{
  // outline: every arc must have its centre equidistant from its start and end
  const lines = byName['-Edge_Cuts.gbr'].split('\n');
  let cur = null, bad = 0, arcs = 0, mode = 'G01';
  for (const l of lines) {
    if (/^G0[123]\*$/.test(l)) mode = l.slice(0, 3);
    const m = l.match(/^X(-?\d+)Y(-?\d+)(?:I(-?\d+)J(-?\d+))?D0([123])\*$/);
    if (!m) continue;
    const p = [+m[1] / 1e6, +m[2] / 1e6];
    if (m[5] === '1' && mode === 'G03' && m[3] !== undefined && cur) {
      arcs++;
      const c = [cur[0] + m[3] / 1e6, cur[1] + m[4] / 1e6];
      if (Math.abs(Math.hypot(cur[0] - c[0], cur[1] - c[1]) - Math.hypot(p[0] - c[0], p[1] - c[1])) > 1e-6) bad++;
    }
    cur = p;
  }
  ok(arcs === 4 && bad === 0, `outline has 4 rounded corners, each arc is geometrically consistent`);
}
{
  const drl = excellon(doc);
  const hits = (drl.match(/^X[\d.]+Y[\d.]+$/gm) ?? []).length;
  const expected = partPads(R1).length + partPads(D1).length + partPads(BT1).length;
  ok(hits === expected, `Excellon lists every hole (${hits} of ${expected})`);
  ok(/T1C0\.\d+/.test(drl) && drl.trim().endsWith('M30'), 'drill tools are defined');
}
ok(/<svg[\s\S]*<\/svg>/.test(svgString(doc)) && /<svg/.test(svgString(doc, { side: 'bottom', style: 'technical' })), 'SVG renders both sides');
{
  const dir = mkdtempSync(path.join(tmpdir(), 'pcb-'));
  const zipPath = path.join(dir, 'demo.zip');
  writeFileSync(zipPath, zipStore(files));
  let out = '';
  try { out = execFileSync('python3', ['-c', `import zipfile,sys;z=zipfile.ZipFile('${zipPath}');print(z.testzip() or 'OK');print(len(z.namelist()));print(z.read('demo-Edge_Cuts.gbr')[:8].decode())`]).toString(); } catch (e) { out = String(e); }
  ok(/^OK\n8\n/.test(out), 'the ZIP passes an independent integrity test (CRC + 8 entries)');
}

console.log('\nSilkscreen font');
{
  const segs = strokeText('R1 470Ω', { h: 1 });
  ok(segs.length > 15, `text becomes ${segs.length} line segments`);
  ok(textWidth('AB', 2) > textWidth('A', 2), 'text width grows with length');
  const m = strokeText('AB', { h: 1 }), mm = strokeText('AB', { h: 1, mirror: true });
  ok(Math.abs(m[0].x1 + mm[0].x1) < 3, 'mirroring flips text for the bottom silkscreen');
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll PCB checks passed');
process.exit(failures ? 1 : 0);
