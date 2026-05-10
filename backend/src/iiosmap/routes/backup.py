"""Full data directory backup as ZIP (SQLite + images + composites)."""
from __future__ import annotations

import io
import json
import logging
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from .. import config, db
from ..hotkey import service as hotkey_service
from ..ws import manager as ws

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/backup", tags=["backup"])

_BACKUP_PREFIX = "iiosmap-backup"
_MANIFEST_FORMAT = "iiosmap-backup"
_MAX_UPLOAD_BYTES = 280 * 1024 * 1024


def _package_version() -> str:
    try:
        from importlib.metadata import version

        return version("iiosmap")
    except Exception:
        return "unknown"


def _manifest_dict() -> dict:
    return {
        "format": _MANIFEST_FORMAT,
        "format_version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "app_version": _package_version(),
    }


def _zip_entry_allowed(internal_name: str) -> bool:
    name = internal_name.replace("\\", "/").strip("/")
    if not name or name.startswith(".."):
        return False
    # No nested folders except images/* and composites/*
    if "/" not in name:
        return name in ("manifest.json", "db.sqlite")
    parts = name.split("/")
    if len(parts) != 2:
        return False
    folder, fname = parts
    if folder not in ("images", "composites"):
        return False
    return bool(fname) and fname not in (".", "..") and ".." not in fname


@router.get("/export")
def export_zip() -> object:
    """Download ``db.sqlite`` plus ``images/`` and ``composites`` as one ZIP."""
    config.ensure_dirs()
    db.checkpoint_sqlite_for_backup()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(_manifest_dict(), indent=2))
        if config.DB_PATH.is_file():
            zf.write(config.DB_PATH, "db.sqlite")
        for folder, arc_prefix in (
            (config.IMAGES_DIR, "images"),
            (config.COMPOSITES_DIR, "composites"),
        ):
            if not folder.is_dir():
                continue
            for fp in sorted(folder.iterdir()):
                if fp.is_file():
                    zf.write(fp, f"{arc_prefix}/{fp.name}")
    buf.seek(0)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")
    fname = f"{_BACKUP_PREFIX}-{ts}.zip"

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/import")
async def import_zip(file: UploadFile = File(...)) -> dict:
    """Replace local data dir contents from an export ZIP."""
    fname = (file.filename or "").lower()
    if not fname.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Expected a .zip backup file.")

    raw = await file.read()
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"ZIP too large (max {_MAX_UPLOAD_BYTES // (1024 * 1024)} MiB).",
        )

    with tempfile.TemporaryDirectory() as tmp:
        zp = Path(tmp) / "in.zip"
        zp.write_bytes(raw)
        extract_root = Path(tmp) / "out"
        extract_root.mkdir()
        db_path_expect = extract_root / "db.sqlite"
        manifest_ok = False
        image_names: set[str] = set()
        composite_names: set[str] = set()
        try:
            with zipfile.ZipFile(zp) as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    arc = info.filename.replace("\\", "/").strip("/")
                    if not _zip_entry_allowed(arc):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Invalid ZIP entry {arc!r}",
                        )
                    if arc == "manifest.json":
                        try:
                            data = json.loads(zf.read(arc).decode("utf-8"))
                        except json.JSONDecodeError as exc:
                            raise HTTPException(
                                status_code=400,
                                detail="Backup manifest.json is invalid JSON.",
                            ) from exc
                        if isinstance(data, dict) and data.get("format") == _MANIFEST_FORMAT:
                            manifest_ok = True
                        continue
                    if arc == "db.sqlite":
                        dest = extract_root / "db.sqlite"
                    elif arc.startswith("images/"):
                        dest = extract_root / "images" / Path(arc).name
                        image_names.add(dest.name)
                    else:
                        dest = extract_root / "composites" / Path(arc).name
                        composite_names.add(dest.name)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(info) as src, open(dest, "wb") as out:
                        shutil.copyfileobj(src, out)

        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=400, detail="Not a valid ZIP file.") from exc

        if not db_path_expect.is_file():
            raise HTTPException(
                status_code=400,
                detail="ZIP must contain db.sqlite.",
            )

        hotkey_service.stop()
        try:
            config.ensure_dirs()
            db.close_sqlite_connection()
            db.remove_sqlite_sidecar_files()
            shutil.copy2(db_path_expect, config.DB_PATH)

            shutil.rmtree(config.IMAGES_DIR, ignore_errors=True)
            config.IMAGES_DIR.mkdir(parents=True, exist_ok=True)
            src_img = extract_root / "images"
            if src_img.is_dir():
                for fp in src_img.iterdir():
                    if fp.is_file():
                        shutil.copy2(fp, config.IMAGES_DIR / fp.name)

            shutil.rmtree(config.COMPOSITES_DIR, ignore_errors=True)
            config.COMPOSITES_DIR.mkdir(parents=True, exist_ok=True)
            src_cmp = extract_root / "composites"
            if src_cmp.is_dir():
                for fp in src_cmp.iterdir():
                    if fp.is_file():
                        shutil.copy2(fp, config.COMPOSITES_DIR / fp.name)

            db.init()
            await ws.broadcast({"type": "backup_imported"})
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Backup import failed")
            try:
                config.ensure_dirs()
                db.init()
            except Exception:
                logger.exception("Failed to reopen database after broken import")
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        finally:
            hotkey_service.start()

        return {
            "ok": True,
            "manifest_valid": manifest_ok,
            "images_restored": len(image_names),
            "composites_restored": len(composite_names),
        }
