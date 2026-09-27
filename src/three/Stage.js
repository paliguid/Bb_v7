import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CATALOG } from '../lib/catalog.js';
import { buildPart, makeBreadBai, BOARD } from './models.js';

const ACCENT = 0x0a84ff;
const SNAP_RADIUS = 5.0;   // how close a lead must be to grab a hole
const INSERT_RADIUS = 1.5; // how close a lead must be to count as inserted

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.parts = new Map();   // partId -> { object3D, part }
    this.wires = new Map();
    this.callbacks = {};
    this.tool = 'select';
    this.mode = 'standard';
    this.clock = new THREE.Clock();
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 2;
    this.dragState = null;
    this.pendingWire = null;
    this.placement = null;
    this.probe = null;

    this._initScene();
    this._initEvents();
    this._loop = this._loop.bind(this);
    this.renderer.setAnimationLoop(this._loop);
  }

  // ----------------------------------------------------------------- setup

  _initScene() {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d0f);
    scene.fog = new THREE.Fog(0x0d0d0f, 320, 760);
    this.scene = scene;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
    scene.environmentIntensity = 0.55;

    const camera = new THREE.PerspectiveCamera(34, 1, 1, 2000);
    camera.position.set(-12, 108, 132);
    this.camera = camera;

    const controls = new OrbitControls(camera, this.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 28;
    controls.maxDistance = 460;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.target.set(0, 4, 0);
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls = controls;

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(70, 150, 90);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 3;
    key.shadow.bias = -0.0012;
    const c = key.shadow.camera;
    c.left = -160; c.right = 160; c.top = 160; c.bottom = -160; c.near = 20; c.far = 420;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.5);
    fill.position.set(-110, 70, -60);
    scene.add(fill);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x101014, 0.45));

    const deskMat = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.92, metalness: 0.15 });
    const desk = new THREE.Mesh(new THREE.CircleGeometry(520, 64), deskMat);
    desk.rotation.x = -Math.PI / 2;
    desk.position.y = -0.4;
    desk.receiveShadow = true;
    desk.userData.isDesk = true;
    this.desk = desk;
    scene.add(desk);

    const grid = new THREE.GridHelper(1040, 104, 0x2a2c33, 0x1c1e23);
    grid.material.transparent = true;
    grid.material.opacity = 0.34;
    grid.position.y = -0.3;
    scene.add(grid);

    // Reusable helpers
    this.hoverRing = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 2.4, 24),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }),
    );
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.renderOrder = 10;
    this.hoverRing.visible = false;
    scene.add(this.hoverRing);

    this.selectionBox = new THREE.BoxHelper(new THREE.Object3D(), ACCENT);
    this.selectionBox.material.transparent = true;
    this.selectionBox.material.opacity = 0.85;
    this.selectionBox.material.depthTest = false;
    this.selectionBox.visible = false;
    scene.add(this.selectionBox);

    this.previewWire = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.8 }),
    );
    this.previewWire.visible = false;
    scene.add(this.previewWire);

    this.overlayRoot = new THREE.Group();
    scene.add(this.overlayRoot);
    this.holeOverlay = null;

    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.resize();
  }

  on(name, fn) { this.callbacks[name] = fn; }

  resize() {
    const el = this.canvas.parentElement;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ----------------------------------------------------------- scene sync

  /** Reconciles the scene against the app's part and wire lists. */
  sync(parts, wires, selection, tool, mode) {
    this.tool = tool;
    this.mode = mode;
    this.selection = selection;
    this.partList = parts;
    this.wireList = wires;

    const seen = new Set();
    for (const part of parts) {
      seen.add(part.id);
      let entry = this.parts.get(part.id);
      if (!entry || entry.type !== part.type) {
        if (entry) this.scene.remove(entry.object3D);
        const obj = part.type === 'BreadBai' ? makeBreadBai() : buildPart(part);
        obj.userData.partId = part.id;
        this.scene.add(obj);
        entry = { object3D: obj, type: part.type, part };
        this.parts.set(part.id, entry);
      }
      entry.part = part;
      const obj = entry.object3D;
      if (!this.dragState || this.dragState.partId !== part.id) {
        obj.position.set(part.x, part.y ?? 0, part.z);
        obj.rotation.y = part.rot ?? 0;
      }
      obj.userData.update?.(part, this.clock.elapsedTime);
    }
    for (const [id, entry] of [...this.parts]) {
      if (!seen.has(id)) { this.scene.remove(entry.object3D); this.parts.delete(id); }
    }

    const seenW = new Set();
    for (const wire of wires) {
      seenW.add(wire.id);
      let entry = this.wires.get(wire.id);
      if (!entry) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({
          color: new THREE.Color(wire.color), roughness: 0.42, metalness: 0.05,
        }));
        mesh.castShadow = true;
        mesh.userData.wireId = wire.id;
        this.scene.add(mesh);
        entry = { mesh };
        this.wires.set(wire.id, entry);
      }
      entry.wire = wire;
      entry.mesh.material.color.set(wire.color);
      this._refreshWire(wire, entry.mesh);
    }
    for (const [id, entry] of [...this.wires]) {
      if (!seenW.has(id)) { this.scene.remove(entry.mesh); this.wires.delete(id); }
    }

    this._syncSelection();
    this._ensureHoleOverlay();
  }

  _syncSelection() {
    const entry = this.selection ? this.parts.get(this.selection) : null;
    if (entry && entry.type !== 'BreadBai') {
      this.selectionBox.setFromObject(entry.object3D);
      this.selectionBox.visible = true;
    } else {
      this.selectionBox.visible = false;
    }
  }

  /** World position of a wire endpoint (a component pin or a board hole). */
  endpointPosition(ep) {
    if (!ep) return null;
    if (ep.kind === 'hole') {
      const entry = this.parts.get(ep.boardId);
      if (!entry) return null;
      const hole = entry.object3D.userData.holes?.find((h) => h.name === ep.name);
      if (!hole) return null;
      return entry.object3D.localToWorld(new THREE.Vector3(hole.x, BOARD.h, hole.z));
    }
    const entry = this.parts.get(ep.partId);
    if (!entry) return null;
    const def = CATALOG[entry.type];
    const p = def.pins.find((pp) => pp.name === ep.pin);
    if (!p) return null;
    return entry.object3D.localToWorld(new THREE.Vector3(p.x, 1.2, p.z));
  }

  _refreshWire(wire, mesh) {
    const a = this.endpointPosition(wire.a);
    const b = this.endpointPosition(wire.b);
    if (!a || !b) { mesh.visible = false; return; }
    mesh.visible = true;
    mesh.geometry.dispose();
    mesh.geometry = wireGeometry(a, b, wire.slack ?? 1);
  }

  _ensureHoleOverlay() {
    const boards = [...this.parts.values()].filter((e) => e.type === 'BreadBai');
    const total = boards.reduce((n, b) => n + (b.object3D.userData.holes?.length ?? 0), 0);
    if (this.holeOverlay && this.holeOverlay.count === total && this.holeOverlay.boards === boards.length) return;
    if (this.holeOverlay) { this.overlayRoot.remove(this.holeOverlay.mesh); this.holeOverlay.mesh.geometry.dispose(); }
    if (!total) { this.holeOverlay = null; return; }
    const geo = new THREE.CircleGeometry(1.15, 12).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, total);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);
    mesh.frustumCulled = false;
    const refs = [];
    const dummy = new THREE.Object3D();
    let i = 0;
    for (const b of boards) {
      for (const hole of b.object3D.userData.holes) {
        dummy.position.copy(b.object3D.localToWorld(new THREE.Vector3(hole.x, BOARD.h + 0.12, hole.z)));
        dummy.rotation.set(0, b.object3D.rotation.y, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        refs.push({ boardId: b.part.id, group: hole.group });
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.overlayRoot.add(mesh);
    this.holeOverlay = { mesh, refs, count: total, boards: boards.length };
  }

  /** Paints the board holes for the voltage and connection views. */
  updateProbe(probe) {
    this.probe = probe;
    const overlay = this.holeOverlay;
    if (!overlay) return;
    const show = this.mode !== 'standard' && probe;
    overlay.mesh.visible = show;
    if (!show) return;
    const color = new THREE.Color();
    overlay.refs.forEach((ref, i) => {
      const key = `h:${ref.boardId}:${ref.group}`;
      if (this.mode === 'voltage') {
        const v = probe.voltage.get(key);
        if (v == null) color.setRGB(0.16, 0.17, 0.2);
        else color.copy(voltageColor(v, probe.vmax));
      } else {
        const net = probe.net.get(key);
        if (net == null || !probe.live.has(net)) color.setRGB(0.16, 0.17, 0.2);
        else color.setHSL(((net * 0.381) % 1), 0.72, 0.58);
      }
      overlay.mesh.setColorAt(i, color);
    });
    overlay.mesh.instanceColor.needsUpdate = true;

    for (const [, entry] of this.wires) {
      const w = entry.wire;
      if (!w) continue;
      if (this.mode === 'voltage') {
        const v = probe.voltageOfEndpoint(w.a) ?? 0;
        entry.mesh.material.color.copy(voltageColor(v, probe.vmax));
      } else if (this.mode === 'nets') {
        const net = probe.netOfEndpoint(w.a);
        if (net == null) entry.mesh.material.color.set(w.color);
        else entry.mesh.material.color.setHSL(((net * 0.381) % 1), 0.72, 0.58);
      } else {
        entry.mesh.material.color.set(w.color);
      }
    }
  }

  // -------------------------------------------------------------- picking

  _updatePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  /** Nearest board hole under the cursor, if any. */
  pickHole() {
    let best = null;
    for (const [id, entry] of this.parts) {
      if (entry.type !== 'BreadBai') continue;
      const top = entry.object3D.userData.pickTarget;
      const hit = this.raycaster.intersectObject(top, false)[0];
      if (!hit) continue;
      const local = entry.object3D.worldToLocal(hit.point.clone());
      for (const hole of entry.object3D.userData.holes) {
        const d = Math.hypot(local.x - hole.x, local.z - hole.z);
        if (d < SNAP_RADIUS * 0.55 && (!best || d < best.d)) {
          best = { d, boardId: id, name: hole.name, group: hole.group, hole, entry, point: hit.point };
        }
      }
    }
    return best;
  }

  pickPin() {
    const markers = [];
    for (const [, entry] of this.parts) {
      if (entry.object3D.userData.pinMarkers) markers.push(...entry.object3D.userData.pinMarkers);
    }
    const hit = this.raycaster.intersectObjects(markers, false)[0];
    if (!hit) return null;
    return { partId: hit.object.parent.userData.partId, pin: hit.object.userData.pin, point: hit.object.getWorldPosition(new THREE.Vector3()) };
  }

  pickWire() {
    const meshes = [...this.wires.values()].map((e) => e.mesh).filter((m) => m.visible);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.wireId : null;
  }

  pickPart() {
    const objs = [];
    for (const [, entry] of this.parts) if (entry.type !== 'BreadBai') objs.push(entry.object3D);
    const hits = this.raycaster.intersectObjects(objs, true);
    for (const hit of hits) {
      if (hit.object.material?.opacity === 0) continue;
      let o = hit.object;
      let clickable = null;
      while (o && !o.userData.partId) {
        if (o.userData.clickable) clickable = o;
        o = o.parent;
      }
      if (o) return { partId: o.userData.partId, object3D: o, clickable, point: hit.point };
    }
    return null;
  }

  pickBoardPoint() {
    const hit = this.raycaster.intersectObject(this.desk, false)[0];
    return hit ? hit.point : null;
  }

  // ---------------------------------------------------------------- input

  _initEvents() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this._onDown(e));
    c.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', (e) => this._onUp(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('dblclick', (e) => {
      this._updatePointer(e);
      const hit = this.pickPart();
      if (hit) this.callbacks.onFocus?.(hit.partId);
    });
  }

  _onDown(event) {
    if (event.button !== 0) return;
    this._updatePointer(event);

    if (this.placement) { this._commitPlacement(); return; }

    if (this.tool === 'wire') {
      const target = this.pickPin() ?? this.pickHole();
      if (!target) {
        const wireId = this.pickWire();
        if (wireId && !this.pendingWire) { this.callbacks.onDeleteWire?.(wireId); return; }
        this.pendingWire = null; this.previewWire.visible = false; this.controls.enabled = true;
        return;
      }
      const ep = target.pin
        ? { kind: 'pin', partId: target.partId, pin: target.pin }
        : { kind: 'hole', boardId: target.boardId, name: target.name, group: target.group };
      if (!this.pendingWire) {
        this.pendingWire = ep;
        this.controls.enabled = false;
      } else {
        this.callbacks.onWire?.(this.pendingWire, ep);
        this.pendingWire = null;
        this.previewWire.visible = false;
        this.controls.enabled = true;
      }
      return;
    }

    const hit = this.pickPart();
    if (!hit) {
      // clicking the board or empty desk clears the selection
      this.callbacks.onSelect?.(null);
      return;
    }

    const part = this.parts.get(hit.partId)?.part;
    const def = CATALOG[part?.type];

    if (hit.clickable && def?.clickable) {
      this.callbacks.onInteract?.(hit.partId, 'press');
      this.pressing = hit.partId;
      this.controls.enabled = false;
      return;
    }
    if (hit.clickable && def?.draggableKnob) {
      this.knobDrag = { partId: hit.partId, startX: event.clientX, startValue: part.props.wiper };
      this.controls.enabled = false;
      this.callbacks.onSelect?.(hit.partId);
      return;
    }

    this.callbacks.onSelect?.(hit.partId);
    const obj = this.parts.get(hit.partId).object3D;
    this.dragPlane.set(new THREE.Vector3(0, 1, 0), -obj.position.y);
    const hitPoint = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, hitPoint);
    this.dragState = {
      partId: hit.partId,
      offset: new THREE.Vector3().subVectors(obj.position, hitPoint),
      moved: false,
    };
    this.controls.enabled = false;
  }

  _onMove(event) {
    this._updatePointer(event);

    if (this.placement) { this._movePlacement(); return; }

    if (this.knobDrag) {
      const dx = event.clientX - this.knobDrag.startX;
      const value = Math.max(0, Math.min(1, this.knobDrag.startValue + dx / 220));
      this.callbacks.onProp?.(this.knobDrag.partId, 'wiper', value);
      return;
    }

    if (this.dragState) {
      const obj = this.parts.get(this.dragState.partId)?.object3D;
      if (!obj) return;
      const point = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.dragPlane, point)) return;
      point.add(this.dragState.offset);
      const snapped = this.snap(this.dragState.partId, point.x, point.z, obj.rotation.y);
      obj.position.set(snapped.x, snapped.y, snapped.z);
      this.dragState.moved = true;
      this.dragState.result = snapped;
      this.selectionBox.setFromObject(obj);
      for (const [, entry] of this.wires) if (entry.wire) this._refreshWire(entry.wire, entry.mesh);
      this._showSnapHint(snapped);
      return;
    }

    if (this.tool === 'wire') {
      const target = this.pickPin() ?? this.pickHole();
      this.hoverRing.visible = !!target;
      if (target) {
        const p = target.point.clone();
        this.hoverRing.position.set(p.x, (target.pin ? p.y : BOARD.h) + 0.35, p.z);
      }
      if (this.pendingWire) {
        const from = this.endpointPosition(this.pendingWire);
        const to = target ? target.point.clone() : this.pickBoardPoint();
        if (from && to) {
          this.previewWire.visible = true;
          this.previewWire.geometry.dispose();
          this.previewWire.geometry = wireGeometry(from, to, 1);
        }
      }
      return;
    }

    this.hoverRing.visible = false;
    const hit = this.pickPart();
    this.canvas.style.cursor = hit ? 'grab' : 'default';
    this.callbacks.onHover?.(hit?.partId ?? null);
  }

  _onUp() {
    if (this.pressing) {
      this.callbacks.onInteract?.(this.pressing, 'release');
      this.pressing = null;
    }
    if (this.knobDrag) this.knobDrag = null;
    if (this.dragState) {
      const { partId, moved, result } = this.dragState;
      this.dragState = null;
      if (moved && result) this.callbacks.onMove?.(partId, result);
    }
    this.hoverRing.visible = false;
    this.controls.enabled = true;
  }

  _showSnapHint(snapped) {
    if (snapped.inserted && Object.keys(snapped.inserted).length) {
      this.hoverRing.visible = true;
      this.hoverRing.position.set(snapped.x, snapped.y + 0.4, snapped.z);
    } else {
      this.hoverRing.visible = false;
    }
  }

  /**
   * Places a part at (x, z): if any lead lands near a hole the whole part is
   * pulled onto the grid and the seated leads are recorded.
   */
  snap(partId, x, z, rotY) {
    const entry = this.parts.get(partId);
    const part = entry?.part;
    const def = CATALOG[part?.type];
    if (!def || def.board) return { x, y: 0, z, inserted: {} };

    const boards = [...this.parts.values()].filter((e) => e.type === 'BreadBai');
    const rot = rotY ?? part.rot ?? 0;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const rotate = (p) => ({ x: p.x * cos + p.z * sin, z: -p.x * sin + p.z * cos });

    let bestShift = null;
    for (const b of boards) {
      const holes = b.object3D.userData.holes;
      const bx = b.object3D.position.x, bz = b.object3D.position.z;
      for (const pinDef of def.pins) {
        const r = rotate(pinDef);
        const wx = x + r.x, wz = z + r.z;
        for (const hole of holes) {
          const hx = bx + hole.x, hz = bz + hole.z;
          const d = Math.hypot(wx - hx, wz - hz);
          if (d < SNAP_RADIUS && (!bestShift || d < bestShift.d)) {
            bestShift = { d, dx: hx - wx, dz: hz - wz, boardId: b.part.id };
          }
        }
      }
    }

    if (!bestShift) return { x, y: 0, z, inserted: {} };

    const nx = x + bestShift.dx, nz = z + bestShift.dz;
    const board = this.parts.get(bestShift.boardId);
    const inserted = {};
    for (const pinDef of def.pins) {
      const r = rotate(pinDef);
      const wx = nx + r.x, wz = nz + r.z;
      let match = null;
      for (const hole of board.object3D.userData.holes) {
        const d = Math.hypot(wx - (board.object3D.position.x + hole.x), wz - (board.object3D.position.z + hole.z));
        if (d < INSERT_RADIUS && (!match || d < match.d)) match = { d, hole };
      }
      if (match) inserted[pinDef.name] = `h:${bestShift.boardId}:${match.hole.group}`;
    }
    return { x: nx, y: BOARD.h, z: nz, inserted, boardId: bestShift.boardId };
  }

  // ------------------------------------------------------------ placement

  beginPlacement(type) {
    this.cancelPlacement();
    const ghostPart = { id: '__ghost__', type, props: { ...CATALOG[type].defaults }, state: {}, x: 0, z: 0, rot: 0 };
    for (const p of CATALOG[type].props) ghostPart.props[p.key] = p.default;
    const obj = type === 'BreadBai' ? makeBreadBai() : buildPart(ghostPart);
    obj.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = (o.material.opacity ?? 1) * 0.55;
        o.castShadow = false;
      }
    });
    this.scene.add(obj);
    this.placement = { type, object3D: obj, x: 0, z: 0, rot: 0, inserted: {} };
    this.canvas.style.cursor = 'copy';
  }

  _movePlacement() {
    const p = this.placement;
    if (!p) return;
    const point = this.pickBoardPoint();
    if (!point) return;
    let x = point.x, z = point.z, y = 0, inserted = {};
    if (p.type !== 'BreadBai') {
      const boards = [...this.parts.values()].filter((e) => e.type === 'BreadBai');
      if (boards.length) {
        const fake = { object3D: p.object3D, part: { type: p.type, rot: p.rot }, type: p.type };
        this.parts.set('__ghost__', fake);
        const snapped = this.snap('__ghost__', x, z, p.rot);
        this.parts.delete('__ghost__');
        ({ x, y, z, inserted } = snapped);
        p.boardId = snapped.boardId;
      }
    }
    p.x = x; p.z = z; p.inserted = inserted;
    p.object3D.position.set(x, y, z);
    p.object3D.rotation.y = p.rot;
  }

  rotatePlacement() {
    if (!this.placement) return;
    this.placement.rot = (this.placement.rot + Math.PI / 2) % (Math.PI * 2);
    this._movePlacement();
  }

  _commitPlacement() {
    const p = this.placement;
    if (!p) return;
    this.callbacks.onPlace?.({ type: p.type, x: p.x, z: p.z, rot: p.rot, inserted: p.inserted, y: p.object3D.position.y });
    this.cancelPlacement();
  }

  cancelPlacement() {
    if (!this.placement) return;
    this.scene.remove(this.placement.object3D);
    this.placement = null;
    this.canvas.style.cursor = 'default';
  }

  cancelWire() {
    this.pendingWire = null;
    this.previewWire.visible = false;
    this.controls.enabled = true;
  }

  // ----------------------------------------------------------------- views

  setView(name) {
    const target = new THREE.Vector3(0, 4, 0);
    const views = {
      iso: [-12, 108, 132],
      top: [0, 190, 0.001],
      front: [0, 34, 168],
      side: [172, 44, 0],
      angle: [96, 78, 96],
    };
    const p = views[name] ?? views.iso;
    this._tweenCamera(new THREE.Vector3(...p), target);
  }

  frameAll() {
    const box = new THREE.Box3();
    let any = false;
    for (const [, entry] of this.parts) { box.expandByObject(entry.object3D); any = true; }
    if (!any) return this.setView('iso');
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.62, 40);
    const dir = new THREE.Vector3(-0.1, 0.78, 0.92).normalize();
    this._tweenCamera(center.clone().add(dir.multiplyScalar(radius * 2.3)), center);
  }

  _tweenCamera(position, target) {
    this.tween = {
      from: this.camera.position.clone(), to: position,
      fromT: this.controls.target.clone(), toT: target,
      t: 0,
    };
  }

  // ------------------------------------------------------------------ loop

  _loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.tween) {
      this.tween.t = Math.min(1, this.tween.t + dt * 2.4);
      const e = 1 - Math.pow(1 - this.tween.t, 3);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, e);
      this.controls.target.lerpVectors(this.tween.fromT, this.tween.toT, e);
      if (this.tween.t >= 1) this.tween = null;
    }
    this.controls.update();
    this.callbacks.onFrame?.(dt, this.clock.elapsedTime);
    // Let every part animate itself (glowing LEDs, spinning motors, meters).
    for (const [, entry] of this.parts) {
      entry.object3D.userData.update?.(entry.part, this.clock.elapsedTime);
    }
    if (this.selection && !this.dragState) this._syncSelection();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.renderer.dispose();
  }
}

/** A jumper wire: a soft arc between two points, like real hookup wire. */
function wireGeometry(a, b, slack = 1) {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const dist = a.distanceTo(b);
  mid.y += (6 + dist * 0.16) * slack;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  return new THREE.TubeGeometry(curve, Math.max(10, Math.round(dist / 4)), 0.62, 8, false);
}

const COLD = new THREE.Color(0x2f6bff);
const ZERO = new THREE.Color(0x3a3f4a);
const HOT = new THREE.Color(0xff453a);

export function voltageColor(v, vmax = 9) {
  const t = Math.max(-1, Math.min(1, v / Math.max(vmax, 0.5)));
  const c = new THREE.Color();
  if (t >= 0) c.copy(ZERO).lerp(HOT, Math.pow(t, 0.65));
  else c.copy(ZERO).lerp(COLD, Math.pow(-t, 0.65));
  return c;
}
