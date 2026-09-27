/**
 * Plain-language guide for every component: what it is, how to use it in the
 * simulator, and the classic mistakes. Keyed by catalog id.
 */
export const GUIDES = {
  BreadBai: {
    what: 'A solderless breadboard: a grid of spring-loaded holes you push component leads into. Hidden metal strips join holes together, so you can build and change circuits without a soldering iron.',
    how: [
      'Each short column of five holes (A–E, or F–J) is one connected strip. Anything pushed into the same column is joined.',
      'The gap down the middle separates the top half from the bottom half — that is what lets you fit chips across it.',
      'The long rows along the edges are power rails. Wire the battery + to the red rail and − to the blue rail, then tap power from anywhere along it.',
    ],
    watch: ['Two leads in the same column are wired together — a resistor with both legs in one column does nothing.', 'The top and bottom halves are NOT connected unless you add a jumper wire.'],
  },
  battery: {
    what: 'A 9 V alkaline block. It is not a perfect source — it has a little internal resistance, so its voltage sags when you draw more current.',
    how: ['Wire + to the red rail and − to the blue rail.', 'Change the voltage or internal resistance in the inspector to model other cells.'],
    watch: ['Never join + and − with just a wire. That is a short circuit.'],
    formula: 'V(terminal) = V(open) − I × R(internal)',
  },
  supply: {
    what: 'A bench power supply: an adjustable 0–30 V source with a very low output resistance.',
    how: ['Wire + and − to the rails just like a battery.', 'Drag the Output slider to change voltage live — great for watching how a circuit responds.'],
    watch: ['Start low and turn it up. Real supplies (and simulated LEDs) do not like surprises.'],
  },
  ground: {
    what: 'The 0 V reference. Voltages are always measured relative to some point; ground is that point.',
    how: ['You rarely need one: the simulator treats the negative terminal of your first power source as ground.', 'Add one explicitly if you want to choose a different reference point.'],
    watch: ['Use only one ground symbol per circuit.'],
  },
  resistor: {
    what: 'Limits current. It converts a voltage into a proportional current, and turns the difference into heat.',
    how: ['Pick a value in the inspector, or click a preset. The colour bands on the 3D part follow the value.', 'Put one in series with an LED, or use two as a voltage divider.'],
    watch: ['A ¼ W resistor overheats above 0.25 W (P = V² ÷ R).', 'Both legs in the same column = it does nothing.'],
    formula: "Ohm's law: V = I × R",
  },
  led: {
    what: 'A light emitting diode. It conducts in one direction only and glows when a few milliamps flow.',
    how: ['Long leg is the anode (+); it goes toward the positive side.', 'Always add a series resistor: R = (Vsupply − Vf) ÷ I.', 'Different colours have different forward voltages — red ≈ 1.9 V, blue and white ≈ 3 V.'],
    watch: ['No resistor = it burns out within a fraction of a second.', 'It lights in only one orientation. If it stays dark, rotate it 180°.'],
    formula: 'R = (Vsupply − Vf) ÷ I    e.g. (9 − 1.85) ÷ 0.015 ≈ 470 Ω',
  },
  diode: {
    what: 'A one-way valve for current. Conducts from anode to cathode above about 0.6 V and blocks the other way.',
    how: ['The stripe marks the cathode.', 'Use it for reverse-polarity protection or to stop a coil kicking back.'],
    watch: ['It always costs about 0.6–0.7 V when conducting.'],
  },
  capacitor: {
    what: 'Stores charge. Voltage across it cannot change instantly: it charges and discharges through whatever resistance is connected.',
    how: ['Pair it with a resistor to make a timing circuit.', 'Watch the voltage climb in the inspector readout or on a voltmeter.'],
    watch: ['Electrolytics are polarised — the + lead goes to the more positive side.', 'A big capacitor draws a large surge when first connected.'],
    formula: 'τ = R × C   (63 % charged after one τ, ~99 % after five)',
  },
  pushbutton: {
    what: 'A momentary tactile switch. Its four legs are joined in pairs; pressing connects the pairs.',
    how: ['Click and hold it in the 3D scene to press.', 'Enable “Stays down” in the inspector to make it latch.'],
    watch: ['Legs on the same side are always connected — wire across the gap, not along it.'],
  },
  toggle: {
    what: 'A single-pole double-throw switch. The common terminal connects to A or B.',
    how: ['Click the lever in the scene to flip it.', 'Switch to SPST mode for a simple on/off using COM and A.'],
    watch: ['In SPDT mode one output is always connected — nothing is ever truly “off” unless the unused side goes nowhere.'],
  },
  potentiometer: {
    what: 'A variable resistor with three terminals: the two ends of a resistive track and a movable wiper.',
    how: ['Drag the knob in the scene, or use the Position slider.', 'Ends across the supply, wiper as the output: a voltage divider you can tune.', 'Use the wiper and one end only for a simple variable resistor.'],
    watch: ['Do not connect the wiper straight to a supply — it can short across part of the track.'],
    formula: 'Vout = Vin × (wiper position)',
  },
  ldr: {
    what: 'A light sensor. Its resistance falls as light increases — from about a megohm in the dark to a few hundred ohms in bright light.',
    how: ['Drag the Light level slider to simulate brighter or darker conditions.', 'Pair it with a fixed resistor to make a light-dependent voltage divider.'],
    watch: ['It is slow and imprecise — fine for “light or dark”, poor for measuring lux.'],
  },
  transistor: {
    what: 'A 2N2222 NPN transistor: a tiny current into the base controls a much larger current from collector to emitter. Use it as a switch or an amplifier.',
    how: ['Pins left to right in the default orientation: E, B, C.', 'Put a resistor (1–10 kΩ) between your signal and the base.', 'Put the load (LED + resistor, motor…) between the supply and the collector; the emitter goes to ground.'],
    watch: ['Base straight to a supply = too much current.', 'It needs about 0.65 V between base and emitter to turn on.'],
    formula: 'Ic ≈ β × Ib   (β = gain, around 200 here) — until it saturates',
  },
  buzzer: {
    what: 'A piezo buzzer. It sounds when there is more than about 1.5 V across it.',
    how: ['Wire it across a supply through a switch, or drive it from a transistor.', 'Turn the sound toggle on in the top bar — browsers need a click before playing audio.'],
    watch: ['Polarity matters on most real buzzers.'],
  },
  motor: {
    what: 'A small brushed DC motor. It spins up gradually (inertia) and generates a back-EMF that opposes the supply as it speeds up.',
    how: ['Wire it across a supply, or switch it with a transistor.', 'Reverse the wires to reverse the direction.', 'Raise the Mechanical load slider to slow it down.'],
    watch: ['A stalled motor draws the most current.'],
    formula: 'I = (V − back-EMF) ÷ R(winding)',
  },
  seg7: {
    what: 'A seven-segment display: seven LEDs (plus a decimal point) shaped into a digit.',
    how: ['Wire a common pin to ground, then drive each segment a–g through its own resistor.', 'Light a, b, c, d, e, f for a “0”; b and c for a “1”.'],
    watch: ['Every segment is an LED — each needs its own series resistor.'],
  },
  voltmeter: {
    what: 'Measures the voltage between two points. It has a 10 MΩ input, so it barely disturbs the circuit.',
    how: ['Connect it in PARALLEL — across the part you want to measure.', 'Red (+) to the more positive side.'],
    watch: ['A negative reading just means the probes are swapped.'],
  },
  ammeter: {
    what: 'Measures current. It behaves like a near-perfect wire.',
    how: ['Connect it in SERIES — break the circuit and let the current flow through the meter.'],
    watch: ['Across a supply it becomes a short circuit. That is the classic beginner mistake.'],
  },
  funcgen: {
    what: 'A signal generator: a voltage that varies with time — square, sine or triangle — at a frequency you choose.',
    how: ['Wire OUT to your circuit and GND to the ground rail.', 'Sweep the frequency slider and watch a blinking LED follow it.'],
    watch: ['Its ground and your battery ground must be joined, or the circuit has no common reference.'],
  },
};

/** Resistor colour bands for a value in ohms (4-band, 2 significant digits). */
const BAND = ['#111111', '#7a4a21', '#e03b30', '#ff9500', '#ffd60a', '#30b85a', '#2f7dff', '#a55cff', '#8e8e93', '#f5f5f7'];
const BAND_NAME = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];

export function colorBands(ohms) {
  if (!(ohms >= 1)) return null;
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / Math.pow(10, exp));
  if (digits >= 100) { digits = Math.round(digits / 10); exp += 1; }
  if (exp < 0 || exp > 9) return null;
  const d1 = Math.floor(digits / 10), d2 = digits % 10;
  return [d1, d2, exp].map((n) => ({ color: BAND[n], name: BAND_NAME[n] }));
}

const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];

/** Smallest standard E12 value at or above `ohms` — rounding up keeps LEDs safe. */
export function nextE12(ohms) {
  if (!(ohms > 0)) return null;
  const decade = Math.pow(10, Math.floor(Math.log10(ohms)) - 1);
  for (const step of [...E12, 100]) if (step * decade >= ohms * 0.999) return step * decade;
  return null;
}
