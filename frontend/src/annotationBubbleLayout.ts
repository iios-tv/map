import type { Annotation, Screen } from './types';

/** Bubble width drives annotation capture preview size (~2× prior 240px cap). */
export const BUBBLE_MAX_W = 480;
export const BUBBLE_MIN_W = 160;

/** Max crop-preview height inside a bubble at high zoom (screen px). */
export const BUBBLE_IMAGE_MAX_H = 320;

/**
 * Bubble size in screen pixels is capped relative to the tile’s on-map footprint so
 * zooming out does not leave huge previews next to tiny tiles.
 */
export const BUBBLE_MAX_VS_TILE = 2;

export function bubbleScreenCaps(
  tileW: number,
  tileH: number,
  viewScale: number,
): { maxW: number; minW: number; imageMaxH: number } {
  const tilePxW = tileW * viewScale;
  const tilePxH = tileH * viewScale;
  const maxW = Math.min(BUBBLE_MAX_W, BUBBLE_MAX_VS_TILE * tilePxW);
  const minW = Math.min(BUBBLE_MIN_W, maxW);
  const imageMaxH = Math.min(BUBBLE_IMAGE_MAX_H, BUBBLE_MAX_VS_TILE * tilePxH);
  return { maxW, minW, imageMaxH };
}

export const BUBBLE_OFFSET_X = 14;
export const BUBBLE_OFFSET_Y = -10;

/**
 * Center of `.ann-bubble-tail` relative to the bubble root (top-left of `.ann-bubble`),
 * matching styles: left -7px, top 6px, 8×8 circle → center at (-3, 10).
 */
export const BUBBLE_TAIL_CENTER_REL_X = -3;
export const BUBBLE_TAIL_CENTER_REL_Y = 10;

/** Screen-space offset per stacked bubble (same tile + nearby pin). */
export const BUBBLE_FAN_STEP_X = Math.round(BUBBLE_MAX_W * 0.44);
export const BUBBLE_FAN_STEP_Y = Math.round(BUBBLE_MAX_W * 0.38);

export const NORM_BUCKET = 18;

export type VisibleBubbleEntry = {
  ann: Annotation;
  screen: Screen;
  fanIndex: number;
};

export function computeFanIndices(items: { ann: Annotation; screen: Screen }[]): Map<number, number> {
  const buckets = new Map<string, { ann: Annotation; screen: Screen }[]>();
  for (const item of items) {
    const bx = Math.round(item.ann.x_norm * NORM_BUCKET);
    const by = Math.round(item.ann.y_norm * NORM_BUCKET);
    const key = `${item.screen.id}:${bx}:${by}`;
    const arr = buckets.get(key);
    if (arr) arr.push(item);
    else buckets.set(key, [item]);
  }
  const out = new Map<number, number>();
  for (const arr of buckets.values()) {
    const sorted = [...arr].sort((a, b) => a.ann.id - b.ann.id);
    sorted.forEach((item, i) => out.set(item.ann.id, i));
  }
  return out;
}

export function buildVisibleBubbleEntries(
  annotations: Record<number, Annotation>,
  screens: Screen[],
  selectedId: number | null,
  alwaysShowBubble: boolean,
  /** Screens whose annotation bubbles stay visible when not selected (map “pin”). */
  pinnedScreenIds: readonly number[],
): VisibleBubbleEntry[] {
  const pinSet = new Set(pinnedScreenIds);
  const list: { ann: Annotation; screen: Screen }[] = [];
  for (const screen of screens) {
    if (screen.grid_x == null || screen.grid_y == null) continue;
    const show =
      alwaysShowBubble || screen.id === selectedId || pinSet.has(screen.id);
    if (!show) continue;
    for (const a of Object.values(annotations)) {
      if (a.screen_id === screen.id) list.push({ ann: a, screen });
    }
  }
  const fan = computeFanIndices(list);
  return list.map(({ ann, screen }) => ({
    ann,
    screen,
    fanIndex: fan.get(ann.id) ?? 0,
  }));
}

export function annotationBubbleHasContent(
  ann: Annotation,
  captures: Record<number, { filename?: string }>,
): boolean {
  if (ann.text.trim().length > 0) return true;
  return ann.capture_id != null && captures[ann.capture_id] != null;
}

/**
 * Pin center and bubble tail attach point in canvas-wrap pixel coordinates
 * (same space as `AnnotationBubbles` / `MapCanvas` overlay).
 */
export function yarnEndpointsForEntry(
  entry: VisibleBubbleEntry,
  cellW: number,
  cellH: number,
  view: { tx: number; ty: number; scale: number },
): { px: number; py: number; ax: number; ay: number; chord: number } {
  const { ann, screen, fanIndex } = entry;
  const tileW = cellW * screen.grid_w;
  const tileH = cellH * screen.grid_h;
  const pinWorldX = (screen.grid_x ?? 0) * cellW + ann.x_norm * tileW;
  const pinWorldY = (screen.grid_y ?? 0) * cellH + ann.y_norm * tileH;
  const ox = ann.bubble_offset_x ?? 0;
  const oy = ann.bubble_offset_y ?? 0;
  const anchorWorldX = pinWorldX + ox;
  const anchorWorldY = pinWorldY + oy;
  const sx = view.tx + anchorWorldX * view.scale + fanIndex * BUBBLE_FAN_STEP_X;
  const sy = view.ty + anchorWorldY * view.scale + fanIndex * BUBBLE_FAN_STEP_Y;

  const px = view.tx + pinWorldX * view.scale;
  const py = view.ty + pinWorldY * view.scale;

  const bubbleLeft = sx + BUBBLE_OFFSET_X;
  const bubbleTop = sy + BUBBLE_OFFSET_Y;
  const ax = bubbleLeft + BUBBLE_TAIL_CENTER_REL_X;
  const ay = bubbleTop + BUBBLE_TAIL_CENTER_REL_Y;

  const dx = ax - px;
  const dy = ay - py;
  const chord = Math.sqrt(dx * dx + dy * dy) || 1;
  return { px, py, ax, ay, chord };
}
