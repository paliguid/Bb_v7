# BreadBai — a 3D electronics lab

A browser-based 3D breadboard simulator built with React and three.js. Every part is a
procedural 3D model wired into a real circuit solver, so components behave the way their
physical counterparts do rather than playing an animation.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build:

```bash
npm run build
npm run preview
```

`dist/` must be served over HTTP (the ES modules will not load from a `file://` URL).

## How the simulation works

- `src/lib/solver.js` — modified nodal analysis with a Gaussian-elimination linear solver,
  voltage-source branch stamping, a VCCS stamp and a pn-junction limiter for Newton stability.
- `src/lib/circuit.js` — turns parts and jumper wires into nets with union-find (breadboard
  strips are pre-fused), allocates internal nodes, then runs a Newton loop per 1 ms timestep
  followed by a `post()` pass where parts integrate their own physics (motor inertia, LED
  thermal history, capacitor charge).
- `src/lib/catalog.js` — the 19 component models: Ebers-Moll transistor, Shockley diode with
  series resistance, backward-Euler capacitor, back-EMF DC motor, LDR with a log-linear light
  curve, function generator, meters, and so on. Each one declares its pins, its editable
  properties and its live readout.

Verified against textbook values: an LED on a 9 V battery through 470 Ω draws 14.8 mA at
Vf 2.01 V with the cell sagging to 8.97 V; a 10 kΩ × 100 µF RC reaches 5.686 V at one time
constant (theory: 5.693 V); a 2N2222 saturates at Vce 54 mV.

## Learn as you build

Press **L** (or the *Learn* button) to open the learning hub:

- **Lessons** — six guided lessons, from "how does a breadboard work" to a light-activated
  transistor lamp and an open-ended challenge. Each step is *checked against the live
  circuit*, so the lesson notices when you've actually done the thing. Quizzes ask for a
  prediction first, then you measure it with the simulated meters.
- **Component guide** — what every part is, how to use it, the classic mistakes, and an
  *Add to board* button. The **?** in the inspector jumps straight to that part's page.
- **Cheat sheet** — breadboard anatomy, key formulas, an LED resistor calculator and a
  resistor colour-band reader.

**Circuit Check** (toolbar) reads the wiring and the solved values and explains problems in
plain language: dead-end leads, backwards LEDs and capacitors, no series resistor, resistors
over their power rating, transistor bases driven without a resistor, an ammeter across a
supply, short circuits.

Lessons live in `src/lib/lessons.js`; adding one is a `setup()` that builds a starting
circuit plus a list of steps, each with a `check(ctx)`, a `quiz`, or just text.

## Mechanical workbench

Switch to **Mechanical** to design and simulate gears, motors, linkages and custom 3D parts, with
real physics: mass and inertia from actual geometry, gravity, friction, motor electrical dynamics,
gear efficiency, and stress checks. Everything renders in 3D (three.js) and runs at a real
timestep with an implicit, energy-conserving integrator (ROS2 — a second-order Rosenbrock method),
so stiff contacts like backlash and end-stops stay stable.

**Parts:** shafts, DC motors, generators, hand cranks, spur/bevel/internal/worm gears, pulleys and
belts (flat/V/timing/chain), rope drums, lead screws, planetary gearsets, differentials, flywheels,
cranks, cams, pendulum arms, wheels, propellers, wind rotors, disc brakes, torsion springs, linear
sliders/racks/weights/vehicles, and springs/dampers — about 30 in all, each with real engineering
parameters (module, teeth, material, friction, thermal mass, …) and named real-world presets (a
6 V hobby motor, an N20 gearmotor, a drill motor, an e-scooter hub motor, …).

**Custom 3D parts:** build from primitives (box, cylinder, tube, sphere, cone, torus, prism) or
**import an STL or OBJ file**. Mass, centre of mass and the full inertia tensor are computed
exactly from the triangle mesh via the divergence theorem — not estimated.

