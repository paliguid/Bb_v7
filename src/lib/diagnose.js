import { CATALOG } from './catalog.js';
import { formatValue } from './units.js';
import { netOf, pinPopulation } from './inspect.js';

/**
 * "Circuit Check": looks at the wiring and the live solution and explains, in
 * plain language, what a beginner most likely got wrong. Pure function — no
 * side effects, cheap enough to run several times a second.
 */

// Which pins a part genuinely needs. Each group is satisfied when at least one
// of its pins is attached to something. Parts not listed need every pin.
const NEEDS = {
  pushbutton: [['p1', 'p2'], ['p3', 'p4']],
  toggle: [['com'], ['a', 'b']],
  potentiometer: [['w'], ['t1', 't2']],
  seg7: [['com1', 'com2']],
  ground: [],
};

const LEVEL_ORDER = { error: 0, warn: 1, info: 2 };
const label = (def, pinName) => def.pins.find((p) => p.name === pinName)?.label ?? pinName;

export function diagnose(doc, circuit) {
  const out = [];
  if (!circuit) return out;
  const parts = doc.parts.filter((p) => !CATALOG[p.type]?.board);
  if (!parts.length) return out;

  const add = (level, rule, part, title, detail) =>
    out.push({ id: `${rule}:${part?.id ?? 'circuit'}`, level, rule, partId: part?.id ?? null, title, detail });

  const pop = pinPopulation(circuit);
  const sources = parts.filter((p) => CATALOG[p.type].groundPin);

  if (!sources.length) {
    add('info', 'no-power', null, 'Nothing is powered yet',
      'Add a battery or bench supply from the Power group, then wire its + and − terminals to the board.');
  }

  for (const part of parts) {
    const def = CATALOG[part.type];
    const name = def.name;
    const st = part.state ?? {};

    // ---- connectivity ------------------------------------------------------
    const connected = (pinName) => (pop.get(netOf(circuit, part, pinName)) ?? 0) >= 2;
    const groups = NEEDS[part.type] ?? def.pins.map((p) => [p.name]);
    const anyConnected = def.pins.some((p) => connected(p.name));

    if (!anyConnected && def.pins.length && part.type !== 'ground') {
      add('info', 'unconnected', part, `${name} isn't connected to anything`,
        'Push its leads into the board, or wire its terminals to a hole, so current has somewhere to flow.');
    } else {
      const missing = groups.filter((g) => !g.some(connected)).map((g) => label(def, g[0]));
      if (missing.length) {
        add('warn', 'open-pin', part, `${name}: ${missing.join(', ')} not connected`,
          'A lead that shares a strip with nothing else is a dead end — no current can flow through this part yet. '
          + 'Check that each lead sits in a strip (column) that another part or a wire also uses.');
      }
    }

    // ---- part-specific physics --------------------------------------------
    if (part.type === 'led') {
      if (st.burnt) {
        add('error', 'led-burnt', part, 'This LED burnt out',
          'It carried far more than its 20 mA rating for too long. Add or increase a series resistor, then press Reset (↺) to fit a new one.');
      } else if ((st.current ?? 0) > 0.03) {
        add('warn', 'led-current', part, `LED is drawing ${formatValue(st.current, 'A')}`,
          'LEDs like 5–20 mA. Put a resistor in series: R = (supply − LED voltage) ÷ current. For 9 V and a red LED at 15 mA that is about 470 Ω.');
      } else if ((st.voltage ?? 0) < -0.5 && connected('a') && connected('k')) {
        add('warn', 'led-reversed', part, 'The LED looks backwards',
          'Current only flows anode → cathode (long leg to short leg). Rotate it 180° with R.');
      }
    }

    if (part.type === 'capacitor' && (st.v ?? 0) < -0.7) {
      add('warn', 'cap-reversed', part, 'Capacitor is connected backwards',
        'Electrolytic capacitors are polarised. Reverse-biasing a real one can make it vent or pop. Swap its + and − leads.');
    }

    if (part.type === 'resistor' && (st.power ?? 0) > 0.25) {
      add('warn', 'resistor-hot', part, `Resistor is dissipating ${formatValue(st.power, 'W')}`,
        'A quarter-watt resistor would overheat and smoke here. Use a larger value, or a higher-power part.');
    }

    if (part.type === 'transistor' && Math.abs(st.ib ?? 0) > 5e-3) {
      add('warn', 'base-current', part, `Base current is ${formatValue(Math.abs(st.ib), 'A')}`,
        'Never drive a transistor base straight from a supply. Put a 1–10 kΩ resistor between the signal and the base.');
    }

    if (part.type === 'ammeter' && Math.abs(st.reading ?? 0) > 0.5) {
      add('error', 'ammeter-short', part, 'The ammeter is acting as a short circuit',
        'An ammeter is a near-perfect wire, so it must sit in series with the load — never across a supply.');
    }

    if (def.groundPin && Math.abs(st.current ?? 0) > 0.5) {
      add('error', 'short', part, `Short circuit — ${formatValue(Math.abs(st.current), 'A')} from the ${name.toLowerCase()}`,
        'Something joins + directly to − with almost no resistance. Follow the current path and add a load (a resistor) in between.');
    }
  }

  if (circuit.converged === false && circuit.time > 0.05) {
    add('warn', 'no-converge', null, "The simulator can't settle on an answer",
      'This usually means a loop of ideal sources or an extremely unrealistic circuit. Try removing the last part you added.');
  }

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
