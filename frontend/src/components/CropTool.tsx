import { useEffect, useRef, useState } from 'react';
import { useStore, useDisplayCrops } from '../store';
import type { DisplayCrops } from '../store';
import { api, imageUrlForAnnotation, imageUrlForScreen } from '../api';
import type { CropBox } from '../types';

// Translucent red strips showing which pixels are hidden globally by the
// `display_*_crop_px` settings. Pointer-events: none so the user can still
// drag a selection through these regions if they want.
function DisplayCropOverlays({
  displayCrops,
  displayW,
  displayH,
  displayScale,
}: {
  displayCrops: DisplayCrops;
  displayW: number;
  displayH: number;
  displayScale: number;
}) {
  const stripStyle: React.CSSProperties = {
    position: 'absolute',
    background: 'rgba(239,71,111,0.32)',
    pointerEvents: 'none',
  };
  return (
    <>
      {displayCrops.top > 0 && (
        <div
          style={{
            ...stripStyle,
            left: 0,
            top: 0,
            width: displayW,
            height: displayCrops.top * displayScale,
          }}
        />
      )}
      {displayCrops.bottom > 0 && (
        <div
          style={{
            ...stripStyle,
            left: 0,
            bottom: 0,
            width: displayW,
            height: displayCrops.bottom * displayScale,
          }}
        />
      )}
      {displayCrops.left > 0 && (
        <div
          style={{
            ...stripStyle,
            left: 0,
            top: 0,
            width: displayCrops.left * displayScale,
            height: displayH,
          }}
        />
      )}
      {displayCrops.right > 0 && (
        <div
          style={{
            ...stripStyle,
            right: 0,
            top: 0,
            width: displayCrops.right * displayScale,
            height: displayH,
          }}
        />
      )}
    </>
  );
}

