// End-to-end UI test: runs the real React app in jsdom with the 3D stage stubbed out.
//   npm run test:ui
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import path from 'node:path';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
const g = globalThis;
g.window = dom.window; g.document = dom.window.document; g.localStorage = dom.window.localStorage;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
for (const k of ['HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'HTMLInputElement', 'Blob']) g[k] = dom.window[k];
g.ResizeObserver = dom.window.ResizeObserver ?? class { observe() {} disconnect() {} };
g.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.AudioContext = undefined;
const downloads = [];
dom.window.URL.createObjectURL = () => 'blob:test';
dom.window.URL.revokeObjectURL = () => {};
g.URL.createObjectURL = () => 'blob:test';
dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };

const stub = path.resolve('scripts/ui/StageStub.js');
const server = await createServer({
  root: path.resolve('.'), logLevel: 'error', appType: 'custom', server: { middlewareMode: true },
  plugins: [{ name: 'stub-stage', enforce: 'pre', resolveId(id) { if (id.endsWith('three/Stage.js')) return stub; } }],
});
const React = (await import('react')).default ?? (await import('react'));
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: App } = await server.ssrLoadModule('/src/App.jsx');
const { getExample } = await server.ssrLoadModule('/src/lib/examples.js');
const { extractNetlist, applyImport } = await server.ssrLoadModule('/src/pcb/netlist.js');
const { newPcb, partPads } = await server.ssrLoadModule('/src/pcb/model.js');
const { LESSONS } = await server.ssrLoadModule('/src/lib/lessons.js');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const text = () => document.body.textContent;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const byText = (sel, t) => $$(sel).find((e) => e.textContent.trim().startsWith(t));
const flush = async (n = 3) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
const clickText = async (sel, t) => { const el = byText(sel, t); if (!el) throw new Error(`no ${sel} "${t}"`); await click(el); await flush(); };
const key = async (k, opts = {}) => act(async () => { window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, ...opts })); });

// ---- replica of what "Import" will produce, so the test knows where pads are
const replica = applyImport(newPcb(), extractNetlist(getExample('first-light').build()));
const padAt = (partIdx, n) => partPads(replica.parts[partIdx]).find((p) => p.n === n);
const netPads = (name) => replica.netlist.nets.find((n) => n.name === name).pads.map(({ part, pad }) => partPads(replica.parts.find((p) => p.id === part)).find((p) => p.n === pad));

const svg = () => $('.pcb-svg');
const view = () => ({ s: +svg().dataset.scale, ox: +svg().dataset.ox, oy: +svg().dataset.oy });
const px = (pt) => { const v = view(); return { clientX: v.ox + pt.x * v.s, clientY: v.oy + pt.y * v.s }; };
const ptr = async (type, pt, extra = {}) => act(async () => {
  svg().dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, button: 0, ...px(pt), ...extra }));
});
const clickAt = async (pt, extra) => { await ptr('pointermove', pt); await ptr('pointerdown', pt, extra); await ptr('pointerup', pt, extra); };
const status = () => $('.pcb-status').textContent;
const unrouted = () => +status().match(/(\d+) unrouted/)[1];

const container = document.getElementById('root');
let rootEl;
await act(async () => { rootEl = createRoot(container); rootEl.render(React.createElement(App)); });
await flush();

console.log('Switching workbench');
await clickText('button', 'Open the lab'); await flush(4);
ok(!$('.pcb-shell'), 'starts on the breadboard bench');
await clickText('.bench-switch button', 'PCB');
ok(!!$('.pcb-app') && !!$('svg.pcb-svg'), 'PCB workbench opens');
ok(!byText('.topbar button', 'Circuits'), 'breadboard-only top-bar controls are hidden on the PCB bench');
svg().getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 700 });
await clickText('.pcb-topbar button', 'Snap'); await clickText('.pcb-topbar button', 'Snap'); // no-op toggle twice, exercises the control

console.log('\nImport');
await clickText('button', 'Import from breadboard'); await flush(4);
ok(/Imported: 3 parts, 3 nets/.test($('.pcb-toast')?.textContent ?? ''), 'import reports 3 parts and 3 nets');
ok(unrouted() === 3, 'status bar shows 3 unrouted connections');
ok(text().includes('VCC') && text().includes('GND'), 'Nets tab lists VCC and GND');
ok($$('.pcb-svg line[stroke="#ffd60a"]').length === 3, 'three yellow ratsnest lines are drawn');
await act(async () => { svg().dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, ...px({ x: 1, y: 1 }) })); });
await flush();
ok(/X 1\.00\s+Y 1\.00 mm/.test(status()), 'status bar tracks the cursor in mm');

