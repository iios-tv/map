from __future__ import annotations

import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

from . import config


_LOCK = threading.RLock()
_CONN: sqlite3.Connection | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dict_factory(cursor: sqlite3.Cursor, row: tuple) -> dict:
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


def get_conn() -> sqlite3.Connection:
    global _CONN
    if _CONN is None:
        config.ensure_dirs()
        _CONN = sqlite3.connect(
            config.DB_PATH, check_same_thread=False, isolation_level=None
        )
        _CONN.row_factory = _dict_factory
        _CONN.execute("PRAGMA journal_mode=WAL")
        _CONN.execute("PRAGMA foreign_keys=ON")
    return _CONN


def checkpoint_sqlite_for_backup() -> None:
    """Checkpoint WAL into ``db.sqlite`` so a file copy is self-contained."""
    with _LOCK:
        if _CONN is None:
            return
        try:
            _CONN.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except Exception:
            pass


def close_sqlite_connection() -> None:
    """Close the process-global SQLite handle (e.g. before replacing ``db.sqlite``)."""
    global _CONN
    with _LOCK:
        if _CONN is None:
            return
        try:
            _CONN.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except Exception:
            pass
        try:
            _CONN.close()
        except Exception:
            pass
        _CONN = None


def remove_sqlite_sidecar_files() -> None:
    """Delete ``-wal`` / ``-shm`` siblings so a new main file is clean."""
    dbp = config.DB_PATH
    for suf in ("-wal", "-shm"):
        p = Path(f"{dbp}{suf}")
        try:
            if p.is_file():
                p.unlink()
        except OSError:
            pass


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    conn = get_conn()
    with _LOCK:
        conn.execute("BEGIN")
        try:
            yield conn
        except Exception:
            conn.execute("ROLLBACK")
            raise
        else:
            conn.execute("COMMIT")


