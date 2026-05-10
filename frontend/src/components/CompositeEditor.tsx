import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, useCellSize, useDisplayCrops } from '../store';
import { api, imageUrlForScreen } from '../api';
import type { Screen } from '../types';

type LayerEntry = {
  screenId: number;
  dx: number;
  dy: number;
  width: number;
  height: number;
  url: string;
  // Whether this layer is a capture (display crops apply visually) or a
  // composite (already baked in; rendered as-is).
  isCapture: boolean;
};

export function CompositeEditor({ screenIds }: { screenIds: number[] }) {
  const screens = useStore((s) => s.screens);
  const captures = useStore((s) => s.captures);
  const composites = useStore((s) => s.composites);
  const close = useStore((s) => s.closeCompositeEditor);
  const upsertScreen = useStore((s) => s.upsertScreen);
  const upsertComposite = useStore((s) => s.upsertComposite);
  const removeScreen = useStore((s) => s.removeScreen);
  const showToast = useStore((s) => s.showToast);
  const cell = useCellSize();

  const displayCrops = useDisplayCrops();

  const [items, setItems] = useState<LayerEntry[]>([]);
  const [activeIdx, setActiveIdx] = useState(1);
  const [opacity, setOpacity] = useState(0.5);
  const [deleteSources, setDeleteSources] = useState(true);
  const [label, setLabel] = useState('');
  const dragRef = useRef<{ idx: number; sx: number; sy: number; ox: number; oy: number } | null>(null);

  // Initialize items from screens (assume natural source size)
  useEffect(() => {
    const list: LayerEntry[] = [];
    for (const id of screenIds) {
      const s = screens[id];
      if (!s) continue;
      const sz = sourceSizeOf(s);
      const url = imageUrlForScreen(s, captures, composites);
      if (!url || !sz) continue;
      const isCapture = s.composite_id == null && s.capture_id != null;
      list.push({
        screenId: id,
        dx: 0,
        dy: 0,
        width: sz.w,
        height: sz.h,
        url,
        isCapture,
      });
    }
    setItems(list);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenIds.join(',')]);

  function sourceSizeOf(s: Screen) {
    if (s.composite_id != null && composites[s.composite_id]) {
      const c = composites[s.composite_id];
      return { w: c.width, h: c.height };
    }
    if (s.capture_id != null && captures[s.capture_id]) {
      const c = captures[s.capture_id];
      return { w: c.width, h: c.height };
    }
    return null;
  }

  // Bounds describe the *visible* region (display-cropped on capture-backed
  // layers). Full-image rectangles can extend beyond this — they'll be clipped
  // by the container's overflow:hidden and by clip-path on the image itself.
  const bounds = useMemo(() => {
    if (items.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      const lcrop = it.isCapture ? displayCrops.left : 0;
      const tcrop = it.isCapture ? displayCrops.top : 0;
      const rcrop = it.isCapture ? displayCrops.right : 0;
      const bcrop = it.isCapture ? displayCrops.bottom : 0;
      minX = Math.min(minX, it.dx + lcrop);
      minY = Math.min(minY, it.dy + tcrop);
      maxX = Math.max(maxX, it.dx + it.width - rcrop);
      maxY = Math.max(maxY, it.dy + it.height - bcrop);
    }
    return { minX, minY, maxX, maxY };
  }, [items, displayCrops]);
  const totalW = bounds.maxX - bounds.minX;
  const totalH = bounds.maxY - bounds.minY;

  // Fit preview into the canvas area
  const previewMaxW = window.innerWidth * 0.8;
  const previewMaxH = window.innerHeight * 0.55;
  const previewScale = Math.min(1, previewMaxW / Math.max(1, totalW), previewMaxH / Math.max(1, totalH));

  function startDrag(idx: number, e: React.PointerEvent<HTMLImageElement>) {
    if (idx !== activeIdx) {
      setActiveIdx(idx);
      return;
    }
    dragRef.current = {
      idx,
      sx: e.clientX,
      sy: e.clientY,
      ox: items[idx].dx,
      oy: items[idx].dy,
    };
    (e.currentTarget as HTMLImageElement).setPointerCapture(e.pointerId);
  }
  function moveDrag(e: React.PointerEvent<HTMLImageElement>) {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.sx) / previewScale;
    const dy = (e.clientY - dragRef.current.sy) / previewScale;
    setItems((prev) => prev.map((it, i) => (
      i === dragRef.current!.idx
        ? { ...it, dx: Math.round(dragRef.current!.ox + dx), dy: Math.round(dragRef.current!.oy + dy) }
        : it
    )));
  }
  function endDrag(e: React.PointerEvent<HTMLImageElement>) {
    dragRef.current = null;
    try { (e.currentTarget as HTMLImageElement).releasePointerCapture(e.pointerId); } catch {}
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const arrows: Record<string, [number, number]> = {
        ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      };
      const arrow = arrows[e.key];
      if (!arrow) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      setItems((prev) => prev.map((it, i) => (
        i === activeIdx ? { ...it, dx: it.dx + arrow[0] * step, dy: it.dy + arrow[1] * step } : it
      )));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIdx]);

  const cellsW = Math.max(1, Math.round(totalW / cell.w));
  const cellsH = Math.max(1, Math.round(totalH / cell.h));

  async function save() {
    try {
      const res = await api.createComposite({
        source_screen_ids: items.map((i) => i.screenId),
        alignment: items.map((i) => ({ screen_id: i.screenId, dx: i.dx, dy: i.dy })),
        delete_sources: deleteSources,
        label: label || null,
        grid_w: cellsW,
        grid_h: cellsH,
      });
      upsertComposite(res.composite);
      upsertScreen(res.screen);
      if (deleteSources) {
        for (const id of items.map((i) => i.screenId)) removeScreen(id);
      }
      showToast(`Created composite (${cellsW}×${cellsH} cells)`);
      close();
    } catch (e: any) {
      showToast(`Composite failed: ${e.message ?? e}`);
    }
  }

  function autoStack(direction: 'down' | 'right') {
    // Visible bottom/right of the previously-placed layer. New layer starts a
    // visible-content overlap of ~32px before that boundary so the user can
    // see the seam and nudge.
    setItems((prev) => {
      let acc = 0;
      return prev.map((it, i) => {
        const lcrop = it.isCapture ? displayCrops.left : 0;
        const tcrop = it.isCapture ? displayCrops.top : 0;
        const rcrop = it.isCapture ? displayCrops.right : 0;
        const bcrop = it.isCapture ? displayCrops.bottom : 0;
        if (i === 0) {
          acc =
            direction === 'down'
              ? 0 + it.height - bcrop
              : 0 + it.width - rcrop;
          return { ...it, dx: 0, dy: 0 };
        }
        if (direction === 'down') {
          const dy = acc - 32 - tcrop;
          const out = { ...it, dx: 0, dy };
          acc = dy + it.height - bcrop;
          return out;
        } else {
          const dx = acc - 32 - lcrop;
          const out = { ...it, dx, dy: 0 };
          acc = dx + it.width - rcrop;
          return out;
        }
      });
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal" style={{ minWidth: 640 }}>
        <h2>Combine {items.length} screens</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: 0 }}>
          Click a layer in the list to make it active, then drag it on the preview or use arrow keys (Shift = ×10) to align.
          Adjust opacity to see overlap. Save to merge into one composite tile.
        </p>

        <div className="row">
          <button onClick={() => autoStack('down')}>Auto-stack vertically</button>
          <button onClick={() => autoStack('right')}>Auto-stack horizontally</button>
          <span style={{ flex: 1 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            Active opacity:
            <input
              type="range" min={0.1} max={1} step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
            />
            {opacity.toFixed(2)}
          </label>
        </div>

        <div
          className="composite-canvas"
          style={{ width: Math.max(200, totalW * previewScale), height: Math.max(200, totalH * previewScale) }}
        >
          {items.map((it, i) => {
            const lcrop = it.isCapture ? displayCrops.left : 0;
            const tcrop = it.isCapture ? displayCrops.top : 0;
            const rcrop = it.isCapture ? displayCrops.right : 0;
            const bcrop = it.isCapture ? displayCrops.bottom : 0;
            const clip =
              lcrop || rcrop || tcrop || bcrop
                ? `inset(${tcrop * previewScale}px ${rcrop * previewScale}px ${
                    bcrop * previewScale
                  }px ${lcrop * previewScale}px)`
                : undefined;
            return (
              <img
                key={it.screenId}
                src={it.url}
                draggable={false}
                className="draggable"
                onPointerDown={(e) => startDrag(i, e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                style={{
                  left: (it.dx - bounds.minX) * previewScale,
                  top: (it.dy - bounds.minY) * previewScale,
                  width: it.width * previewScale,
                  height: it.height * previewScale,
                  opacity: i === activeIdx ? opacity : 1,
                  outline: i === activeIdx ? '2px solid var(--accent)' : 'none',
                  zIndex: i === activeIdx ? 5 : i,
                  clipPath: clip,
                }}
                alt=""
              />
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {items.map((it, i) => (
            <button
              key={it.screenId}
              onClick={() => setActiveIdx(i)}
              style={{
                outline: i === activeIdx ? '2px solid var(--accent)' : 'none',
                background: i === activeIdx ? 'var(--bg-elev-2)' : undefined,
              }}
            >
              #{it.screenId} ({it.dx}, {it.dy})
            </button>
          ))}
        </div>

        <div className="row">
          <input
            placeholder="Composite label (optional, e.g., 'Surface tall room')"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={deleteSources} onChange={(e) => setDeleteSources(e.target.checked)} />
            Delete source screens after merging
          </label>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            Output: {totalW}×{totalH}px → {cellsW}×{cellsH} cells
          </span>
        </div>

        <div className="actions">
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={save} disabled={items.length < 2}>
            Save composite
          </button>
        </div>
      </div>
    </div>
  );
}