export function CropTool({ screenId }: { screenId: number }) {
  const screen = useStore((s) => s.screens[screenId]);
  const captures = useStore((s) => s.captures);
  const composites = useStore((s) => s.composites);
  const close = useStore((s) => s.closeCropTool);
  const upsertScreen = useStore((s) => s.upsertScreen);
  const showToast = useStore((s) => s.showToast);
  const displayCrops = useDisplayCrops();
  const url = screen ? imageUrlForScreen(screen, captures, composites) : undefined;
  const isCapture =
    screen != null && screen.composite_id == null && screen.capture_id != null;

  const sourceSize = (() => {
    if (!screen) return { w: 0, h: 0 };
    if (screen.composite_id != null && composites[screen.composite_id]) {
      const c = composites[screen.composite_id];
      return { w: c.width, h: c.height };
    }
    if (screen.capture_id != null && captures[screen.capture_id]) {
      const c = captures[screen.capture_id];
      return { w: c.width, h: c.height };
    }
    return { w: 0, h: 0 };
  })();

  const [rect, setRect] = useState<CropBox | null>(screen?.crop_box ?? null);
  const dragRef = useRef<{ sx: number; sy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setRect(screen?.crop_box ?? null);
  }, [screen?.crop_box]);

  if (!screen) return null;

  function getXY(clientX: number, clientY: number) {
    const r = imgRef.current!.getBoundingClientRect();
    const sx = sourceSize.w / r.width;
    const sy = sourceSize.h / r.height;
    return {
      x: Math.max(0, Math.min(sourceSize.w, (clientX - r.left) * sx)),
      y: Math.max(0, Math.min(sourceSize.h, (clientY - r.top) * sy)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const p = getXY(e.clientX, e.clientY);
    dragRef.current = { sx: p.x, sy: p.y };
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const p = getXY(e.clientX, e.clientY);
    const x = Math.min(p.x, dragRef.current.sx);
    const y = Math.min(p.y, dragRef.current.sy);
    const w = Math.abs(p.x - dragRef.current.sx);
    const h = Math.abs(p.y - dragRef.current.sy);
    setRect({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  async function save() {
    try {
      const updated = await api.patchScreen(screen.id, { crop_box: rect ?? undefined } as any);
      upsertScreen(updated);
      close();
    } catch (e: any) {
      showToast(`Save crop failed: ${e.message ?? e}`);
    }
  }

  async function clearCrop() {
    try {
      const updated = await api.patchScreen(screen.id, { clear_crop_box: true });
      upsertScreen(updated);
      setRect(null);
      close();
    } catch (e: any) {
      showToast(`Clear crop failed: ${e.message ?? e}`);
    }
  }

  // Render scaled to fit
  const displayMaxW = Math.min(window.innerWidth * 0.8, sourceSize.w);
  const displayScale = sourceSize.w > 0 ? displayMaxW / sourceSize.w : 1;
  const displayW = sourceSize.w * displayScale;
  const displayH = sourceSize.h * displayScale;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal">
        <h2>Crop / sub-region for screen #{screen.id}</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: 0 }}>
          Drag to select the region of the source image to use as this screen's tile.
          Useful for capturing a single gravestone, sign, or detail.
        </p>
        <div
          className="crop-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ width: displayW, height: displayH }}
        >
          {url && (
            <img
              ref={imgRef}
              src={url}
              alt=""
              draggable={false}
              style={{ width: displayW, height: displayH, userSelect: 'none' }}
            />
          )}
          {isCapture && (
            <DisplayCropOverlays
              displayCrops={displayCrops}
              displayW={displayW}
              displayH={displayH}
              displayScale={displayScale}
            />
          )}
          {rect && rect.w > 0 && rect.h > 0 && (
            <div
              className="crop-rect"
              style={{
                left: rect.x * displayScale,
                top: rect.y * displayScale,
                width: rect.w * displayScale,
                height: rect.h * displayScale,
              }}
            />
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {rect ? `Region: x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h}` : 'No region selected'}
        </div>
        <div className="actions">
          <button onClick={clearCrop}>Clear crop</button>
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={save} disabled={!rect || rect.w < 4 || rect.h < 4}>
            Save crop
          </button>
        </div>
      </div>
    </div>
  );
}

export function AnnotationCropTool({ annotationId }: { annotationId: number }) {
  const ann = useStore((s) => s.annotations[annotationId]);
  const captures = useStore((s) => s.captures);
  const close = useStore((s) => s.closeAnnotationCropTool);
  const upsertAnnotation = useStore((s) => s.upsertAnnotation);
  const showToast = useStore((s) => s.showToast);

  const url = ann ? imageUrlForAnnotation(ann, captures) : undefined;
  const capture = ann?.capture_id != null ? captures[ann.capture_id] : undefined;
  const sourceSize = capture
    ? { w: capture.width, h: capture.height }
    : { w: 0, h: 0 };

  const [rect, setRect] = useState<CropBox | null>(ann?.capture_crop ?? null);
  const dragRef = useRef<{ sx: number; sy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setRect(ann?.capture_crop ?? null);
  }, [ann?.capture_crop]);

  if (!ann) return null;
  if (!capture) {
    return (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div className="modal">
          <h2>Crop annotation capture</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: 0 }}>
            This annotation has no capture attached yet. Capture an image first
            from the right-side panel.
          </p>
          <div className="actions">
            <button onClick={close}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  function getXY(clientX: number, clientY: number) {
    const r = imgRef.current!.getBoundingClientRect();
    const sx = sourceSize.w / r.width;
    const sy = sourceSize.h / r.height;
    return {
      x: Math.max(0, Math.min(sourceSize.w, (clientX - r.left) * sx)),
      y: Math.max(0, Math.min(sourceSize.h, (clientY - r.top) * sy)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const p = getXY(e.clientX, e.clientY);
    dragRef.current = { sx: p.x, sy: p.y };
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const p = getXY(e.clientX, e.clientY);
    const x = Math.min(p.x, dragRef.current.sx);
    const y = Math.min(p.y, dragRef.current.sy);
    const w = Math.abs(p.x - dragRef.current.sx);
    const h = Math.abs(p.y - dragRef.current.sy);
    setRect({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  async function save() {
    if (!ann) return;
    try {
      const updated = await api.patchAnnotation(ann.screen_id, ann.id, {
        capture_crop: rect ?? undefined,
      });
      upsertAnnotation(updated);
      close();
    } catch (e: any) {
      showToast(`Save crop failed: ${e.message ?? e}`);
    }
  }

  async function clearCrop() {
    if (!ann) return;
    try {
      const updated = await api.patchAnnotation(ann.screen_id, ann.id, {
        clear_capture_crop: true,
      });
      upsertAnnotation(updated);
      setRect(null);
      close();
    } catch (e: any) {
      showToast(`Clear crop failed: ${e.message ?? e}`);
    }
  }

  const displayMaxW = Math.min(window.innerWidth * 0.8, sourceSize.w);
  const displayScale = sourceSize.w > 0 ? displayMaxW / sourceSize.w : 1;
  const displayW = sourceSize.w * displayScale;
  const displayH = sourceSize.h * displayScale;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal">
        <h2>Crop annotation capture</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: 0 }}>
          Drag to select the region of the captured image to keep (e.g. just the
          gravestone text). The bubble on the tile will only show this region.
        </p>
        <div
          className="crop-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ width: displayW, height: displayH }}
        >
          {url && (
            <img
              ref={imgRef}
              src={url}
              alt=""
              draggable={false}
              style={{ width: displayW, height: displayH, userSelect: 'none' }}
            />
          )}
          {rect && rect.w > 0 && rect.h > 0 && (
            <div
              className="crop-rect"
              style={{
                left: rect.x * displayScale,
                top: rect.y * displayScale,
                width: rect.w * displayScale,
                height: rect.h * displayScale,
              }}
            />
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {rect ? `Region: x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h}` : 'No region selected'}
        </div>
        <div className="actions">
          <button onClick={clearCrop}>Clear crop</button>
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={save} disabled={!rect || rect.w < 4 || rect.h < 4}>
            Save crop
          </button>
        </div>
      </div>
    </div>
  );
}
