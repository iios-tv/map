import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { loadLastAnnotationKind, persistLastAnnotationKind } from '../lastAnnotationKind';
import type { Annotation, Screen } from '../types';
import { AnnotationEditorForm } from './AnnotationEditorForm';

const COLLAPSE_PREFIX = 'detail-collapsed:';

function CollapsibleSection({
  storageKey,
  title,
  rightAdornment,
  defaultCollapsed = false,
  children,
}: {
  storageKey: string;
  title: ReactNode;
  rightAdornment?: ReactNode;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(COLLAPSE_PREFIX + storageKey);
      if (v == null) return defaultCollapsed;
      return v === '1';
    } catch {
      return defaultCollapsed;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_PREFIX + storageKey, collapsed ? '1' : '0');
    } catch {
      // ignore storage failures (private mode, quota, etc.)
    }
  }, [storageKey, collapsed]);

  return (
    <div className={`section${collapsed ? ' collapsed' : ''}`}>
      <h3
        className="section-header"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
      >
        <span className="chevron" aria-hidden>{collapsed ? '▸' : '▾'}</span>
        <span className="section-title">{title}</span>
        {rightAdornment != null && <span className="section-adornment">{rightAdornment}</span>}
      </h3>
      {!collapsed && <div className="section-body">{children}</div>}
    </div>
  );
}

