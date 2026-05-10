from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..public_settings import merged_settings_response
from ..ws import manager as ws


router = APIRouter(tags=["screens"])


class CropBox(BaseModel):
    x: int
    y: int
    w: int
    h: int


class ScreenPatch(BaseModel):
    layer_id: int | None = None
    grid_x: int | None = None
    grid_y: int | None = None
    grid_w: int | None = Field(default=None, ge=1, le=16)
    grid_h: int | None = Field(default=None, ge=1, le=16)
    crop_box: CropBox | None = None
    label: str | None = None
    clear_layer: bool = False
    clear_crop_box: bool = False


class PlaceBody(BaseModel):
    anchor_screen_id: int
    direction: str = Field(pattern="^[NSEW]$")
    layer_id: int | None = None


@router.get("/map")
def get_map(layer: int | None = None) -> dict:
    layers = db.list_layers()
    placed = db.list_screens(layer_id=layer if layer is not None else "any")
    placed = [s for s in placed if s.get("layer_id") is not None]
    pending = db.list_screens(layer_id=None)
    annotations = db.list_annotations()
    settings = merged_settings_response()

    capture_ids: set[int] = set()
    composite_ids: set[int] = set()
    for s in placed + pending:
        if s.get("capture_id"):
            capture_ids.add(int(s["capture_id"]))
        if s.get("composite_id"):
            composite_ids.add(int(s["composite_id"]))
    for a in annotations:
        if a.get("capture_id"):
            capture_ids.add(int(a["capture_id"]))

    captures = {
        cid: cap
        for cid in capture_ids
        if (cap := db.get_capture(cid)) is not None
    }
    composites = {
        cid: comp
        for cid in composite_ids
        if (comp := db.get_composite(cid)) is not None
    }

    return {
        "layers": layers,
        "screens": placed,
        "pending": pending,
        "annotations": annotations,
        "annotation_types": db.get_annotation_types_for_map(),
        "settings": settings,
        "captures": captures,
        "composites": composites,
    }


@router.get("/pending")
def get_pending() -> list[dict]:
    return db.list_screens(layer_id=None)


@router.get("/screens/{screen_id}")
def get_screen(screen_id: int) -> dict:
    screen = db.get_screen(screen_id)
    if screen is None:
        raise HTTPException(status_code=404, detail="screen not found")
    return screen


@router.patch("/screens/{screen_id}")
async def update_screen(screen_id: int, body: ScreenPatch) -> dict:
    fields: dict = body.model_dump(exclude_none=True)
    fields.pop("clear_layer", None)
    fields.pop("clear_crop_box", None)
    if body.clear_layer:
        fields["layer_id"] = None
    if body.clear_crop_box:
        fields["crop_box"] = None
    if "crop_box" in fields and isinstance(fields["crop_box"], dict):
        pass
    screen = db.update_screen(screen_id, **fields)
    if screen is None:
        raise HTTPException(status_code=404, detail="screen not found")
    await ws.broadcast({"type": "screen_updated", "screen": screen})
    return screen


@router.delete("/screens/{screen_id}", status_code=204)
async def delete_screen(screen_id: int) -> None:
    db.delete_screen(screen_id)
    await ws.broadcast({"type": "screen_deleted", "screen_id": screen_id})


@router.post("/screens/{screen_id}/place")
async def place_screen(screen_id: int, body: PlaceBody) -> dict:
    anchor = db.get_screen(body.anchor_screen_id)
    if anchor is None:
        raise HTTPException(status_code=404, detail="anchor screen not found")
    if anchor.get("layer_id") is None or anchor.get("grid_x") is None:
        raise HTTPException(
            status_code=400, detail="anchor must already be placed on a layer"
        )
    layer_id = body.layer_id if body.layer_id is not None else anchor["layer_id"]

    dx, dy = {"N": (0, -1), "S": (0, 1), "E": (1, 0), "W": (-1, 0)}[body.direction]
    new_x = int(anchor["grid_x"]) + dx * int(anchor.get("grid_w", 1))
    new_y = int(anchor["grid_y"]) + dy * int(anchor.get("grid_h", 1))

    screen = db.update_screen(
        screen_id, layer_id=layer_id, grid_x=new_x, grid_y=new_y
    )
    if screen is None:
        raise HTTPException(status_code=404, detail="screen not found")
    await ws.broadcast({"type": "screen_updated", "screen": screen})
    return screen
