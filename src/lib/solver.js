// Modified Nodal Analysis engine.
// Node index -1 means ground (reference). Everything else indexes into the
// unknown vector: [node voltages ... , voltage-source branch currents ...].

export function solveLinear(A, b, n) {
  // Gaussian elimination with partial pivoting. A is row-major Float64Array.
  const x = new Float64Array(n);
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(A[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r * n + col]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-18) continue; // singular row, leave as zero
    if (piv !== col) {
      for (let c = 0; c < n; c++) {
        const t = A[col * n + c]; A[col * n + c] = A[piv * n + c]; A[piv * n + c] = t;
      }
      const t = b[col]; b[col] = b[piv]; b[piv] = t;
    }
    const d = A[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r * n + c] -= f * A[col * n + c];
      b[r] -= f * b[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r * n + c] * x[c];
    const d = A[r * n + r];
    x[r] = Math.abs(d) < 1e-18 ? 0 : s / d;
  }
  return x;
}

export class System {
  constructor(nodeCount, vsCount) {
    this.n = nodeCount + vsCount;
    this.nodeCount = nodeCount;
    this.A = new Float64Array(this.n * this.n);
    this.b = new Float64Array(this.n);
    this.x = new Float64Array(this.n);
    this.dt = 1e-3;
  }

  clear() {
    this.A.fill(0);
    this.b.fill(0);
    // gmin: a tiny leak to ground keeps floating islands solvable.
    for (let i = 0; i < this.nodeCount; i++) this.A[i * this.n + i] += 1e-10;
  }

  /** Voltage of a node from the last accepted solution. */
  v(i) { return i < 0 ? 0 : this.x[i]; }
  vd(a, b) { return this.v(a) - this.v(b); }
  /** Current through voltage-source branch k. */
  branchCurrent(k) { return this.x[this.nodeCount + k]; }

  addG(a, b, g) {
    if (!isFinite(g)) g = 1e12;
    const n = this.n, A = this.A;
    if (a >= 0) A[a * n + a] += g;
    if (b >= 0) A[b * n + b] += g;
    if (a >= 0 && b >= 0) { A[a * n + b] -= g; A[b * n + a] -= g; }
  }

  addR(a, b, R) { this.addG(a, b, 1 / Math.max(R, 1e-9)); }

  /** Current source pushing I amperes out of node a and into node b. */
  addI(a, b, I) {
    if (a >= 0) this.b[a] -= I;
    if (b >= 0) this.b[b] += I;
  }

  /** gm * (V(cp) - V(cn)) amperes flow out of node op and into node on. */
  addVCCS(op, on, cp, cn, gm) {
    const n = this.n, A = this.A;
    if (op >= 0 && cp >= 0) A[op * n + cp] += gm;
    if (op >= 0 && cn >= 0) A[op * n + cn] -= gm;
    if (on >= 0 && cp >= 0) A[on * n + cp] -= gm;
    if (on >= 0 && cn >= 0) A[on * n + cn] += gm;
  }

  /** Ideal voltage source: V(a) - V(b) = value, using branch slot k. */
  addVS(k, a, b, value) {
    const n = this.n, A = this.A;
    const r = this.nodeCount + k;
    if (a >= 0) { A[r * n + a] += 1; A[a * n + r] += 1; }
    if (b >= 0) { A[r * n + b] -= 1; A[b * n + r] -= 1; }
    this.b[r] += value;
  }

  solve() {
    const A = this.A.slice();
    const b = this.b.slice();
    return solveLinear(A, b, this.n);
  }
}

export const VT = 0.025852; // thermal voltage at ~300K

/** Keeps Newton-Raphson from stepping off the exponential cliff. */
export function limitJunction(vnew, vold, vt) {
  if (!isFinite(vnew)) return vold;
  if (vnew > 0.3 && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      vnew = arg > 0 ? vold + vt * Math.log(arg) : vold - 10 * vt;
    } else {
      vnew = vt * Math.log(Math.max(vnew / vt, 1e-3));
    }
  }
  return Math.max(vnew, -80);
}

/**
 * Stamps a PN junction between nodes a and b, updating `mem` (an object used
 * to remember the last junction voltage for limiting). Returns the current.
 */
export function stampDiode(sys, a, b, Is, nVt, mem, key) {
  let vd = sys.vd(a, b);
  vd = limitJunction(vd, mem[key] ?? 0, nVt);
  mem[key] = vd;
  const ex = Math.exp(Math.min(vd / nVt, 60));
  const I = Is * (ex - 1);
  let gd = (Is * ex) / nVt;
  if (gd < 1e-12) gd = 1e-12;
  sys.addG(a, b, gd);
  sys.addI(a, b, I - gd * vd);
  return I;
}
