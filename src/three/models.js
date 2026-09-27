import * as THREE from 'three';
import { CATALOG, G, LED_COLORS } from '../lib/catalog.js';
import { resistorBands, formatValue } from '../lib/units.js';
import { BOARD, ROW_LETTERS, COLS, BreadBaiHoles } from '../lib/board.js';

// ---------------------------------------------------------------- primitives

const roundedRect = (w, d, r) => {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
};

/** A box with softened edges, sitting with its base on y = 0. */
export function slab(w, h, d, r = 0.6, bevel = 0.25) {
  const geo = new THREE.ExtrudeGeometry(roundedRect(w, d, Math.min(r, Math.min(w, d) / 2 - 0.01)), {
    depth: Math.max(h - bevel * 2, 0.01), bevelEnabled: true, bevelSize: bevel,
    bevelThickness: bevel, bevelSegments: 2, curveSegments: 8,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(-(bb.max.x + bb.min.x) / 2, -bb.min.y, -(bb.max.z + bb.min.z) / 2);
  return geo;
}

const M = {
  metal: () => new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.95, roughness: 0.28 }),
  tin: () => new THREE.MeshStandardMaterial({ color: 0xbfc6cc, metalness: 0.9, roughness: 0.36 }),
  copper: () => new THREE.MeshStandardMaterial({ color: 0xd08c4a, metalness: 0.9, roughness: 0.35 }),
  plastic: (c, rough = 0.5) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.02 }),
  matte: (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0 }),
};

/** Straight length of wire between two points. */
function lead(a, b, radius = 0.32, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, 10);
  const mesh = new THREE.Mesh(geo, material ?? M.tin());
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** Bent axial lead: down from the body, across, then into the hole. */
function axialLead(group, bodyX, bodyY, pinX, mat) {
  group.add(lead(v3(bodyX, bodyY, 0), v3(pinX, bodyY, 0), 0.3, mat));
  group.add(lead(v3(pinX, bodyY, 0), v3(pinX, -3.2, 0), 0.3, mat));
}

function canvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, ctx, canvas, redraw: (fn) => { fn(ctx, w, h); tex.needsUpdate = true; } };
}

let glowTex = null;
function glowSprite(color) {
  if (!glowTex) {
    glowTex = canvasTexture(128, 128, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.28, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    }).tex;
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(14);
  return s;
}

// --------------------------------------------------------------- BreadBai

