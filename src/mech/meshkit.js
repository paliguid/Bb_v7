import { D2R, apply, cross, dot, len, norm, sub } from './math3.js';

/**
 * Triangle meshes: { positions: number[] (x,y,z…), indices: number[] } in millimetres.
 * All generators produce closed, outward-facing (counter-clockwise) surfaces so that
 * volume and inertia can be computed exactly with the divergence theorem.
 */
export const mesh = (positions = [], indices = []) => ({ positions, indices });
export const vertexCount = (m) => m.positions.length / 3;
export const triCount = (m) => m.indices.length / 3;

export function merge(list) {
  const positions = [], indices = [];
  for (const m of list) {
    const off = positions.length / 3;
    for (const v of m.positions) positions.push(v);
    for (const i of m.indices) indices.push(i + off);
  }
  return { positions, indices };
}

export function transformMesh(m, mat) {
  const positions = [];
  for (let i = 0; i < m.positions.length; i += 3) positions.push(...apply(mat, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]));
  return { positions, indices: m.indices.slice() };
}
export function scaleMesh(m, sx, sy = sx, sz = sx) {
  const positions = m.positions.map((v, i) => v * [sx, sy, sz][i % 3]);
  let indices = m.indices.slice();
  if (sx * sy * sz < 0) { indices = []; for (let i = 0; i < m.indices.length; i += 3) indices.push(m.indices[i], m.indices[i + 2], m.indices[i + 1]); }
  return { positions, indices };
}

export function bounds(m) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.positions[i + k]); hi[k] = Math.max(hi[k], m.positions[i + k]); }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]) };
}

/** Add a quad (a,b,c,d) given counter-clockwise from outside. */
function quad(ind, a, b, c, d) { ind.push(a, b, c, a, c, d); }

export function box(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  const p = [-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z];
  const i = [];
  quad(i, 0, 3, 2, 1); quad(i, 4, 5, 6, 7); quad(i, 0, 1, 5, 4); quad(i, 2, 3, 7, 6); quad(i, 1, 2, 6, 5); quad(i, 3, 0, 4, 7);
  return { positions: p, indices: i };
}

/** Surface of revolution about Z. profile = [[r, z], …] from bottom to top along the outside. */
export function lathe(profile, seg = 32) {
  const positions = [], indices = [];
  const ids = profile.map(([r, z], pi) => {
    const first = profile[0];
    if (pi === profile.length - 1 && pi > 0 && r === first[0] && z === first[1]) return null; // closed loop: reuse ring 0
    if (r < 1e-12) { positions.push(0, 0, z); const id = positions.length / 3 - 1; return Array(seg).fill(id); }
    return Array.from({ length: seg }, (_, i) => {
      const a = (i / seg) * Math.PI * 2;
      positions.push(r * Math.cos(a), r * Math.sin(a), z);
      return positions.length / 3 - 1;
    });
  });
  if (ids[ids.length - 1] === null) ids[ids.length - 1] = ids[0];
  for (let j = 0; j + 1 < profile.length; j++) for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % seg;
    const a = ids[j][i], b = ids[j][i2], c = ids[j + 1][i2], d = ids[j + 1][i];
    const r0 = profile[j][0], r1 = profile[j + 1][0];
    if (r0 < 1e-12 && r1 < 1e-12) continue;
    if (r0 < 1e-12) indices.push(a, c, d);
    else if (r1 < 1e-12) indices.push(a, b, c);
    else quad(indices, a, b, c, d);
  }
  return { positions, indices };
}
export const cylinder = (r, h, seg = 32) => lathe([[0, -h / 2], [r, -h / 2], [r, h / 2], [0, h / 2]], seg);
export const cone = (r1, r2, h, seg = 32) => lathe([[0, -h / 2], [r1, -h / 2], [r2, h / 2], [0, h / 2]], seg);
export const tube = (ro, ri, h, seg = 32) => lathe([[ri, -h / 2], [ro, -h / 2], [ro, h / 2], [ri, h / 2], [ri, -h / 2]], seg);
export function sphere(r, seg = 28, rings = 16) {
  const prof = [];
  for (let j = 0; j <= rings; j++) { const a = -Math.PI / 2 + (j / rings) * Math.PI; prof.push([Math.max(0, r * Math.cos(a)), r * Math.sin(a)]); }
  return lathe(prof, seg);
}
export function torus(R, r, segU = 36, segV = 16) {
  const positions = [], indices = [];
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
    const u = (i / segU) * Math.PI * 2, v = (j / segV) * Math.PI * 2;
    positions.push((R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v));
  }
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
    const i2 = (i + 1) % segU, j2 = (j + 1) % segV;
    quad(indices, i * segV + j, i2 * segV + j, i2 * segV + j2, i * segV + j2);
  }
  return { positions, indices };
}

