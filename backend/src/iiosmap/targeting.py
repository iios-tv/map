"""Win32 helpers: capture hwnd resolution, window listing, client rect, DPI."""
from __future__ import annotations

import ctypes
import sys
from typing import cast

from . import config, db

_DPI_AWARE_DONE = False
def ensure_per_monitor_dpi_aware() -> None:
    global _DPI_AWARE_DONE
    if _DPI_AWARE_DONE:
        return
    _DPI_AWARE_DONE = True
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def _parse_hwnd_str(raw: str | None) -> int | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        return int(str(raw).strip())
    except ValueError:
        return None


def find_hwnd_for_title(search_title: str) -> tuple[int, str] | None:
    import win32gui  # type: ignore[import-not-found]

    hwnd = win32gui.FindWindow(None, search_title)
    if hwnd:
        t = win32gui.GetWindowText(hwnd) or search_title
        return hwnd, t

    candidates: list[tuple[int, str]] = []

    def _enum(h: int, _: object) -> None:
        if not win32gui.IsWindowVisible(h):
            return
        t = win32gui.GetWindowText(h)
        if t and (t == search_title or t.startswith(search_title)):
            candidates.append((h, t))

    win32gui.EnumWindows(_enum, None)
    if candidates:
        return candidates[0]
    return None


def capture_target_keys() -> tuple[str, str | None]:
    title = db.get_setting("capture_target_title") or config.WINDOW_TITLE
    raw_hwnd = db.get_setting("capture_target_hwnd")
    hs = raw_hwnd.strip() if isinstance(raw_hwnd, str) and raw_hwnd.strip() else None
    return title, hs


def resolve_capture_hwnd() -> tuple[int, str]:
    """Return (hwnd, matched_title_or_display) used for grabs."""
    if sys.platform != "win32":
        raise RuntimeError(
            "Window targeting is only supported on Windows (sys.platform != 'win32')"
        )
    ensure_per_monitor_dpi_aware()
    import win32gui  # type: ignore[import-not-found]

    title, hwnd_str = capture_target_keys()

    hinted = _parse_hwnd_str(hwnd_str)
    if hinted and win32gui.IsWindow(hinted):
        t = win32gui.GetWindowText(hinted)
        return hinted, t or title

    found = find_hwnd_for_title(title)
    if not found:
        raise RuntimeError(
            f"Could not find a window titled {title!r}. Is it running?"
        )
    return found


def get_client_dimensions(hwnd: int) -> tuple[int, int] | None:
    """Client area width,height in physical pixels; None if unavailable."""
    if sys.platform != "win32":
        return None
    ensure_per_monitor_dpi_aware()
    try:
        import win32gui  # type: ignore[import-not-found]
    except Exception:
        return None
    try:
        if not win32gui.IsWindow(cast(int, hwnd)):
            return None
        cl, ct, cr, cb = win32gui.GetClientRect(hwnd)
        w, h = cr - cl, cb - ct
    except Exception:
        return None
    if w <= 0 or h <= 0:
        return None
    return w, h


def client_size_from_settings_target() -> tuple[int, int] | None:
    """Client WxH for the resolved capture hwnd, if any."""
    if sys.platform != "win32":
        return None
    try:
        hwnd, _t = resolve_capture_hwnd()
    except RuntimeError:
        return None
    return get_client_dimensions(hwnd)


def grid_cell_auto_enabled() -> bool:
    raw = db.get_setting("grid_cell_auto")
    if raw is None:
        # Until settings are migrated, keep manual cell size so existing maps
        # do not rescale.
        return False
    return raw.strip().lower() not in ("0", "false", "no", "off")


def manual_grid_dimensions() -> tuple[int, int]:
    w_raw = db.get_setting("grid_cell_w", str(config.DEFAULT_GRID_CELL_W))
    h_raw = db.get_setting("grid_cell_h", str(config.DEFAULT_GRID_CELL_H))
    try:
        w = max(32, min(4096, int(str(w_raw))))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        w = config.DEFAULT_GRID_CELL_W
    try:
        h = max(32, min(4096, int(str(h_raw))))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        h = config.DEFAULT_GRID_CELL_H
    return w, h


def effective_grid_cell_dimensions() -> tuple[int, int]:
    """Layout cell size honoring grid_cell_auto and capture target."""
    mw, mh = manual_grid_dimensions()
    if not grid_cell_auto_enabled():
        return mw, mh
    client = client_size_from_settings_target()
    if client is None:
        return mw, mh
    cw, ch = client
    return cw, ch


WindowEntry = dict[str, str | int]


def list_targetable_windows() -> list[WindowEntry]:
    if sys.platform != "win32":
        return []

    ensure_per_monitor_dpi_aware()
    import win32gui  # type: ignore[import-not-found]

    collected: list[WindowEntry] = []

    def _enum(h_win: int, _: object) -> None:
        if not win32gui.IsWindowVisible(h_win):
            return
        tt = win32gui.GetWindowText(h_win)
        if not tt or not tt.strip():
            return
        dim = get_client_dimensions(h_win)
        if dim is None:
            return
        cw, ch = dim
        if cw <= 0 or ch <= 0:
            return
        collected.append(
            {
                "hwnd": str(int(h_win)),
                "title": tt,
                "client_w": cw,
                "client_h": ch,
            }
        )

    win32gui.EnumWindows(_enum, None)
    collected.sort(key=lambda e: str(e["title"]).lower())
    return collected
