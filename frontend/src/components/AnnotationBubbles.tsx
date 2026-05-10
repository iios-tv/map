import { memo, useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { useStore } from '../store';
import type { Annotation, AnnotationTypeDef, Capture, Screen } from '../types';
import { colorForAnnotationKind } from '../types';
import { api, imageUrlForAnnotation } from '../api';
import {
  BUBBLE_OFFSET_X,
  BUBBLE_OFFSET_Y,
  BUBBLE_FAN_STEP_X,
  BUBBLE_FAN_STEP_Y,
  bubbleScreenCaps,
  buildVisibleBubbleEntries,
} from '../annotationBubbleLayout';

type Props = {
  screens: Screen[];
  cellW: number;
  cellH: number;
  view: { tx: number; ty: number; scale: number };
};

function _AnnotationBubbles({ screens, cellW, cellH, view }: Props) {
  const annotations = useStore((s) => s.annotations);
  const captures = useStore((s) => s.captures);
  const selectedId = useStore((s) => s.selectedScreenId);
  const alwaysShow = useStore((s) => s.alwaysShowAnnotationBubbles);
  const pinnedScreenIds = useStore((s) => s.annotationPinnedScreenIds);
  const annotationTypes = useStore((s) => s.annotationTypes);

  const visible = useMemo(
    () =>
      buildVisibleBubbleEntries(annotations, screens, selectedId, alwaysShow, pinnedScreenIds),
    [annotations, screens, selectedId, alwaysShow, pinnedScreenIds],
  );

  if (visible.length === 0) return null;

  return (
    <div
      className="ann-bubbles-layer"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 8 }}
    >
      {visible.map(({ ann, screen, fanIndex }) => {
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
        const caps = bubbleScreenCaps(tileW, tileH, view.scale);
        return (
          <AnnotationBubble
            key={ann.id}
            ann={ann}
            annotationTypes={annotationTypes}
            captures={captures}
            screenX={sx}
            screenY={sy}
            isSelected={screen.id === selectedId}
            fanIndex={fanIndex}
            viewScale={view.scale}
            screenId={screen.id}
            bubbleMaxW={caps.maxW}
            bubbleMinW={caps.minW}
            bubbleImageMaxH={caps.imageMaxH}
          />
        );
      })}
    </div>
  );
}

export const AnnotationBubbles = memo(_AnnotationBubbles);

function PencilIcon() {
  return (
    <svg className="ann-bubble-edit-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
      />
    </svg>
  );
}

