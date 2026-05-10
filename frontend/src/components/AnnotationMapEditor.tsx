import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { AnnotationEditorForm } from './AnnotationEditorForm';

function clampPopoverPosition(
  anchorX: number,
  anchorY: number,
  pw: number,
  ph: number,
): { left: number; top: number } {
  const pad = 10;
  let left = anchorX - pw / 2;
  left = Math.min(Math.max(pad, left), window.innerWidth - pw - pad);
  let top = anchorY + pad;
  if (top + ph > window.innerHeight - pad) {
    top = anchorY - ph - pad;
  }
  top = Math.min(Math.max(pad, top), window.innerHeight - ph - pad);
  return { left, top };
}

export function AnnotationMapEditor() {
  const mapEditor = useStore((s) => s.mapAnnotationEditor);
  const closeMapAnnotationEditor = useStore((s) => s.closeMapAnnotationEditor);
  const ann = useStore((s) => (mapEditor ? s.annotations[mapEditor.annId] : undefined));
  const upsertAnnotation = useStore((s) => s.upsertAnnotation);
  const removeAnnotation = useStore((s) => s.removeAnnotation);
  const showToast = useStore((s) => s.showToast);
  const placingPinForAnnId = useStore((s) => s.placingPinForAnnId);
  const setPlacingPinForAnn = useStore((s) => s.setPlacingPinForAnn);

  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (mapEditor != null && ann == null) {
      closeMapAnnotationEditor();
    }
  }, [mapEditor, ann, closeMapAnnotationEditor]);

  useLayoutEffect(() => {
    if (!mapEditor || !ann) {
      setPos(null);
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(clampPopoverPosition(mapEditor.anchorX, mapEditor.anchorY, rect.width, rect.height));
  }, [mapEditor, ann?.id]);

  useEffect(() => {
    if (!mapEditor) return;
    const onResize = () => {
      const el = panelRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos(clampPopoverPosition(mapEditor.anchorX, mapEditor.anchorY, rect.width, rect.height));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mapEditor]);

  useEffect(() => {
    if (!mapEditor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMapAnnotationEditor();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mapEditor, closeMapAnnotationEditor]);

  if (!mapEditor || !ann) return null;

  const content = (
    <>
      <div
        className="ann-map-editor-backdrop"
        aria-hidden
        onPointerDown={(e) => {
          e.preventDefault();
          closeMapAnnotationEditor();
        }}
      />
      <div
        ref={panelRef}
        className="ann-map-editor-panel"
        role="dialog"
        aria-labelledby="ann-map-editor-title"
        style={
          pos
            ? { left: pos.left, top: pos.top, visibility: 'visible' as const }
            : { left: -9999, top: -9999, visibility: 'hidden' as const }
        }
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="ann-map-editor-head">
          <span id="ann-map-editor-title" className="ann-map-editor-title">
            Annotation
          </span>
          <button
            type="button"
            className="ann-map-editor-close"
            title="Close"
            aria-label="Close"
            onClick={() => closeMapAnnotationEditor()}
          >
            ×
          </button>
        </div>
        <div className="ann-map-editor-body ann-row">
          <AnnotationEditorForm
            ann={ann}
            upsertAnnotation={upsertAnnotation}
            removeAnnotation={removeAnnotation}
            showToast={showToast}
            placing={placingPinForAnnId === ann.id}
            setPlacingPin={setPlacingPinForAnn}
            compact
            onDeleted={closeMapAnnotationEditor}
          />
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