/** Ear-clipping triangulation of a simple counter-clockwise polygon. Returns index triples into `poly`. */
export function triangulate(poly) {
  const n = poly.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  const out = [];
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cr(a, b, p) >= -1e-12 && cr(b, c, p) >= -1e-12 && cr(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      if (cr(a, b, c) <= 1e-12) continue;
      let ear = true;
      for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; if (inside(poly[j], a, b, c)) { ear = false; break; } }
      if (ear) { out.push([i0, i1, i2]); idx.splice(k, 1); clipped = true; break; }
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

export const polygonArea = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; s += x1 * y2 - x2 * y1; } return s / 2; };

/** Extrude a simple CCW polygon along Z from z0 to z1 (caps by ear clipping, or a fan if `star`). */
export function extrude(poly, z0, z1, { star = false, taper = 1 } = {}) {
  const n = poly.length;
  const positions = [], indices = [];
  for (const [x, y] of poly) positions.push(x, y, z0);
  for (const [x, y] of poly) positions.push(x * taper, y * taper, z1);
  for (let i = 0; i < n; i++) quad(indices, i, (i + 1) % n, n + ((i + 1) % n), n + i);
  if (star) {
    const c0 = positions.length / 3; positions.push(0, 0, z0);
    const c1 = positions.length / 3; positions.push(0, 0, z1);
    for (let i = 0; i < n; i++) { indices.push(c0, (i + 1) % n, i); indices.push(c1, n + i, n + ((i + 1) % n)); }
  } else {
    for (const [a, b, c] of triangulate(poly)) { indices.push(a, c, b); indices.push(n + a, n + b, n + c); }
  }
  return { positions, indices };
}
export const regularPrism = (nSides, r, h) => extrude(Array.from({ length: nSides }, (_, i) => [r * Math.cos((i / nSides) * Math.PI * 2), r * Math.sin((i / nSides) * Math.PI * 2)]), -h / 2, h / 2, { star: true });

/** Sweep a circle of radius r along a polyline (parallel-transport frames). */
export function sweepTube(path, r, seg = 6) {
  const positions = [], indices = [];
  let prevN = null;
  for (let k = 0; k < path.length; k++) {
    const a = path[Math.max(0, k - 1)], b = path[Math.min(path.length - 1, k + 1)];
    const t = norm(sub(b, a));
    let nrm = prevN ? sub(prevN, [t[0] * dot(prevN, t), t[1] * dot(prevN, t), t[2] * dot(prevN, t)]) : (Math.abs(t[2]) < 0.9 ? cross(t, [0, 0, 1]) : cross(t, [1, 0, 0]));
    nrm = norm(nrm);
    const bn = cross(t, nrm);
    prevN = nrm;
    for (let i = 0; i < seg; i++) {
      const ang = (i / seg) * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
      positions.push(path[k][0] + r * (c * nrm[0] + s * bn[0]), path[k][1] + r * (c * nrm[1] + s * bn[1]), path[k][2] + r * (c * nrm[2] + s * bn[2]));
    }
  }
  for (let k = 0; k + 1 < path.length; k++) for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % seg;
    quad(indices, k * seg + i, k * seg + i2, (k + 1) * seg + i2, (k + 1) * seg + i);
  }
  // end caps
  const c0 = positions.length / 3; positions.push(...path[0]);
  const c1 = c0 + 1; positions.push(...path[path.length - 1]);
  for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % seg;
    indices.push(c0, i2, i);
    indices.push(c1, (path.length - 1) * seg + i, (path.length - 1) * seg + i2);
  }
  return { positions, indices };
}

/* ------------------------------------------------------------ mass properties */

/**
 * Exact volume, centroid and inertia tensor of a closed triangle mesh (mm units in, SI out).
 * density kg/m³; returns mass (kg), com (mm), inertia tensors (kg·m²) about the origin and about the COM.
 */