**Connections** are geometric, not manual: click **Connect** and pick two parts — gears mesh only
if their module, pressure angle and centre distance actually line up (with a one-click "snap to
mesh" fix and automatic tooth phasing so they don't visually collide); belts, racks, worms, cranks,
cams and rolling wheels have their own geometric rules, all explained in plain language when they
don't line up.

**Real physics, checked against textbook formulas:** motor spin-up time constants, pendulum and
torsion-spring periods, planetary-gear Willis equations, worm self-locking, belt slip limits,
propeller and wind-turbine aerodynamics, energy conservation, Lewis gear-tooth bending stress,
shaft torsional stress, and rotor burst speed are all verified in `scripts/verify-mech.mjs`
against closed-form solutions — not just "it runs without crashing."

**Mechanical Check** (left tab) is the engineering equivalent of Circuit Check: unmounted parts,
undercut gears, shafts running near their critical speed, overstressed gear teeth, motors
overheating or overcurrent, belts about to slip, flywheels near burst speed, cam followers losing
contact ("valve float"), and wheels about to spin — each with a plain-language explanation and a
number bar against the limit.

**Full control:** every part's every parameter is a numeric field or dropdown — nothing is fixed.
Live controls (motor duty/torque/target speed, brake apply, hand-crank torque, clutch engagement)
update the running simulation instantly, without resetting it. A **Scope** tab charts any signal
(speed, position, current, temperature, energy) live. **32 presets** across gear trains, linear
motion, dynamics and full applications (a winch, a robot arm, an electric car, a wind turbine, a
propeller lift stand) give a running start; four guided lessons teach gear ratios, motor heating,
linear-motion mechanisms, and building a driven vehicle from scratch.

## Systems: combine everything

The **Systems** tab (inside the Mechanical workbench) links a motor on your **Breadboard** circuit
to a motor here set to **Drive → From a circuit**. Both simulators then run together, stepped in
lockstep: real current from the circuit drives the mechanism's shaft (torque = Kt·current), and
whatever mechanical load the shaft feels shows up back on the breadboard as current draw
(back-EMF = Kt·speed) — exactly the physical relationship a real motor has, just split across two
simulators that otherwise know nothing about each other. This is how you build a hand-designed
motor-driver circuit and watch it actually turn a winch, spin a propeller, or drive a wheeled
vehicle. `scripts/verify-systems.mjs` checks the coupled system against the same closed-form time
constant as an equivalent single motor+flywheel model.

## PCB workbench

Switch to **PCB** in the top bar to turn a circuit into a real, manufacturable board. It is a
precise 2D editor (millimetres, numeric fields everywhere) with two copper layers.

**Workflow:** build and simulate on the breadboard → **Import from breadboard** (Parts tab) →
arrange the footprints → route tracks until the yellow ratsnest is gone → clear the **DRC** →
**File → Export for manufacture** (Gerber + drill ZIP).

What you can control:

| | |
|---|---|
| **Board** | Width, height, corner radius, size presets, add 4 mounting holes, *Fit to parts* |
| **Grid & snapping** | 0.1 – 2.54 mm or any custom grid; snap to grid and/or to pads, vias and track ends |
| **Routing** | 45° / 90° / free corners, Space flips the corner, `V` drops a via and swaps layer, Backspace removes the last corner, per-track width |
| **Layers** | Top / bottom copper, top / bottom silkscreen: show, hide, dim the inactive layer, view the board from below |
| **Nets** | Per-net track width (VCC/GND default to 0.8 mm), *Apply* to resize existing tracks, hover to highlight a net |
| **Design rules** | Clearance, min width, annular ring, edge clearance, via size, mask margin; presets for home etching and fabs |
| **Editing** | Move / rotate / flip parts with tracks staying attached (switchable), lock parts, align and distribute, duplicate, undo/redo, click again to cycle overlapping objects, drag track ends |
| **Numbers** | Every object has X / Y / rotation / width / layer fields in *Properties* |

The **DRC** runs continuously and reports shorts and opens (checked against your breadboard
netlist), clearance, minimum width, annular ring, board-edge distance and dangling track ends;
click a result to zoom to it.

Shortcuts: `V` select · `T` route · `X` via · `S` text · `M` measure · `R` rotate · `F` flip side ·
`1`/`2` layer · `/` routing angle · `W` width · `G` grid · `N` snap · `0` fit · `⌘Z` undo.

Manufacturing output is real: RS-274X Gerber for both copper layers, solder mask, silkscreen and
board outline (with rounded corners), plus an Excellon drill file. Silkscreen text uses a built-in
stroke font so it exports as geometry. Two PCB lessons in the Learn hub walk through the whole flow.

Current limits: through-hole footprints only, parts rotate in 90° steps (so the DRC stays exact),
two layers, no copper pours or autorouter yet.

## Tests

```bash
npm test            # everything below
npm run verify      # headless logic: breadboard + PCB + mechanical engines, all lessons, Systems
npm run test:ui     # the real React app in jsdom (rendering stubbed): every workbench, every lesson
```

`verify` runs five suites: breadboard lessons and Circuit Check against the real solver; the PCB
engine (connectivity, ratsnest, every DRC rule, editing operations, Gerber/Excellon/ZIP output —
the ZIP is integrity-checked by Python's `zipfile`); the mechanical engine (about 70 checks against
closed-form physics: spin-up time constants, pendulum and gear-train equations, energy
conservation, stress limits); the four mechanical lessons; and the Systems (circuit↔mechanism)
coupling. `test:ui` mounts the real app in jsdom with only the WebGL/three.js rendering stubbed
out, so every button, panel, control and lesson runs through real state and real physics —
this caught several real bugs during development (a stale event-handler closure, a placement/lesson
UX mismatch, and a couple of test-script mistakes that looked like bugs but weren't).

## Controls

| | |
|---|---|
| Left drag | Orbit · Right drag pans · Scroll zooms |
| V / W | Select tool / wire tool |
| R | Rotate the selected part (also rotates a part being placed) |
| ⌘D / Delete | Duplicate / remove |
| Space | Run or pause |
| F, 1–4 | Frame all, then iso / top / front / side |
| ⌘Z, ⇧⌘Z, ⌘S | Undo, redo, save |

Pick a part from the left palette and click the board to seat it — leads snap to the 0.1"
hole grid and the strips they land in are listed in the inspector. Switch to the wire tool
and click two holes to run a jumper; click a jumper to remove it. Buttons and switches are
clickable in 3D, potentiometer knobs are draggable, and the Voltage / Connections view modes
recolour every hole and wire by node potential or by net.

## Layout

```
src/lib/      solver, netlist, component catalog, breadboard geometry, file format,
              lessons, guides, circuit diagnostics
src/pcb/      PCB workbench: footprints, connectivity + DRC, routing, editing operations,
              netlist import, Gerber/Excellon/SVG/ZIP export, editor UI
src/mech/     Mechanical workbench: 3D mesh kit + mass/inertia, part catalog, gear/belt/cam
              geometry and connection rules, the physics engine (machine.js), presets, checks,
              three.js rendering, editor UI
src/systems/  couples a breadboard motor to a mechanism motor (Systems)
src/three/    procedural 3D models and the scene / picking / snapping stage
src/ui/       palette, inspector, lesson coach, learn hub, circuit check, chrome, icons
src/App.jsx   document state, undo stack, simulation loop, lesson engine
scripts/      headless verification + jsdom UI tests
```

## Roadmap

- **PCB next:** copper pours (ground fill), SMD footprints, an autorouter for simple boards,
  arbitrary part rotation, a schematic view, and a 3D board preview.
- **Mechanical next:** SMD-style compliant/flexible bodies, contact between arbitrary custom meshes
  (today collisions are geometric-rule-based per connection type, not general rigid-body contact),
  more presets, and a richer Systems view (a combined 2D+3D screen instead of switching benches).
- More lessons: 555 timer, logic gates, H-bridge, op-amp basics; a Systems lesson.
