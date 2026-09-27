import { board, loose, pinRef, hole, wire, seat, getExample } from './examples.js';
import { firstOf, partsOf, isSeated, touches } from './inspect.js';
import { diagnose } from './diagnose.js';
import { extractNetlist, applyImport } from '../pcb/netlist.js';
import { newPcb, partPads, pid } from '../pcb/model.js';
import { routePath } from '../pcb/routing.js';
import { addPart, newAssembly } from '../mech/assembly.js';
import { getMechPreset } from '../mech/presets.js';
import { mechChecks } from '../mech/checks.js';

/**
 * Guided lessons. Every step either
 *   - has a `check(ctx)` that is evaluated against the live circuit a few times
 *     a second (so the lesson notices when you've done the thing), or
 *   - has a `quiz` (multiple choice with an explanation), or
 *   - is a plain "read this" step with a Got-it button.
 *
 * ctx = { doc, circuit, mode, selection, running, events }
 * `events` is the set of things the user did during *this* step ("rotated",
 * "prop:led:color", …) and is cleared whenever the step changes.
 */

const HALF_PI = Math.PI / 2;

/** Battery on the left, already wired to the top power rails. */
function poweredBoard(extra = []) {
  const bb = board();
  const batt = loose('battery', -68, 26, { rot: -HALF_PI });
  return {
    parts: [bb, batt, ...extra],
    wires: [
      wire(pinRef(batt.id, 'pos'), hole('tpos3'), '#ff453a'),
      wire(pinRef(batt.id, 'neg'), hole('tneg3'), '#48484a'),
    ],
  };
}


/** The LED circuit as a small, tidy PCB — optionally already routed. */
function pcbFirstBoard(routed) {
  const doc = applyImport(newPcb(), extractNetlist(getExample('first-light').build()));
  doc.board = { w: 40, h: 30, r: 2 };
  const spot = { 'axial-10.16': [20, 10], 'led-5mm': [20, 20], 'terminal-2': [8, 15] };
  for (const p of doc.parts) [p.x, p.y] = spot[p.fp];
  if (routed) {
    const pad = (fp, n) => partPads(doc.parts.find((p) => p.fp === fp)).find((q) => q.n === n);
    const run = (layer, a, b, mode, flip, width) => {
      const pts = routePath(a, b, mode, flip);
      pts.slice(1).forEach((q, i) => doc.tracks.push({ id: pid('t'), layer, width, a: { x: pts[i].x, y: pts[i].y }, b: { x: q.x, y: q.y } }));
    };
    run('top', pad('terminal-2', '1'), pad('axial-10.16', 'a'), '45', true, 0.8);
    run('top', pad('axial-10.16', 'b'), pad('led-5mm', 'a'), '45', false, 0.5);
    run('bottom', pad('led-5mm', 'k'), pad('terminal-2', '2'), '90', true, 0.8);
  }
  return doc;
}

const cleanBoard = ({ analysis }) => !!analysis && analysis.stats.errors === 0 && analysis.stats.unrouted === 0;

const quiz = (question, options, answer, why) => ({ question, options, answer, why });

const lit = (part) => (part?.state?.brightness ?? 0);

