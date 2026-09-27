import { useCallback, useEffect, useReducer, useRef, useState, useDeferredValue, useMemo } from 'react';
import { Stage } from './three/Stage.js';
import { Circuit, endpointKey } from './lib/circuit.js';
import { CATALOG } from './lib/catalog.js';
import { makePart, newId, getExample } from './lib/examples.js';
import { serialize, deserialize, download } from './lib/document.js';
import { computeInsertion } from './lib/placement.js';
import Palette from './ui/Palette.jsx';
import Inspector from './ui/Inspector.jsx';
import { TopBar, Toolbar, Dock, Transport, Legend, Banner } from './ui/Chrome.jsx';
import Coach from './ui/Coach.jsx';
import Doctor from './ui/Doctor.jsx';
import LearnHub from './ui/LearnHub.jsx';
import { Icon } from './ui/icons.jsx';
import { diagnose } from './lib/diagnose.js';
import { getLesson, nextLessonId } from './lib/lessons.js';
import { loadProgress, saveProgress } from './lib/progress.js';
import splash from './assets/bread3.webp';
import PcbEditor from './pcb/PcbEditor.jsx';
import MechEditor from './mech/MechEditor.jsx';
import { useMechDoc } from './mech/mechStore.js';
import { analyze } from './pcb/analysis.js';
import { CATALOG_FOOTPRINTS } from './pcb/footprints.js';
import { extractNetlist } from './pcb/netlist.js';
import { usePcbDoc } from './pcb/pcbStore.js';

const DT = 1e-3;                       // 1 kHz solver step
const MAX_STEPS = 240;                 // never let a slow frame melt the tab
const WIRE_COLORS = ['#e8e8ec', '#ffd60a', '#30d158', '#64d2ff', '#bf5af2', '#ff9f0a'];

/** Snapshot of the solved circuit that the 3D stage paints holes and wires with. */
function makeProbe(circuit) {
  if (!circuit) return null;
  const voltage = new Map();
  const net = new Map();
  const live = new Set();
  let vmax = 1;

  for (const [key, n] of circuit.keyToNet) {
    const idx = circuit.netIndex(key);
    const v = idx < 0 ? 0 : circuit.sys.x[idx];
    voltage.set(key, v);
    net.set(key, n);
    if (Math.abs(v) > vmax) vmax = Math.abs(v);
  }
  // A net is "live" (worth colouring) if something is actually attached to it.
  const counts = new Map();
  for (const [, n] of circuit.keyToNet) counts.set(n, (counts.get(n) ?? 0) + 1);
  for (const [n, c] of counts) if (c > 1) live.add(n);

  const at = (map) => (ep) => {
    const k = endpointKey(ep);
    return k == null ? undefined : map.get(k);
  };
  return {
    voltage, net, live, vmax: Math.max(1, vmax),
    voltageOfEndpoint: at(voltage),
    netOfEndpoint: at(net),
  };
}