function AnnotationBubble({
  ann,
  annotationTypes,
  captures,
  screenX,
  screenY,
  isSelected,
  fanIndex,
  viewScale,
  screenId,
  bubbleMaxW,
  bubbleMinW,
  bubbleImageMaxH,
}: {
  ann: Annotation;
  annotationTypes: AnnotationTypeDef[];
  captures: Record<number, Capture>;
  screenX: number;
  screenY: number;
  isSelected: boolean;
  fanIndex: number;
  viewScale: number;
  screenId: number;
  bubbleMaxW: number;
  bubbleMinW: number;
  bubbleImageMaxH: number;
}) {
  const captureUrl = imageUrlForAnnotation(ann, captures);
  const capture = ann.capture_id != null ? captures[ann.capture_id] : undefined;
  const hasText = ann.text.trim().length > 0;
  const hasImage = !!(captureUrl && capture);
  const [dragging, setDragging] = useState(false);
  const lastPtr = useRef<{ x: number; y: number } | null>(null);
  const dragStartOffsets = useRef<{ ox: number; oy: number } | null>(null);

  if (!hasText && !hasImage) return null;

  function onPointerDown(e: RPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.ann-bubble-edit-btn')) return;
    if ((e.target as HTMLElement).closest('.ann-bubble-text')) return;
    e.stopPropagation();
    e.preventDefault();
    useStore.getState().selectScreen(screenId);
    lastPtr.current = { x: e.clientX, y: e.clientY };
    dragStartOffsets.current = {
      ox: ann.bubble_offset_x ?? 0,
      oy: ann.bubble_offset_y ?? 0,
    };
    setDragging(true);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: RPointerEvent<HTMLDivElement>) {
    if (!lastPtr.current) return;
    const lx = lastPtr.current.x;
    const ly = lastPtr.current.y;
    const dx = (e.clientX - lx) / viewScale;
    const dy = (e.clientY - ly) / viewScale;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    if (dx === 0 && dy === 0) return;
    const a = useStore.getState().annotations[ann.id];
    if (!a) return;
    useStore.getState().upsertAnnotation({
      ...a,
      bubble_offset_x: (a.bubble_offset_x ?? 0) + dx,
      bubble_offset_y: (a.bubble_offset_y ?? 0) + dy,
    });
  }

  function endDrag(e: RPointerEvent<HTMLDivElement>) {
    if (!lastPtr.current) return;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    lastPtr.current = null;
    setDragging(false);
    const start = dragStartOffsets.current;
    dragStartOffsets.current = null;
    const a = useStore.getState().annotations[ann.id];
    if (!a || !start) return;
    const ox = a.bubble_offset_x ?? 0;
    const oy = a.bubble_offset_y ?? 0;
    const moved =
      Math.abs(ox - start.ox) > 0.25 || Math.abs(oy - start.oy) > 0.25;
    if (moved) {
      api
        .patchAnnotation(a.screen_id, ann.id, { bubble_offset_x: ox, bubble_offset_y: oy })
        .catch((err: any) =>
          useStore.getState().showToast(`Bubble position save failed: ${err.message ?? err}`),
        );
    }
  }

  return (
    <div
      className={`ann-bubble${isSelected ? ' selected' : ''}${dragging ? ' dragging' : ''}`}
      style={{
        position: 'absolute',
        left: screenX + BUBBLE_OFFSET_X,
        top: screenY + BUBBLE_OFFSET_Y,
        maxWidth: bubbleMaxW,
        minWidth: bubbleMinW,
        zIndex: 8 + fanIndex + (dragging ? 100 : 0),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span
        className="ann-bubble-tail"
        style={{ background: colorForAnnotationKind(annotationTypes, ann.kind) }}
      />
      <button
        type="button"
        className="ann-bubble-edit-btn"
        title="Edit annotation"
        aria-label="Edit annotation"
        style={{
          // Bubbles sit outside `canvas-inner`; map chrome scales with view.scale.
          transform: `scale(${viewScale})`,
          transformOrigin: 'top right',
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          useStore.getState().openMapAnnotationEditor({
            annId: ann.id,
            anchorX: r.left + r.width / 2,
            anchorY: r.bottom + 4,
          });
        }}
      >
        <PencilIcon />
      </button>
      {hasImage && (
        <BubbleImage
          url={captureUrl!}
          sourceW={capture!.width}
          sourceH={capture!.height}
          crop={ann.capture_crop}
          maxContentW={bubbleMaxW}
          maxImageH={bubbleImageMaxH}
        />
      )}
      {hasText && <div className="ann-bubble-text">{ann.text}</div>}
    </div>
  );
}

function BubbleImage({
  url,
  sourceW,
  sourceH,
  crop,
  maxContentW,
  maxImageH,
}: {
  url: string;
  sourceW: number;
  sourceH: number;
  crop: Annotation['capture_crop'];
  maxContentW: number;
  maxImageH: number;
}) {
  const c = crop ?? { x: 0, y: 0, w: sourceW, h: sourceH };
  if (c.w <= 0 || c.h <= 0) return null;
  const aspect = c.w / c.h;
  const padX = 12;
  const boxW = Math.max(1, maxContentW - padX);
  const boxH = Math.min(maxImageH, Math.max(1, boxW / aspect));
  const scaleX = boxW / c.w;
  const scaleY = boxH / c.h;
  return (
    <div
      className="ann-bubble-image"
      style={{ width: boxW, height: boxH }}
    >
      <img
        src={url}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          left: -c.x * scaleX,
          top: -c.y * scaleY,
          width: sourceW * scaleX,
          height: sourceH * scaleY,
          maxWidth: 'none',
          imageRendering: 'pixelated',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
