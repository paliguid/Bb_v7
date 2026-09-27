import { axesOf, dot } from './math3.js';
import { PART_TYPES, camLift } from './catalog.js';
import { byId, compAxis, defOf, isShaftMounted, isSliderLike, linkInfo, partEccentric, partInertia, partMass, restMatrix } from './assembly.js';
import { materialOf } from './materials.js';

const TWO_PI = 2 * Math.PI;
const G_DIR = [0, -1, 0];
const BEARING_MU = { ball: 0.002, sleeve: 0.02, bushing: 0.08, none: 0 };
const sreg = (x, r) => Math.tanh(x / r);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Damping ratio ζ that gives a requested coefficient of restitution for a spring-damper contact that
 * cannot pull (force clamped ≥ 0). Solved exactly from the closed-form contact solution.
 */
function eOfZeta(z) {
  if (z >= 1) return 0;
  const wd = Math.sqrt(1 - z * z), B = (1 - 2 * z * z) / wd, th = Math.atan2(2 * z, -B);
  return -Math.exp((-z * th) / wd) * (Math.cos(th) - (z / wd) * Math.sin(th));
}
export function zetaForRestitution(e) {
  let lo = 1e-6, hi = 0.9999;
  if (e >= eOfZeta(lo)) return lo;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (eOfZeta(mid) > e) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------ dense algebra */

function solveDense(A, b, n) {
  const M = A.map((r) => r.slice());
  const x = b.slice();
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) continue;
    if (p !== c) { [M[p], M[c]] = [M[c], M[p]]; [x[p], x[c]] = [x[c], x[p]]; }
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k < n; k++) M[r][k] -= f * M[c][k];
      x[r] -= f * x[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = Math.abs(M[r][r]) < 1e-300 ? 0 : s / M[r][r];
  }
  return x;
}

/** Null-space basis of the constraint matrix C (m×n): returns { N (n×d), rank }. */
function nullspace(C, n) {
  const R = C.map((r) => r.slice());
  const tol = 1e-9 * Math.max(1, ...C.flat().map(Math.abs));
  const pivots = [];
  let row = 0;
  for (let col = 0; col < n && row < R.length; col++) {
    let p = row;
    for (let r = row + 1; r < R.length; r++) if (Math.abs(R[r][col]) > Math.abs(R[p][col])) p = r;
    if (Math.abs(R[p][col]) < tol) continue;
    [R[p], R[row]] = [R[row], R[p]];
    const pv = R[row][col];
    for (let k = 0; k < n; k++) R[row][k] /= pv;
    for (let r = 0; r < R.length; r++) {
      if (r === row) continue;
      const f = R[r][col];
      if (Math.abs(f) < 1e-15) continue;
      for (let k = 0; k < n; k++) R[r][k] -= f * R[row][k];
    }
    pivots.push(col);
    row++;
  }
  const free = [];
  for (let c = 0; c < n; c++) if (!pivots.includes(c)) free.push(c);
  const N = Array.from({ length: n }, () => new Array(free.length).fill(0));
  free.forEach((f, j) => {
    N[f][j] = 1;
    pivots.forEach((pc, r) => { N[pc][j] = -R[r][f]; });
  });
  return { N, rank: pivots.length, free };
}

/* --------------------------------------------------------------- Machine */

export class Machine {
  constructor(doc) {
    this.doc = doc;
    this.issues = [];
    this.compile();
    this.reset();
  }

  /* ------------------------------------------------------------ compile */