export function makeBreadBai() {
  const holes = BreadBaiHoles();
  const group = new THREE.Group();

  const PX = 2048;
  const scale = PX / BOARD.w;
  const { tex } = canvasTexture(PX, Math.round(BOARD.d * scale), (ctx, w, h) => {
    ctx.fillStyle = '#f3f3f1'; ctx.fillRect(0, 0, w, h);
    const toX = (x) => (x + BOARD.w / 2) * scale;
    const toY = (z) => (z + BOARD.d / 2) * scale;

    // centre channel
    const grad = ctx.createLinearGradient(0, toY(-3.81), 0, toY(3.81));
    grad.addColorStop(0, '#d8d8d4'); grad.addColorStop(0.5, '#e9e9e6'); grad.addColorStop(1, '#d8d8d4');
    ctx.fillStyle = grad; ctx.fillRect(0, toY(-3.05), w, (6.1) * scale);

    // rail stripes
    ctx.lineWidth = 2.2 * scale / 2;
    for (const [z, color] of [[-23.6, '#2f5fd0'], [-18.2, '#d0342c'], [18.2, '#d0342c'], [23.6, '#2f5fd0']]) {
      ctx.strokeStyle = color; ctx.beginPath();
      ctx.moveTo(toX(-36), toY(z)); ctx.lineTo(toX(36), toY(z)); ctx.stroke();
    }

    // holes
    for (const hole of holes) {
      const x = toX(hole.x), y = toY(hole.z), s = 1.5 * scale;
      ctx.fillStyle = '#c9c9c5';
      ctx.fillRect(x - s / 2 - 1, y - s / 2 - 1, s + 2, s + 2);
      ctx.fillStyle = '#1b1c1f';
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x - s / 2, y + s / 2 - 1.2, s, 1.2);
    }

    // silkscreen
    ctx.fillStyle = '#8a8a86';
    ctx.font = `${2.1 * scale}px -apple-system, "Helvetica Neue", Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let c = 0; c < COLS; c += 5) {
      const n = c + 1;
      const x = toX((c - (COLS - 1) / 2) * G);
      ctx.fillText(String(n), x, toY(-16.5));
      ctx.fillText(String(n), x, toY(16.5));
    }
    for (let r = 0; r < 10; r++) {
      const z = r < 5 ? -(3.81 + r * G) : 3.81 + (r - 5) * G;
      ctx.fillText(ROW_LETTERS[r], toX(-39.6), toY(z));
      ctx.fillText(ROW_LETTERS[r], toX(39.6), toY(z));
    }
    for (const [z, sign, color] of [[-23.6, '+', '#d0342c'], [-18.2, '+', '#d0342c']]) void [z, sign, color];
    ctx.font = `${3 * scale}px -apple-system, Arial`;
    ctx.fillStyle = '#d0342c'; ctx.fillText('+', toX(-39.5), toY(-18.2)); ctx.fillText('+', toX(-39.5), toY(19.66));
    ctx.fillStyle = '#2f5fd0'; ctx.fillText('−', toX(-39.5), toY(-23.6)); ctx.fillText('−', toX(-39.5), toY(23.6));
  });

  const bodyMat = M.plastic('#e8e8e5', 0.72);
  const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.68, metalness: 0.02 });
  const body = new THREE.Mesh(slab(BOARD.w, BOARD.h, BOARD.d, 1.6, 0.4), [bodyMat, bodyMat]);
  body.material = bodyMat;
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  const top = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w - 0.8, BOARD.d - 0.8), topMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = BOARD.h + 0.01;
  top.receiveShadow = true;
  top.userData.isBoardTop = true;
  group.add(top);

  // recessed channel so it reads as a real board from a low angle
  const channel = new THREE.Mesh(new THREE.BoxGeometry(BOARD.w - 3, 1.4, 6.1), M.matte('#d3d3cf'));
  channel.position.set(0, BOARD.h - 0.6, 0);
  group.add(channel);

  group.userData.holes = holes;
  group.userData.pickTarget = top;
  return group;
}

// ------------------------------------------------------------------- parts

const builders = {};

builders.resistor = (part) => {
  const g = new THREE.Group();
  const bodyMat = M.plastic('#d8c39a', 0.55);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.7, 4.4, 4, 16), bodyMat);
  body.rotation.z = Math.PI / 2; body.position.y = 4;
  body.castShadow = true;
  g.add(body);
  const bands = [];
  const colors = resistorBands(part.props.resistance, part.props.tolerance);
  colors.forEach((c, i) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(1.78, 1.78, i === 3 ? 0.7 : 0.6, 18), M.matte(c));
    b.rotation.z = Math.PI / 2;
    b.position.set(i === 3 ? 2.6 : -2.2 + i * 1.3, 4, 0);
    g.add(b); bands.push(b);
  });
  axialLead(g, -3.6, 4, -2 * G); axialLead(g, 3.6, 4, 2 * G);
  g.userData.update = (p) => {
    const cs = resistorBands(p.props.resistance, p.props.tolerance);
    bands.forEach((b, i) => b.material.color.set(cs[i]));
  };
  return g;
};

builders.led = (part) => {
  const g = new THREE.Group();
  const spec = LED_COLORS[part.props.color] ?? LED_COLORS.red;
  const mat = new THREE.MeshPhysicalMaterial({
    color: spec.tint, transmission: 0.55, thickness: 2, roughness: 0.32,
    emissive: new THREE.Color(spec.glow), emissiveIntensity: 0, transparent: true, opacity: 0.92,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.5, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  dome.position.y = 8.2; dome.castShadow = true;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 5, 20), mat);
  barrel.position.y = 5.7;
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(2.95, 2.95, 0.8, 22), mat);
  flange.position.y = 3.6;
  g.add(dome, barrel, flange);
  const glow = glowSprite(spec.glow);
  glow.position.y = 8; glow.visible = false;
  g.add(glow);
  g.add(lead(v3(-G / 2, 3.4, 0), v3(-G / 2, -3.2, 0), 0.3));
  g.add(lead(v3(G / 2, 3.2, 0), v3(G / 2, -3.2, 0), 0.3)); // cathode leg is shorter in real life
  g.userData.update = (p) => {
    const s = LED_COLORS[p.props.color] ?? LED_COLORS.red;
    mat.color.set(p.state?.burnt ? '#4a4a4a' : s.tint);
    mat.emissive.set(s.glow);
    const b = p.state?.brightness ?? 0;
    mat.emissiveIntensity = b * 3.4;
    glow.visible = b > 0.02;
    glow.material.color.set(s.glow);
    glow.material.opacity = Math.min(1, b * 0.85);
    glow.scale.setScalar(9 + b * 12);
  };
  return g;
};

builders.diode = () => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 4.4, 16), M.plastic('#2b2b30', 0.45));
  body.rotation.z = Math.PI / 2; body.position.y = 4; body.castShadow = true;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.46, 1.46, 0.7, 16), M.matte('#e8e8e8'));
  band.rotation.z = Math.PI / 2; band.position.set(1.5, 4, 0);
  g.add(body, band);
  axialLead(g, -2.5, 4, -1.5 * G); axialLead(g, 2.5, 4, 1.5 * G);
  return g;
};

builders.capacitor = (part) => {
  const g = new THREE.Group();
  const h = 9 + Math.min(6, Math.log10(Math.max(part.props.capacitance, 1e-9) * 1e6 + 1) * 3);
  const can = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, h, 24), M.plastic('#2a3b6e', 0.4));
  can.position.y = h / 2 + 1.5; can.castShadow = true;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(3.02, 3.02, 0.4, 24), M.metal());
  top.position.y = h + 1.5;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(3.04, 3.04, h * 0.75, 24, 1, true, Math.PI * 0.72, Math.PI * 0.5), M.matte('#d9dde6'));
  stripe.position.y = h / 2 + 1.5;
  g.add(can, top, stripe);
  g.add(lead(v3(-G / 2, 1.6, 0), v3(-G / 2, -3.2, 0), 0.3));
  g.add(lead(v3(G / 2, 1.6, 0), v3(G / 2, -3.2, 0), 0.3));
  const label = canvasTexture(256, 128, (ctx, w, hh) => {
    ctx.fillStyle = '#1a2547'; ctx.fillRect(0, 0, w, hh);
  });
  void label;
  return g;
};

builders.battery = () => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(slab(26, 17, 17, 1.4, 0.4), M.plastic('#26262b', 0.42));
  body.castShadow = true;
  const wrap = new THREE.Mesh(slab(26.2, 9, 17.2, 1.4, 0.4), M.matte('#b8532f'));
  wrap.position.y = 3.5;
  g.add(body, wrap);
  const snapA = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 2.4, 16), M.metal());
  snapA.position.set(-5, 18.2, 0);
  const snapB = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.3, 2.4, 16), M.metal());
  snapB.position.set(5, 18.2, 0);
  g.add(snapA, snapB);
  g.add(lead(v3(-5, 18, 0), v3(-G, 18, 0), 0.5, M.plastic('#c0342c')));
  g.add(lead(v3(-G, 18, 0), v3(-G, -3.2, 0), 0.5, M.plastic('#c0342c')));
  g.add(lead(v3(5, 18, 0), v3(G, 18, 0), 0.5, M.plastic('#2a2a2e')));
  g.add(lead(v3(G, 18, 0), v3(G, -3.2, 0), 0.5, M.plastic('#2a2a2e')));
  return g;
};

function screenPanel(w, h, draw) {
  const s = canvasTexture(512, Math.round(512 * h / w), draw);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: s.tex }));
  return { mesh, redraw: s.redraw };
}

const lcdDraw = (text, sub) => (ctx, w, h) => {
  ctx.fillStyle = '#0d2b23'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#39ff9e';
  ctx.font = `600 ${h * 0.46}px "SF Mono", ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h * 0.44);
  if (sub) {
    ctx.font = `${h * 0.17}px -apple-system, Arial`;
    ctx.fillStyle = 'rgba(57,255,158,0.55)';
    ctx.fillText(sub, w / 2, h * 0.79);
  }
};

