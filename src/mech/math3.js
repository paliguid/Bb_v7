/** Tiny 3D math. Vectors are [x,y,z]; matrices are column-major 4×4 (three.js convention). */
export const D2R = Math.PI / 180;
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Rotation R = Rz·Ry·Rx from Euler angles in degrees. */
export function eulerMat(rx = 0, ry = 0, rz = 0) {
  const cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R);
  const cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R);
  const cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
  return [
    cz * cy, sz * cy, -sy, 0,
    cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx, 0,
    cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx, 0,
    0, 0, 0, 1,
  ];
}
export function compose(p = [0, 0, 0], e = [0, 0, 0]) {
  const m = eulerMat(e[0], e[1], e[2]);
  m[12] = p[0]; m[13] = p[1]; m[14] = p[2];
  return m;
}
export function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
export const trans = (x, y, z) => { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m; };
export function rotZ(theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
export const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
export const applyDir = (m, d) => [
  m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
  m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
  m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
];
export const axesOf = (m) => ({
  o: [m[12], m[13], m[14]],
  x: norm([m[0], m[1], m[2]]), y: norm([m[4], m[5], m[6]]), z: norm([m[8], m[9], m[10]]),
});
/** Closest points between two infinite lines (p1,d1) and (p2,d2). Returns { dist, t1, t2, parallel }. */
export function lineLine(p1, d1, p2, d2) {
  const w = sub(p1, p2);
  const a = dot(d1, d1), b = dot(d1, d2), c = dot(d2, d2), d = dot(d1, w), e = dot(d2, w);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-12) {
    const t2 = e / c;
    const q = add(p2, scale(d2, t2));
    return { dist: len(sub(p1, q)), t1: 0, t2, parallel: true };
  }
  const t1 = (b * e - c * d) / den, t2 = (a * e - b * d) / den;
  const q1 = add(p1, scale(d1, t1)), q2 = add(p2, scale(d2, t2));
  return { dist: len(sub(q1, q2)), t1, t2, parallel: false };
}
