"""Window capture via Win32 PrintWindow — client-area pixels for map tiles.

Uses ``PW_RENDERFULLCONTENT`` so grabs work when the window is occluded or
unfocused.

``PrintWindow`` draws the entire window into the bitmap; crop to the client area
with ``ClientToScreen((0,0))`` relative to ``GetWindowRect``.
"""
from __future__ import annotations

import ctypes
import logging
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image

from . import config, db
from . import targeting


logger = logging.getLogger(__name__)


class CaptureError(RuntimeError):
    pass


@dataclass
class CaptureResult:
    capture: dict
    screen: dict


def _grab_window_image_hwnd(hwnd: int, label: str) -> Image.Image:
    """Capture the client area of ``hwnd``. ``label`` is for logs/error messages."""
    if sys.platform != "win32":
        raise CaptureError(
            "Window capture is only supported on Windows (sys.platform != 'win32')"
        )

    targeting.ensure_per_monitor_dpi_aware()

    import win32gui  # type: ignore[import-not-found]
    import win32ui  # type: ignore[import-not-found]

    win_left, win_top, win_right, win_bottom = win32gui.GetWindowRect(hwnd)
    win_w, win_h = win_right - win_left, win_bottom - win_top
    cl_left, cl_top, cl_right, cl_bottom = win32gui.GetClientRect(hwnd)
    cl_w, cl_h = cl_right - cl_left, cl_bottom - cl_top
    if cl_w <= 0 or cl_h <= 0 or win_w <= 0 or win_h <= 0:
        raise CaptureError(
            f"Window {label!r} has invalid rects: window={win_w}x{win_h} "
            f"client={cl_w}x{cl_h}"
        )

    # Convert client (0,0) to screen coords; difference vs window rect gives
    # the chrome offsets so we can crop after capturing the full window.
    client_screen_x, client_screen_y = win32gui.ClientToScreen(hwnd, (0, 0))
    chrome_left = client_screen_x - win_left
    chrome_top = client_screen_y - win_top

    # Capture the entire window (including chrome). PrintWindow always draws
    # the full window starting at (0, 0) of the destination DC, so the bitmap
    # MUST be sized to the window rect or the bottom is clipped.
    hwnd_dc = win32gui.GetWindowDC(hwnd)
    mfc_dc = win32ui.CreateDCFromHandle(hwnd_dc)
    save_dc = mfc_dc.CreateCompatibleDC()

    bitmap = win32ui.CreateBitmap()
    bitmap.CreateCompatibleBitmap(mfc_dc, win_w, win_h)
    save_dc.SelectObject(bitmap)

    PW_RENDERFULLCONTENT = 0x00000002
    user32 = ctypes.windll.user32
    result = user32.PrintWindow(hwnd, save_dc.GetSafeHdc(), PW_RENDERFULLCONTENT)

    bmpinfo = bitmap.GetInfo()
    bmpstr = bitmap.GetBitmapBits(True)
    bmp_w = bmpinfo["bmWidth"]
    bmp_h = bmpinfo["bmHeight"]

    full = Image.frombuffer(
        "RGB",
        (bmp_w, bmp_h),
        bmpstr,
        "raw",
        "BGRX",
        0,
        1,
    )

    win32gui.DeleteObject(bitmap.GetHandle())
    save_dc.DeleteDC()
    mfc_dc.DeleteDC()
    win32gui.ReleaseDC(hwnd, hwnd_dc)

    if result != 1:
        # PrintWindow occasionally returns 0 even when the bitmap is populated.
        logger.warning("PrintWindow returned %s for %s", result, label)

    # Crop to client area. Clamp to the bitmap so a wonky chrome offset can't
    # produce a negative-size crop.
    crop_left = max(0, min(chrome_left, bmp_w))
    crop_top = max(0, min(chrome_top, bmp_h))
    crop_right = max(crop_left, min(chrome_left + cl_w, bmp_w))
    crop_bottom = max(crop_top, min(chrome_top + cl_h, bmp_h))
    if crop_right <= crop_left or crop_bottom <= crop_top:
        # Defensive: fall back to the raw bitmap if the math went sideways.
        logger.warning(
            "Client-area crop math invalid (chrome=(%d,%d) client=%dx%d bmp=%dx%d); "
            "returning full window",
            chrome_left, chrome_top, cl_w, cl_h, bmp_w, bmp_h,
        )
        return full

    return full.crop((crop_left, crop_top, crop_right, crop_bottom))


def grab_window_image(title: str | None = None) -> Image.Image:
    """Capture the configured target window's client area (see settings / targeting).

    If ``title`` is provided, resolution uses that literal/prefix rather than DB
    (for tests / special callers only).
    """
    if sys.platform != "win32":
        raise CaptureError(
            "Window capture is only supported on Windows (sys.platform != 'win32')"
        )

    targeting.ensure_per_monitor_dpi_aware()

    if title is not None:
        found = targeting.find_hwnd_for_title(title)
        if not found:
            raise CaptureError(
                f"Could not find a window titled {title!r}. Is it running?"
            )
        hwnd, matched = found
        return _grab_window_image_hwnd(hwnd, matched)

    try:
        hwnd, matched = targeting.resolve_capture_hwnd()
    except RuntimeError as exc:
        raise CaptureError(str(exc)) from exc

    try:
        return _grab_window_image_hwnd(hwnd, matched)
    except CaptureError:
        raise
    except Exception as exc:
        raise CaptureError(str(exc)) from exc


def save_image_as_capture(
    img: Image.Image, images_dir: Path | None = None
) -> dict:
    """Persist ``img`` to disk and create a Capture row, returning it."""
    config.ensure_dirs()
    images_dir = images_dir or config.IMAGES_DIR
    filename = f"{uuid.uuid4().hex}.png"
    path = images_dir / filename
    img.save(path, format="PNG")
    return db.create_capture(filename, img.width, img.height)


def capture_now(
    *,
    title: str | None = None,
    images_dir: Path | None = None,
) -> CaptureResult:
    """Grab the capture target window's client area (settings) or ``title``.

    No pixels are stripped here; HUD / edges are hidden client-side via
    ``display_*_crop_px`` settings.
    """
    img = grab_window_image(title)
    capture = save_image_as_capture(img, images_dir=images_dir)
    screen = db.create_screen(capture_id=capture["id"], layer_id=None)
    return CaptureResult(capture=capture, screen=screen)


CaptureCallback = Callable[[CaptureResult], None]