export const LESSONS = [
  // ----------------------------------------------------------------- 1
  {
    id: 'basics',
    title: 'Meet the breadboard',
    level: 'Beginner',
    minutes: 4,
    summary: 'How the hidden strips join holes together — the one idea every breadboard circuit depends on.',
    learn: ['Strips, rails and the centre gap', 'Seating parts', 'Using the Connections view'],
    setup: () => ({ parts: [board()], wires: [] }),
    solution: () => getExample('first-light').build(),
    steps: [
      {
        title: 'A board full of secret wiring',
        body: 'A breadboard looks like a plain grid of holes, but underneath, metal strips join them. In each short column, the **five holes A–E are one connection**, and the five holes F–J are another. The long rows along the edges (the **rails**) run the full length and are meant for power.',
      },
      {
        title: 'Reveal the hidden wiring',
        body: 'Switch the toolbar at the top from **Standard** to **Connections**. Holes that share a colour are the same electrical node.',
        hint: 'Look for the three buttons at the top of the canvas: Standard · Voltage · Connections.',
        check: ({ mode }) => mode === 'nets',
      },
      {
        title: 'Place a resistor',
        body: 'Pick **Resistor** from the Components list on the left, then click on the board. Its legs snap into the 0.1″ hole grid. Press `R` to rotate before you click if you want it turned.',
        hint: 'Choose the resistor in the left panel, hover the board until the ghost snaps, then click.',
        check: ({ doc }) => partsOf(doc, 'resistor').some(isSeated),
      },
      {
        title: 'Share a strip',
        body: 'Now place an **LED** so that one of its legs lands in the **same column** as one of the resistor’s legs. Those two legs are now wired together — no jumper needed. Watch the colours in Connections view.',
        hint: 'Count the columns. If the resistor’s right leg is in column 10, put an LED leg in column 10 too (any row A–E).',
        check: ({ doc, circuit }) => {
          const r = partsOf(doc, 'resistor').find(isSeated);
          return !!r && partsOf(doc, 'led').some((l) => isSeated(l) && touches(circuit, r, l));
        },
      },
      {
        title: 'Quick check',
        body: 'Time to test the idea.',
        quiz: quiz(
          'A component leg is in hole **C12**. Which of these holes is electrically joined to it?',
          ['C13', 'A12', 'H12', 'C11'],
          1,
          'Column 12, rows A–E is one strip, so A12 is joined. C13 is a different column, and H12 is in the other half of the board — the centre gap separates them.',
        ),
      },
    ],
  },

  // ----------------------------------------------------------------- 2
  {
    id: 'first-led',
    title: 'Light an LED',
    level: 'Beginner',
    minutes: 8,
    summary: 'Build the classic first circuit, then learn — safely — why the resistor is not optional.',
    learn: ['Series circuits', 'LED polarity', 'Why LEDs need a resistor'],
    setup: () => poweredBoard(),
    solution: () => getExample('first-light').build(),
    steps: [
      {
        title: 'Power is ready',
        body: 'A 9 V battery is already wired to the two **power rails** at the top: **+ (red)** and **− (blue)**. An LED wired straight across 9 V would burn out in a heartbeat, so we need a **resistor** to limit the current: R = (9 V − 1.85 V) ÷ 15 mA ≈ **470 Ω**.',
      },
      {
        title: 'Place the resistor',
        body: 'Add a **Resistor** to the board. Set it to **470 Ω** in the inspector (a preset button is there).',
        hint: 'Select Resistor in the left list, click the board. Then click the 470 preset in the panel on the right.',
        check: ({ doc }) => partsOf(doc, 'resistor').some(isSeated),
      },
      {
        title: 'Place the LED',
        body: 'Add an **LED**. The **left** leg is the **anode (+)**; current flows anode → cathode. Put the LED so one leg shares a column with the resistor’s right leg.',
        hint: 'Both legs must be pushed into the board. The inspector says “2 of 2 leads seated” when they are.',
        check: ({ doc }) => partsOf(doc, 'led').some(isSeated),
      },
      {
        title: 'Complete the circuit',
        body: 'Pick the **Wire** tool (`W`) and click two holes to run a jumper. You need: **+ rail → resistor’s free leg**, and **LED’s free leg → − rail**. When the loop closes, the LED lights.',
        hint: 'Path: red rail → resistor → LED (long leg first) → blue rail. Use the top rail holes (the red and blue rows above the board).',
        check: ({ doc }) => partsOf(doc, 'led').some((l) => lit(l) > 0.25),
      },
      {
        title: 'LEDs are one-way',
        body: 'Select the LED and press `R` **twice** to turn it 180°. It goes dark — diodes only conduct anode → cathode. The **Circuit Check** button will tell you it looks backwards.',
        hint: 'Click the LED, then press R two times. One press turns it 90°, which lifts it out of the holes.',
        check: ({ doc }) => {
          const l = firstOf(doc, 'led');
          return !!l && isSeated(l) && lit(l) < 0.03;
        },
      },
      {
        title: 'Turn it back',
        body: 'Rotate the LED another 180° (`R` twice) so it lights again.',
        check: ({ doc }) => partsOf(doc, 'led').some((l) => isSeated(l) && lit(l) > 0.25),
      },
      {
        title: 'Now break it on purpose',
        body: 'Select the resistor and set it to **10 Ω**. Far too much current flows, and the LED **burns out**. Real LEDs do this silently, and it is the most common beginner casualty — here it costs nothing.',
        hint: 'Type 10 in the resistance box, or click the 10 preset.',
        check: ({ doc }) => partsOf(doc, 'led').some((l) => l.state?.burnt),
      },
      {
        title: 'Recover',
        body: 'Set the resistor back to **470 Ω**, then press **Reset (↺)** in the bottom bar to fit a fresh LED. It should light again.',
        hint: 'Reset clears burnt parts and capacitor charge.',
        check: ({ doc }) => {
          const r = firstOf(doc, 'resistor');
          return !!r && r.props.resistance >= 300 && partsOf(doc, 'led').some((l) => !l.state?.burnt && lit(l) > 0.25);
        },
      },
    ],
  },

  // ----------------------------------------------------------------- 3
  {
    id: 'ohms-law',
    title: 'Ohm’s law with real meters',
    level: 'Beginner',
    minutes: 8,
    summary: 'Predict, then measure. Voltage, current and resistance are tied together by one equation.',
    learn: ['V = I × R', 'Ammeters in series, voltmeters in parallel', 'Power and heat'],
    setup: () => {
      const bb = board();
      const supply = loose('supply', -68, 28, { rot: -HALF_PI, props: { voltage: 5 } });
      const r = seat('resistor', 'B10', { props: { resistance: 1000 } });
      const amm = loose('ammeter', -14, -46);
      const volt = loose('voltmeter', 26, -46);
      return {
        parts: [bb, supply, r, amm, volt],
        wires: [
          wire(pinRef(supply.id, 'pos'), hole('tpos3'), '#ff453a'),
          wire(pinRef(supply.id, 'neg'), hole('tneg3'), '#48484a'),
          wire(pinRef(amm.id, 'pos'), hole('tpos10'), '#ff453a'),
          wire(pinRef(amm.id, 'neg'), hole('A10'), '#ffd60a'),
          wire(hole('A14'), hole('tneg15'), '#48484a'),
          wire(pinRef(volt.id, 'pos'), hole('C10'), '#ffd60a'),
          wire(pinRef(volt.id, 'neg'), hole('C14'), '#64d2ff'),
        ],
      };
    },
    solution: null,
    steps: [
      {
        title: 'The circuit is built for you',
        body: 'A 5 V supply pushes current through the **ammeter** (wired **in series** — the current passes *through* it) and a **1 kΩ resistor**. The **voltmeter** sits **in parallel** — across the resistor — measuring the voltage on it. Ohm’s law: **V = I × R**.',
      },
      {
        title: 'Predict',
        body: 'Predictions make you learn faster. Work it out first.',
        quiz: quiz('5 V across a 1 kΩ resistor. What current will the ammeter show?', ['500 µA', '5 mA', '50 mA', '5 A'], 1, 'I = V ÷ R = 5 ÷ 1000 = 0.005 A = 5 mA. Select the ammeter to see its reading in the inspector, or read its LCD.'),
      },
      {
        title: 'Raise the voltage',
        body: 'Select the **Bench supply** and drag **Output** up to **9 V**. Watch both meters respond.',
        hint: 'Click the supply on the left of the board; the slider is in the inspector.',
        check: ({ doc }) => Math.abs((firstOf(doc, 'supply')?.props.voltage ?? 0) - 9) < 0.15,
      },
      {
        title: 'Predict again',
        body: 'Same 9 V, but the resistor is about to double.',
        quiz: quiz('At 9 V, a **2 kΩ** resistor. Current?', ['2.25 mA', '4.5 mA', '9 mA', '18 mA'], 1, 'I = 9 ÷ 2000 = 4.5 mA. Twice the resistance, half the current at the same voltage.'),
      },
      {
        title: 'Check your prediction',
        body: 'Select the **resistor**, set it to **2 kΩ** (or type `2k`), and confirm the ammeter reads about 4.5 mA.',
        hint: 'You can type 2k, 2.2k or 4k7 straight into the value box.',
        check: ({ doc }) => {
          const amm = firstOf(doc, 'ammeter');
          return !!amm && Math.abs(Math.abs(amm.state?.reading ?? 0) - 4.5e-3) < 3e-4;
        },
      },
      {
        title: 'Where does the energy go?',
        body: 'Every watt going into a resistor comes out as heat: **P = V × I = V² ÷ R**.',
        quiz: quiz('9 V across 2 kΩ. How much heat does the resistor produce?', ['4.5 mW', '40 mW', '400 mW', '4 W'], 1, 'P = 9 × 0.0045 = 0.0405 W ≈ 40 mW. A quarter-watt (250 mW) resistor handles that easily.'),
      },
      {
        title: 'Cook a resistor',
        body: 'A ¼ W resistor is only rated for **250 mW**. Lower the resistor value until it exceeds that at 9 V. Then open **Circuit Check** to see the warning the simulator raises.',
        hint: 'P = V² ÷ R, so R below about 324 Ω at 9 V. Try 100 Ω.',
        check: ({ doc }) => (firstOf(doc, 'resistor')?.state?.power ?? 0) > 0.25,
      },
    ],
  },

  // ----------------------------------------------------------------- 4
  {
    id: 'rc-circuit',
    title: 'Capacitors and time',
    level: 'Intermediate',
    minutes: 10,
    summary: 'Watch a capacitor charge through a resistor and discover the time constant τ = R × C.',
    learn: ['Charging curves', 'The time constant', 'Changing R or C to change timing'],
    startPaused: true,
    setup: () => {
      const bb = board();
      const supply = loose('supply', -68, 28, { rot: -HALF_PI, props: { voltage: 5 } });
      const r = seat('resistor', 'B6', { props: { resistance: 10e3 } });
      const c = seat('capacitor', 'D10', { props: { capacitance: 100e-6 } });
      const volt = loose('voltmeter', 26, -46);
      return {
        parts: [bb, supply, r, c, volt],
        wires: [
          wire(pinRef(supply.id, 'pos'), hole('tpos3'), '#ff453a'),
          wire(pinRef(supply.id, 'neg'), hole('tneg3'), '#48484a'),
          wire(hole('tpos8'), hole('A6'), '#ff453a'),
          wire(hole('A11'), hole('tneg12'), '#48484a'),
          wire(pinRef(volt.id, 'pos'), hole('C10'), '#ffd60a'),
          wire(pinRef(volt.id, 'neg'), hole('tneg20'), '#48484a'),
        ],
      };
    },
    solution: null,
    steps: [
      {
        title: 'A resistor and a capacitor',
        body: 'A 5 V supply feeds a **10 kΩ resistor** which charges a **100 µF capacitor**. The voltmeter shows the voltage across the capacitor. The simulation starts **paused** at 0 s so you see it from the very beginning.',
      },
      {
        title: 'Press play',
        body: 'Press the blue **▶** button at the bottom (or the space bar) and watch the voltmeter climb — quickly at first, then slower and slower.',
        check: ({ running, circuit }) => running && circuit.time > 0.4,
      },
      {
        title: 'Predict the time constant',
        body: 'The **time constant τ = R × C** is how long the capacitor takes to reach 63 % of the supply.',
        quiz: quiz('R = 10 kΩ, C = 100 µF. What is τ?', ['0.1 s', '1 s', '10 s', '100 s'], 1, 'τ = 10 000 Ω × 0.0001 F = 1 s. After 1 s the capacitor is at 63 % of 5 V (3.16 V); after 5τ it is 99 % charged.'),
      },
      {
        title: 'Wait for a full charge',
        body: 'Keep running until the capacitor is essentially full — about **5 seconds** (five time constants). Turn the speed up to **4×** if you like.',
        check: ({ doc }) => (firstOf(doc, 'capacitor')?.state?.v ?? 0) > 4.9,
      },
      {
        title: 'Make it ten times slower',
        body: 'Select the **capacitor** and set it to **1 mF** (1000 µF), ten times bigger. Predict: τ is now 10 s.',
        hint: 'Type 1m into the value box, or click the 1 mF preset.',
        check: ({ doc }) => (firstOf(doc, 'capacitor')?.props.capacitance ?? 0) >= 900e-6,
      },
      {
        title: 'Test the prediction',
        body: 'Press **Reset (↺)**, then **▶**. When the clock reads **10 s** the voltmeter should show about **3.2 V** — 63 % of 5 V. Use **4×** speed to get there sooner.',
        hint: 'Reset returns the clock to 0 and discharges the capacitor.',
        check: ({ doc, circuit }) => {
          const v = firstOf(doc, 'capacitor')?.state?.v ?? 0;
          return circuit.time >= 9.5 && circuit.time < 12 && v > 2.9 && v < 3.6;
        },
      },
    ],
  },

  // ----------------------------------------------------------------- 5
  {
    id: 'transistor-switch',
    title: 'A light-activated lamp',
    level: 'Intermediate',
    minutes: 8,
    summary: 'A light sensor and a transistor turn a lamp on when it gets bright — the transistor as an amplifier-switch.',
    learn: ['Voltage dividers', 'The transistor as a switch', 'Tuning a threshold'],
    setup: () => getExample('light-lamp').build(),
    solution: null,
    steps: [
      {
        title: 'How it works',
        body: 'The **light sensor (LDR)** and the **potentiometer** form a **voltage divider**. Its middle point feeds the **transistor’s base**. Once that voltage passes about 0.65 V the transistor conducts and lets a much larger current through the lamp.',
      },
      {
        title: 'Darken the room',
        body: 'Select the **light sensor** and drag its **Light level** slider **all the way down**. The lamp fades out.',
        hint: 'Click the light sensor (the small round part on the board); the slider is in the inspector.',
        check: ({ doc }) => {
          const ldr = firstOf(doc, 'ldr');
          return !!ldr && ldr.props.light <= 0.05 && lit(firstOf(doc, 'led')) < 0.12;
        },
      },
      {
        title: 'Bring in the sun',
        body: 'Drag **Light level** up to **90 %**. More light → lower LDR resistance → higher base voltage → the transistor opens and the lamp glows. Notice it doesn’t snap on: between roughly 5 % and 30 % light it fades in, because the transistor is briefly acting as an amplifier rather than a switch.',
        check: ({ doc }) => {
          const ldr = firstOf(doc, 'ldr');
          return !!ldr && ldr.props.light >= 0.85 && lit(firstOf(doc, 'led')) > 0.3;
        },
      },
      {
        title: 'Why is a transistor needed?',
        body: 'Think about how little current the divider can supply.',
        quiz: quiz('What is the transistor doing here?', [
          'Producing light',
          'Using a tiny base current to control a much larger lamp current',
          'Storing charge',
          'Reducing the battery voltage',
        ], 1, 'The transistor is a current amplifier. A fraction of a milliamp into the base lets tens of milliamps flow through the collector — enough to drive the lamp, which the LDR could never do directly.'),
      },
      {
        title: 'Tune the threshold',
        body: 'Select the **potentiometer** and move its **Position** slider. This moves the light level at which the lamp switches on — it’s the sensitivity control.',
        check: ({ events }) => events.has('prop:potentiometer:wiper'),
      },
    ],
  },

  // ----------------------------------------------------------------- 6
  {
    id: 'challenge-two-leds',
    title: 'Challenge: two LEDs',
    level: 'Challenge',
    minutes: 10,
    summary: 'No instructions this time. Light two LEDs from one 9 V battery and make Circuit Check happy.',
    learn: ['Series vs parallel', 'Planning a circuit', 'Reading diagnostics'],
    setup: () => poweredBoard(),
    solution: null,
    steps: [
      {
        title: 'The brief',
        body: 'Light **two LEDs at once** from the 9 V battery. You have complete freedom: **two LEDs in series with one resistor**, or **two branches in parallel**, each with its own resistor. Neither may burn out.',
      },
      {
        title: 'Build it',
        body: 'Both LEDs must be glowing.',
        hint: 'Series is easiest: rail → resistor → LED → LED → rail. The LEDs share the same current.',
        check: ({ doc }) => partsOf(doc, 'led').filter((l) => lit(l) > 0.25).length >= 2,
      },
      {
        title: 'Keep the doctor happy',
        body: 'Open **Circuit Check** in the toolbar. It reads your circuit like a teacher would. Fix anything it warns about — a resistor that is too small, a lead that goes nowhere — while both LEDs stay lit. When the list is clean, you’re done.',
        hint: 'The Circuit Check button sits at the right end of the toolbar at the top of the canvas.',
        check: ({ doc, circuit, events }) => {
          const bad = diagnose(doc, circuit).filter((d) => d.level !== 'info');
          return events.has('doctor') && bad.length === 0 && partsOf(doc, 'led').filter((l) => lit(l) > 0.25).length >= 2;
        },
      },
      {
        title: 'Series maths',
        body: 'Last question — think about how voltages add.',
        quiz: quiz('Two red LEDs (≈ 1.9 V each) and a 470 Ω resistor in series on 9 V. Roughly how much current?', ['5 mA', '11 mA', '20 mA', '32 mA'], 1, 'Both LEDs drop about 3.8 V, leaving ≈ 5.2 V across the resistor: 5.2 ÷ 470 ≈ 11 mA. In series the same current flows through every part; in parallel every branch sees the same voltage.'),
      },
    ],
  },

  // ----------------------------------------------------------------- 7
  {
    id: 'pcb-first-board',
    bench: 'pcb',
    title: 'Design your first PCB',
    level: 'Intermediate',
    minutes: 12,
    summary: 'Turn the LED circuit into a real board: route copper tracks, satisfy the design rules and export files a factory can make.',
    learn: ['Pads, tracks and the ratsnest', 'Why copper on one layer can’t cross', 'Design rules and the DRC', 'Exporting Gerber files'],
    setup: () => pcbFirstBoard(false),
    solution: () => pcbFirstBoard(true),
    steps: [
      {
        title: 'From breadboard to board',
        body: 'On the breadboard, **wires** joined the parts. On a PCB, thin strips of **copper** do that job. Your LED circuit is already imported: three footprints, and **yellow dashed lines** (the *ratsnest*) showing every pair of pads that still needs a copper connection.',
      },
      {
        title: 'Route your first track',
        body: 'Pick the **Route** tool (`T`). Click a pad to start, then click the pad it should reach. The track snaps to pads, and a connection finishes as soon as you land on one. Use the **45° / 90° / Free** switch to change how corners are drawn.',
        hint: 'Start with the two pads joined by a dashed yellow line — for example the terminal’s pad 1 and the resistor’s left pad.',
        check: ({ pcb }) => pcb.tracks.length >= 1,
      },
      {
        title: 'Connect every net',
        body: 'Keep routing until **all three nets** are joined and the ratsnest is empty. Tracks on the **Top** and **Bottom** layers don’t touch — press `1` or `2` to switch layers, and `V` while routing drops a **via** to change layer mid-track.',
        hint: 'If a route would cross another track, do it on the other layer: press 2 before you start it.',
        check: ({ analysis }) => !!analysis && analysis.stats.unrouted === 0 && analysis.nets.length > 0,
      },
      {
        title: 'What if they cross?',
        body: 'Copper is a conductor, so **anything that touches is connected**.',
        quiz: quiz('Two tracks from different nets cross on the SAME layer. What happens?', [
          'Nothing — they pass over each other',
          'They short the two nets together',
          'The board etches more slowly',
          'The DRC widens the tracks',
        ], 1, 'Where copper overlaps on one layer it becomes one node, so those nets are shorted. The DRC flags it, and the fix is to reroute one of them on the other layer or with a via.'),
      },
      {
        title: 'Tighten the design rules',
        body: 'Etching at home is far less precise than a factory. Open the **Rules** tab on the right and load the **Home etch / hobby** preset — clearances and minimum widths grow. Then use the **DRC** tab on the left to fix anything it now flags, until you have **zero errors**.',
        hint: 'Clearance errors are usually fixed by nudging a track (select it, then edit its coordinates) or moving a part a little.',
        check: ({ pcb, analysis }) => pcb.rules.clearance >= 0.4 && cleanBoard({ analysis }),
      },
      {
        title: 'Why a clearance rule?',
        body: 'Every rule exists because a real process has limits.',
        quiz: quiz('Why does the DRC require a minimum gap between different nets?', [
          'To make the board look neat',
          'Etching and drilling are imprecise, so copper too close can bridge and short',
          'Because copper is expensive',
          'So the silkscreen fits',
        ], 1, 'Tolerances in etching, alignment and soldering mean two copper features closer than the rule can end up joined. Home etching needs about 0.4 mm; good fabs manage 0.15 mm or less.'),
      },
      {
        title: 'Export for manufacture',
        body: 'Open **File → Export for manufacture**. You get a ZIP of Gerber files (copper, solder mask, silkscreen, board outline) plus the drill file — exactly what board houses ask for.',
        check: ({ events }) => events.has('export'),
      },
    ],
  },

  // ----------------------------------------------------------------- 8
  {
    id: 'pcb-controls',
    bench: 'pcb',
    title: 'Take full control of the layout',
    level: 'Challenge',
    minutes: 10,
    summary: 'Grids, vias, per-net track widths, mounting holes and labels: the controls that turn a working board into a well-made one.',
    learn: ['Snapping and grid size', 'Vias and layer changes', 'Per-net track widths', 'Mounting holes and silkscreen'],
    setup: () => pcbFirstBoard(true),
    solution: null,
    steps: [
      {
        title: 'A routed board to experiment on',
        body: 'This board is already connected. Every control here is numeric and reversible (`⌘Z`), so try things. Everything you draw snaps to a **grid** and to **pads, vias and track ends** — both are switchable in the **Board** tab.',
      },
      {
        title: 'Change the grid',
        body: 'Open the **Board** tab and set the grid to **0.5 mm**. Fine grids give freedom; coarse ones (2.54 mm = 0.1″) keep parts aligned to breadboard-style pitch. `G` cycles through sizes.',
        check: ({ pcb }) => pcb.grid.size === 0.5,
      },
      {
        title: 'Drop a via',
        body: 'Pick the **Via** tool (`X`) and click on the board. A via is a plated hole joining top and bottom copper. Its size comes from **Rules → Via diameter / drill**.',
        check: ({ pcb }) => pcb.vias.length >= 1,
      },
      {
        title: 'Widen the power net',
        body: 'Open the **Nets** tab (left). Type **1.2** in the width box for **VCC** and press **Apply**. Wider tracks carry more current with less voltage drop — new tracks started from a VCC pad use this width automatically.',
        hint: 'The width box sits at the right of the VCC row; Apply resizes the tracks that already exist.',
        check: ({ pcb, analysis }) => {
          const vcc = pcb.tracks.filter((t) => analysis?.itemNet.get(t.id) === 'VCC');
          return vcc.length > 0 && vcc.every((t) => t.width >= 1.2);
        },
      },
      {
        title: 'Mounting holes',
        body: 'In the **Board** tab press **Add 4 mounting holes**. They are M3 footprints in the corners, checked by the DRC like any other copper.',
        check: ({ pcb }) => pcb.parts.filter((p) => p.fp === 'mount-m3').length >= 4,
      },
      {
        title: 'Label your board',
        body: 'Pick the **Text** tool (`S`), click on the board, then change the text in **Properties** — for example the project name or “+9V”. It goes on the silkscreen and is exported with the Gerber files.',
        check: ({ pcb }) => pcb.texts.length >= 1,
      },
      {
        title: 'Finish clean, then export',
        body: 'Widening a track can bring copper closer to a neighbour. Check the **DRC** tab and fix any errors so the board is fully connected with **zero errors** — then use **File → Export for manufacture** to produce your Gerber files.',
        hint: 'Select a wide track, look at its coordinates in Properties, and nudge it with the arrow keys, or reduce the width slightly.',
        check: ({ pcb, analysis, events }) => cleanBoard({ analysis }) && pcb.vias.length >= 1 && pcb.texts.length >= 1 && events.has('export'),
      },
    ],
  },

  // ----------------------------------------------------------------- 9
  {
    id: 'mech-gears',
    bench: 'mech',
    title: 'Build your first gear train',
    level: 'Beginner',
    minutes: 10,
    summary: 'Place a motor, add gears, and watch a real speed and torque trade-off happen in 3D.',
    learn: ['Placing and connecting parts', 'Gear ratios', 'Reading the live readout'],
    setup: () => { const doc = newAssembly('First gears'); addPart(doc, 'shaft', { x: 0, y: 0, z: 0 }); return doc; },
    solution: () => getMechPreset('gear-pair').build(),
    steps: [
      {
        title: 'A shaft, waiting for something to spin',
        body: 'A **shaft** is already on the board. Everything that rotates — gears, motors, flywheels — mounts on one. Pick **DC motor** from the Parts list and click the shaft to place it there.',
        hint: 'The Parts tab is open on the left. Click “DC motor”, then click the shaft in the 3D view.',
        check: ({ mech }) => mech.parts.some((p) => p.type === 'motor'),
      },
      {
        title: 'Add a second shaft and gear',
        body: 'Place another **shaft** a little to the side, then a **spur gear** on each shaft — click the parts list, then click the shaft you want it on.',
        hint: 'Place the new shaft first (click empty ground), then two gears, one per shaft.',
        check: ({ mech }) => mech.parts.filter((p) => p.type === 'shaft').length >= 2 && mech.parts.filter((p) => p.type === 'gear').length >= 2,
      },
      {
        title: 'Connect them',
        body: 'Switch to the **Connect** tool (`C`). Click the first gear, then the second. If they’re close enough they mesh automatically — otherwise open the **Check** tab and use “Snap to mesh” on the warning.',
        hint: 'The two gears don’t need to touch perfectly by eye — “Connect” does the precise alignment for you.',
        check: ({ mech }) => mech.links.some((l) => l.type === 'spur' || l.type === 'internal'),
      },
      {
        title: 'Press play',
        body: 'Press **▶** (or space) and watch the readout. If your two gears have a different number of teeth, they turn at different speeds — that’s the whole idea of a gear train.',
        check: ({ machine }) => machine && machine.t > 0.5,
      },
      {
        title: 'Read the ratio',
        body: 'Select the **output gear’s shaft** and look at the live readout in the Properties panel — its rpm.',
        quiz: quiz('A 12-tooth gear drives a 36-tooth gear. If the input spins at 300 rpm, roughly what does the output do?', ['300 rpm', '900 rpm', '100 rpm', '36 rpm'], 2, 'Speed ratio is the inverse of the tooth ratio: 300 × 12/36 = 100 rpm. Fewer teeth in, more teeth out means slower but stronger.'),
      },
    ],
  },

  // ---------------------------------------------------------------- 10
  {
    id: 'mech-motor-load',
    bench: 'mech',
    title: 'Motors, load and heat',
    level: 'Beginner',
    minutes: 8,
    summary: 'A motor spinning a flywheel, then working against a brake — real current, real heat.',
    learn: ['Torque vs speed', 'Why motors heat up under load', 'Reading the Mechanical Check'],
    setup: () => getMechPreset('dyno').build(),
    solution: null,
    steps: [
      {
        title: 'A motor on a test bench',
        body: 'This is a **motor dyno**: a motor and flywheel, with a **brake** you can apply to load it — exactly how real motors get tested.',
      },
      {
        title: 'Spin it up free',
        body: 'Press **▶**. With the brake off, the motor accelerates the flywheel up to its no-load speed.',
        check: ({ machine }) => machine && machine.t > 1,
      },
      {
        title: 'Load it',
        body: 'Open the **Controls** tab and drag the brake’s **Apply** slider up to about **0.6**. The motor slows down, and current — and heat — go up. Watch the Properties panel’s live readout for the motor’s current and temperature.',
        hint: 'Select the motor, then check its readout at the bottom of the Properties tab, or switch to Controls to move the brake.',
        check: ({ mech }) => (mech.parts.find((p) => p.type === 'brake')?.apply ?? 0) >= 0.5,
      },
      {
        title: 'Predict the heat',
        body: 'More current means more I²R heating in the windings.',
        quiz: quiz('A motor draws 3× its rated current for a while. Roughly how much faster does it heat up?', ['3×', '6×', '9×', 'No change'], 2, 'Heating power is I²R — current squared. Three times the current is nine times the heat. This is why stalling a motor is so damaging.'),
      },
      {
        title: 'Push it too far',
        body: 'Raise the brake toward **1.0** and leave it there. Open the **Check** tab and wait for a warning about the motor overheating.',
        hint: 'This can take a few seconds of simulated time — let it run.',
        check: ({ machine, mech }) => { const m = mech.parts.find((p) => p.type === 'motor'); return !!m && (machine?.st.get(m.id)?.T ?? 0) > 80; },
      },
    ],
  },

  // ---------------------------------------------------------------- 11
  {
    id: 'mech-linear',
    bench: 'mech',
    title: 'Turning rotation into straight-line motion',
    level: 'Intermediate',
    minutes: 10,
    summary: 'Rack and pinion, lead screw, crank-slider: three ways to turn spinning into moving.',
    learn: ['Rack and pinion', 'Lead screws', 'Crank-sliders'],
    setup: () => getMechPreset('rack').build(),
    solution: null,
    steps: [
      {
        title: 'Rack and pinion',
        body: 'A small gearbox drives a **pinion** meshed with a **rack** — a straight toothed bar. Press **▶** and watch the rack slide.',
        check: ({ machine }) => machine && machine.t > 0.5,
      },
      {
        title: 'Reverse it',
        body: 'Select the **motor** and, in Controls, set **Duty** to a negative value (try **−0.1**). The rack should slide back the other way.',
        hint: 'Duty is on the Controls tab. Negative duty reverses the motor.',
        check: ({ mech }) => (mech.parts.find((p) => p.type === 'motor')?.duty ?? 0) < 0,
      },
      {
        title: 'A lead screw does it more precisely',
        body: 'Open **Presets → Linear motion → Lead-screw stage**. A screw thread moves a nut a fixed distance — its **lead** — per turn. This is how 3D printers and CNC machines position things precisely.',
        check: ({ mech }) => mech.parts.some((p) => p.type === 'screw'),
      },
      {
        title: 'Lead calculation',
        body: 'The lead screw here has a 4 mm lead.',
        quiz: quiz('At 300 rpm, how fast does a 4 mm-lead screw move its nut?', ['4 mm/s', '20 mm/s', '1200 mm/s', '0.4 mm/s'], 1, '300 rpm = 5 turns/second. 5 × 4 mm = 20 mm/s. Lead screws trade speed for precision and force.'),
      },
      {
        title: 'A crank turns rotation into a piston stroke',
        body: 'Open **Presets → Linear motion → Crank-slider (piston engine)**. Press ▶. The piston’s travel is exactly **twice the crank throw** — the heart of every piston engine.',
        check: ({ mech }) => mech.parts.some((p) => p.type === 'crank'),
      },
    ],
  },

  // ---------------------------------------------------------------- 12
  {
    id: 'mech-vehicle',
    bench: 'mech',
    title: 'Build a driven vehicle',
    level: 'Challenge',
    minutes: 12,
    summary: 'No preset this time: connect a motor through gears to wheels on a rolling body, and pass the Mechanical Check.',
    learn: ['Wheels and rolling resistance', 'Gearing a drivetrain', 'Passing a real engineering check'],
    setup: () => { const doc = newAssembly('My vehicle'); addPart(doc, 'vehicle', { x: 0, y: 0, mass: 1.5, cdA: 0.03, w: 160, h: 26, d: 80, limits: true, min: -200, max: 5000 }); return doc; },
    solution: () => getMechPreset('car').build(),
    steps: [
      {
        title: 'The brief',
        body: 'A **vehicle body** is on the board. Give it an **axle shaft** carried by the vehicle, a **motor**, and at least **one wheel** connected to both the axle and the vehicle body. Use the Presets → Applications → “Electric car” for inspiration if you get stuck, or build your own.',
      },
      {
        title: 'Add the axle and motor',
        body: 'Place a **shaft**, set its **“Rides on”** property to the vehicle, then add a **motor** to that shaft.',
        hint: 'Select the shaft after placing it — “Rides on” is in its Properties.',
        check: ({ mech }) => {
          const veh = mech.parts.find((p) => p.type === 'vehicle');
          return !!veh && mech.parts.some((p) => p.type === 'shaft' && p.carrier === veh.id) && mech.parts.some((p) => p.type === 'motor');
        },
      },
      {
        title: 'Add a wheel and connect it',
        body: 'Add a **wheel** to the axle shaft, then use **Connect** to link the wheel to the **vehicle body** — that’s what turns rotation into rolling.',
        check: ({ mech }) => mech.links.some((l) => l.type === 'wheel'),
      },
      {
        title: 'Drive it',
        body: 'Press ▶ and give the motor some **Duty** in the Controls tab. The vehicle should accelerate.',
        check: ({ machine, mech }) => { const v = mech.parts.find((p) => p.type === 'vehicle'); return !!v && machine && Math.abs(machine.speed(v.id)) > 0.2; },
      },
      {
        title: 'Pass the check',
        body: 'Open the **Check** tab. Fix anything it flags — for example wheel-spin, if you gave it too much torque for too little grip — until there are **no errors**.',
        check: ({ mech, machine }) => mechChecks(mech, machine).issues.every((i) => i.level !== 'error'),
      },
    ],
  },
];

export const getLesson = (id) => LESSONS.find((l) => l.id === id) ?? null;
export const nextLessonId = (id) => {
  const i = LESSONS.findIndex((l) => l.id === id);
  return i >= 0 && i < LESSONS.length - 1 ? LESSONS[i + 1].id : null;
};
