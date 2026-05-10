export type Layer = {
  id: number;
  name: string;
  color: string;
  sort_order: number;
};

export type Capture = {
  id: number;
  filename: string;
  captured_at: string;
  width: number;
  height: number;
};

export type Composite = {
  id: number;
  filename: string;
  width: number;
  height: number;
  source_screen_ids: number[];
  alignment: { screen_id: number; dx: number; dy: number }[];
  created_at: string;
};

export type CropBox = { x: number; y: number; w: number; h: number };

export type Screen = {
  id: number;
  capture_id: number | null;
  composite_id: number | null;
  layer_id: number | null;
  grid_x: number | null;
  grid_y: number | null;
  grid_w: number;
  grid_h: number;
  crop_box: CropBox | null;
  label: string | null;
  created_at: string;
};

export type Annotation = {
  id: number;
  screen_id: number;
  kind: string;
  text: string;
  x_norm: number;
  y_norm: number;
  tags: string[];
  capture_id: number | null;
  capture_crop: CropBox | null;
  /** Map/world-space pixel offset of the bubble from the pin (persists across pan/zoom). */
  bubble_offset_x: number;
  bubble_offset_y: number;
  updated_at: string;
};

export type Settings = {
  hotkey: string;
  /** "1" when layout cell size follows the capture target client area. */
  grid_cell_auto: string;
  grid_cell_w: string;
  grid_cell_h: string;
  /** Server-computed; prefer for canvas when grid_cell_auto is on. */
  grid_cell_w_effective?: string;
  grid_cell_h_effective?: string;
  grid_cell_w_manual?: string;
  grid_cell_h_manual?: string;
  capture_target_title: string;
  /** Pin to a specific top-level window (stringified HWND). Empty = title match only. */
  capture_target_hwnd: string;
  display_top_crop_px: string;
  display_bottom_crop_px: string;
  display_left_crop_px: string;
  display_right_crop_px: string;
  [k: string]: string | undefined;
};

/** User-defined annotation category (persisted server-side; `id` is stored on each annotation as `kind`). */
export type AnnotationTypeDef = {
  id: string;
  label: string;
  color: string;
  /** Present when this row was auto-added for an orphan `kind` not in settings. */
  synthetic?: boolean;
};

export type MapResponse = {
  layers: Layer[];
  screens: Screen[];
  pending: Screen[];
  annotations: Annotation[];
  annotation_types: AnnotationTypeDef[];
  settings: Settings;
  captures: Record<number, Capture>;
  composites: Record<number, Composite>;
};

export type Direction = 'N' | 'S' | 'E' | 'W';

/** @deprecated Alias for string annotation category id. */
export type AnnotationKind = string;

export const DEFAULT_ANNOTATION_KIND_COLOR = '#9aa3af';

/** Built-in palette used only when migrating legacy databases or as UI reference. */
export const LEGACY_ANNOTATION_KINDS: AnnotationTypeDef[] = [
  { id: 'gravestone', label: 'Gravestone', color: '#bdb39e' },
  { id: 'skeleton', label: 'Skeleton', color: '#e6e6e6' },
  { id: 'visual_hint', label: 'Visual hint', color: '#ffd166' },
  { id: 'quest_gate', label: 'Quest gate', color: '#ef476f' },
  { id: 'note', label: 'Note', color: '#06d6a0' },
];

export function colorForAnnotationKind(types: AnnotationTypeDef[], kind: string): string {
  const row = types.find((t) => t.id === kind);
  return row?.color ?? DEFAULT_ANNOTATION_KIND_COLOR;
}

export function labelForAnnotationKind(types: AnnotationTypeDef[], kind: string): string {
  const row = types.find((t) => t.id === kind);
  return row?.label ?? (kind.replace(/_/g, ' ') || kind);
}

export function annotationKindsForSelect(
  types: AnnotationTypeDef[],
  currentKind: string,
): AnnotationTypeDef[] {
  const byId = new Map(types.map((t) => [t.id, t] as const));
  if (!byId.has(currentKind)) {
    byId.set(currentKind, {
      id: currentKind,
      label: labelForAnnotationKind([], currentKind),
      color: DEFAULT_ANNOTATION_KIND_COLOR,
    });
  }
  return Array.from(byId.values());
}
