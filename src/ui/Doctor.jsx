import { useRef, useState } from 'react';
import { useDismiss } from './useDismiss.js';
import { Inline } from './richtext.jsx';

const ICON = { error: '⛔', warn: '⚠️', info: 'ℹ️' };

/** "Circuit Check" — plain-language diagnosis of the circuit on the board. */
export default function Doctor({ issues, onSelect, onOpen }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useDismiss(wrap, () => setOpen(false));

  const problems = issues.filter((i) => i.level !== 'info').length;
  const worst = issues.find((i) => i.level === 'error') ? 'error' : problems ? 'warn' : 'ok';

  const toggle = () => {
    if (!open) onOpen?.();
    setOpen((v) => !v);
  };

  return (
    <div className="doctor" ref={wrap}>
      <button className="btn ghost doctor-btn" onClick={toggle} aria-expanded={open} title="Explains what might be wrong with your circuit">
        <span className={`dot ${worst}`} />
        Circuit Check
        {problems > 0 && <span className="count">{problems}</span>}
      </button>

      {open && (
        <div className="doctor-pop glass" role="dialog" aria-label="Circuit Check">
          {issues.length === 0 ? (
            <div className="doctor-empty">
              <b>All good.</b>
              <span>No wiring or safety problems found. Add parts and this list will keep watching.</span>
            </div>
          ) : (
            <ul>
              {issues.map((issue) => (
                <li key={issue.id}>
                  <button
                    className={`issue ${issue.level}`}
                    onClick={() => issue.partId && onSelect(issue.partId)}
                    disabled={!issue.partId}
                  >
                    <span className="ico" aria-hidden="true">{ICON[issue.level]}</span>
                    <span>
                      <b>{issue.title}</b>
                      <span className="detail"><Inline text={issue.detail} /></span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