export function massProps(m, density = 7850) {
  let V = 0;
  const S = [0, 0, 0];
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = [p[m.indices[t] * 3], p[m.indices[t] * 3 + 1], p[m.indices[t] * 3 + 2]];
    const b = [p[m.indices[t + 1] * 3], p[m.indices[t + 1] * 3 + 1], p[m.indices[t + 1] * 3 + 2]];
    const c = [p[m.indices[t + 2] * 3], p[m.indices[t + 2] * 3 + 1], p[m.indices[t + 2] * 3 + 2]];
    const v = dot(a, cross(b, c)) / 6;
    V += v;
    for (let i = 0; i < 3; i++) S[i] += (v / 4) * (a[i] + b[i] + c[i]);
    const vs = [a, b, c];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const sumI = a[i] + b[i] + c[i], sumJ = a[j] + b[j] + c[j];
      let sq = 0; for (const q of vs) sq += q[i] * q[j];
      C[i][j] += (v / 20) * (sumI * sumJ + sq);
    }
  }
  const mm3 = 1e-9; // mm³ → m³
  const volume = V * mm3;
  const mass = volume * density;
  const com = V !== 0 ? S.map((s) => s / V) : [0, 0, 0];
  const k = density * 1e-15; // mm⁵ → m⁵ times density gives kg·m²
  const tr = C[0][0] + C[1][1] + C[2][2];
  const I0 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I0[i][j] = k * ((i === j ? tr : 0) - C[i][j]);
  const cm = com.map((c) => c * 1e-3);
  const cc = cm[0] * cm[0] + cm[1] * cm[1] + cm[2] * cm[2];
  const Icom = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Icom[i][j] = I0[i][j] - mass * ((i === j ? cc : 0) - cm[i] * cm[j]);
  return { volume, mass, com, inertiaOrigin: I0, inertiaCom: Icom };
}

/* ------------------------------------------------------------------ file I/O */

export function meshNormals(m) {
  const p = m.positions, out = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = [p[m.indices[t] * 3], p[m.indices[t] * 3 + 1], p[m.indices[t] * 3 + 2]];
    const b = [p[m.indices[t + 1] * 3], p[m.indices[t + 1] * 3 + 1], p[m.indices[t + 1] * 3 + 2]];
    const c = [p[m.indices[t + 2] * 3], p[m.indices[t + 2] * 3 + 1], p[m.indices[t + 2] * 3 + 2]];
    out.push(norm(cross(sub(b, a), sub(c, a))));
  }
  return out;
}

/** Binary STL (Uint8Array). Units are millimetres, as 3D-printing slicers expect. */
export function toStl(m, name = 'BreadBai part') {
  const n = triCount(m);
  const buf = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(buf);
  const enc = new TextEncoder().encode(name.slice(0, 79));
  new Uint8Array(buf).set(enc, 0);
  dv.setUint32(80, n, true);
  const normals = meshNormals(m);
  let o = 84;
  for (let t = 0; t < n; t++) {
    for (const v of normals[t]) { dv.setFloat32(o, v, true); o += 4; }
    for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) { dv.setFloat32(o, m.positions[m.indices[t * 3 + k] * 3 + c], true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}

/** Weld vertices that share a position, so imported triangle soups become indexed meshes. */
export function weld(positions, eps = 1e-5) {
  const map = new Map(), out = [], indices = [];
  for (let i = 0; i < positions.length; i += 3) {
    const key = `${Math.round(positions[i] / eps)},${Math.round(positions[i + 1] / eps)},${Math.round(positions[i + 2] / eps)}`;
    let id = map.get(key);
    if (id === undefined) { id = out.length / 3; map.set(key, id); out.push(positions[i], positions[i + 1], positions[i + 2]); }
    indices.push(id);
  }
  return { positions: out, indices };
}

export function parseStl(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + 50 * n === bytes.byteLength) {
      const pos = [];
      for (let t = 0, o = 84; t < n; t++, o += 50) for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) pos.push(dv.getFloat32(o + 12 + (k * 3 + c) * 4, true));
      return weld(pos);
    }
  }
  const text = new TextDecoder().decode(bytes);
  const pos = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) pos.push(+m[1], +m[2], +m[3]);
  if (!pos.length || pos.length % 9) throw new Error('Not a valid STL file');
  return weld(pos);
}

