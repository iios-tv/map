import { memo, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent as RChangeEvent,
  MouseEvent as RMouseEvent,
  PointerEvent as RPointerEvent,
} from 'react';
import { useStore, useDisplayCrops } from '../store';
import type { DisplayCrops } from '../store';
import { api, imageUrlForScreen } from '../api';
import { loadLastAnnotationKind, persistLastAnnotationKind } from '../lastAnnotationKind';
import type { Annotation, Capture, Composite, CropBox, Screen } from '../types';
import { colorForAnnotationKind } from '../types';

const INACTIVE_LAYER_OPACITY = 0.34;

function PinIcon() {
  return (
    <svg className="tile-annotations-pin-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        fill="currentColor"
        d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5v7l1 1 1-1v-7h5v-2c-1.66 0-3-1.34-3-3z"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="tile-annotations-add-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="tile-screen-delete-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        fill="currentColor"
        d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="tile-annotations-pin-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
      />
    </svg>
  );
}

// Compose the per-screen crop_box with the global display crops to produce
// the rectangle (in source-image coords) that should actually be rendered.
//
// - For composite-backed screens, display crops are NOT re-applied here; they
//   were baked into the composite at render time, so a second pass would
//   double-crop.
// - For capture-backed screens, display crops shrink each edge of the visible
//   region. Where the user has also picked a per-screen crop_box, the two
//   compose by intersection: any edge already covered by the crop_box is left
//   alone, and any edge less restrictive than the display crop is moved in.
function effectiveCrop(
  cropBox: CropBox | null,
  sourceSize: { w: number; h: number },
  displayCrops: DisplayCrops,
  isCapture: boolean,
): CropBox {
  const base = cropBox ?? { x: 0, y: 0, w: sourceSize.w, h: sourceSize.h };
  if (!isCapture) return base;
  const left = Math.max(base.x, displayCrops.left);
  const top = Math.max(base.y, displayCrops.top);
  const right = Math.min(base.x + base.w, sourceSize.w - displayCrops.right);
  const bottom = Math.min(base.y + base.h, sourceSize.h - displayCrops.bottom);
  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top),
  };
}

function tileBoxShadow(opts: { isSelected: boolean; isPicked: boolean }): string {
  const inset =
    'inset 1px 0 0 0 var(--grid-strong), inset 0 1px 0 0 var(--grid-strong)';
  const parts: string[] = [inset];

  if (opts.isPicked) {
    parts.push('0 0 0 2px var(--accent-2)');
    return parts.join(', ');
  }
  if (opts.isSelected) {
    parts.push('0 0 0 2px var(--accent)');
    parts.push('0 0 14px rgba(95, 210, 255, 0.38)');
    return parts.join(', ');
  }

  return parts.join(', ');
}

type Props = {
  screen: Screen;
  cellW: number;
  cellH: number;
  captures: Record<number, Capture>;
  composites: Record<number, Composite>;
};

