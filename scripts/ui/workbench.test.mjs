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


const svg = () => $('.pcb-svg');
const view = () => ({ s: +svg().dataset.scale, ox: +svg().dataset.ox, oy: +svg().dataset.oy });
const px = (pt) => { const v = view(); return { clientX: v.ox + pt.x * v.s, clientY: v.oy + pt.y * v.s }; };
const ptr = async (type, pt, extra = {}) => act(async () => { svg().dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, button: 0, ...px(pt), ...extra })); });
const clickAt = async (pt, extra) => { await ptr('pointermove', pt); await ptr('pointerdown', pt, extra); await ptr('pointerup', pt, extra); };
const dragTo = async (a, b, extra) => { await ptr('pointermove', a); await ptr('pointerdown', a, extra); for (let i = 1; i <= 4; i++) await ptr('pointermove', { x: a.x + (b.x - a.x) * i / 4, y: a.y + (b.y - a.y) * i / 4 }, extra); await ptr('pointerup', b, extra); await flush(2); };
const status = () => $('.pcb-status').textContent;
const rightText = () => $$('.pcb-side.right')[0].textContent;

const container = document.getElementById('root');
let rootEl;
await act(async () => { rootEl = createRoot(container); rootEl.render(React.createElement(App)); });
await flush();

console.log('Breadboard side still works');
await clickText('button', 'Start learning'); await flush(3);
ok(text().includes('Meet the breadboard') && text().includes('Step 1 of 5'), 'lesson coach shows beside the breadboard');
await clickText('button', 'Got it'); await clickText('button', 'Next');
await clickText('.seg button', 'Connections');
for (let i = 0; i < 12; i++) await act(async () => { __stage.emit('onFrame', 0.05); });
ok(text().includes('Nice work'), 'breadboard lesson steps are still detected');
ok(!!byText('button', 'Circuit Check'), 'Circuit Check is still in the breadboard toolbar');
await clickText('.bench-switch button', 'PCB'); await flush(2);
ok(!text().includes('Reveal the hidden wiring'), 'a breadboard lesson coach stays out of the PCB bench');
await key('l'); await flush();
ok($$('.hub').length === 0, 'the breadboard L shortcut is inert on the PCB bench (editor owns the keyboard)');
await clickText('.bench-switch button', 'Breadboard'); await flush(2);
ok(text().includes('Reveal the hidden wiring'), 'switching back restores the lesson where it was');
await clickText('.bench-switch button', 'PCB'); await flush(2);
svg().getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 700 });

console.log('\nPlacing footprints');
await clickText('.fp-item', 'Pin header 1×3'); await flush();
ok(byText('.pcb-topbar button', 'Select').getAttribute('aria-pressed') === 'false', 'picking a footprint arms the place tool');
await key('r');
await clickAt({ x: 30.48, y: 20.32 }); await flush(2);
ok(/J1/.test(rightText()) && /90°/.test($$('select').map((s) => s.value + '°').join(' ')), 'placed J1, rotated 90° while the ghost was following the cursor');
await clickAt({ x: 12.7, y: 20.32 }); await flush(2);
ok(/J2/.test(rightText()), 'placing continues until Esc (second header is J2)');
await key('Escape'); await key('Escape');

console.log('\nSelecting and deleting');
await dragTo({ x: 20, y: 12 }, { x: 40, y: 30 }); // rubber band around J1 only, ends at empty space
ok(/J1|1 object|objects selected/.test(rightText()), 'box select picks up parts inside the rubber band');
await key('Delete'); await flush(2);
ok(/Nothing selected/.test(rightText()), 'Delete removes the selection');
await key('z', { ctrlKey: true }); await flush(2);
await clickAt({ x: 30.48, y: 20.32 }); await flush(2);
ok(/J1/.test(rightText()), '⌘Z brings the deleted part back');
await key('a', { ctrlKey: true }); await flush();
ok(/2 objects selected/.test(rightText()), '⌘A selects everything');
await clickText('button', '⇤ Left'); await flush(2);
ok(/2 objects selected/.test(rightText()), 'aligning keeps the selection');
await key('Escape');

console.log('\nRouting extras');
await key('t');
await clickAt({ x: 12.7, y: 20.32 - 0 }); // start on J2's first pad? (rotated) — just begin somewhere
await clickAt({ x: 15, y: 30 });
ok(/Route/.test(status()), 'route tool active');
await key('1'); await key('v'); await flush(2);
ok(/Layer\s*Bottom/.test(status()), 'V while routing drops a via and switches from top to bottom copper');
await key('Backspace'); await flush(2);
await key('Escape'); await key('Escape');
await key('1');

console.log('\nEndpoint dragging');
await key('v');
{
  // draw a free track, select it, drag one end
  await key('t'); await key('/'); await key('/');
  await clickAt({ x: 40, y: 5 }); await clickAt({ x: 46, y: 5 }); await key('Enter'); await key('Escape'); await key('v'); await flush();
  await clickAt({ x: 43, y: 5 }); await flush(2);
  ok(/Track segment/.test(rightText()), 'clicking a track selects it');
  const len0 = parseFloat(rightText().match(/([\d.]+) mm long/)[1]);
  await dragTo({ x: 46, y: 5 }, { x: 46, y: 9 });
  const len1 = parseFloat(rightText().match(/([\d.]+) mm long/)[1]);
  ok(len1 > len0, `dragging an end handle re-shapes the track (${len0} → ${len1} mm)`);
}

console.log(fails ? `\n${fails} extra check(s) FAILED` : '\nAll extra checks passed');
await act(async () => rootEl.unmount());
await server.close();
process.exit(fails ? 1 : 0);
