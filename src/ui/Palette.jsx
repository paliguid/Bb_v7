import { useMemo, useState } from 'react';
import { CATALOG, GROUPS } from '../lib/catalog.js';
import { PartIcon, Icon } from './icons.jsx';

const SUB = {
  BreadBai: '830 points, half size',
  battery: 'Alkaline block',
  supply: '0–30 V adjustable',
  ground: '0 V reference',
  resistor: 'Carbon film, ¼ W',
  led: '5 mm diffused',
  diode: 'Small signal',
  capacitor: 'Electrolytic',
  pushbutton: 'Momentary, 4 pin',
  toggle: 'SPDT',
  potentiometer: 'Linear taper',
  ldr: 'Photoresistor',
  transistor: '2N2222, TO-92',
  buzzer: 'Piezo, active',
  motor: 'Brushed, 6 V',
  seg7: 'Single digit',
  voltmeter: 'Digital, 10 MΩ',
  ammeter: 'Digital, in series',
  funcgen: '0.1–200 Hz',
};

export default function Palette({ placing, onPick, parts = [], selection, onSelect, onDelete }) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('add'); // 'add' | 'items'

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUPS.map((g) => ({
      name: g,
      items: Object.values(CATALOG).filter((d) =>
        d.group === g && (!q || d.name.toLowerCase().includes(q) || (SUB[d.id] ?? '').toLowerCase().includes(q) || d.id.includes(q))),
    })).filter((g) => g.items.length);
  }, [query]);

  // Everything actually sitting in the scene, minus the breadboard/board itself — that's chrome,
  // not something the person placed.
  const sceneItems = useMemo(() => parts.filter((p) => !CATALOG[p.type]?.board), [parts]);
  const itemGroups = useMemo(() => {
    const byGroup = new Map();
    for (const p of sceneItems) {
      const def = CATALOG[p.type];
      const g = def?.group ?? 'Other';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(p);
    }
    return [...byGroup.entries()];
  }, [sceneItems]);

  return (
    <aside className="panel palette glass">
      <div className="panel-head">
        <div>
          <h2>Components</h2>
          <p>{tab === 'add' ? 'Pick one, then click the board to place it' : `${sceneItems.length} item${sceneItems.length === 1 ? '' : 's'} on the board`}</p>
        </div>
      </div>
      <div className="seg palette-tabs" role="tablist" aria-label="Components panel">
        <button role="tab" aria-selected={tab === 'add'} onClick={() => setTab('add')}>Add</button>
        <button role="tab" aria-selected={tab === 'items'} onClick={() => setTab('items')}>
          Items{sceneItems.length > 0 && <span className="count-badge">{sceneItems.length}</span>}
        </button>
      </div>
      {tab === 'add' && (
        <>
          <div className="search">
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 9, top: 6, color: 'var(--faint)' }}>
                <Icon.search size={17} />
              </span>
              <input
                type="text" value={query} placeholder="Search" aria-label="Search components"
                style={{ paddingLeft: 31 }}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="list">
            {groups.map((group) => (
              <div key={group.name}>
                <div className="group-label">{group.name}</div>
                {group.items.map((def) => (
                  <button
                    key={def.id} className="part-row" aria-pressed={placing === def.id}
                    title={def.hint} onClick={() => onPick(def.id)}
                  >
                    <span className="thumb"><PartIcon type={def.id} /></span>
                    <span>
                      <span className="name" style={{ display: 'block' }}>{def.name}</span>
                      <span className="meta">{SUB[def.id]}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {!groups.length && <div className="empty">Nothing matches “{query}”.</div>}
          </div>
        </>
      )}
      {tab === 'items' && (
        <div className="list">
          {itemGroups.map(([groupName, items]) => (
            <div key={groupName}>
              <div className="group-label">{groupName}</div>
              {items.map((p) => (
                <div key={p.id} className={`part-row item-row ${selection === p.id ? 'active' : ''}`} aria-pressed={selection === p.id}>
                  <button className="item-row-main" title="Select" onClick={() => onSelect?.(p.id)}>
                    <span className="thumb"><PartIcon type={p.type} /></span>
                    <span>
                      <span className="name" style={{ display: 'block' }}>{p.name || CATALOG[p.type]?.name}</span>
                      <span className="meta">{CATALOG[p.type]?.name}</span>
                    </span>
                  </button>
                  <button className="item-row-del" title="Delete" onClick={() => onDelete?.(p.id)}>
                    <Icon.trash size={14} />
                  </button>
                </div>
              ))}
            </div>
          ))}
          {!itemGroups.length && <div className="empty">Nothing placed yet — switch to Add.</div>}
        </div>
      )}
    </aside>
  );
}