builders.supply = () => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(slab(34, 14, 22, 1.6, 0.5), M.plastic('#e6e6e9', 0.5));
  body.castShadow = true; g.add(body);
  const face = new THREE.Mesh(slab(30, 0.6, 9, 1, 0.2), M.matte('#1a1a1c'));
  face.position.set(0, 14.1, -4);
  g.add(face);
  const screen = screenPanel(26, 7.4, lcdDraw('5.0 V', 'OUTPUT'));
  screen.mesh.rotation.x = -Math.PI / 2;
  screen.mesh.position.set(0, 14.8, -4);
  g.add(screen.mesh);
  g.add(lead(v3(-G, 3, 8), v3(-G, 3, 0), 0.5, M.plastic('#c0342c')));
  g.add(lead(v3(-G, 3, 0), v3(-G, -3.2, 0), 0.5, M.plastic('#c0342c')));
  g.add(lead(v3(G, 3, 8), v3(G, 3, 0), 0.5, M.plastic('#2a2a2e')));
  g.add(lead(v3(G, 3, 0), v3(G, -3.2, 0), 0.5, M.plastic('#2a2a2e')));
  let last = null;
  g.userData.update = (p) => {
    const txt = `${p.props.voltage.toFixed(1)} V`;
    if (txt !== last) { last = txt; screen.redraw(lcdDraw(txt, `${formatValue(Math.abs(p.state?.current ?? 0), 'A')} drawn`)); }
  };
  return g;
};

