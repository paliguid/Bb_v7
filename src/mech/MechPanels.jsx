import { useMemo, useState } from 'react';
import { CATEGORIES, PART_TYPES } from './catalog.js';
import { MATERIALS } from './materials.js';
import { MECH_PRESET_CATEGORIES, MECH_PRESETS } from './presets.js';
import { byId, customProps } from './assembly.js';

const fmt = (v) => (Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '');

export function NumField({ label, value, onCommit, unit, min, max, step = 1 }) {
  const commit = (e) => { const v = parseFloat(e.target.value); if (!Number.isFinite(v)) { e.target.value = fmt(value); return; } onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))); };
  return (
    <label className="nf wide">
      <span>{label}</span>
      <span className="nf-in">
        <input type="number" step={step} min={min} max={max} defaultValue={fmt(value)} key={fmt(value)}
          onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); e.stopPropagation(); }} />
        {unit && <i>{unit}</i>}
      </span>
    </label>
  );
}
const Slider = ({ label, value, onChange, min = 0, max = 1, step = 0.01, unit = '', live }) => (
  <label className="nf wide slider-row">
    <span>{label}</span>
    <span className="nf-in">
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} onKeyDown={(e) => e.stopPropagation()} />
      <i>{Number.isFinite(value) ? (Math.round(value * 1000) / 1000) : 0}{unit}</i>
    </span>
    {live && <span className="live-dot" title="Updates live while the simulation runs" />}
  </label>
);
const Select = ({ label, value, options, onChange }) => (
  <label className="nf wide">
    <span>{label}</span>
    <span className="nf-in">
      <select value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  </label>
);
const Check = ({ label, checked, onChange }) => (<label className="chk"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>);
const Section = ({ title, children }) => (<section className="pp-sec"><h4>{title}</h4>{children}</section>);

/* ------------------------------------------------------------------ Library */

export function MechLibraryPanel({ api, placing }) {
  const [q, setQ] = useState('');
  const byCat = useMemo(() => {
    const m = {};
    for (const [id, def] of Object.entries(PART_TYPES)) (m[def.cat] ??= []).push({ id, ...def });
    return m;
  }, []);
  return (
    <div className="pp">
      <input className="pp-search" placeholder="Search parts…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      {CATEGORIES.map((cat) => {
        const list = (byCat[cat] ?? []).filter((d) => d.name.toLowerCase().includes(q.toLowerCase()));
        if (!list.length) return null;
        return (
          <div key={cat} className="fp-cat">
            <h5>{cat}</h5>
            {list.map((d) => (
              <button key={d.id} className="fp-item" aria-pressed={placing === d.id} onClick={() => api.arm(d.id)} title={d.hint}>
                <span>{d.name}</span>
              </button>
            ))}
          </div>
        );
      })}
      <Section title="Import a 3D model">
        <p className="pp-note">STL or OBJ, in millimetres. Mass and inertia come from the real mesh and the material you choose.</p>
        <button className="btn wide" onClick={api.importModel}>Import STL / OBJ…</button>
      </Section>
    </div>
  );
}

export function MechItemsPanel({ doc, selection, api }) {
  const byCat = useMemo(() => {
    const m = new Map();
    for (const p of doc.parts) {
      const cat = PART_TYPES[p.type]?.cat ?? 'Other';
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat).push(p);
    }
    return [...m.entries()];
  }, [doc.parts]);
  return (
    <div className="pp">
      <p className="pp-note">{doc.parts.length} part{doc.parts.length === 1 ? '' : 's'} in this mechanism.</p>
      {byCat.map(([cat, list]) => (
        <div key={cat} className="fp-cat">
          <h5>{cat}</h5>
          {list.map((p) => (
            <div key={p.id} className={`fp-item item-row ${selection.includes(p.id) ? 'active' : ''}`}>
              <button className="item-row-main" title="Select" onClick={() => api.focus(p.id)}>
                <span>{p.name || PART_TYPES[p.type]?.name || p.type}</span>
              </button>
              <button className="item-row-del" title="Delete" onClick={() => api.removeId(p.id)}>✕</button>
            </div>
          ))}
        </div>
      ))}
      {!doc.parts.length && <p className="pp-note">Nothing placed yet — add a part from the Parts tab, or load a preset.</p>}
    </div>
  );
}

