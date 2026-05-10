from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..ws import manager as ws


router = APIRouter(prefix="/layers", tags=["layers"])


class LayerIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str = "#88ccff"
    sort_order: int = 0


class LayerPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = None
    sort_order: int | None = None


@router.get("")
def list_layers() -> list[dict]:
    return db.list_layers()


@router.post("")
async def create_layer(body: LayerIn) -> dict:
    try:
        layer = db.create_layer(body.name, body.color, body.sort_order)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await ws.broadcast({"type": "layer_updated", "layer": layer})
    return layer


@router.patch("/{layer_id}")
async def update_layer(layer_id: int, body: LayerPatch) -> dict:
    layer = db.update_layer(layer_id, **body.model_dump(exclude_none=True))
    if layer is None:
        raise HTTPException(status_code=404, detail="layer not found")
    await ws.broadcast({"type": "layer_updated", "layer": layer})
    return layer


@router.delete("/{layer_id}", status_code=204)
async def delete_layer(layer_id: int) -> None:
    db.delete_layer(layer_id)
    await ws.broadcast({"type": "layer_deleted", "layer_id": layer_id})