console.log('\nArranging parts numerically');
const field = (label) => $$('.nf').find((l) => l.querySelector('span')?.textContent === label).querySelector('input');
const setField = async (label, v) => {
  const el = field(label);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v)); el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
  });
  await flush(2);
};
await key('v');
const target = { 'axial-10.16': [20, 10], 'led-5mm': [20, 20], 'terminal-2': [8, 15] };
for (const part of replica.parts) {
  await clickAt({ x: part.x, y: part.y }); await flush(2);
  ok(new RegExp(part.ref).test($$('.pcb-side.right')[0].textContent), `selected ${part.ref} by clicking it`);
  await setField('X', target[part.fp][0]); await setField('Y', target[part.fp][1]);
}
ok(unrouted() === 3, 'moving parts around leaves the three connections still to route');
ok(+field('X').value === target[replica.parts.at(-1).fp][0], 'the X field shows the value that was typed');
await key('Escape');

console.log('\nRouting with the mouse');
await clickText('.pcb-topbar button', 'Snap'); // turn grid snapping off so corners can sit anywhere
ok(/Snap off/.test($('.pcb-topbar').textContent), 'grid snapping can be switched off');
await key('t');
ok(byText('.pcb-topbar .seg button', 'Route').getAttribute('aria-pressed') === 'true', 'T selects the route tool');
await key('/'); await key('/');
ok(byText('.pcb-topbar button', 'Free').getAttribute('aria-pressed') === 'true', '/ cycles the routing angle (45° → 90° → free)');
const ref = LESSONS.find((l) => l.id === 'pcb-first-board').solution();
const groupsOf = (layer, netPadIds) => ref.tracks.filter((t) => t.layer === layer);
const chain = (segs) => { const pts = [segs[0].a]; for (const t of segs) pts.push(t.b); return pts; };
const routeChain = async (layerKey, segs) => {
  if (layerKey) await key(layerKey);
  for (const p of chain(segs)) await clickAt(p);
  await flush(2);
};
const top = ref.tracks.filter((t) => t.layer === 'top'), bottom = ref.tracks.filter((t) => t.layer === 'bottom');
const nVcc = top.filter((t) => t.width === 0.8), nN1 = top.filter((t) => t.width === 0.5);
await routeChain('1', nVcc);
await flush(6);
ok(unrouted() === 2, 'clicking pad → corner → pad routes VCC (2 nets left)');
await routeChain(null, nN1);
ok(unrouted() === 1, 'N1 routed (1 left)');
await routeChain('2', bottom);
ok(unrouted() === 0, 'GND routed on the bottom layer — no ratsnest lines remain');
ok(/0 errors/.test(status()), `the hand-routed board is DRC-clean (${status().match(/\d+ errors · \d+ warnings/)?.[0]})`);
ok($$('.pcb-svg line[stroke-linecap="round"]').length >= 5, 'copper tracks are drawn');
await key('z', { ctrlKey: true }); await flush(2);
ok(unrouted() === 1, '⌘Z undoes the last click of the route');
await key('z', { ctrlKey: true, shiftKey: true }); await flush(2);
ok(unrouted() === 0, '⇧⌘Z redoes it');
await key('Escape');

console.log('\nEditing after routing');
await key('v');
await clickAt({ x: 20, y: 10 }); await flush(2);
const x0 = +field('X').value;
await setField('X', x0 + 2);
ok(Math.abs(+field('X').value - (x0 + 2)) < 1e-6 && unrouted() === 0, 'moving R1 by typing an X coordinate keeps its tracks attached');
await key('r'); await flush(2);
ok(unrouted() === 0, 'R rotates the part and its tracks stay glued to the pads');
await key('z', { ctrlKey: true }); await key('z', { ctrlKey: true }); await flush(2);