export function PresetsPanel({ api }) {
  return (
    <div className="pp">
      {MECH_PRESET_CATEGORIES.map((cat) => (
        <div key={cat} className="fp-cat">
          <h5>{cat}</h5>
          {MECH_PRESETS.filter((p) => p.cat === cat).map((p) => (
            <button key={p.id} className="fp-item preset-item" onClick={() => api.loadPreset(p.id)} title={p.blurb}>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- Properties */

function PartRef({ label, value, onChange, doc, of, allowGround }) {
  const options = doc.parts.filter((p) => of.includes(p.type) && p.id !== value);
  return (
    <label className="nf wide">
      <span>{label}</span>
      <span className="nf-in">
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
          <option value="">— none —</option>
          {allowGround && <option value="ground">Ground (fixed)</option>}
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </span>
    </label>
  );
}

function ParamField({ prm, part, onProp }) {
  const v = part[prm.key];
  if (prm.type === 'bool') return <Check key={prm.key} label={prm.label} checked={!!v} onChange={(val) => onProp(prm.key, val)} />;
  if (prm.type === 'select') return <Select key={prm.key} label={prm.label} value={String(v)} options={prm.options.map((o) => ({ value: String(o.value), label: o.label }))} onChange={(val) => onProp(prm.key, prm.options.find((o) => String(o.value) === val)?.value ?? val)} />;
  return <NumField key={prm.key} label={prm.unit ? `${prm.label} (${prm.unit})` : prm.label} value={v} unit={prm.unit === '°' ? '°' : ''} min={prm.min} max={prm.max} step={prm.step ?? 1} onCommit={(val) => onProp(prm.key, val)} />;
}

function PresetButtons({ def, onProp }) {
  if (!def.presets) return null;
  return (
    <div className="chips">
      {Object.keys(def.presets).map((name) => (
        <button key={name} className="chip" onClick={() => { const map = def.presetMap(def.presets[name]); for (const [k, val] of Object.entries(map)) onProp(k, val); }}>{name}</button>
      ))}
    </div>
  );
}

export function MechPropsPanel({ doc, machine, selection, api }) {
  if (selection.length !== 1) return <div className="pp"><p className="pp-note">{selection.length > 1 ? `${selection.length} parts selected.` : 'Nothing selected. Click a part to edit it, or pick one from the library to place it.'}</p></div>;
  const part = byId(doc, selection[0]);
  if (!part) return null;
  const def = PART_TYPES[part.type];
  const materialOpts = Object.entries(MATERIALS).map(([value, m]) => ({ value, label: m.name }));

  return (
    <div className="pp">
      <Section title={`${part.name} · ${def.name}`}>
        <label className="nf wide"><span>Name</span><span className="nf-in"><input type="text" defaultValue={part.name} key={part.name} onBlur={(e) => e.target.value !== part.name && api.patch(part.id, { name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); e.stopPropagation(); }} /></span></label>
        {def.mount === 'shaft' && (
          <div className="nf-row">
            <NumField label="Axial (mm)" value={part.axial ?? 0} step={1} onCommit={(v) => api.patch(part.id, { axial: v })} />
            <NumField label="Phase (°)" value={part.phase ?? 0} step={1} onCommit={(v) => api.patch(part.id, { phase: v })} />
          </div>
        )}
        {(def.mount === 'free' || (part.type === 'custom' && part.attach !== 'shaft')) && (
          <>
            <div className="nf-row">
              <NumField label="X (mm)" value={part.x} step={1} onCommit={(v) => api.patch(part.id, { x: v })} />
              <NumField label="Y (mm)" value={part.y} step={1} onCommit={(v) => api.patch(part.id, { y: v })} />
              <NumField label="Z (mm)" value={part.z} step={1} onCommit={(v) => api.patch(part.id, { z: v })} />
            </div>
            <div className="nf-row">
              <NumField label="Rot X (°)" value={part.rx} step={1} onCommit={(v) => api.patch(part.id, { rx: v })} />
              <NumField label="Rot Y (°)" value={part.ry} step={1} onCommit={(v) => api.patch(part.id, { ry: v })} />
              <NumField label="Rot Z (°)" value={part.rz} step={1} onCommit={(v) => api.patch(part.id, { rz: v })} />
            </div>
          </>
        )}
        <div className="btn-row">
          <button className="btn small" onClick={api.duplicate}>Duplicate</button>
          <button className="btn small danger" onClick={api.remove}>Delete</button>
        </div>
      </Section>
      <Section title="Parameters">
        {def.params.filter((prm) => !(def.mount === 'shaft' && (prm.key === 'axial' || prm.key === 'phase'))).map((prm) => {
          if (prm.type === 'part') return <PartRef key={prm.key} label={prm.label} value={part[prm.key]} onChange={(v) => api.patch(part.id, { [prm.key]: v })} doc={doc} of={prm.of} allowGround={prm.allowGround} />;
          if (prm.type === 'material') return <Select key={prm.key} label={prm.label} value={part[prm.key]} options={materialOpts} onChange={(v) => api.patch(part.id, { [prm.key]: v })} />;
          return <ParamField key={prm.key} prm={prm} part={part} onProp={(k, v) => api.patch(part.id, { [k]: v })} />;
        })}
        <PresetButtons def={def} part={part} onProp={(k, v) => api.patch(part.id, { [k]: v })} />
      </Section>
      {part.type === 'custom' && <CustomInfo doc={doc} part={part} />}
      <MechanicalReadout doc={doc} machine={machine} part={part} />
    </div>
  );
}

function CustomInfo({ doc, part }) {
  const cp = customProps(doc, part);
  return (
    <Section title="Mesh properties">
      <p className="pp-note">Mass <b>{cp.mass.toFixed(4)} kg</b> · Volume {(cp.volume * 1e6).toFixed(1)} cm³ · Izz {cp.Izz.toExponential(2)} kg·m²</p>
    </Section>
  );
}
function MechanicalReadout({ machine, part }) {
  if (!machine) return null;
  const r = machine.readout();
  const rows = Object.entries(r).filter(([k]) => k.startsWith(`${part.id}.`));
  if (!rows.length) return null;
  return (
    <Section title="Live readout">
      <table className="pad-table"><tbody>
        {rows.map(([k, v]) => (<tr key={k}><td>{k.split('.')[1]}</td><td>{typeof v === 'number' ? (Math.abs(v) < 0.001 && v !== 0 ? v.toExponential(2) : (Math.round(v * 1000) / 1000)) : String(v)}</td></tr>))}
      </tbody></table>
    </Section>
  );
}

/* ----------------------------------------------------------------- Connect */

export function ConnectPanel({ doc, pendingA }) {
  const a = pendingA ? byId(doc, pendingA) : null;
  return (
    <div className="pp">
      <Section title="Connect two parts">
        <p className="pp-note">Click the first part, then the second, to link them — gears mesh, pulleys get a belt, a crank gets a slider, and so on. Click empty space to cancel.</p>
        {a ? <p className="pp-note"><b>{a.name}</b> selected — now click its partner.</p> : <p className="pp-note faint">Nothing selected yet.</p>}
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------- Checks */

export function ChecksPanel({ checks, api }) {
  const list = checks?.issues ?? [];
  return (
    <div className="pp">
      <div className={`drc-sum ${list.some((i) => i.level === 'error') ? 'bad' : 'good'}`}>
        {list.filter((i) => i.level !== 'info').length === 0 ? 'No problems found' : `${list.filter((i) => i.level === 'error').length} errors · ${list.filter((i) => i.level === 'warn').length} warnings`}
      </div>
      {list.map((d) => (
        <button key={d.id} className={`drc-item ${d.level}`} onClick={() => api.focus(d.partId, d.linkId)}>
          <span className="lvl">{d.level === 'error' ? '⛔' : d.level === 'warn' ? '⚠️' : 'ℹ️'}</span>
          <span><b>{d.title}</b>{d.detail}</span>
        </button>
      ))}
      {checks?.report?.length > 0 && (
        <Section title="Stress and speed limits">
          {checks.report.map((row, i) => (
            <div key={i} className="stress-row">
              <span>{row.label}</span>
              <div className="bar"><i style={{ width: `${Math.min(100, row.util * 100)}%`, background: row.util > 1 ? '#ff453a' : row.util > 0.7 ? '#ff9f0a' : '#30d158' }} /></div>
              <span className="stress-val">{row.value.toFixed(1)} / {row.limit.toFixed(1)} {row.unit}</span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Controls */

const CONTROL_FIELDS = {
  motor: [
    { key: 'duty', label: 'Duty / throttle', min: -1, max: 1, step: 0.01, when: (p) => p.mode === 'voltage' },
    { key: 'targetRpm', label: 'Target speed', min: -10000, max: 10000, step: 10, unit: ' rpm', when: (p) => p.mode === 'servo', num: true },
    { key: 'torqueCmd', label: 'Torque', min: -1, max: 1, step: 0.001, unit: ' N·m', when: (p) => p.mode === 'torque', num: true },
  ],
  brake: [{ key: 'apply', label: 'Apply', min: 0, max: 1, step: 0.01 }],
  handcrank: [{ key: 'torque', label: 'Torque', min: -1, max: 1, step: 0.001, unit: ' N·m', num: true }],
  generator: [{ key: 'connected', label: '', check: true, label2: 'Load connected' }],
  coupling: [{ key: 'engage', label: 'Engagement', min: 0, max: 1, step: 0.01, isLink: true }],
};

export function ControlsPanel({ doc, api }) {
  const controllable = doc.parts.filter((p) => CONTROL_FIELDS[p.type]?.length);
  const links = doc.links.filter((l) => l.type === 'coupling' && l.mode === 'clutch');
  if (!controllable.length && !links.length) return <div className="pp"><p className="pp-note">Nothing to control yet. Add a motor, brake, hand crank or clutch.</p></div>;
  return (
    <div className="pp">
      {controllable.map((p) => (
        <Section key={p.id} title={p.name}>
          {(CONTROL_FIELDS[p.type] ?? []).filter((f) => !f.when || f.when(p)).map((f) => (
            f.num
              ? <NumField key={f.key} label={f.label} value={p[f.key]} unit={f.unit} step={f.step} onCommit={(v) => api.patch(p.id, { [f.key]: v })} />
              : <Slider key={f.key} label={f.label} value={p[f.key]} min={f.min} max={f.max} step={f.step} unit={f.unit ?? ''} live onChange={(v) => api.patchControl(p.id, { [f.key]: v })} />
          ))}
        </Section>
      ))}
      {links.map((l) => (
        <Section key={l.id} title={`${byId(doc, l.a)?.name ?? '?'} ↔ ${byId(doc, l.b)?.name ?? '?'} (clutch)`}>
          <Slider label="Engagement" value={l.engage} min={0} max={1} step={0.01} live onChange={(v) => api.patchLinkControl(l.id, { engage: v })} />
        </Section>
      ))}
      <p className="pp-note faint">These update live, even while the simulation is running.</p>
    </div>
  );
}

/* -------------------------------------------------------------------- Scope */

export function ScopePanel({ signals, series, onAdd, onRemove }) {
  const [pick, setPick] = useState('');
  const w = 280, h = 130;
  const colors = ['#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#bf5af2'];
  const allVals = series.flatMap((s) => s.data.map((d) => d.v));
  const lo = Math.min(0, ...allVals, -1e-9), hi = Math.max(...allVals, 1e-9);
  const span = hi - lo || 1;
  const tRange = series[0]?.data.length ? series[0].data[series[0].data.length - 1].t - series[0].data[0].t || 1 : 1;
  const t0 = series[0]?.data[0]?.t ?? 0;
  const path = (s) => s.data.map((d, i) => `${i ? 'L' : 'M'} ${((d.t - t0) / tRange) * w} ${h - ((d.v - lo) / span) * h}`).join(' ');
  return (
    <div className="pp">
      <Section title="Scope">
        <div className="nf-row">
          <select value={pick} onChange={(e) => setPick(e.target.value)} onKeyDown={(e) => e.stopPropagation()} style={{ flex: 1 }}>
            <option value="">Add a signal…</option>
            {signals.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button className="btn small" disabled={!pick} onClick={() => { onAdd(pick); setPick(''); }}>Add</button>
        </div>
        {series.length > 0 && (
          <svg viewBox={`0 0 ${w} ${h}`} className="scope-svg" role="img" aria-label="Live chart of the selected signals">
            <line x1="0" y1={h - ((0 - lo) / span) * h} x2={w} y2={h - ((0 - lo) / span) * h} stroke="#3a3e47" strokeWidth="1" />
            {series.map((s, i) => <path key={s.key} d={path(s)} fill="none" stroke={colors[i % colors.length]} strokeWidth="1.6" />)}
          </svg>
        )}
        {series.map((s, i) => (
          <div key={s.key} className="scope-legend"><i style={{ background: colors[i % colors.length] }} />{s.label}<button className="link" onClick={() => onRemove(s.key)}>remove</button></div>
        ))}
      </Section>
    </div>
  );
}


/* ------------------------------------------------------------------- Systems */

export function SystemsPanel({ doc, bbDoc, pcbDoc, links, api }) {
  const [bbSel, setBbSel] = useState('');
  const [mechSel, setMechSel] = useState('');
  const bbMotors = (bbDoc?.parts ?? []).filter((p) => p.type === 'motor');
  const mechMotors = doc.parts.filter((p) => p.type === 'motor' && p.mode === 'circuit');
  const linkedBb = new Set(links.map((l) => l.bbId));
  const linkedMech = new Set(links.map((l) => l.mechId));
  const availBb = bbMotors.filter((p) => !linkedBb.has(p.id));
  const availMech = mechMotors.filter((p) => !linkedMech.has(p.id));

  return (
    <div className="pp">
      <Section title="Link a breadboard circuit">
        <p className="pp-note">
          Connect a motor from your <b>Breadboard</b> circuit to a motor here set to <b>Drive → From a circuit</b>. If the circuit has been imported to PCB, the matching PCB motor is also recorded so the mechanical connection stays associated with the PCB design.
          Both simulators run together: real current from the circuit drives this shaft, and whatever
          load the shaft feels shows up back on the breadboard as current.
        </p>
        {!bbMotors.length && <p className="pp-note faint">No motor found on the breadboard yet. Add one there first.</p>}
        {!mechMotors.length && bbMotors.length > 0 && <p className="pp-note faint">No motor here is set to “From a circuit” yet. Select a motor’s Properties and change its Drive mode.</p>}
        {availBb.length > 0 && availMech.length > 0 && (
          <>
            <label className="nf wide"><span>Breadboard motor</span><span className="nf-in">
              <select value={bbSel} onChange={(e) => setBbSel(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
                <option value="">Choose…</option>{availBb.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.id}</option>)}
              </select>
            </span></label>
            <label className="nf wide"><span>Mechanism motor</span><span className="nf-in">
              <select value={mechSel} onChange={(e) => setMechSel(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
                <option value="">Choose…</option>{availMech.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </span></label>
            <button className="btn primary wide" disabled={!bbSel || !mechSel} onClick={() => { api.addLink(bbSel, mechSel); setBbSel(''); setMechSel(''); }}>Link them</button>
          </>
        )}
      </Section>
      {links.length > 0 && (
        <Section title="Active links">
          {links.map((l) => {
            const bbP = bbMotors.find((p) => p.id === l.bbId) ?? (bbDoc?.parts ?? []).find((p) => p.id === l.bbId);
            const mechP = doc.parts.find((p) => p.id === l.mechId);
            const r = api.linkReadout(l);
            return (
              <div key={l.id} className="net-row">
                <span className="net-dot ok" />
                <b>{bbP?.name ?? '?'} → {mechP?.name ?? '(deleted)'}</b>{l.pcbId && <span className="net-meta"> · PCB {pcbDoc?.parts.find((p) => p.id === l.pcbId)?.ref ?? l.pcbId}</span>}
                <span className="net-meta">{r ? `${(r.current * 1000).toFixed(0)} mA · ${r.rpm?.toFixed(0) ?? 0} rpm` : ''}</span>
                <span className="net-w"><button className="btn ghost small" onClick={() => api.removeLinkSys(l.id)}>Unlink</button></span>
              </div>
            );
          })}
        </Section>
      )}
    </div>
  );
}