  compile() {
    const doc = this.doc, g = doc.gravity ?? 9.81, rho = doc.rho ?? 1.225;
    this.g = g; this.rho = rho;
    const shafts = doc.parts.filter((p) => p.type === 'shaft');
    const sliders = doc.parts.filter(isSliderLike);
    const links = doc.links.map((l) => ({ link: l, info: linkInfo(doc, l) }));
    this.linkInfos = links;
    for (const { link, info } of links) if (!info.ok) this.issues.push({ level: 'error', rule: 'link', partId: link.a, linkId: link.id, title: 'A connection is not engaging', detail: info.issues.filter((i) => i.level === 'error').map((i) => i.msg).join(' ') });

    // transformer (nonlinear kinematic) links make their slider a dependent "leaf" body
    const xf = links.filter(({ link, info }) => info.ok && (link.type === 'crank' || link.type === 'follower'));
    const leafIds = new Set(xf.map(({ link }) => link.b));
    const coreSliders = sliders.filter((s) => !leafIds.has(s.id));
    const planetaries = doc.parts.filter((p) => p.type === 'planetary');

    this.bodies = [];
    const bodyOf = new Map();
    const addBody = (id, kind, extra = {}) => { bodyOf.set(id, this.bodies.length); this.bodies.push({ id, kind, J: 0, ...extra }); };
    for (const s of shafts) addBody(s.id, 'rot', { part: s });
    for (const s of coreSliders) addBody(s.id, 'trans', { part: s });
    for (const pl of planetaries) addBody(`${pl.id}:planets`, 'rot', { part: pl, planet: true });
    const n = this.n = this.bodies.length;
    this.bodyOf = bodyOf;
    this.leaves = xf.map(({ link, info }, k) => ({ link, info, slider: byId(doc, link.b), idx: n + k, driver: bodyOf.get(byId(doc, link.a).shaft) }));
    this.nt = n + this.leaves.length;
    for (const lf of this.leaves) bodyOf.set(lf.slider.id, lf.idx);

    // inertia and mass
    const carriedMass = new Map();
    for (const sh of shafts) {
      const b = this.bodies[bodyOf.get(sh.id)];
      b.J += 0.5 * materialOf(sh.material).rho * Math.PI * (sh.dia / 2000) ** 4 * (sh.length / 1000);
      let mass = partMass(doc, sh);
      for (const c of doc.parts) if (isShaftMounted(c) && c.shaft === sh.id) { b.J += partInertia(doc, c); mass += partMass(doc, c); }
      b.mass = mass;
      if (sh.carrier) carriedMass.set(sh.carrier, (carriedMass.get(sh.carrier) ?? 0) + mass);
    }
    for (const s of sliders) {
      const idx = bodyOf.get(s.id);
      const m = partMass(doc, s) + (carriedMass.get(s.id) ?? 0);
      s.__m = m;
      if (idx < n) this.bodies[idx].J = m;
    }
    for (const pl of planetaries) {
      const P = PART_TYPES.planetary.planet(pl);
      const bp = this.bodies[bodyOf.get(`${pl.id}:planets`)];
      bp.J = pl.planets * P.J;
      const cs = bodyOf.get(pl.carrier);
      if (cs !== undefined) this.bodies[cs].J += pl.planets * P.M * P.rc * P.rc; // planets orbit the axis
    }

    // gravity torque on shafts: τ = A cosθ + B sinθ
    this.grav = new Map();
    for (const c of doc.parts) {
      if (!isShaftMounted(c)) continue;
      const ecc = partEccentric(doc, c);
      if (!ecc || !ecc.m) continue;
      const sh = byId(doc, c.shaft);
      if (!sh) continue;
      const ax = axesOf(restMatrix(sh));
      const gx = dot(G_DIR, ax.x), gy = dot(G_DIR, ax.y), phi = (c.phase ?? 0) * Math.PI / 180;
      const cx = ecc.cx, cy = ecc.cy, mm = ecc.m * g;
      const t1 = cx * gy - cy * gx, t2 = cy * gy + cx * gx;
      const A = mm * (Math.cos(phi) * t1 - Math.sin(phi) * t2), B = mm * (-Math.sin(phi) * t1 - Math.cos(phi) * t2);
      const cur = this.grav.get(sh.id) ?? { A: 0, B: 0 };
      cur.A += A; cur.B += B;
      this.grav.set(sh.id, cur);
    }

    // rigid constraints
    this.rows = [];
    const row = (coef, meta) => { const r = new Array(n).fill(0); let nz = 0; for (const [id, v] of coef) { const i = bodyOf.get(id); if (i === undefined || i >= n) continue; r[i] += v; nz++; } if (nz) this.rows.push({ c: r, ...meta }); };
    for (const sh of shafts) if (sh.locked) row([[sh.id, 1]], { kind: 'lock', label: `${sh.name} locked` });
    this.elastic = [];
    for (const { link, info } of links) {
      if (!info.ok) continue;
      const A = byId(doc, link.a), Bp = byId(doc, link.b);
      const sa = A.shaft, sb = Bp.shaft;
      const t = link.type;
      if (t === 'spur' || t === 'internal') {
        if (sa === sb) { this.issues.push({ level: 'error', rule: 'link', partId: A.id, title: 'Both gears are on the same shaft', detail: 'Two meshed gears must be on different shafts.' }); continue; }
        const coef = [[sa, info.radiusA], [sb, (t === 'spur' ? 1 : -1) * info.sign * info.radiusB]];
        if (link.backlash > 0) this.elastic.push({ link, info, coef, kind: 'mesh', a: sa, b: sb });
        else row(coef, { kind: 'mesh', link, info, label: `${A.name} ↔ ${Bp.name}`, bodies: [sa, sb], eff: info.eff });
      } else if (t === 'bevel') {
        const coef = [[sa, info.radiusA * info.sa], [sb, info.radiusB * info.sb]];
        if (link.backlash > 0) this.elastic.push({ link, info, coef, kind: 'mesh', a: sa, b: sb });
        else row(coef, { kind: 'mesh', link, info, label: `${A.name} ↔ ${Bp.name}`, bodies: [sa, sb], eff: info.eff });
      } else if (t === 'rack') {
        const coef = [[Bp.id, 1], [sa, -info.sign * info.radiusA]];
        if (link.backlash > 0) this.elastic.push({ link, info, coef, kind: 'mesh', a: Bp.id, b: sa });
        else row(coef, { kind: 'mesh', link, info, label: `${A.name} ↔ ${Bp.name}`, bodies: [sa, Bp.id], eff: info.eff });
      } else if (t === 'worm') {
        row([[sb, Bp.teeth], [sa, -info.sign * A.starts]], { kind: 'worm', link, info, label: `${A.name} ↔ ${Bp.name}`, bodies: [sa, sb], worm: sa, wheel: sb });
      } else if (t === 'belt') {
        row([[sa, info.radiusA], [sb, -info.sign * info.radiusB]], { kind: 'belt', link, info, label: `${A.name} ↔ ${Bp.name}`, bodies: [sa, sb], eff: info.eff });
      } else if (t === 'rope') {
        row([[Bp.id, 1], [sa, -info.sign * info.radiusA]], { kind: 'rope', link, info, label: `${A.name} → ${Bp.name}`, bodies: [sa, Bp.id] });
      } else if (t === 'screw') {
        row([[Bp.id, 1], [sa, -info.sign * (A.lead / TWO_PI / 1000)]], { kind: 'screw', link, info, label: `${A.name} ↔ ${Bp.name}`, bodies: [sa, Bp.id], screw: sa, nut: Bp.id });
      } else if (t === 'wheel') {
        row([[Bp.id, 1], [sa, -info.sign * info.radius]], { kind: 'wheel', link, info, label: `${A.name} on ${Bp.name}`, bodies: [sa, Bp.id] });
      } else if (t === 'coupling') {
        const s = info.sign;
        if (link.mode === 'rigid') row([[link.a, 1], [link.b, -s]], { kind: 'coupling', link, info, label: `${A.name} = ${Bp.name}`, bodies: [link.a, link.b] });
        else this.elastic.push({ link, info, kind: 'coupling', a: link.a, b: link.b, s });
      }
    }
    for (const pl of planetaries) {
      const sunId = pl.sun, carId = pl.carrier, ringId = pl.ring;
      const ref = byId(doc, sunId) ?? byId(doc, carId) ?? byId(doc, ringId);
      if (!ref) continue;
      const zref = axesOf(restMatrix(ref)).z;
      const sgn = (id) => { const p = byId(doc, id); return p ? (dot(axesOf(restMatrix(p)).z, zref) >= 0 ? 1 : -1) : 0; };
      const zp = (pl.zr - pl.zs) / 2, sC = sgn(carId), sR = sgn(ringId), sS = sgn(sunId);
      row([[sunId, pl.zs * sS], [carId, -(pl.zs + pl.zr) * sC], [ringId, pl.zr * sR]], { kind: 'planetary', label: `${pl.name} gearset` });
      row([[`${pl.id}:planets`, zp], [carId, -(zp + pl.zs) * sC], [sunId, pl.zs * sS]], { kind: 'planet-spin', label: `${pl.name} planets` });
    }
    for (const df of doc.parts.filter((p) => p.type === 'differential')) {
      const ref = byId(doc, df.cage);
      if (!ref) continue;
      const zref = axesOf(restMatrix(ref)).z;
      const sgn = (id) => { const p = byId(doc, id); return p ? (dot(axesOf(restMatrix(p)).z, zref) >= 0 ? 1 : -1) : 0; };
      row([[df.left, sgn(df.left)], [df.right, sgn(df.right)], [df.cage, -2]], { kind: 'differential', label: `${df.name}` });
    }

    // reduce to independent coordinates
    const ns = nullspace(this.rows.map((r) => r.c), n);
    this.N = ns.N; this.d = ns.free.length; this.rank = ns.rank;
    this.C = this.rows.map((r) => r.c);
    if (this.d === 0 && n > 0 && doc.parts.some((p) => p.type === 'motor' || p.type === 'handcrank')) {
      this.issues.push({ level: 'error', rule: 'jam', partId: null, title: 'The mechanism is locked solid', detail: 'The constraints leave no way to move — for example a closed gear loop with inconsistent ratios, or every shaft locked.' });
    }
    this.buildElements(shafts, sliders, coreSliders);
    // stiff contacts (backlash, end stops, one-way clutches, springs) need a fresh Jacobian every step
    this.jacEvery = (this.elastic.length || doc.parts.some((p) => (p.limits && isSliderLike(p)) || p.type === 'spring')) ? 1 : 4;
  }

