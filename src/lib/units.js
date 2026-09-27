const PREFIXES = [
  { e: 9, s: 'G' }, { e: 6, s: 'M' }, { e: 3, s: 'k' },
  { e: 0, s: '' }, { e: -3, s: 'm' }, { e: -6, s: 'µ' }, { e: -9, s: 'n' }, { e: -12, s: 'p' },
];

export function formatValue(value, unit = '', digits = 3) {
  if (value == null || !isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const v = Math.abs(value);
  if (v === 0) return `0 ${unit}`.trim();
  const p = PREFIXES.find((p) => v >= Math.pow(10, p.e)) ?? PREFIXES[PREFIXES.length - 1];
  const scaled = v / Math.pow(10, p.e);
  const str = scaled >= 100 ? scaled.toFixed(0) : scaled.toPrecision(digits);
  const trimmed = String(parseFloat(str));
  return `${sign}${trimmed} ${p.s}${unit}`.trim();
}

const MULT = { g: 1e9, meg: 1e6, m: 1e-3, k: 1e3, µ: 1e-6, u: 1e-6, n: 1e-9, p: 1e-12 };

/** Accepts "4k7", "4.7k", "10M", "220", "100n". Returns null when unusable. */
export function parseValue(text, fallback = null) {
  if (typeof text === 'number') return text;
  if (!text) return fallback;
  const t = String(text).trim().replace(/\s+/g, '').replace(/(ohm|Ω|F|H|V|A)$/i, '');
  const infix = t.match(/^(\d+)([a-zA-Zµ])(\d+)$/); // 4k7 style
  if (infix) {
    const mult = MULT[infix[2].toLowerCase()] ?? MULT[infix[2]];
    if (mult) return parseFloat(`${infix[1]}.${infix[3]}`) * mult;
  }
  const m = t.match(/^(-?[\d.]+)\s*(meg|[a-zA-Zµ])?$/);
  if (!m) return fallback;
  const num = parseFloat(m[1]);
  if (!isFinite(num)) return fallback;
  if (!m[2]) return num;
  const key = m[2] === 'M' ? 1e6 : (MULT[m[2].toLowerCase()] ?? MULT[m[2]]);
  return key ? num * key : num;
}

const BAND_COLORS = ['#101010', '#6b3f22', '#d5342b', '#e07b28', '#e6c62e',
  '#3f9c4a', '#2f63c4', '#7a4fb5', '#9a9a9a', '#f2f2f2'];
const TOL_COLORS = { 1: '#8d6a3f', 2: '#c33a3a', 5: '#c9a227', 10: '#c0c0c0' };

/** Four-band colour code for a resistance, used to paint the 3D body. */
export function resistorBands(ohms, tolerance = 5) {
  const v = Math.max(ohms, 0.1);
  let exp = Math.floor(Math.log10(v)) - 1;
  let mant = Math.round(v / Math.pow(10, exp));
  if (mant >= 100) { mant = Math.round(mant / 10); exp += 1; }
  if (mant < 10) { mant *= 10; exp -= 1; }
  const d1 = Math.floor(mant / 10), d2 = mant % 10;
  const mIdx = Math.max(0, Math.min(9, exp + 1));
  return [
    BAND_COLORS[d1] ?? BAND_COLORS[0],
    BAND_COLORS[d2] ?? BAND_COLORS[0],
    BAND_COLORS[mIdx],
    TOL_COLORS[tolerance] ?? TOL_COLORS[5],
  ];
}
