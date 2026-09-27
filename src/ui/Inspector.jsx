import { CATALOG } from '../lib/catalog.js';
import Field from './fields.jsx';
import { PartIcon, Icon } from './icons.jsx';

export function stripLabel(key) {
  if (!key) return null;
  const group = key.split(':')[2];
  if (!group) return null;
  const rail = { tpos: '+ rail, top', tneg: '− rail, top', bpos: '+ rail, bottom', bneg: '− rail, bottom' };
  if (rail[group]) return rail[group];
  const col = Number(group.slice(1)) + 1;
  return group[0] === 'T' ? `${col} A–E` : `${col} F–J`;
}

export default function Inspector({ part, onProp, onRotate, onDuplicate, onDelete, onGuide, onClose }) {
  if (!part) return null;
  const def = CATALOG[part.type];
  const reading = def.readout?.(part);
  const seated = Object.keys(part.inserted ?? {}).length;

  return (
    <aside className="panel inspector glass">
      <div className="panel-head">
        <span className="thumb" style={{
          width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center',
          background: 'rgba(255,255,255,0.08)', border: '1px solid var(--stroke)',
        }}>
          <PartIcon type={part.type} size={19} />
        </span>
        <div style={{ flex: 1 }}>
          <h2>{def.name}</h2>
          <p>{seated ? `${seated} of ${def.pins.length} leads seated` : 'Not on the board'}</p>
        </div>
        <button className="btn icon ghost" onClick={() => onGuide(part.type)} aria-label={`How to use the ${def.name}`} title="How to use this part"><Icon.learn size={17} /></button>
        <button className="btn icon ghost" onClick={onClose} aria-label="Close inspector"><Icon.close size={17} /></button>
      </div>

      <div className="body">
        {reading && (
          <div className="readout">
            <span className="value">{reading}</span>
            <span className="label">live</span>
          </div>
        )}

        {def.props.map((prop) => (
          <Field key={prop.key} prop={prop} value={part.props[prop.key]}
            onChange={(v) => onProp(prop.key, v)} />
        ))}

        {def.hint && <p className="hint">{def.hint}</p>}

        {def.pins.length > 0 && (
          <div className="pinlist">
            {def.pins.map((p) => {
              const label = stripLabel(part.inserted?.[p.name]);
              return (
                <div key={p.name}>
                  <span>{p.label ?? p.name}</span>
                  {label
                    ? <span className="strip">{label}</span>
                    : <span className="loose">free</span>}
                </div>
              );
            })}
          </div>
        )}

        <div className="inspector-actions">
          <button className="btn" onClick={() => onRotate(part.id)} title="Rotate 90° (R)">
            <Icon.rotate size={16} />Rotate
          </button>
          <button className="btn" onClick={() => onDuplicate(part.id)} title="Duplicate (⌘D)">
            <Icon.copy size={16} />Copy
          </button>
          <button className="btn danger" onClick={() => onDelete(part.id)} title="Delete (⌫)">
            <Icon.trash size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