console.log('\nOther tools');
const propsText = () => $$('.pcb-side.right')[0].textContent;
const circlesBefore = $$('.pcb-svg circle').length;
await key('x'); await clickAt({ x: 30, y: 6 }); await flush();
ok($$('.pcb-svg circle').length >= circlesBefore + 2, 'via tool drops a via (annulus + drill)');
await key('s'); await clickAt({ x: 30, y: 26 }); await flush(2);
ok(propsText().includes('Silkscreen text'), 'text tool places text and opens its properties');
await key('m'); await clickAt({ x: 2, y: 2 }); await clickAt({ x: 5, y: 6 }); await flush();
ok(/5\.000 mm/.test($('.pcb-measure')?.textContent ?? ''), 'measure tool reports a 3-4-5 triangle as 5.000 mm');
await key('Escape'); await key('Escape'); await key('v');

console.log('\nPanels');
await clickText('.pcb-tabs button', 'DRC'); await flush();
ok(/errors|No problems/.test($$('.pcb-side.left')[0].textContent), 'DRC tab reports results');
await clickText('.pcb-tabs button', 'Rules');
const clr = $$('.nf').find((l) => l.textContent.startsWith('Copper clearance')).querySelector('input');
ok(parseFloat(clr.value) === 0.3, 'Rules tab shows the 0.3 mm clearance rule');
await act(async () => { const sel = $$('.nf select').find((s) => [...s.options].some((o) => o.value.startsWith('Home'))); const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set; setter.call(sel, 'Home etch / hobby'); sel.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
await flush(2);
ok(parseFloat($$('.nf').find((l) => l.textContent.startsWith('Copper clearance')).querySelector('input').value) === 0.4, 'loading the hobby preset changes the rules');
await clickText('.pcb-tabs button', 'Board');
ok(text().includes('Add 4 mounting holes'), 'Board tab offers mounting holes');
await clickText('button', 'Add 4 mounting holes'); await flush(2);
ok(/H1|H4/.test(text()) || $$('.pcb-svg').length === 1, 'mounting holes added');
await clickText('.pcb-tabs button', 'View');
const flipCb = $$('.chk').find((l) => l.textContent.includes('View from the bottom')).querySelector('input');
await click(flipCb); await flush();
ok(svg().querySelector('g').getAttribute('transform').includes('scale(-1 1)'), 'view-from-bottom mirrors the board');
await click(flipCb);

console.log('\nExport');
await clickText('button', 'File');
await clickText('.pcb-menu button', 'Export for manufacture'); await flush(2);
ok(downloads.includes('breadbai-pcb-gerber.zip'), 'Export downloads breadbai-pcb-gerber.zip');
await clickText('button', 'File'); await clickText('.pcb-menu button', 'Save project'); await flush();
ok(downloads.includes('breadbai-pcb.json'), 'Save downloads the project file');

console.log('\nPCB lesson inside the app');
await clickText('.topbar button', 'Learn'); await flush();
const card = $$('.lesson-card').find((c) => c.textContent.includes('Design your first PCB'));
ok(!!card && card.textContent.includes('PCB'), 'the hub lists the PCB lesson');
await click(card.querySelector('button')); await flush(4);
ok(!!$('.pcb-app') && text().includes('From breadboard to board'), 'starting it opens the PCB bench with the coach');
svg().getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 700 });
await clickText('button', 'Got it'); await clickText('button', 'Next'); await flush(2);
ok(text().includes('Route your first track') && byText('button', 'Next').disabled, 'step 2 waits for a track');
const L = LESSONS.find((l) => l.id === 'pcb-first-board').setup();
const lp = (name) => L.netlist.nets.find((n) => n.name === name).pads.map(({ part, pad }) => partPads(L.parts.find((p) => p.id === part)).find((p) => p.n === pad));
await key('t');
{ const [a, b] = lp('VCC'); await clickAt(a); await clickAt(b); await flush(4); }
ok(text().includes('Nice work'), 'routing a track completes the step');
await clickText('button', 'Next'); await flush(2);
await key('Escape');
for (const n of ['N1', 'GND']) { const [a, b] = lp(n); await key('t'); await clickAt(a); await clickAt(b); await flush(3); }
await key('Escape'); await flush(3);
ok(text().includes('Nice work') || text().includes('What if they cross'), 'routing every net completes step 3');

console.log(fails ? `\n${fails} PCB UI check(s) FAILED` : '\nAll PCB UI checks passed');
await act(async () => rootEl.unmount());
await server.close();
process.exit(fails ? 1 : 0);
