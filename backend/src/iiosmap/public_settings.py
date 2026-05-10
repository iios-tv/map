"""Server settings dict enriched for API/WebSocket/map bootstrap."""
from __future__ import annotations

from . import config, db
from .targeting import effective_grid_cell_dimensions, manual_grid_dimensions


def merged_settings_response() -> dict[str, str]:
    raw = dict(db.all_settings())

    defaults: dict[str, str] = {
        "capture_target_title": config.WINDOW_TITLE,
        "capture_target_hwnd": "",
        "grid_cell_auto": "0",
        "hotkey": config.DEFAULT_HOTKEY,
        "grid_cell_w": str(config.DEFAULT_GRID_CELL_W),
        "grid_cell_h": str(config.DEFAULT_GRID_CELL_H),
        "display_top_crop_px": str(config.DEFAULT_DISPLAY_TOP_CROP_PX),
        "display_bottom_crop_px": str(config.DEFAULT_DISPLAY_BOTTOM_CROP_PX),
        "display_left_crop_px": str(config.DEFAULT_DISPLAY_LEFT_CROP_PX),
        "display_right_crop_px": str(config.DEFAULT_DISPLAY_RIGHT_CROP_PX),
    }
    for key, default_val in defaults.items():
        raw.setdefault(key, default_val)

    ew, eh = effective_grid_cell_dimensions()
    mw, mh = manual_grid_dimensions()
    raw["grid_cell_w_effective"] = str(ew)
    raw["grid_cell_h_effective"] = str(eh)
    raw["grid_cell_w_manual"] = str(mw)
    raw["grid_cell_h_manual"] = str(mh)
    return raw
