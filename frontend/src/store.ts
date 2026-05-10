import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { api } from './api';
import type {
  Annotation,
  AnnotationTypeDef,
  Capture,
  Composite,
  Layer,
  MapResponse,
  Screen,
  Settings,
} from './types';

type ServerState = {
  layers: Layer[];
  screens: Record<number, Screen>;
  annotations: Record<number, Annotation>;
  annotationTypes: AnnotationTypeDef[];
  captures: Record<number, Capture>;
  composites: Record<number, Composite>;
  settings: Settings;
};

type UIState = {
  selectedScreenId: number | null;
  activeLayerId: number | null;
  view: { tx: number; ty: number; scale: number };
  pendingTrayOpen: boolean;
  settingsOpen: boolean;
  cropToolForScreenId: number | null;
  cropToolForAnnotationId: number | null;
  compositePicker: { active: boolean; pickedScreenIds: number[] };
  compositeEditorForScreenIds: number[] | null;
  placingPinForAnnId: number | null;
  alwaysShowAnnotationBubbles: boolean;
  /** Kept visible like the selected tile (“pin” on map); survives changing selection. */
  annotationPinnedScreenIds: number[];
  /** Red annotation yarn: extra swing when panning the map (browser-only). */
  yarnPanSwingEnabled: boolean;
  /** 10–200, percent of built-in default pan kick; only used when enabled. */
  yarnPanSwingStrength: number;
  toast: string | null;
  /** Map-anchored annotation editor (popover). */
  mapAnnotationEditor: null | { annId: number; anchorX: number; anchorY: number };
};

type Actions = {
  bootstrap: () => Promise<void>;
  applyMap: (m: MapResponse) => void;
  // WS-driven
  upsertScreen: (s: Screen) => void;
  removeScreen: (id: number) => void;
  upsertCapture: (c: Capture) => void;
  upsertComposite: (c: Composite) => void;
  upsertAnnotation: (a: Annotation) => void;
  removeAnnotation: (id: number) => void;
  upsertLayer: (l: Layer) => void;
  removeLayer: (id: number) => void;
  setSettings: (s: Settings) => void;
  setAnnotationTypes: (t: AnnotationTypeDef[]) => void;

  // UI
  selectScreen: (id: number | null) => void;
  setActiveLayer: (id: number | null) => void;
  setView: (v: Partial<UIState['view']>) => void;
  togglePendingTray: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openCropTool: (screenId: number) => void;
  closeCropTool: () => void;
  openAnnotationCropTool: (annotationId: number) => void;
  closeAnnotationCropTool: () => void;
  beginCompositePicker: () => void;
  toggleCompositePick: (screenId: number) => void;
  cancelCompositePicker: () => void;
  openCompositeEditor: (ids: number[]) => void;
  closeCompositeEditor: () => void;
  setPlacingPinForAnn: (annId: number | null) => void;
  setAlwaysShowAnnotationBubbles: (v: boolean) => void;
  toggleAlwaysShowAnnotationBubbles: () => void;
  toggleAnnotationBubblePin: (screenId: number) => void;
  setYarnPanSwingEnabled: (v: boolean) => void;
  setYarnPanSwingStrength: (strengthPercent: number) => void;
  showToast: (msg: string | null) => void;
  openMapAnnotationEditor: (p: { annId: number; anchorX: number; anchorY: number }) => void;
  closeMapAnnotationEditor: () => void;
};

export type StoreState = ServerState & UIState & Actions;

function loadAnnotationBubblePins(): number[] {
  try {
    const raw = localStorage.getItem('ann-bubble-pinned-screens');
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is number => typeof x === 'number');
  } catch {
    return [];
  }
}

function persistAnnotationBubblePins(ids: number[]) {
  try {
    localStorage.setItem('ann-bubble-pinned-screens', JSON.stringify(ids));
  } catch {
    // ignore
  }
}

