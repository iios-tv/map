import type {
  Annotation,
  AnnotationKind,
  AnnotationTypeDef,
  Capture,
  Composite,
  CropBox,
  Layer,
  MapResponse,
  Screen,
  Settings,
} from './types';

const BASE = '/api';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${path}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  getMap(layerId?: number) {
    const qs = layerId != null ? `?layer=${layerId}` : '';
    return http<MapResponse>(`/map${qs}`);
  },
  getPending() {
    return http<Screen[]>(`/pending`);
  },
  captureNow() {
    return http<{ capture: any; screen: Screen }>(`/captures/now`, { method: 'POST' });
  },
  patchScreen(id: number, body: Partial<Screen> & { clear_layer?: boolean; clear_crop_box?: boolean }) {
    return http<Screen>(`/screens/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  deleteScreen(id: number) {
    return http<void>(`/screens/${id}`, { method: 'DELETE' });
  },
  listAnnotations(screenId: number) {
    return http<Annotation[]>(`/screens/${screenId}/annotations`);
  },
  createAnnotation(
    screenId: number,
    body: Omit<
      Annotation,
      | 'id'
      | 'screen_id'
      | 'updated_at'
      | 'capture_id'
      | 'capture_crop'
      | 'bubble_offset_x'
      | 'bubble_offset_y'
    > &
      Partial<
        Pick<
          Annotation,
          'capture_id' | 'capture_crop' | 'bubble_offset_x' | 'bubble_offset_y'
        >
      >,
  ) {
    return http<Annotation>(`/screens/${screenId}/annotations`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  patchAnnotation(
    screenId: number,
    annId: number,
    body: Partial<Omit<Annotation, 'id' | 'screen_id' | 'updated_at'>> & {
      clear_capture?: boolean;
      clear_capture_crop?: boolean;
      clear_bubble_offset?: boolean;
    },
  ) {
    return http<Annotation>(`/screens/${screenId}/annotations/${annId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  deleteAnnotation(screenId: number, annId: number) {
    return http<void>(`/screens/${screenId}/annotations/${annId}`, { method: 'DELETE' });
  },
  captureForAnnotation(screenId: number, annId: number) {
    return http<{ capture: Capture; annotation: Annotation }>(
      `/screens/${screenId}/annotations/${annId}/capture`,
      { method: 'POST' },
    );
  },
  listLayers() {
    return http<Layer[]>(`/layers`);
  },
  createLayer(body: { name: string; color?: string; sort_order?: number }) {
    return http<Layer>(`/layers`, { method: 'POST', body: JSON.stringify(body) });
  },
  patchLayer(id: number, body: Partial<Layer>) {
    return http<Layer>(`/layers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  deleteLayer(id: number) {
    return http<void>(`/layers/${id}`, { method: 'DELETE' });
  },
  createComposite(body: {
    source_screen_ids: number[];
    alignment: { screen_id: number; dx: number; dy: number }[];
    layer_id?: number | null;
    grid_x?: number | null;
    grid_y?: number | null;
    grid_w?: number;
    grid_h?: number;
    label?: string | null;
    delete_sources?: boolean;
  }) {
    return http<{ composite: Composite; screen: Screen }>(`/composites`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  getSettings() {
    return http<Settings>(`/settings`);
  },
  patchSettings(body: Partial<Record<string, string | number | boolean>>) {
    return http<Settings>(`/settings`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  putAnnotationTypes(types: AnnotationTypeDef[]) {
    return http<AnnotationTypeDef[]>(`/annotation-types`, {
      method: 'PUT',
      body: JSON.stringify({ types }),
    });
  },
  listCaptureWindows() {
    return http<{ hwnd: string; title: string; client_w: number; client_h: number }[]>(
      `/windows`,
    );
  },
  async downloadBackupZip() {
    const res = await fetch(`${BASE}/backup/export`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Backup export failed: HTTP ${res.status}: ${text}`);
    }
    return res.blob();
  },
  async importBackupZip(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/backup/import`, { method: 'POST', body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Backup import failed: HTTP ${res.status}: ${text}`);
    }
    return res.json() as Promise<{
      ok: boolean;
      manifest_valid?: boolean;
      images_restored?: number;
      composites_restored?: number;
    }>;
  },
};

export function imageUrlForScreen(screen: Screen, captures: Record<number, { filename: string }>, composites: Record<number, { filename: string }>) {
  if (screen.composite_id != null && composites[screen.composite_id]) {
    return `/composites/${composites[screen.composite_id].filename}`;
  }
  if (screen.capture_id != null && captures[screen.capture_id]) {
    return `/images/${captures[screen.capture_id].filename}`;
  }
  return undefined;
}

export function imageUrlForAnnotation(
  ann: { capture_id: number | null },
  captures: Record<number, { filename: string }>,
): string | undefined {
  if (ann.capture_id != null && captures[ann.capture_id]) {
    return `/images/${captures[ann.capture_id].filename}`;
  }
  return undefined;
}

export type { AnnotationKind, AnnotationTypeDef, CropBox };
