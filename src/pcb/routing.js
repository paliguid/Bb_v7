import { round6 } from './geometry.js';

export const ROUTE_MODES = ['45', '90', 'free'];

const same = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/**
 * Points of a routed path from `from` to `to`.
 *  - free: a single straight segment
 *  - 90:  an orthogonal dog-leg
 *  - 45:  straight + 45° diagonal, landing exactly on `to`
 * `flip` swaps which leg comes first.
 */
export function routePath(from, to, mode = '45', flip = false) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const sx = Math.sign(dx), sy = Math.sign(dy);
  let mid = null;

  if (mode === '90') {
    if (adx > 1e-9 && ady > 1e-9) mid = flip ? { x: from.x, y: to.y } : { x: to.x, y: from.y };
  } else if (mode === '45') {
    if (adx > 1e-9 && ady > 1e-9 && Math.abs(adx - ady) > 1e-9) {
      const d = Math.min(adx, ady);
      const s = Math.abs(adx - ady);
      const xLong = adx > ady;
      mid = flip
        ? { x: from.x + sx * d, y: from.y + sy * d }
        : { x: from.x + (xLong ? sx * s : 0), y: from.y + (xLong ? 0 : sy * s) };
    }
  }
  const pts = [from, ...(mid ? [{ x: round6(mid.x), y: round6(mid.y) }] : []), to];
  return pts.filter((p, i) => i === 0 || !same(p, pts[i - 1]));
}