function _ScreenTile({ screen, cellW, cellH, captures, composites }: Props) {
  const tileRef = useRef<HTMLDivElement>(null);
  const pinDragActive = useRef<number | null>(null);
  const pinDragStart = useRef<{ x_norm: number; y_norm: number } | null>(null);
  const [pinDragPos, setPinDragPos] = useState<{
    id: number;
    x_norm: number;
    y_norm: number;
  } | null>(null);

  const selectedId = useStore((s) => s.selectedScreenId);
  const layers = useStore((s) => s.layers);
  const annotations = useStore((s) => s.annotations);
  const compositePicker = useStore((s) => s.compositePicker);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const displayCrops = useDisplayCrops();
  const annotationTypes = useStore((s) => s.annotationTypes);
  const isAnnPinned = useStore((s) => s.annotationPinnedScreenIds.includes(screen.id));

  const url = imageUrlForScreen(screen, captures, composites);
  const isCapture = screen.composite_id == null && screen.capture_id != null;
  const sourceSize = useMemo(() => {
    if (screen.composite_id != null && composites[screen.composite_id]) {
      const c = composites[screen.composite_id];
      return { w: c.width, h: c.height };
    }
    if (screen.capture_id != null && captures[screen.capture_id]) {
      const c = captures[screen.capture_id];
      return { w: c.width, h: c.height };
    }
    return { w: cellW, h: cellH };
  }, [screen, captures, composites, cellW, cellH]);

  const crop = useMemo(
    () => effectiveCrop(screen.crop_box, sourceSize, displayCrops, isCapture),
    [screen.crop_box, sourceSize, displayCrops, isCapture],
  );

  const tileW = cellW * screen.grid_w;
  const tileH = cellH * screen.grid_h;

  const scaleX = crop.w > 0 ? tileW / crop.w : 1;
  const scaleY = crop.h > 0 ? tileH / crop.h : 1;

  const screenAnns = useMemo(
    () => Object.values(annotations).filter((a) => a.screen_id === screen.id),
    [annotations, screen.id],
  );

  const isSelected = selectedId === screen.id;
  const isPicked =
    compositePicker.active && compositePicker.pickedScreenIds.includes(screen.id);

  const layer =
    screen.layer_id != null ? layers.find((l) => l.id === screen.layer_id) : undefined;
  const layerMissing = screen.layer_id != null && layer == null;

  const layerDisplay = layer?.name ?? `Unknown (#${screen.layer_id})`;

  const isOnFocusLayer =
    activeLayerId != null && screen.layer_id === activeLayerId;
  const opacity =
    activeLayerId != null && !isOnFocusLayer ? INACTIVE_LAYER_OPACITY : 1;

  let zIndex = 3;
  if (activeLayerId != null) {
    zIndex = isOnFocusLayer ? 4 : 2;
  }
  if (isPicked) zIndex = 6;
  if (isSelected) zIndex = 7;

  const boxShadow = tileBoxShadow({ isSelected, isPicked });

  function normFromPointer(clientX: number, clientY: number): { x_norm: number; y_norm: number } | null {
    const tile = tileRef.current;
    if (!tile) return null;
    const rect = tile.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x_norm: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y_norm: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }

  async function createAnnotation(e: RMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const addIds = annotationTypes.filter((t) => !t.synthetic).map((t) => t.id);
    if (addIds.length === 0) {
      useStore.getState().showToast('Add an annotation type in Settings first.');
      return;
    }
    const kind = loadLastAnnotationKind(addIds);
    try {
      const a = await api.createAnnotation(screen.id, {
        kind,
        text: '',
        x_norm: 0.5,
        y_norm: 0.5,
        tags: [],
      });
      useStore.getState().upsertAnnotation(a);
      persistLastAnnotationKind(kind);
      const rect = e.currentTarget.getBoundingClientRect();
      useStore.getState().openMapAnnotationEditor({
        annId: a.id,
        anchorX: rect.left + rect.width / 2,
        anchorY: rect.bottom + 4,
      });
    } catch (err: any) {
      useStore.getState().showToast(`Add annotation failed: ${err.message ?? err}`);
    }
  }

  async function deleteScreen(e: RMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (!confirm('Delete this screen? The image file remains on disk.')) return;
    try {
      await api.deleteScreen(screen.id);
      useStore.getState().removeScreen(screen.id);
    } catch (err: any) {
      useStore.getState().showToast(`Delete failed: ${err.message ?? err}`);
    }
  }

  async function changeLayer(e: RChangeEvent<HTMLSelectElement>) {
    const lid = Number(e.target.value);
    if (!Number.isFinite(lid) || lid === screen.layer_id) return;
    try {
      const updated = await api.patchScreen(screen.id, { layer_id: lid });
      useStore.getState().upsertScreen(updated);
    } catch (err: any) {
      useStore.getState().showToast(`Layer update failed: ${err.message ?? err}`);
    }
  }

  function onPinPointerDown(ann: Annotation, e: RPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    // Let the map canvas handle "place pin" mode (click-to-set position).
    if (useStore.getState().placingPinForAnnId != null) return;
    e.stopPropagation();
    e.preventDefault();
    useStore.getState().selectScreen(screen.id);
    pinDragActive.current = ann.id;
    pinDragStart.current = { x_norm: ann.x_norm, y_norm: ann.y_norm };
    setPinDragPos({ id: ann.id, x_norm: ann.x_norm, y_norm: ann.y_norm });
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }

  function onPinPointerMove(ann: Annotation, e: RPointerEvent<HTMLDivElement>) {
    if (pinDragActive.current !== ann.id) return;
    const n = normFromPointer(e.clientX, e.clientY);
    if (!n) return;
    setPinDragPos({ id: ann.id, x_norm: n.x_norm, y_norm: n.y_norm });
    const a = useStore.getState().annotations[ann.id];
    if (a) {
      useStore.getState().upsertAnnotation({
        ...a,
        x_norm: n.x_norm,
        y_norm: n.y_norm,
      });
    }
  }

  function onPinPointerUp(ann: Annotation, e: RPointerEvent<HTMLDivElement>) {
    if (pinDragActive.current !== ann.id) return;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    pinDragActive.current = null;
    const start = pinDragStart.current;
    pinDragStart.current = null;
    setPinDragPos(null);
    const a = useStore.getState().annotations[ann.id];
    if (!a) return;
    const moved =
      start != null &&
      (Math.abs(a.x_norm - start.x_norm) > 1e-4 || Math.abs(a.y_norm - start.y_norm) > 1e-4);
    if (moved) {
      api
        .patchAnnotation(a.screen_id, ann.id, { x_norm: a.x_norm, y_norm: a.y_norm })
        .catch((err: any) =>
          useStore.getState().showToast(`Pin save failed: ${err.message ?? err}`),
        );
    }
  }

  return (
    <div
      ref={tileRef}
      className={`tile${isSelected ? ' selected' : ''}${isPicked ? ' composite-pick' : ''}`}
      data-screen-id={screen.id}
      style={{
        left: (screen.grid_x ?? 0) * cellW,
        top: (screen.grid_y ?? 0) * cellH,
        width: tileW,
        height: tileH,
        opacity,
        zIndex,
        boxShadow,
      }}
    >
      {url ? (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <img
            src={url}
            draggable={false}
            style={{
              position: 'absolute',
              left: -crop.x * scaleX,
              top: -crop.y * scaleY,
              width: sourceSize.w * scaleX,
              height: sourceSize.h * scaleY,
              maxWidth: 'none',
            }}
            alt={screen.label ?? ''}
          />
        </div>
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#888' }}>
          (no image)
        </div>
      )}
      <div className="grid-pos">
        {screen.grid_x},{screen.grid_y}
        {(screen.grid_w > 1 || screen.grid_h > 1) ? ` (${screen.grid_w}×${screen.grid_h})` : ''}
      </div>
      {screen.label && <div className="label">{screen.label}</div>}
      {isSelected && (
        <div className="tile-ann-toolbar">
          <button
            type="button"
            data-annotations-pin-toggle
            className={`tile-annotations-pin-btn${isAnnPinned ? ' pinned' : ''}`}
            title={
              isAnnPinned
                ? 'Unpin annotations (hide when another room is selected)'
                : 'Pin annotations (keep visible when you select other rooms)'
            }
            aria-pressed={isAnnPinned}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              useStore.getState().toggleAnnotationBubblePin(screen.id);
            }}
          >
            <PinIcon />
          </button>
          <button
            type="button"
            className="tile-annotations-add-btn"
            title="New annotation for this screen"
            aria-label="New annotation"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={createAnnotation}
          >
            <PlusIcon />
          </button>
        </div>
      )}
      {isSelected && (
        <button
          type="button"
          className="tile-screen-delete-btn"
          title="Delete this screen"
          aria-label="Delete screen"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => void deleteScreen(e)}
        >
          <CloseIcon />
        </button>
      )}
      {isSelected && screen.layer_id != null && (
        <div className="tile-layer-pill" title={`${layerDisplay} — click to change layer`}>
          <span
            className="tile-layer-pill-swatch"
            style={{ background: layer?.color ?? '#6b7280' }}
            aria-hidden
          />
          <div className="tile-layer-pill-field">
            <select
              className="tile-layer-pill-select"
              aria-label="Layer for this screen"
              value={screen.layer_id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => void changeLayer(e)}
            >
              {layerMissing && (
                <option value={screen.layer_id}>Unknown layer #{screen.layer_id}</option>
              )}
              {layers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <span className="tile-layer-pill-name">{layerDisplay}</span>
          </div>
        </div>
      )}
      {!isSelected && isAnnPinned && (
        <span
          className="tile-annotations-pin-badge"
          title="Annotations pinned for this room"
        >
          <PinIcon />
        </span>
      )}
      {screenAnns.map((a) => {
        const pos =
          pinDragPos?.id === a.id
            ? { x: pinDragPos.x_norm, y: pinDragPos.y_norm }
            : { x: a.x_norm, y: a.y_norm };
        return (
          <div
            key={a.id}
            className="ann-pin-wrap"
            style={{
              left: `${pos.x * 100}%`,
              top: `${pos.y * 100}%`,
            }}
          >
            <div
              className="ann-pin"
              data-annotation-id={a.id}
              title={`${a.kind}: ${a.text} (drag to move)`}
              style={{
                background: colorForAnnotationKind(annotationTypes, a.kind),
              }}
              onPointerDown={(e) => onPinPointerDown(a, e)}
              onPointerMove={(e) => onPinPointerMove(a, e)}
              onPointerUp={(e) => onPinPointerUp(a, e)}
              onPointerCancel={(e) => onPinPointerUp(a, e)}
            />
            <button
              type="button"
              className="ann-pin-edit-btn"
              title="Edit annotation"
              aria-label="Edit annotation"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                useStore.getState().openMapAnnotationEditor({
                  annId: a.id,
                  anchorX: r.left + r.width / 2,
                  anchorY: r.bottom + 4,
                });
              }}
            >
              <PencilIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export const ScreenTile = memo(_ScreenTile);
