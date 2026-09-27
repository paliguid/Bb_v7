import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PART_TYPES } from './catalog.js';
import { isShaftMounted, partMesh } from './assembly.js';
import { matrixToThree, toGeometry } from './three-bridge.js';
import { worldMatrixFor } from './poses.js';
import { materialOf } from './materials.js';

const ACCENT = 0x0a84ff;
// Millimetres are used directly as three.js scene units (see three-bridge.js) — no rescale here.

function stdMat(color, o = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.35, ...o }); }
const matCache = new Map();
/** Parts with a 'material' parameter (steel, aluminium, …) render in that material's real colour;
 * everything else keeps its catalog-defined colour (e.g. a motor's blue casing). Only checking for
 * `def.mount` here (true for nearly every part) previously painted almost everything generic steel grey. */
const materialFor = (p, def) => {
  const hasMaterialParam = def.params?.some((prm) => prm.type === 'material');
  const key = hasMaterialParam ? (p.material ?? 'steel') : def.color;
  if (matCache.has(key)) return matCache.get(key);
  const mat = hasMaterialParam ? materialOf(p.material ?? 'steel') : null;
  const m = stdMat(mat ? mat.color : def.color, mat ? { roughness: 0.4, metalness: mat.rho > 5000 ? 0.7 : 0.25 } : {});
  matCache.set(key, m);
  return m;
};

/** Everything the stage needs to know to draw and move one part, kept between frames. */
class Entity {
  constructor(part, def) {
    this.part = part; this.def = def;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.group.userData.partId = part.id;
  }
}

