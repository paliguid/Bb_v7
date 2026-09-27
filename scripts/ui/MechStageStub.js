export class MechStage {
  constructor() { this.cb = {}; globalThis.__mechStage = this; }
  on(n, f) { this.cb[n] = f; }
  emit(n, ...a) { return this.cb[n]?.(...a); }
  resize() {} dispose() {} sync(doc, sel) { this.doc = doc; this.sel = sel; } applyPoses() {}
  frameAll() {} setGhost() {} setGhostPose() {} pick() { return null; } groundPoint() { return { x: 0, y: 0, z: 0 }; }
  setSnapEnabled(enabled) { this.snapEnabled = !!enabled; }
  getSelectionBoxes() { return []; }
  snapDragDelta(ids, delta) { return delta; }
}
