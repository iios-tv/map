from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..ws import manager as ws


router = APIRouter(prefix="/annotation-types", tags=["annotation-types"])

_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class AnnotationTypeRow(BaseModel):
    id: str = ""
    label: str = Field(min_length=1, max_length=120)
    color: str = Field(min_length=1, max_length=32)


class AnnotationTypesPut(BaseModel):
    types: list[AnnotationTypeRow] = Field(min_length=1)


def _slug_id_from_label(label: str, avoid: set[str]) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    if not s:
        s = "type"
    if s[0].isdigit() or not s[0].isalpha():
        s = "t_" + s
    s = s[:64]
    if not _ID_RE.match(s):
        s = "type"
    cand = s
    n = 2
    while cand in avoid:
        suffix = f"_{n}"
        cand = (s[: max(1, 64 - len(suffix))] + suffix)[:64]
        n += 1
    return cand


def _normalize_color(color: str) -> str:
    c = color.strip()
    if _HEX.match(c):
        return c
    raise HTTPException(
        status_code=400,
        detail=f"invalid color {color!r}; use #RRGGBB",
    )


@router.put("")
async def put_annotation_types(body: AnnotationTypesPut) -> list[dict[str, str]]:
    current_declared = db.load_declared_annotation_types()
    cur_ids = {t["id"] for t in current_declared}

    explicit_ids = [r.id.strip() for r in body.types if r.id.strip()]
    if len(explicit_ids) != len(set(explicit_ids)):
        raise HTTPException(status_code=400, detail="duplicate type ids in request")
    planned_explicit = set(explicit_ids)

    taken: set[str] = set()
    normalized: list[dict[str, str]] = []
    for row in body.types:
        label = row.label.strip()
        if not label:
            raise HTTPException(status_code=400, detail="each type needs a non-empty label")
        tid = row.id.strip()
        if not tid:
            tid = _slug_id_from_label(label, taken | planned_explicit)
        else:
            if not _ID_RE.match(tid):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"invalid id {tid!r}; use lowercase letters, digits, "
                        "underscores, max 64 chars, start with a letter"
                    ),
                )
        if tid in taken:
            raise HTTPException(status_code=400, detail=f"duplicate type id {tid!r}")
        taken.add(tid)
        normalized.append(
            {"id": tid, "label": label, "color": _normalize_color(row.color)}
        )

    new_ids = {t["id"] for t in normalized}
    for rid in cur_ids - new_ids:
        n = db.annotation_count_for_kind(rid)
        if n > 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot remove annotation type {rid!r}: {n} annotation(s) "
                    "still use it. Reassign or delete those annotations first."
                ),
            )

    db.set_declared_annotation_types(normalized)
    merged = db.get_annotation_types_for_map()
    await ws.broadcast({"type": "annotation_types_updated", "annotation_types": merged})
    return merged
