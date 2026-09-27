import { D2R, add, axesOf, compose, cross, dot, len, lineLine, mul, norm, rotZ, scale, sub, trans } from './math3.js';
import * as K from './meshkit.js';
import { PART_TYPES, camLift, paramDefaults } from './catalog.js';
import { materialOf } from './materials.js';

let counter = 0;
export const mid = (prefix) => `${prefix}_${Date.now().toString(36).slice(-3)}${(counter++).toString(36)}`;

export function newAssembly(name = 'Untitled machine') {
  return { version: 1, name, gravity: 9.81, rho: 1.225, tAmb: 20, parts: [], links: [], systemLinks: [], meshes: {}, dt: 2e-4 };
}
export const cloneAssembly = (d) => structuredClone(d);
export const byId = (doc, id) => doc.parts.find((p) => p.id === id) ?? null;
export const linkById = (doc, id) => doc.links.find((l) => l.id === id) ?? null;
export const defOf = (p) => PART_TYPES[p.type];
export const isSliderLike = (p) => !!p && (PART_TYPES[p.type]?.slides || (p.type === 'custom' && p.attach === 'slider'));
export const isShaftMounted = (p) => !!p && (PART_TYPES[p.type]?.mount === 'shaft' || (p.type === 'custom' && p.attach === 'shaft'));

function nextName(doc, type) {
  const base = PART_TYPES[type].name.split(/[ /(]/)[0];
  let n = 1;
  const used = new Set(doc.parts.map((p) => p.name));
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function addPart(doc, type, over = {}) {
  const part = { id: mid(type), type, name: nextName(doc, type), x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, ...paramDefaults(type), ...over };
  doc.parts.push(part);
  return part;
}

export function removePart(doc, id) {
  const gone = new Set([id]);
  doc.parts = doc.parts.filter((p) => !gone.has(p.id));
  // removing a shaft also removes what rides on it
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of doc.parts) if (isShaftMounted(p) && p.shaft && gone.has(p.shaft)) { gone.add(p.id); changed = true; }
    doc.parts = doc.parts.filter((p) => !gone.has(p.id));
  }
  doc.links = doc.links.filter((l) => !gone.has(l.a) && !gone.has(l.b));
  doc.systemLinks = (doc.systemLinks ?? []).filter((l) => !gone.has(l.mechId));
  for (const p of doc.parts) for (const prm of PART_TYPES[p.type].params) if (prm.type === 'part' && gone.has(p[prm.key])) p[prm.key] = '';
}

/* ------------------------------------------------------------------- poses */

export const restMatrix = (p) => compose([p.x, p.y, p.z], [p.rx, p.ry, p.rz]);

/** World matrix of a shaft. `disp` (mm) is how far its carrier has travelled from the start position. */
export function shaftMatrix(doc, shaft, carrierDisp = 0) {
  const base = restMatrix(shaft);
  if (!shaft.carrier || !carrierDisp) return base;
  const carrier = byId(doc, shaft.carrier);
  if (!carrier) return base;
  const d = axesOf(restMatrix(carrier)).x;
  return mul(trans(d[0] * carrierDisp, d[1] * carrierDisp, d[2] * carrierDisp), base);
}

/** Matrix of a shaft-mounted component. theta is the shaft angle (rad). */
export function componentMatrix(doc, comp, theta = 0, carrierDisp = 0) {
  const shaft = byId(doc, comp.shaft);
  if (!shaft) return restMatrix(comp);
  return mul(mul(shaftMatrix(doc, shaft, carrierDisp), trans(0, 0, comp.axial ?? 0)), rotZ(theta + (comp.phase ?? 0) * D2R));
}

export function sliderMatrix(p, q = null) {
  const x = q == null ? (p.x0 ?? 0) : q;
  return mul(restMatrix(p), trans(x, 0, 0));
}

/** Axis frame of a shaft-mounted component at rest: centre of the component, shaft axes. */
export function compAxis(doc, comp) {
  const shaft = byId(doc, comp.shaft);
  if (!shaft) return null;
  const a = axesOf(restMatrix(shaft));
  const c = add(a.o, scale(a.z, comp.axial ?? 0));
  return { c, z: a.z, x: a.x, y: a.y, shaft };
}

/* ---------------------------------------------------------- custom parts */

