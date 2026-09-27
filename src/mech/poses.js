import { byId, componentMatrix, isShaftMounted, isSliderLike, restMatrix, shaftMatrix, sliderMatrix } from './assembly.js';
import { mul, trans } from './math3.js';

/**
 * Turns a Machine's `poses()` output (shaft angles in rad, slider/leaf positions in mm — see
 * machine.js) into the mech-space world matrix (mm) for one part. This is the single place that
 * combines rotation, sliding, AND a shaft's own carrier displacement (e.g. an axle riding on a
 * moving vehicle), so the renderer and anything else that needs a live pose stay consistent.
 *
 * `poses.slider[id]` and a part's own `x0` are both already in millimetres — matching
 * `sliderMatrix`'s and `shaftMatrix`'s own units — so neither is rescaled here.
 */
export function worldMatrixFor(doc, part, poses) {
  if (part.type === 'shaft') {
    const theta = poses.shaft[part.id] ?? 0;
    const disp = carrierDisp(doc, part, poses);
    return spinZ(shaftMatrix(doc, part, disp), theta);
  }
  if (isShaftMounted(part)) {
    const shaft = byId(doc, part.shaft);
    if (!shaft) return restMatrix(part);
    const theta = poses.shaft[shaft.id] ?? 0;
    const disp = carrierDisp(doc, shaft, poses);
    return componentMatrix(doc, part, theta, disp);
  }
  if (isSliderLike(part)) {
    const q = poses.slider[part.id] ?? part.x0 ?? 0;
    return sliderMatrix(part, q);
  }
  if (part.type === 'planetary' || part.type === 'differential') {
    // These are drawn as one static combined diagram (sun/ring/planets, or the cage housing), not
    // spun live with the simulation — but they still need to sit where their shafts actually are,
    // offset along that shaft's axis by the part's own "axial" parameter (like a shaft-mounted part).
    const refId = part.type === 'planetary' ? (part.sun || part.carrier || part.ring) : part.cage;
    const shaft = byId(doc, refId);
    if (!shaft) return restMatrix(part);
    const disp = carrierDisp(doc, shaft, poses);
    return mul(shaftMatrix(doc, shaft, disp), trans(0, 0, part.axial ?? 0));
  }
  return restMatrix(part);
}

/** How far (mm) the given shaft's carrier — if any — has moved from its rest position. */
function carrierDisp(doc, shaft, poses) {
  if (!shaft.carrier) return 0;
  const carrier = byId(doc, shaft.carrier);
  if (!carrier) return 0;
  const rest = carrier.x0 ?? 0;
  const now = poses.slider[carrier.id] ?? rest;
  return now - rest;
}

/** Rotate a rest matrix about its own local Z by theta radians (shafts spin about their own axis). */
function spinZ(M, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const rz = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const o = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) { let sum = 0; for (let k = 0; k < 4; k++) sum += M[k * 4 + row] * rz[col * 4 + k]; o[col * 4 + row] = sum; }
  return o;
}