export function DetailPanel() {
  const selectedId = useStore((s) => s.selectedScreenId);
  const screens = useStore((s) => s.screens);
  const layers = useStore((s) => s.layers);
  const annotations = useStore((s) => s.annotations);
  const upsertAnnotation = useStore((s) => s.upsertAnnotation);
  const removeAnnotation = useStore((s) => s.removeAnnotation);
  const upsertScreen = useStore((s) => s.upsertScreen);
  const removeScreen = useStore((s) => s.removeScreen);
  const openCropTool = useStore((s) => s.openCropTool);
  const beginCompositePicker = useStore((s) => s.beginCompositePicker);
  const showToast = useStore((s) => s.showToast);
  const placingPinForAnnId = useStore((s) => s.placingPinForAnnId);
  const setPlacingPinForAnn = useStore((s) => s.setPlacingPinForAnn);
  const activeLayerId = useStore((s) => s.activeLayerId);

  if (selectedId == null) {
    return (
      <div className="detail">
        <CollapsibleSection storageKey="selection" title="Selection">
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            Click a screen on the map or in the pending tray to view and edit its details.
          </p>
        </CollapsibleSection>
        <CollapsibleSection storageKey="shortcuts" title="Map shortcuts">
          <ul style={{ color: 'var(--text-dim)', fontSize: 12, paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
            <li>Mouse wheel: zoom around cursor</li>
            <li>Middle-drag or Space+drag: pan</li>
            <li>Drag a placed tile: move on grid</li>
            <li>Drag a pending thumbnail onto map: place</li>
          </ul>
        </CollapsibleSection>
      </div>
    );
  }

  const screen = screens[selectedId];
  if (!screen) return null;

  const screenAnns = Object.values(annotations).filter((a) => a.screen_id === selectedId);

  return (
    <div className="detail">
      <ScreenSection
        screen={screen}
        layers={layers}
        upsertScreen={upsertScreen}
        removeScreen={removeScreen}
        showToast={showToast}
        activeLayerId={activeLayerId}
      />
      <CollapsibleSection storageKey="editing" title="Editing">
        <div className="row">
          <button onClick={() => openCropTool(screen.id)}>Crop / sub-region…</button>
          <button onClick={() => beginCompositePicker()}>Combine with…</button>
        </div>
      </CollapsibleSection>
      <AnnotationsSection
        screenId={selectedId}
        anns={screenAnns}
        upsertAnnotation={upsertAnnotation}
        removeAnnotation={removeAnnotation}
        showToast={showToast}
        placingPinForAnnId={placingPinForAnnId}
        setPlacingPinForAnn={setPlacingPinForAnn}
      />
    </div>
  );
}

function ScreenSection({
  screen,
  layers,
  upsertScreen,
  removeScreen,
  showToast,
  activeLayerId,
}: {
  screen: Screen;
  layers: { id: number; name: string; color: string }[];
  upsertScreen: (s: Screen) => void;
  removeScreen: (id: number) => void;
  showToast: (m: string) => void;
  activeLayerId: number | null;
}) {
  const [label, setLabel] = useState(screen.label ?? '');
  const [gw, setGw] = useState(String(screen.grid_w));
  const [gh, setGh] = useState(String(screen.grid_h));
  const [labelDirty, setLabelDirty] = useState(false);

  useEffect(() => {
    if (!labelDirty) setLabel(screen.label ?? '');
  }, [screen.label, labelDirty]);
  useEffect(() => { setGw(String(screen.grid_w)); }, [screen.grid_w]);
  useEffect(() => { setGh(String(screen.grid_h)); }, [screen.grid_h]);

  async function save(fields: Partial<Screen> & { clear_layer?: boolean }) {
    try {
      const updated = await api.patchScreen(screen.id, fields);
      upsertScreen(updated);
      if ('label' in fields) setLabelDirty(false);
    } catch (e: any) {
      showToast(`Save failed: ${e.message ?? e}`);
    }
  }

  async function deleteThis() {
    if (!confirm('Delete this screen? The image file remains on disk.')) return;
    try {
      await api.deleteScreen(screen.id);
      removeScreen(screen.id);
    } catch (e: any) {
      showToast(`Delete failed: ${e.message ?? e}`);
    }
  }

  const layer = layers.find((l) => l.id === screen.layer_id);
  const remoteLabel = screen.label ?? '';
  const labelDiverged = labelDirty && remoteLabel !== label;

  return (
    <CollapsibleSection
      storageKey="screen"
      title={`Screen #${screen.id}`}
      rightAdornment={labelDiverged ? <span className="dirty-dot" title="remote changed" /> : null}
    >
      <label>Label</label>
      <div className="row">
        <input
          value={label}
          onChange={(e) => { setLabel(e.target.value); setLabelDirty(true); }}
          onBlur={() => { if (label !== remoteLabel) save({ label }); }}
          placeholder="e.g., Surface starting screen"
        />
      </div>
      <label>Layer</label>
      <div className="row">
        <select
          value={screen.layer_id ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') save({ clear_layer: true } as any);
            else save({ layer_id: Number(v) });
          }}
        >
          <option value="">(pending)</option>
          {layers.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        {screen.layer_id == null && activeLayerId != null && (
          <button onClick={() => save({ layer_id: activeLayerId, grid_x: 0, grid_y: 0 })}>
            Place at origin
          </button>
        )}
      </div>
      <label>Grid position</label>
      <div className="row">
        <input
          type="number"
          value={screen.grid_x ?? ''}
          onChange={(e) => save({ grid_x: e.target.value === '' ? null : Number(e.target.value) } as any)}
          placeholder="x"
        />
        <input
          type="number"
          value={screen.grid_y ?? ''}
          onChange={(e) => save({ grid_y: e.target.value === '' ? null : Number(e.target.value) } as any)}
          placeholder="y"
        />
      </div>
      <label>Grid size (cells)</label>
      <div className="row">
        <input
          type="number" min={1} max={16}
          value={gw}
          onChange={(e) => setGw(e.target.value)}
          onBlur={() => save({ grid_w: Math.max(1, Number(gw) || 1) })}
        />
        <input
          type="number" min={1} max={16}
          value={gh}
          onChange={(e) => setGh(e.target.value)}
          onBlur={() => save({ grid_h: Math.max(1, Number(gh) || 1) })}
        />
      </div>
      {layer && (
        <div className="row">
          <span className="layer-pill">
            <span className="swatch" style={{ background: layer.color }} />
            {layer.name}
          </span>
          <span style={{ flex: 1 }} />
          <button className="danger" onClick={deleteThis}>Delete</button>
        </div>
      )}
    </CollapsibleSection>
  );
}

function AnnotationsSection({
  screenId,
  anns,
  upsertAnnotation,
  removeAnnotation,
  showToast,
  placingPinForAnnId,
  setPlacingPinForAnn,
}: {
  screenId: number;
  anns: Annotation[];
  upsertAnnotation: (a: Annotation) => void;
  removeAnnotation: (id: number) => void;
  showToast: (m: string) => void;
  placingPinForAnnId: number | null;
  setPlacingPinForAnn: (id: number | null) => void;
}) {
  const annotationTypes = useStore((s) => s.annotationTypes);
  const addKindChoices = annotationTypes.filter((t) => !t.synthetic);
  const addIds = addKindChoices.map((t) => t.id);

  const [newKind, setNewKind] = useState('note');

  useEffect(() => {
    if (addIds.length === 0) return;
    setNewKind((prev) => (addIds.includes(prev) ? prev : loadLastAnnotationKind(addIds)));
  }, [annotationTypes]);

  async function add() {
    const ids = annotationTypes.filter((t) => !t.synthetic).map((t) => t.id);
    const kind = ids.includes(newKind) ? newKind : ids[0];
    if (kind == null) {
      showToast('Add an annotation type in Settings first.');
      return;
    }
    try {
      const a = await api.createAnnotation(screenId, {
        kind,
        text: '',
        x_norm: 0.5,
        y_norm: 0.5,
        tags: [],
      });
      upsertAnnotation(a);
      persistLastAnnotationKind(kind);
    } catch (e: any) {
      showToast(`Add annotation failed: ${e.message ?? e}`);
    }
  }

  return (
    <CollapsibleSection
      storageKey="annotations"
      title="Annotations"
      rightAdornment={anns.length > 0 ? <span className="section-count">{anns.length}</span> : null}
    >
      <div className="row">
        <select
          value={newKind}
          onChange={(e) => setNewKind(e.target.value)}
          disabled={addKindChoices.length === 0}
        >
          {addKindChoices.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <button onClick={add} disabled={addKindChoices.length === 0}>
          Add
        </button>
      </div>
      {anns.length === 0 && (
        <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>No annotations yet.</p>
      )}
      {anns.map((a) => (
        <AnnotationRow
          key={a.id}
          ann={a}
          upsertAnnotation={upsertAnnotation}
          removeAnnotation={removeAnnotation}
          showToast={showToast}
          placing={placingPinForAnnId === a.id}
          setPlacingPin={setPlacingPinForAnn}
        />
      ))}
    </CollapsibleSection>
  );
}

function AnnotationRow({
  ann,
  upsertAnnotation,
  removeAnnotation,
  showToast,
  placing,
  setPlacingPin,
}: {
  ann: Annotation;
  upsertAnnotation: (a: Annotation) => void;
  removeAnnotation: (id: number) => void;
  showToast: (m: string) => void;
  placing: boolean;
  setPlacingPin: (id: number | null) => void;
}) {
  return (
    <div className="ann-row">
      <AnnotationEditorForm
        ann={ann}
        upsertAnnotation={upsertAnnotation}
        removeAnnotation={removeAnnotation}
        showToast={showToast}
        placing={placing}
        setPlacingPin={setPlacingPin}
      />
    </div>
  );
}