export default function App() {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const docRef = useRef({ parts: [], wires: [] });
  const circuitRef = useRef(null);
  const past = useRef([]);
  const future = useRef([]);
  const audioRef = useRef(null);
  const statusClock = useRef(0);
  const wireColor = useRef(0);
  const lessonRef = useRef(null);
  const eventsRef = useRef(new Set());
  const liveRef = useRef({ mode: 'standard', running: true, selection: null });

  const [, force] = useReducer((n) => n + 1, 0);
  const [selection, setSelection] = useState(null);
  const [tool, setTool] = useState('select');
  const [mode, setMode] = useState('standard');
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [placing, setPlacing] = useState(null);
  const [sound, setSound] = useState(true);
  const [help, setHelp] = useState(false);
  const [intro, setIntro] = useState('show');
  const [status, setStatus] = useState({ time: 0, nodes: 0, converged: true, issues: [] });
  const [vmax, setVmax] = useState(9);
  const [lesson, setLessonState] = useState(null);      // { id, step, done, finished }
  const [hub, setHub] = useState(null);                 // { tab, guideType }
  const [progress, setProgress] = useState(loadProgress);
  const progressRef = useRef(progress);
  const [bench, setBench] = useState('breadboard');      // 'breadboard' | 'pcb' | 'mech' | 'split'
  const [splitRatio, setSplitRatio] = useState(0.5);      // breadboard/mechanical divider position, only used when bench === 'split'
  const [pcbTick, setPcbTick] = useState(0);
  const appRef = useRef(null);
  const splitDrag = useRef(false);
  const onSplitDown = useCallback((e) => {
    e.preventDefault();
    const el = appRef.current;
    if (!el) return;
    splitDrag.current = true;
    const rect = el.getBoundingClientRect();
    const move = (ev) => {
      if (!splitDrag.current) return;
      const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      setSplitRatio(Math.min(0.82, Math.max(0.18, x / rect.width)));
    };
    const up = () => {
      splitDrag.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
  }, []);
  const pcb = usePcbDoc();
  const mech = useMechDoc();
  const { replace: pcbReplace, reset: pcbReset } = pcb;
  const deferredPcb = useDeferredValue(pcb.doc);
  const pcbAnalysis = useMemo(() => (bench === 'pcb' ? analyze(deferredPcb) : null), [deferredPcb, bench]);

  const doc = docRef.current;

  // ------------------------------------------------------ lessons & events

  const setLesson = useCallback((next) => {
    lessonRef.current = next;
    setLessonState(next);
  }, []);

  /** Records something the person just did, so lesson steps can react to it. */
  const track = useCallback((name) => { eventsRef.current.add(name); }, []);

  // ----------------------------------------------------------- document ops

  const rebuild = useCallback(() => {
    circuitRef.current = new Circuit(docRef.current.parts, docRef.current.wires);
    force();
  }, []);

  const snapshot = useCallback(() => {
    past.current.push(JSON.stringify(serialize(docRef.current)));
    if (past.current.length > 80) past.current.shift();
    future.current.length = 0;
  }, []);

  const load = useCallback((next, { keepHistory = false } = {}) => {
    if (!keepHistory) { past.current.length = 0; future.current.length = 0; }
    docRef.current = next;
    setSelection(null);
    rebuild();
  }, [rebuild]);

  const loadExample = useCallback((id) => {
    setLesson(null);
    load(getExample(id).build());
    requestAnimationFrame(() => stageRef.current?.frameAll());
  }, [load, setLesson]);

  const startLesson = useCallback((id) => {
    const def = getLesson(id);
    if (!def) return;
    if (def.bench === 'pcb') {
      pcbReset(def.setup());
      setBench('pcb');
      eventsRef.current = new Set();
      setLesson({ id, step: 0, done: false, finished: false });
      setHub(null);
      return;
    }
    if (def.bench === 'mech') {
      mech.reset(def.setup());
      setBench('mech');
      eventsRef.current = new Set();
      setLesson({ id, step: 0, done: false, finished: false });
      setHub(null);
      return;
    }
    setBench('breadboard');
    load(def.setup());
    stageRef.current?.cancelPlacement();
    stageRef.current?.cancelWire();
    setPlacing(null);
    setTool('select');
    setMode('standard');
    setRunning(!def.startPaused);
    eventsRef.current = new Set();
    setLesson({ id, step: 0, done: false, finished: false });
    setHub(null);
    requestAnimationFrame(() => stageRef.current?.frameAll());
  }, [load, setLesson, pcbReset, mech]);

  const completeStep = useCallback(() => {
    const L = lessonRef.current;
    if (L && !L.done) setLesson({ ...L, done: true });
  }, [setLesson]);

  const advanceLesson = useCallback(() => {
    const L = lessonRef.current;
    const def = L && getLesson(L.id);
    if (!def) return;
    eventsRef.current = new Set();
    if (L.step + 1 >= def.steps.length) {
      setLesson({ ...L, step: def.steps.length, done: true, finished: true });
      const next = { ...progressRef.current, [L.id]: { at: Date.now() } };
      progressRef.current = next;
      setProgress(next);
      saveProgress(next);
    } else {
      setLesson({ ...L, step: L.step + 1, done: false, finished: false });
    }
  }, [setLesson]);

  const backLesson = useCallback(() => {
    const L = lessonRef.current;
    if (!L || L.step === 0) return;
    eventsRef.current = new Set();
    setLesson({ ...L, step: L.step - 1, done: true, finished: false });
  }, [setLesson]);

  const showSolution = useCallback(() => {
    const def = getLesson(lessonRef.current?.id);
    if (!def?.solution) return;
    if (def.bench === 'pcb') { pcbReplace(def.solution()); return; }
    if (def.bench === 'mech') { mech.replace(def.solution()); return; }
    load(def.solution());
    requestAnimationFrame(() => stageRef.current?.frameAll());
  }, [load, pcbReplace, mech]);

  const pcbEvent = useCallback((name) => {
    eventsRef.current.add(name);
    setPcbTick((t) => t + 1);
  }, []);

  const openHub = useCallback((tab = 'lessons', guideType = null) => {
    setHub((h) => ({ tab, guideType: guideType ?? h?.guideType ?? 'resistor' }));
  }, []);

  // ------------------------------------------------------------- edit verbs

  const placePart = useCallback((info) => {
    snapshot();
    const part = makePart(info.type, { x: info.x, z: info.z, y: info.y ?? 0, rot: info.rot ?? 0 });
    part.inserted = info.inserted ?? {};
    docRef.current.parts.push(part);
    setPlacing(null);
    setSelection(part.id);
    track('placed:' + info.type);
    rebuild();
  }, [rebuild, snapshot, track]);

  const movePart = useCallback((id, result) => {
    const part = docRef.current.parts.find((p) => p.id === id);
    if (!part) return;
    snapshot();
    part.x = result.x; part.z = result.z; part.y = result.y ?? 0;
    part.inserted = result.inserted ?? {};
    rebuild();
  }, [rebuild, snapshot]);

  const rotatePart = useCallback((id) => {
    const part = docRef.current.parts.find((p) => p.id === id);
    if (!part || CATALOG[part.type].board) return;
    snapshot();
    part.rot = ((part.rot ?? 0) + Math.PI / 2) % (Math.PI * 2);
    const board = docRef.current.parts.find((p) => CATALOG[p.type].board);
    part.inserted = board ? computeInsertion(part, board) : {};
    track('rotated');
    rebuild();
  }, [rebuild, snapshot, track]);

  const duplicatePart = useCallback((id) => {
    const src = docRef.current.parts.find((p) => p.id === id);
    if (!src || CATALOG[src.type].board) return;
    snapshot();
    const copy = makePart(src.type, {
      x: src.x + 7.62, z: src.z, y: src.y, rot: src.rot, props: { ...src.props },
    });
    copy.inserted = {};
    docRef.current.parts.push(copy);
    setSelection(copy.id);
    rebuild();
  }, [rebuild, snapshot]);

  const deletePart = useCallback((id) => {
    snapshot();
    docRef.current.parts = docRef.current.parts.filter((p) => p.id !== id);
    docRef.current.wires = docRef.current.wires.filter(
      (w) => ![w.a, w.b].some((ep) => (ep.kind === 'pin' ? ep.partId : ep.boardId) === id));
    setSelection(null);
    rebuild();
  }, [rebuild, snapshot]);

  const addWire = useCallback((a, b) => {
    if (!a || !b) return;
    if (endpointKey(a) === endpointKey(b)) return;
    snapshot();
    const railOf = (ep) => (ep.kind === 'hole' ? ep.group : null);
    const rail = railOf(a) ?? railOf(b);
    let color;
    if (rail === 'tpos' || rail === 'bpos') color = '#ff453a';
    else if (rail === 'tneg' || rail === 'bneg') color = '#48484a';
    else color = WIRE_COLORS[wireColor.current++ % WIRE_COLORS.length];
    docRef.current.wires.push({ id: newId('w'), a, b, color });
    track('wire');
    rebuild();
  }, [rebuild, snapshot, track]);

  const deleteWire = useCallback((id) => {
    snapshot();
    docRef.current.wires = docRef.current.wires.filter((w) => w.id !== id);
    rebuild();
  }, [rebuild, snapshot]);

  const setProp = useCallback((id, key, value) => {
    const part = docRef.current.parts.find((p) => p.id === id);
    if (!part) return;
    const schema = CATALOG[part.type].props.find((p) => p.key === key);
    if (!schema?.live) snapshot();
    part.props = { ...part.props, [key]: value };
    track(`prop:${part.type}:${key}`);
    force();
  }, [snapshot, track]);

  const interact = useCallback((id, phase) => {
    const part = docRef.current.parts.find((p) => p.id === id);
    if (!part) return;
    const def = CATALOG[part.type];
    if (phase === 'press') { def.onPress?.(part); track('pressed:' + part.type); }
    else def.onRelease?.(part);
    force();
  }, [track]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(JSON.stringify(serialize(docRef.current)));
    load(deserialize(JSON.parse(prev)), { keepHistory: true });
  }, [load]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(JSON.stringify(serialize(docRef.current)));
    load(deserialize(JSON.parse(next)), { keepHistory: true });
  }, [load]);

  const saveFile = useCallback(() => {
    download('circuit.BreadBai.json', JSON.stringify(serialize(docRef.current), null, 2));
  }, []);

  const openFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        setLesson(null);
        load(deserialize(JSON.parse(await file.text())));
        requestAnimationFrame(() => stageRef.current?.frameAll());
      } catch (err) {
        alert(err.message ?? 'That file could not be opened.');
      }
    };
    input.click();
  }, [load, setLesson]);

  // ----------------------------------------------------------------- audio

  const syncAudio = useCallback(() => {
    const ctx = audioRef.current;
    if (!ctx) return;
    let level = 0, freq = 2400;
    for (const part of docRef.current.parts) {
      if (part.type !== 'buzzer') continue;
      level = Math.max(level, part.state.level ?? 0);
      freq = part.props.freq ?? freq;
    }
    const target = sound ? Math.min(0.07, level * 0.07) : 0;
    ctx.gain.gain.setTargetAtTime(target, ctx.audio.currentTime, 0.02);
    ctx.osc.frequency.setTargetAtTime(freq, ctx.audio.currentTime, 0.02);
  }, [sound]);

  // ------------------------------------------------------------ frame loop

  const onFrame = useCallback((dt) => {
    const circuit = circuitRef.current;
    if (!circuit) return;
    if (running) {
      const steps = Math.min(MAX_STEPS, Math.max(1, Math.round((dt * speed) / DT)));
      for (let i = 0; i < steps; i++) circuit.step(DT);
    }
    syncAudio();

    if (mode !== 'standard') {
      const probe = makeProbe(circuit);
      stageRef.current?.updateProbe(probe);
      if (probe && Math.abs(probe.vmax - vmax) > 0.25) setVmax(probe.vmax);
    }

    statusClock.current += dt;
    if (statusClock.current > 0.12) {
      statusClock.current = 0;
      const issues = diagnose(docRef.current, circuit);
      setStatus({ time: circuit.time, nodes: circuit.nodeCount, converged: circuit.converged, issues });

      const L = lessonRef.current;
      if (L && !L.done && !L.finished) {
        const step = getLesson(L.id)?.steps[L.step];
        if (step?.check?.({ doc: docRef.current, circuit, events: eventsRef.current, ...liveRef.current })) {
          lessonRef.current = { ...L, done: true };
          setLessonState(lessonRef.current);
        }
      }
    }
  }, [mode, running, speed, syncAudio, vmax]);

  // Stage callbacks are registered once; this ref keeps them pointing at the
  // latest closures without tearing down the WebGL context every render.
  const handlers = useRef({});
  handlers.current = {
    onSelect: setSelection,
    onFocus: (id) => { setSelection(id); },
    onMove: movePart,
    onWire: addWire,
    onDeleteWire: deleteWire,
    onInteract: interact,
    onProp: setProp,
    onPlace: placePart,
    onFrame,
  };

  // ------------------------------------------------------------------ mount

  useEffect(() => {
    const stage = new Stage(canvasRef.current);
    stageRef.current = stage;
    for (const name of ['onSelect', 'onFocus', 'onMove', 'onWire', 'onDeleteWire',
      'onInteract', 'onProp', 'onPlace', 'onFrame']) {
      stage.on(name, (...args) => handlers.current[name]?.(...args));
    }

    const onResize = () => stage.resize();
    window.addEventListener('resize', onResize);
    // The split view resizes this canvas's container without the window itself resizing (dragging
    // the divider, or switching in/out of split), so a plain 'resize' listener isn't enough here —
    // watch the container directly, same as the mechanical stage already does.
    const ro = new ResizeObserver(onResize);
    if (canvasRef.current?.parentElement) ro.observe(canvasRef.current.parentElement);
    stage.resize();

    docRef.current = getExample('first-light').build();
    circuitRef.current = new Circuit(docRef.current.parts, docRef.current.wires);
    force();
    requestAnimationFrame(() => stage.frameAll());

    const startAudio = () => {
      if (audioRef.current) return;
      try {
        const audio = new (window.AudioContext ?? window.webkitAudioContext)();
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'square';
        osc.frequency.value = 2400;
        gain.gain.value = 0;
        osc.connect(gain).connect(audio.destination);
        osc.start();
        audioRef.current = { audio, osc, gain };
      } catch { /* audio is a nicety, not a requirement */ }
    };
    window.addEventListener('pointerdown', startAudio, { once: true });

    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      window.removeEventListener('pointerdown', startAudio);
      audioRef.current?.audio.close();
      stage.dispose();
    };
  }, []);

  // Lesson checks run inside the frame loop, so mirror the UI state they read.
  useEffect(() => {
    liveRef.current = { mode, running, selection, bench };
    progressRef.current = progress;
  });

  // PCB lesson steps are checked whenever the board (or something the person did) changes.
  useEffect(() => {
    const L = lessonRef.current;
    if (!L || L.done || L.finished || bench !== 'pcb') return;
    const step = getLesson(L.id)?.steps[L.step];
    if (step?.check?.({ pcb: deferredPcb, analysis: pcbAnalysis, events: eventsRef.current })) completeStep();
  }, [bench, deferredPcb, pcbAnalysis, pcbTick, lesson, completeStep]);



  // Push the document at the stage after every render.
  useEffect(() => {
    stageRef.current?.sync(doc.parts, doc.wires, selection, tool, mode);
    if (mode === 'standard') stageRef.current?.updateProbe(null);
  });

  // ------------------------------------------------------------- shortcuts

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (liveRef.current.bench === 'pcb') { if (e.key === 'Escape') setHub(null); return; } // the PCB editor owns the keyboard
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); if (selection) duplicatePart(selection); return; }
      if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); return; }
      if (meta) return;
      switch (e.key) {
        case 'Escape':
          setHelp(false);
          setHub(null);
          setPlacing(null);
          stageRef.current?.cancelPlacement();
          stageRef.current?.cancelWire();
          setSelection(null);
          break;
        case 'Delete': case 'Backspace':
          if (selection) { e.preventDefault(); deletePart(selection); }
          break;
        case 'r': case 'R': if (selection) rotatePart(selection); break;
        case 'v': case 'V': setTool('select'); break;
        case 'w': case 'W': setTool('wire'); break;
        case 'f': case 'F': stageRef.current?.frameAll(); break;
        case 'l': case 'L': setHub((h) => (h ? null : { tab: 'lessons', guideType: 'resistor' })); break;
        case ' ': e.preventDefault(); setRunning((v) => !v); break;
        case '1': stageRef.current?.setView('iso'); break;
        case '2': stageRef.current?.setView('top'); break;
        case '3': stageRef.current?.setView('front'); break;
        case '4': stageRef.current?.setView('side'); break;
        default: break;
      }
      if ((e.key === 'r' || e.key === 'R') && placing) stageRef.current?.rotatePlacement();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deletePart, duplicatePart, placing, redo, rotatePart, saveFile, selection, undo]);

  // ---------------------------------------------------------------- actions

  const pick = useCallback((type) => {
    if (placing === type) { setPlacing(null); stageRef.current?.cancelPlacement(); return; }
    setPlacing(type);
    setTool('select');
    stageRef.current?.beginPlacement(type);
  }, [placing]);

  const placeFromGuide = useCallback((type) => {
    setHub(null);
    pick(type);
  }, [pick]);

  const stepOnce = useCallback(() => {
    for (let i = 0; i < 10; i++) circuitRef.current?.step(DT);
    force();
  }, []);

  const resetSim = useCallback(() => {
    circuitRef.current?.reset();
    for (const part of docRef.current.parts) {
      const def = CATALOG[part.type];
      part.state = def.state();
      part.mem = {};
    }
    rebuild();
  }, [rebuild]);

  // Recomputed every render on purpose: the status tick re-renders at ~8 Hz so
  // the inspector readout tracks the live solution.
  const selected = doc.parts.find((p) => p.id === selection) ?? null;
  const activeLesson = lesson ? getLesson(lesson.id) : null;
  const hasBreadboard = doc.parts.some((p) => CATALOG_FOOTPRINTS[p.type]);
  const coachEl = activeLesson && (activeLesson.bench ?? 'breadboard') === bench ? (
      <Coach
              lesson={activeLesson}
              stepIndex={lesson.step}
              done={lesson.done}
              finished={lesson.finished}
              nextLesson={getLesson(nextLessonId(lesson.id))}
              onDone={completeStep}
              onNext={advanceLesson}
              onBack={backLesson}
              onExit={() => setLesson(null)}
              onSolution={showSolution}
              onHub={() => openHub('lessons')}
              onStartLesson={startLesson}
            />
  ) : null;

  // ------------------------------------------------------------------ view

  return (
    <div className={`app${bench === 'split' ? ' is-split' : ''}`} ref={appRef} style={bench === 'split' ? { '--split-x': `${splitRatio * 100}%` } : undefined}>
      <TopBar
        onExample={loadExample}
        onLearn={() => openHub('lessons')}
        bench={bench}
        onBench={setBench}
        onSave={saveFile}
        onOpen={openFile}
        onUndo={undo}
        onRedo={redo}
        canUndo={past.current.length > 0}
        canRedo={future.current.length > 0}
        sound={sound}
        onSound={() => setSound((v) => !v)}
        onHelp={() => setHelp((v) => !v)}
      />

      <div className="stage-wrap">
        <canvas ref={canvasRef} />

        <Palette placing={placing} onPick={pick} parts={doc.parts} selection={selection} onSelect={setSelection} onDelete={deletePart} />
        <Toolbar tool={tool} setTool={setTool} mode={mode} setMode={setMode}>
          <Doctor issues={status.issues} onSelect={setSelection} onOpen={() => track('doctor')} />
        </Toolbar>
        <Dock onView={(v) => stageRef.current?.setView(v)} onFrame={() => stageRef.current?.frameAll()} />
        <Legend mode={mode} vmax={vmax} />

        <div className="rightcol">
          {(bench === 'breadboard' || bench === 'split') && coachEl}
          {selected && (
            <Inspector
              part={selected}
              onProp={(key, value) => setProp(selected.id, key, value)}
              onRotate={() => rotatePart(selected.id)}
              onDuplicate={() => duplicatePart(selected.id)}
              onDelete={() => deletePart(selected.id)}
              onGuide={(type) => openHub('guide', type)}
              onClose={() => setSelection(null)}
            />
          )}
        </div>

        {placing && (
          <Banner>
            <b>{CATALOG[placing].name}</b> — click the board to seat it, <kbd>R</kbd> to rotate, <kbd>Esc</kbd> to cancel.
          </Banner>
        )}

        <Transport
          running={running}
          onToggle={() => setRunning((v) => !v)}
          onStep={stepOnce}
          onReset={resetSim}
          speed={speed}
          setSpeed={setSpeed}
          status={status}
        />
      </div>

      {bench === 'split' && (
        <div
          className="split-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize breadboard / mechanical split"
          onPointerDown={onSplitDown}
          onTouchStart={onSplitDown}
          onDoubleClick={() => setSplitRatio(0.5)}
          title="Drag to resize · double-click to reset"
        />
      )}

      {bench === 'pcb' && (
        <div className="pcb-shell">
          <PcbEditor
            store={pcb}
            analysis={pcbAnalysis}
            hasBreadboard={hasBreadboard}
            onImport={() => extractNetlist(docRef.current)}
            coach={coachEl}
            onEvent={pcbEvent}
          />
        </div>
      )}
      {(bench === 'mech' || bench === 'split') && (
        <div className={`pcb-shell${bench === 'split' ? ' split-pane' : ''}`}>
          <MechEditor
            store={mech}
            coach={bench === 'mech' ? coachEl : null}
            onEvent={pcbEvent}
            lessonStep={activeLesson?.bench === 'mech' && lesson && !lesson.done && !lesson.finished ? activeLesson.steps[lesson.step] : null}
            lessonEvents={eventsRef.current}
            onLessonPass={completeStep}
            bbDocRef={docRef}
            bbCircuitRef={circuitRef}
            pcbDoc={pcb.doc}
          />
        </div>
      )}
      {help && <Help onClose={() => setHelp(false)} />}
      {hub && (
        <LearnHub
          tab={hub.tab}
          guideType={hub.guideType}
          progress={progress}
          onTab={(tab) => setHub((h) => ({ ...h, tab }))}
          onGuideType={(guideType) => setHub((h) => ({ ...h, guideType }))}
          onStartLesson={startLesson}
          onPlace={placeFromGuide}
          onClose={() => setHub(null)}
        />
      )}
      {intro !== 'gone' && (
        <Intro
          leaving={intro === 'leaving'}
          returning={Object.keys(progress).length > 0}
          onStart={(kind, id) => {
            if (kind === 'lesson') startLesson(id);
            else if (id) loadExample(id);
            setIntro('leaving');
            setTimeout(() => setIntro('gone'), 700);
          }}
        />
      )}
    </div>
  );
}