export function parseObj(text) {
  const positions = [], indices = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) { const [, x, y, z] = line.split(/\s+/); positions.push(+x, +y, +z); }
    else if (line.startsWith('f ')) {
      const nv = positions.length / 3;
      const ids = line.split(/\s+/).slice(1).map((t) => { const i = parseInt(t.split('/')[0], 10); return i < 0 ? nv + i : i - 1; });
      for (let k = 1; k + 1 < ids.length; k++) indices.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  if (!positions.length || !indices.length) throw new Error('Not a valid OBJ file');
  return { positions, indices };
}

export const UNIT_TO_MM = { mm: 1, cm: 10, m: 1000, in: 25.4 };

/** Centre an imported mesh on its bounding box (or COM) and scale it into millimetres. */
export function normalizeImport(m, unit = 'mm', center = 'bbox') {
  let out = scaleMesh(m, UNIT_TO_MM[unit] ?? 1);
  const b = bounds(out);
  const c = center === 'com' ? massProps(out, 1).com : b.lo.map((l, k) => (l + b.hi[k]) / 2);
  out = { positions: out.positions.map((v, i) => v - c[i % 3]), indices: out.indices };
  return out;
}

/** Signed check that a mesh is closed (every edge shared by exactly two triangles, opposite directions). */
export function isWatertight(m) {
  const edges = new Map();
  for (let t = 0; t < m.indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = m.indices[t + k], b = m.indices[t + (k + 1) % 3];
    if (a === b) continue;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const rec = edges.get(key) ?? { fwd: 0, rev: 0 };
    if (a < b) rec.fwd++; else rec.rev++;
    edges.set(key, rec);
  }
  let open = 0;
  for (const { fwd, rev } of edges.values()) if (fwd !== 1 || rev !== 1) open++;
  return { closed: open === 0, openEdges: open };
}

/* ------------------------------------------------------- machine-element shapes */

const inv = (a) => Math.tan(a) - a;

/** Involute spur-gear outline (CCW). Tooth 0 is centred on +X. */
export function gearOutline(module, teeth, pressureDeg = 20, perFlank = 5) {
  const m = module, z = teeth, alpha = pressureDeg * D2R;
  const rp = (m * z) / 2, rb = rp * Math.cos(alpha), ra = rp + m, rf = Math.max(rp - 1.25 * m, m * 0.5);
  const thAt = (r) => Math.max(0.012, Math.PI / (2 * z) + inv(alpha) - inv(Math.acos(Math.min(1, rb / Math.max(r, rb)))));
  const r0 = Math.max(rb, rf);
  const thRoot = Math.min(thAt(r0), Math.PI / z - 0.02);
  const pts = [];
  for (let k = 0; k < z; k++) {
    const c = (k * 2 * Math.PI) / z;
    const P = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    pts.push(P(rf, c - thRoot));
    for (let i = 0; i <= perFlank; i++) { const r = r0 + ((ra - r0) * i) / perFlank; pts.push(P(r, c - Math.min(thAt(r), thRoot))); }
    const tip = thAt(ra);
    pts.push(P(ra, c));
    for (let i = perFlank; i >= 0; i--) { const r = r0 + ((ra - r0) * i) / perFlank; pts.push(P(r, c + Math.min(thAt(r), thRoot))); }
    pts.push(P(rf, c + thRoot));
    pts.push(P(rf, c + Math.PI / z));
    void tip;
  }
  // drop consecutive duplicates
  return pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9; });
}

export function spurGear(module, teeth, width, pressureDeg = 20) {
  return extrude(gearOutline(module, teeth, pressureDeg), -width / 2, width / 2, { star: true });
}

/** Internal (ring) gear: teeth point inward. outerRadius defaults to a comfortable rim. */
/** The toothed boundary of the void inside an internal (ring) gear (CCW, sorted by angle). */
export function ringInnerOutline(module, teeth, pressureDeg = 20) {
  const ext = gearOutline(module, teeth, pressureDeg);
  const rp = (module * teeth) / 2;
  return ext.map(([x, y]) => {
    const a = Math.atan2(y, x) + Math.PI / teeth;
    const r = 2 * rp - Math.hypot(x, y);
    return [r * Math.cos(a), r * Math.sin(a)];
  }).sort((p, q) => Math.atan2(p[1], p[0]) - Math.atan2(q[1], q[0]));
}