builders.funcgen = () => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(slab(30, 12, 20, 1.6, 0.5), M.plastic('#1d1d20', 0.45));
  body.castShadow = true; g.add(body);
  const screen = screenPanel(23, 7, lcdDraw('2.0 Hz', 'SQUARE'));
  screen.mesh.rotation.x = -Math.PI / 2;
  screen.mesh.position.set(0, 12.2, -3);
  g.add(screen.mesh);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 2.6, 24), M.plastic('#8a8a90', 0.35));
  knob.position.set(9, 13, 5.5); g.add(knob);
  g.add(lead(v3(-1.5 * G, 2, 6), v3(-1.5 * G, -3.2, 6), 0.45, M.plastic('#d8b23a')));
  g.add(lead(v3(-1.5 * G, 2, 6), v3(-1.5 * G, 2, 0), 0.45, M.plastic('#d8b23a')));
  g.add(lead(v3(-1.5 * G, 2, 0), v3(-1.5 * G, -3.2, 0), 0.45, M.plastic('#d8b23a')));
  g.add(lead(v3(1.5 * G, 2, 0), v3(1.5 * G, -3.2, 0), 0.45, M.plastic('#2a2a2e')));
  let last = null;
  g.userData.update = (p) => {
    const txt = `${p.props.frequency.toFixed(1)} Hz`;
    if (txt !== last) { last = txt; screen.redraw(lcdDraw(txt, p.props.wave.toUpperCase())); }
    knob.rotation.y = p.props.duty * Math.PI * 3;
  };
  return g;
};

builders.ground = () => {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6, 10), M.tin());
  post.position.y = 1.4; g.add(post);
  [3.6, 2.6, 1.6].forEach((w, i) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 0.5, 0.9), M.matte('#3a3f46'));
    bar.position.y = 6.2 - i * 1.4; g.add(bar);
  });
  g.add(lead(v3(0, 1.4, 0), v3(0, -3.2, 0), 0.3));
  return g;
};