const primMesh = (pr) => {
  let m;
  switch (pr.k) {
    case 'box': m = K.box(pr.w ?? 20, pr.h ?? 20, pr.d ?? 20); break;
    case 'cylinder': m = K.cylinder((pr.dia ?? 20) / 2, pr.h ?? 20, 40); break;
    case 'tube': m = K.tube((pr.dia ?? 30) / 2, (pr.inner ?? 20) / 2, pr.h ?? 10, 40); break;
    case 'sphere': m = K.sphere((pr.dia ?? 20) / 2, 32, 18); break;
    case 'cone': m = K.cone((pr.dia ?? 24) / 2, (pr.dia2 ?? 8) / 2, pr.h ?? 20, 40); break;
    case 'torus': m = K.torus((pr.dia ?? 40) / 2, (pr.tube ?? 6) / 2, 40, 18); break;
    case 'prism': m = K.regularPrism(Math.max(3, Math.round(pr.sides ?? 6)), (pr.dia ?? 24) / 2, pr.h ?? 10); break;
    default: m = K.box(10, 10, 10);
  }
  return K.transformMesh(m, compose([pr.x ?? 0, pr.y ?? 0, pr.z ?? 0], [pr.rx ?? 0, pr.ry ?? 0, pr.rz ?? 0]));
};

const memo = new Map();
const memoGet = (key, fn) => { if (memo.has(key)) return memo.get(key); const v = fn(); memo.set(key, v); if (memo.size > 300) memo.delete(memo.keys().next().value); return v; };

/** Mesh (mm, local frame, axis = +Z for rotating parts). */
export function partMesh(doc, p) {
  const def = PART_TYPES[p.type];
  if (p.type === 'custom') {
    if (p.meshRef && doc.meshes[p.meshRef]) return memoGet(`m:${p.meshRef}:${doc.meshes[p.meshRef].positions.length}`, () => doc.meshes[p.meshRef]);
    return memoGet(`c:${JSON.stringify(p.model ?? [])}`, () => K.merge((p.model ?? []).map(primMesh)));
  }
  if (!def.mesh) return null;
  const sig = { ...p }; for (const k of ['id', 'name', 'x', 'y', 'z', 'rx', 'ry', 'rz', 'shaft', 'axial', 'phase', 'target', 'a', 'b']) delete sig[k];
  return memoGet(`${p.type}:${JSON.stringify(sig)}`, () => def.mesh(p));
}

export function customProps(doc, p) {
  const mesh = partMesh(doc, p);
  if (!mesh || !mesh.positions.length) return { mass: 0, com: [0, 0, 0], Izz: 0, volume: 0 };
  const rho = materialOf(p.material).rho;
  const key = `mp:${p.meshRef ?? JSON.stringify(p.model)}:${rho}`;
  const mp = memoGet(key, () => K.massProps(mesh, rho));
  const k = p.massOverride > 0 && mp.mass > 0 ? p.massOverride / mp.mass : 1;
  return { mass: mp.mass * k, com: mp.com, Izz: mp.inertiaOrigin[2][2] * k, volume: mp.volume, inertia: mp.inertiaCom, bbox: K.bounds(mesh) };
}

export function partMass(doc, p) {
  if (p.type === 'custom') return customProps(doc, p).mass;
  const def = PART_TYPES[p.type];
  return def.mass ? def.mass(p) : 0;
}
export function partInertia(doc, p) {
  if (p.type === 'custom') return customProps(doc, p).Izz;
  const def = PART_TYPES[p.type];
  return def.inertia ? def.inertia(p) : 0;
}
/** Off-axis mass (kg, COM offset in m, in the shaft frame): drives gravity torque and imbalance. */
export function partEccentric(doc, p) {
  if (p.type === 'custom') { const cp = customProps(doc, p); return { m: cp.mass, cx: cp.com[0] / 1000, cy: cp.com[1] / 1000 }; }
  const def = PART_TYPES[p.type];
  return def.eccentric ? def.eccentric(p) : null;
}

export function addCustomFromPrimitives(doc, primitives, over = {}) {
  return addPart(doc, 'custom', { model: primitives, name: over.name ?? nextName(doc, 'custom'), ...over });
}
export function addCustomFromMesh(doc, mesh, over = {}) {
  const id = mid('mesh');
  doc.meshes[id] = { positions: Array.from(mesh.positions), indices: Array.from(mesh.indices) };
  return addPart(doc, 'custom', { meshRef: id, ...over });
}

/* ----------------------------------------------------------------- links */

const LINK_KINDS = {
  spur: 'Gear mesh', internal: 'Ring-gear mesh', bevel: 'Bevel mesh', worm: 'Worm mesh', rack: 'Rack & pinion', belt: 'Belt / chain',
  rope: 'Rope', screw: 'Lead screw', crank: 'Crank & rod', follower: 'Cam follower', coupling: 'Shaft coupling', wheel: 'Rolling wheel',
};
export const linkLabel = (l) => LINK_KINDS[l.type] ?? l.type;

