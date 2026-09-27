import { useCallback, useEffect, useRef, useState } from 'react';
import { useDismiss } from '../ui/useDismiss.js';
import PcbView from './PcbView.jsx';
import { BoardPanel, DrcPanel, LibraryPanel, NetsPanel, PropsPanel, RulesPanel, ViewPanel } from './PcbPanels.jsx';
import {
  addMountingHoles, alignObjects, applyTranslate, distributeObjects, duplicateObjects, fitBoardToParts,
  flipParts, flipTrackLayer, moveEndpoint, objectsInBox, removeObjects, reshapePart, rotateParts, selectRun,
} from './edit.js';
import { fabPackage, svgString, zipStore } from './export.js';
import { FOOTPRINTS, footprintBounds } from './footprints.js';
import { textWidth } from './font.js';
import { dist, distPointSeg, rotPoint, snapTo } from './geometry.js';
import { GRID_SIZES, TRACK_WIDTHS, deserializePcb, findObject, kindOf, makePart, newPcb, partPads, pid, serializePcb } from './model.js';
import { applyImport } from './netlist.js';
import { ROUTE_MODES, routePath } from './routing.js';

const TOOLS = [
  ['select', 'Select', 'V', 'Select, move and edit'],
  ['route', 'Route', 'T', 'Draw copper tracks'],
  ['via', 'Via', 'X', 'Drop a via'],
  ['text', 'Text', 'S', 'Add silkscreen text'],
  ['measure', 'Measure', 'M', 'Measure a distance'],
];

const HINTS = {
  select: 'Click to select (click again to cycle overlapping objects) · drag to move · drag empty space to box-select · R rotate · F flip · Del delete',
  route: 'Click a pad to start · click for corners · double-click or Enter to finish · V via + swap layer · / mode · Space flips the corner · W width · 1/2 layer · Backspace undo a corner',
  via: 'Click to drop a via (size comes from the design rules)',
  text: 'Click to place silkscreen text, then edit it in the Properties tab',
  measure: 'Click two points to measure · Esc clears',
  place: 'Click to place · R rotate · F flip to the other side · Esc stops placing',
};

const DEFAULT_OPTS = {
  showTop: true, showBottom: true, showSilkTop: true, showSilkBottom: true, showRatsnest: true, showDrc: true,
  showGrid: true, padNames: true, realistic: false, flipView: false, inactive: 0.55, cursor: 'default',
};

