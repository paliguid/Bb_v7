import * as THREE from 'three';

/**
 * The mechanism's own math (math3.js, meshkit.js, assembly.js, machine.js) is a plain
 * right-handed frame with gravity along -Y (see machine.js: `G_DIR = [0, -1, 0]`) — i.e. it
 * already uses the exact same X-right, Y-up, Z-toward-viewer convention three.js does. So the
 * conversion here is the identity: no axis swap, no rescale. Millimetres are used directly as
 * three.js scene units. (An earlier version of this file remapped mech-Z to three's up axis,
 * which put every part's "up" at a right angle to gravity — everything rendered off its real
 * position. Keeping this note so that mistake doesn't get reintroduced.)
 */
export const toThreeV = (v) => new THREE.Vector3(v[0], v[1], v[2]);

/** Convert a mech-space 4×4 (column-major, math3.js convention, mm) into a three.js world matrix. */
export function matrixToThree(m) {
  return new THREE.Matrix4().set(
    m[0], m[4], m[8], m[12],
    m[1], m[5], m[9], m[13],
    m[2], m[6], m[10], m[14],
    0, 0, 0, 1,
  );
}

/** Build a BufferGeometry (mm) from a meshkit {positions, indices} mesh. */
export function toGeometry(mesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(mesh.positions), 3));
  if (mesh.indices.length) g.setIndex(mesh.indices);
  g.computeVertexNormals();
  return g;
}
