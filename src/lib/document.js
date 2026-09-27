import { CATALOG, makeProps } from './catalog.js';

export const FILE_VERSION = 1;

/** Strips live simulation state so a circuit is safe to store or undo. */
export function serialize(doc) {
  return {
    format: 'BreadBai',
    version: FILE_VERSION,
    parts: doc.parts.map((p) => ({
      id: p.id, type: p.type, x: p.x, y: p.y ?? 0, z: p.z, rot: p.rot ?? 0,
      props: { ...p.props }, inserted: { ...p.inserted },
    })),
    wires: doc.wires.map((w) => ({ id: w.id, a: w.a, b: w.b, color: w.color })),
  };
}

export function deserialize(data) {
  if (!data || data.format !== 'BreadBai') throw new Error('That file is not a BreadBai circuit.');
  const parts = (data.parts ?? [])
    .filter((p) => CATALOG[p.type])
    .map((p) => ({
      ...p,
      props: { ...makeProps(p.type), ...p.props },
      state: CATALOG[p.type].state(),
      mem: {},
      inserted: p.inserted ?? {},
    }));
  const ids = new Set(parts.map((p) => p.id));
  const wires = (data.wires ?? []).filter((w) => {
    const ok = (ep) => ep && (ep.kind === 'hole' ? ids.has(ep.boardId) : ids.has(ep.partId));
    return ok(w.a) && ok(w.b);
  });
  return { parts, wires };
}

export function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
