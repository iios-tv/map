import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Screen } from '../types';
import {
  annotationBubbleHasContent,
  buildVisibleBubbleEntries,
  yarnEndpointsForEntry,
} from '../annotationBubbleLayout';

const STIFFNESS = 0.32;
const DAMPING = 0.82;
const SAG_PER_CHORD = 0.14;
const SAG_MIN = 6;
const SAG_MAX = 110;

/** Impulse on sag velocity from pan (screen px/frame), perpendicular to string */
const PAN_SWING_PERP_GAIN = 0.38;
/** Additional impulse from pan speed (any direction) */
const PAN_SWING_SPEED_GAIN = 0.12;
/** Cap pan delta per frame so tab-switch / layout jumps do not explode springs */
const PAN_DELTA_CAP = 72;
const SAG_VEL_CAP = 28;

function sagDirection(px: number, py: number, ax: number, ay: number): { x: number; y: number } {
  const dx = ax - px;
  const dy = ay - py;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const bx = nx * 0.55;
  const by = ny * 0.55 + 0.45;
  const bl = Math.sqrt(bx * bx + by * by) || 1;
  return { x: bx / bl, y: by / bl };
}

type Spring = { sag: number; vel: number };

function _AnnotationYarnLayer({
  screens,
  cellW,
  cellH,
  view,
}: {
  screens: Screen[];
  cellW: number;
  cellH: number;
  view: { tx: number; ty: number; scale: number };
}) {
  const annotations = useStore((s) => s.annotations);
  const captures = useStore((s) => s.captures);
  const selectedId = useStore((s) => s.selectedScreenId);
  const alwaysShow = useStore((s) => s.alwaysShowAnnotationBubbles);
  const pinnedScreenIds = useStore((s) => s.annotationPinnedScreenIds);

  const visible = useMemo(
    () =>
      buildVisibleBubbleEntries(
        annotations,
        screens,
        selectedId,
        alwaysShow,
        pinnedScreenIds,
      ).filter((e) => annotationBubbleHasContent(e.ann, captures)),
    [annotations, screens, selectedId, alwaysShow, pinnedScreenIds, captures],
  );

  const springs = useRef<Map<number, Spring>>(new Map());
  const prevCamRef = useRef<{ tx: number; ty: number; scale: number } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (visible.length === 0) {
      springs.current.clear();
      prevCamRef.current = null;
      return;
    }
    prevCamRef.current = null;
    let raf = 0;
    const step = () => {
      // Read view from the store: RAF often runs before React commits, so the last
      // rendered `view` prop would often match `prevCam` and pan deltas would be lost.
      const v = useStore.getState().view;
      const prevCam = prevCamRef.current;
      let dtx = 0;
      let dty = 0;
      if (prevCam) {
        dtx = v.tx - prevCam.tx;
        dty = v.ty - prevCam.ty;
        const m = Math.hypot(dtx, dty);
        if (m > PAN_DELTA_CAP && m > 0) {
          const s = PAN_DELTA_CAP / m;
          dtx *= s;
          dty *= s;
        }
      }
      prevCamRef.current = { tx: v.tx, ty: v.ty, scale: v.scale };

      const map = springs.current;
      const present = new Set<number>();
      const panSpeed = Math.hypot(dtx, dty);
      const stateSnap = useStore.getState();
      const panKickMul =
        stateSnap.yarnPanSwingEnabled ? stateSnap.yarnPanSwingStrength / 100 : 0;
      for (const entry of visible) {
        present.add(entry.ann.id);
        const { px, py, ax, ay, chord } = yarnEndpointsForEntry(entry, cellW, cellH, v);
        const targetSag = Math.min(SAG_MAX, Math.max(SAG_MIN, SAG_PER_CHORD * chord));

        let s = map.get(entry.ann.id);
        if (!s) {
          s = { sag: targetSag, vel: 0 };
          map.set(entry.ann.id, s);
        }
        if (prevCam && panSpeed > 0.001 && panKickMul > 0) {
          const dx = ax - px;
          const dy = ay - py;
          const cross = dtx * dy - dty * dx;
          const perpKick =
            panKickMul * ((PAN_SWING_PERP_GAIN * cross) / Math.max(chord, 1));
          const speedKick = panKickMul * PAN_SWING_SPEED_GAIN * panSpeed;
          s.vel += perpKick + speedKick;
        }
        s.vel += STIFFNESS * (targetSag - s.sag);
        s.sag += s.vel;
        s.vel *= DAMPING;
        if (s.vel > SAG_VEL_CAP) s.vel = SAG_VEL_CAP;
        else if (s.vel < -SAG_VEL_CAP) s.vel = -SAG_VEL_CAP;
      }
      for (const id of map.keys()) {
        if (!present.has(id)) map.delete(id);
      }
      setTick((n) => n + 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [visible, cellW, cellH]);

  if (visible.length === 0) return null;

  return (
    <svg
      className="ann-yarn-layer"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 7,
        overflow: 'visible',
      }}
    >
      {visible.map((entry) => {
        const vDraw = useStore.getState().view;
        const { px, py, ax, ay, chord } = yarnEndpointsForEntry(entry, cellW, cellH, vDraw);
        const dir = sagDirection(px, py, ax, ay);
        const spring = springs.current.get(entry.ann.id);
        const sag = spring?.sag ?? Math.min(SAG_MAX, Math.max(SAG_MIN, SAG_PER_CHORD * chord));
        const mx = (px + ax) / 2;
        const my = (py + ay) / 2;
        const cx = mx + dir.x * sag;
        const cy = my + dir.y * sag;
        const d = `M ${px} ${py} Q ${cx} ${cy} ${ax} ${ay}`;
        return (
          <path
            key={entry.ann.id}
            d={d}
            fill="none"
            stroke="#c62828"
            strokeWidth={2.25}
            strokeLinecap="round"
            opacity={0.92}
          />
        );
      })}
    </svg>
  );
}

export const AnnotationYarnLayer = memo(_AnnotationYarnLayer);
