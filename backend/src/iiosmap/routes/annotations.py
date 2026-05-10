from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import capture as capture_mod
from .. import db
from ..ws import manager as ws


router = APIRouter(tags=["annotations"])
logger = logging.getLogger(__name__)


class CaptureCrop(BaseModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    w: int = Field(ge=1)
    h: int = Field(ge=1)


class AnnotationIn(BaseModel):
    kind: str
    text: str = ""
    x_norm: float = Field(default=0.5, ge=0.0, le=1.0)
    y_norm: float = Field(default=0.5, ge=0.0, le=1.0)
    tags: list[str] = []
    capture_id: int | None = None
    capture_crop: CaptureCrop | None = None
    bubble_offset_x: float = 0.0
    bubble_offset_y: float = 0.0


class AnnotationPatch(BaseModel):
    kind: str | None = None
    text: str | None = None
    x_norm: float | None = Field(default=None, ge=0.0, le=1.0)
    y_norm: float | None = Field(default=None, ge=0.0, le=1.0)
    tags: list[str] | None = None
    capture_id: int | None = None
    capture_crop: CaptureCrop | None = None
    clear_capture: bool = False
    clear_capture_crop: bool = False
    bubble_offset_x: float | None = None
    bubble_offset_y: float | None = None
    clear_bubble_offset: bool = False


def _validate_kind(kind: str) -> None:
    valid = db.declared_annotation_type_ids()
    if kind not in valid:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unknown annotation kind {kind!r}; add it under Settings, "
                f"or use one of: {sorted(valid)}"
            ),
        )


@router.get("/screens/{screen_id}/annotations")
def list_annotations(screen_id: int) -> list[dict]:
    return db.list_annotations(screen_id)


@router.post("/screens/{screen_id}/annotations")
async def create_annotation(screen_id: int, body: AnnotationIn) -> dict:
    if db.get_screen(screen_id) is None:
        raise HTTPException(status_code=404, detail="screen not found")
    _validate_kind(body.kind)
    if body.capture_id is not None and db.get_capture(body.capture_id) is None:
        raise HTTPException(status_code=404, detail="capture not found")
    ann = db.create_annotation(
        screen_id=screen_id,
        kind=body.kind,
        text=body.text,
        x_norm=body.x_norm,
        y_norm=body.y_norm,
        tags=body.tags,
        capture_id=body.capture_id,
        capture_crop=body.capture_crop.model_dump() if body.capture_crop else None,
        bubble_offset_x=body.bubble_offset_x,
        bubble_offset_y=body.bubble_offset_y,
    )
    await ws.broadcast({"type": "annotation_updated", "annotation": ann})
    return ann


@router.patch("/screens/{screen_id}/annotations/{ann_id}")
async def update_annotation(
    screen_id: int, ann_id: int, body: AnnotationPatch
) -> dict:
    existing = db.get_annotation(ann_id)
    if existing is None or existing["screen_id"] != screen_id:
        raise HTTPException(status_code=404, detail="annotation not found")
    if body.kind is not None:
        _validate_kind(body.kind)

    fields = body.model_dump(exclude_none=True)
    fields.pop("clear_capture", None)
    fields.pop("clear_capture_crop", None)
    fields.pop("clear_bubble_offset", None)
    if "capture_crop" in fields and isinstance(fields["capture_crop"], dict):
        # CaptureCrop pydantic model converts to dict for db layer
        pass
    if body.clear_capture:
        fields["capture_id"] = None
        fields["capture_crop"] = None
    elif body.capture_id is not None and db.get_capture(body.capture_id) is None:
        raise HTTPException(status_code=404, detail="capture not found")
    if body.clear_capture_crop:
        fields["capture_crop"] = None
    if body.clear_bubble_offset:
        fields["bubble_offset_x"] = 0.0
        fields["bubble_offset_y"] = 0.0

    ann = db.update_annotation(ann_id, **fields)
    await ws.broadcast({"type": "annotation_updated", "annotation": ann})
    return ann  # type: ignore[return-value]


@router.delete("/screens/{screen_id}/annotations/{ann_id}", status_code=204)
async def delete_annotation(screen_id: int, ann_id: int) -> None:
    existing = db.get_annotation(ann_id)
    if existing is None or existing["screen_id"] != screen_id:
        raise HTTPException(status_code=404, detail="annotation not found")
    db.delete_annotation(ann_id)
    await ws.broadcast(
        {"type": "annotation_deleted", "annotation_id": ann_id, "screen_id": screen_id}
    )


@router.post("/screens/{screen_id}/annotations/{ann_id}/capture")
async def capture_for_annotation(screen_id: int, ann_id: int) -> dict:
    """Capture the game window and attach the resulting image to this annotation.

    Unlike the global ``/captures/now`` endpoint this does NOT create a new
    pending screen — the capture is just a small attachment for the annotation
    (e.g. a photo of the gravestone text).
    """
    existing = db.get_annotation(ann_id)
    if existing is None or existing["screen_id"] != screen_id:
        raise HTTPException(status_code=404, detail="annotation not found")

    try:
        img = capture_mod.grab_window_image()
    except capture_mod.CaptureError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Annotation capture failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    capture = capture_mod.save_image_as_capture(img)
    # Reset any prior crop so the user sees the full new image.
    ann = db.update_annotation(ann_id, capture_id=capture["id"], capture_crop=None)
    await ws.broadcast({"type": "capture_added", "capture": capture})
    await ws.broadcast({"type": "annotation_updated", "annotation": ann})
    return {"capture": capture, "annotation": ann}