function download(name, data, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export default function PcbEditor({ store, analysis, hasBreadboard, onImport, coach, onEvent }) {
  const doc = store.doc;
  const { getDoc } = store;
  const svgRef = useRef(null);
  const drag = useRef(null);
  const lastClick = useRef(null);
  const fileRef = useRef(null);
  const menuRef = useRef(null);

  const [view, setView] = useState({ s: 8, ox: 40, oy: 40 });
  const [tool, setTool] = useState('select');
  const [layer, setLayer] = useState('top');
  const [mode, setMode] = useState('45');
  const [flip, setFlip] = useState(false);
  const [width, setWidth] = useState(doc.rules.trackWidth);
  const [selection, setSelection] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [route, setRoute] = useState(null);
  const [placing, setPlacing] = useState(null);
  const [measure, setMeasure] = useState(null);
  const [box, setBox] = useState(null);
  const [panelNet, setPanelNet] = useState(null);
  const [canvasNet, setCanvasNet] = useState(null);
  const [leftTab, setLeftTab] = useState('library');
  const [rightTab, setRightTab] = useState('props');
  const [opts, setOpts] = useState(DEFAULT_OPTS);
  const [attach, setAttach] = useState(true);
  const [spaceDown, setSpaceDown] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [leftFloat, setLeftFloat] = useState(false);
  const [rightFloat, setRightFloat] = useState(false);
  useDismiss(menuRef, () => setMenu(false));

  const say = useCallback((msg) => setToast(msg), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  /* ----------------------------------------------------------- viewport */

  const size = () => {
    const r = svgRef.current?.getBoundingClientRect();
    return { left: r?.left ?? 0, top: r?.top ?? 0, W: r?.width || 1000, H: r?.height || 700 };
  };

  const fit = useCallback(() => {
    const { W, H } = size();
    const { w, h } = getDoc().board;
    const s = Math.max(1.5, Math.min((W - 80) / w, (H - 80) / h));
    setView({ s, ox: (W - w * s) / 2, oy: (H - h * s) / 2 });
  }, [getDoc]);

  useEffect(() => { fit(); }, [fit]);

  const toMM = (e) => {
    const { left, top } = size();
    let x = (e.clientX - left - view.ox) / view.s;
    const y = (e.clientY - top - view.oy) / view.s;
    if (opts.flipView) x = doc.board.w - x;
    return { x, y };
  };

  const zoomAt = (factor, sx, sy) => {
    setView((v) => {
      const s = Math.max(1.5, Math.min(220, v.s * factor));
      const mx = (sx - v.ox) / v.s, my = (sy - v.oy) / v.s;
      return { s, ox: sx - mx * s, oy: sy - my * s };
    });
  };

  const focus = useCallback((x, y) => {
    const { W, H } = size();
    const bw = getDoc().board.w;
    setView((v) => {
      const s = Math.max(v.s, 22);
      const dx = opts.flipView ? bw - x : x;
      return { s, ox: W / 2 - dx * s, oy: H / 2 - y * s };
    });
    setCursor({ x, y, target: null });
  }, [opts.flipView, getDoc]);

  /* ----------------------------------------------------- snapping & hits */

  const snap = (raw, { useLayer, exclude } = {}) => {
    const d = store.getDoc();
    if (d.grid.snapPads) {
      const r = 10 / view.s;
      let best = null;
      const consider = (x, y, kind, id) => {
        const dd = Math.hypot(x - raw.x, y - raw.y);
        if (dd <= r && (!best || dd < best.d)) best = { d: dd, x, y, target: { kind, id } };
      };
      for (const part of d.parts) for (const p of partPads(part)) consider(p.x, p.y, 'pad', p.id);
      for (const v of d.vias) consider(v.x, v.y, 'via', v.id);
      for (const t of d.tracks) {
        if ((useLayer && t.layer !== useLayer) || exclude?.has(t.id)) continue;
        consider(t.a.x, t.a.y, 'track', t.id); consider(t.b.x, t.b.y, 'track', t.id);
      }
      if (best) return { x: best.x, y: best.y, target: best.target };
    }
    if (d.grid.snap) return { x: snapTo(raw.x, d.grid.size), y: snapTo(raw.y, d.grid.size), target: null };
    return { ...raw, target: null };
  };

  const hitTest = (p) => {
    const d = store.getDoc();
    const tol = 5 / view.s;
    const hits = [];
    for (const v of d.vias) { const dd = dist(p, v); if (dd <= v.dia / 2 + tol) hits.push({ id: v.id, pri: 0, dd }); }
    for (const t of d.tracks) {
      if (!(t.layer === 'top' ? opts.showTop : opts.showBottom)) continue;
      const dd = distPointSeg(p, t.a, t.b);
      if (dd <= t.width / 2 + tol) hits.push({ id: t.id, pri: t.layer === layer ? 1 : 2, dd });
    }
    for (const part of d.parts) {
      let l = rotPoint({ x: p.x - part.x, y: p.y - part.y }, -(part.rot ?? 0));
      if (part.side === 'bottom') l = { x: -l.x, y: l.y };
      const b = footprintBounds(FOOTPRINTS[part.fp]);
      if (l.x >= b.x0 - 0.6 && l.x <= b.x1 + 0.6 && l.y >= b.y0 - 0.6 && l.y <= b.y1 + 0.6) hits.push({ id: part.id, pri: 3, dd: dist(p, part) });
    }
    for (const t of d.texts) {
      const hw = Math.max(textWidth(t.text, t.size) / 2, t.size / 2) + tol;
      if (Math.abs(p.x - t.x) <= hw && Math.abs(p.y - t.y) <= t.size / 2 + tol) hits.push({ id: t.id, pri: 4, dd: dist(p, t) });
    }
    return hits.sort((a, b) => a.pri - b.pri || a.dd - b.dd).map((h) => h.id);
  };

  /* ------------------------------------------------------------- actions */

  const find = (id) => findObject(store.getDoc(), id);
  const commit = store.commit;
  const ids = selection;

  const patch = (id, p) => {
    const d = store.getDoc();
    const kind = kindOf(d, id);
    if (kind === 'part' && ('x' in p || 'y' in p || 'rot' in p || 'side' in p)) {
      store.commit((dd) => reshapePart(dd, id, p, attach));
    } else {
      store.commit((dd) => Object.assign(findObject(dd, id), p));
    }
  };
  const patchTrackEnd = (id, end, p) => commit((d) => {
    const base = structuredClone(d);
    moveEndpoint(d, base, id, end, { ...base.tracks.find((t) => t.id === id)[end], ...p }, attach);
  });
  const remove = () => { if (!ids.length) return; commit((d) => removeObjects(d, ids)); setSelection([]); };
  const rotate = (list) => commit((d) => rotateParts(d, list, attach));
  const flipSel = (list) => commit((d) => flipParts(d, list, attach));
  const duplicate = () => {
    let created = [];
    commit((d) => { created = duplicateObjects(d, ids); });
    setSelection(created);
  };

  const importCircuit = () => {
    const imp = onImport?.();
    if (!imp || !imp.parts.length) { say('Nothing to import — build a circuit on the breadboard first.'); return; }
    const had = store.getDoc().parts.length > 0;
    store.replace(applyImport(store.getDoc(), imp));
    setLeftTab('nets');
    if (!had) setTimeout(fit, 0);
    onEvent?.('import');
    say(`${had ? 'Netlist re-synced' : 'Imported'}: ${imp.parts.length} parts, ${imp.nets.length} nets. Yellow dashed lines show what still needs routing.`);
  };

  const api = {
    find, kind: (id) => kindOf(store.getDoc(), id), grid: doc.grid.size, attach, setAttach,
    patch, patchTrackEnd, remove, rotate, flip: flipSel, duplicate, focus, importCircuit,
    hoverNet: setPanelNet,
    arm: (fp) => { setPlacing({ fp, rot: 0, side: 'top' }); setTool('place'); setRoute(null); },
    selectRun: (id) => setSelection(selectRun(store.getDoc(), id)),
    flipTrackLayer: (list) => commit((d) => flipTrackLayer(d, list)),
    align: (axis, how) => commit((d) => alignObjects(d, ids, axis, how)),
    distribute: (axis) => commit((d) => distributeObjects(d, ids, axis)),
    setBoard: (p) => commit((d) => Object.assign(d.board, p)),
    setGrid: (p) => commit((d) => Object.assign(d.grid, p)),
    setRules: (p) => commit((d) => Object.assign(d.rules, p)),
    addMountingHoles: (inset) => commit((d) => addMountingHoles(d, inset)),
    fitBoardToParts: () => { commit((d) => fitBoardToParts(d, 5)); setTimeout(fit, 0); },
    setNetWidth: (name, v) => commit((d) => { if (Number.isFinite(v) && v > 0) d.netWidths[name] = v; else delete d.netWidths[name]; }),
    applyNetWidth: (name) => {
      const w = store.getDoc().netWidths[name];
      if (!w) { say('Set a width for this net first.'); return; }
      commit((d) => { for (const t of d.tracks) if (analysis?.itemNet.get(t.id) === name) t.width = w; });
      onEvent?.('netwidth');
    },
  };

  /* -------------------------------------------------------------- routing */

  const routeStart = (pt) => {
    const net = pt.target ? analysis?.itemNet.get(pt.target.id) ?? null : null;
    const w = (net && doc.netWidths[net]) || width;
    setRoute({ layer, net, width: w, start: pt, last: pt, groups: [] });
    onEvent?.('route-start');
  };

  const addSegments = (pts, r) => {
    const made = [];
    store.commit((d) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const t = { id: pid('t'), layer: r.layer, width: r.width, a: { x: pts[i].x, y: pts[i].y }, b: { x: pts[i + 1].x, y: pts[i + 1].y } };
        d.tracks.push(t); made.push(t.id);
      }
    });
    return made;
  };

  const routeClick = (pt) => {
    if (!route) { routeStart(pt); return; }
    const pts = routePath(route.last, pt, mode, flip);
    if (pts.length < 2) return;
    const made = addSegments(pts, route);
    onEvent?.('routed');
    if (pt.target) setRoute(null); // landing on a pad / via / track end completes the connection
    else setRoute({ ...route, last: pt, groups: [...route.groups, made] });
  };

  const routeVia = () => {
    if (!route || !cursor) return;
    const pts = routePath(route.last, cursor, mode, flip);
    let made = [];
    if (pts.length >= 2) made = addSegments(pts, route);
    const rules = store.getDoc().rules;
    store.commit((d) => d.vias.push({ id: pid('v'), x: cursor.x, y: cursor.y, dia: rules.viaDia, drill: rules.viaDrill }));
    const next = layer === 'top' ? 'bottom' : 'top';
    setLayer(next);
    setRoute({ ...route, layer: next, last: { x: cursor.x, y: cursor.y, target: null }, groups: [...route.groups, made] });
    onEvent?.('via');
  };

  const routeBack = () => {
    if (!route) return;
    if (!route.groups.length) { setRoute(null); return; }
    const last = route.groups.at(-1);
    const first = store.getDoc().tracks.find((t) => t.id === last[0]);
    commit((d) => { d.tracks = d.tracks.filter((t) => !last.includes(t.id)); });
    setRoute({ ...route, last: first ? { ...first.a, target: null } : route.start, groups: route.groups.slice(0, -1) });
  };

  /* -------------------------------------------------------------- pointer */

  const onPointerDown = (e) => {
    const raw = toMM(e);
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button === 2) { cancel(); return; }
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (tool === 'route') { routeClick(snap(raw, { useLayer: layer, exclude: new Set(route?.groups.flat() ?? []) })); return; }
    if (tool === 'via') {
      const pt = snap(raw);
      store.commit((d) => d.vias.push({ id: pid('v'), x: pt.x, y: pt.y, dia: d.rules.viaDia, drill: d.rules.viaDrill }));
      onEvent?.('via');
      return;
    }
    if (tool === 'text') {
      const pt = snap(raw);
      const t = { id: pid('x'), text: 'TEXT', x: pt.x, y: pt.y, size: 1.5, layer: 'top', rot: 0 };
      store.commit((d) => d.texts.push(t));
      setSelection([t.id]); setTool('select'); setRightTab('props');
      return;
    }
    if (tool === 'measure') {
      const pt = snap(raw);
      setMeasure((m) => (!m || m.b ? { a: pt, b: null } : { a: m.a, b: pt }));
      return;
    }
    if (tool === 'place' && placing) {
      const g = store.getDoc().grid; // footprints snap to the grid, never onto pads
      const gp = g.snap ? { x: snapTo(raw.x, g.size), y: snapTo(raw.y, g.size) } : { x: raw.x, y: raw.y };
      let made;
      store.commit((d) => { made = makePart(d, placing.fp, gp.x, gp.y, { rot: placing.rot, side: placing.side }); d.parts.push(made); });
      setSelection([made.id]);
      onEvent?.('placed');
      return;
    }

    // ---- select tool
    const cur = store.getDoc();
    if (selection.length === 1) {
      const t = cur.tracks.find((q) => q.id === selection[0]);
      if (t) {
        const tol = 8 / view.s;
        const end = dist(raw, t.a) <= tol ? 'a' : dist(raw, t.b) <= tol ? 'b' : null;
        if (end) { drag.current = { kind: 'endpoint', id: t.id, end, base: cur, started: false }; return; }
      }
    }
    const hits = hitTest(raw);
    if (!hits.length) {
      drag.current = { kind: 'box', a: raw, shift: e.shiftKey };
      return;
    }
    let idx = 0;
    const lc = lastClick.current;
    if (hits.length > 1 && lc && dist(lc.p, raw) < 0.4 / Math.max(view.s / 8, 1) && lc.hits.join() === hits.join()) idx = (lc.idx + 1) % hits.length;
    lastClick.current = { p: raw, idx, hits };
    const hit = hits[idx];
    let next;
    if (e.shiftKey) next = selection.includes(hit) ? selection.filter((s) => s !== hit) : [...selection, hit];
    else next = selection.includes(hit) && idx === 0 && selection.length > 1 ? selection : [hit];
    setSelection(next);
    if (next.length) setRightTab('props');
    const anchorObj = findObject(cur, hit);
    const anchor = anchorObj.a ?? { x: anchorObj.x, y: anchorObj.y };
    drag.current = { kind: 'move', base: cur, ids: next, raw0: raw, anchor: { x: anchor.x, y: anchor.y }, sx: e.clientX, sy: e.clientY, started: false, reduceTo: !e.shiftKey && next.length > 1 && selection.includes(hit) ? hit : null };
  };

  const onPointerMove = (e) => {
    const raw = toMM(e);
    const d = drag.current;
    if (d?.kind === 'pan') { setView((v) => ({ ...v, ox: d.ox + e.clientX - d.sx, oy: d.oy + e.clientY - d.sy })); return; }
    if (d?.kind === 'box') { setBox({ a: d.a, b: raw }); return; }
    if (d?.kind === 'move') {
      if (!d.started) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
        d.started = true; store.mark();
      }
      const g = store.getDoc().grid;
      let dx = raw.x - d.raw0.x, dy = raw.y - d.raw0.y;
      if (g.snap) { dx = snapTo(d.anchor.x + dx, g.size) - d.anchor.x; dy = snapTo(d.anchor.y + dy, g.size) - d.anchor.y; }
      store.update((dd) => applyTranslate(dd, d.base, d.ids, dx, dy, attach));
      return;
    }
    if (d?.kind === 'endpoint') {
      if (!d.started) { d.started = true; store.mark(); }
      const pt = snap(raw, { exclude: new Set([d.id]) });
      store.update((dd) => moveEndpoint(dd, d.base, d.id, d.end, pt, attach));
      setCursor(pt);
      return;
    }
    let pt;
    if (tool === 'route') pt = snap(raw, { useLayer: layer, exclude: new Set(route?.groups.flat() ?? []) });
    else if (tool === 'via' || tool === 'text' || tool === 'measure') pt = snap(raw);
    else if (tool === 'place') pt = store.getDoc().grid.snap ? { x: snapTo(raw.x, doc.grid.size), y: snapTo(raw.y, doc.grid.size), target: null } : { ...raw, target: null };
    else pt = { ...raw, target: null };
    setCursor(pt);
    if (tool === 'measure' && measure && !measure.b) setMeasure({ a: measure.a, b: null, live: pt });
    if (tool === 'select' || tool === 'route') {
      const top = hitTest(raw)[0];
      setCanvasNet(top ? analysis?.itemNet.get(top) ?? null : null);
    }
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    if (d.kind === 'box') {
      setBox(null);
      const raw = toMM(e);
      if (dist(raw, d.a) * view.s < 4) { if (!d.shift) setSelection([]); return; }
      const inside = objectsInBox(store.getDoc(), d.a, raw);
      setSelection(d.shift ? [...new Set([...selection, ...inside])] : inside);
      if (inside.length) setRightTab('props');
    }
    if (d.kind === 'move' && !d.started && d.reduceTo) setSelection([d.reduceTo]);
  };

  const onDoubleClick = (e) => {
    if (tool === 'route') { setRoute(null); return; }
    if (tool === 'select') {
      const hit = hitTest(toMM(e))[0];
      if (hit && kindOf(store.getDoc(), hit) === 'track') setSelection(selectRun(store.getDoc(), hit));
    }
  };

  const onWheel = (e) => {
    const { left, top } = size();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - left, e.clientY - top);
  };

  function cancel() {
    if (route) { setRoute(null); return; }
    if (tool === 'measure' && measure) { setMeasure(null); return; }
    if (tool !== 'select') { setTool('select'); setPlacing(null); return; }
    setSelection([]);
  }

  /* ------------------------------------------------------------- keyboard */

  const keyRef = useRef(null);
  useEffect(() => {
    keyRef.current = (e) => {
      const tag = e.target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const meta = e.metaKey || e.ctrlKey;
      const k = e.key;
      if (meta && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      if (meta && k.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
      if (typing) return;
      if (meta && k.toLowerCase() === 'a') { e.preventDefault(); const d = store.getDoc(); setSelection([...d.parts, ...d.tracks, ...d.vias, ...d.texts].map((o) => o.id)); return; }
      if (meta && k.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
      if (meta) return;

      if (k === 'Escape') { cancel(); return; }
      if (k === 'Enter') { if (route) setRoute(null); return; }
      if (k === ' ') {
        e.preventDefault();
        if (tool === 'route') setFlip((f) => !f); else setSpaceDown(true);
        return;
      }
      if (k === 'Backspace' && route) { e.preventDefault(); routeBack(); return; }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); remove(); return; }
      if (tool === 'route' && (k === 'v' || k === 'V')) { routeVia(); return; }
      const low = k.toLowerCase();
      const toolKeys = { v: 'select', t: 'route', x: 'via', s: 'text', m: 'measure' };
      if (toolKeys[low] && !e.shiftKey) { setTool(toolKeys[low]); setRoute(null); setPlacing(null); return; }
      if (low === 'r') {
        if (tool === 'place') setPlacing((p) => p && { ...p, rot: (p.rot + 90) % 360 });
        else if (selection.length) rotate(selection);
        return;
      }
      if (low === 'f') {
        if (tool === 'place') setPlacing((p) => p && { ...p, side: p.side === 'top' ? 'bottom' : 'top' });
        else if (selection.length) flipSel(selection);
        return;
      }
      if (k === '1') { setLayer('top'); return; }
      if (k === '2') { setLayer('bottom'); return; }
      if (k === '/') { setMode((m) => ROUTE_MODES[(ROUTE_MODES.indexOf(m) + 1) % ROUTE_MODES.length]); return; }
      if (low === 'w') {
        const dir = e.shiftKey ? -1 : 1;
        setWidth((w) => TRACK_WIDTHS[Math.max(0, Math.min(TRACK_WIDTHS.length - 1, TRACK_WIDTHS.findIndex((x) => x >= w - 1e-9) + dir))]);
        return;
      }
      if (low === 'g') { const g = store.getDoc().grid.size; api.setGrid({ size: GRID_SIZES[(GRID_SIZES.indexOf(g) + 1) % GRID_SIZES.length] }); return; }
      if (low === 'n') { api.setGrid({ snap: !store.getDoc().grid.snap }); return; }
      if (k === 'Home' || k === '0') { fit(); return; }
      if (k === '+' || k === '=') { const { W, H } = size(); zoomAt(1.25, W / 2, H / 2); return; }
      if (k === '-') { const { W, H } = size(); zoomAt(0.8, W / 2, H / 2); return; }
      if (k.startsWith('Arrow') && selection.length) {
        e.preventDefault();
        const g = store.getDoc().grid.size;
        const step = e.altKey ? 0.1 : e.shiftKey ? g * 10 : g;
        const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
        const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
        const base = store.getDoc();
        commit((d) => applyTranslate(d, base, selection, dx, dy, attach));
      }
    };
  });
  useEffect(() => {
    const down = (e) => keyRef.current?.(e);
    const up = (e) => { if (e.key === ' ') setSpaceDown(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  /* ---------------------------------------------------------------- files */

  const saveProject = () => download('breadbai-pcb.json', serializePcb(store.getDoc()), 'application/json');
  const openProject = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { store.replace(deserializePcb(JSON.parse(await file.text()))); setSelection([]); setTimeout(fit, 0); say(`Opened ${file.name}`); }
    catch { say('That file is not a BreadBai PCB project.'); }
  };
  const exportGerber = () => {
    const d = store.getDoc();
    const files = fabPackage(d, 'breadbai-pcb');
    download('breadbai-pcb-gerber.zip', zipStore(files), 'application/zip');
    onEvent?.('export');
    const errs = analysis?.stats.errors ?? 0;
    say(errs ? `Exported ${files.length} fab files — but the DRC still shows ${errs} error${errs > 1 ? 's' : ''}.` : `Exported ${files.length} fab files (Gerber + drill) as a ZIP.`);
  };
  const exportSvg = (side) => { download(`breadbai-pcb-${side}.svg`, svgString(store.getDoc(), { side, style: 'realistic' }), 'image/svg+xml'); };
  const clearBoard = () => { store.replace(newPcb()); setSelection([]); setMenu(false); setTimeout(fit, 0); };

  /* --------------------------------------------------------------- render */

  const previewSegs = route && cursor
    ? routePath(route.last, cursor, mode, flip).slice(1).map((p, i, arr) => ({ a: i === 0 ? route.last : arr[i - 1], b: p }))
    : [];
  const ghost = tool === 'place' && placing && cursor
    ? { id: 'ghost', fp: placing.fp, ref: '', x: cursor.x, y: cursor.y, rot: placing.rot, side: placing.side, showRef: false }
    : null;
  const liveMeasure = measure && (measure.b ? measure : measure.live ? { a: measure.a, b: measure.live } : null);
  const overlay = {
    route: route ? { ...route, preview: previewSegs } : null,
    ghost, measure: liveMeasure, box, cursor: tool === 'select' ? null : cursor,
  };
  const viewOpts = { ...opts, cursor: tool === 'select' ? 'default' : 'crosshair' };
  const stats = analysis?.stats;
  const dl = liveMeasure && liveMeasure.b ? { dx: liveMeasure.b.x - liveMeasure.a.x, dy: liveMeasure.b.y - liveMeasure.a.y } : null;

  return (
    <div className="pcb-app">
      <div className="pcb-topbar">
        <div className="seg" role="group" aria-label="Tools">
          {TOOLS.map(([id, label, key, tip]) => (
            <button key={id} aria-pressed={tool === id} title={`${tip} (${key})`} onClick={() => { setTool(id); setRoute(null); setPlacing(null); }}>{label}</button>
          ))}
        </div>
        <div className="pcb-sep" />
        <div className="seg" role="group" aria-label="Active copper layer">
          <button aria-pressed={layer === 'top'} onClick={() => setLayer('top')} title="Top copper (1)"><i className="sw top" />Top</button>
          <button aria-pressed={layer === 'bottom'} onClick={() => setLayer('bottom')} title="Bottom copper (2)"><i className="sw bottom" />Bottom</button>
        </div>
        <div className="seg" role="group" aria-label="Routing angle">
          {[['45', '45°'], ['90', '90°'], ['free', 'Free']].map(([m, l]) => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)} title="Cycle with /">{l}</button>)}
        </div>
        <label className="pcb-w" title="Track width for new tracks (W / Shift+W)">
          Width
          <input type="number" step="0.05" min="0.05" value={width} list="pcb-widths"
            onChange={(e) => { const v = parseFloat(e.target.value); if (v > 0) setWidth(v); }} onKeyDown={(e) => e.stopPropagation()} />
          <datalist id="pcb-widths">{TRACK_WIDTHS.map((w) => <option key={w} value={w} />)}</datalist>
        </label>
        <div className="pcb-sep" />
        <button className="btn ghost" aria-pressed={doc.grid.snap} onClick={() => api.setGrid({ snap: !doc.grid.snap })} title="Snap to grid (N)">Snap {doc.grid.snap ? 'on' : 'off'}</button>
        <label className="pcb-w" title="Grid size (G)">
          Grid
          <select value={String(doc.grid.size)} onChange={(e) => api.setGrid({ size: +e.target.value })} onKeyDown={(e) => e.stopPropagation()}>
            {[...new Set([...GRID_SIZES, doc.grid.size])].sort((a, b) => a - b).map((g) => <option key={g} value={g}>{g} mm</option>)}
          </select>
        </label>
        <div className="pcb-spacer" />
        <button className="btn ghost icon" onClick={store.undo} disabled={!store.canUndo} title="Undo (⌘Z)" aria-label="Undo">↶</button>
        <button className="btn ghost icon" onClick={store.redo} disabled={!store.canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">↷</button>
        <div className="menu-wrap" ref={menuRef}>
          <button className="btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>File ▾</button>
          {menu && (
            <div className="menu glass pcb-menu" role="menu">
              <button role="menuitem" onClick={() => { setMenu(false); exportGerber(); }}><span className="t">Export for manufacture</span><span className="d">Gerber + drill files in one ZIP</span></button>
              <button role="menuitem" onClick={() => { setMenu(false); exportSvg('top'); }}><span className="t">Export SVG — top</span><span className="d">Picture of the top side</span></button>
              <button role="menuitem" onClick={() => { setMenu(false); exportSvg('bottom'); }}><span className="t">Export SVG — bottom</span><span className="d">Mirrored, as seen from below</span></button>
              <button role="menuitem" onClick={() => { setMenu(false); saveProject(); }}><span className="t">Save project</span><span className="d">Editable .json file</span></button>
              <button role="menuitem" onClick={() => { setMenu(false); fileRef.current?.click(); }}><span className="t">Open project…</span></button>
              <button role="menuitem" onClick={clearBoard}><span className="t">New empty board</span><span className="d">Clears everything (undo brings it back)</span></button>
            </div>
          )}
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={openProject} />
        </div>
      </div>

      <div className="pcb-main">
        <aside className={`pcb-side left glass cad-window ${leftFloat ? "cad-floating" : ""}`}>
          <div className="pcb-tabs" role="tablist">
            {[['library', 'Parts'], ['nets', 'Nets'], ['drc', 'DRC']].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={leftTab === id} onClick={() => setLeftTab(id)}>
                {label}
                {id === 'drc' && stats && (stats.errors + stats.warnings > 0) && <span className={`badge ${stats.errors ? 'err' : 'warn'}`}>{stats.errors + stats.warnings}</span>}
              </button>
            ))}
            <button className="panel-popout" onClick={() => setLeftFloat((v) => !v)} title={leftFloat ? 'Dock window' : 'Pop out window'}>{leftFloat ? '↙' : '↗'}</button>
          </div>
          <div className="pcb-tabbody">
            {leftTab === 'library' && <LibraryPanel api={api} placing={placing} hasBreadboard={hasBreadboard} imported={!!doc.netlist} />}
            {leftTab === 'nets' && <NetsPanel doc={doc} analysis={analysis} api={api} hoverNet={panelNet} />}
            {leftTab === 'drc' && <DrcPanel analysis={analysis} api={api} />}
          </div>
        </aside>

        <div className="pcb-canvas">
          <PcbView
            doc={doc} analysis={analysis} view={view} opts={viewOpts} selection={selection}
            hoverNet={panelNet ?? canvasNet} activeLayer={layer} overlay={overlay} svgRef={svgRef} spaceDown={spaceDown}
            handlers={{ onPointerDown, onPointerMove, onPointerUp, onDoubleClick, onWheel, onContextMenu: (e) => e.preventDefault() }}
          />
          <div className="pcb-zoom glass">
            <button onClick={() => { const { W, H } = size(); zoomAt(1.25, W / 2, H / 2); }} aria-label="Zoom in">+</button>
            <button onClick={() => { const { W, H } = size(); zoomAt(0.8, W / 2, H / 2); }} aria-label="Zoom out">−</button>
            <button onClick={fit} aria-label="Fit board" title="Fit board (0)">⤢</button>
          </div>
          {liveMeasure && liveMeasure.b && dl && (
            <div className="pcb-measure glass">{dist(liveMeasure.a, liveMeasure.b).toFixed(3)} mm <span>Δx {dl.dx.toFixed(2)} · Δy {dl.dy.toFixed(2)} · {(Math.atan2(-dl.dy, dl.dx) * 180 / Math.PI).toFixed(1)}°</span></div>
          )}
          {toast && <div className="pcb-toast glass" role="status">{toast}</div>}
        </div>

        <aside className={`pcb-side right ${rightFloat ? "cad-floating right" : ""}`}>
          {coach}
          <div className="glass pcb-side-inner">
            <div className="pcb-tabs" role="tablist">
              {[['props', 'Properties'], ['board', 'Board'], ['rules', 'Rules'], ['view', 'View']].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={rightTab === id} onClick={() => setRightTab(id)}>{label}</button>
              ))}
              <button className="panel-popout" onClick={() => setRightFloat((v) => !v)} title={rightFloat ? 'Dock window' : 'Pop out window'}>{rightFloat ? '↘' : '↗'}</button>
            </div>
            <div className="pcb-tabbody">
              {rightTab === 'props' && <PropsPanel doc={doc} analysis={analysis} selection={selection} api={api} />}
              {rightTab === 'board' && <BoardPanel doc={doc} api={{ ...api, attach, setAttach }} />}
              {rightTab === 'rules' && <RulesPanel doc={doc} api={api} />}
              {rightTab === 'view' && <ViewPanel opts={opts} setOpts={setOpts} />}
            </div>
          </div>
        </aside>
      </div>

      <div className="pcb-status">
        <span className="mono">{cursor ? `X ${cursor.x.toFixed(2)}  Y ${cursor.y.toFixed(2)} mm` : 'X –  Y –'}</span>
        <span>Zoom {view.s.toFixed(1)} px/mm</span>
        <span>Layer <b className={`lay ${layer}`}>{layer === 'top' ? 'Top' : 'Bottom'}</b></span>
        {tool === 'route' && <span>Route {mode === 'free' ? 'free' : `${mode}°`} · {route ? route.width : width} mm{route?.net ? ` · ${route.net}` : ''}</span>}
        <span className="hint">{HINTS[tool]}</span>
        {stats && <span className={stats.errors ? 'bad' : 'good'}>{stats.errors} errors · {stats.warnings} warnings · {stats.unrouted} unrouted</span>}
      </div>
    </div>
  );
}
