from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from .. import db
from ..hotkey import service as hotkey_service
from ..public_settings import merged_settings_response
from ..ws import manager as ws


router = APIRouter(prefix="/settings", tags=["settings"])


KNOWN_KEYS = {
    "hotkey",
    "grid_cell_w",
    "grid_cell_h",
    "capture_target_title",
    "capture_target_hwnd",
    "display_top_crop_px",
    "display_bottom_crop_px",
    "display_left_crop_px",
    "display_right_crop_px",
}


class SettingsPatch(BaseModel):
    hotkey: str | None = None
    grid_cell_auto: bool | None = None
    grid_cell_w: int | None = None
    grid_cell_h: int | None = None
    capture_target_title: str | None = None
    capture_target_hwnd: str | None = None
    display_top_crop_px: int | None = None
    display_bottom_crop_px: int | None = None
    display_left_crop_px: int | None = None
    display_right_crop_px: int | None = None

    @field_validator("capture_target_title", mode="before")
    @classmethod
    def strip_title(cls, v: object) -> object:
        if isinstance(v, str):
            return v.strip() or None
        return v

    @field_validator("capture_target_hwnd", mode="before")
    @classmethod
    def strip_hwnd(cls, v: object) -> object:
        if isinstance(v, str):
            return v.strip()
        return v


def _persist_setting_value(key: str, value: object) -> None:
    if isinstance(value, bool):
        db.set_setting(key, "1" if value else "0")
    else:
        db.set_setting(key, str(value))


@router.get("")
def get_settings() -> dict:
    return merged_settings_response()


@router.patch("")
async def update_settings(body: SettingsPatch) -> dict:
    payload = body.model_dump(exclude_none=True)

    auto_val = payload.pop("grid_cell_auto", None)

    rebind_hotkey = payload.get("hotkey") is not None
    for key, value in payload.items():
        if key not in KNOWN_KEYS:
            continue
        _persist_setting_value(key, value)
    if rebind_hotkey and isinstance(payload.get("hotkey"), str):
        hotkey_service.rebind(payload["hotkey"])

    if auto_val is not None:
        db.set_setting("grid_cell_auto", "1" if auto_val else "0")

    merged = merged_settings_response()
    await ws.broadcast({"type": "settings_updated", "settings": merged})
    return merged
