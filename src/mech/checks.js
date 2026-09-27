import { PART_TYPES } from './catalog.js';
import { byId, customProps, gearR, isShaftMounted, partMass } from './assembly.js';
import { materialOf } from './materials.js';

/**
 * "Mechanical Check": what an engineer would flag on this design.
 * Static rules look only at the geometry; dynamic rules use the peak loads the simulation has seen.
 * Returns { issues, report } — issues are plain-language warnings, report is a table of numbers with limits.
 */
const PI = Math.PI;
const SF_GEAR = 2.0, SF_SHAFT = 2.0, SF_ROTOR = 2.0;

export function mechChecks(doc, machine) {
  const issues = [], report = [];
  const add = (level, rule, part, title, detail, extra = {}) => issues.push({ id: `${rule}:${part?.id ?? extra.linkId ?? 'sys'}`, level, rule, partId: part?.id ?? null, title, detail, ...extra });
  const row = (part, label, value, limit, unit, note = '') => report.push({ partId: part.id, label, value, limit, unit, util: limit > 0 ? value / limit : 0, note });
  const parts = doc.parts;

  // ---- structure ----------------------------------------------------------
  for (const p of parts) {
    const def = PART_TYPES[p.type];
    if ((def.mount === 'shaft' || (p.type === 'custom' && p.attach === 'shaft')) && !byId(doc, p.shaft)) {
      add('error', 'unmounted', p, `${p.name} is not on a shaft`, 'Set “On shaft” in the properties — a rotating part needs a shaft to spin on.');
    }
    if (p.type === 'gear' && p.teeth < 17 && !p.internal) add('info', 'undercut', p, `${p.name} has only ${p.teeth} teeth`, 'Below about 17 teeth a 20° involute gear is undercut at the root and gets weak. Use more teeth or a larger module.');
    if (p.type === 'planetary') {
      const missing = ['sun', 'carrier', 'ring'].filter((k) => !byId(doc, p[k]));
      if (missing.length) add('error', 'planetary-unmounted', p, `${p.name} is missing its ${missing.join(', ')} shaft${missing.length > 1 ? 's' : ''}`, 'Set the sun, carrier and ring shafts in the properties — the gearset does nothing until all three are assigned.');
      if ((p.zr - p.zs) % 2) add('error', 'planet-odd', p, 'Ring and sun teeth must differ by an even number', `The planet has (zr − zs)/2 = ${(p.zr - p.zs) / 2} teeth; make zr − zs even.`);
      if (p.zr <= p.zs + 8) add('error', 'planet-small', p, 'The ring is too small for planets', 'Planets need at least 4 teeth: keep zr ≥ zs + 8.');
      if ((p.zs + p.zr) % p.planets) add('info', 'planet-assembly', p, 'Planets will not space evenly', 'For equally-spaced planets, (zs + zr) should be divisible by the number of planets.');
    }
    if (p.type === 'differential') {
      const missing = ['cage', 'left', 'right'].filter((k) => !byId(doc, p[k]));
      if (missing.length) add('error', 'diff-unmounted', p, `${p.name} is missing its ${missing.join(', ')} shaft${missing.length > 1 ? 's' : ''}`, 'Set the cage, left axle and right axle shafts in the properties — the differential does nothing until all three are assigned.');
    }
  }
  for (const { link, info } of machine.linkInfos) {
    for (const i of info.issues) if (i.level === 'warn') add('warn', 'link-warn', byId(doc, link.a), i.msg, 'Use “Snap to mesh” on the connection, or move the part.', { linkId: link.id });
  }
  for (const i of machine.issues) add(i.level, i.rule, i.partId ? byId(doc, i.partId) : null, i.title, i.detail, { linkId: i.linkId });
  if (!parts.some((p) => p.type === 'motor' || p.type === 'handcrank' || p.type === 'windrotor' || (p.type === 'load' && p.kind === 'source') || p.type === 'weight' || p.type === 'propeller')) {
    add('info', 'no-source', null, 'Nothing drives this machine', 'Add a motor, hand crank, wind rotor or weight — or give a shaft a starting speed.');
  }

  // ---- shafts: critical speed and torsion --------------------------------
  for (const sh of parts.filter((p) => p.type === 'shaft')) {
    const mat = materialOf(sh.material), L = sh.length / 1000, I = (PI * (sh.dia / 1000) ** 4) / 64, E = mat.E * 1e9;
    const mounted = parts.filter((c) => isShaftMounted(c) && c.shaft === sh.id);
    let inv = 0;
    const wShaft = ((PI / L) ** 2) * Math.sqrt((E * I) / (mat.rho * PI * (sh.dia / 2000) ** 2));
    inv += 1 / (wShaft * wShaft);
    for (const c of mounted) {
      const m = partMass(doc, c);
      if (m <= 0) continue;
      const a = Math.min(Math.max(L / 2 + (c.axial ?? 0) / 1000, 0.05 * L), 0.95 * L), b = L - a;
      const delta = (m * 9.81 * a * a * b * b) / (3 * E * I * L);
      inv += delta / 9.81;
    }
    const wCrit = Math.sqrt(1 / inv), nCrit = (wCrit * 60) / (2 * PI);
    const w = Math.max(machine.peaks.omega.get(sh.id) ?? 0, Math.abs(((sh.rpm0 ?? 0) * 2 * PI) / 60));
    const n = (w * 60) / (2 * PI);
    if (n > 1) row(sh, `${sh.name}: speed vs critical speed`, n, 0.7 * nCrit, 'rpm', `first critical speed ≈ ${nCrit.toFixed(0)} rpm`);
    if (n > 0.95 * nCrit) add('error', 'critical', sh, `${sh.name} is running at its critical speed`, `The shaft whirls violently near ${nCrit.toFixed(0)} rpm (simply supported, Dunkerley). Make it thicker, shorter, or run slower.`);
    else if (n > 0.7 * nCrit) add('warn', 'critical', sh, `${sh.name} is close to its critical speed`, `First critical speed ≈ ${nCrit.toFixed(0)} rpm; you are at ${n.toFixed(0)} rpm. Keep below 70%.`);

    // torque through the shaft
    let T = 0;
    machine.rows.forEach((r, k) => { if (r.bodies?.includes(sh.id)) T = Math.max(T, Math.abs(machine.peaks.lam[k]) * Math.abs(r.c[machine.bodyOf.get(sh.id)])); });
    for (const m of machine.motors) if (m.shaft === sh.id) T = Math.max(T, (machine.peaks.current.get(m.id) ?? 0) * m.Kt);
    if (T > 0) {
      const tau = (16 * T) / (PI * (sh.dia / 1000) ** 3) / 1e6, allow = (0.577 * mat.yield) / SF_SHAFT;
      row(sh, `${sh.name}: torsional shear (${T.toFixed(3)} N·m)`, tau, allow, 'MPa');
      if (tau > allow) add('error', 'shaft-shear', sh, `${sh.name} is overstressed in torsion`, `Peak torque ${T.toFixed(2)} N·m gives ${tau.toFixed(0)} MPa shear (allowed ${allow.toFixed(0)} MPa). Use a thicker shaft or stronger material.`);
      else if (tau > 0.7 * allow) add('warn', 'shaft-shear', sh, `${sh.name} is highly stressed in torsion`, `${tau.toFixed(0)} MPa of ${allow.toFixed(0)} MPa allowed.`);
    }
  }

  // ---- gears: Lewis bending stress and pitch-line speed -------------------
  machine.rows.forEach((r, k) => {
    if (r.kind !== 'mesh' || !r.link) return;
    const A = byId(doc, r.link.a), B = byId(doc, r.link.b);
    const W = machine.peaks.lam[k];
    for (const g of [A, B]) {
      if (!g || g.type !== 'gear' && g.type !== 'bevel') continue;
      const mat = materialOf(g.material), Y = Math.max(0.05, 0.154 - 0.912 / g.teeth), sigma = W / (g.width * g.module * Y);
      const allow = mat.yield / SF_GEAR;
      if (W > 0) row(g, `${g.name}: tooth bending (${W.toFixed(1)} N)`, sigma, allow, 'MPa');
      if (sigma > allow) add('error', 'tooth-bend', g, `${g.name} teeth would break`, `Peak tooth load ${W.toFixed(0)} N gives ${sigma.toFixed(0)} MPa (allowed ${allow.toFixed(0)} MPa for ${mat.name}). Use a wider face, larger module, or stronger material.`);
      else if (sigma > 0.7 * allow) add('warn', 'tooth-bend', g, `${g.name} teeth are heavily loaded`, `${sigma.toFixed(0)} of ${allow.toFixed(0)} MPa allowed.`);
      const v = Math.abs((machine.peaks.omega.get(g.shaft) ?? 0)) * gearR(g) / 1000;
      if (v > 25) add('warn', 'pitch-speed', g, `${g.name} pitch-line speed is ${v.toFixed(0)} m/s`, 'Above about 25 m/s ordinary spur gears are noisy and need precision manufacture and lubrication.');
    }
  });

  // ---- belts ---------------------------------------------------------------
  machine.rows.forEach((r, k) => {
    if (r.kind !== 'belt') return;
    const info = r.info, A = byId(doc, r.link.a);
    const mu = r.link.mu ?? 0.3, vb = A.kind === 'v' ? mu / Math.sin((19 * PI) / 180) : mu, e = Math.exp(vb * info.wrapSmall);
    const cap = A.kind === 'timing' || A.kind === 'chain' ? Infinity : (2 * (r.link.tension ?? 40) * (e - 1)) / (e + 1);
    const F = machine.peaks.lam[k];
    if (Number.isFinite(cap)) { row(A, `${A.name}: belt force vs friction capacity`, F, cap, 'N'); if (F > cap) add('error', 'belt-slip', A, 'The belt would slip', `Peak belt pull ${F.toFixed(0)} N exceeds what ${r.link.tension ?? 40} N of tension can grip (${cap.toFixed(0)} N). Increase tension, wrap angle or use a timing belt.`, { linkId: r.link.id }); }
  });

  // ---- rotors: burst speed --------------------------------------------------
  for (const c of parts.filter((p) => isShaftMounted(p) && (p.type === 'flywheel' || p.type === 'custom' || p.type === 'pulley' || p.type === 'gear' || p.type === 'brake'))) {
    const sh = byId(doc, c.shaft), w = machine.peaks.omega.get(c.shaft) ?? 0;
    if (!sh || w < 1) continue;
    const mat = materialOf(c.material), nu = mat.nu;
    let ro, ri = 0;
    if (c.type === 'flywheel') { ro = c.dia / 2000; ri = Math.max(c.inner, c.bore) / 2000; }
    else if (c.type === 'custom') { const bb = customProps(doc, c).bbox; if (!bb) continue; ro = Math.max(Math.abs(bb.lo[0]), Math.abs(bb.hi[0]), Math.abs(bb.lo[1]), Math.abs(bb.hi[1])) / 1000; }
    else continue;
    const sigma = (ri > 0 ? ((3 + nu) / 4) * (ro * ro + ((1 - nu) / (3 + nu)) * ri * ri) : ((3 + nu) / 8) * ro * ro) * mat.rho * w * w / 1e6;
    const allow = mat.yield / SF_ROTOR;
    row(c, `${c.name}: rim stress at ${((w * 60) / (2 * PI)).toFixed(0)} rpm`, sigma, allow, 'MPa');
    if (sigma > allow) {
      const wBurst = Math.sqrt((mat.yield * 1e6) / (mat.rho * ((ri > 0 ? ((3 + nu) / 4) * (ro * ro + ((1 - nu) / (3 + nu)) * ri * ri) : ((3 + nu) / 8) * ro * ro))));
      add('error', 'burst', c, `${c.name} would fly apart`, `Centrifugal stress ${sigma.toFixed(0)} MPa exceeds the allowable ${allow.toFixed(0)} MPa for ${mat.name}; it yields at about ${((wBurst * 60) / (2 * PI)).toFixed(0)} rpm. Reduce speed or radius, or use a stronger material.`);
    } else if (sigma > 0.7 * allow) add('warn', 'burst', c, `${c.name} is spinning near its strength limit`, `${sigma.toFixed(0)} of ${allow.toFixed(0)} MPa allowed.`);
  }

  // ---- motors, brakes ---------------------------------------------------------
  for (const m of machine.motors) {
    const I = machine.peaks.current.get(m.id) ?? 0, T = machine.peaks.temp.get(m.id) ?? 20;
    if (m.mode === 'voltage' || m.mode === 'circuit') row(m, `${m.name}: peak current`, I, m.ratedI, 'A');
    if (m.mode === 'voltage' && I > 1.5 * m.ratedI) add('warn', 'overload', m, `${m.name} is drawing ${I.toFixed(1)} A`, `That is ${(I / m.ratedI).toFixed(1)}× its ${m.ratedI} A rating. Gear it down or reduce the load.`);
    if (T > 155) add('error', 'motor-hot', m, `${m.name} has burnt out`, `The winding reached ${T.toFixed(0)} °C (insulation limit ≈ 155 °C). It cannot run this hard for this long.`);
    else if (T > 100) add('warn', 'motor-hot', m, `${m.name} is running hot (${T.toFixed(0)} °C)`, 'Winding resistance rises as it heats, which reduces torque.');
  }
  for (const b of machine.brakes) { const T = machine.st.get(b.id)?.T ?? 20; if (T > 300) add('warn', 'brake-hot', b, `${b.name} is overheating`, `Disc at ${T.toFixed(0)} °C: brake fade. Use a bigger disc or brake less.`); }

  // ---- cam followers and vehicles ---------------------------------------------
  for (const lf of machine.leaves) {
    if (lf.link.type !== 'follower') continue;
    const cm = machine.peaks.contactMin.get(lf.link.id);
    if (cm !== undefined && cm < -0.01) add('warn', 'follower-float', byId(doc, lf.link.a), 'The follower loses contact with the cam', `The cam needed to pull the follower (${cm.toFixed(2)} N) — that is “valve float”. Use a stiffer or more preloaded return spring, or slow the cam.`, { linkId: lf.link.id });
  }
  machine.rows.forEach((r, k) => {
    if (r.kind !== 'wheel') return;
    const veh = byId(doc, r.link.b), wheels = machine.linkInfos.filter((x) => x.link.type === 'wheel' && x.link.b === veh.id).length || 1;
    const N = ((veh.mass + 0) * 9.81) / wheels, mu = r.info.mu, F = machine.peaks.lam[k];
    row(byId(doc, r.link.a), 'Tyre traction vs grip', F, mu * N, 'N');
    if (F > mu * N) add('warn', 'wheelspin', byId(doc, r.link.a), 'The wheels would spin', `Driving force ${F.toFixed(1)} N exceeds the grip limit μ·N = ${(mu * N).toFixed(1)} N per wheel. Add weight, use grippier tyres, or accelerate gently. (The simulation assumes perfect grip.)`, { linkId: r.link.id });
  });

  const order = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return { issues, report };
}
