import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDismiss } from '../ui/useDismiss.js';
import { MechStage } from './MechStage.js';
import { Machine } from './machine.js';
import { mechChecks } from './checks.js';
import { getMechPreset } from './presets.js';
import {
  addCustomFromMesh, addPart, autoPhase, byId, classifyPair, connect, isShaftMounted,
  isSliderLike, linkById, removeLink, removePart, restMatrix, snapToMesh,
} from './assembly.js';
import { compose } from './math3.js';
import { PART_TYPES, paramDefaults } from './catalog.js';
import { normalizeImport, parseObj, parseStl } from './meshkit.js';
import { MechLibraryPanel, PresetsPanel, MechItemsPanel, MechPropsPanel, ConnectPanel, ChecksPanel, ControlsPanel, ScopePanel, SystemsPanel } from './MechPanels.jsx';
import { coupledStep, linkReadout, makeLink } from '../systems/couple.js';

const TOOLS = [
  ['select', 'Select', 'V', 'Select and move parts'],
  ['connect', 'Connect', 'C', 'Click two parts to link them'],
];
const HINTS = {
  select: 'Click to select · use XYZ axes to move precisely · drag to move on the ground plane · Snap magnetizes nearby parts · R rotate 90° · Del delete',
  connect: 'Click the first part, then its partner. Gears, belts, racks, cranks and cams connect automatically when they touch correctly.',
  place: 'Click on the ground to place · R rotate · Esc stops placing',
};

