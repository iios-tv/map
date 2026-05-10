import { useStore, usePendingScreens } from '../store';
import { api, imageUrlForScreen } from '../api';

function PlusCaptureIcon() {
  return (
    <svg className="tray-capture-add-icon" viewBox="0 0 24 24" width="52" height="52" aria-hidden>
      <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="tray-thumb-dismiss-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path
        fill="currentColor"
        d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
      />
    </svg>
  );
}

export function PendingTray() {
  const open = useStore((s) => s.pendingTrayOpen);
  const togglePendingTray = useStore((s) => s.togglePendingTray);
  const pending = usePendingScreens();
  const captures = useStore((s) => s.captures);
  const composites = useStore((s) => s.composites);
  const selectScreen = useStore((s) => s.selectScreen);
  const selectedId = useStore((s) => s.selectedScreenId);
  const removeScreen = useStore((s) => s.removeScreen);
  const showToast = useStore((s) => s.showToast);

  async function deletePending(id: number) {
    if (!confirm('Delete this screen? The image file remains on disk.')) return;
    try {
      await api.deleteScreen(id);
      removeScreen(id);
    } catch (e: any) {
      showToast(`Delete failed: ${e.message ?? e}`);
    }
  }

  async function captureNow() {
    try {
      await api.captureNow();
    } catch (e: any) {
      showToast(e.message ?? 'capture failed');
    }
  }

  return (
    <div className={`tray ${open ? '' : 'collapsed'}`}>
      <div className="header">
        <strong>Pending captures ({pending.length})</strong>
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          drag onto map to place
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={togglePendingTray}>{open ? 'Collapse' : 'Expand'}</button>
      </div>
      {open && (
        <div className="body">
          {pending.length === 0 && (
            <div style={{ color: 'var(--text-dim)', alignSelf: 'center', padding: 16 }}>
              No pending captures. Click + or use the hotkey while La.MuLANA is open.
            </div>
          )}
          {pending.map((s) => {
            const url = imageUrlForScreen(s, captures, composites);
            return (
              <div
                key={s.id}
                className={`thumb${selectedId === s.id ? ' selected' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-iiosmap-screen', String(s.id));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => selectScreen(s.id)}
                style={selectedId === s.id ? { outline: '2px solid var(--accent)' } : undefined}
                title={s.label ?? `screen #${s.id}`}
              >
                <button
                  type="button"
                  className="tray-thumb-dismiss"
                  title="Remove pending capture"
                  aria-label="Remove pending capture"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deletePending(s.id);
                  }}
                >
                  <CloseIcon />
                </button>
                {url ? <img src={url} alt="" /> : <div style={{ padding: 8, color: '#888' }}>(no image)</div>}
                <div className="meta">
                  #{s.id} · {new Date(s.created_at).toLocaleTimeString()}
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className="thumb tray-capture-add"
            onClick={() => void captureNow()}
            title="Capture now"
            aria-label="Capture now"
          >
            <PlusCaptureIcon />
            <span className="tray-capture-add-label">Capture</span>
          </button>
        </div>
      )}
    </div>
  );
}
