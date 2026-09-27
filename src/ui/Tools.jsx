import { useState } from 'react';
import { colorBands, nextE12 } from '../lib/guides.js';
import { formatValue, parseValue } from '../lib/units.js';

export function LedCalculator() {
  const [supply, setSupply] = useState('9');
  const [vf, setVf] = useState('2');
  const [ma, setMa] = useState('15');

  const vs = parseFloat(supply), v = parseFloat(vf), i = parseFloat(ma) / 1000;
  const valid = vs > v && i > 0;
  const exact = valid ? (vs - v) / i : null;
  const std = exact ? nextE12(exact) : null;
  const power = std ? i * i * std : null;

  return (
    <div className="tool">
      <h4>LED resistor calculator</h4>
      <div className="tool-row">
        <label>Supply (V)<input type="number" value={supply} onChange={(e) => setSupply(e.target.value)} min="0" step="0.1" /></label>
        <label>LED volts<input type="number" value={vf} onChange={(e) => setVf(e.target.value)} min="0" step="0.1" /></label>
        <label>Current (mA)<input type="number" value={ma} onChange={(e) => setMa(e.target.value)} min="1" step="1" /></label>
      </div>
      <p className="tool-out">
        {valid
          ? <>Use <b>{formatValue(std, 'Ω')}</b> <span>(exact {formatValue(exact, 'Ω')}, dissipates {formatValue(power, 'W')})</span></>
          : <span>The supply must be higher than the LED voltage. Red ≈ 1.9 V, green ≈ 2.1 V, blue/white ≈ 3 V.</span>}
      </p>
    </div>
  );
}

export function ColorReader() {
  const [text, setText] = useState('4.7k');
  const ohms = parseValue(text, null);
  const bands = ohms ? colorBands(ohms) : null;

  return (
    <div className="tool">
      <h4>Resistor colour bands</h4>
      <div className="tool-row single">
        <label>Value<input type="text" value={text} spellCheck="false" onChange={(e) => setText(e.target.value)} placeholder="e.g. 4k7, 220, 1M" /></label>
      </div>
      {bands ? (
        <>
          <svg viewBox="0 0 200 44" className="resistor-svg" role="img" aria-label={`Bands: ${bands.map((b) => b.name).join(', ')}, gold`}>
            <line x1="0" y1="22" x2="200" y2="22" stroke="#9aa1a8" strokeWidth="3" />
            <rect x="34" y="8" width="132" height="28" rx="12" fill="#d8b98a" />
            {bands.map((b, i) => <rect key={i} x={58 + i * 24} y="8" width="9" height="28" fill={b.color} />)}
            <rect x="140" y="8" width="8" height="28" fill="#c9a227" />
          </svg>
          <p className="tool-out"><b>{formatValue(ohms, 'Ω')}</b> <span>= {bands.map((b) => b.name).join(' · ')} · gold (±5 %)</span></p>
        </>
      ) : <p className="tool-out"><span>Enter a value between 1 Ω and 99 GΩ.</span></p>}
    </div>
  );
}

export function Formulas() {
  const rows = [
    ['Ohm’s law', 'V = I × R'],
    ['Power', 'P = V × I = V² ÷ R'],
    ['Resistors in series', 'R = R₁ + R₂'],
    ['Resistors in parallel', 'R = (R₁ × R₂) ÷ (R₁ + R₂)'],
    ['Voltage divider', 'Vout = Vin × R₂ ÷ (R₁ + R₂)'],
    ['RC time constant', 'τ = R × C'],
    ['LED resistor', 'R = (Vsupply − Vf) ÷ I'],
  ];
  return (
    <div className="tool">
      <h4>Formulas you’ll use constantly</h4>
      <dl className="formulas">
        {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>
    </div>
  );
}

/** Labelled sketch of a breadboard: rails, strips and the centre gap. */
export function Anatomy() {
  const cols = 12;
  const hole = (x, y, key, color = '#5a5f6a') => <circle key={key} cx={x} cy={y} r="2.2" fill={color} />;
  const items = [];
  for (let c = 0; c < cols; c++) {
    const x = 62 + c * 20;
    for (let r = 0; r < 5; r++) items.push(hole(x, 58 + r * 12, `t${c}${r}`, c === 4 ? '#0a84ff' : undefined));
    for (let r = 0; r < 5; r++) items.push(hole(x, 122 + r * 12, `b${c}${r}`, c === 8 ? '#30d158' : undefined));
  }
  const rail = (y, color, key) => Array.from({ length: cols }, (_, c) => hole(62 + c * 20, y, `${key}${c}`, color));

  return (
    <div className="tool">
      <h4>Anatomy of a breadboard</h4>
      <svg viewBox="0 0 360 200" className="anatomy" role="img" aria-label="Diagram of a breadboard showing power rails, strips and the centre gap">
        <rect x="40" y="10" width="280" height="178" rx="10" fill="#22252b" stroke="#3a3e47" />
        <line x1="46" y1="28" x2="314" y2="28" stroke="#ff453a" strokeWidth="1.5" opacity="0.7" />
        <line x1="46" y1="42" x2="314" y2="42" stroke="#64d2ff" strokeWidth="1.5" opacity="0.7" />
        {rail(22, '#ff453a', 'p1')}{rail(36, '#64d2ff', 'n1')}
        <rect x="46" y="112" width="268" height="6" fill="#15171b" />
        {items}
        {rail(176, '#ff453a', 'p2')}{rail(184, '#64d2ff', 'n2')}
        <rect x="139" y="53" width="22" height="64" rx="8" fill="none" stroke="#0a84ff" strokeWidth="1.5" />
        <rect x="219" y="117" width="22" height="64" rx="8" fill="none" stroke="#30d158" strokeWidth="1.5" />
        <text x="330" y="26" fontSize="8.5" fill="#ff8a80">+ rail</text>
        <text x="330" y="40" fontSize="8.5" fill="#8fdcff">− rail</text>
        <text x="330" y="117" fontSize="8.5" fill="#9c9ca3">gap</text>
        <text x="10" y="80" fontSize="8.5" fill="#7cbcff">A–E</text>
        <text x="10" y="150" fontSize="8.5" fill="#6be08a">F–J</text>
      </svg>
      <ul className="tips">
        <li><b style={{ color: '#7cbcff' }}>Blue outline:</b> five holes, one strip — everything in it is joined.</li>
        <li><b style={{ color: '#6be08a' }}>Green outline:</b> the other half. The gap keeps the two halves separate.</li>
        <li><b>Rails</b> run the length of the board. Red = +, blue = −.</li>
      </ul>
    </div>
  );
}
