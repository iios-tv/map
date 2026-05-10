import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';

export type CaptureWindowRow = {
  hwnd: string;
  title: string;
  client_w: number;
  client_h: number;
};

export function CaptureTargetModal({ onClose }: { onClose: () => void }) {
  const setSettings = useStore((s) => s.setSettings);
  const showToast = useStore((s) => s.showToast);
  const curTitle = useStore((s) => s.settings.capture_target_title ?? '');
  const curHwnd = useStore((s) => s.settings.capture_target_hwnd ?? '');

  const [windows, setWindows] = useState<CaptureWindowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selHwnd, setSelHwnd] = useState<string>('');

  async function load() {
    setLoading(true);
    try {
      const list = await api.listCaptureWindows();
      setWindows(list);
      if (list.length === 0) {
        setSelHwnd('');
      } else if (curHwnd && list.some((w) => w.hwnd === curHwnd)) {
        setSelHwnd(curHwnd);
      } else {
        const byTitle = list.find((w) => w.title === curTitle);
        setSelHwnd((byTitle ?? list[0]).hwnd);
      }
    } catch (e: unknown) {
      showToast(`Failed to list windows: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function apply() {
    const row = windows.find((w) => w.hwnd === selHwnd);
    if (!row) {
      showToast('Pick a window');
      return;
    }
    try {
      const updated = await api.patchSettings({
        capture_target_title: row.title,
        capture_target_hwnd: row.hwnd,
      });
      setSettings(updated);
      showToast('Capture target updated');
      onClose();
    } catch (e: unknown) {
      showToast(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ minWidth: 420, maxWidth: 560 }}>
        <h2>Capture target</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 0 }}>
          Choose which window to grab when you use Capture or the global hotkey.
        </p>

        {loading ? (
          <p style={{ color: 'var(--text-dim)' }}>Loading window list…</p>
        ) : windows.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>No capturable windows found (Windows only).</p>
        ) : (
          <>
            <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Window</label>
            <select
              value={selHwnd}
              onChange={(e) => setSelHwnd(e.target.value)}
              style={{ width: '100%', marginBottom: 12, marginTop: 4 }}
              size={Math.min(12, Math.max(4, windows.length))}
            >
              {windows.map((w) => (
                <option key={w.hwnd} value={w.hwnd}>
                  {w.title} — {w.client_w}×{w.client_h}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => load()} style={{ marginBottom: 12 }}>
              Refresh list
            </button>
          </>
        )}

        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={apply} disabled={loading || windows.length === 0}>
            Use selected window
          </button>
        </div>
      </div>
    </div>
  );
}
