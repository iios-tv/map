import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useStore, settingsGridAuto } from '../store';
import type { AnnotationTypeDef } from '../types';
import { api } from '../api';

const NUM_KEYS = [
  'display_top_crop_px',
  'display_bottom_crop_px',
  'display_left_crop_px',
  'display_right_crop_px',
] as const;

type NumKey = (typeof NUM_KEYS)[number];

const LABELS: Record<NumKey, string> = {
  display_top_crop_px: 'Top',
  display_bottom_crop_px: 'Bottom',
  display_left_crop_px: 'Left',
  display_right_crop_px: 'Right',
};

export function SettingsModal() {
  const close = useStore((s) => s.closeSettings);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const settings = useStore((s) => s.settings);
  const annotations = useStore((s) => s.annotations);
  const annotationTypes = useStore((s) => s.annotationTypes);
  const setSettings = useStore((s) => s.setSettings);
  const setAnnotationTypes = useStore((s) => s.setAnnotationTypes);
  const bootstrap = useStore((s) => s.bootstrap);
  const captures = useStore((s) => s.captures);
  const showToast = useStore((s) => s.showToast);
  const yarnPanSwingEnabled = useStore((s) => s.yarnPanSwingEnabled);
  const yarnPanSwingStrength = useStore((s) => s.yarnPanSwingStrength);
  const setYarnPanSwingEnabled = useStore((s) => s.setYarnPanSwingEnabled);
  const setYarnPanSwingStrength = useStore((s) => s.setYarnPanSwingStrength);

  const [displayCrops, setDisplayCrops] = useState<Record<NumKey, string>>({
    display_top_crop_px: settings.display_top_crop_px ?? '0',
    display_bottom_crop_px: settings.display_bottom_crop_px ?? '0',
    display_left_crop_px: settings.display_left_crop_px ?? '0',
    display_right_crop_px: settings.display_right_crop_px ?? '0',
  });
  const [hotkey, setHotkey] = useState(settings.hotkey);
  const [cellW, setCellW] = useState(settings.grid_cell_w);
  const [cellH, setCellH] = useState(settings.grid_cell_h);
  const [gridAuto, setGridAuto] = useState(() => settingsGridAuto(settings));

  const importBackupRef = useRef<HTMLInputElement>(null);

  const [draftAnnotationTypes, setDraftAnnotationTypes] = useState<AnnotationTypeDef[]>([]);

  const kindUsageCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of Object.values(annotations)) {
      m.set(a.kind, (m.get(a.kind) ?? 0) + 1);
    }
    return m;
  }, [annotations]);

  const annotationTypesDraftDirty = useMemo(() => {
    const baseline = annotationTypes
      .filter((t) => !t.synthetic)
      .map((t) => ({ id: t.id, label: t.label, color: t.color }));
    const draft = draftAnnotationTypes.map((t) => ({ id: t.id, label: t.label, color: t.color }));
    return JSON.stringify(baseline) !== JSON.stringify(draft);
  }, [annotationTypes, draftAnnotationTypes]);

  useEffect(() => {
    if (!settingsOpen) return;
    const declared = annotationTypes
      .filter((t) => !t.synthetic)
      .map((t) => ({ id: t.id, label: t.label, color: t.color }));
    setDraftAnnotationTypes(declared);
  }, [settingsOpen, annotationTypes]);

  function removeAnnotationTypeRow(id: string) {
    const n = kindUsageCount.get(id) ?? 0;
    if (n > 0) {
      showToast(
        `Cannot remove this type: ${n} annotation(s) still use it. Reassign or delete those annotations first.`,
      );
      return;
    }
    setDraftAnnotationTypes((rows) => rows.filter((r) => r.id !== id));
  }

  async function exportMapBackup() {
    try {
      const blob = await api.downloadBackupZip();
      const safeTs = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19);
      const fname = `iiosmap-backup-${safeTs}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Backup downloaded');
    } catch (e: unknown) {
      showToast(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function onPickImportBackup(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.zip')) {
      showToast('Choose a .zip exported from this app (Export backup)');
      return;
    }
    if (
      !window.confirm(
        'Replace ALL map data on this machine from the ZIP?\n\n' +
          'This overwrites db.sqlite plus every capture and composite image.',
      )
    ) {
      return;
    }
    try {
      await api.importBackupZip(f);
      await bootstrap();
      showToast('Backup imported');
    } catch (err: unknown) {
      showToast(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  useEffect(() => {
    setDisplayCrops({
      display_top_crop_px: settings.display_top_crop_px ?? '0',
      display_bottom_crop_px: settings.display_bottom_crop_px ?? '0',
      display_left_crop_px: settings.display_left_crop_px ?? '0',
      display_right_crop_px: settings.display_right_crop_px ?? '0',
    });
  }, [
    settings.display_top_crop_px,
    settings.display_bottom_crop_px,
    settings.display_left_crop_px,
    settings.display_right_crop_px,
  ]);
  useEffect(() => { setHotkey(settings.hotkey); }, [settings.hotkey]);
  useEffect(() => { setCellW(settings.grid_cell_w); }, [settings.grid_cell_w]);
  useEffect(() => { setCellH(settings.grid_cell_h); }, [settings.grid_cell_h]);
  useEffect(() => {
    setGridAuto(settingsGridAuto(settings));
  }, [settings.grid_cell_auto]);

  const latestCapture = useMemo(() => {
    const list = Object.values(captures);
    if (list.length === 0) return null;
    return list.reduce((a, b) => (a.id > b.id ? a : b));
  }, [captures]);

  function setField(key: NumKey, value: string) {
    setDisplayCrops((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    const payload: Record<string, string | number | boolean> = {};
    for (const k of NUM_KEYS) {
      if (displayCrops[k] !== (settings[k] ?? '0')) {
        payload[k] = parseInt(displayCrops[k], 10) || 0;
      }
    }
    if (hotkey !== settings.hotkey) payload.hotkey = hotkey;
    if (gridAuto !== settingsGridAuto(settings)) {
      if (
        gridAuto &&
        !settingsGridAuto(settings) &&
        Object.values(useStore.getState().screens).filter(
          (sc) =>
            sc.layer_id != null && sc.grid_x != null && sc.grid_y != null,
        ).length > 0
      ) {
        const msg = [
          'You are enabling automatic cell size while tiles are already placed on the map.',
          '',
          'Positions are saved as grid coordinates — they are not magically realigned.',
          'The canvas cell size switches to match the TARGET WINDOW, which almost always mismatches layouts built at 256×192.',
          '',
          'For an existing iiosMap save, leave this unchecked and stay on manual cells.',
          '',
          'Enable anyway?',
        ].join('\n');
        if (!window.confirm(msg)) {
          return;
        }
      }
      payload.grid_cell_auto = gridAuto;
    }
    if (!gridAuto) {
      if (cellW !== settings.grid_cell_w) payload.grid_cell_w = parseInt(cellW, 10) || 256;
      if (cellH !== settings.grid_cell_h) payload.grid_cell_h = parseInt(cellH, 10) || 192;
    }

    const settingsDirty = Object.keys(payload).length > 0;
    if (!settingsDirty && !annotationTypesDraftDirty) {
      close();
      return;
    }
    if (annotationTypesDraftDirty && draftAnnotationTypes.length === 0) {
      showToast('Keep at least one annotation type.');
      return;
    }

    try {
      if (annotationTypesDraftDirty) {
        const out = await api.putAnnotationTypes(draftAnnotationTypes);
        setAnnotationTypes(out);
      }
      if (settingsDirty) {
        const updated = await api.patchSettings(payload as any);
        setSettings(updated);
      }
      showToast('Settings saved');
      close();
    } catch (e: any) {
      showToast(`Save failed: ${e.message ?? e}`);
    }
  }

  // Preview shows the original capture at its native captured size (1:1) so
  // the user can dial in display crops against true source pixels. The
  // wrapping box is scrollable in case the capture is larger than the modal.
  const liveCrops: Record<NumKey, number> = {
    display_top_crop_px: parseInt(displayCrops.display_top_crop_px, 10) || 0,
    display_bottom_crop_px: parseInt(displayCrops.display_bottom_crop_px, 10) || 0,
    display_left_crop_px: parseInt(displayCrops.display_left_crop_px, 10) || 0,
    display_right_crop_px: parseInt(displayCrops.display_right_crop_px, 10) || 0,
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal" style={{ minWidth: 580 }}>
        <h2>Settings</h2>

        <div className="modal-scroll-body">
        <div className="row">
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>Display crops (canvas-only)</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 11, margin: '0 0 8px' }}>
              These hide pixels from the canvas only — captures are saved at full
              size. Change these freely; existing captures re-render instantly.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px 12px',
              }}
            >
              {NUM_KEYS.map((k) => (
                <label
                  key={k}
                  style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                >
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {LABELS[k]} (px)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={displayCrops[k]}
                    onChange={(e) => setField(k, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label>
              Live preview (latest capture
              {latestCapture
                ? ` — ${latestCapture.width}×${latestCapture.height}`
                : ''}
              )
            </label>
            {latestCapture ? (
              <div
                // The wrapper renders at the capture's intrinsic size when the
                // modal has room, and scales down (preserving aspect ratio) on
                // narrower viewports. Crop overlays are sized as percentages of
                // the wrapper so they stay correct at any rendered scale.
                style={{
                  position: 'relative',
                  width: latestCapture.width,
                  maxWidth: '100%',
                  aspectRatio: `${latestCapture.width} / ${latestCapture.height}`,
                  background: '#000',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                }}
              >
                <img
                  src={`/images/${latestCapture.filename}`}
                  alt=""
                  style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    imageRendering: 'pixelated',
                  }}
                />
                {liveCrops.display_top_crop_px > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: 0,
                      height: `${(liveCrops.display_top_crop_px / latestCapture.height) * 100}%`,
                      background: 'rgba(239,71,111,0.4)',
                      borderBottom: '1px solid var(--danger)',
                    }}
                  />
                )}
                {liveCrops.display_bottom_crop_px > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: `${(liveCrops.display_bottom_crop_px / latestCapture.height) * 100}%`,
                      background: 'rgba(239,71,111,0.4)',
                      borderTop: '1px solid var(--danger)',
                    }}
                  />
                )}
                {liveCrops.display_left_crop_px > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${(liveCrops.display_left_crop_px / latestCapture.width) * 100}%`,
                      background: 'rgba(239,71,111,0.4)',
                      borderRight: '1px solid var(--danger)',
                    }}
                  />
                )}
                {liveCrops.display_right_crop_px > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: `${(liveCrops.display_right_crop_px / latestCapture.width) * 100}%`,
                      background: 'rgba(239,71,111,0.4)',
                      borderLeft: '1px solid var(--danger)',
                    }}
                  />
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                No captures yet.
              </div>
            )}
          </div>
        </div>

        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Global hotkey</label>
            <input
              value={hotkey}
              onChange={(e) => setHotkey(e.target.value)}
              placeholder="e.g., ctrl+alt+s"
            />
            <p style={{ color: 'var(--text-dim)', fontSize: 11, margin: '4px 0 0' }}>
              Re-registered on save. Format: <code>ctrl+shift+f12</code> etc.
            </p>
          </div>
        </div>

        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={gridAuto}
              onChange={(e) => setGridAuto(e.target.checked)}
            />
            <span style={{ fontSize: 13 }}>Match map cell size to capture target window</span>
          </label>
          <p style={{ color: 'var(--text-dim)', fontSize: 11, margin: 0, lineHeight: 1.45 }}>
            Intended for{' '}
            <strong style={{ color: 'var(--text)' }}>new</strong> maps and games other than fixed
            256×192 game layout. Turning this on does{' '}
            <strong style={{ color: 'var(--text)' }}>not</strong> repack existing tiles—you only
            change how big each grid cell is, so dense maps built at manual size will look scrambled.
          </p>
          {gridAuto && (
            <p style={{ color: 'var(--text-dim)', fontSize: 11, margin: 0 }}>
              Live cell size from target window:{' '}
              <strong style={{ color: 'var(--text)', fontWeight: 600 }}>
                {settings.grid_cell_w_effective ?? settings.grid_cell_w}×
                {settings.grid_cell_h_effective ?? settings.grid_cell_h}
              </strong>
              px. Turn off to edit manual width and height below.
            </p>
          )}
        </div>

        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Grid cell width (px){gridAuto && ' — manual when off'}</label>
            <input
              type="number"
              min={32}
              max={1024}
              value={cellW}
              disabled={gridAuto}
              onChange={(e) => setCellW(e.target.value)}
              style={{ opacity: gridAuto ? 0.5 : 1 }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label>Grid cell height (px){gridAuto && ' — manual when off'}</label>
            <input
              type="number"
              min={32}
              max={1024}
              value={cellH}
              disabled={gridAuto}
              onChange={(e) => setCellH(e.target.value)}
              style={{ opacity: gridAuto ? 0.5 : 1 }}
            />
          </div>
        </div>

        <div
          className="row"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
        >
          <h3 style={{ margin: 0, fontSize: 13 }}>Annotation types</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: 11, margin: 0, lineHeight: 1.45 }}>
            Categories for pins and bubbles (gravestone, note, custom labels, etc.). IDs are fixed
            once you save this dialog — new rows get an ID from the label. You cannot remove a type
            while any annotation still uses it.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {draftAnnotationTypes.map((row, idx) => {
              const used = kindUsageCount.get(row.id) ?? 0;
              const removeBlocked = row.id !== '' && used > 0;
              return (
                <div
                  key={`${row.id || 'new'}-${idx}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(88px,1fr) 1fr 88px 72px',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--text-dim)',
                      fontFamily: 'ui-monospace, monospace',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={row.id ? row.id : 'Generated from label when you save the dialog'}
                  >
                    {row.id || '(new)'}
                  </span>
                  <input
                    value={row.label}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraftAnnotationTypes((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, label: v } : r)),
                      );
                    }}
                    placeholder="Label"
                  />
                  <input
                    type="color"
                    value={row.color.match(/^#[0-9a-fA-F]{6}$/) ? row.color : '#888888'}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraftAnnotationTypes((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, color: v } : r)),
                      );
                    }}
                    title="Color"
                    style={{ padding: 2, height: 32, cursor: 'pointer' }}
                  />
                  <button
                    type="button"
                    className="danger"
                    disabled={removeBlocked}
                    title={
                      removeBlocked
                        ? `${used} annotation(s) still use this type — reassign or delete them first`
                        : 'Remove type'
                    }
                    onClick={() => {
                      if (removeBlocked) {
                        showToast(
                          `Cannot remove this type: ${used} annotation(s) still use it.`,
                        );
                        return;
                      }
                      if (row.id) removeAnnotationTypeRow(row.id);
                      else
                        setDraftAnnotationTypes((prev) => prev.filter((_, i) => i !== idx));
                    }}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              onClick={() =>
                setDraftAnnotationTypes((prev) => [
                  ...prev,
                  { id: '', label: 'New type', color: '#94a3b8' },
                ])
              }
            >
              Add type
            </button>
          </div>
        </div>

        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>Backup &amp; restore</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: 11, margin: 0 }}>
            Download a ZIP of your database (<code style={{ fontSize: 10 }}>db.sqlite</code>) plus
            captures and composites, or restore from that ZIP. Same files you can zip manually from
            the data folder (<code style={{ fontSize: 10 }}>IIOSMAP_DATA_DIR</code>). Share the ZIP
            to copy a map between PCs.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" onClick={exportMapBackup}>
              Export backup (ZIP)
            </button>
            <button type="button" onClick={() => importBackupRef.current?.click()}>
              Import backup…
            </button>
          </div>
          <input
            ref={importBackupRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={onPickImportBackup}
          />
        </div>

        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>Annotation string motion</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: 11, margin: '0 0 10px' }}>
            Red strings between pins and bubbles can sway when you pan the map. Saved in this
            browser only; changes apply immediately (no Save needed).
          </p>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              marginBottom: 10,
            }}
          >
            <input
              type="checkbox"
              checked={yarnPanSwingEnabled}
              onChange={(e) => setYarnPanSwingEnabled(e.target.checked)}
            />
            <span>Sway when panning</span>
          </label>
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              opacity: yarnPanSwingEnabled ? 1 : 0.45,
              pointerEvents: yarnPanSwingEnabled ? 'auto' : 'none',
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              Strength — {yarnPanSwingStrength}%
              <span style={{ color: 'var(--text-dim)', marginLeft: 8 }}>
                (100% = default; up to 200% for stronger bounce)
              </span>
            </span>
            <input
              type="range"
              min={10}
              max={200}
              step={5}
              value={yarnPanSwingStrength}
              disabled={!yarnPanSwingEnabled}
              onChange={(e) => setYarnPanSwingStrength(Number(e.target.value))}
            />
          </label>
        </div>
        </div>

        <div className="actions">
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