const EFF = { spur: 0.98, internal: 0.97, bevel: 0.96, rack: 0.95 };
export const beltEff = (kind) => ({ flat: 0.96, v: 0.94, timing: 0.98, chain: 0.97 }[kind] ?? 0.95);

/** Work out which link a pair of parts should form (order-normalised) or explain why it can't. */
export function classifyPair(doc, a, b) {
  const ta = a.type, tb = b.type;
  const sl = (p) => isSliderLike(p);
  if (ta === 'gear' && tb === 'gear') return { type: (a.internal || b.internal) ? 'internal' : 'spur', a, b: (b.internal && !a.internal) || (!a.internal && !b.internal) ? b : a };
  if (ta === 'bevel' && tb === 'bevel') return { type: 'bevel', a, b };
  if ((ta === 'gear' && tb === 'rack') || (ta === 'rack' && tb === 'gear')) return { type: 'rack', a: ta === 'gear' ? a : b, b: ta === 'gear' ? b : a };
  if ((ta === 'worm' && tb === 'gear') || (ta === 'gear' && tb === 'worm')) return { type: 'worm', a: ta === 'worm' ? a : b, b: ta === 'worm' ? b : a };
  if (ta === 'pulley' && tb === 'pulley') return { type: 'belt', a, b };
  if ((ta === 'drum' && sl(b)) || (tb === 'drum' && sl(a))) return { type: 'rope', a: ta === 'drum' ? a : b, b: ta === 'drum' ? b : a };
  if ((ta === 'screw' && sl(b)) || (tb === 'screw' && sl(a))) return { type: 'screw', a: ta === 'screw' ? a : b, b: ta === 'screw' ? b : a };
  if ((ta === 'crank' && sl(b)) || (tb === 'crank' && sl(a))) return { type: 'crank', a: ta === 'crank' ? a : b, b: ta === 'crank' ? b : a };
  if ((ta === 'cam' && sl(b)) || (tb === 'cam' && sl(a))) return { type: 'follower', a: ta === 'cam' ? a : b, b: ta === 'cam' ? b : a };
  if (ta === 'shaft' && tb === 'shaft') return { type: 'coupling', a, b };
  if ((ta === 'wheel' && tb === 'vehicle') || (ta === 'vehicle' && tb === 'wheel')) return { type: 'wheel', a: ta === 'wheel' ? a : b, b: ta === 'wheel' ? b : a };
  return { error: `A ${PART_TYPES[ta].name.toLowerCase()} and a ${PART_TYPES[tb].name.toLowerCase()} can’t be connected directly.` };
}

export function connect(doc, aId, bId, opts = {}) {
  const A = byId(doc, aId), Bp = byId(doc, bId);
  if (!A || !Bp || A === Bp) return { error: 'Pick two different parts.' };
  const c = classifyPair(doc, A, Bp);
  if (c.error) return c;
  if (doc.links.some((l) => (l.a === c.a.id && l.b === c.b.id) || (l.a === c.b.id && l.b === c.a.id))) return { error: 'These two are already connected.' };
  const base = { id: mid('link'), type: c.type, a: c.a.id, b: c.b.id };
  const extra = {
    spur: { backlash: 0, auto: true }, internal: { backlash: 0, auto: true }, bevel: { backlash: 0, auto: true }, worm: { backlash: 0, auto: true }, rack: { backlash: 0, auto: true },
    belt: { crossed: false, tension: 40, mu: 0.3 }, rope: {}, screw: {}, crank: { rod: Math.round((c.a.throw ?? 25) * 4) }, follower: {}, wheel: {},
    coupling: { mode: 'rigid', k: 5, c: 0.02, maxTorque: 1, engage: 1 },
  }[c.type];
  const link = { ...base, ...extra, ...opts };
  doc.links.push(link);
  if (link.type === 'crank' || link.type === 'follower') snapSliderToAxis(doc, link);
  autoPhase(doc);
  return { link };
}

export function removeLink(doc, id) { doc.links = doc.links.filter((l) => l.id !== id); }

/** Put a crank/cam-driven slider's origin on the driving shaft's axis so displacement is measured from the centre. */
export function snapSliderToAxis(doc, link) {
  const drv = byId(doc, link.a), sl = byId(doc, link.b);
  const ax = compAxis(doc, drv);
  if (!ax || !sl) return;
  const d = axesOf(restMatrix(sl)).x;
  // slider line must pass through the shaft axis in the drive plane: move slider origin to axis centre
  sl.x = ax.c[0]; sl.y = ax.c[1]; sl.z = ax.c[2];
  sl.x0 = 0;
  void d;
}

