import { useState } from 'react';
import { FOOTPRINTS, footprintCategories } from './footprints.js';
import { GRID_SIZES, RULE_PRESETS, TRACK_WIDTHS } from './model.js';
import { dist } from './geometry.js';

const fmt = (v) => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '');

/** Numeric field that commits on Enter / blur (so typing doesn't create an undo step per keystroke). */
export function NumField({ label, value, onCommit, step = 0.1, min, unit = 'mm', wide }) {
  const commit = (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || (min != null && v < min)) { e.target.value = fmt(value); return; }
    if (v !== value) onCommit(v);
  };
  return (
    <label className={`nf${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      <span className="nf-in">
        <input
          type="number" step={step} min={min} defaultValue={fmt(value)} key={fmt(value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = fmt(value); e.currentTarget.blur(); } e.stopPropagation(); }}
        />
        {unit && <i>{unit}</i>}
      </span>
    </label>
  );
}

const TextField = ({ label, value, onCommit }) => (
  <label className="nf wide">
    <span>{label}</span>
    <span className="nf-in">
      <input
        type="text" defaultValue={value} key={value} spellCheck="false"
        onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); e.stopPropagation(); }}
      />
    </span>
  </label>
);

const Select = ({ label, value, options, onChange }) => (
  <label className="nf wide">
    <span>{label}</span>
    <span className="nf-in">
      <select value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </span>
  </label>
);

const Check = ({ label, checked, onChange }) => (
  <label className="chk"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>
);

const Section = ({ title, children }) => (<section className="pp-sec"><h4>{title}</h4>{children}</section>);

/* ------------------------------------------------------------------ Library */

export function LibraryPanel({ api, placing, hasBreadboard, imported }) {
  const [q, setQ] = useState('');
  const cats = footprintCategories();
  return (
    <div className="pp">
      <Section title="From your breadboard">
        <p className="pp-note">
          {imported
            ? 'Your circuit is linked. Re-sync after changing the breadboard — placements and tracks are kept.'
            : 'Turn the circuit you built on the breadboard into footprints with a ratsnest showing what must be connected.'}
        </p>
        <button className="btn primary wide" onClick={api.importCircuit} disabled={!hasBreadboard}>
          {imported ? 'Re-sync netlist' : 'Import from breadboard'}
        </button>
      </Section>
      <Section title="Footprints">
        <input className="pp-search" placeholder="Search footprints…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        {Object.entries(cats).map(([cat, list]) => {
          const shown = list.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
          if (!shown.length) return null;
          return (
            <div key={cat} className="fp-cat">
              <h5>{cat}</h5>
              {shown.map((f) => (
                <button key={f.id} className="fp-item" aria-pressed={placing?.fp === f.id} onClick={() => api.arm(f.id)} title={`${f.pads.length} pads`}>
                  <span>{f.name}</span><i>{f.pads.length}</i>
                </button>
              ))}
            </div>
          );
        })}
      </Section>
    </div>
  );
}

/* --------------------------------------------------------------------- Nets */

export function NetsPanel({ doc, analysis, api, hoverNet }) {
  const nets = analysis?.nets ?? [];
  if (!doc.netlist) {
    return <div className="pp"><p className="pp-note">No netlist yet. Import your breadboard circuit from the Parts tab and each net will appear here with its routing status and track width.</p></div>;
  }
  const open = nets.filter((n) => !n.routed).length;
  return (
    <div className="pp">
      <p className="pp-note"><b>{nets.length - open}</b> of {nets.length} nets routed.</p>
      {nets.map((n) => (
        <div key={n.name} className={`net-row${hoverNet === n.name ? ' hot' : ''}`} onMouseEnter={() => api.hoverNet(n.name)} onMouseLeave={() => api.hoverNet(null)}>
          <span className={`net-dot ${n.routed ? 'ok' : 'open'}`} title={n.routed ? 'Fully connected' : `${n.islands - 1} connection(s) missing`} />
          <b>{n.name}</b>
          <span className="net-meta">{n.pads} pads{n.routed ? '' : ` · ${n.islands - 1} open`}</span>
          <span className="net-w">
            <input
              type="number" step="0.05" min="0" placeholder={String(doc.rules.trackWidth)} title="Track width for this net (mm)"
              defaultValue={doc.netWidths[n.name] ?? ''} key={doc.netWidths[n.name] ?? 'default'}
              onBlur={(e) => api.setNetWidth(n.name, parseFloat(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); e.stopPropagation(); }}
            />
            <button className="btn ghost small" onClick={() => api.applyNetWidth(n.name)} title="Resize the existing tracks of this net to this width">Apply</button>
          </span>
        </div>
      ))}
      <p className="pp-note faint">New tracks started from a pad use their net’s width. “Apply” resizes tracks already drawn.</p>
    </div>
  );
}

/* --------------------------------------------------------------------- DRC */

export function DrcPanel({ analysis, api }) {
  const list = analysis?.drc ?? [];
  const s = analysis?.stats;
  return (
    <div className="pp">
      <div className={`drc-sum ${s && s.errors ? 'bad' : 'good'}`}>
        {s && s.errors === 0 && s.warnings === 0 ? 'No problems found' : `${s?.errors ?? 0} errors · ${s?.warnings ?? 0} warnings`}
      </div>
      {list.map((d) => (
        <button key={d.id} className={`drc-item ${d.level}`} onClick={() => api.focus(d.x, d.y)}>
          <span className="lvl">{d.level === 'error' ? '⛔' : '⚠️'}</span>
          <span><b>{d.rule}</b>{d.msg}</span>
        </button>
      ))}
      {s && <p className="pp-note faint">{s.trackLength.toFixed(1)} mm of copper track routed.</p>}
    </div>
  );
}

/* --------------------------------------------------------------- Properties */

export function PropsPanel({ doc, analysis, selection, api }) {
  if (!selection.length) return <div className="pp"><p className="pp-note">Nothing selected. Click a part, track, via or text to edit it. Drag on empty space to box-select.</p></div>;
  const objs = selection.map((id) => api.find(id)).filter(Boolean);
  if (selection.length > 1) return <MultiProps objs={objs} api={api} />;
  const o = objs[0];
  if (!o) return null;
  const kind = api.kind(o.id);
  if (kind === 'part') return <PartProps part={o} analysis={analysis} api={api} />;
  if (kind === 'track') return <TrackProps t={o} analysis={analysis} api={api} doc={doc} />;
  if (kind === 'via') return <ViaProps v={o} api={api} />;
  return <TextProps t={o} api={api} />;
}

function PartProps({ part, analysis, api }) {
  const fp = FOOTPRINTS[part.fp];
  const pads = fp.pads.map((p) => ({ ...p, net: analysis?.itemNet.get(`${part.id}#${p.n}`) }));
  return (
    <div className="pp">
      <Section title={`${part.ref} · ${fp.name}`}>
        <TextField label="Reference" value={part.ref} onCommit={(v) => api.patch(part.id, { ref: v })} />
        <TextField label="Value" value={part.value ?? ''} onCommit={(v) => api.patch(part.id, { value: v })} />
        <div className="nf-row">
          <NumField label="X" value={part.x} onCommit={(v) => api.patch(part.id, { x: v })} step={api.grid} />
          <NumField label="Y" value={part.y} onCommit={(v) => api.patch(part.id, { y: v })} step={api.grid} />
        </div>
        <Select label="Rotation" value={String(part.rot ?? 0)} onChange={(v) => api.patch(part.id, { rot: +v })}
          options={[['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']]} />
        <Select label="Side" value={part.side ?? 'top'} onChange={(v) => api.patch(part.id, { side: v })} options={[['top', 'Top'], ['bottom', 'Bottom (mirrored)']]} />
        <Check label="Locked (can’t be moved)" checked={!!part.locked} onChange={(v) => api.patch(part.id, { locked: v })} />
        <Check label="Show reference on silkscreen" checked={part.showRef !== false} onChange={(v) => api.patch(part.id, { showRef: v })} />
        <div className="btn-row">
          <button className="btn small" onClick={() => api.rotate([part.id])}>Rotate</button>
          <button className="btn small" onClick={() => api.flip([part.id])}>Flip side</button>
          <button className="btn small" onClick={api.duplicate}>Duplicate</button>
          <button className="btn small danger" onClick={api.remove}>Delete</button>
        </div>
      </Section>
      <Section title="Pads">
        <table className="pad-table"><tbody>
          {pads.map((p) => (
            <tr key={p.n} onMouseEnter={() => p.net && api.hoverNet(p.net)} onMouseLeave={() => api.hoverNet(null)}>
              <td>{p.n}</td><td>{p.shape === 'rect' ? 'square' : 'round'} {p.w}mm / ⌀{p.drill}</td><td className={p.net ? 'net' : 'none'}>{p.net ?? '—'}</td>
            </tr>
          ))}
        </tbody></table>
      </Section>
    </div>
  );
}

function TrackProps({ t, analysis, api, doc }) {
  const len = dist(t.a, t.b);
  const net = analysis?.itemNet.get(t.id);
  return (
    <div className="pp">
      <Section title="Track segment">
        <p className="pp-note">{len.toFixed(2)} mm long{net ? ` · net ${net}` : ''}</p>
        <Select label="Layer" value={t.layer} onChange={(v) => api.patch(t.id, { layer: v })} options={[['top', 'Top copper'], ['bottom', 'Bottom copper']]} />
        <NumField label="Width" value={t.width} min={0.05} step={0.05} onCommit={(v) => api.patch(t.id, { width: v })} />
        <div className="chips">
          {TRACK_WIDTHS.map((w) => <button key={w} className={`chip${t.width === w ? ' on' : ''}`} onClick={() => api.patch(t.id, { width: w })}>{w}</button>)}
        </div>
        <div className="nf-row">
          <NumField label="X1" value={t.a.x} onCommit={(v) => api.patchTrackEnd(t.id, 'a', { x: v })} step={api.grid} />
          <NumField label="Y1" value={t.a.y} onCommit={(v) => api.patchTrackEnd(t.id, 'a', { y: v })} step={api.grid} />
        </div>
        <div className="nf-row">
          <NumField label="X2" value={t.b.x} onCommit={(v) => api.patchTrackEnd(t.id, 'b', { x: v })} step={api.grid} />
          <NumField label="Y2" value={t.b.y} onCommit={(v) => api.patchTrackEnd(t.id, 'b', { y: v })} step={api.grid} />
        </div>
        <div className="btn-row">
          <button className="btn small" onClick={() => api.selectRun(t.id)}>Select whole run</button>
          <button className="btn small" onClick={() => api.flipTrackLayer([t.id])}>Swap layer</button>
          <button className="btn small danger" onClick={api.remove}>Delete</button>
        </div>
        <p className="pp-note faint">{doc.tracks.length} segments on the board.</p>
      </Section>
    </div>
  );
}

function ViaProps({ v, api }) {
  return (
    <div className="pp">
      <Section title="Via">
        <div className="nf-row">
          <NumField label="X" value={v.x} onCommit={(n) => api.patch(v.id, { x: n })} step={api.grid} />
          <NumField label="Y" value={v.y} onCommit={(n) => api.patch(v.id, { y: n })} step={api.grid} />
        </div>
        <NumField label="Diameter" value={v.dia} min={0.2} step={0.05} onCommit={(n) => api.patch(v.id, { dia: n })} />
        <NumField label="Drill" value={v.drill} min={0.1} step={0.05} onCommit={(n) => api.patch(v.id, { drill: n })} />
        <div className="btn-row"><button className="btn small danger" onClick={api.remove}>Delete</button></div>
      </Section>
    </div>
  );
}

function TextProps({ t, api }) {
  return (
    <div className="pp">
      <Section title="Silkscreen text">
        <TextField label="Text" value={t.text} onCommit={(v) => api.patch(t.id, { text: v })} />
        <NumField label="Height" value={t.size} min={0.5} step={0.25} onCommit={(v) => api.patch(t.id, { size: v })} />
        <div className="nf-row">
          <NumField label="X" value={t.x} onCommit={(v) => api.patch(t.id, { x: v })} step={api.grid} />
          <NumField label="Y" value={t.y} onCommit={(v) => api.patch(t.id, { y: v })} step={api.grid} />
        </div>
        <Select label="Rotation" value={String(t.rot ?? 0)} onChange={(v) => api.patch(t.id, { rot: +v })} options={[['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']]} />
        <Select label="Layer" value={t.layer} onChange={(v) => api.patch(t.id, { layer: v })} options={[['top', 'Top silkscreen'], ['bottom', 'Bottom silkscreen']]} />
        <div className="btn-row"><button className="btn small danger" onClick={api.remove}>Delete</button></div>
      </Section>
    </div>
  );
}

function MultiProps({ objs, api }) {
  const movable = objs.filter((o) => 'x' in o);
  return (
    <div className="pp">
      <Section title={`${objs.length} objects selected`}>
        <div className="align-grid">
          <button className="btn small" onClick={() => api.align('x', 'min')} title="Align left edges">⇤ Left</button>
          <button className="btn small" onClick={() => api.align('x', 'mid')} title="Centre horizontally">↔ Centre</button>
          <button className="btn small" onClick={() => api.align('x', 'max')} title="Align right edges">Right ⇥</button>
          <button className="btn small" onClick={() => api.align('y', 'min')} title="Align tops">⤒ Top</button>
          <button className="btn small" onClick={() => api.align('y', 'mid')} title="Centre vertically">↕ Middle</button>
          <button className="btn small" onClick={() => api.align('y', 'max')} title="Align bottoms">Bottom ⤓</button>
          <button className="btn small" disabled={movable.length < 3} onClick={() => api.distribute('x')}>Distribute ↔</button>
          <button className="btn small" disabled={movable.length < 3} onClick={() => api.distribute('y')}>Distribute ↕</button>
        </div>
        <div className="btn-row">
          <button className="btn small" onClick={() => api.rotate(objs.map((o) => o.id))}>Rotate all</button>
          <button className="btn small" onClick={api.duplicate}>Duplicate</button>
          <button className="btn small danger" onClick={api.remove}>Delete</button>
        </div>
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------- Board */

const BOARD_PRESETS = [
  ['Small 40 × 30', 40, 30], ['Square 50 × 50', 50, 50], ['Credit card 85.6 × 54', 85.6, 54],
  ['Arduino Uno shield 68.6 × 53.3', 68.6, 53.3], ['Eurocard 100 × 160', 100, 160],
];

export function BoardPanel({ doc, api }) {
  const { board, grid } = doc;
  return (
    <div className="pp">
      <Section title="Board outline">
        <div className="nf-row">
          <NumField label="Width" value={board.w} min={5} step={1} onCommit={(v) => api.setBoard({ w: v })} />
          <NumField label="Height" value={board.h} min={5} step={1} onCommit={(v) => api.setBoard({ h: v })} />
        </div>
        <NumField label="Corner radius" value={board.r} min={0} step={0.5} onCommit={(v) => api.setBoard({ r: v })} />
        <Select label="Preset" value="" onChange={(v) => { const p = BOARD_PRESETS.find((x) => x[0] === v); if (p) api.setBoard({ w: p[1], h: p[2] }); }}
          options={[['', 'Choose a size…'], ...BOARD_PRESETS.map((p) => [p[0], p[0]])]} />
        <div className="btn-row">
          <button className="btn small" onClick={() => api.addMountingHoles(3.5)}>Add 4 mounting holes</button>
          <button className="btn small" onClick={api.fitBoardToParts} title="Shrink or grow the board around the parts, plus a 5 mm margin">Fit to parts</button>
        </div>
      </Section>
      <Section title="Grid & snapping">
        <Select label="Grid" value={String(grid.size)} onChange={(v) => api.setGrid({ size: +v })} options={GRID_SIZES.map((g) => [String(g), `${g} mm${g === 2.54 ? ' (0.1″)' : g === 1.27 ? ' (0.05″)' : ''}`])} />
        <NumField label="Custom" value={grid.size} min={0.01} step={0.05} onCommit={(v) => api.setGrid({ size: v })} />
        <Check label="Snap to grid" checked={grid.snap} onChange={(v) => api.setGrid({ snap: v })} />
        <Check label="Snap to pads, vias and track ends" checked={grid.snapPads} onChange={(v) => api.setGrid({ snapPads: v })} />
        <Check label="Keep tracks attached when moving parts" checked={api.attach} onChange={api.setAttach} />
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------- Rules */

const RULE_FIELDS = [
  ['clearance', 'Copper clearance', 'Minimum gap between copper of different nets'],
  ['minWidth', 'Minimum track width', ''],
  ['minAnnular', 'Minimum annular ring', 'Copper ring left around a drill'],
  ['edgeClearance', 'Board edge clearance', ''],
  ['trackWidth', 'Default track width', 'Used for new tracks'],
  ['viaDia', 'Via diameter', ''],
  ['viaDrill', 'Via drill', ''],
  ['maskExpansion', 'Solder-mask margin', 'Opening around each pad'],
];

export function RulesPanel({ doc, api }) {
  return (
    <div className="pp">
      <Section title="Design rules">
        <Select label="Preset" value="" onChange={(v) => RULE_PRESETS[v] && api.setRules(RULE_PRESETS[v])}
          options={[['', 'Load a preset…'], ...Object.keys(RULE_PRESETS).map((k) => [k, k])]} />
        {RULE_FIELDS.map(([key, label, hint]) => (
          <div key={key} title={hint}>
            <NumField label={label} value={doc.rules[key]} min={0} step={0.05} onCommit={(v) => api.setRules({ [key]: v })} wide />
          </div>
        ))}
        <p className="pp-note faint">The DRC re-runs instantly when a rule changes. “Home etch” is forgiving; “Fine pitch” needs a professional fab.</p>
      </Section>
    </div>
  );
}

/* --------------------------------------------------------------------- View */

export function ViewPanel({ opts, setOpts }) {
  const t = (key, label) => <Check key={key} label={label} checked={opts[key]} onChange={(v) => setOpts((o) => ({ ...o, [key]: v }))} />;
  return (
    <div className="pp">
      <Section title="Layers">
        {t('showTop', 'Top copper')}{t('showBottom', 'Bottom copper')}
        {t('showSilkTop', 'Top silkscreen')}{t('showSilkBottom', 'Bottom silkscreen')}
        <label className="nf wide"><span>Dim inactive layer</span>
          <input type="range" min="0.1" max="1" step="0.05" value={opts.inactive} onChange={(e) => setOpts((o) => ({ ...o, inactive: +e.target.value }))} />
        </label>
      </Section>
      <Section title="Overlays">
        {t('showRatsnest', 'Ratsnest (unrouted connections)')}{t('showDrc', 'DRC markers')}
        {t('showGrid', 'Grid dots')}{t('padNames', 'Pad names (zoom in)')}
      </Section>
      <Section title="Appearance">
        {t('realistic', 'Realistic board colours')}{t('flipView', 'View from the bottom')}
      </Section>
    </div>
  );
}
