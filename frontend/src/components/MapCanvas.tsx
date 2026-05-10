import {
  PointerEvent as RPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  WheelEvent as RWheelEvent,
} from 'react';
import { useStore, useCellSize } from '../store';
import { ScreenTile } from './ScreenTile';
import { LayerHullOutlines } from './LayerHullOutlines';
import { AnnotationBubbles } from './AnnotationBubbles';
import { AnnotationYarnLayer } from './AnnotationYarnLayer';
import { api } from '../api';
import type { Screen } from '../types';

const MIN_SCALE = 0.05;
const MAX_SCALE = 16;
const VIRTUAL_HALF = 200000;

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function MapCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const screens = useStore((s) => s.screens);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const captures = useStore((s) => s.captures);
  const composites = useStore((s) => s.composites);
  const layers = useStore((s) => s.layers);
  const cell = useCellSize();
  const selectScreen = useStore((s) => s.selectScreen);
  const compositePicker = useStore((s) => s.compositePicker);
  const showToast = useStore((s) => s.showToast);
  const alwaysShowBubbles = useStore((s) => s.alwaysShowAnnotationBubbles);
  const toggleAlwaysShowBubbles = useStore((s) => s.toggleAlwaysShowAnnotationBubbles);

  const [spaceHeld, setSpaceHeld] = useState(false);
  const panState = useRef<{ active: boolean; sx: number; sy: number; vx: number; vy: number } | null>(null);
  const dragState = useRef<{
    screenId: number;
    startX: number;
    startY: number;
    origGridX: number;
    origGridY: number;
    moved: boolean;
  } | null>(null);

  // dragOver position in grid coords (preview when dropping from tray)
  const [dropPreview, setDropPreview] = useState<{ gx: number; gy: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) setSpaceHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  const placedHere = useMemo(() => {
    const list = Object.values(screens).filter(
      (s) => s.layer_id != null && s.grid_x != null && s.grid_y != null,
    );
    if (activeLayerId == null) {
      return list.sort((a, b) => (a.layer_id! - b.layer_id!) || a.id - b.id);
    }
    return list.sort((a, b) => {
      const aOn = a.layer_id === activeLayerId ? 1 : 0;
      const bOn = b.layer_id === activeLayerId ? 1 : 0;
      if (aOn !== bOn) return aOn - bOn;
      return a.id - b.id;
    });
  }, [screens, activeLayerId]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      const x = (clientX - r.left - view.tx) / view.scale;
      const y = (clientY - r.top - view.ty) / view.scale;
      return { x, y };
    },
    [view.tx, view.ty, view.scale],
  );

  const onWheel = (e: RWheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newScale = clampScale(view.scale * factor);
    const r = wrapRef.current!.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    // Keep cursor anchored at the same world point.
    const worldX = (cx - view.tx) / view.scale;
    const worldY = (cy - view.ty) / view.scale;
    setView({
      scale: newScale,
      tx: cx - worldX * newScale,
      ty: cy - worldY * newScale,
    });
  };

  // Reference capture width used for the zoom percentage. Captures from the
  // same La-Mulana window are all the same dimensions, so any one is fine;
  // pick the smallest id for stability across reloads.
  const refCaptureW = useMemo(() => {
    let best: { id: number; w: number } | null = null;
    for (const c of Object.values(captures)) {
      if (!best || c.id < best.id) best = { id: c.id, w: c.width };
    }
    return best?.w ?? null;
  }, [captures]);

  // Live zoom expressed as "1 source pixel : N screen pixels" for a
  // reference 1-cell, no-crop screen.
  const zoomPercent = useMemo(() => {
    if (refCaptureW == null || refCaptureW === 0) return null;
    return (cell.w * view.scale) / refCaptureW;
  }, [refCaptureW, cell.w, view.scale]);

  const setZoomToCaptureNative = useCallback(() => {
    if (refCaptureW == null || refCaptureW === 0) return;
    const target = clampScale(refCaptureW / cell.w);
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) {
      setView({ scale: target });
      return;
    }
    const cx = r.width / 2;
    const cy = r.height / 2;
    const worldX = (cx - view.tx) / view.scale;
    const worldY = (cy - view.ty) / view.scale;
    setView({
      scale: target,
      tx: cx - worldX * target,
      ty: cy - worldY * target,
    });
  }, [refCaptureW, cell.w, view.tx, view.ty, view.scale, setView]);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const tileEl = target.closest('[data-screen-id]') as HTMLElement | null;
    const isPan = e.button === 1 || (e.button === 0 && spaceHeld);

    if (isPan) {
      e.preventDefault();
      panState.current = {
        active: true,
        sx: e.clientX,
        sy: e.clientY,
        vx: view.tx,
        vy: view.ty,
      };
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    if (target.closest('[data-annotations-pin-toggle]')) return;

    const placingPin = useStore.getState().placingPinForAnnId;
    if (placingPin != null && tileEl) {
      const id = Number(tileEl.dataset.screenId);
      const sc = screens[id];
      if (sc) {
        const rect = tileEl.getBoundingClientRect();
        const x_norm = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const y_norm = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
        // Optimistic update
        const ann = useStore.getState().annotations[placingPin];
        if (ann) {
          useStore.getState().upsertAnnotation({ ...ann, x_norm, y_norm, screen_id: id });
        }
        api
          .patchAnnotation(ann?.screen_id ?? id, placingPin, { x_norm, y_norm })
          .catch((err: any) => showToast(`Pin save failed: ${err.message ?? err}`));
        useStore.getState().setPlacingPinForAnn(null);
      }
      return;
    }

    if (tileEl) {
      const id = Number(tileEl.dataset.screenId);
      const sc = screens[id];
      if (!sc) return;
      if (compositePicker.active) {
        useStore.getState().toggleCompositePick(id);
        return;
      }
      selectScreen(id);
      if (sc.grid_x != null && sc.grid_y != null) {
        dragState.current = {
          screenId: id,
          startX: e.clientX,
          startY: e.clientY,
          origGridX: sc.grid_x,
          origGridY: sc.grid_y,
          moved: false,
        };
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      }
    } else if (!target.closest('.ann-bubble') && !target.closest('.bubble-toggle')) {
      // Don't deselect when clicking inside an annotation bubble or the
      // bubble-visibility toggle — those float over the canvas but logically
      // belong to the current selection / global UI.
      selectScreen(null);
    }
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (panState.current?.active) {
      setView({
        tx: panState.current.vx + (e.clientX - panState.current.sx),
        ty: panState.current.vy + (e.clientY - panState.current.sy),
      });
      return;
    }
    const drag = dragState.current;
    if (drag) {
      const dx = (e.clientX - drag.startX) / view.scale;
      const dy = (e.clientY - drag.startY) / view.scale;
      const newGx = drag.origGridX + Math.round(dx / cell.w);
      const newGy = drag.origGridY + Math.round(dy / cell.h);
      const sc = screens[drag.screenId];
      if (sc && (sc.grid_x !== newGx || sc.grid_y !== newGy)) {
        drag.moved = true;
        useStore.getState().upsertScreen({ ...sc, grid_x: newGx, grid_y: newGy });
      }
    }
  };

  const finishPan = (e: RPointerEvent<HTMLDivElement>) => {
    panState.current = null;
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {}
  };

  const onPointerUp = async (e: RPointerEvent<HTMLDivElement>) => {
    if (panState.current?.active) {
      finishPan(e);
      return;
    }
    const drag = dragState.current;
    dragState.current = null;
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {}
    if (drag && drag.moved) {
      const sc = screens[drag.screenId];
      if (sc) {
        try {
          await api.patchScreen(sc.id, { grid_x: sc.grid_x, grid_y: sc.grid_y });
        } catch (err: any) {
          showToast(`Move failed: ${err.message ?? err}`);
        }
      }
    }
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('application/x-iiosmap-screen')) {
      e.preventDefault();
      const { x, y } = screenToWorld(e.clientX, e.clientY);
      const gx = Math.floor(x / cell.w);
      const gy = Math.floor(y / cell.h);
      setDropPreview({ gx, gy });
    }
  };
  const onDragLeave = () => setDropPreview(null);
  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    const screenIdStr = e.dataTransfer.getData('application/x-iiosmap-screen');
    setDropPreview(null);
    if (!screenIdStr) return;
    const id = Number(screenIdStr);
    if (!activeLayerId) {
      showToast('Pick (or create) a layer first');
      return;
    }
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const gx = Math.floor(x / cell.w);
    const gy = Math.floor(y / cell.h);
    try {
      await api.patchScreen(id, { layer_id: activeLayerId, grid_x: gx, grid_y: gy });
    } catch (err: any) {
      showToast(`Place failed: ${err.message ?? err}`);
    }
  };

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      style={{ cursor: spaceHeld ? 'grab' : 'default' }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="canvas-inner"
        style={{
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
        }}
      >
        <div
          className="grid-bg"
          style={{
            left: -VIRTUAL_HALF,
            top: -VIRTUAL_HALF,
            width: VIRTUAL_HALF * 2,
            height: VIRTUAL_HALF * 2,
            backgroundSize: `${cell.w}px ${cell.h}px`,
            // Align the repeating pattern to world (0,0) so lines coincide with
            // tile boundaries regardless of cell size or VIRTUAL_HALF.
            backgroundPosition: `${VIRTUAL_HALF % cell.w}px ${VIRTUAL_HALF % cell.h}px`,
          }}
        />
        {placedHere.map((s) => (
          <ScreenTile
            key={s.id}
            screen={s}
            cellW={cell.w}
            cellH={cell.h}
            captures={captures}
            composites={composites}
          />
        ))}
        <LayerHullOutlines
          screens={placedHere}
          layers={layers}
          activeLayerId={activeLayerId}
          cellW={cell.w}
          cellH={cell.h}
        />
        {dropPreview && (
          <div
            style={{
              position: 'absolute',
              left: dropPreview.gx * cell.w,
              top: dropPreview.gy * cell.h,
              width: cell.w,
              height: cell.h,
              border: '2px dashed var(--accent-2)',
              background: 'rgba(255,180,84,0.1)',
              pointerEvents: 'none',
              zIndex: 9,
            }}
          />
        )}
      </div>
      <AnnotationYarnLayer
        screens={placedHere}
        cellW={cell.w}
        cellH={cell.h}
        view={view}
      />
      <AnnotationBubbles
        screens={placedHere}
        cellW={cell.w}
        cellH={cell.h}
        view={view}
      />
      <button
        className={`bubble-toggle${alwaysShowBubbles ? ' on' : ''}`}
        onClick={toggleAlwaysShowBubbles}
        title={
          alwaysShowBubbles
            ? 'Annotation bubbles: always visible (click to only show on the selected tile)'
            : 'Annotation bubbles: only on the selected tile (click to always show)'
        }
      >
        {alwaysShowBubbles ? 'Bubbles: All' : 'Bubbles: Selected'}
      </button>
      <div className="zoom-badge">
        <span className="zoom-label" title="Captured-pixel size at current zoom">
          {zoomPercent != null
            ? `Zoom ${Math.round(zoomPercent * 100)}%`
            : 'Zoom —'}
        </span>
        <button
          onClick={setZoomToCaptureNative}
          disabled={refCaptureW == null}
          title="Zoom to native capture size (1 captured pixel = 1 screen pixel)"
        >
          100%
        </button>
      </div>
    </div>
  );
}
