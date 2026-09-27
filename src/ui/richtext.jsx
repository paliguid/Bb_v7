/** Tiny inline markup for lesson copy: **bold** and `key`. No HTML injection possible. */
export function Inline({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>;
    if (p.startsWith('`')) return <kbd key={i}>{p.slice(1, -1)}</kbd>;
    return <span key={i}>{p}</span>;
  });
}