builders.pushbutton = () => {
  const g = new THREE.Group();
  const base = new THREE.Mesh(slab(11, 4.2, 11, 0.5, 0.2), M.plastic('#1f1f22', 0.5));
  base.castShadow = true; g.add(base);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 1.6, 20), M.plastic('#2a2a2e'));
  collar.position.y = 4.4; g.add(collar);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.2, 20), M.plastic('#d9d9dd', 0.4));
  cap.position.y = 6.4; cap.castShadow = true;
  cap.userData.clickable = true;
  g.add(cap);
  for (const p of CATALOG.pushbutton.pins) {
    g.add(lead(v3(p.x, 1.6, p.z), v3(p.x, -3.2, p.z), 0.34));
  }
  g.userData.update = (part) => { cap.position.y = part.state?.pressed ? 5.5 : 6.4; };
  g.userData.hitParts = [cap];
  return g;
};

builders.toggle = () => {
  const g = new THREE.Group();
  const base = new THREE.Mesh(slab(12, 5, 8, 0.6, 0.25), M.plastic('#c9ccd1', 0.45));
  base.castShadow = true; g.add(base);
  const pivot = new THREE.Group();
  pivot.position.y = 5;
  const lever = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 5, 4, 12), M.metal());
  lever.position.y = 3.4;
  pivot.add(lever);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), M.plastic('#1f1f22'));
  tip.position.y = 6.6; pivot.add(tip);
  pivot.userData.clickable = true;
  g.add(pivot);
  for (const p of CATALOG.toggle.pins) g.add(lead(v3(p.x, 1.8, p.z), v3(p.x, -3.2, p.z), 0.34));
  g.userData.update = (part) => { pivot.rotation.z = part.state?.on ? -0.42 : 0.42; };
  g.userData.hitParts = [lever, tip];
  return g;
};

builders.potentiometer = () => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(slab(12, 7, 11, 0.8, 0.3), M.plastic('#1f4fa8', 0.45));
  body.castShadow = true; g.add(body);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3, 16), M.metal());
  shaft.position.y = 8; g.add(shaft);
  const knob = new THREE.Group();
  knob.position.y = 10.4;
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(5, 4.4, 4.4, 28), M.plastic('#f2f2f4', 0.3));
  dial.castShadow = true;
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 4.4), M.matte('#0a84ff'));
  mark.position.set(0, 2.3, -2.2);
  const grip = new THREE.Mesh(new THREE.TorusGeometry(4.75, 0.35, 8, 32), M.plastic('#d5d5d9'));
  grip.rotation.x = Math.PI / 2; grip.position.y = 1.4;
  knob.add(dial, mark, grip);
  knob.userData.clickable = true;
  g.add(knob);
  for (const p of CATALOG.potentiometer.pins) g.add(lead(v3(p.x, 2, p.z), v3(p.x, -3.2, p.z), 0.34));
  g.userData.update = (part) => { knob.rotation.y = (part.props.wiper - 0.5) * Math.PI * 1.5; };
  g.userData.hitParts = [dial, mark, grip];
  g.userData.knob = knob;
  return g;
};

builders.ldr = () => {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 1.2, 24), M.plastic('#e8e2cf', 0.5));
  disc.position.y = 6; disc.rotation.x = Math.PI / 2 - 0.5;
  disc.castShadow = true;
  const face = new THREE.Mesh(new THREE.CircleGeometry(2.3, 24), M.matte('#d8c98f'));
  face.position.set(0, 6, 0.65); face.rotation.x = -0.5;
  const squiggle = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.36, 0.1), M.matte('#3a3226'));
    b.position.set(0, -1.6 + i * 0.8, 0.02);
    squiggle.add(b);
  }
  squiggle.position.set(0, 6, 0.72); squiggle.rotation.x = -0.5;
  g.add(disc, face, squiggle);
  g.add(lead(v3(-G, 5, 0), v3(-G, -3.2, 0), 0.32));
  g.add(lead(v3(G, 5, 0), v3(G, -3.2, 0), 0.32));
  g.userData.update = (part) => {
    face.material.color.setHSL(0.13, 0.35, 0.28 + part.props.light * 0.5);
  };
  return g;
};