function loadYarnPanSwingEnabled(): boolean {
  try {
    const v = localStorage.getItem('yarn-pan-swing-enabled');
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

function loadYarnPanSwingStrength(): number {
  try {
    const raw = localStorage.getItem('yarn-pan-swing-strength');
    if (raw == null) return 100;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return 100;
    return Math.min(200, Math.max(10, n));
  } catch {
    return 100;
  }
}

function persistYarnPanSwing(enabled: boolean, strength: number) {
  try {
    localStorage.setItem('yarn-pan-swing-enabled', enabled ? '1' : '0');
    localStorage.setItem('yarn-pan-swing-strength', String(strength));
  } catch {
    // ignore
  }
}

export const useStore = create<StoreState>((set, get) => ({
  layers: [],
  screens: {},
  annotations: {},
  annotationTypes: [],
  captures: {},
  composites: {},
  settings: {
    hotkey: 'ctrl+alt+s',
    grid_cell_auto: '0',
    grid_cell_w: '256',
    grid_cell_h: '192',
    capture_target_title: 'La.MuLANA',
    capture_target_hwnd: '',
    grid_cell_w_effective: '256',
    grid_cell_h_effective: '192',
    display_top_crop_px: '80',
    display_bottom_crop_px: '0',
    display_left_crop_px: '0',
    display_right_crop_px: '0',
  },

  selectedScreenId: null,
  activeLayerId: null,
  view: { tx: 0, ty: 0, scale: 0.5 },
  pendingTrayOpen: true,
  settingsOpen: false,
  cropToolForScreenId: null,
  cropToolForAnnotationId: null,
  compositePicker: { active: false, pickedScreenIds: [] },
  compositeEditorForScreenIds: null,
  placingPinForAnnId: null,
  alwaysShowAnnotationBubbles: (() => {
    try {
      return localStorage.getItem('always-show-ann-bubbles') === '1';
    } catch {
      return false;
    }
  })(),
  yarnPanSwingEnabled: loadYarnPanSwingEnabled(),
  yarnPanSwingStrength: loadYarnPanSwingStrength(),
  annotationPinnedScreenIds: loadAnnotationBubblePins(),
  toast: null,
  mapAnnotationEditor: null,

  async bootstrap() {
    const map = await api.getMap();
    get().applyMap(map);
  },

  applyMap(m) {
    const screens: Record<number, Screen> = {};
    [...m.screens, ...m.pending].forEach((s) => (screens[s.id] = s));
    const annotations: Record<number, Annotation> = {};
    m.annotations.forEach((a) => (annotations[a.id] = a));
    const nextPins = get().annotationPinnedScreenIds.filter((id) => screens[id] != null);
    if (nextPins.length !== get().annotationPinnedScreenIds.length) {
      persistAnnotationBubblePins(nextPins);
    }
    set({
      layers: m.layers,
      screens,
      annotations,
      annotationTypes: m.annotation_types ?? [],
      captures: m.captures ?? {},
      composites: m.composites ?? {},
      settings: { ...get().settings, ...m.settings },
      activeLayerId: get().activeLayerId ?? (m.layers[0]?.id ?? null),
      annotationPinnedScreenIds: nextPins,
    });
  },

  upsertScreen(s) {
    set((state) => ({ screens: { ...state.screens, [s.id]: s } }));
  },
  removeScreen(id) {
    set((state) => {
      const next = { ...state.screens };
      delete next[id];
      const sel = state.selectedScreenId === id ? null : state.selectedScreenId;
      const pins = state.annotationPinnedScreenIds.filter((x) => x !== id);
      if (pins.length !== state.annotationPinnedScreenIds.length) {
        persistAnnotationBubblePins(pins);
      }
      const picker = {
        ...state.compositePicker,
        pickedScreenIds: state.compositePicker.pickedScreenIds.filter((x) => x !== id),
      };
      return {
        screens: next,
        selectedScreenId: sel,
        annotationPinnedScreenIds: pins,
        compositePicker: picker,
      };
    });
  },
  upsertCapture(c) {
    set((state) => ({ captures: { ...state.captures, [c.id]: c } }));
  },
  upsertComposite(c) {
    set((state) => ({ composites: { ...state.composites, [c.id]: c } }));
  },
  upsertAnnotation(a) {
    set((state) => ({ annotations: { ...state.annotations, [a.id]: a } }));
  },
  removeAnnotation(id) {
    set((state) => {
      const next = { ...state.annotations };
      delete next[id];
      const ed = state.mapAnnotationEditor;
      return {
        annotations: next,
        mapAnnotationEditor: ed?.annId === id ? null : ed,
      };
    });
  },
  upsertLayer(l) {
    set((state) => {
      const without = state.layers.filter((x) => x.id !== l.id);
      const layers = [...without, l].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return { layers };
    });
  },
  removeLayer(id) {
    set((state) => ({
      layers: state.layers.filter((l) => l.id !== id),
      activeLayerId: state.activeLayerId === id ? (state.layers.find((l) => l.id !== id)?.id ?? null) : state.activeLayerId,
    }));
  },
  setSettings(s) {
    set((state) => ({ settings: { ...state.settings, ...s } }));
  },
  setAnnotationTypes(t) {
    set({ annotationTypes: t });
  },

  selectScreen: (id) =>
    set((s) => {
      const ed = s.mapAnnotationEditor;
      if (ed == null) return { selectedScreenId: id };
      const a = s.annotations[ed.annId];
      if (!a) return { selectedScreenId: id, mapAnnotationEditor: null };
      if (id !== a.screen_id) return { selectedScreenId: id, mapAnnotationEditor: null };
      return { selectedScreenId: id };
    }),
  setActiveLayer: (id) => set({ activeLayerId: id }),
  setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
  togglePendingTray: () => set((s) => ({ pendingTrayOpen: !s.pendingTrayOpen })),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openCropTool: (id) => set({ cropToolForScreenId: id }),
  closeCropTool: () => set({ cropToolForScreenId: null }),
  openAnnotationCropTool: (id) => set({ cropToolForAnnotationId: id }),
  closeAnnotationCropTool: () => set({ cropToolForAnnotationId: null }),
  beginCompositePicker: () => set({ compositePicker: { active: true, pickedScreenIds: [] } }),
  toggleCompositePick: (id) =>
    set((s) => {
      const has = s.compositePicker.pickedScreenIds.includes(id);
      const ids = has
        ? s.compositePicker.pickedScreenIds.filter((x) => x !== id)
        : [...s.compositePicker.pickedScreenIds, id];
      return { compositePicker: { active: true, pickedScreenIds: ids } };
    }),
  cancelCompositePicker: () => set({ compositePicker: { active: false, pickedScreenIds: [] } }),
  openCompositeEditor: (ids) => set({ compositeEditorForScreenIds: ids, compositePicker: { active: false, pickedScreenIds: [] } }),
  closeCompositeEditor: () => set({ compositeEditorForScreenIds: null }),
  setPlacingPinForAnn: (annId) => set({ placingPinForAnnId: annId }),
  setAlwaysShowAnnotationBubbles: (v) => {
    try {
      localStorage.setItem('always-show-ann-bubbles', v ? '1' : '0');
    } catch {
      // ignore (private mode, quota, etc.)
    }
    set({ alwaysShowAnnotationBubbles: v });
  },
  toggleAlwaysShowAnnotationBubbles: () => {
    const next = !get().alwaysShowAnnotationBubbles;
    try {
      localStorage.setItem('always-show-ann-bubbles', next ? '1' : '0');
    } catch {
      // ignore (private mode, quota, etc.)
    }
    set({ alwaysShowAnnotationBubbles: next });
  },
  toggleAnnotationBubblePin: (screenId) =>
    set((s) => {
      const has = s.annotationPinnedScreenIds.includes(screenId);
      const next = has
        ? s.annotationPinnedScreenIds.filter((id) => id !== screenId)
        : [...s.annotationPinnedScreenIds, screenId];
      persistAnnotationBubblePins(next);
      return { annotationPinnedScreenIds: next };
    }),
  setYarnPanSwingEnabled: (v) => {
    const strength = get().yarnPanSwingStrength;
    persistYarnPanSwing(v, strength);
    set({ yarnPanSwingEnabled: v });
  },
  setYarnPanSwingStrength: (strengthPercent) => {
    const strength = Math.min(200, Math.max(10, Math.round(strengthPercent)));
    persistYarnPanSwing(get().yarnPanSwingEnabled, strength);
    set({ yarnPanSwingStrength: strength });
  },
  showToast: (msg) => {
    set({ toast: msg });
    if (msg) {
      window.setTimeout(() => {
        if (get().toast === msg) set({ toast: null });
      }, 3000);
    }
  },
  openMapAnnotationEditor: ({ annId, anchorX, anchorY }) =>
    set((s) => {
      const a = s.annotations[annId];
      if (!a) return {};
      return {
        selectedScreenId: a.screen_id,
        mapAnnotationEditor: { annId, anchorX, anchorY },
      };
    }),
  closeMapAnnotationEditor: () => set({ mapAnnotationEditor: null }),
}));

export const useScreensList = () =>
  useStore(useShallow((s) => Object.values(s.screens)));

export const usePlacedScreens = () =>
  useStore(
    useShallow((s) =>
      Object.values(s.screens).filter(
        (sc) => sc.layer_id != null && sc.grid_x != null && sc.grid_y != null,
      ),
    ),
  );

export const usePendingScreens = () =>
  useStore(
    useShallow((s) => Object.values(s.screens).filter((sc) => sc.layer_id == null)),
  );

export function settingsGridAuto(s: Settings): boolean {
  const v = String(s.grid_cell_auto ?? '1').toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(v);
}

export const useCellSize = () =>
  useStore(
    useShallow((s) => {
      const auto = settingsGridAuto(s.settings);
      const ew = parseInt(s.settings.grid_cell_w_effective ?? s.settings.grid_cell_w, 10) || 256;
      const eh = parseInt(s.settings.grid_cell_h_effective ?? s.settings.grid_cell_h, 10) || 192;
      const mw = parseInt(s.settings.grid_cell_w, 10) || 256;
      const mh = parseInt(s.settings.grid_cell_h, 10) || 192;
      return auto ? { w: ew, h: eh } : { w: mw, h: mh };
    }),
  );

const intOr = (v: string | undefined, fallback: number): number => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export type DisplayCrops = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const useDisplayCrops = (): DisplayCrops =>
  useStore(
    useShallow((s) => ({
      top: intOr(s.settings.display_top_crop_px, 0),
      right: intOr(s.settings.display_right_crop_px, 0),
      bottom: intOr(s.settings.display_bottom_crop_px, 0),
      left: intOr(s.settings.display_left_crop_px, 0),
    })),
  );