/* ----------------------------------------------- link kinematics & checks */

export const gearR = (p) => (p.module * p.teeth) / 2; // pitch radius, mm

function levelIssue(list, level, msg) { list.push({ level, msg }); }

/**
 * Geometry + kinematics for one link. Returns
 *   { ok, issues[], sign, nominal, distance, ... }
 * `ok=false` means the parts do not actually engage, so the physics ignores the link.
 */
export function linkInfo(doc, link) {
  const A = byId(doc, link.a), Bp = byId(doc, link.b);
  const issues = [];
  const out = { ok: false, issues, type: link.type };
  if (!A || !Bp) { levelIssue(issues, 'error', 'A connected part was deleted.'); return out; }
  const t = link.type;

  if (t === 'spur' || t === 'internal') {
    const a = compAxis(doc, A), b = compAxis(doc, Bp);
    if (!a || !b) { levelIssue(issues, 'error', 'Mount both gears on shafts first.'); return out; }
    const s = dot(a.z, b.z);
    if (Math.abs(s) < 0.9995) { levelIssue(issues, 'error', 'Gear shafts are not parallel — spur gears need parallel axes.'); return out; }
    const off = sub(b.c, a.c), axial = dot(off, a.z);
    const dist = len(sub(off, scale(a.z, axial)));
    const ring = t === 'internal' ? (A.internal ? A : Bp) : null;
    const pin = ring ? (ring === A ? Bp : A) : null;
    const nominal = ring ? (A.module * (ring.teeth - pin.teeth)) / 2 : (A.module * (A.teeth + Bp.teeth)) / 2;
    Object.assign(out, { sign: s > 0 ? 1 : -1, nominal, distance: dist, ratio: A.teeth / Bp.teeth, ring: ring?.id });
    if (Math.abs(A.module - Bp.module) > 1e-6) levelIssue(issues, 'error', `Modules differ (${A.module} vs ${Bp.module}) — the teeth cannot mesh.`);
    if (Math.abs(A.pressure - Bp.pressure) > 0.5) levelIssue(issues, 'error', 'Pressure angles differ — the teeth cannot mesh.');
    if (t === 'internal' && (!ring || ring.teeth <= pin.teeth)) levelIssue(issues, 'error', 'A ring gear needs more teeth than the gear inside it.');
    const overlap = Math.min(A.width / 2, axial + Bp.width / 2) - Math.max(-A.width / 2, axial - Bp.width / 2);
    if (overlap < 0.3 * Math.min(A.width, Bp.width)) levelIssue(issues, 'error', `Gears barely overlap along the shaft (${Math.max(0, overlap).toFixed(1)} mm) — slide one along its shaft.`);
    const err = dist - nominal;
    if (Math.abs(err) > 0.12 * A.module) levelIssue(issues, 'error', `Centre distance is ${dist.toFixed(2)} mm but these gears mesh at ${nominal.toFixed(2)} mm (${err > 0 ? 'too far apart' : 'jammed together'}).`);
    else if (Math.abs(err) > 0.03 * A.module) levelIssue(issues, 'warn', `Centre distance is ${Math.abs(err).toFixed(2)} mm ${err > 0 ? 'wide (extra backlash)' : 'tight (binding)'}.`);
    out.ok = !issues.some((i) => i.level === 'error');
    out.radiusA = gearR(A) / 1000; out.radiusB = gearR(Bp) / 1000; out.eff = link.eff ?? EFF[t];
    return out;
  }

  if (t === 'bevel') {
    const a = compAxis(doc, A), b = compAxis(doc, Bp);
    if (!a || !b) { levelIssue(issues, 'error', 'Mount both bevel gears on shafts first.'); return out; }
    const ll = lineLine(a.c, a.z, b.c, b.z);
    if (Math.abs(dot(a.z, b.z)) > 0.02) levelIssue(issues, 'error', 'Bevel gear axes must be perpendicular (90°).');
    if (ll.parallel || ll.dist > 0.6) levelIssue(issues, 'error', `The shaft axes miss each other by ${ll.dist.toFixed(1)} mm — they must intersect at the cone apex.`);
    if (Math.abs(A.module - Bp.module) > 1e-6) levelIssue(issues, 'error', 'Modules differ — the teeth cannot mesh.');
    const apex = add(a.c, scale(a.z, ll.t1));
    const ta = dot(sub(a.c, apex), a.z), tb = dot(sub(b.c, apex), b.z);
    const ra = gearR(A), rb = gearR(Bp);
    if (Math.abs(Math.abs(ta) - rb) > 0.12 * A.module * 2 || Math.abs(Math.abs(tb) - ra) > 0.12 * A.module * 2) {
      levelIssue(issues, 'error', `Each bevel gear must sit at the other’s pitch radius from the apex (${rb.toFixed(1)} mm and ${ra.toFixed(1)} mm); they are ${Math.abs(ta).toFixed(1)} and ${Math.abs(tb).toFixed(1)} mm out.`);
    }
    Object.assign(out, { sa: ta >= 0 ? 1 : -1, sb: tb >= 0 ? 1 : -1, ratio: A.teeth / Bp.teeth, nominal: Math.hypot(ra, rb), distance: len(sub(b.c, a.c)), radiusA: ra / 1000, radiusB: rb / 1000 });
    out.ok = !issues.some((i) => i.level === 'error'); out.eff = link.eff ?? EFF.bevel;
    return out;
  }

  if (t === 'rack') {
    const a = compAxis(doc, A);
    if (!a) { levelIssue(issues, 'error', 'Mount the pinion on a shaft first.'); return out; }
    const r = axesOf(restMatrix(Bp));
    if (Math.abs(dot(a.z, r.z)) < 0.9995) levelIssue(issues, 'error', 'The pinion axis must be parallel to the rack’s Z axis (rotate the rack).');
    const off = sub(a.c, r.o), h = dot(off, r.y), rp = gearR(A);
    const err = h - rp;
    if (h <= 0) levelIssue(issues, 'error', 'The pinion is below the rack’s tooth face — move it above (rack teeth point +Y).');
    else if (Math.abs(err) > 0.12 * A.module) levelIssue(issues, 'error', `The pinion’s pitch circle is ${Math.abs(err).toFixed(2)} mm ${err > 0 ? 'off the rack' : 'inside the rack'}; the pitch line should touch it (distance ${rp.toFixed(2)} mm).`);
    const lateral = dot(off, r.z);
    if (Math.abs(lateral) > (Bp.width + A.width) / 2 * 0.7) levelIssue(issues, 'error', 'The pinion and rack do not overlap across their width.');
    if (Math.abs(A.module - Bp.module) > 1e-6) levelIssue(issues, 'error', 'Modules differ — the teeth cannot mesh.');
    const n = scale(r.y, -1);
    const sgn = dot(cross(a.z, n), r.x);
    Object.assign(out, { sign: sgn >= 0 ? 1 : -1, nominal: rp, distance: h, radiusA: rp / 1000 });
    out.ok = !issues.some((i) => i.level === 'error'); out.eff = link.eff ?? EFF.rack;
    return out;
  }

  if (t === 'worm') {
    const w = compAxis(doc, A), g = compAxis(doc, Bp);
    if (!w || !g) { levelIssue(issues, 'error', 'Mount the worm and the gear on shafts first.'); return out; }
    if (Math.abs(dot(w.z, g.z)) > 0.02) levelIssue(issues, 'error', 'The worm axis must be perpendicular to the gear axis.');
    const ll = lineLine(w.c, w.z, g.c, g.z), rg = gearR(Bp), rw = A.dia / 2, nominal = rg + rw;
    if (Math.abs(ll.dist - nominal) > 0.2) levelIssue(issues, ll.dist < nominal ? 'error' : 'error', `Worm and gear axes are ${ll.dist.toFixed(2)} mm apart but should be ${nominal.toFixed(2)} mm (worm radius + gear pitch radius).`);
    if (Math.abs(A.module - Bp.module) > 1e-6) levelIssue(issues, 'error', 'Modules differ — the teeth cannot mesh.');
    if (Math.abs(dot(sub(w.c, g.c), g.z)) > Bp.width / 2 + 2) levelIssue(issues, 'error', 'The worm is not in line with the gear face (slide it along the gear shaft axis).');
    let n = cross(g.z, w.z);
    if (len(n) < 1e-9) n = [1, 0, 0];
    n = norm(n);
    if (dot(sub(w.c, g.c), n) < 0) n = scale(n, -1);
    const sW = dot(cross(g.z, n), w.z) >= 0 ? 1 : -1;
    const lead = A.starts * Math.PI * A.module, lam = Math.atan(lead / (Math.PI * A.dia)), mu = A.mu, phi = 20 * D2R;
    const etaF = (Math.cos(phi) - mu * Math.tan(lam)) / (Math.cos(phi) + mu / Math.tan(lam));
    const etaR = (Math.cos(phi) - mu / Math.tan(lam)) / (Math.cos(phi) + mu * Math.tan(lam));
    Object.assign(out, { sign: sW * (A.hand === 'left' ? -1 : 1), starts: A.starts, ratio: A.starts / Bp.teeth, nominal, distance: ll.dist, lead, leadAngle: lam / D2R, etaF: Math.max(0.05, etaF), etaR, selfLocking: etaR <= 0 });
    out.ok = !issues.some((i) => i.level === 'error');
    return out;
  }

  if (t === 'belt') {
    const a = compAxis(doc, A), b = compAxis(doc, Bp);
    if (!a || !b) { levelIssue(issues, 'error', 'Mount both pulleys on shafts first.'); return out; }
    const s = dot(a.z, b.z);
    if (Math.abs(s) < 0.9995) levelIssue(issues, 'error', 'Pulley shafts must be parallel.');
    const off = sub(b.c, a.c), axial = dot(off, a.z), dist = len(sub(off, scale(a.z, axial)));
    const overlap = Math.min(A.width / 2, axial + Bp.width / 2) - Math.max(-A.width / 2, axial - Bp.width / 2);
    if (overlap < 0.5 * Math.min(A.width, Bp.width)) levelIssue(issues, 'error', 'The pulleys are not in the same plane — slide one along its shaft.');
    const ra = A.dia / 2, rb = Bp.dia / 2;
    if (dist < ra + rb + 2) levelIssue(issues, 'error', 'The pulleys touch or overlap — move them apart.');
    const gamma = Math.asin(Math.min(0.999, (rb - ra) / Math.max(dist, 1e-6)));
    const length = link.crossed ? 2 * Math.sqrt(dist * dist - (ra + rb) ** 2) + (ra + rb) * (Math.PI + 2 * Math.asin((ra + rb) / dist)) : 2 * dist * Math.cos(gamma) + ra * (Math.PI - 2 * gamma) + rb * (Math.PI + 2 * gamma);
    const wrapSmall = Math.PI - 2 * Math.abs(gamma);
    Object.assign(out, { sign: s > 0 ? 1 : -1, distance: dist, beltLength: length, wrapSmall, radiusA: ra / 1000, radiusB: rb / 1000, ratio: ra / rb });
    if (link.crossed) out.sign = -out.sign;
    const kind = A.kind === Bp.kind ? A.kind : A.kind;
    out.eff = link.eff ?? beltEff(kind);
    if ((A.kind === 'timing' || A.kind === 'chain') !== (Bp.kind === 'timing' || Bp.kind === 'chain')) levelIssue(issues, 'error', 'A toothed belt/chain needs toothed sprockets at both ends.');
    out.ok = !issues.some((i) => i.level === 'error');
    return out;
  }

  if (t === 'rope') {
    const a = compAxis(doc, A);
    if (!a) { levelIssue(issues, 'error', 'Mount the drum on a shaft first.'); return out; }
    const d = axesOf(restMatrix(Bp)).x, sl = axesOf(restMatrix(Bp)).o;
    if (Math.abs(dot(d, a.z)) > 0.02) levelIssue(issues, 'error', 'The rope’s direction must be perpendicular to the drum axis.');
    const off = sub(sl, a.c);
    let n = sub(off, add(scale(a.z, dot(off, a.z)), scale(d, dot(off, d))));
    const lateral = len(n);
    n = lateral > 1e-9 ? scale(n, 1 / lateral) : cross(a.z, d);
    const R = A.dia / 2;
    if (Math.abs(lateral - R) > 4) levelIssue(issues, 'warn', `The rope line is ${lateral.toFixed(1)} mm from the drum axis; the drum radius is ${R.toFixed(1)} mm (the rope should leave tangentially).`);
    const sgn = dot(cross(a.z, n), d);
    Object.assign(out, { sign: sgn >= 0 ? 1 : -1, radiusA: R / 1000, nominal: R, distance: lateral, n, attach: add(a.c, scale(n, R)) });
    out.ok = !issues.some((i) => i.level === 'error'); out.eff = 1;
    return out;
  }

  if (t === 'screw') {
    const a = compAxis(doc, A);
    if (!a) { levelIssue(issues, 'error', 'Mount the lead screw on a shaft first.'); return out; }
    const sl = axesOf(restMatrix(Bp)), d = sl.x;
    if (Math.abs(dot(d, a.z)) < 0.999) levelIssue(issues, 'error', 'The nut must slide along the screw axis (rotate the slider).');
    const off = sub(sl.o, a.c), perp = len(sub(off, scale(a.z, dot(off, a.z))));
    if (perp > 3) levelIssue(issues, 'warn', `The nut is ${perp.toFixed(1)} mm off the screw axis.`);
    const lam = Math.atan(A.lead / (Math.PI * A.dia)), mu = A.mu, phi = 14.5 * D2R;
    const etaF = (Math.cos(phi) - mu * Math.tan(lam)) / (Math.cos(phi) + mu / Math.tan(lam));
    const etaR = (Math.cos(phi) - mu / Math.tan(lam)) / (Math.cos(phi) + mu * Math.tan(lam));
    Object.assign(out, { sign: (dot(a.z, d) > 0 ? 1 : -1) * (A.hand === 'left' ? -1 : 1), lead: A.lead, etaF: Math.max(0.05, etaF), etaR, selfLocking: etaR <= 0, leadAngle: lam / D2R });
    out.ok = !issues.some((i) => i.level === 'error');
    return out;
  }

  if (t === 'crank' || t === 'follower') {
    const a = compAxis(doc, A);
    if (!a) { levelIssue(issues, 'error', 'Mount the crank / cam on a shaft first.'); return out; }
    const d = axesOf(restMatrix(Bp)).x;
    if (Math.abs(dot(d, a.z)) > 0.02) levelIssue(issues, 'error', 'The slider must move in the plane of rotation (perpendicular to the shaft).');
    const psi = Math.atan2(dot(d, a.y), dot(d, a.x));
    const off = sub(axesOf(restMatrix(Bp)).o, a.c);
    if (len(off) > 1) levelIssue(issues, 'warn', 'The slider’s line is not through the shaft axis — use “Snap slider to shaft”.');
    Object.assign(out, { psi });
    if (t === 'crank') {
      const r = A.throw, l = link.rod;
      if (l <= r * 1.05) levelIssue(issues, 'error', `The rod (${l} mm) must be longer than the crank throw (${r} mm).`);
      Object.assign(out, { r: r / 1000, l: l / 1000, phase: A.phase * D2R });
    } else Object.assign(out, { phase: A.phase * D2R });
    out.ok = !issues.some((i) => i.level === 'error'); out.eff = 1;
    return out;
  }

  if (t === 'coupling') {
    const a = axesOf(restMatrix(A)), b = axesOf(restMatrix(Bp));
    const ll = lineLine(a.o, a.z, b.o, b.z);
    if (Math.abs(dot(a.z, b.z)) < 0.9995 || ll.dist > 0.6) levelIssue(issues, 'error', 'Coupled shafts must be on the same axis (collinear).');
    Object.assign(out, { sign: dot(a.z, b.z) > 0 ? 1 : -1 });
    out.ok = !issues.some((i) => i.level === 'error');
    return out;
  }

  if (t === 'wheel') {
    const a = compAxis(doc, A);
    if (!a) { levelIssue(issues, 'error', 'Mount the wheel on a shaft first.'); return out; }
    const d = axesOf(restMatrix(Bp)).x, n = [0, -1, 0];
    if (Math.abs(dot(d, a.z)) > 0.05) levelIssue(issues, 'error', 'The wheel axle must be perpendicular to the direction of travel.');
    const sh = byId(doc, A.shaft);
    if (sh && sh.carrier !== Bp.id) levelIssue(issues, 'warn', 'The wheel’s shaft should ride on this vehicle (set the shaft’s “Rides on”).');
    Object.assign(out, { sign: -dot(cross(a.z, n), d) >= 0 ? 1 : -1, radius: A.dia / 2000, mu: A.mu, crr: A.crr });
    out.ok = !issues.some((i) => i.level === 'error'); out.eff = 1;
    return out;
  }
  levelIssue(issues, 'error', 'Unknown link.');
  return out;
}

