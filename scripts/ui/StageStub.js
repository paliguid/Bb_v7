export class Stage {
  constructor() { this.cb = {}; globalThis.__stage = this; }
  on(n, f) { this.cb[n] = f; }
  emit(n, ...a) { return this.cb[n]?.(...a); }
  resize() {} dispose() {} sync(parts, wires, sel) { this.parts = parts; this.wires = wires; this.sel = sel; }
  updateProbe() {} frameAll() {} setView() {} beginPlacement() {} cancelPlacement() {} cancelWire() {} rotatePlacement() {}
}