/** Internal (ring) gear: teeth point inward. */
export function ringGear(module, teeth, width, pressureDeg = 20, rim = 4) {
  const inner = ringInnerOutline(module, teeth, pressureDeg);
  const rp = (module * teeth) / 2;
  const Ro = rp + 1.25 * module + rim * module;
  const n = inner.length;
  const positions = [], indices = [];
  const h = width / 2;
  for (const [x, y] of inner) positions.push(x, y, -h);
  for (const [x, y] of inner) positions.push(x, y, h);
  for (const [x, y] of inner) { const a = Math.atan2(y, x); positions.push(Ro * Math.cos(a), Ro * Math.sin(a), -h); }
  for (const [x, y] of inner) { const a = Math.atan2(y, x); positions.push(Ro * Math.cos(a), Ro * Math.sin(a), h); }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    quad(indices, j, i, n + i, n + j);
    quad(indices, 2 * n + i, 2 * n + j, 3 * n + j, 3 * n + i);
    quad(indices, i, j, 2 * n + j, 2 * n + i);
    quad(indices, n + j, n + i, 3 * n + i, 3 * n + j);
  }
  return { positions, indices };
}

/** Rack: teeth face +Y, pitch line at y=0, length along X, extruded along Z. */
export function rackMesh(module, length, width, baseHeight = 6, pressureDeg = 20) {
  const m = module, p = Math.PI * m, ta = Math.tan(pressureDeg * D2R);
  const yb = -1.25 * m - baseHeight, root = -1.25 * m, tip = m;
  const nT = Math.max(1, Math.floor(length / p));
  const x0 = -(nT * p) / 2;
  const pts = [[x0, yb], [x0 + nT * p, yb], [x0 + nT * p, root]];
  for (let k = nT - 1; k >= 0; k--) {
    const c = x0 + p / 2 + k * p;
    pts.push([c + p / 4 + 1.25 * m * ta, root], [c + p / 4 - m * ta, tip], [c - p / 4 + m * ta, tip], [c - p / 4 - 1.25 * m * ta, root]);
  }
  pts.push([x0, root]);
  return extrude(pts, -width / 2, width / 2);
}

/** Cam outline from a radius function r(θ). */
export function camMesh(radiusAt, width, seg = 180) {
  const poly = Array.from({ length: seg }, (_, i) => { const a = (i / seg) * Math.PI * 2, r = radiusAt(a); return [r * Math.cos(a), r * Math.sin(a)]; });
  return extrude(poly, -width / 2, width / 2, { star: true });
}

/** Twisted, tapered blade along +X from the hub (used for propellers, fans and rotors). */
export function blade(length, chordRoot, chordTip, thickness, pitchRootDeg, pitchTipDeg, stations = 6) {
  const positions = [], indices = [];
  for (let s = 0; s <= stations; s++) {
    const t = s / stations, x = t * length;
    const chord = chordRoot + (chordTip - chordRoot) * t, pitch = (pitchRootDeg + (pitchTipDeg - pitchRootDeg) * t) * D2R;
    const c = Math.cos(pitch), sn = Math.sin(pitch);
    for (const [u, v] of [[-chord / 2, -thickness / 2], [chord / 2, -thickness / 2], [chord / 2, thickness / 2], [-chord / 2, thickness / 2]]) {
      positions.push(x, u * c - v * sn, u * sn + v * c);
    }
  }
  for (let s = 0; s < stations; s++) {
    const a = s * 4, b = (s + 1) * 4;
    for (let k = 0; k < 4; k++) quad(indices, a + k, a + (k + 1) % 4, b + (k + 1) % 4, b + k);
  }
  const last = stations * 4;
  quad(indices, 0, 3, 2, 1); quad(indices, last, last + 1, last + 2, last + 3);
  return { positions, indices };
}

export function helixSpring(coilR, wireR, coils, length, seg = 10) {
  const n = Math.max(12, Math.round(coils * seg));
  const path = Array.from({ length: n + 1 }, (_, i) => { const t = i / n, a = t * coils * Math.PI * 2; return [coilR * Math.cos(a), coilR * Math.sin(a), -length / 2 + t * length]; });
  return sweepTube(path, wireR, 6);
}

/** Wrap a mesh so it is inspected in kg: convenience for callers needing mass at given density. */
export const meshMass = (m, density) => massProps(m, density).mass;
export { len as vecLen };
