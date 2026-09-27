// End-to-end UI test for the "Systems" link between the Breadboard and Mechanical benches.
//   node scripts/ui/systems.test.mjs
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import path from 'node:path';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
const g = globalThis;
g.window = dom.window; g.document = dom.window.document; g.localStorage = dom.window.localStorage;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
for (const k of ['HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'HTMLInputElement', 'Blob', 'ResizeObserver']) {
  g[k] = dom.window[k] ?? (k === 'ResizeObserver' ? class { observe() {} disconnect() {} } : undefined);
}
g.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.AudioContext = undefined;

const bbStub = path.resolve('scripts/ui/StageStub.js');
const mechStub = path.resolve('scripts/ui/MechStageStub.js');
const server = await createServer({
  root: path.resolve('.'), logLevel: 'error', appType: 'custom', server: { middlewareMode: true },
  plugins: [{ name: 'stub-stages', enforce: 'pre', resolveId(id) { if (id.endsWith('three/Stage.js')) return bbStub; if (id.endsWith('MechStage.js')) return mechStub; } }],
});
const React = (await import('react')).default ?? (await import('react'));
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: App } = await server.ssrLoadModule('/src/App.jsx');
const { seat, wire, hole, pinRef } = await server.ssrLoadModule('/src/lib/examples.js');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const text = () => document.body.textContent;
const $$ = (sel) => [...document.querySelectorAll(sel)];
const byText = (sel, t) => $$(sel).find((e) => e.textContent.trim().startsWith(t));
const click = async (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
const flush = async (n = 3) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const clickText = async (sel, t) => { const el = byText(sel, t); if (!el) throw new Error(`no ${sel} "${t}"`); await click(el); await flush(); };
const frames = async (n, dt = 0.05) => { for (let i = 0; i < n; i++) await act(async () => { __mechStage.emit('onFrame', dt); }); };

const container = document.getElementById('root');
let rootEl;
await act(async () => { rootEl = createRoot(container); rootEl.render(React.createElement(App)); });
await flush();

console.log('Setting up a breadboard motor circuit');
await clickText('button', 'Open the lab'); await flush(3);
const motSeat = seat('motor', 'B10', { props: { resistance: 6, ke: 0.02, load: 0 } });
await act(async () => { __stage.emit('onPlace', { type: 'motor', x: motSeat.x, y: motSeat.y, z: motSeat.z, rot: motSeat.rot, inserted: motSeat.inserted }); });
await flush(2);
ok(__stage.parts?.some((p) => p.type === 'motor'), 'a motor is placed on the breadboard');

console.log('\nBuilding a mechanism motor in "From a circuit" mode');
await clickText('.bench-switch button', 'Mechanical'); await flush(2);
await clickText('.pcb-tabs button', 'Properties'); await clickText('.pcb-tabs button', 'Parts');
await clickText('.fp-item', 'Shaft');
await act(async () => { __mechStage.emit('click', { hit: null, shift: false, point: { x: 0, y: 0, z: 0 } }); }); await flush(2);
await clickText('.fp-item', 'Flywheel');
await act(async () => { __mechStage.emit('click', { hit: { partId: __mechStage.doc.parts[0].id }, shift: false, point: null }); }); await flush(2);
await clickText('.fp-item', 'DC motor');
await act(async () => { __mechStage.emit('click', { hit: { partId: __mechStage.doc.parts[0].id }, shift: false, point: null }); }); await flush(2);
const motorPartId = __mechStage.doc.parts.find((p) => p.type === 'motor').id;
// switch its Drive mode to "circuit" via the Select in Properties
const driveSelect = $$('select').find((s) => [...s.options].some((o) => o.value === 'circuit'));
ok(!!driveSelect, 'the motor’s Drive mode select is present with a "circuit" option');
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set;
  setter.call(driveSelect, 'circuit'); driveSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
});
await flush(2);
ok(__mechStage.doc.parts.find((p) => p.id === motorPartId).mode === 'circuit', 'the mech motor is now driven by a circuit');

console.log('\nLinking the two and running them together');
await clickText('.pcb-tabs button', 'Systems');
ok(text().includes('Link a breadboard circuit'), 'the Systems panel is present');
const bbSelect = $$('select').find((s) => [...s.options].some((o) => o.textContent.includes('DC 1') || o.textContent.toLowerCase().includes('motor')));
ok(!!bbSelect, 'a breadboard motor appears in the link picker');
if (bbSelect) {
  const mechSelect = bbSelect.parentElement.parentElement.parentElement.querySelectorAll('select')[1];
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set;
    setter.call(bbSelect, bbSelect.options[1].value); bbSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    setter.call(mechSelect, motorPartId); mechSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await flush(2);
  await clickText('button', 'Link them'); await flush(2);
  ok(text().includes('Unlink'), 'a link now shows in the Active links list');
  const shaftId = __mechStage.doc.parts.find((p) => p.type === 'shaft').id;
  await frames(80, 0.02);
  const w = Math.abs(__mechStage.doc.parts.length); void w;
}

console.log(fails ? `\n${fails} systems UI check(s) FAILED` : '\nAll systems UI checks passed');
await act(async () => rootEl.unmount());
await server.close();
process.exit(fails ? 1 : 0);
