import { useEffect, useState } from 'react';
import { useStore } from './store';
import { connectWS } from './ws';
import { MapCanvas } from './components/MapCanvas';
import { DetailPanel } from './components/DetailPanel';
import { PendingTray } from './components/PendingTray';
import { LayerPicker } from './components/LayerPicker';
import { AnnotationCropTool, CropTool } from './components/CropTool';
import { AnnotationMapEditor } from './components/AnnotationMapEditor';
import { CompositeEditor } from './components/CompositeEditor';
import { SettingsModal } from './components/SettingsModal';
import { CaptureTargetModal } from './components/CaptureTargetModal';

export default function App() {
  const bootstrap = useStore((s) => s.bootstrap);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const cropFor = useStore((s) => s.cropToolForScreenId);
  const cropForAnn = useStore((s) => s.cropToolForAnnotationId);
  const compositeIds = useStore((s) => s.compositeEditorForScreenIds);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const openSettings = useStore((s) => s.openSettings);
  const togglePendingTray = useStore((s) => s.togglePendingTray);
  const trayOpen = useStore((s) => s.pendingTrayOpen);
  const compositePicker = useStore((s) => s.compositePicker);
  const beginCompositePicker = useStore((s) => s.beginCompositePicker);
  const cancelCompositePicker = useStore((s) => s.cancelCompositePicker);
  const openCompositeEditor = useStore((s) => s.openCompositeEditor);
  const showToast = useStore((s) => s.showToast);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);

  const targetLabel =
    settings.capture_target_title?.trim() || '—';

  useEffect(() => {
    document.title = `iiosMap - ${targetLabel}`;
  }, [targetLabel]);

  useEffect(() => {
    bootstrap().catch((e) => showToast(`Failed to load: ${e.message}`));
    connectWS();
  }, [bootstrap, showToast]);

  return (
    <div className={`app ${trayOpen ? '' : 'no-tray'}`}>
      <div className="topbar">
        <div className="title">iiosMap - {targetLabel}</div>
        <LayerPicker />
        <span style={{ fontSize: 12, color: 'var(--text-dim)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={settings.capture_target_title}>
          Target: {settings.capture_target_title ?? '—'}
        </span>
        <button type="button" onClick={() => setTargetPickerOpen(true)}>
          Change…
        </button>
        {!compositePicker.active ? (
          <button onClick={beginCompositePicker}>Combine rooms…</button>
        ) : (
          <>
            <span style={{ color: 'var(--accent-2)' }}>
              Pick screens to combine ({compositePicker.pickedScreenIds.length} selected)
            </span>
            <button
              disabled={compositePicker.pickedScreenIds.length < 2}
              onClick={() => openCompositeEditor(compositePicker.pickedScreenIds)}
            >
              Open editor
            </button>
            <button onClick={cancelCompositePicker}>Cancel</button>
          </>
        )}
        <div className="spacer" />
        {toast && <div className="toast">{toast}</div>}
        <span className="hotkey-hint">Hotkey: {settings.hotkey}</span>
        <button onClick={togglePendingTray}>{trayOpen ? 'Hide tray' : 'Show tray'}</button>
        <button onClick={openSettings}>Settings</button>
      </div>

      <MapCanvas />
      <DetailPanel />
      <PendingTray />

      {cropFor != null && <CropTool screenId={cropFor} />}
      {cropForAnn != null && <AnnotationCropTool annotationId={cropForAnn} />}
      <AnnotationMapEditor />
      {compositeIds && compositeIds.length >= 2 && (
        <CompositeEditor screenIds={compositeIds} />
      )}
      {settingsOpen && <SettingsModal />}
      {targetPickerOpen && <CaptureTargetModal onClose={() => setTargetPickerOpen(false)} />}
    </div>
  );
}
