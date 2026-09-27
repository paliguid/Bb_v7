/** 2D geometry in millimetres, y down. Everything here is pure. */

export const TOL = 1e-4;
export const round6 = (v) => Math.round(v * 1e6) / 1e6;
export const snapTo = (v, g) => (g > 0 ? round6(Math.round(v / g) * g) : v);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function distPointSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-18) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

export function segsIntersect(a, b, c, d) {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

export function distSegSeg(a, b, c, d) {
  if (segsIntersect(a, b, c, d)) return 0;
  return Math.min(distPointSeg(a, c, d), distPointSeg(b, c, d), distPointSeg(c, a, b), distPointSeg(d, a, b));
}

/** Axis-aligned rectangle: { cx, cy, hw, hh } (half extents). */
export const rectCorners = (r) => [
  { x: r.cx - r.hw, y: r.cy - r.hh }, { x: r.cx + r.hw, y: r.cy - r.hh },
  { x: r.cx + r.hw, y: r.cy + r.hh }, { x: r.cx - r.hw, y: r.cy + r.hh },
];
export const pointInRect = (p, r) => Math.abs(p.x - r.cx) <= r.hw && Math.abs(p.y - r.cy) <= r.hh;

export function distPointRect(p, r) {
  const dx = Math.max(Math.abs(p.x - r.cx) - r.hw, 0);
  const dy = Math.max(Math.abs(p.y - r.cy) - r.hh, 0);
  return Math.hypot(dx, dy);
}

export function distSegRect(a, b, r) {
  if (pointInRect(a, r) || pointInRect(b, r)) return 0;
  const c = rectCorners(r);
  let best = Infinity;
  for (let i = 0; i < 4; i++) best = Math.min(best, distSegSeg(a, b, c[i], c[(i + 1) % 4]));
  return best;
}

export function distRectRect(p, q) {
  const dx = Math.max(Math.abs(p.cx - q.cx) - (p.hw + q.hw), 0);
  const dy = Math.max(Math.abs(p.cy - q.cy) - (p.hh + q.hh), 0);
  return Math.hypot(dx, dy);
}

/**
 * Copper shapes are either
 *   { t: 's', a, b, r }            a segment with round caps (track, round pad, oval pad, via)
 *   { t: 'r', cx, cy, hw, hh }     an axis-aligned rectangle (rect pad)
 * gap(A, B) is the clear distance between their edges (≤ 0 means they touch).
 */
export function gap(A, B) {
  if (A.t === 's' && B.t === 's') return distSegSeg(A.a, A.b, B.a, B.b) - A.r - B.r;
  if (A.t === 's') return distSegRect(A.a, A.b, B) - A.r;
  if (B.t === 's') return distSegRect(B.a, B.b, A) - B.r;
  return distRectRect(A, B);
}

export function bbox(s, m = 0) {
  if (s.t === 's') {
    return { x0: Math.min(s.a.x, s.b.x) - s.r - m, y0: Math.min(s.a.y, s.b.y) - s.r - m,
      x1: Math.max(s.a.x, s.b.x) + s.r + m, y1: Math.max(s.a.y, s.b.y) + s.r + m };
  }
  return { x0: s.cx - s.hw - m, y0: s.cy - s.hh - m, x1: s.cx + s.hw + m, y1: s.cy + s.hh + m };
}
export const bboxOverlap = (p, q) => p.x0 <= q.x1 && q.x0 <= p.x1 && p.y0 <= q.y1 && q.y0 <= p.y1;

/** Signed distance to a rounded rectangle occupying [0,w]×[0,h]; negative inside. */
export function roundedRectSD(p, { w, h, r }) {
  const rr = Math.max(0, Math.min(r ?? 0, w / 2, h / 2));
  const qx = Math.abs(p.x - w / 2) - (w / 2 - rr);
  const qy = Math.abs(p.y - h / 2) - (h / 2 - rr);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
}

/** Room between a copper shape and the board edge (negative when it pokes outside). */
export function edgeGap(shape, board) {
  const pts = shape.t === 's' ? [shape.a, shape.b] : rectCorners(shape);
  const r = shape.t === 's' ? shape.r : 0;
  let best = Infinity;
  for (const p of pts) best = Math.min(best, -roundedRectSD(p, board) - r);
  return best;
}

export const rotPoint = (p, deg) => {
  const k = ((Math.round(deg) % 360) + 360) % 360;
  if (k === 0) return { x: p.x, y: p.y };
  if (k === 90) return { x: -p.y, y: p.x };
  if (k === 180) return { x: -p.x, y: -p.y };
  if (k === 270) return { x: p.y, y: -p.x };
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

export function pathPoints(pts) {
  const segs = [];
  for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
  return segs;
}