builders.transistor = () => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 5.2, 24, 1, false), M.plastic('#17171a', 0.5));
  body.position.y = 5.6; body.castShadow = true;
  const flat = new THREE.Mesh(new THREE.BoxGeometry(4.6, 5.2, 0.6), M.plastic('#17171a', 0.5));
  flat.position.set(0, 5.6, -2.1);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.plastic('#17171a', 0.5));
  dome.position.y = 8.2;
  g.add(body, flat, dome);
  for (const p of CATALOG.transistor.pins) g.add(lead(v3(p.x, 3.1, p.z), v3(p.x, -3.2, p.z), 0.34));
  return g;
};

builders.buzzer = () => {
  const g = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 8, 32), M.plastic('#1b1b1e', 0.42));
  can.position.y = 5.5; can.castShadow = true;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(6.02, 6.02, 0.3, 32), M.matte('#0e0e10'));
  top.position.y = 9.5;
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.6, 20), M.matte('#000000'));
  hole.position.y = 9.6;
  g.add(can, top, hole);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.25, 8, 40), new THREE.MeshBasicMaterial({ color: 0x0a84ff, transparent: true, opacity: 0 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 9.6;
  g.add(ring);
  g.add(lead(v3(-G, 1.5, 0), v3(-G, -3.2, 0), 0.34));
  g.add(lead(v3(G, 1.5, 0), v3(G, -3.2, 0), 0.34));
  g.userData.update = (part, t) => {
    const lvl = part.state?.level ?? 0;
    ring.material.opacity = lvl > 0.02 ? 0.35 + 0.35 * Math.sin(t * 22) : 0;
    ring.scale.setScalar(1 + (lvl > 0.02 ? 0.06 * Math.sin(t * 22) : 0));
  };
  return g;
};

builders.motor = () => {
  const g = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 22, 32), M.metal());
  can.rotation.z = Math.PI / 2; can.position.set(0, 8.5, 0);
  can.castShadow = true;
  const endcap = new THREE.Mesh(new THREE.CylinderGeometry(7.05, 6.4, 2, 32), M.plastic('#2b2b30'));
  endcap.rotation.z = Math.PI / 2; endcap.position.set(-11.5, 8.5, 0);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 8, 16), M.metal());
  shaft.rotation.z = Math.PI / 2; shaft.position.set(15, 8.5, 0);
  const rotor = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 2, 16), M.plastic('#c94f3d'));
  hub.rotation.z = Math.PI / 2; hub.position.set(17.5, 0, 0);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(1, 16, 3), M.plastic('#e05a45', 0.4));
  blade.position.set(17.5, 0, 0);
  const blade2 = blade.clone(); blade2.rotation.x = Math.PI / 2;
  rotor.add(hub, blade, blade2);
  rotor.position.y = 8.5;
  g.add(can, endcap, shaft, rotor);
  g.add(lead(v3(-G, 3, 7), v3(-G, 3, 0), 0.4, M.plastic('#c0342c')));
  g.add(lead(v3(-G, 3, 0), v3(-G, -3.2, 0), 0.4, M.plastic('#c0342c')));
  g.add(lead(v3(G, 3, 7), v3(G, 3, 0), 0.4, M.plastic('#2a2a2e')));
  g.add(lead(v3(G, 3, 0), v3(G, -3.2, 0), 0.4, M.plastic('#2a2a2e')));
  g.userData.update = (part) => { rotor.rotation.x = part.state?.angle ?? 0; };
  return g;
};

const SEG_LAYOUT = {
  a: [0, 9.2, 5.6, 1.2, 0], b: [3.1, 5, 1.2, 6.6, 0], c: [3.1, -1.8, 1.2, 6.6, 0],
  d: [0, -5.6, 5.6, 1.2, 0], e: [-3.1, -1.8, 1.2, 6.6, 0], f: [-3.1, 5, 1.2, 6.6, 0],
  g: [0, 1.7, 5.6, 1.2, 0], dp: [5.2, -5.4, 1.4, 1.4, 0],
};

