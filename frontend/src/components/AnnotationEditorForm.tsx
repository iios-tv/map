import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, imageUrlForAnnotation } from '../api';
import { persistLastAnnotationKind } from '../lastAnnotationKind';
import type { Annotation } from '../types';
import {
  annotationKindsForSelect,
  colorForAnnotationKind,
} from '../types';

export function AnnotationEditorForm({
  ann,
  upsertAnnotation,
  removeAnnotation,
  showToast,
  placing,
  setPlacingPin,
  compact,
  onDeleted,
}: {
  ann: Annotation;
  upsertAnnotation: (a: Annotation) => void;
  removeAnnotation: (id: number) => void;
  showToast: (m: string) => void;
  placing: boolean;
  setPlacingPin: (id: number | null) => void;
  compact?: boolean;
  /** Called after this annotation is deleted (e.g. close map popover). */
  onDeleted?: () => void;
}) {
  const captures = useStore((s) => s.captures);
  const annotationTypes = useStore((s) => s.annotationTypes);
  const openAnnotationCropTool = useStore((s) => s.openAnnotationCropTool);
  const upsertCapture = useStore((s) => s.upsertCapture);
  const [text, setText] = useState(ann.text);
  const [textDirty, setTextDirty] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!textDirty) setText(ann.text);
  }, [ann.text, textDirty]);

  async function save(
    fields: Partial<Annotation> & {
      clear_capture?: boolean;
      clear_capture_crop?: boolean;
      clear_bubble_offset?: boolean;
    },
  ) {
    try {
      const updated = await api.patchAnnotation(ann.screen_id, ann.id, fields);
      upsertAnnotation(updated);
      if ('kind' in fields && fields.kind != null) persistLastAnnotationKind(updated.kind);
      if ('text' in fields) setTextDirty(false);
    } catch (e: any) {
      showToast(`Save failed: ${e.message ?? e}`);
    }
  }

  async function del() {
    if (!confirm('Delete annotation?')) return;
    try {
      await api.deleteAnnotation(ann.screen_id, ann.id);
      removeAnnotation(ann.id);
      onDeleted?.();
    } catch (e: any) {
      showToast(`Delete failed: ${e.message ?? e}`);
    }
  }

  async function captureForAnn() {
    if (capturing) return;
    setCapturing(true);
    try {
      const { capture, annotation } = await api.captureForAnnotation(ann.screen_id, ann.id);
      upsertCapture(capture);
      upsertAnnotation(annotation);
    } catch (e: any) {
      showToast(`Capture failed: ${e.message ?? e}`);
    } finally {
      setCapturing(false);
    }
  }

  async function removeCapture() {
    if (!confirm('Remove the captured image from this annotation?')) return;
    try {
      const updated = await api.patchAnnotation(ann.screen_id, ann.id, {
        clear_capture: true,
      });
      upsertAnnotation(updated);
    } catch (e: any) {
      showToast(`Remove capture failed: ${e.message ?? e}`);
    }
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t) return;
    save({ tags: [...ann.tags, t] });
    setTagInput('');
  }

  function removeTag(t: string) {
    save({ tags: ann.tags.filter((x) => x !== t) });
  }

  const dirty = textDirty && text !== ann.text;
  const captureUrl = imageUrlForAnnotation(ann, captures);
  const capture = ann.capture_id != null ? captures[ann.capture_id] : undefined;
  const thumbW = compact ? 200 : 240;

  const kindOptions = annotationKindsForSelect(annotationTypes, ann.kind);

  return (
    <>
      <div className="head">
        <span
          className="swatch"
          style={{ background: colorForAnnotationKind(annotationTypes, ann.kind) }}
        />
        <select value={ann.kind} onChange={(e) => save({ kind: e.target.value })}>
          {kindOptions.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setPlacingPin(placing ? null : ann.id)}
          title="Click on the screen to position this pin"
        >
          {placing ? 'Click on tile…' : 'Place pin'}
        </button>
        <button className="danger" onClick={del}>
          ×
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setTextDirty(true);
        }}
        onBlur={() => {
          if (text !== ann.text) save({ text });
        }}
        placeholder="What did the gravestone / skeleton / etc. say?"
        rows={compact ? 4 : undefined}
      />
      {dirty && (
        <span style={{ fontSize: 11, color: 'var(--accent-2)' }}>Unsaved changes</span>
      )}
      <AnnotationCaptureBlock
        ann={ann}
        capture={capture}
        captureUrl={captureUrl}
        capturing={capturing}
        thumbW={thumbW}
        onCapture={captureForAnn}
        onCrop={() => openAnnotationCropTool(ann.id)}
        onClearCrop={() => save({ clear_capture_crop: true })}
        onRemove={removeCapture}
      />
      <div>
        {ann.tags.map((t) => (
          <span key={t} className="tag-chip">
            {t}
            <button onClick={() => removeTag(t)} title="remove">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="row">
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder='Tag (e.g., "swim", "heat", "key item")'
        />
        <button onClick={addTag}>+ tag</button>
      </div>
      {(Math.abs(ann.bubble_offset_x ?? 0) > 0.01 || Math.abs(ann.bubble_offset_y ?? 0) > 0.01) && (
        <div className="row">
          <button
            type="button"
            onClick={() => save({ clear_bubble_offset: true })}
            title="Move the map bubble back to its default offset near the pin"
          >
            Reset bubble position
          </button>
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        Pin at ({ann.x_norm.toFixed(2)}, {ann.y_norm.toFixed(2)})
      </div>
    </>
  );
}

function AnnotationCaptureBlock({
  ann,
  capture,
  captureUrl,
  capturing,
  thumbW,
  onCapture,
  onCrop,
  onClearCrop,
  onRemove,
}: {
  ann: Annotation;
  capture: { width: number; height: number } | undefined;
  captureUrl: string | undefined;
  capturing: boolean;
  thumbW: number;
  onCapture: () => void;
  onCrop: () => void;
  onClearCrop: () => void;
  onRemove: () => void;
}) {
  if (!captureUrl || !capture) {
    return (
      <div className="row">
        <button
          onClick={onCapture}
          disabled={capturing}
          title="Capture the game window and attach the image to this annotation"
        >
          {capturing ? 'Capturing…' : 'Capture image'}
        </button>
      </div>
    );
  }

  const crop = ann.capture_crop;
  return (
    <div className="ann-capture">
      <div className="ann-capture-thumb" title="Captured image — click Crop to trim it">
        <AnnotationCaptureThumb
          url={captureUrl}
          sourceW={capture.width}
          sourceH={capture.height}
          crop={crop}
          thumbW={thumbW}
        />
      </div>
      <div className="ann-capture-actions">
        <button onClick={onCapture} disabled={capturing} title="Re-capture the game window">
          {capturing ? 'Capturing…' : 'Re-capture'}
        </button>
        <button onClick={onCrop} title="Crop / sub-region of the captured image">
          {crop ? 'Edit crop' : 'Crop'}
        </button>
        {crop && (
          <button onClick={onClearCrop} title="Show the full capture">
            Clear crop
          </button>
        )}
        <button className="danger" onClick={onRemove} title="Remove this capture from the annotation">
          Remove
        </button>
      </div>
    </div>
  );
}

function AnnotationCaptureThumb({
  url,
  sourceW,
  sourceH,
  crop,
  thumbW,
}: {
  url: string;
  sourceW: number;
  sourceH: number;
  crop: Annotation['capture_crop'];
  thumbW: number;
}) {
  const c = crop ?? { x: 0, y: 0, w: sourceW, h: sourceH };
  if (c.w <= 0 || c.h <= 0) return null;
  const aspect = c.w / c.h;
  const thumbH = Math.min(180, Math.max(40, thumbW / aspect));
  const scaleX = thumbW / c.w;
  const scaleY = thumbH / c.h;
  return (
    <div
      style={{
        position: 'relative',
        width: thumbW,
        height: thumbH,
        overflow: 'hidden',
        background: '#0a0d12',
        borderRadius: 4,
      }}
    >
      <img
        src={url}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          left: -c.x * scaleX,
          top: -c.y * scaleY,
          width: sourceW * scaleX,
          height: sourceH * scaleY,
          maxWidth: 'none',
          imageRendering: 'pixelated',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