export class MechStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.entities = new Map();
    this.callbacks = {};
    this.tool = 'select';
    this.selection = [];
    this.clock = new THREE.Clock();
    this.snapEnabled = true;
    this._gizmoDragging = false;
    this._gizmoBaseBoxes = null;
    this._gizmoOrigin = new THREE.Vector3();
    this._suppressGizmoChange = false;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragPlane = new THREE.Plane();
    this.placement = null;
    this._initScene();
    this._initEvents();
    this._loop = this._loop.bind(this);
    this.renderer.setAnimationLoop(this._loop);
  }

  on(name, fn) { this.callbacks[name] = fn; }

  _initScene() {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d0f);
    scene.fog = new THREE.Fog(0x0d0d0f, 2200, 9000);
    this.scene = scene;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
    scene.environmentIntensity = 0.6;

    // Scene units are millimetres (see three-bridge.js). Defaults below suit a ~200-300 mm
    // mechanism; frameAll() re-fits the camera to whatever is actually on the board, including
    // much larger presets like a multi-metre vehicle track.
    const camera = new THREE.PerspectiveCamera(38, 1, 5, 40000);
    camera.position.set(280, 260, 340);
    this.camera = camera;

    const controls = new OrbitControls(camera, this.canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 30; controls.maxDistance = 40000;
    controls.target.set(0, 40, 0);
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls = controls;

    // CAD-style XYZ transform gizmo. It moves a selection as a unit while the document remains
    // the source of truth; the editor receives translation deltas and commits them to the model.
    const gizmo = new TransformControls(camera, this.canvas);
    gizmo.setMode('translate');
    gizmo.setSpace('world');
    gizmo.setSize(0.9);
    gizmo.showX = true; gizmo.showY = true; gizmo.showZ = true;
    gizmo.addEventListener('dragging-changed', (ev) => {
      this._gizmoDragging = !!ev.value;
      this.controls.enabled = !ev.value;
      if (ev.value) {
        this._gizmoOrigin.copy(this.gizmoProxy.position);
        this._gizmoBaseBoxes = this._selectionBoxes(this.selection);
        this.callbacks.transformStart?.({ ids: [...this.selection] });
      } else {
        this.callbacks.transformEnd?.({ ids: [...this.selection] });
        this._gizmoBaseBoxes = null;
      }
    });
    gizmo.addEventListener('objectChange', () => {
      if (this._suppressGizmoChange || !this._gizmoDragging) return;
      const raw = this.gizmoProxy.position.clone().sub(this._gizmoOrigin);
      const snapped = this.snapTranslation(this.selection, [raw.x, raw.y, raw.z], { boxes: this._gizmoBaseBoxes });
      if (!snapped.equals(raw)) {
        this._suppressGizmoChange = true;
        this.gizmoProxy.position.copy(this._gizmoOrigin).add(snapped);
        this._suppressGizmoChange = false;
      }
      this.callbacks.transform?.({ ids: [...this.selection], delta: [snapped.x, snapped.y, snapped.z] });
    });
    this.gizmo = gizmo;
    this.gizmoProxy = new THREE.Object3D();
    this.gizmoProxy.name = 'cad-transform-pivot';
    scene.add(this.gizmoProxy);
    scene.add(gizmo);

    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(300, 460, 240); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0015;
    const c = key.shadow.camera; c.left = -600; c.right = 600; c.top = 600; c.bottom = -600; c.near = 50; c.far = 1600;
    scene.add(key);
    scene.add(new THREE.DirectionalLight(0x9fc4ff, 0.45).translateX(-300).translateY(200).translateZ(-200));
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x101014, 0.5));

    // The floor is not fixed at y=0: it tracks the lowest point of whatever is in the scene (see
    // _updateFloor), so a part that legitimately sits below its parent's origin — a weight hanging
    // off a winch drum, a vehicle's wheels, a preset built with a negative-y offset — always rests
    // ON the visible ground instead of appearing to clip through it.
    this._floorBaseRadius = 2400;
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(this._floorBaseRadius, 64), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);
    this.floor = floor;
    const grid = new THREE.GridHelper(this._floorBaseRadius, 48, 0x2a2c33, 0x1c1e23);
    grid.material.transparent = true; grid.material.opacity = 0.3; grid.position.y = 0.1;
    scene.add(grid);
    this.grid = grid;
    this._floorY = 0;
    this._floorScale = 1;

    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(6, 9, 24), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
    this.hoverRing.visible = false; this.hoverRing.renderOrder = 10; scene.add(this.hoverRing);
    this.overlay = new THREE.Group(); scene.add(this.overlay);
    this.ghost = null;

    this.resize();
  }

  resize() {
    const el = this.canvas.parentElement;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.gizmo?.detach();
    this.gizmo?.dispose?.();
    this.renderer.dispose();
  }

  setSnapEnabled(enabled) { this.snapEnabled = !!enabled; }

  _movable(part) { return !!part && 'x' in part && !isShaftMounted(part); }

  _selectionBoxes(ids = []) {
    const boxes = [];
    for (const id of ids) {
      const e = this.entities.get(id);
      const part = this.doc?.parts?.find((p) => p.id === id);
      if (!e || !part || !this._movable(part) || !e.mesh) continue;
      e.group.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(e.group);
      if (!b.isEmpty()) boxes.push({ id, box: b.clone() });
    }
    return boxes;
  }

  _moveBox(box, delta) {
    return box.clone().translate(new THREE.Vector3(delta[0], delta[1], delta[2]));
  }

  /** Snap a selection to nearby faces/edges/centres of other mechanical parts. */
  snapTranslation(ids, delta, { boxes = null } = {}) {
    const raw = new THREE.Vector3(delta[0], delta[1], delta[2]);
    if (!this.snapEnabled || !this.doc || !ids?.length) return raw;
    const selected = boxes ?? this._selectionBoxes(ids);
    if (!selected.length) return raw;

    const selectedBox = new THREE.Box3();
    for (const item of selected) selectedBox.union(this._moveBox(item.box, delta));
    if (selectedBox.isEmpty()) return raw;

    const targetIds = new Set(ids);
    const movedCenter = selectedBox.getCenter(new THREE.Vector3());
    const movedMin = selectedBox.min;
    const movedMax = selectedBox.max;
    const span = selectedBox.getSize(new THREE.Vector3()).length();
    const threshold = Math.max(3, Math.min(14, span * 0.08));
    let best = raw.clone();
    let bestScore = Infinity;

    const axisSpecs = [
      ['x', movedMin.x, movedMax.x, movedCenter.x],
      ['y', movedMin.y, movedMax.y, movedCenter.y],
      ['z', movedMin.z, movedMax.z, movedCenter.z],
    ];

    for (const target of this.entities.values()) {
      const part = target.part;
      if (!part || targetIds.has(part.id) || !target.mesh) continue;
      target.group.updateWorldMatrix(true, true);
      const tb = new THREE.Box3().setFromObject(target.group);
      if (tb.isEmpty()) continue;
      const tc = tb.getCenter(new THREE.Vector3());
      const targetVals = {
        x: [tb.min.x, tb.max.x, tc.x],
        y: [tb.min.y, tb.max.y, tc.y],
        z: [tb.min.z, tb.max.z, tc.z],
      };

      // Pick the nearest valid alignment independently on each axis, but against the same target.
      // This makes a corner/face-to-face approach snap cleanly on X+Z (or X+Y+Z) instead of only
      // capturing whichever single axis happened to be a few millimetres closer.
      const corrections = { x: 0, y: 0, z: 0 };
      let count = 0;
      for (const [axis, amin, amax, ac] of axisSpecs) {
        let bestCorrection = null;
        for (const a of [amin, amax, ac]) {
          for (const b of targetVals[axis]) {
            const c = b - a;
            if (Math.abs(c) > threshold) continue;
            if (bestCorrection == null || Math.abs(c) < Math.abs(bestCorrection)) bestCorrection = c;
          }
        }
        if (bestCorrection != null) { corrections[axis] = bestCorrection; count++; }
      }
      if (!count) continue;
      const candidate = raw.clone().add(new THREE.Vector3(corrections.x, corrections.y, corrections.z));
      const snapAmount = Math.hypot(corrections.x, corrections.y, corrections.z);
      const score = snapAmount + (count === 1 ? 0.1 : -0.4 * count);
      if (score < bestScore) { bestScore = score; best.copy(candidate); }
    }
    return best;
  }

  getSelectionBoxes(ids = []) { return this._selectionBoxes(ids); }

  snapDragDelta(ids, delta, boxes = null) { return this.snapTranslation(ids, delta, { boxes }); }

  _syncGizmo(doc, selection) {
    if (!this.gizmo || this._gizmoDragging) return;
    const movable = (selection ?? []).filter((id) => this._movable(doc.parts.find((p) => p.id === id)));
    if (!movable.length) { this.gizmo.detach(); return; }
    const box = new THREE.Box3();
    const boxes = this._selectionBoxes(movable);
    for (const item of boxes) box.union(item.box);
    if (box.isEmpty()) { this.gizmo.detach(); return; }
    box.getCenter(this.gizmoProxy.position);
    this.gizmoProxy.rotation.set(0, 0, 0);
    this.gizmoProxy.scale.set(1, 1, 1);
    this.gizmoProxy.updateMatrixWorld(true);
    if (this.gizmo.object !== this.gizmoProxy) this.gizmo.attach(this.gizmoProxy);
  }

  /* ------------------------------------------------------------------ sync */

  /** Rebuild entities to match the document; call after add/remove/param edits. */
  sync(doc, selection = []) {
    this.doc = doc; this.selection = selection;
    const seen = new Set();
    for (const part of doc.parts) {
      seen.add(part.id);
      const def = PART_TYPES[part.type];
      let e = this.entities.get(part.id);
      const sig = meshSignature(doc, part);
      if (!e) { e = new Entity(part, def); this.scene.add(e.group); this.entities.set(part.id, e); }
      e.part = part;
      if (e.sig !== sig) { this._rebuildMesh(e, doc); e.sig = sig; }
      this._tint(e, selection.includes(part.id));
    }
    for (const [id, e] of [...this.entities]) if (!seen.has(id)) { this.scene.remove(e.group); this.entities.delete(id); }
    this._syncConnectors(doc);
    this._syncGizmo(doc, selection);
  }

  _rebuildMesh(e, doc) {
    for (const child of [...e.group.children]) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) mat.dispose?.();
      }
    }
    e.group.clear();
    e.mesh = null; e.outline = null; e.localBox = null;
    const mesh = partMesh(doc, e.part);
    if (mesh && mesh.positions.length) {
      const geo = toGeometry(mesh);
      const mat = materialFor(e.part, e.def);
      const m = new THREE.Mesh(geo, mat.clone());
      m.castShadow = true; m.receiveShadow = true;
      const edges = new THREE.EdgesGeometry(geo, 20);
      const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
        color: 0x00ffff, transparent: true, opacity: 0.98, depthTest: false, depthWrite: false,
      }));
      outline.renderOrder = 30;
      outline.visible = false;
      e.group.add(m, outline);
      e.mesh = m; e.outline = outline;
      geo.computeBoundingBox();
      e.localBox = geo.boundingBox.clone();
    }
  }

  _tint(e, selected) {
    if (!e.mesh) return;
    e.mesh.material.emissive?.setHex(selected ? 0x083d4a : 0x000000);
    e.mesh.material.emissiveIntensity = selected ? 0.5 : 0;
    if (e.outline) e.outline.visible = selected;
  }

  /** Push live poses from the physics (or rest state) into the scene graph. Called every frame. */
  applyPoses(doc, poses) {
    for (const [id, e] of this.entities) {
      const part = doc.parts.find((p) => p.id === id);
      if (!part) continue;
      e.group.matrix.copy(matrixToThree(worldMatrixFor(doc, part, poses)));
    }
    if (this._connGroup) this._connGroup.children.forEach((c) => c.userData.update?.(doc, poses));
    this._updateFloor();
  }

  /**
   * Keep the ground plane underneath everything in the scene, and wide enough to cover it.
   * Parts are free to sit below their parent's local origin (a weight hanging off a drum, a
   * vehicle's wheels below its chassis, a preset authored with a negative-y offset) — that is
   * correct geometry, not a bug. What must never happen is the fixed floor from a previous build
   * appearing to slice through a part like that, so the floor's height and footprint are derived
   * from the actual scene instead of being hard-coded at y = 0 and radius 2400 mm.
   */
  _updateFloor() {
    if (!this.floor) return;
    let minY = 0, extent = 0;
    for (const e of this.entities.values()) {
      if (!e.mesh || !e.localBox || e.localBox.isEmpty()) continue;
      const box = e.localBox.clone().applyMatrix4(e.group.matrix);
      if (box.isEmpty()) continue;
      if (box.min.y < minY) minY = box.min.y;
      extent = Math.max(extent, Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
    }
    const margin = 3; // a hair of clearance so parts don't z-fight the floor when resting on it
    const targetY = Math.min(0, minY - margin);
    // Smooth the motion so the floor doesn't visibly snap/pop as a mechanism runs (e.g. a weight
    // descending on a winch); it settles to the new level within a few frames.
    this._floorY += (targetY - this._floorY) * 0.35;
    if (Math.abs(this._floorY - targetY) < 0.05) this._floorY = targetY;
    this.floor.position.y = this._floorY;
    this.grid.position.y = this._floorY + 0.1;

    const neededRadius = extent * 1.4 + 300;
    const targetScale = Math.max(1, neededRadius / this._floorBaseRadius);
    if (Math.abs(this._floorScale - targetScale) > 0.02) {
      this._floorScale = targetScale;
      this.floor.scale.setScalar(targetScale);
      this.grid.scale.setScalar(targetScale);
    }
  }

  /* ------------------------------------------------------------- overlays */

  _syncConnectors(doc) {
    if (this._connGroup) this.scene.remove(this._connGroup);
    const g = new THREE.Group(); this._connGroup = g; this.scene.add(g);
    for (const link of doc.links) {
      const mesh = buildConnectorOverlay(doc, link);
      if (mesh) g.add(mesh);
    }
  }

  setGhost(part) {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (!part) return;
    const def = PART_TYPES[part.type];
    const mesh = def.mesh ? def.mesh(part) : null;
    if (!mesh) return;
    const m = new THREE.Mesh(toGeometry(mesh), new THREE.MeshStandardMaterial({ color: 0x0a84ff, transparent: true, opacity: 0.55 }));
    this.ghost = m; this.scene.add(m);
  }
  setGhostPose(matrix) { if (this.ghost) { this.ghost.matrix.copy(matrixToThree(matrix)); this.ghost.matrixAutoUpdate = false; } }

  frameAll() {
    const box = new THREE.Box3();
    for (const e of this.entities.values()) box.expandByObject(e.group);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()).length() || 20;
    const center = box.getCenter(new THREE.Vector3());
    this.controls.target.copy(center);
    const dir = this.camera.position.clone().sub(center).normalize();
    this.camera.position.copy(center).addScaledVector(dir, Math.max(size * 1.1, 8));
    this.camera.near = size / 100; this.camera.far = size * 30; this.camera.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------- picking */

  _ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  pick(e) {
    this._ndc(e); this.raycaster.setFromCamera(this.pointer, this.camera);
    const groups = [...this.entities.values()].map((en) => en.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    if (!hits.length) return null;
    let o = hits[0].object; while (o && !o.userData.partId) o = o.parent;
    return o ? { partId: o.userData.partId, point: hits[0].point, distance: hits[0].distance } : null;
  }
  groundPoint(e, y = 0) {
    this._ndc(e); this.raycaster.setFromCamera(this.pointer, this.camera);
    this.dragPlane.set(new THREE.Vector3(0, 1, 0), -y);
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.dragPlane, pt) ? pt : null;
  }

  _initEvents() {
    const el = this.canvas;
    const emit = (name, payload) => this.callbacks[name]?.(payload);
    let downInfo = null;
    let dragging = false;
    el.addEventListener('pointerdown', (e) => {
      if (this.gizmo?.dragging) return;
      if (e.button !== 0) return;
      downInfo = { x: e.clientX, y: e.clientY, hit: this.pick(e), startPoint: this.groundPoint(e) };
      dragging = false;
    });
    el.addEventListener('pointermove', (e) => {
      if (this.gizmo?.dragging) { downInfo = null; dragging = false; return; }
      if (downInfo) {
        const movedPx = Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y);
        if (!dragging && movedPx > 4 && downInfo.hit) {
          // A drag that started on a part takes over from orbiting the camera, so the two gestures
          // (rotate view vs. move a part) never fight each other on the same left-button drag.
          dragging = true;
          this.controls.enabled = false;
          emit('dragStart', { hit: downInfo.hit, point: downInfo.startPoint });
        }
        if (dragging) { emit('dragMove', { hit: downInfo.hit, point: this.groundPoint(e), start: downInfo.startPoint }); return; }
      }
      const hit = this.pick(e);
      this.hoverRing.visible = false;
      emit('hover', { hit, point: this.groundPoint(e) });
    });
    el.addEventListener('pointerup', (e) => {
      if (this.gizmo?.dragging) { downInfo = null; dragging = false; return; }
      if (!downInfo) return;
      if (dragging) {
        emit('dragEnd', { hit: downInfo.hit, point: this.groundPoint(e), start: downInfo.startPoint });
        this.controls.enabled = true;
      } else {
        emit('click', { hit: downInfo.hit, shift: e.shiftKey, point: this.groundPoint(e) });
      }
      downInfo = null; dragging = false;
    });
    el.addEventListener('dblclick', (e) => emit('dblclick', { hit: this.pick(e) }));
  }

  _loop() {
    this.controls.update();
    this.callbacks.onFrame?.(this.clock.getDelta());
    this.renderer.render(this.scene, this.camera);
  }
}

/* -------------------------------------------------------------- helpers */

function meshSignature(doc, part) {
  if (part.type === 'custom') return `c:${part.meshRef ?? JSON.stringify(part.model)}:${part.material}:${part.massOverride}`;
  const sig = { ...part };
  for (const k of ['id', 'name', 'x', 'y', 'z', 'rx', 'ry', 'rz', 'shaft', 'axial', 'phase', 'target', 'a', 'b', 'x0']) delete sig[k];
  return JSON.stringify(sig);
}

/** A thin translucent tube joining the two parts of a link, so the connection is visible even when not meshed. */
function buildConnectorOverlay(doc, link) {
  if (!['spring'].includes(link.type)) return null; // gear/belt contact is already visible in the geometry; only abstract links need a line
  return null;
}