SCHEMA = """
CREATE TABLE IF NOT EXISTS layers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#88ccff',
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS composites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    source_screen_ids TEXT NOT NULL,
    alignment TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS screens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capture_id INTEGER REFERENCES captures(id) ON DELETE SET NULL,
    composite_id INTEGER REFERENCES composites(id) ON DELETE SET NULL,
    layer_id INTEGER REFERENCES layers(id) ON DELETE SET NULL,
    grid_x INTEGER,
    grid_y INTEGER,
    grid_w INTEGER NOT NULL DEFAULT 1,
    grid_h INTEGER NOT NULL DEFAULT 1,
    crop_box TEXT,
    label TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_screens_layer ON screens(layer_id);
CREATE INDEX IF NOT EXISTS idx_screens_pending ON screens(layer_id) WHERE layer_id IS NULL;

CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    screen_id INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    x_norm REAL NOT NULL DEFAULT 0.5,
    y_norm REAL NOT NULL DEFAULT 0.5,
    tags TEXT NOT NULL DEFAULT '[]',
    capture_id INTEGER REFERENCES captures(id) ON DELETE SET NULL,
    capture_crop TEXT,
    bubble_offset_x REAL NOT NULL DEFAULT 0,
    bubble_offset_y REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_annotations_screen ON annotations(screen_id);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def _migrate(conn: sqlite3.Connection) -> None:
    """Best-effort, idempotent column additions for existing databases.

    SQLite's ``ALTER TABLE ADD COLUMN`` is the safest way to evolve a schema in
    place; older DBs created before a column existed simply pick up NULLs.
    """
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(annotations)").fetchall()}
    if "capture_id" not in cols:
        conn.execute(
            "ALTER TABLE annotations ADD COLUMN capture_id INTEGER "
            "REFERENCES captures(id) ON DELETE SET NULL"
        )
    if "capture_crop" not in cols:
        conn.execute("ALTER TABLE annotations ADD COLUMN capture_crop TEXT")
    if "bubble_offset_x" not in cols:
        conn.execute(
            "ALTER TABLE annotations ADD COLUMN bubble_offset_x REAL NOT NULL DEFAULT 0"
        )
    if "bubble_offset_y" not in cols:
        conn.execute(
            "ALTER TABLE annotations ADD COLUMN bubble_offset_y REAL NOT NULL DEFAULT 0"
        )


_GRID_AUTO_MIGRATION_KEY = "migration_v1_grid_auto_existing_map_fixup"


def _placed_screen_count(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM screens WHERE grid_x IS NOT NULL"
    ).fetchone()
    return int(row["n"] if row else 0)


def _finalize_grid_cell_auto_preference(conn: sqlite3.Connection) -> None:
    """Set grid_cell_auto safely and fix a one-time upgrade issue.

    Screen positions are stored in grid units; global cell width/height scales
    the whole map. Turning on ``grid_cell_auto`` for an existing laid-out map
    changes effective cell size and jumbles tiles/annotations.

    Runs once per DB (see _GRID_AUTO_MIGRATION_KEY):
    - Missing row: ``1`` when no placed screens yet, else ``0``.
    - Row ``1`` with placed screens (bad prior default): force ``0``.
    """
    if conn.execute(
        "SELECT 1 FROM settings WHERE key=?", (_GRID_AUTO_MIGRATION_KEY,)
    ).fetchone():
        return

    n_placed = _placed_screen_count(conn)
    row = conn.execute(
        "SELECT value FROM settings WHERE key='grid_cell_auto'"
    ).fetchone()
    current = row["value"] if row else None

    if current is None:
        conn.execute(
            "INSERT INTO settings(key, value) VALUES ('grid_cell_auto', ?)",
            ("1" if n_placed == 0 else "0",),
        )
    elif current == "1" and n_placed > 0:
        conn.execute("UPDATE settings SET value='0' WHERE key='grid_cell_auto'")

    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?, ?)",
        (_GRID_AUTO_MIGRATION_KEY, "done"),
    )


def init() -> None:
    conn = get_conn()
    # executescript implicitly manages its own transactions, so run outside tx()
    conn.executescript(SCHEMA)
    _migrate(conn)
    with tx() as conn:
        defaults = {
            "hotkey": config.DEFAULT_HOTKEY,
            "grid_cell_w": str(config.DEFAULT_GRID_CELL_W),
            "grid_cell_h": str(config.DEFAULT_GRID_CELL_H),
            "capture_target_title": config.WINDOW_TITLE,
            "capture_target_hwnd": "",
            "display_top_crop_px": str(config.DEFAULT_DISPLAY_TOP_CROP_PX),
            "display_bottom_crop_px": str(config.DEFAULT_DISPLAY_BOTTOM_CROP_PX),
            "display_left_crop_px": str(config.DEFAULT_DISPLAY_LEFT_CROP_PX),
            "display_right_crop_px": str(config.DEFAULT_DISPLAY_RIGHT_CROP_PX),
        }
        for k, v in defaults.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (k, v)
            )

        _finalize_grid_cell_auto_preference(conn)
        row = conn.execute("SELECT COUNT(*) AS n FROM layers").fetchone()
        if row["n"] == 0:
            conn.execute(
                "INSERT INTO layers(name, color, sort_order) VALUES (?, ?, ?)",
                ("Surface", "#88cc88", 0),
            )

        if conn.execute(
            "SELECT 1 FROM settings WHERE key=?", (ANNOTATION_TYPES_KEY,)
        ).fetchone() is None:
            screens_n = int(
                conn.execute("SELECT COUNT(*) AS n FROM screens").fetchone()["n"]
            )
            ann_n = int(
                conn.execute("SELECT COUNT(*) AS n FROM annotations").fetchone()["n"]
            )
            initial_types = (
                _LEGACY_ANNOTATION_TYPES
                if (screens_n > 0 or ann_n > 0)
                else _FRESH_ANNOTATION_TYPES
            )
            conn.execute(
                "INSERT INTO settings(key, value) VALUES (?, ?)",
                (ANNOTATION_TYPES_KEY, json.dumps(initial_types)),
            )


# ---------- Settings ----------

def get_setting(key: str, default: str | None = None) -> str | None:
    row = get_conn().execute(
        "SELECT value FROM settings WHERE key=?", (key,)
    ).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with tx() as conn:
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )


def all_settings() -> dict[str, str]:
    rows = get_conn().execute("SELECT key, value FROM settings").fetchall()
    return {r["key"]: r["value"] for r in rows}


# ---------- Layers ----------

def list_layers() -> list[dict]:
    return get_conn().execute(
        "SELECT * FROM layers ORDER BY sort_order, id"
    ).fetchall()


def create_layer(name: str, color: str = "#88ccff", sort_order: int = 0) -> dict:
    with tx() as conn:
        cur = conn.execute(
            "INSERT INTO layers(name, color, sort_order) VALUES(?, ?, ?)",
            (name, color, sort_order),
        )
        return get_layer(cur.lastrowid)  # type: ignore[arg-type]


def get_layer(layer_id: int) -> dict | None:
    return get_conn().execute(
        "SELECT * FROM layers WHERE id=?", (layer_id,)
    ).fetchone()


def update_layer(layer_id: int, **fields: Any) -> dict | None:
    allowed = {"name", "color", "sort_order"}
    fields = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not fields:
        return get_layer(layer_id)
    with tx() as conn:
        cols = ", ".join(f"{k}=?" for k in fields)
        conn.execute(
            f"UPDATE layers SET {cols} WHERE id=?",
            (*fields.values(), layer_id),
        )
    return get_layer(layer_id)


def delete_layer(layer_id: int) -> None:
    with tx() as conn:
        conn.execute("UPDATE screens SET layer_id=NULL WHERE layer_id=?", (layer_id,))
        conn.execute("DELETE FROM layers WHERE id=?", (layer_id,))


# ---------- Captures ----------

def create_capture(filename: str, width: int, height: int) -> dict:
    with tx() as conn:
        cur = conn.execute(
            "INSERT INTO captures(filename, captured_at, width, height) "
            "VALUES(?, ?, ?, ?)",
            (filename, _now_iso(), width, height),
        )
        cid = cur.lastrowid
    return get_conn().execute(
        "SELECT * FROM captures WHERE id=?", (cid,)
    ).fetchone()


def get_capture(capture_id: int) -> dict | None:
    return get_conn().execute(
        "SELECT * FROM captures WHERE id=?", (capture_id,)
    ).fetchone()


# ---------- Screens ----------

def _hydrate_screen(row: dict | None) -> dict | None:
    if row is None:
        return None
    if isinstance(row.get("crop_box"), str):
        try:
            row["crop_box"] = json.loads(row["crop_box"]) if row["crop_box"] else None
        except Exception:
            row["crop_box"] = None
    return row


def create_screen(
    *,
    capture_id: int | None = None,
    composite_id: int | None = None,
    layer_id: int | None = None,
    grid_x: int | None = None,
    grid_y: int | None = None,
    grid_w: int = 1,
    grid_h: int = 1,
    crop_box: dict | None = None,
    label: str | None = None,
) -> dict:
    with tx() as conn:
        cur = conn.execute(
            "INSERT INTO screens("
            "capture_id, composite_id, layer_id, grid_x, grid_y, grid_w, grid_h, "
            "crop_box, label, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                capture_id,
                composite_id,
                layer_id,
                grid_x,
                grid_y,
                grid_w,
                grid_h,
                json.dumps(crop_box) if crop_box else None,
                label,
                _now_iso(),
            ),
        )
        sid = cur.lastrowid
    return get_screen(sid)  # type: ignore[return-value]


def get_screen(screen_id: int) -> dict | None:
    row = get_conn().execute(
        "SELECT * FROM screens WHERE id=?", (screen_id,)
    ).fetchone()
    return _hydrate_screen(row)


def list_screens(layer_id: int | None | str = "any") -> list[dict]:
    conn = get_conn()
    if layer_id == "any":
        rows = conn.execute("SELECT * FROM screens").fetchall()
    elif layer_id is None:
        rows = conn.execute(
            "SELECT * FROM screens WHERE layer_id IS NULL ORDER BY created_at DESC"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM screens WHERE layer_id=? ORDER BY id", (layer_id,)
        ).fetchall()
    return [_hydrate_screen(r) for r in rows]  # type: ignore[misc]


def remap_placed_screens_cell_resize(
    old_cell_w: int,
    old_cell_h: int,
    new_cell_w: int,
    new_cell_h: int,
) -> list[dict]:
    """Optional batch rewrite of grid_* when cell WxH ratios change.

    **Not wired to settings toggles.** Integer rounding is lossy — repeated /
    cyclic remaps visibly drift placements, which is unsafe for UX.

    World position scales as grid_coord * cell_size. This adjusts grid ints so
    anchors stay approximate in pixel space for a ONE-OFF ratio change only.

    Empty list if nothing moved or ratios are degenerate / identical.
    """
    ow, oh, nw, nh = old_cell_w, old_cell_h, new_cell_w, new_cell_h
    if nw <= 0 or nh <= 0 or ow <= 0 or oh <= 0 or (nw == ow and nh == oh):
        return []

    rows = get_conn().execute(
        "SELECT id, grid_x, grid_y, grid_w, grid_h FROM screens "
        "WHERE grid_x IS NOT NULL AND grid_y IS NOT NULL"
    ).fetchall()
    if not rows:
        return []

    updated_ids: list[int] = []
    with tx() as conn:
        for r in rows:
            sid = int(r["id"])
            gx = int(r["grid_x"])
            gy = int(r["grid_y"])
            gw = int(r["grid_w"])
            gh = int(r["grid_h"])
            ngx = int(round(gx * ow / nw))
            ngy = int(round(gy * oh / nh))
            ngw = max(1, min(16, int(round(gw * ow / nw))))
            ngh = max(1, min(16, int(round(gh * oh / nh))))
            if (gx, gy, gw, gh) == (ngx, ngy, ngw, ngh):
                continue
            conn.execute(
                "UPDATE screens SET grid_x=?, grid_y=?, grid_w=?, grid_h=? WHERE id=?",
                (ngx, ngy, ngw, ngh, sid),
            )
            updated_ids.append(sid)
    out: list[dict] = []
    for sid in updated_ids:
        sc = get_screen(sid)
        if sc:
            out.append(sc)
    return out


def update_screen(screen_id: int, **fields: Any) -> dict | None:
    allowed = {
        "layer_id",
        "grid_x",
        "grid_y",
        "grid_w",
        "grid_h",
        "crop_box",
        "label",
    }
    payload: dict[str, Any] = {}
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k == "crop_box":
            payload[k] = json.dumps(v) if v is not None else None
        else:
            payload[k] = v
    if not payload:
        return get_screen(screen_id)
    with tx() as conn:
        cols = ", ".join(f"{k}=?" for k in payload)
        conn.execute(
            f"UPDATE screens SET {cols} WHERE id=?",
            (*payload.values(), screen_id),
        )
    return get_screen(screen_id)


def delete_screen(screen_id: int) -> None:
    with tx() as conn:
        conn.execute("DELETE FROM screens WHERE id=?", (screen_id,))


def screens_by_ids(ids: Iterable[int]) -> list[dict]:
    ids = list(ids)
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    rows = get_conn().execute(
        f"SELECT * FROM screens WHERE id IN ({placeholders})", ids
    ).fetchall()
    return [_hydrate_screen(r) for r in rows]  # type: ignore[misc]


# ---------- Composites ----------

def create_composite(
    filename: str,
    width: int,
    height: int,
    source_screen_ids: list[int],
    alignment: list[dict],
) -> dict:
    with tx() as conn:
        cur = conn.execute(
            "INSERT INTO composites(filename, width, height, source_screen_ids, alignment, created_at) "
            "VALUES(?,?,?,?,?,?)",
            (
                filename,
                width,
                height,
                json.dumps(source_screen_ids),
                json.dumps(alignment),
                _now_iso(),
            ),
        )
        cid = cur.lastrowid
    return get_composite(cid)  # type: ignore[return-value]


def get_composite(composite_id: int) -> dict | None:
    row = get_conn().execute(
        "SELECT * FROM composites WHERE id=?", (composite_id,)
    ).fetchone()
    if row is None:
        return None
    if isinstance(row.get("source_screen_ids"), str):
        try:
            row["source_screen_ids"] = json.loads(row["source_screen_ids"])
        except Exception:
            row["source_screen_ids"] = []
    if isinstance(row.get("alignment"), str):
        try:
            row["alignment"] = json.loads(row["alignment"])
        except Exception:
            row["alignment"] = []
    return row


# ---------- Annotations ----------

def _hydrate_annotation(row: dict | None) -> dict | None:
    if row is None:
        return None
    if isinstance(row.get("tags"), str):
        try:
            row["tags"] = json.loads(row["tags"])
        except Exception:
            row["tags"] = []
    if isinstance(row.get("capture_crop"), str):
        try:
            row["capture_crop"] = json.loads(row["capture_crop"]) if row["capture_crop"] else None
        except Exception:
            row["capture_crop"] = None
    elif "capture_crop" not in row:
        row["capture_crop"] = None
    if "capture_id" not in row:
        row["capture_id"] = None
    for k in ("bubble_offset_x", "bubble_offset_y"):
        if row.get(k) is None:
            row[k] = 0.0
    return row


def list_annotations(screen_id: int | None = None) -> list[dict]:
    conn = get_conn()
    if screen_id is None:
        rows = conn.execute("SELECT * FROM annotations").fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM annotations WHERE screen_id=? ORDER BY id",
            (screen_id,),
        ).fetchall()
    return [_hydrate_annotation(r) for r in rows]  # type: ignore[misc]


def get_annotation(ann_id: int) -> dict | None:
    row = get_conn().execute(
        "SELECT * FROM annotations WHERE id=?", (ann_id,)
    ).fetchone()
    return _hydrate_annotation(row)


def create_annotation(
    *,
    screen_id: int,
    kind: str,
    text: str = "",
    x_norm: float = 0.5,
    y_norm: float = 0.5,
    tags: list[str] | None = None,
    capture_id: int | None = None,
    capture_crop: dict | None = None,
    bubble_offset_x: float = 0.0,
    bubble_offset_y: float = 0.0,
) -> dict:
    with tx() as conn:
        cur = conn.execute(
            "INSERT INTO annotations(screen_id, kind, text, x_norm, y_norm, tags, "
            "capture_id, capture_crop, bubble_offset_x, bubble_offset_y, updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                screen_id,
                kind,
                text,
                x_norm,
                y_norm,
                json.dumps(tags or []),
                capture_id,
                json.dumps(capture_crop) if capture_crop else None,
                bubble_offset_x,
                bubble_offset_y,
                _now_iso(),
            ),
        )
        aid = cur.lastrowid
    return get_annotation(aid)  # type: ignore[return-value]


def update_annotation(ann_id: int, **fields: Any) -> dict | None:
    allowed = {
        "kind",
        "text",
        "x_norm",
        "y_norm",
        "tags",
        "capture_id",
        "capture_crop",
        "bubble_offset_x",
        "bubble_offset_y",
    }
    payload: dict[str, Any] = {}
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k == "tags":
            payload[k] = json.dumps(v or [])
        elif k == "capture_crop":
            payload[k] = json.dumps(v) if v is not None else None
        else:
            payload[k] = v
    if not payload:
        return get_annotation(ann_id)
    payload["updated_at"] = _now_iso()
    with tx() as conn:
        cols = ", ".join(f"{k}=?" for k in payload)
        conn.execute(
            f"UPDATE annotations SET {cols} WHERE id=?",
            (*payload.values(), ann_id),
        )
    return get_annotation(ann_id)


def delete_annotation(ann_id: int) -> None:
    with tx() as conn:
        conn.execute("DELETE FROM annotations WHERE id=?", (ann_id,))


# ---------- Annotation kinds (user-configurable) ----------

ANNOTATION_TYPES_KEY = "annotation_types"

# Preserved defaults for existing maps (any screens or annotations → seed full list).
_LEGACY_ANNOTATION_TYPES: list[dict[str, str]] = [
    {"id": "gravestone", "label": "Gravestone", "color": "#bdb39e"},
    {"id": "skeleton", "label": "Skeleton", "color": "#e6e6e6"},
    {"id": "visual_hint", "label": "Visual hint", "color": "#ffd166"},
    {"id": "quest_gate", "label": "Quest gate", "color": "#ef476f"},
    {"id": "note", "label": "Note", "color": "#06d6a0"},
]

_FRESH_ANNOTATION_TYPES: list[dict[str, str]] = [
    {"id": "visual_hint", "label": "Visual hint", "color": "#ffd166"},
    {"id": "note", "label": "Note", "color": "#06d6a0"},
]


def _annotation_type_counts() -> tuple[int, int]:
    conn = get_conn()
    screens_n = int(
        conn.execute("SELECT COUNT(*) AS n FROM screens").fetchone()["n"] or 0
    )
    ann_n = int(
        conn.execute("SELECT COUNT(*) AS n FROM annotations").fetchone()["n"] or 0
    )
    return screens_n, ann_n


def ensure_annotation_types_seeded() -> None:
    """One-time migration: empty DB → two default types; existing data → legacy five."""
    if get_setting(ANNOTATION_TYPES_KEY) is not None:
        return
    screens_n, ann_n = _annotation_type_counts()
    types = (
        _LEGACY_ANNOTATION_TYPES
        if (screens_n > 0 or ann_n > 0)
        else _FRESH_ANNOTATION_TYPES
    )
    set_setting(ANNOTATION_TYPES_KEY, json.dumps(types))


def _normalize_declared_rows(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return list(_LEGACY_ANNOTATION_TYPES)
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    hex_color = re.compile(r"^#[0-9a-fA-F]{6}$")
    ident = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
    for item in raw:
        if not isinstance(item, dict):
            continue
        tid = str(item.get("id", "")).strip()
        label = str(item.get("label", "")).strip()
        color = str(item.get("color", "")).strip()
        if not tid or not label:
            continue
        if tid in seen:
            continue
        if not ident.match(tid):
            continue
        if not hex_color.match(color):
            color = "#888888"
        seen.add(tid)
        out.append({"id": tid, "label": label, "color": color})
    return out if out else list(_FRESH_ANNOTATION_TYPES)


def load_declared_annotation_types() -> list[dict[str, str]]:
    ensure_annotation_types_seeded()
    raw_s = get_setting(ANNOTATION_TYPES_KEY, "[]")
    try:
        data = json.loads(raw_s)
    except Exception:
        data = []
    return _normalize_declared_rows(data)


def set_declared_annotation_types(types: list[dict[str, str]]) -> None:
    normalized = _normalize_declared_rows(types)
    if not normalized:
        normalized = list(_FRESH_ANNOTATION_TYPES)
    set_setting(ANNOTATION_TYPES_KEY, json.dumps(normalized))


def annotation_count_for_kind(kind: str) -> int:
    row = get_conn().execute(
        "SELECT COUNT(*) AS n FROM annotations WHERE kind=?", (kind,)
    ).fetchone()
    return int(row["n"] if row else 0)


def get_annotation_types_for_map() -> list[dict[str, str]]:
    """Declared types plus synthetic entries for any annotation kinds not in settings."""
    base = load_declared_annotation_types()
    ids = {t["id"] for t in base}
    conn = get_conn()
    for row in conn.execute("SELECT DISTINCT kind FROM annotations").fetchall():
        k = str(row["kind"] or "")
        if k and k not in ids:
            ids.add(k)
            base.append(
                {
                    "id": k,
                    "label": k.replace("_", " ").strip().title() or k,
                    "color": "#9aa3af",
                    "synthetic": True,
                }
            )
    return base


def declared_annotation_type_ids() -> set[str]:
    return {t["id"] for t in load_declared_annotation_types()}
