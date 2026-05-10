from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from .. import config, db
from ..targeting import effective_grid_cell_dimensions
from ..ws import manager as ws


router = APIRouter(prefix="/composites", tags=["composites"])
logger = logging.getLogger(__name__)


class AlignmentEntry(BaseModel):
    screen_id: int
    dx: int = 0
    dy: int = 0


class CompositeIn(BaseModel):
    source_screen_ids: list[int] = Field(min_length=2)
    alignment: list[AlignmentEntry]
    layer_id: int | None = None
    grid_x: int | None = None
    grid_y: int | None = None
    grid_w: int | None = Field(default=None, ge=1, le=16)
    grid_h: int | None = Field(default=None, ge=1, le=16)
    label: str | None = None
    delete_sources: bool = True


def _get_int_setting(key: str, default: int) -> int:
    raw = db.get_setting(key, str(default))
    try:
        return max(0, int(raw))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _display_crops() -> tuple[int, int, int, int]:
    """Returns (top, right, bottom, left) display-crop pixels."""
    return (
        _get_int_setting("display_top_crop_px", config.DEFAULT_DISPLAY_TOP_CROP_PX),
        _get_int_setting("display_right_crop_px", config.DEFAULT_DISPLAY_RIGHT_CROP_PX),
        _get_int_setting("display_bottom_crop_px", config.DEFAULT_DISPLAY_BOTTOM_CROP_PX),
        _get_int_setting("display_left_crop_px", config.DEFAULT_DISPLAY_LEFT_CROP_PX),
    )


class _SourceImage:
    """An open image plus a display offset.

    For capture-backed sources, the display crops are baked in here: ``image``
    is already cropped to the visible region, and ``display_x``/``display_y``
    are the crop offsets (so a caller can map editor coords ``(dx, dy)`` -> the
    visible region's position via ``(dx + display_x, dy + display_y)``).

    For composite-backed sources, the display crops are NOT applied (the
    composite already baked in whatever crops were active when it was created),
    so the offsets are zero.
    """

    __slots__ = ("image", "display_x", "display_y")

    def __init__(self, image: Image.Image, display_x: int, display_y: int) -> None:
        self.image = image
        self.display_x = display_x
        self.display_y = display_y


def _open_screen_image(
    screen: dict,
    crops: tuple[int, int, int, int],
) -> _SourceImage:
    if screen.get("composite_id"):
        comp = db.get_composite(int(screen["composite_id"]))
        if comp is None:
            raise HTTPException(
                status_code=400,
                detail=f"screen {screen['id']} references missing composite",
            )
        img = Image.open(config.COMPOSITES_DIR / comp["filename"]).convert("RGBA")
        return _SourceImage(img, 0, 0)
    if screen.get("capture_id"):
        cap = db.get_capture(int(screen["capture_id"]))
        if cap is None:
            raise HTTPException(
                status_code=400,
                detail=f"screen {screen['id']} references missing capture",
            )
        img = Image.open(config.IMAGES_DIR / cap["filename"]).convert("RGBA")
        top, right, bottom, left = crops
        # Clamp so a wonky setting can't produce a zero-size crop.
        left = min(left, max(0, img.width - 1))
        right = min(right, max(0, img.width - 1 - left))
        top = min(top, max(0, img.height - 1))
        bottom = min(bottom, max(0, img.height - 1 - top))
        if left or right or top or bottom:
            img = img.crop((left, top, img.width - right, img.height - bottom))
        return _SourceImage(img, left, top)
    raise HTTPException(
        status_code=400,
        detail=f"screen {screen['id']} has no underlying image",
    )


@router.post("")
async def create_composite(body: CompositeIn) -> dict:
    if {a.screen_id for a in body.alignment} != set(body.source_screen_ids):
        raise HTTPException(
            status_code=400,
            detail="alignment screen_ids must exactly match source_screen_ids",
        )
    screens = db.screens_by_ids(body.source_screen_ids)
    if len(screens) != len(body.source_screen_ids):
        raise HTTPException(status_code=404, detail="some source screens not found")
    by_id = {s["id"]: s for s in screens}
    align_by_id = {a.screen_id: a for a in body.alignment}

    crops = _display_crops()
    images = {
        sid: _open_screen_image(by_id[sid], crops) for sid in body.source_screen_ids
    }

    # Compute union bbox in canvas coords. Each source's editor (dx, dy) is the
    # full source's top-left; the visible region begins (display_x, display_y)
    # into that, and has the cropped image's dimensions.
    def _visible_left(sid: int) -> int:
        return align_by_id[sid].dx + images[sid].display_x

    def _visible_top(sid: int) -> int:
        return align_by_id[sid].dy + images[sid].display_y

    min_x = min(_visible_left(sid) for sid in body.source_screen_ids)
    min_y = min(_visible_top(sid) for sid in body.source_screen_ids)
    max_x = max(
        _visible_left(sid) + images[sid].image.width for sid in body.source_screen_ids
    )
    max_y = max(
        _visible_top(sid) + images[sid].image.height for sid in body.source_screen_ids
    )
    width, height = max_x - min_x, max_y - min_y
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=400, detail="composite has zero size")

    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for sid in body.source_screen_ids:
        src = images[sid]
        ox = _visible_left(sid) - min_x
        oy = _visible_top(sid) - min_y
        canvas.alpha_composite(src.image, dest=(ox, oy))

    config.ensure_dirs()
    filename = f"{uuid.uuid4().hex}.png"
    path = config.COMPOSITES_DIR / filename
    canvas.convert("RGB").save(path, format="PNG")

    composite = db.create_composite(
        filename=filename,
        width=width,
        height=height,
        source_screen_ids=list(body.source_screen_ids),
        alignment=[a.model_dump() for a in body.alignment],
    )

    # Inherit anchor screen's layer/position when not explicitly provided
    anchor = by_id[body.source_screen_ids[0]]
    layer_id = body.layer_id if body.layer_id is not None else anchor.get("layer_id")
    grid_x = body.grid_x if body.grid_x is not None else anchor.get("grid_x")
    grid_y = body.grid_y if body.grid_y is not None else anchor.get("grid_y")

    cell_w, cell_h = effective_grid_cell_dimensions()
    grid_w = body.grid_w if body.grid_w is not None else max(1, round(width / cell_w))
    grid_h = body.grid_h if body.grid_h is not None else max(1, round(height / cell_h))

    new_screen = db.create_screen(
        composite_id=composite["id"],
        layer_id=layer_id,
        grid_x=grid_x,
        grid_y=grid_y,
        grid_w=grid_w,
        grid_h=grid_h,
        label=body.label,
    )

    if body.delete_sources:
        for sid in body.source_screen_ids:
            db.delete_screen(sid)
            await ws.broadcast({"type": "screen_deleted", "screen_id": sid})

    await ws.broadcast(
        {
            "type": "composite_created",
            "composite": composite,
            "screen": new_screen,
        }
    )
    return {"composite": composite, "screen": new_screen}
