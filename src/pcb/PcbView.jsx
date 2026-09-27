import { memo, useMemo } from 'react';
import { FOOTPRINTS, footprintBounds } from './footprints.js';
import { COLORS } from './export.js';
import { buildScene, SILK_W } from './scene.js';
import { toWorld } from './model.js';

const dim = (on) => (on ? 1 : 0.28);

function Pad({ p, fill, hole, label, labelColor, opacity }) {
  return (
    <g opacity={opacity}>
      {p.shape === 'rect'
        ? <rect x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} fill={fill} />
        : Math.abs(p.w - p.h) < 1e-6
          ? <circle cx={p.x} cy={p.y} r={p.w / 2} fill={fill} />
          : <rect x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} rx={Math.min(p.w, p.h) / 2} fill={fill} />}
      {p.drill > 0 && <circle cx={p.x} cy={p.y} r={p.drill / 2} fill={hole} />}
      {label && <text x={p.x} y={p.y + 0.28} fontSize={0.8} textAnchor="middle" fill={labelColor} className="pcb-padlabel">{p.n}</text>}
    </g>
  );
}

function PartOutline({ part, color, width = 0.12 }) {
  const b = footprintBounds(FOOTPRINTS[part.fp]);
  const m = 0.5;
  const pts = [[b.x0 - m, b.y0 - m], [b.x1 + m, b.y0 - m], [b.x1 + m, b.y1 + m], [b.x0 - m, b.y1 + m]]
    .map(([x, y]) => toWorld(part, { x, y })).map((p) => `${p.x},${p.y}`).join(' ');
  return <polygon points={pts} fill="none" stroke={color} strokeWidth={width} strokeDasharray="0.5 0.35" />;
}

const Static = memo(function Static({ doc, analysis, scale, opts, selection, hoverNet, activeLayer }) {
  const scene = useMemo(() => buildScene(doc), [doc]);
  const c = COLORS[opts.realistic ? 'realistic' : 'technical'];
  const sel = new Set(selection);
  const { w, h } = doc.board;
  const px = 1 / scale;
  const netOf = (id) => analysis?.itemNet.get(id) ?? null;
  const lit = (id) => (hoverNet ? netOf(id) === hoverNet : true);
  const layers = opts.flipView ? ['top', 'bottom'] : ['bottom', 'top'];
  const layerShown = { top: opts.showTop, bottom: opts.showBottom };
  const g = doc.grid.size;
  const showGrid = opts.showGrid && g * scale >= 6;

  return (
    <>
      <defs>
        {showGrid && (
          <pattern id="pcb-grid" width={g} height={g} patternUnits="userSpaceOnUse">
            <circle cx="0" cy="0" r={Math.max(px * 0.9, 0.03)} fill={opts.realistic ? '#ffffff55' : '#ffffff40'} />
          </pattern>
        )}
      </defs>
      <path d={boardD(doc.board)} fill={c.board} />
      {showGrid && <rect x={-g} y={-g} width={w + g * 2} height={h + g * 2} fill="url(#pcb-grid)" pointerEvents="none" />}

      {layers.map((l) => layerShown[l] && (
        <g key={l} opacity={l === activeLayer ? 1 : opts.inactive}>
          {scene.tracks[l].map((t) => (
            <g key={t.id} opacity={dim(lit(t.id))}>
              {sel.has(t.id) && <line x1={t.a.x} y1={t.a.y} x2={t.b.x} y2={t.b.y} stroke="#64d2ff" strokeWidth={t.width + px * 5} strokeLinecap="round" opacity={0.6} />}
              <line x1={t.a.x} y1={t.a.y} x2={t.b.x} y2={t.b.y} stroke={c[l]} strokeWidth={t.width} strokeLinecap="round" />
            </g>
          ))}
        </g>
      ))}

      {scene.vias.map((v) => (
        <g key={v.id} opacity={dim(lit(v.id))}>
          {sel.has(v.id) && <circle cx={v.x} cy={v.y} r={v.dia / 2 + px * 3} fill="none" stroke="#64d2ff" strokeWidth={px * 2} />}
          <circle cx={v.x} cy={v.y} r={v.dia / 2} fill={c.pad} />
          <circle cx={v.x} cy={v.y} r={v.drill / 2} fill={c.hole} />
        </g>
      ))}

      {scene.pads.map((p) => (
        <Pad key={p.id} p={p} fill={c.pad} hole={c.hole} label={opts.padNames && scale > 12} labelColor="#111" opacity={dim(lit(p.id))} />
      ))}

      {['bottom', 'top'].map((side) => opts[side === 'top' ? 'showSilkTop' : 'showSilkBottom'] && (
        <g key={side} stroke={side === 'top' ? c.silkTop : c.silkBottom} strokeWidth={SILK_W} strokeLinecap="round" fill="none" opacity={side === 'top' ? 0.95 : 0.55} pointerEvents="none">
          {scene.silk[side].map((s, i) => (s.k === 'line'
            ? <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
            : <circle key={i} cx={s.x} cy={s.y} r={s.r} />))}
        </g>
      ))}

      <path d={boardD(doc.board)} fill="none" stroke={c.edge} strokeWidth={Math.max(0.15, px * 1.5)} pointerEvents="none" />

      {doc.parts.filter((p) => sel.has(p.id)).map((p) => <PartOutline key={p.id} part={p} color="#64d2ff" width={px * 2} />)}
      {doc.texts.filter((t) => sel.has(t.id)).map((t) => <circle key={t.id} cx={t.x} cy={t.y} r={0.6} fill="none" stroke="#64d2ff" strokeWidth={px * 2} />)}
      {selection.length === 1 && doc.tracks.filter((t) => t.id === selection[0]).map((t) => (
        <g key={t.id} fill="#0a84ff" stroke="#fff" strokeWidth={px * 1.5}>
          <circle cx={t.a.x} cy={t.a.y} r={px * 5} /><circle cx={t.b.x} cy={t.b.y} r={px * 5} />
        </g>
      ))}

      {opts.showRatsnest && analysis?.airwires.map((a, i) => (
        <line key={i} x1={a.a.x} y1={a.a.y} x2={a.b.x} y2={a.b.y} stroke="#ffd60a" strokeWidth={Math.max(px * 1.4, 0.08)}
          strokeDasharray={`${px * 6} ${px * 4}`} opacity={hoverNet && hoverNet !== a.net ? 0.15 : 0.95} pointerEvents="none" />
      ))}

      {opts.showDrc && analysis?.drc.map((d) => (
        <g key={d.id} pointerEvents="none">
          <circle cx={d.x} cy={d.y} r={Math.max(px * 9, 0.7)} fill="none" stroke={d.level === 'error' ? '#ff453a' : '#ff9f0a'} strokeWidth={px * 2} />
          <circle cx={d.x} cy={d.y} r={Math.max(px * 2.4, 0.15)} fill={d.level === 'error' ? '#ff453a' : '#ff9f0a'} />
        </g>
      ))}
    </>
  );
});