function download(name, data, type) {
  const blob = new Blob([data], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const SIGNALS_FOR = (doc) => {
  const out = [];
  for (const p of doc.parts) {
    if (p.type === 'shaft') out.push({ key: `${p.id}.rpm`, label: `${p.name}: speed (rpm)` });
    if (isSliderLike(p)) out.push({ key: `${p.id}.pos`, label: `${p.name}: position (mm)` }, { key: `${p.id}.vel`, label: `${p.name}: velocity (mm/s)` });
    if (p.type === 'motor') out.push({ key: `${p.id}.current`, label: `${p.name}: current (A)` }, { key: `${p.id}.temp`, label: `${p.name}: temperature (°C)` });
    if (p.type === 'generator') out.push({ key: `${p.id}.watts`, label: `${p.name}: power (W)` });
  }
  out.push({ key: 'energy.kinetic', label: 'Total kinetic energy (J)' }, { key: 'energy.potential', label: 'Total potential energy (J)' });
  return out;
};

export default function MechEditor({ store, coach, onEvent, onCustomAdded, lessonStep, lessonEvents, onLessonPass, bbDocRef, bbCircuitRef, pcbDoc }) {
  const doc = store.doc;
  const { getDoc } = store;
  const canvasRef = useRef(null); const stageRef = useRef(null); const fileRef = useRef(null); const menuRef = useRef(null);
  const dragRef = useRef(null); // { base: Map<id,{x,y,z}>, baseBoxes, ids, start: {x,y,z} } while a ground-plane drag is in progress
  const transformRef = useRef(null); // { base: Map<id,{x,y,z}> } while the XYZ gizmo is being dragged
  const machineRef = useRef(null);
  const [tool, setTool] = useState('select');
  const [placing, setPlacing] = useState(null);
  const [selection, setSelection] = useState([]);
  const [connectA, setConnectA] = useState(null);
  const [leftTab, setLeftTab] = useState('library');
  const [rightTab, setRightTab] = useState('props');
  const [leftFloat] = useState(false);
  const [rightFloat, setRightFloat] = useState(false);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [tick, setTick] = useState(0);
  const [checks, setChecks] = useState({ issues: [], report: [] });
  const [scopeKeys, setScopeKeys] = useState([]);
  const [scopeData, setScopeData] = useState({});
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [status, setStatus] = useState({ time: 0, dof: 0 });
  useDismiss(menuRef, () => setMenu(false));

  const say = useCallback((m) => setToast(m), []);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t); }, [toast]);

  /* ---------------------------------------------------------------- machine */

  const rebuildMachine = useCallback(() => {
    try { machineRef.current = new Machine(getDoc()); }
    catch (e) { machineRef.current = null; say(`Couldn’t build this mechanism: ${e.message}`); }
    setScopeData({});
  }, [getDoc, say]);

  // Dragging a control (motor duty, brake apply, …) must NOT throw away the running simulation.
  // patchControl/patchLinkControl update the live Machine directly and set this flag so the
  // doc-change effect below — which normally rebuilds the Machine from scratch — skips just once.
  const skipRebuild = useRef(false);
  useEffect(() => {
    if (skipRebuild.current) { skipRebuild.current = false; return; }
    rebuildMachine();
  }, [doc, rebuildMachine]);

  /* ------------------------------------------------------------------ stage */

  useEffect(() => {
    const stage = new MechStage(canvasRef.current);
    stageRef.current = stage;
    const ro = new ResizeObserver(() => stage.resize());
    if (canvasRef.current?.parentElement) ro.observe(canvasRef.current.parentElement);
    return () => { ro.disconnect(); stage.dispose(); };
  }, []);

  useEffect(() => { stageRef.current?.setSnapEnabled(snapEnabled); }, [snapEnabled]);

  // The click handler reads `tool` / `placing` / `connectA`, so it is re-registered whenever they
  // change (stage.on() just swaps the stored callback — the stage itself is created only once above).
  useEffect(() => {
    stageRef.current?.on('click', ({ hit, shift, point }) => {
      if (tool === 'place' && placing) {
        const def = PART_TYPES[placing];
        // Clicking directly on a shaft (or on something already mounted on one) while placing a
        // shaft-mounted part attaches it there right away — the ground point is only used otherwise.
        let onShaft = null;
        if (def.mount === 'shaft' && hit) {
          const hitPart = byId(getDoc(), hit.partId);
          onShaft = hitPart?.type === 'shaft' ? hitPart.id : (hitPart && isShaftMounted(hitPart) ? hitPart.shaft : null);
        }
        if (!onShaft && !point) return;
        let created;
        store.commit((d) => {
          created = onShaft
            ? addPart(d, placing, { shaft: onShaft, axial: 0, phase: 0 })
            : addPart(d, placing, { x: Math.round(point.x), y: Math.round(point.y), z: Math.round(point.z) });
        });
        setSelection([created.id]); setRightTab('props'); onEvent?.('placed:' + placing);
        return;
      }
      if (tool === 'connect') {
        if (!hit) { setConnectA(null); return; }
        if (!connectA) { setConnectA(hit.partId); return; }
        if (hit.partId === connectA) { setConnectA(null); return; }
        let res;
        store.commit((d) => { res = connect(d, connectA, hit.partId); });
        if (res?.error) say(res.error); else { onEvent?.('connected'); say('Connected.'); }
        setConnectA(null);
        return;
      }
      if (!hit) { if (!shift) setSelection([]); return; }
      setSelection((sel) => (shift ? (sel.includes(hit.partId) ? sel.filter((i) => i !== hit.partId) : [...sel, hit.partId]) : [hit.partId]));
      setRightTab('props');
    });
    // The ghost preview (translucent part outline while placing) follows the cursor on the ground
    // plane, or snaps onto a shaft when hovering one — matching exactly where a click would place it.
    stageRef.current?.on('hover', ({ hit, point }) => {
      if (tool !== 'place' || !placing) return;
      const def = PART_TYPES[placing];
      let onShaft = null;
      if (def.mount === 'shaft' && hit) {
        const hitPart = byId(getDoc(), hit.partId);
        onShaft = hitPart?.type === 'shaft' ? hitPart.id : (hitPart && isShaftMounted(hitPart) ? hitPart.shaft : null);
      }
      if (onShaft) { const shaft = byId(getDoc(), onShaft); if (shaft) stageRef.current.setGhostPose(restMatrix(shaft)); return; }
      if (point) stageRef.current.setGhostPose(compose([point.x, point.y, point.z], [0, 0, 0]));
    });
    // Dragging a selected part slides it across the ground plane (X/Z only — Y, height, is set
    // numerically in Properties). Only "free"-mount parts (shafts, frames, sliders, vehicles,
    // static custom models) have their own x/y/z; shaft-mounted parts follow their shaft instead,
    // so dragging one is a no-op here rather than doing something that looks like it worked but isn't real.
    stageRef.current?.on('dragStart', ({ hit }) => {
      if (tool !== 'select' || !hit) { dragRef.current = null; return; }
      const d = getDoc();
      const ids = selection.includes(hit.partId) ? selection : [hit.partId];
      const base = new Map();
      for (const id of ids) { const p = byId(d, id); if (p && !isShaftMounted(p) && 'x' in p) base.set(id, { x: p.x, y: p.y, z: p.z }); }
      if (!base.size) { dragRef.current = null; return; }
      if (!selection.includes(hit.partId)) setSelection([hit.partId]);
      store.mark();
      dragRef.current = { base, ids: [...base.keys()], baseBoxes: stageRef.current?.getSelectionBoxes([...base.keys()]) ?? [], start: null };
    });
    stageRef.current?.on('dragMove', ({ point, start }) => {
      const drag = dragRef.current;
      if (!drag) return;
      const raw = [point.x - start.x, 0, point.z - start.z];
      const delta = stageRef.current?.snapDragDelta(drag.ids, raw, drag.baseBoxes) ?? raw;
      skipRebuild.current = true; // a smooth drag shouldn't reset the running simulation on every mouse-move frame
      store.update((d) => { for (const id of drag.ids) { const b = drag.base.get(id), p = byId(d, id); if (b && p) { p.x = b.x + delta[0]; p.z = b.z + delta[2]; } } });
    });
    stageRef.current?.on('dragEnd', () => {
      if (dragRef.current) rebuildMachine(); // now that the drag is finished, rebuild once against the final geometry
      dragRef.current = null;
    });
  }, [tool, placing, connectA, selection, store, onEvent, say, getDoc, rebuildMachine]);

  useEffect(() => { stageRef.current?.sync(doc, selection); }, [doc, selection]);

  // Frame the camera on the content once when this workbench mounts (it remounts fresh each time
  // the person switches to the Mechanical bench, including when a mechanical lesson starts it),
  // so whatever is on the board is immediately visible rather than off-screen or too small/large.
  useEffect(() => {
    const id = requestAnimationFrame(() => stageRef.current?.frameAll());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------------------------------------------------- controls */

  const patch = useCallback((id, p) => store.commit((d) => Object.assign(byId(d, id), p)), [store]);
  /** For live controls only (sliders that drag while the sim runs): keeps the Machine's state intact. */
  const patchControl = useCallback((id, p) => {
    skipRebuild.current = true;
    store.update((d) => Object.assign(byId(d, id), p));
    const mc = machineRef.current;
    if (mc) for (const [k, v] of Object.entries(p)) mc.setControl(id, k, v);
  }, [store]);
  const patchLinkControl = useCallback((id, p) => {
    skipRebuild.current = true;
    store.update((d) => Object.assign(linkById(d, id), p));
    const mc = machineRef.current;
    if (mc) for (const [k, v] of Object.entries(p)) mc.setLinkControl(id, k, v);
  }, [store]);
  const patchLink = useCallback((id, p) => store.commit((d) => Object.assign(linkById(d, id), p)), [store]);
  const remove = useCallback(() => { if (!selection.length) return; store.commit((d) => { for (const id of selection) removePart(d, id); }); setSelection([]); }, [store, selection]);
  const removeId = useCallback((id) => { store.commit((d) => removePart(d, id)); setSelection((sel) => sel.filter((s) => s !== id)); }, [store]);
  const duplicate = useCallback(() => {
    if (selection.length !== 1) return;
    let made;
    store.commit((d) => { const src = byId(d, selection[0]); made = addPart(d, src.type, { ...src, id: undefined, name: undefined, x: src.x + 20, y: src.y, shaft: '' }); });
    setSelection([made.id]);
  }, [store, selection]);
  const rotateSel = useCallback(() => {
    store.commit((d) => { for (const id of selection) { const p = byId(d, id); if (!p) continue; if (isShaftMounted(p)) p.phase = ((p.phase ?? 0) + 90) % 360; else p.rz = ((p.rz ?? 0) + 90) % 360; } autoPhase(d); });
  }, [store, selection]);

  const arm = useCallback((type) => { setPlacing(type); setTool('place'); setConnectA(null); }, []);
  const loadPreset = useCallback((id) => {
    const def = getMechPreset(id);
    if (!def) return;
    store.replace(def.build());
    setSelection([]); setLeftTab('library'); setTool('select'); setPlacing(null);
    onEvent?.('preset:' + id);
    requestAnimationFrame(() => stageRef.current?.frameAll());
  }, [store, onEvent]);

  const importModel = useCallback(() => fileRef.current?.click(), []);
  const onFile = useCallback(async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try {
      const isStl = /\.stl$/i.test(file.name);
      const raw = isStl ? new Uint8Array(await file.arrayBuffer()) : await file.text();
      const mesh = isStl ? parseStl(raw) : parseObj(raw);
      const norm = normalizeImport(mesh, 'mm', 'bbox');
      let made;
      store.commit((d) => { made = addCustomFromMesh(d, norm, { attach: 'static', material: 'aluminum' }); });
      setSelection([made.id]); setRightTab('props');
      onCustomAdded?.(norm);
      say(`Imported ${file.name}: ${norm.indices.length / 3} triangles.`);
    } catch (err) { say(`Couldn’t read that file: ${err.message}`); }
  }, [store, say, onCustomAdded]);

  const saveProject = useCallback(() => download('breadbai-machine.json', JSON.stringify(getDoc(), null, 2), 'application/json'), [getDoc]);
  const openProject = useCallback(async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try { const d = JSON.parse(await file.text()); if (!Array.isArray(d.parts)) throw new Error('not a machine file'); store.replace(d); setSelection([]); requestAnimationFrame(() => stageRef.current?.frameAll()); }
    catch { say('That file is not a BreadBai machine project.'); }
  }, [store, say]);

  const focus = useCallback((partId, linkId) => {
    if (partId) setSelection([partId]);
    else if (linkId) { const l = linkById(getDoc(), linkId); if (l) setSelection([l.a]); }
    setRightTab('props');
  }, [getDoc]);

  /* ------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') { setTool('select'); setPlacing(null); setConnectA(null); setSelection([]); return; }
      if (e.key === ' ') { e.preventDefault(); setRunning((r) => !r); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { remove(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      const low = e.key.toLowerCase();
      if (low === 'v') { setTool('select'); setPlacing(null); return; }
      if (low === 'c') { setTool('connect'); setPlacing(null); return; }
      if (low === 'r' && selection.length) { rotateSel(); return; }
      if (low === 'f') { stageRef.current?.frameAll(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, selection, remove, rotateSel]);

  /* ------------------------------------------------------------ XYZ gizmo */

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.on('transformStart', () => {
      const d = getDoc();
      const base = new Map();
      for (const id of selection) { const p = byId(d, id); if (p && !isShaftMounted(p) && 'x' in p) base.set(id, { x: p.x, y: p.y, z: p.z }); }
      if (!base.size) { transformRef.current = null; return; }
      store.mark();
      transformRef.current = { base };
    });
    stage.on('transform', ({ delta }) => {
      const tx = transformRef.current;
      if (!tx) return;
      skipRebuild.current = true;
      store.update((d) => {
        for (const [id, b] of tx.base) {
          const p = byId(d, id);
          if (p) { p.x = b.x + delta[0]; p.y = b.y + delta[1]; p.z = b.z + delta[2]; }
        }
      });
    });
    stage.on('transformEnd', () => {
      if (!transformRef.current) return;
      transformRef.current = null;
      rebuildMachine();
    });
  }, [getDoc, selection, store, rebuildMachine]);

  /* --------------------------------------------------------------- frame loop */

  // Keep this before any hook dependency arrays that reference it.
  // Declaring it later caused a temporal-dead-zone ReferenceError during render,
  // preventing the entire Mechanical workbench from mounting.
  const sysLinks = (getDoc().systemLinks ?? []);

  const checkClock = useRef(0); const scopeClock = useRef(0);
  useEffect(() => {
    stageRef.current?.on('onFrame', (rawDt) => {
      const mc = machineRef.current;
      if (!mc) return;
      const dt = Math.min(rawDt, 1 / 20);
      if (running && mc.d >= 0) {
        const stepDt = getDoc().dt ?? 2e-4;
        const wantSeconds = dt * speed;
        const bbCircuit = bbCircuitRef?.current, bbDoc = bbDocRef?.current;
        const sysLinks = getDoc().systemLinks ?? [];
        if (sysLinks.length && bbCircuit && bbDoc) {
          const steps = Math.min(6000, Math.max(1, Math.round(wantSeconds / stepDt)));
          for (let i = 0; i < steps; i++) coupledStep(sysLinks, bbDoc, bbCircuit, getDoc(), mc, stepDt);
        } else {
          mc.advance(wantSeconds, stepDt, 6000);
        }
      }
      stageRef.current.applyPoses(getDoc(), mc.poses());
      checkClock.current += rawDt;
      if (checkClock.current > 0.25) {
        checkClock.current = 0;
        setChecks(mechChecks(getDoc(), mc));
        setStatus({ time: mc.t, dof: mc.d, diverged: mc.diverged });
        if (lessonStep?.check) {
          try { if (lessonStep.check({ mech: getDoc(), machine: mc, events: lessonEvents ?? new Set() })) onLessonPass?.(); }
          catch { /* a lesson check should never crash the sim loop */ }
        }
      }
      scopeClock.current += rawDt;
      if (scopeKeys.length && scopeClock.current > 0.05) {
        scopeClock.current = 0;
        const r = mc.readout();
        setScopeData((prev) => {
          const next = { ...prev };
          for (const k of scopeKeys) { const arr = (next[k] ?? []).concat({ t: mc.t, v: r[k] ?? 0 }); next[k] = arr.length > 400 ? arr.slice(-400) : arr; }
          return next;
        });
      }
      setTick((t) => (t + 1) % 1000000);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, speed, scopeKeys, getDoc, lessonStep, lessonEvents, onLessonPass, sysLinks, bbCircuitRef, bbDocRef]);

  const reset = useCallback(() => { rebuildMachine(); setScopeData({}); }, [rebuildMachine]);

  /* -------------------------------------------------------------- ghost/api */

  useEffect(() => {
    if (tool !== 'place' || !placing) { stageRef.current?.setGhost(null); return; }
    // The ghost needs real parameter values (teeth, module, …), not the catalog definition itself —
    // spreading PART_TYPES[placing] here previously left every numeric field undefined.
    stageRef.current?.setGhost({ id: 'ghost', type: placing, name: '', x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, ...paramDefaults(placing) });
  }, [tool, placing]);

  const api = useMemo(() => ({
    arm, loadPreset, importModel, patch, patchControl, patchLink, patchLinkControl, remove, removeId, duplicate, focus,
    connectClassify: (aId, bId) => classifyPair(getDoc(), byId(getDoc(), aId), byId(getDoc(), bId)),
    snap: (linkId) => { store.commit((d) => snapToMesh(d, linkId)); },
    removeLinkAction: (linkId) => store.commit((d) => removeLink(d, linkId)),
    addLink: (bbId, mechId, pcbId = null) => {
      const bbPart = bbDocRef?.current?.parts.find((p) => p.id === bbId);
      if (!bbPart) return;
      store.commit((d) => {
        d.systemLinks ??= [];
        if (d.systemLinks.some((l) => l.bbId === bbId || l.mechId === mechId || (pcbId && l.pcbId === pcbId))) return;
        d.systemLinks.push({ ...makeLink(bbPart, mechId), pcbId });
      });
    },
    removeLinkSys: (id) => store.commit((d) => { d.systemLinks = (d.systemLinks ?? []).filter((l) => l.id !== id); }),
    linkReadout: (l) => (bbDocRef?.current && machineRef.current ? linkReadout(l, bbDocRef.current, machineRef.current) : null),
  }), [arm, loadPreset, importModel, patch, patchControl, patchLink, patchLinkControl, remove, removeId, duplicate, focus, getDoc, store, bbDocRef]);

  const doc2 = doc; // stable alias for readability below
  void tick;

  return (
    <div className="pcb-app mech-app">
      <div className="pcb-topbar">
        <div className="seg" role="group">
          {TOOLS.map(([id, label, key, tip]) => (<button key={id} aria-pressed={tool === id} title={`${tip} (${key})`} onClick={() => { setTool(id); setPlacing(null); setConnectA(null); }}>{label}</button>))}
        </div>
        <div className="pcb-sep" />
        <div className="seg transport" role="group">
          <button aria-pressed={running} onClick={() => setRunning((r) => !r)} title="Play/pause (space)">{running ? '⏸' : '▶'}</button>
          <button onClick={reset} title="Reset to the starting state">↺</button>
        </div>
        <label className="pcb-w" title="Simulation speed multiplier">
          Speed
          <select value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} onKeyDown={(e) => e.stopPropagation()}>
            {[0.1, 0.25, 0.5, 1, 2, 4, 8].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <button className="cad-snap-toggle" aria-pressed={snapEnabled} onClick={() => setSnapEnabled((v) => !v)} title="Snap selected objects to nearby faces, edges and centres">Snap</button>
        <div className="pcb-spacer" />
        <button className="btn ghost icon" onClick={store.undo} disabled={!store.canUndo} title="Undo (⌘Z)">↶</button>
        <button className="btn ghost icon" onClick={store.redo} disabled={!store.canRedo} title="Redo (⇧⌘Z)">↷</button>
        <div className="menu-wrap" ref={menuRef}>
          <button className="btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>File ▾</button>
          {menu && (
            <div className="menu glass pcb-menu" role="menu">
              <button role="menuitem" onClick={() => { setMenu(false); saveProject(); }}><span className="t">Save machine</span><span className="d">Editable .json file</span></button>
              <button role="menuitem" onClick={() => { setMenu(false); document.getElementById('mech-open-input')?.click(); }}><span className="t">Open machine…</span></button>
              <button role="menuitem" onClick={() => { setMenu(false); store.replace({ ...getDoc(), parts: [], links: [], meshes: {} }); setSelection([]); }}><span className="t">Clear board</span></button>
            </div>
          )}
          <input id="mech-open-input" type="file" accept="application/json,.json" hidden onChange={openProject} />
          <input ref={fileRef} type="file" accept=".stl,.obj" hidden onChange={onFile} />
        </div>
      </div>

      <div className="pcb-main">
        <aside className={`pcb-side left glass cad-window ${leftFloat ? "cad-floating" : ""}`}>
          <div className="pcb-tabs" role="tablist">
            {[['library', 'Parts'], ['presets', 'Presets'], ['items', 'Items'], ['systems', 'Systems'], ['checks', 'Check']].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={leftTab === id} onClick={() => setLeftTab(id)}>
                {label}
                {id === 'items' && doc2.parts.length > 0 && <span className="count-badge">{doc2.parts.length}</span>}
                {id === 'checks' && (checks.issues.filter((i) => i.level !== 'info').length > 0) && <span className={`badge ${checks.issues.some((i) => i.level === 'error') ? 'err' : 'warn'}`}>{checks.issues.filter((i) => i.level !== 'info').length}</span>}
              </button>
            ))}
          </div>
          <div className="pcb-tabbody">
            {leftTab === 'library' && <MechLibraryPanel api={api} placing={placing} />}
            {leftTab === 'presets' && <PresetsPanel api={api} />}
            {leftTab === 'items' && <MechItemsPanel doc={doc2} selection={selection} api={api} />}
            {leftTab === 'systems' && <SystemsPanel doc={doc2} bbDoc={bbDocRef?.current} pcbDoc={pcbDoc} links={sysLinks} api={api} />}
            {leftTab === 'checks' && <ChecksPanel checks={checks} api={api} />}
          </div>
        </aside>

        <div className="pcb-canvas mech-canvas">
          <canvas ref={canvasRef} />
          {tool === 'connect' && (
            <div className="mech-connect-hint glass">{connectA ? `${byId(doc2, connectA)?.name ?? '…'} selected — click its partner` : 'Click a part to start a connection'}</div>
          )}
          <div className="pcb-zoom glass">
            <button onClick={() => stageRef.current?.frameAll()} aria-label="Frame all" title="Frame everything (F)">⤢</button>
          </div>
          {toast && <div className="pcb-toast glass" role="status">{toast}</div>}
        </div>

        <aside className={`pcb-side right glass cad-window ${rightFloat ? "cad-floating right" : ""}`}>
          {coach}
          <div className="glass pcb-side-inner">
            <div className="pcb-tabs" role="tablist">
              {[['props', 'Properties'], ['controls', 'Controls'], ['scope', 'Scope']].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={rightTab === id} onClick={() => setRightTab(id)}>{label}</button>
              ))}
              <button className="panel-popout" onClick={() => setRightFloat((v) => !v)} title={rightFloat ? 'Dock window' : 'Pop out window'}>{rightFloat ? '↘' : '↗'}</button>
            </div>
            <div className="pcb-tabbody">
              {rightTab === 'props' && (tool === 'connect'
                ? <ConnectPanel doc={doc2} pendingA={connectA} api={api} />
                : <MechPropsPanel doc={doc2} machine={machineRef.current} selection={selection} api={api} />)}
              {rightTab === 'controls' && <ControlsPanel doc={doc2} machine={machineRef.current} api={api} />}
              {rightTab === 'scope' && (
                <ScopePanel
                  signals={SIGNALS_FOR(doc2)}
                  series={scopeKeys.map((k) => ({ key: k, label: SIGNALS_FOR(doc2).find((s) => s.key === k)?.label ?? k, data: scopeData[k] ?? [] }))}
                  onAdd={(k) => setScopeKeys((ks) => (ks.includes(k) ? ks : [...ks, k]))}
                  onRemove={(k) => setScopeKeys((ks) => ks.filter((x) => x !== k))}
                />
              )}
            </div>
          </div>
        </aside>
      </div>

      <div className="pcb-status">
        <span className="mono">t = {status.time.toFixed(2)} s</span>
        <span>{status.dof} degree{status.dof === 1 ? '' : 's'} of freedom</span>
        <span className="hint">{HINTS[tool] ?? HINTS.select}</span>
        {status.diverged && <span className="bad">The simulation became unstable — press Reset.</span>}
      </div>
    </div>
  );
}