function Intro({ leaving, returning, onStart }) {
  return (
    <div className={`intro${leaving ? ' leaving' : ''}`}>
      <div className="intro-fade">
        <h1>BreadBai</h1>
        <p>
          A 3D electronics lab. Build circuits on a breadboard, watch real physics run them,
          and learn as you go.
        </p>
        <img src={splash} width={450} alt="A 3D breadboard with a glowing LED circuit" />
        <div className="cta">
          {returning ? (
            <>
              <button className="btn primary" onClick={() => onStart('example', 'first-light')}>Open the lab</button>
              <button className="btn" onClick={() => onStart('lesson', 'basics')}>Learn the basics</button>
            </>
          ) : (
            <>
              <button className="btn primary" onClick={() => onStart('lesson', 'basics')}>Start learning</button>
              <button className="btn" onClick={() => onStart('example', 'first-light')}>Open the lab</button>
            </>
          )}
          <button className="btn ghost" onClick={() => onStart('example', 'blank')}>Empty board</button>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS = [
  ['V / W', 'Select tool / wire tool'],
  ['R', 'Rotate the selected part'],
  ['⌘D', 'Duplicate'],
  ['Delete', 'Remove the selected part'],
  ['Space', 'Run or pause the simulation'],
  ['F', 'Frame everything'],
  ['L', 'Open lessons, guide and cheat sheet'],
  ['1 – 4', 'Iso, top, front, side views'],
  ['⌘Z / ⇧⌘Z', 'Undo / redo'],
  ['⌘S', 'Save the circuit to a file'],
  ['Drag', 'Left mouse orbits, right mouse pans, scroll zooms'],
];

function Help({ onClose }) {
  return (
    <div className="intro" style={{ background: 'rgba(8,8,10,0.72)' }} onClick={onClose}>
      <div className="panel glass" style={{ position: 'static', width: 440, maxWidth: '90vw' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div style={{ flex: 1 }}><h2>Shortcuts</h2><p>Everything has a key.</p></div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><Icon.close size={17} /></button>
        </div>
        <div className="body">
          <div className="pinlist">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