/* ------------------------------------------- automatic tooth alignment */

const frac = (v) => v - Math.floor(v);

function toothDir(doc, gear, theta0 = 0) {
  const ax = compAxis(doc, gear);
  const ang = (theta0 + (gear.phase ?? 0)) * (Math.PI / 180);
  return { ax, u: add(scale(ax.x, Math.cos(ang)), scale(ax.y, Math.sin(ang))) };
}
const angleAbout = (axis, from, to) => Math.atan2(dot(axis, cross(from, to)), dot(from, to));

/** Rotate the driven gear (and shift racks) so teeth interlock instead of colliding. */
export function autoPhase(doc) {
  for (const link of doc.links) {
    if (link.auto === false) continue;
    if (link.type === 'spur' || link.type === 'internal') {
      const info = linkInfo(doc, link);
      if (!info.ok) continue;
      const A = byId(doc, link.a), Bp = byId(doc, link.b);
      const shA = byId(doc, A.shaft), shB = byId(doc, Bp.shaft);
      const a = toothDir(doc, A, (shA.angle0 ?? 0)), b = toothDir(doc, Bp, (shB.angle0 ?? 0));
      let phiHat = norm(sub(b.ax.c, a.ax.c));
      phiHat = norm(sub(phiHat, scale(a.ax.z, dot(phiHat, a.ax.z))));
      const za = a.ax.z;
      const external = link.type === 'spur';
      // external: contact is on the line of centres, seen from A along +φ and from B along −φ.
      // internal: the pinion touches the ring on the side away from the ring centre, so both look along −φ.
      const toA = external ? phiHat : scale(phiHat, -1);
      const toB = scale(phiHat, -1);
      const fA = frac((A.teeth * angleAbout(za, a.u, toA)) / (2 * Math.PI));
      const fB = frac((Bp.teeth * angleAbout(za, b.u, toB)) / (2 * Math.PI));
      // A tooth meets an external partner's gap (½ turn apart); a ring's local reference is its gap, so its tooth phase is measured from a gap (0)
      const need = external ? frac(0.5 - fA - fB) : frac(fA - fB);
      const s = info.sign;
      const dphi = (-s * 2 * Math.PI * need) / Bp.teeth;
      Bp.phase = Math.round(((Bp.phase ?? 0) + dphi / D2R) * 1000) / 1000;
    } else if (link.type === 'rack') {
      const info = linkInfo(doc, link);
      if (!info.ok) continue;
      const A = byId(doc, link.a), R = byId(doc, link.b);
      const sh = byId(doc, A.shaft), a = toothDir(doc, A, sh.angle0 ?? 0);
      const r = axesOf(restMatrix(R)), n = scale(r.y, -1);
      const fA = frac((A.teeth * angleAbout(a.ax.z, a.u, n)) / (2 * Math.PI));
      const p = Math.PI * R.module, nT = Math.max(1, Math.floor(R.length / p)), c0 = -(nT * p) / 2 + p / 2;
      const sc = dot(sub(a.ax.c, r.o), r.x);
      const fR = frac((sc - (R.x0 ?? 0) - c0) / p);
      const target = info.sign > 0 ? frac(fA - 0.5) : frac(0.5 - fA);
      const dx = -p * frac(target - fR);
      R.x0 = Math.round(((R.x0 ?? 0) + dx) * 1000) / 1000;
    }
  }
}

