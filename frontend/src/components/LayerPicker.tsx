import { useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';

export function LayerPicker() {
  const layers = useStore((s) => s.layers);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const setActiveLayer = useStore((s) => s.setActiveLayer);
  const upsertLayer = useStore((s) => s.upsertLayer);
  const removeLayer = useStore((s) => s.removeLayer);
  const showToast = useStore((s) => s.showToast);
  const [editing, setEditing] = useState(false);

  const active = layers.find((l) => l.id === activeLayerId) ?? null;

  async function addLayer() {
    const name = prompt('New layer name (e.g., "Mausoleum")');
    if (!name) return;
    try {
      const layer = await api.createLayer({ name, sort_order: layers.length });
      upsertLayer(layer);
      setActiveLayer(layer.id);
    } catch (e: any) {
      showToast(`Add layer failed: ${e.message ?? e}`);
    }
  }

  async function renameLayer() {
    if (!active) return;
    const name = prompt('Rename layer', active.name);
    if (!name || name === active.name) return;
    try {
      const layer = await api.patchLayer(active.id, { name });
      upsertLayer(layer);
    } catch (e: any) {
      showToast(`Rename failed: ${e.message ?? e}`);
    }
  }

  async function recolorLayer(color: string) {
    if (!active) return;
    try {
      const layer = await api.patchLayer(active.id, { color });
      upsertLayer(layer);
    } catch (e: any) {
      showToast(`Recolor failed: ${e.message ?? e}`);
    }
  }

  async function deleteLayer() {
    if (!active) return;
    if (!confirm(`Delete layer "${active.name}"? Screens become pending.`)) return;
    try {
      await api.deleteLayer(active.id);
      removeLayer(active.id);
    } catch (e: any) {
      showToast(`Delete failed: ${e.message ?? e}`);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="layer-pill" title="Active layer">
        <span className="swatch" style={{ background: active?.color ?? '#888' }} />
        <select
          value={activeLayerId ?? ''}
          onChange={(e) => setActiveLayer(e.target.value ? Number(e.target.value) : null)}
          style={{ background: 'transparent', border: 'none', color: 'inherit' }}
        >
          {layers.length === 0 && <option value="">(no layers)</option>}
          {layers.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </span>
      <button onClick={addLayer} title="Add layer">+</button>
      <button onClick={() => setEditing((v) => !v)} title="Edit layer">✎</button>
      {editing && active && (
        <>
          <button onClick={renameLayer}>Rename</button>
          <input
            type="color"
            value={active.color}
            onChange={(e) => recolorLayer(e.target.value)}
            style={{ width: 32, height: 28, padding: 0 }}
          />
          <button className="danger" onClick={deleteLayer}>Delete</button>
        </>
      )}
    </div>
  );
}
