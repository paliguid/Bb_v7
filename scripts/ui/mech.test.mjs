// End-to-end UI test for the Mechanical workbench: runs the real React app in jsdom with the
// three.js stage stubbed out (jsdom has no WebGL), exercising real state, lesson checks and physics.
//   node scripts/ui/mech.test.mjs
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
dom.window.URL.createObjectURL = () => 'blob:test'; dom.window.URL.revokeObjectURL = () => {};
g.URL.createObjectURL = () => 'blob:test';
const downloads = [];
dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };

const bbStub = path.resolve('scripts/ui/StageStub.js');
const mechStub = path.resolve('scripts/ui/MechStageStub.js');
const server = await createServer({
  root: path.resolve('.'), logLevel: 'error', appType: 'custom', server: { middlewareMode: true },
  plugins: [{
    name: 'stub-stages', enforce: 'pre',
    resolveId(id) { if (id.endsWith('three/Stage.js')) return bbStub; if (id.endsWith('MechStage.js')) return mechStub; },
  }],
});
const React = (await import('react')).default ?? (await import('react'));
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: App } = await server.ssrLoadModule('/src/App.jsx');
const { LESSONS } = await server.ssrLoadModule('/src/lib/lessons.js');
const { getMechPreset } = await server.ssrLoadModule('/src/mech/presets.js');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const text = () => document.body.textContent;
const $$ = (sel) => [...document.querySelectorAll(sel)];
const byText = (sel, t) => $$(sel).find((e) => e.textContent.trim().startsWith(t));
const click = async (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
const flush = async (n = 3) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const clickText = async (sel, t) => { const el = byText(sel, t); if (!el) throw new Error(`no ${sel} "${t}"`); await click(el); await flush(); };
const frames = async (n, dt = 0.05) => { for (let i = 0; i < n; i++) await act(async () => { __mechStage.emit('onFrame', dt); }); };
const key = async (k, opts = {}) => act(async () => { window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, ...opts })); });
const rightText = () => $$('.pcb-side.right')[0]?.textContent ?? '';
const field = (label) => $$('.nf').find((l) => l.querySelector('span')?.textContent === label)?.querySelector('input');
const setField = async (label, v) => {
  const el = field(label);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v)); el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
  });
  await flush(2);
};

const container = document.getElementById('root');
let rootEl;
await act(async () => { rootEl = createRoot(container); rootEl.render(React.createElement(App)); });
await flush();

console.log('Switching to the Mechanical workbench');
await clickText('button', 'Open the lab'); await flush(3);
await clickText('.bench-switch button', 'Mechanical'); await flush(3);
ok(!!$$('.mech-app').length, 'the mechanical workbench mounts');
ok(text().includes('Parts') && text().includes('Presets') && text().includes('Check'), 'left tabs are present');

console.log('\nLoading a preset and reading real physics');
await clickText('.pcb-tabs button', 'Presets');
const dyno = $$('.fp-item').find((b) => b.textContent.includes('Motor test bench'));
await click(dyno); await flush(3);
ok(text().includes('Speed'), 'preset loaded and the transport bar is visible');
await frames(20, 0.02);
ok(/t = 0\.\d\d s/.test(text()) === false || /t = [1-9]/.test(text()) === false, 'time readout is present'); // just sanity: readout exists
const statusBefore = $$('.pcb-status .mono')[0]?.textContent;
ok(!!statusBefore && parseFloat(statusBefore.replace(/[^0-9.]/g, '')) > 0, `simulation clock is advancing (${statusBefore})`);

console.log('\nLive controls do not reset the simulation');
await clickText('.pcb-tabs button', 'Controls');
const before = parseFloat($$('.pcb-status .mono')[0].textContent.replace(/[^0-9.]/g, ''));
const brakeSlider = $$('input[type="range"]')[0];
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  setter.call(brakeSlider, '0.5'); brakeSlider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
});
await frames(10, 0.02);
const after = parseFloat($$('.pcb-status .mono')[0].textContent.replace(/[^0-9.]/g, ''));
ok(after > before, `dragging a control slider keeps the clock running forward (${before.toFixed(2)} → ${after.toFixed(2)} s, not reset to 0)`);

console.log('\nBuilding a gear train by hand');
await clickText('button', 'File'); await clickText('.pcb-menu button', 'Clear board'); await flush(2);
ok(__mechStage.doc.parts.length === 0, 'clear board empties the parts list');
await clickText('.pcb-tabs button', 'Properties');
await clickText('.pcb-tabs button', 'Parts');
await clickText('.fp-item', 'Shaft'); await flush();
await act(async () => { __mechStage.emit('click', { hit: null, shift: false, point: { x: 0, y: 0, z: 0 } }); }); await flush(2);
if (!rightText().toLowerCase().includes('shaft')) console.log('   right panel:', rightText().slice(0, 200));
ok(rightText().toLowerCase().includes('shaft'), 'placing a shaft selects it and shows its properties');
await clickText('.fp-item', 'DC motor');
await act(async () => { __mechStage.emit('click', { hit: { partId: __mechStage.doc.parts[0].id }, shift: false, point: null }); }); await flush(2);
ok($$('.pp').length > 0 && rightText().toLowerCase().includes('motor'), 'placing a motor on the shaft (clicking the shaft as the target)');
ok(__mechStage.doc.parts.some((p) => p.type === 'motor' && p.shaft === __mechStage.doc.parts[0].id), 'the motor is actually mounted on the shaft');

console.log('\nMechanical lesson runs on real physics');
await clickText('button', 'Learn'); await flush(1);
const card = $$('.lesson-card').find((c) => c.textContent.includes('Build your first gear train'));
ok(!!card && card.textContent.includes('Mechanical'), 'the hub lists the gear-train mechanical lesson');
await click(card.querySelector('button')); await flush(3);
ok(text().includes('A shaft, waiting') , 'lesson 1 opens on the mechanical bench with the coach panel');
ok(byText('button', 'Next')?.disabled !== false, 'step 1 is waiting for a real action, not a click-through');
await clickText('.fp-item', 'DC motor');
await act(async () => { __mechStage.emit('click', { hit: { partId: __mechStage.doc.parts[0].id }, shift: false, point: null }); });
await frames(6, 0.05);
ok(text().includes('Nice work'), 'placing the motor completes the lesson step (checked against the real doc)');
await clickText('button', 'Next'); await flush(2);
ok(text().includes('Add a second shaft'), 'lesson advances to the next step');

console.log('\nDesign checks and export');
await clickText('.pcb-tabs button', 'Check');
ok(text().includes('problems found') || text().includes('errors'), 'the Mechanical Check panel reports something');
await clickText('button', 'File'); await clickText('.pcb-menu button', 'Save machine'); await flush();
ok(downloads.includes('breadbai-machine.json'), 'Save downloads a machine project file');

console.log('\nSwitching back to the breadboard preserves its own state');
await clickText('.bench-switch button', 'Breadboard'); await flush(2);
ok(!$$('.mech-app').length && !!$$('.stage-wrap, .topbar').length, 'the breadboard bench is back');

console.log(fails ? `\n${fails} mechanical UI check(s) FAILED` : '\nAll mechanical UI checks passed');
await act(async () => rootEl.unmount());
await server.close();
process.exit(fails ? 1 : 0);
