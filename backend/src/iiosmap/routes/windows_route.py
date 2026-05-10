"""List top-level targets for capture (Windows only)."""

from fastapi import APIRouter

from ..targeting import list_targetable_windows


router = APIRouter(prefix="/windows", tags=["windows"])


@router.get("")
def get_windows() -> list[dict]:
    return list_targetable_windows()