  /* ------------------------------------------------------------ elements */

  buildElements(shafts, sliders) {
    const doc = this.doc, bodyOf = this.bodyOf, g = this.g, rho = this.rho;
    this.ctrl = new Map();
    this.st = new Map();
    this.els = [];
    this.motors = []; this.generators = []; this.brakes = []; this.props = [];
    const ctrlOf = (p) => { const c = { ...p }; this.ctrl.set(p.id, c); return c; };
    const mk = (fn) => this.els.push(fn);
    const idxOf = (id) => bodyOf.get(id);

    // per-shaft bearing friction
    for (const sh of shafts) {
      const i = idxOf(sh.id), mu = BEARING_MU[sh.bearing] ?? 0;
      if (!mu) continue;
      const rb = sh.dia / 2000, weight = (this.bodies[i].mass ?? 0) * g, cv = 2e-7 * (sh.dia / 8) ** 2;
      const rows = this.rows.map((r, k) => [r, k]).filter(([r]) => r.bodies?.includes(sh.id));
      mk((x) => {
        let load = weight;
        for (const [r, k] of rows) load += 1.06 * Math.abs(this.lam?.[k] ?? 0) * (r.kind === 'worm' || r.kind === 'planetary' ? 0 : 1);
        const w = x.v[i], tau = mu * load * rb;
        const f = -tau * sreg(w, 0.05) - cv * w;
        x.f[i] += f;
        if (x.rec) x.loss += -f * w;
      });
    }
    // gravity on off-centre masses
    for (const [id, { A, B }] of this.grav) {
      const i = idxOf(id);
      mk((x) => { const th = x.p[i]; x.f[i] += A * Math.cos(th) + B * Math.sin(th); x.pe += -(A * Math.sin(th) - B * Math.cos(th)); });
    }

    for (const c of doc.parts) {
      const shaftIdx = c.shaft ? idxOf(c.shaft) : undefined;
      if (c.type === 'motor' && shaftIdx !== undefined) this.addMotor(c, shaftIdx, ctrlOf(c), mk);
      else if (c.type === 'generator' && shaftIdx !== undefined) this.addGenerator(c, shaftIdx, ctrlOf(c), mk);
      else if (c.type === 'handcrank' && shaftIdx !== undefined) {
        const pr = ctrlOf(c);
        mk((x) => { const w = x.v[shaftIdx]; const gov = pr.maxRpm > 0 ? clamp(1 - w / (pr.maxRpm * TWO_PI / 60), -1, 1) : 1; const tau = pr.torque * gov; x.f[shaftIdx] += tau; if (x.rec) x.supplied += tau * w; });
      } else if (c.type === 'load' && shaftIdx !== undefined) {
        const pr = ctrlOf(c);
        mk((x) => {
          const w = x.v[shaftIdx]; let tau = 0;
          if (pr.kind === 'viscous') tau = -pr.value * w; else if (pr.kind === 'coulomb') tau = -pr.value * sreg(w, 0.05);
          else if (pr.kind === 'quadratic') tau = -pr.value * w * Math.abs(w); else tau = pr.value;
          x.f[shaftIdx] += tau;
          if (x.rec) { if (pr.kind === 'source') x.supplied += tau * w; else x.loss += -tau * w; }
        });
      } else if (c.type === 'torsionspring' && shaftIdx !== undefined) {
        const pr = ctrlOf(c);
        mk((x) => { const th = x.p[shaftIdx] - pr.rest * Math.PI / 180, w = x.v[shaftIdx]; x.f[shaftIdx] += -pr.k * th - pr.c * w; x.pe += 0.5 * pr.k * th * th; if (x.rec) x.loss += pr.c * w * w; });
      } else if (c.type === 'brake' && shaftIdx !== undefined) {
        const pr = ctrlOf(c); const st = { T: doc.tAmb ?? 20, P: 0 }; this.st.set(c.id, st); this.brakes.push(c);
        mk((x) => { const w = x.v[shaftIdx], tau = -pr.maxTorque * clamp(pr.apply, 0, 1) * sreg(w, 0.1); x.f[shaftIdx] += tau; st.P = -tau * w; if (x.rec) x.loss += st.P; });
      } else if (c.type === 'propeller' && shaftIdx !== undefined) {
        const pr = ctrlOf(c), D = c.dia / 1000, tgt = pr.target ? idxOf(pr.target) : undefined;
        const tdir = tgt !== undefined && pr.target ? axesOf(restMatrix(byId(doc, pr.target))).x : null;
        const zs = axesOf(restMatrix(byId(doc, c.shaft))).z;
        const st = { thrust: 0, power: 0 }; this.st.set(c.id, st); this.props.push(c);
        mk((x) => {
          const w = x.v[shaftIdx], n = w / TWO_PI, nn = n * Math.abs(n);
          const tau = -(pr.cp / TWO_PI) * rho * D ** 5 * nn, T = pr.ct * rho * D ** 4 * nn * Number(pr.hand);
          x.f[shaftIdx] += tau; st.thrust = T; st.power = -tau * w;
          if (tgt !== undefined) x.f[tgt] += T * dot(zs, tdir);
          if (x.rec) x.loss += -tau * w;
        });
      } else if (c.type === 'windrotor' && shaftIdx !== undefined) {
        const pr = ctrlOf(c), R = c.dia / 2000, dirn = Number(pr.dir);
        const st = { cp: 0, lambda: 0, power: 0 }; this.st.set(c.id, st); this.props.push(c);
        mk((x) => {
          const w = x.v[shaftIdx] * dirn, v = Math.max(pr.wind, 1e-6), lam = Math.max(0, (w * R) / v);
          const cq = lam < 2 * pr.lambdaOpt ? (pr.cpMax * (2 - lam / pr.lambdaOpt)) / pr.lambdaOpt : 0;
          const tau = dirn * 0.5 * rho * Math.PI * R ** 3 * v * v * cq;
          x.f[shaftIdx] += tau; st.cp = cq * lam; st.lambda = lam; st.power = tau * x.v[shaftIdx];
          if (x.rec) x.supplied += tau * x.v[shaftIdx];
        });
      }
    }

    // sliders: gravity, friction, drag, end stops
    for (const s of sliders) {
      const i = idxOf(s.id);
      if (i === undefined) continue;
      const m = s.__m, ax = axesOf(restMatrix(s)), gd = dot(G_DIR, ax.x) * g, sinF = dot(G_DIR, ax.x);
      const Nn = m * g * Math.sqrt(Math.max(0, 1 - sinF * sinF));
      const pr = ctrlOf(s);
      const wheels = this.linkInfos.filter(({ link, info }) => link.type === 'wheel' && link.b === s.id && info.ok);
      const crr = wheels.length ? wheels.reduce((a, { info }) => a + info.crr, 0) / wheels.length : 0;
      const cdA = s.cdA ?? 0, e = clamp(pr.restitution ?? 0.3, 0.001, 0.999), zeta = zetaForRestitution(e);
      const kStop = m * (TWO_PI * 40) ** 2, cStop = 2 * zeta * Math.sqrt(kStop * m);
      mk((x) => {
        const v = x.v[i], pos = x.p[i];
        let f = m * gd - (pr.mu ?? 0) * Nn * sreg(v, 1e-3) - (pr.c ?? 0) * v - crr * Nn * sreg(v, 5e-3) - 0.5 * rho * cdA * v * Math.abs(v);
        x.pe += -m * gd * pos;
        if (pr.limits) {
          const hi = pr.max / 1000, lo = pr.min / 1000;
          if (pos > hi) { f += -Math.max(0, kStop * (pos - hi) + cStop * v); x.pe += 0.5 * kStop * (pos - hi) ** 2; }
          if (pos < lo) { f += Math.max(0, kStop * (lo - pos) - cStop * v); x.pe += 0.5 * kStop * (lo - pos) ** 2; }
        }
        x.f[i] += f;
        if (x.rec) x.loss += ((pr.mu ?? 0) * Nn * sreg(v, 1e-3) + (pr.c ?? 0) * v + crr * Nn * sreg(v, 5e-3) + 0.5 * rho * cdA * v * Math.abs(v)) * v;
      });
    }

    // springs between sliders / ground
    for (const sp of doc.parts.filter((p) => p.type === 'spring')) {
      const a = byId(doc, sp.a), b = sp.b && sp.b !== 'ground' ? byId(doc, sp.b) : null;
      if (!a) continue;
      const ia = idxOf(a.id), ib = b ? idxOf(b.id) : undefined;
      const Oa = axesOf(restMatrix(a)), Ob = b ? axesOf(restMatrix(b)) : null;
      const anchor = [sp.x / 1000, sp.y / 1000, sp.z / 1000], pr = ctrlOf(sp);
      const att = (O, q) => [O.o[0] / 1000 + O.x[0] * q, O.o[1] / 1000 + O.x[1] * q, O.o[2] / 1000 + O.x[2] * q];
      mk((x) => {
        const pa = att(Oa, x.p[ia]), pb = Ob ? att(Ob, x.p[ib]) : anchor;
        const dvec = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]], L = Math.hypot(...dvec) || 1e-9, u = [dvec[0] / L, dvec[1] / L, dvec[2] / L];
        const va = x.v[ia], vb = Ob ? x.v[ib] : 0;
        const Ldot = u[0] * (Oa.x[0] * va - (Ob ? Ob.x[0] * vb : 0)) + u[1] * (Oa.x[1] * va - (Ob ? Ob.x[1] * vb : 0)) + u[2] * (Oa.x[2] * va - (Ob ? Ob.x[2] * vb : 0));
        const F = -pr.k * (L - pr.L0 / 1000) - pr.c * Ldot;
        x.f[ia] += F * dot(u, Oa.x);
        if (Ob) x.f[ib] -= F * dot(u, Ob.x);
        x.pe += 0.5 * pr.k * (L - pr.L0 / 1000) ** 2;
        if (x.rec) x.loss += pr.c * Ldot * Ldot;
        this.st.set(sp.id, { len: L, force: -pr.k * (L - pr.L0 / 1000) });
      });
    }

    // elastic links: flexible / clutch / one-way couplings and backlash meshes
    for (const el of this.elastic) {
      const { link, info } = el;
      const ia = idxOf(el.a), ib = idxOf(el.b);
      const st = { T: 0, slip: 0 }; this.st.set(link.id, st);
      if (el.kind === 'coupling') {
        const s = el.s, pr = link;
        mk((x) => {
          const dlt = x.p[ia] - s * x.p[ib], dd = x.v[ia] - s * x.v[ib];
          let T = 0;
          if (pr.mode === 'flexible') { T = pr.k * dlt + pr.c * dd; x.pe += 0.5 * pr.k * dlt * dlt; if (x.rec) x.loss += pr.c * dd * dd; }
          else if (pr.mode === 'clutch') { T = pr.maxTorque * clamp(pr.engage, 0, 1) * sreg(dd, 0.2); if (x.rec) x.loss += Math.abs(T * dd); }
          else if (pr.mode === 'oneway') { const ku = Math.max(pr.k, 50); T = dlt > 0 ? ku * dlt + 0.05 * Math.sqrt(ku * 1e-4) * Math.max(dd, 0) : 0; x.pe += dlt > 0 ? 0.5 * ku * dlt * dlt : 0; }
          x.f[ia] -= T; x.f[ib] += s * T; st.T = T; st.slip = dd;
        });
      } else {
        const [[, ca], [, cb]] = el.coef;
        const A = byId(doc, link.a), B = byId(doc, link.b);
        const h = (link.backlash ?? 0) / 2000, kM = link.stiffness ?? 1e7;
        const Ja = this.bodies[ia].J, Jb = this.bodies[ib].J;
        const ma = Ja / Math.max(ca * ca, 1e-12), mb = Jb / Math.max(cb * cb, 1e-12), meff = (ma * mb) / (ma + mb + 1e-12), cM = 2 * 0.15 * Math.sqrt(kM * meff);
        void A; void B; void info;
        const eta = info.eff ?? 1;
        st.recv = ib;
        mk((x) => {
          const gp = ca * x.p[ia] + cb * x.p[ib], gv = ca * x.v[ia] + cb * x.v[ib];
          let F = 0;
          if (gp > h) F = kM * (gp - h) + cM * gv; else if (gp < -h) F = kM * (gp + h) + cM * gv;
          F = gp > h ? Math.max(F, 0) : gp < -h ? Math.min(F, 0) : 0;
          const ka = st.recv === ia ? eta : 1, kb = st.recv === ib ? eta : 1; // the receiving gear gets only η of the tooth force
          x.f[ia] -= F * ca * ka; x.f[ib] -= F * cb * kb; st.T = F; st.gap = gp;
          if (x.rec) x.loss += Math.abs(cM * gv * gv) * (F !== 0 ? 1 : 0) + Math.abs(F * (ca * (1 - ka) * x.v[ia] + cb * (1 - kb) * x.v[ib]));
          st.pa = -F * ca * x.v[ia]; st.pb = -F * cb * x.v[ib];
        });
      }
    }

    // gear / belt / screw losses on the power-receiving side (from the previous step's constraint force)
    this.rows.forEach((r, k) => {
      if (!(r.eff != null || r.kind === 'worm' || r.kind === 'screw')) return;
      mk((x) => {
        const lam = this.lam?.[k] ?? 0;
        if (Math.abs(lam) < 1e-12) return;
        let best = -1, bp = -Infinity;
        for (let i = 0; i < this.n; i++) { if (!r.c[i]) continue; const P = lam * r.c[i] * x.v[i]; if (P > bp) { bp = P; best = i; } }
        if (best < 0 || bp <= 0) return;
        let eta = r.eff ?? 1;
        if (r.kind === 'worm') eta = best === this.bodyOf.get(r.wheel) ? r.info.etaF : (r.info.etaR > 0 ? r.info.etaR : 0);
        // screw: driving the nut from the shaft is the "forward" direction
        if (r.kind === 'screw') eta = best === this.bodyOf.get(r.nut) ? r.info.etaF : (r.info.etaR > 0 ? r.info.etaR : 0);
        const loss = (eta <= 0 ? 1.3 : clamp(1 - eta, 0, 1)) * Math.abs(lam) * Math.abs(r.c[best]);
        const reg = this.bodies[best].kind === 'rot' ? (eta <= 0 ? 0.002 : 0.02) : (eta <= 0 ? 2e-5 : 2e-4);
        const f = -loss * sreg(x.v[best], reg);
        x.f[best] += f;
        if (x.rec) x.loss += -f * x.v[best];
      });
    });
  }

  addMotor(c, i, pr, mk) {
    const st = { i: 0, T: this.doc.tAmb ?? 20, integ: 0, tauExt: 0, tau: 0, Vin: 0, P: 0 }; this.st.set(c.id, st); this.motors.push(c);
    const Tamb = this.doc.tAmb ?? 20;
    mk((x) => {
      const w = x.v[i], Ke = pr.Kt, Rw = pr.R * (1 + 0.00393 * (st.T - 20));
      let tau = 0, cur = 0, V = 0;
      if (pr.mode === 'voltage') {
        V = pr.V * clamp(pr.duty, -1, 1);
        cur = pr.L > 0 ? st.i : (V - Ke * w) / Rw;
        tau = pr.Kt * cur - pr.tauNL * sreg(w, 0.5);
        if (x.rec) { x.supplied += V * cur; x.loss += cur * cur * Rw + pr.tauNL * sreg(w, 0.5) * w; }
      } else if (pr.mode === 'circuit') {
        tau = st.tauExt - pr.tauNL * sreg(w, 0.5); cur = st.tauExt / pr.Kt;
        if (x.rec) x.loss += pr.tauNL * sreg(w, 0.5) * w;
      } else if (pr.mode === 'servo') {
        const tgt = (pr.targetRpm * TWO_PI) / 60, e = tgt - w, u = pr.kp * e + pr.ki * st.integ;
        tau = clamp(u, -pr.maxTorque, pr.maxTorque) - pr.tauNL * sreg(w, 0.5); cur = tau / pr.Kt;
        if (x.rec) x.supplied += (tau + pr.tauNL * sreg(w, 0.5)) * w;
      } else { tau = pr.torqueCmd - pr.tauNL * sreg(w, 0.5); cur = pr.torqueCmd / pr.Kt; if (x.rec) x.supplied += pr.torqueCmd * w; }
      x.f[i] += tau;
      st.tau = tau; st.iNow = cur; st.Vin = V; st.Rw = Rw;
    });
    st.post = (dt, x) => {
      const w = x.v[i];
      if (pr.mode === 'voltage') {
        const V = pr.V * clamp(pr.duty, -1, 1), Rw = st.Rw ?? pr.R;
        if (pr.L > 0) st.i = (st.i + (dt / pr.L) * (V - pr.Kt * w)) / (1 + (dt * Rw) / pr.L); else st.i = (V - pr.Kt * w) / Rw;
        st.iNow = st.i;
      } else if (pr.mode === 'servo') {
        const e = (pr.targetRpm * TWO_PI) / 60 - w, u = pr.kp * e + pr.ki * st.integ;
        if (Math.abs(u) < pr.maxTorque || Math.sign(u) !== Math.sign(e)) st.integ += e * dt;
        st.i = st.iNow;
      } else st.i = st.iNow ?? 0;
      const Pheat = st.i * st.i * (st.Rw ?? pr.R);
      st.T += dt * (Pheat - (st.T - Tamb) / pr.Rth) / pr.Cth;
      st.P = Pheat;
    };
  }

  addGenerator(c, i, pr, mk) {
    const st = { i: 0, V: 0, P: 0 }; this.st.set(c.id, st); this.generators.push(c);
    mk((x) => {
      const w = x.v[i], emf = pr.Kt * w, Rt = pr.R + pr.loadR;
      const cur = pr.connected ? emf / Rt : 0, tau = -pr.Kt * cur;
      x.f[i] += tau; st.i = cur; st.V = cur * pr.loadR; st.P = cur * cur * pr.loadR;
      if (x.rec) x.loss += cur * cur * Rt;
    });
  }

  /* --------------------------------------------------------------- state */

  reset() {
    const { n, d, N, doc } = this;
    this.t = 0;
    this.q = new Float64Array(d); this.u = new Float64Array(d);
    this.p0 = new Float64Array(this.nt);
    const v0 = new Float64Array(n);
    this.bodies.forEach((b, i) => {
      if (b.part?.type === 'shaft') { this.p0[i] = (b.part.angle0 ?? 0) * Math.PI / 180; v0[i] = ((b.part.rpm0 ?? 0) * TWO_PI) / 60; }
      else if (b.kind === 'trans') this.p0[i] = (b.part.x0 ?? 0) / 1000;
    });
    // project the requested start velocities onto the constraint manifold (momentum-weighted)
    if (d > 0 && v0.some((x) => x)) {
      const A = Array.from({ length: d }, () => new Array(d).fill(0)), b = new Array(d).fill(0);
      for (let i = 0; i < n; i++) for (let a = 0; a < d; a++) { const ja = this.bodies[i].J * N[i][a]; b[a] += ja * v0[i]; for (let c = 0; c < d; c++) A[a][c] += ja * N[i][c]; }
      const u = solveDense(A, b, d);
      for (let a = 0; a < d; a++) this.u[a] = u[a];
    }
    for (const [id, st] of this.st) { Object.assign(st, { i: 0, integ: 0, tauExt: 0, T: doc.tAmb ?? 20, P: 0 }); void id; }
    this.lam = new Float64Array(this.rows.length);
    this.energy = { supplied: 0, loss: 0 };
    this.peaks = { omega: new Map(), lam: new Float64Array(this.rows.length), current: new Map(), temp: new Map(), coupling: new Map(), stroke: new Map(), contactMin: new Map() };
    this.stepCount = 0; this.jacAge = 1e9;
    this.evalPos(this.q);
    this.lastX = null;
  }

  /** Body positions/velocities from generalized coordinates, including dependent (cam/crank) sliders. */
  kin(q, u, x) {
    const { n, N, d } = this;
    for (let i = 0; i < n; i++) { let pp = this.p0[i], vv = 0; for (let a = 0; a < d; a++) { pp += N[i][a] * q[a]; vv += N[i][a] * u[a]; } x.p[i] = pp; x.v[i] = vv; }
    for (const lf of this.leaves) {
      const th = x.p[lf.driver], w = x.v[lf.driver], f = this.xform(lf, th);
      x.p[lf.idx] = f.y; x.v[lf.idx] = f.g * w; lf.cur = f;
    }
  }
  evalPos(q) { const x = { p: new Float64Array(this.nt), v: new Float64Array(this.nt) }; this.kin(q, this.u, x); this.pos = x.p; }

  xform(lf, th) {
    const { info } = lf;
    if (lf.link.type === 'crank') {
      const ang = th + info.phase - info.psi, r = info.r, l = info.l, s = Math.sin(ang), c = Math.cos(ang);
      const root = Math.sqrt(Math.max(l * l - r * r * s * s, 1e-12));
      const y = r * c + root, gg = -r * s - (r * r * s * c) / root;
      const h = 1e-5, a2 = ang + h, a1 = ang - h;
      const gAt = (a) => { const ss = Math.sin(a), cc = Math.cos(a), rt = Math.sqrt(Math.max(l * l - r * r * ss * ss, 1e-12)); return -r * ss - (r * r * ss * cc) / rt; };
      return { y, g: gg, gp: (gAt(a2) - gAt(a1)) / (2 * h) };
    }
    const cam = byId(this.doc, lf.link.a), beta = info.psi - th - info.phase, L = camLift(cam, beta);
    return { y: (cam.base + L.y) / 1000, g: -L.dy / 1000, gp: L.ddy / 1000 };
  }

  /** Generalized force F(q,u) = Nᵀf − C, with body forces returned in x.f. */
  evalF(q, u, rec) {
    const { n, d, N } = this;
    const x = this.W;
    x.f.fill(0); x.loss = 0; x.supplied = 0; x.pe = 0; x.rec = rec; x.t = this.t;
    this.kin(q, u, x);
    for (const el of this.els) el(x);
    const F = new Float64Array(d);
    for (const lf of this.leaves) { // move the follower/slider's force onto its driving shaft
      const f = lf.cur; if (rec) lf.fs = x.f[lf.idx];
      x.f[lf.driver] += f.g * x.f[lf.idx];
      const mass = lf.slider.__m, w = x.v[lf.driver];
      x.coriolis = (x.coriolis ?? 0);
      for (let a = 0; a < d; a++) F[a] -= mass * f.g * f.gp * w * w * N[lf.driver][a];
      x.f[lf.idx] = 0;
    }
    for (let a = 0; a < d; a++) { let s = 0; for (let i = 0; i < n; i++) s += N[i][a] * x.f[i]; F[a] += s; }
    return F;
  }

  massMatrix() {
    const { n, d, N } = this;
    const M = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < n; i++) { const J = this.bodies[i].J; if (!J) continue; for (let a = 0; a < d; a++) { const ja = J * N[i][a]; if (!ja) continue; for (let b = 0; b < d; b++) M[a][b] += ja * N[i][b]; } }
    for (const lf of this.leaves) {
      const mass = lf.slider.__m * lf.cur.g * lf.cur.g;
      for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) M[a][b] += mass * N[lf.driver][a] * N[lf.driver][b];
    }
    return M;
  }

  get W() { return this.work ?? (this.work = { p: new Float64Array(this.nt), v: new Float64Array(this.nt), f: new Float64Array(this.nt) }); }

  /* ---------------------------------------------------------------- step */

  step(dt) {
    const { d, N, n } = this;
    if (d === 0) { this.t += dt; return; }
    const GAMMA = 1 + 1 / Math.SQRT2;
    const q0 = Float64Array.from(this.q), u0 = Float64Array.from(this.u);
    const F0 = this.evalF(q0, u0, true);
    const fBody = Float64Array.from(this.work.f.subarray(0, n));
    this.energy.supplied += this.work.supplied * dt; this.energy.loss += this.work.loss * dt;
    this.pe = this.work.pe;
    const M0 = this.massMatrix();
    const leafSave = this.leaves.map((lf) => lf.cur);

    if (this.jacAge >= this.jacEvery || !this.Fq) {
      // Jacobian at the predicted end-of-step state, so a contact that is about to engage is already stiff in the linearisation
      const qj = this.jacEvery === 1 ? Float64Array.from(q0, (v, a) => v + dt * u0[a]) : q0;
      const Fj = this.jacEvery === 1 ? this.evalF(qj, u0, false) : F0;
      this.Fq = Array.from({ length: d }, () => new Float64Array(d)); this.Fu = Array.from({ length: d }, () => new Float64Array(d));
      for (let j = 0; j < d; j++) {
        const hq = 1e-6, hu = 1e-5 * (1 + Math.abs(u0[j]));
        const q = Float64Array.from(qj); q[j] += hq;
        const Fp = this.evalF(q, u0, false);
        const u = Float64Array.from(u0); u[j] += hu;
        const Fv = this.evalF(qj, u, false);
        for (let a = 0; a < d; a++) { this.Fq[a][j] = (Fp[a] - Fj[a]) / hq; this.Fu[a][j] = (Fv[a] - Fj[a]) / hu; }
      }
      this.jacAge = 0;
    }
    this.jacAge++;
    this.leaves.forEach((lf, i) => { lf.cur = leafSave[i]; });
    const gh = GAMMA * dt;
    const Ag = M0.map((r, a) => r.map((v, b) => v - gh * this.Fu[a][b] - gh * gh * this.Fq[a][b]));
    // ROS2 (Verwer): two stages sharing one matrix; second-order for any Jacobian approximation, L-stable
    const rhs1 = new Array(d);
    for (let a = 0; a < d; a++) { let s = F0[a]; for (let b = 0; b < d; b++) s += gh * this.Fq[a][b] * u0[b]; rhs1[a] = s; }
    const k1u = solveDense(Ag, rhs1, d), k1q = Array.from({ length: d }, (_, a) => u0[a] + gh * k1u[a]);
    const q2 = new Float64Array(d), u2 = new Float64Array(d);
    for (let a = 0; a < d; a++) { q2[a] = q0[a] + dt * k1q[a]; u2[a] = u0[a] + dt * k1u[a]; }
    const F1 = this.evalF(q2, u2, false);
    const M1 = this.massMatrix();
    const a1 = solveDense(M1, Array.from(F1), d);
    const r2q = Array.from({ length: d }, (_, a) => u2[a] - 2 * k1q[a]);
    const r2u = Array.from({ length: d }, (_, a) => a1[a] - 2 * k1u[a]);
    const rhs2 = new Array(d);
    for (let a = 0; a < d; a++) { let s = 0; for (let b = 0; b < d; b++) s += M0[a][b] * r2u[b] + gh * this.Fq[a][b] * r2q[b]; rhs2[a] = s; }
    const k2u = solveDense(Ag, rhs2, d), k2q = Array.from({ length: d }, (_, a) => r2q[a] + gh * k2u[a]);
    const du = new Float64Array(d);
    for (let a = 0; a < d; a++) {
      this.q[a] = q0[a] + dt * (1.5 * k1q[a] + 0.5 * k2q[a]);
      du[a] = dt * (1.5 * k1u[a] + 0.5 * k2u[a]);
      this.u[a] = u0[a] + du[a];
    }
    this.t += dt; this.stepCount++;

    // constraint reactions (used for gear losses, bearing loads and stress checks)
    if (this.rows.length) {
      const m = this.rows.length, acc = new Float64Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let a = 0; a < d; a++) s += N[i][a] * du[a]; acc[i] = s / dt; }
      const rhsL = new Array(m).fill(0), G = Array.from({ length: m }, () => new Array(m).fill(0));
      for (let k = 0; k < m; k++) {
        for (let i = 0; i < n; i++) rhsL[k] += this.C[k][i] * (this.bodies[i].J * acc[i] - fBody[i]);
        for (let l = 0; l < m; l++) { let s = 0; for (let i = 0; i < n; i++) s += this.C[k][i] * this.C[l][i]; G[k][l] = s + (k === l ? 1e-12 : 0); }
      }
      const lam = solveDense(G, rhsL, m);
      for (let k = 0; k < m; k++) { this.lam[k] = Number.isFinite(lam[k]) ? lam[k] : 0; this.peaks.lam[k] = Math.max(this.peaks.lam[k], Math.abs(this.lam[k])); }
    }
    // internal states, peaks
    const xf = this.work; this.kin(this.q, this.u, xf);
    for (const c of [...this.motors]) { const st = this.st.get(c.id); st.post(dt, xf); const pk = this.peaks; pk.current.set(c.id, Math.max(pk.current.get(c.id) ?? 0, Math.abs(st.i))); pk.temp.set(c.id, Math.max(pk.temp.get(c.id) ?? 0, st.T)); }
    for (const c of this.brakes) { const st = this.st.get(c.id); st.T += dt * (st.P / c.Cth - 0.05 * (st.T - (this.doc.tAmb ?? 20)) / c.Cth * 5); }
    for (const b of this.bodies) if (b.kind === 'rot' && !b.planet) { const i = this.bodyOf.get(b.id); const w = Math.abs(xf.v[i]); this.peaks.omega.set(b.id, Math.max(this.peaks.omega.get(b.id) ?? 0, w)); }
    this.elastic.forEach((el) => {
      const st = this.st.get(el.link.id); if (!st) return;
      this.peaks.coupling.set(el.link.id, Math.max(this.peaks.coupling.get(el.link.id) ?? 0, Math.abs(st.T)));
      if (el.kind === 'mesh' && Math.abs(st.T) > 1e-9 && st.pa !== undefined) st.recv = st.pa > st.pb ? this.bodyOf.get(el.a) : this.bodyOf.get(el.b);
    });
    for (const lf of this.leaves) if (lf.link.type === 'follower') { // contact force between cam and follower (must stay ≥ 0)
      let alpha = 0; for (let a = 0; a < d; a++) alpha += N[lf.driver][a] * du[a];
      alpha /= dt;
      const w = xf.v[lf.driver], accel = lf.cur.g * alpha + lf.cur.gp * w * w;
      const contact = lf.slider.__m * accel - (lf.fs ?? 0);
      this.peaks.contactMin.set(lf.link.id, Math.min(this.peaks.contactMin.get(lf.link.id) ?? Infinity, contact));
      lf.contact = contact;
    }
    if (!Number.isFinite(this.q[0])) this.diverged = true;
  }

  advance(seconds, dt = this.doc.dt ?? 2e-4, maxSteps = 4000) {
    if (this.jacEvery === 1 && this.elastic.some((e) => e.kind === 'mesh')) dt /= 4; // resolve tooth impacts
    const steps = Math.min(maxSteps, Math.max(1, Math.round(seconds / dt)));
    for (let i = 0; i < steps; i++) this.step(dt);
    return steps;
  }

  /* -------------------------------------------------- external interfaces */

  setControl(partId, key, value) { const c = this.ctrl.get(partId); if (c) c[key] = value; }
  /** Links (e.g. a clutch's engagement) are read straight from this Machine's own doc snapshot, not copied — mutate that directly. */
  setLinkControl(linkId, key, value) { const link = this.doc.links.find((l) => l.id === linkId); if (link) link[key] = value; }
  getControl(partId, key) { return this.ctrl.get(partId)?.[key]; }
  setMotorTorque(partId, tau) { const st = this.st.get(partId); if (st) st.tauExt = tau; }
  bodyIndex(id) { return this.bodyOf.get(id); }
  /** Shaft angle (rad) or slider position (m), always fresh. */
  position(id) { const i = this.bodyOf.get(id); if (i === undefined) return 0; const x = this.W; this.kin(this.q, this.u, x); return x.p[i]; }
  angle(id) { return this.position(id); }
  /** Shaft speed (rad/s) or slider speed (m/s). */
  speed(id) { const i = this.bodyOf.get(id); if (i === undefined) return 0; const x = this.W; this.kin(this.q, this.u, x); return x.v[i]; }

  /** Kinetic + potential energy (J). */
  energyState() {
    const x = this.W;
    this.evalF(this.q, this.u, false);
    let T = 0;
    for (let i = 0; i < this.n; i++) T += 0.5 * this.bodies[i].J * x.v[i] * x.v[i];
    for (const lf of this.leaves) T += 0.5 * lf.slider.__m * x.v[lf.idx] * x.v[lf.idx];
    return { kinetic: T, potential: x.pe, supplied: this.energy.supplied, loss: this.energy.loss };
  }

  /** Everything the UI, scope and lesson checks can look at. */
  readout() {
    const x = this.W;
    this.kin(this.q, this.u, x);
    const out = { time: this.t, dof: this.d, diverged: !!this.diverged };
    for (const b of this.bodies) {
      if (b.planet) continue;
      const i = this.bodyOf.get(b.id), name = b.part.name;
      if (b.kind === 'rot') { out[`${b.id}.rpm`] = (x.v[i] * 60) / TWO_PI; out[`${b.id}.angle`] = (x.p[i] * 180) / Math.PI; out[`${b.id}.omega`] = x.v[i]; out[`${b.id}.name`] = name; }
      else { out[`${b.id}.pos`] = x.p[i] * 1000; out[`${b.id}.vel`] = x.v[i] * 1000; out[`${b.id}.name`] = name; }
    }
    for (const lf of this.leaves) { out[`${lf.slider.id}.pos`] = x.p[lf.idx] * 1000; out[`${lf.slider.id}.vel`] = x.v[lf.idx] * 1000; }
    for (const c of this.motors) { const st = this.st.get(c.id); out[`${c.id}.current`] = st.i; out[`${c.id}.torque`] = st.tau; out[`${c.id}.temp`] = st.T; out[`${c.id}.power`] = st.tau * x.v[this.bodyOf.get(c.shaft)]; }
    for (const c of this.generators) { const st = this.st.get(c.id); out[`${c.id}.volts`] = st.V; out[`${c.id}.amps`] = st.i; out[`${c.id}.watts`] = st.P; }
    for (const c of this.props) { const st = this.st.get(c.id); if (c.type === 'propeller') { out[`${c.id}.thrust`] = st.thrust; } else { out[`${c.id}.cp`] = st.cp; out[`${c.id}.tsr`] = st.lambda; out[`${c.id}.power`] = st.power; } }
    for (const c of this.brakes) out[`${c.id}.temp`] = this.st.get(c.id).T;
    this.rows.forEach((r, k) => { if (r.link) out[`${r.link.id}.force`] = this.lam[k]; });
    for (const [id, st] of this.st) if (st.T !== undefined && st.slip !== undefined) out[`${id}.torque`] = st.T;
    const e = this.energyState();
    out['energy.kinetic'] = e.kinetic; out['energy.potential'] = e.potential; out['energy.supplied'] = e.supplied; out['energy.lost'] = e.loss;
    return out;
  }

  /** World pose inputs for rendering: shaft angles (rad) and slider positions (mm). */
  poses() {
    const x = this.W;
    this.kin(this.q, this.u, x);
    const shaft = {}, slider = {};
    for (const b of this.bodies) { if (b.planet) continue; const i = this.bodyOf.get(b.id); if (b.kind === 'rot') shaft[b.id] = x.p[i]; else slider[b.id] = x.p[i] * 1000; }
    for (const lf of this.leaves) slider[lf.slider.id] = x.p[lf.idx] * 1000;
    const planets = {};
    for (const pl of this.doc.parts.filter((p) => p.type === 'planetary')) { const i = this.bodyOf.get(`${pl.id}:planets`); if (i !== undefined) planets[pl.id] = x.p[i]; }
    return { shaft, slider, planets };
  }
}

export const isMachineDefined = defOf;
export { compAxis };