/** Move the driven shaft (b) along the line of centres so the gears sit at exactly the right distance. */
export function snapToMesh(doc, linkId) {
  const link = linkById(doc, linkId);
  if (!link) return false;
  if (link.type === 'spur' || link.type === 'internal' || link.type === 'worm') {
    const A = byId(doc, link.a), Bp = byId(doc, link.b);
    const a = compAxis(doc, A), b = compAxis(doc, Bp);
    if (!a || !b) return false;
    const sh = byId(doc, Bp.shaft);
    const info = linkInfo(doc, link);
    const nominal = link.type === 'worm' ? gearR(Bp) + A.dia / 2 : info.nominal;
    if (nominal == null) return false;
    let dir = sub(b.c, a.c);
    if (link.type !== 'worm') dir = sub(dir, scale(a.z, dot(dir, a.z)));
    if (len(dir) < 1e-6) dir = [1, 0, 0];
    dir = norm(dir);
    if (link.type === 'worm') { // move the worm, keep the gear
      const wsh = byId(doc, A.shaft), ash = compAxis(doc, Bp);
      let n = cross(ash.z, a.z); n = norm(len(n) < 1e-9 ? [1, 0, 0] : n);
      if (dot(sub(a.c, ash.c), n) < 0) n = scale(n, -1);
      const target = add(ash.c, scale(n, nominal));
      const delta = sub(target, a.c);
      wsh.x += delta[0]; wsh.y += delta[1]; wsh.z += delta[2];
    } else {
      const target = add(a.c, scale(dir, nominal));
      const delta = sub(target, b.c);
      sh.x += delta[0]; sh.y += delta[1]; sh.z += delta[2];
    }
    autoPhase(doc);
    return true;
  }
  if (link.type === 'rack') {
    const A = byId(doc, link.a), R = byId(doc, link.b), r = axesOf(restMatrix(R));
    const a = compAxis(doc, A);
    const h = dot(sub(a.c, r.o), r.y), delta = gearR(A) - h;
    R.x -= r.y[0] * delta; R.y -= r.y[1] * delta; R.z -= r.y[2] * delta;
    autoPhase(doc);
    return true;
  }
  if (link.type === 'crank' || link.type === 'follower') { snapSliderToAxis(doc, link); return true; }
  return false;
}

export { camLift };
