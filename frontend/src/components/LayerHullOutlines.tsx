import { useMemo } from 'react';
import type { Layer, Screen } from '../types';

type Props = {
  screens: Screen[];
  layers: Layer[];
  activeLayerId: number | null;
  cellW: number;
  cellH: number;
};

type Vert = { gx: number; gy: number };
type DirectedEdge = { from: Vert; to: Vert };

function cellKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

function vertKey(v: Vert): string {
  return `${v.gx},${v.gy}`;
}

function hexToRgba(hex: string, alpha: number): string {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  if (h.length !== 6 || Number.isNaN(parseInt(h, 16))) {
    return `rgba(122, 133, 153, ${alpha})`;
  }
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function expandOccupied(screens: Screen[], layerId: number): Set<string> {
  const set = new Set<string>();
  for (const s of screens) {
    if (s.layer_id !== layerId || s.grid_x == null || s.grid_y == null) continue;
    for (let dx = 0; dx < s.grid_w; dx++) {
      for (let dy = 0; dy < s.grid_h; dy++) {
        set.add(cellKey(s.grid_x + dx, s.grid_y + dy));
      }
    }
  }
  return set;
}

// Build the directed boundary edges of an occupied region. Each edge is
// oriented so that an occupied cell is on the RIGHT while walking it; this
// makes outer contours wind CW and any holes wind CCW, with the "outside"
// (non-cell side) consistently to the LEFT of the walk.
function buildDirectedEdges(occupied: Set<string>): DirectedEdge[] {
  const edges: DirectedEdge[] = [];
  for (const key of occupied) {
    const [gx, gy] = key.split(',').map(Number);
    if (!occupied.has(cellKey(gx, gy - 1))) {
      edges.push({ from: { gx, gy }, to: { gx: gx + 1, gy } });
    }
    if (!occupied.has(cellKey(gx, gy + 1))) {
      edges.push({
        from: { gx: gx + 1, gy: gy + 1 },
        to: { gx, gy: gy + 1 },
      });
    }
    if (!occupied.has(cellKey(gx - 1, gy))) {
      edges.push({ from: { gx, gy: gy + 1 }, to: { gx, gy } });
    }
    if (!occupied.has(cellKey(gx + 1, gy))) {
      edges.push({
        from: { gx: gx + 1, gy },
        to: { gx: gx + 1, gy: gy + 1 },
      });
    }
  }
  return edges;
}

// Trace closed contours around occupied cells. Each contour is a list of grid
// corners in walk order. Saddle corners (where two diagonal cells meet at a
// single corner) are resolved by always taking the right-turn branch, which
// keeps each connected cluster in its own contour.
function traceContours(occupied: Set<string>): Vert[][] {
  const edges = buildDirectedEdges(occupied);
  const outgoing = new Map<string, Vert[]>();
  for (const e of edges) {
    const k = vertKey(e.from);
    const list = outgoing.get(k);
    if (list) list.push(e.to);
    else outgoing.set(k, [e.to]);
  }
  const visited = new Set<string>();
  const ek = (a: Vert, b: Vert) => `${vertKey(a)}->${vertKey(b)}`;

  const contours: Vert[][] = [];
  for (const seed of edges) {
    if (visited.has(ek(seed.from, seed.to))) continue;
    const contour: Vert[] = [seed.from];
    let prev: Vert = seed.from;
    let curr: Vert = seed.to;
    visited.add(ek(prev, curr));
    while (vertKey(curr) !== vertKey(seed.from)) {
      contour.push(curr);
      const outs = outgoing.get(vertKey(curr)) ?? [];
      const candidates = outs.filter((n) => !visited.has(ek(curr, n)));
      if (candidates.length === 0) break;
      let chosen = candidates[0];
      if (candidates.length > 1) {
        // Saddle: pick the outgoing edge that turns right relative to inDir.
        const inDx = Math.sign(curr.gx - prev.gx);
        const inDy = Math.sign(curr.gy - prev.gy);
        // Right perpendicular in SVG (y-down) coords: (-dy, dx).
        const rDx = -inDy;
        const rDy = inDx;
        const right = candidates.find((c) => {
          const dx = Math.sign(c.gx - curr.gx);
          const dy = Math.sign(c.gy - curr.gy);
          return dx === rDx && dy === rDy;
        });
        if (right) chosen = right;
      }
      visited.add(ek(curr, chosen));
      prev = curr;
      curr = chosen;
    }
    contours.push(contour);
  }
  return contours;
}

// Offset a contour outward (to the LEFT of the walk direction) by `half`
// pixels, producing a polygon whose perpendicular distance from the original
// boundary is exactly `half` everywhere; stroking that polygon with
// width = 2*half then sits flush against the original boundary on its inner
// edge and `strokeWidth` outside on its outer edge.
function offsetContour(
  contour: Vert[],
  minGx: number,
  minGy: number,
  cellW: number,
  cellH: number,
  half: number,
): { x: number; y: number }[] {
  const n = contour.length;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const prev = contour[(i - 1 + n) % n];
    const curr = contour[i];
    const next = contour[(i + 1) % n];
    const inDx = Math.sign(curr.gx - prev.gx);
    const inDy = Math.sign(curr.gy - prev.gy);
    const outDx = Math.sign(next.gx - curr.gx);
    const outDy = Math.sign(next.gy - curr.gy);
    // Left perpendicular in SVG coords: (dy, -dx).
    const inLpx = inDy;
    const inLpy = -inDx;
    const outLpx = outDy;
    const outLpy = -outDx;
    // For a 90° turn the two perpendiculars are orthogonal and their sum has
    // magnitude sqrt(2), giving the correct bisector offset of half*sqrt(2).
    // For a straight section they are parallel, so summing would double-count;
    // use a single perpendicular instead.
    const straight = inDx === outDx && inDy === outDy;
    const offX = straight ? inLpx * half : (inLpx + outLpx) * half;
    const offY = straight ? inLpy * half : (inLpy + outLpy) * half;
    out.push({
      x: (curr.gx - minGx) * cellW + offX,
      y: (curr.gy - minGy) * cellH + offY,
    });
  }
  return out;
}

