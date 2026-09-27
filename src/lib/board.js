import { G } from './catalog.js';

export const BOARD = { w: 88, d: 50, h: 9 };
export const ROW_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
export const COLS = 30;

export const colX = (c) => (c - (COLS - 1) / 2) * G;
export const rowZ = (r) => (r < 5 ? -(3.81 + r * G) : 3.81 + (r - 5) * G);

/** Every hole on a half-size board, with the strip (net) it belongs to. */
export function BreadBaiHoles() {
  const holes = [];
  for (let c = 0; c < COLS; c++) {
    const x = colX(c);
    for (let r = 0; r < 10; r++) {
      holes.push({
        name: `${ROW_LETTERS[r]}${c + 1}`,
        group: r < 5 ? `T${c}` : `B${c}`,
        x, z: rowZ(r), col: c, row: r,
      });
    }
  }
  const rails = [
    { z: -22.2, group: 'tneg', sign: '−' }, { z: -19.66, group: 'tpos', sign: '+' },
    { z: 19.66, group: 'bpos', sign: '+' }, { z: 22.2, group: 'bneg', sign: '−' },
  ];
  for (const rail of rails) {
    for (let i = 0; i < 25; i++) {
      holes.push({
        name: `${rail.group}${i + 1}`, group: rail.group, rail: rail.sign,
        x: -33.02 + i * G + Math.floor(i / 5) * 1.27, z: rail.z, col: i, row: -1,
      });
    }
  }
  return holes;
}

let cache = null;
export const HOLES = () => (cache ??= BreadBaiHoles());
export const holeByName = (name) => HOLES().find((h) => h.name === name);
