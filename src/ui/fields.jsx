import { useEffect, useState } from 'react';
import { formatValue, parseValue } from '../lib/units.js';

function ValueInput({ prop, value, onChange }) {
  const [text, setText] = useState(() => formatValue(value, prop.unit ?? ''));
  useEffect(() => { setText(formatValue(value, prop.unit ?? '')); }, [value, prop.unit]);

  const commit = () => {
    const parsed = parseValue(text, null);
    if (parsed == null) { setText(formatValue(value, prop.unit ?? '')); return; }
    const clamped = Math.min(prop.max ?? Infinity, Math.max(prop.min ?? -Infinity, parsed));
    onChange(clamped);
    setText(formatValue(clamped, prop.unit ?? ''));
  };

  return (
    <>
      <input
        type="text" value={text} spellCheck="false"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
      {prop.presets && (
        <div className="presets">
          {prop.presets.map((v) => (
            <button key={v} onClick={() => onChange(v)} title={`Set to ${formatValue(v, prop.unit ?? '')}`}>
              {formatValue(v, '')}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default function Field({ prop, value, onChange }) {
  if (prop.type === 'select') {
    return (
      <div className="field">
        <label htmlFor={prop.key}>{prop.label}</label>
        <select id={prop.key} value={value} onChange={(e) => {
          const opt = prop.options.find((o) => String(o.value) === e.target.value);
          onChange(opt ? opt.value : e.target.value);
        }}>
          {prop.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }

  if (prop.type === 'bool') {
    return (
      <div className="field">
        <div className="row">
          <label style={{ flex: 1, marginBottom: 0 }}>{prop.label}</label>
          <button className="switch" aria-pressed={!!value} aria-label={prop.label}
            onClick={() => onChange(!value)}><i /></button>
        </div>
      </div>
    );
  }

  if (prop.type === 'slider') {
    const min = prop.min ?? 0, max = prop.max ?? 1;
    const pct = ((value - min) / (max - min)) * 100;
    const shown = prop.percent ? `${Math.round(value * 100)}%` : formatValue(value, prop.unit ?? '');
    return (
      <div className="field">
        <label htmlFor={prop.key}>{prop.label}<span className="num">{shown}</span></label>
        <input
          id={prop.key} type="range" min={min} max={max} step={prop.step ?? (max - min) / 100}
          value={value} style={{ '--fill': `${pct}%` }}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
    );
  }

  return (
    <div className="field">
      <label htmlFor={prop.key}>{prop.label}</label>
      <ValueInput prop={prop} value={value} onChange={onChange} />
    </div>
  );
}