function Overlay({ doc, scale, opts, overlay }) {
  const { route, ghost, measure, box, cursor } = overlay;
  const c = COLORS[opts.realistic ? 'realistic' : 'technical'];
  const px = 1 / scale;
  const ghostScene = useMemo(
    () => (ghost ? buildScene({ ...doc, parts: [ghost], tracks: [], vias: [], texts: [] }) : null),
    [ghost, doc],
  );
  return (
    <>
      {ghostScene && (
        <g opacity={0.7} pointerEvents="none">
          {ghostScene.pads.map((p) => <Pad key={p.id} p={p} fill={c.pad} hole={c.hole} />)}
          <g stroke={c.silkTop} strokeWidth={SILK_W} fill="none">
            {ghostScene.silk[ghost.side === 'bottom' ? 'bottom' : 'top'].map((s, i) => (s.k === 'line'
              ? <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} /> : <circle key={i} cx={s.x} cy={s.y} r={s.r} />))}
          </g>
        </g>
      )}
      {route && (
        <g pointerEvents="none" opacity={0.85}>
          {route.preview.map((t, i) => (
            <line key={i} x1={t.a.x} y1={t.a.y} x2={t.b.x} y2={t.b.y} stroke={c[route.layer]} strokeWidth={route.width} strokeLinecap="round" />
          ))}
          <circle cx={route.start.x} cy={route.start.y} r={px * 4} fill="#fff" />
        </g>
      )}
      {measure && measure.a && measure.b && (
        <g pointerEvents="none" stroke="#30d158" strokeWidth={px * 1.6} fill="#30d158">
          <line x1={measure.a.x} y1={measure.a.y} x2={measure.b.x} y2={measure.b.y} strokeDasharray={`${px * 5} ${px * 3}`} />
          <circle cx={measure.a.x} cy={measure.a.y} r={px * 3.5} /><circle cx={measure.b.x} cy={measure.b.y} r={px * 3.5} />
        </g>
      )}
      {box && (
        <rect x={Math.min(box.a.x, box.b.x)} y={Math.min(box.a.y, box.b.y)} width={Math.abs(box.a.x - box.b.x)} height={Math.abs(box.a.y - box.b.y)}
          fill="#0a84ff22" stroke="#0a84ff" strokeWidth={px * 1.5} strokeDasharray={`${px * 5} ${px * 3}`} pointerEvents="none" />
      )}
      {cursor && (
        <g pointerEvents="none" stroke={cursor.target ? '#30d158' : '#ffffff90'} strokeWidth={px * 1.4}>
          <line x1={cursor.x - px * 8} y1={cursor.y} x2={cursor.x + px * 8} y2={cursor.y} />
          <line x1={cursor.x} y1={cursor.y - px * 8} x2={cursor.x} y2={cursor.y + px * 8} />
          {cursor.target && <circle cx={cursor.x} cy={cursor.y} r={px * 8} fill="none" />}
        </g>
      )}
    </>
  );
}

/** Pure renderer: (document + analysis + view options) → SVG. All interaction lives in PcbEditor. */
export default function PcbView({ doc, analysis, view, opts, selection, hoverNet, activeLayer, overlay, svgRef, handlers, spaceDown }) {
  const { w } = doc.board;
  const transform = `translate(${view.ox} ${view.oy}) scale(${view.s})` + (opts.flipView ? ` translate(${w} 0) scale(-1 1)` : '');
  return (
    <svg
      ref={svgRef} className="pcb-svg" width="100%" height="100%"
      data-scale={view.s} data-ox={view.ox} data-oy={view.oy}
      style={{ cursor: spaceDown ? 'grab' : opts.cursor }}
      {...handlers}
    >
      <g transform={transform}>
        <Static doc={doc} analysis={analysis} scale={view.s} opts={opts} selection={selection} hoverNet={hoverNet} activeLayer={activeLayer} />
        <Overlay doc={doc} scale={view.s} opts={opts} overlay={overlay} />
      </g>
    </svg>
  );
}

function boardD({ w, h, r }) {
  const k = Math.max(0, Math.min(r ?? 0, w / 2, h / 2));
  if (!k) return `M0 0H${w}V${h}H0Z`;
  return `M${k} 0H${w - k}A${k} ${k} 0 0 1 ${w} ${k}V${h - k}A${k} ${k} 0 0 1 ${w - k} ${h}H${k}A${k} ${k} 0 0 1 0 ${h - k}V${k}A${k} ${k} 0 0 1 ${k} 0Z`;
}
