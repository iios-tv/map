from __future__ import annotations

import os
import sys
from pathlib import Path


def _legacy_data_dir() -> str | None:
    return os.environ.get("IIOSMAP_DATA_DIR") or os.environ.get("LAMULANA_DATA_DIR")


def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _dev_repo_root() -> Path:
    """Repository root when running from backend/src/iiosmap/ in a checkout."""
    # __file__ is .../iiosmap/config.py; package dir is parents[0]; repo root is parents[2].
    return _package_dir().parents[2]


def _is_dev_checkout(repo: Path) -> bool:
    return (repo / "frontend" / "package.json").is_file()


def _discover_app_root() -> Path:
    """Root directory that contains frontend assets (development tree or portable bundle)."""
    explicit = os.environ.get("IIOSMAP_APP_ROOT")
    if explicit:
        return Path(explicit).resolve()

    candidate = _dev_repo_root()
    if _is_dev_checkout(candidate):
        return candidate

    # Installed wheel without IIOSMAP_APP_ROOT: UI bundle path unknown until launcher sets env.
    return _package_dir()


def _default_user_data_dir() -> Path:
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA")
        if base:
            return Path(base) / "iiosMap"
    return Path.home() / ".local" / "share" / "iiosMap"


def _resolve_data_dir(app_root: Path) -> Path:
    legacy = _legacy_data_dir()
    if legacy:
        return Path(legacy)

    if _is_dev_checkout(app_root):
        return app_root / "data"
    return _default_user_data_dir()


PACKAGE_DIR = _package_dir()
APP_ROOT = _discover_app_root()
DATA_DIR = _resolve_data_dir(APP_ROOT)
IMAGES_DIR = DATA_DIR / "images"
COMPOSITES_DIR = DATA_DIR / "composites"
DB_PATH = DATA_DIR / "db.sqlite"

# Prefer IIOSMAP_FRONTEND_DIST when set (e.g. tests); else app tree locations.
def _frontend_dist_path() -> Path:
    override = os.environ.get("IIOSMAP_FRONTEND_DIST")
    if override:
        return Path(override).resolve()
    for candidate in (
        APP_ROOT / "frontend" / "dist",
        APP_ROOT / "dist",
    ):
        if candidate.is_dir():
            return candidate
    return APP_ROOT / "frontend" / "dist"


FRONTEND_DIST = _frontend_dist_path()

WINDOW_TITLE = "La.MuLANA"

DEFAULT_HOTKEY = "ctrl+alt+s"
DEFAULT_GRID_CELL_W = 256
DEFAULT_GRID_CELL_H = 192

DEFAULT_DISPLAY_TOP_CROP_PX = 80
DEFAULT_DISPLAY_BOTTOM_CROP_PX = 0
DEFAULT_DISPLAY_LEFT_CROP_PX = 0
DEFAULT_DISPLAY_RIGHT_CROP_PX = 0

HOST = (os.environ.get("IIOSMAP_HOST") or os.environ.get("LAMULANA_HOST") or "127.0.0.1")
PORT = int(os.environ.get("IIOSMAP_PORT") or os.environ.get("LAMULANA_PORT") or "8765")


def ensure_dirs() -> None:
    for d in (DATA_DIR, IMAGES_DIR, COMPOSITES_DIR):
        d.mkdir(parents=True, exist_ok=True)