builders.seg7 = () => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(slab(13, 9, 19, 0.6, 0.25), M.plastic('#1c1c1f', 0.55));
  body.castShadow = true; g.add(body);
  const segs = {};
  for (const [name, [x, y, w, h]] of Object.entries(SEG_LAYOUT)) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3a1414, emissive: new THREE.Color('#ff3b30'), emissiveIntensity: 0, roughness: 0.5,
    });
    const geo = name === 'dp' ? new THREE.CircleGeometry(0.8, 14) : roundedSegment(w, h);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x * 0.82, 9.1, -y * 0.82);
    segs[name] = mesh;
    g.add(mesh);
  }
  for (const p of CATALOG.seg7.pins) g.add(lead(v3(p.x, 1.5, p.z), v3(p.x, -3.2, p.z), 0.32));
  g.userData.update = (part) => {
    const lit = part.state?.lit ?? {};
    for (const [name, mesh] of Object.entries(segs)) {
      const v = lit[name] ?? 0;
      mesh.material.emissiveIntensity = v * 2.6;
      mesh.material.color.setRGB(0.22 + v * 0.5, 0.06, 0.06);
    }
  };
  return g;
};

function roundedSegment(w, h) {
  return new THREE.ShapeGeometry(roundedRect(w, h, Math.min(w, h) * 0.45), 6);
}

const meterBuilder = (unit) => () => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(slab(30, 10, 18, 2, 0.6), M.plastic('#f0f0f3', 0.4));
  body.castShadow = true; g.add(body);
  const bezel = new THREE.Mesh(slab(24, 0.8, 10, 1.2, 0.3), M.matte('#111114'));
  bezel.position.y = 10; g.add(bezel);
  const screen = screenPanel(21, 8, lcdDraw(`0.00 ${unit}`, ''));
  screen.mesh.rotation.x = -Math.PI / 2;
  screen.mesh.position.set(0, 10.9, 0);
  g.add(screen.mesh);
  const red = M.plastic('#c0342c'), black = M.plastic('#2a2a2e');
  g.add(lead(v3(-1.5 * G, 3, 9), v3(-1.5 * G, 3, 0), 0.45, red));
  g.add(lead(v3(-1.5 * G, 3, 0), v3(-1.5 * G, -3.2, 0), 0.45, red));
  g.add(lead(v3(1.5 * G, 3, 9), v3(1.5 * G, 3, 0), 0.45, black));
  g.add(lead(v3(1.5 * G, 3, 0), v3(1.5 * G, -3.2, 0), 0.45, black));
  let last = null;
  g.userData.update = (part) => {
    const txt = CATALOG[part.type].display(part);
    if (txt !== last) { last = txt; screen.redraw(lcdDraw(txt, part.type === 'ammeter' ? 'SERIES' : 'ACROSS')); }
  };
  return g;
};

builders.voltmeter = meterBuilder('V');
builders.ammeter = meterBuilder('A');

// ------------------------------------------------------------------- facade

/** Builds the 3D body for a part and attaches pin markers used for wiring. */
export function buildPart(part) {
  const def = CATALOG[part.type];
  const group = (builders[part.type] ?? (() => new THREE.Group()))(part);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow ?? true; } });

  const pinMarkers = [];
  for (const p of def.pins) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x0a84ff, transparent: true, opacity: 0, depthWrite: false }),
    );
    marker.position.set(p.x, 0.6, p.z);
    marker.userData.pin = p.name;
    marker.userData.isPin = true;
    pinMarkers.push(marker);
    group.add(marker);
  }
  group.userData.pinMarkers = pinMarkers;
  group.userData.partId = part.id;
  return group;
}

export { M as MATERIALS, lead as makeLead, canvasTexture, BOARD, BreadBaiHoles };