function boundsForScreens(screens: Screen[]): {
  minGx: number;
  minGy: number;
  maxGx: number;
  maxGy: number;
} | null {
  let minGx = Infinity;
  let minGy = Infinity;
  let maxGx = -Infinity;
  let maxGy = -Infinity;
  for (const s of screens) {
    if (s.layer_id == null || s.grid_x == null || s.grid_y == null) continue;
    minGx = Math.min(minGx, s.grid_x);
    minGy = Math.min(minGy, s.grid_y);
    maxGx = Math.max(maxGx, s.grid_x + s.grid_w - 1);
    maxGy = Math.max(maxGy, s.grid_y + s.grid_h - 1);
  }
  if (!Number.isFinite(minGx)) return null;
  return { minGx, minGy, maxGx, maxGy };
}

export function LayerHullOutlines({
  screens,
  layers,
  activeLayerId,
  cellW,
  cellH,
}: Props) {
  const svgData = useMemo(() => {
    const placed = screens.filter(
      (s) => s.layer_id != null && s.grid_x != null && s.grid_y != null,
    );
    const b = boundsForScreens(placed);
    if (!b) return null;

    const { minGx, minGy, maxGx, maxGy } = b;
    const bw = (maxGx - minGx + 1) * cellW;
    const bh = (maxGy - minGy + 1) * cellH;

    const layerIds = new Set<number>();
    for (const s of placed) layerIds.add(s.layer_id!);

    const sortedLayers = [...layers].filter((l) => layerIds.has(l.id));
    sortedLayers.sort((a, b) => {
      const aFocus = activeLayerId != null && a.id === activeLayerId ? 1 : 0;
      const bFocus = activeLayerId != null && b.id === activeLayerId ? 1 : 0;
      if (aFocus !== bFocus) return aFocus - bFocus;
      return a.sort_order - b.sort_order || a.id - b.id;
    });

    const layerRenders = sortedLayers.map((layer) => {
      const occupied = expandOccupied(placed, layer.id);
      const contours = traceContours(occupied);
      const onFocus = activeLayerId != null && layer.id === activeLayerId;
      const stroke = hexToRgba(layer.color, onFocus ? 0.78 : 0.36);
      const strokeWidth = onFocus ? 2.5 : 1.75;
      const half = strokeWidth / 2;
      const paths = contours
        .filter((c) => c.length >= 3)
        .map((c) => offsetContour(c, minGx, minGy, cellW, cellH, half));
      return { layerId: layer.id, paths, stroke, strokeWidth };
    });

    return { minGx, minGy, bw, bh, layerRenders };
  }, [screens, layers, activeLayerId, cellW, cellH]);

  if (!svgData || svgData.layerRenders.every((x) => x.paths.length === 0)) {
    return null;
  }

  const { minGx, minGy, bw, bh, layerRenders } = svgData;

  return (
    <div
      className="layer-hull-wrap"
      style={{
        position: 'absolute',
        left: minGx * cellW,
        top: minGy * cellH,
        width: bw,
        height: bh,
        pointerEvents: 'none',
        zIndex: 5,
        overflow: 'visible',
      }}
    >
      <svg
        width={bw}
        height={bh}
        shapeRendering="crispEdges"
        style={{ overflow: 'visible', display: 'block' }}
      >
        {layerRenders.map(({ layerId, paths, stroke, strokeWidth }) => (
          <g key={layerId}>
            {paths.map((pts, i) => {
              const d =
                pts
                  .map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x},${p.y}`)
                  .join(' ') + ' Z';
              return (
                <path
                  key={`${layerId}-c${i}`}
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeLinejoin="miter"
                  strokeMiterlimit={4}
                />
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
