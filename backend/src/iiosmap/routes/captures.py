from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from .. import capture as capture_mod
from .. import db
from ..public_settings import merged_settings_response
from ..ws import manager as ws


router = APIRouter(tags=["captures"])
logger = logging.getLogger(__name__)


@router.post("/captures/now")
async def capture_now() -> dict:
    try:
        result = capture_mod.capture_now()
    except capture_mod.CaptureError as exc:
        await ws.broadcast({"type": "capture_failed", "error": str(exc)})
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Capture failed")
        await ws.broadcast({"type": "capture_failed", "error": str(exc)})
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    payload = {
        "type": "capture_added",
        "capture": result.capture,
        "screen": result.screen,
    }
    await ws.broadcast(payload)
    await ws.broadcast(
        {"type": "settings_updated", "settings": merged_settings_response()}
    )
    return {"capture": result.capture, "screen": result.screen}


@router.get("/captures/{capture_id}")
def get_capture(capture_id: int) -> dict:
    cap = db.get_capture(capture_id)
    if cap is None:
        raise HTTPException(status_code=404, detail="capture not found")
    return cap
