"""Global hotkey listener that invokes the capture pipeline."""
from __future__ import annotations

import logging
import threading
from dataclasses import asdict, is_dataclass

from . import capture, config, db
from .ws import manager as ws_manager


logger = logging.getLogger(__name__)


class HotkeyService:
    """Wraps the ``keyboard`` package to register/unregister a global hotkey.

    Re-registration is idempotent so the Settings UI can update the binding
    without requiring a server restart.
    """

    def __init__(self) -> None:
        self._handle: object | None = None
        self._binding: str | None = None
        self._lock = threading.Lock()
        self._kb = None  # lazy import

    def _import_keyboard(self):  # pragma: no cover - thin shim
        if self._kb is None:
            try:
                import keyboard  # type: ignore[import-not-found]
            except Exception as exc:
                raise RuntimeError(
                    "The 'keyboard' package is required for global hotkeys. "
                    "Install with `pip install keyboard`."
                ) from exc
            self._kb = keyboard
        return self._kb

    def start(self, binding: str | None = None) -> None:
        binding = binding or db.get_setting("hotkey", config.DEFAULT_HOTKEY)
        with self._lock:
            self._stop_locked()
            try:
                kb = self._import_keyboard()
            except RuntimeError as exc:
                logger.error("Hotkey unavailable: %s", exc)
                return
            try:
                self._handle = kb.add_hotkey(binding, self._on_trigger)
                self._binding = binding
                logger.info("Hotkey registered: %s", binding)
            except Exception as exc:
                logger.exception("Failed to register hotkey %r: %s", binding, exc)

    def stop(self) -> None:
        with self._lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        if self._handle is not None and self._kb is not None:
            try:
                self._kb.remove_hotkey(self._handle)
            except Exception:  # pragma: no cover - best effort
                logger.exception("Failed to unregister hotkey")
            self._handle = None
            self._binding = None

    def rebind(self, binding: str) -> None:
        self.start(binding)

    def _on_trigger(self) -> None:
        try:
            result = capture.capture_now()
        except Exception as exc:
            logger.exception("Capture failed: %s", exc)
            ws_manager.broadcast_threadsafe(
                {"type": "capture_failed", "error": str(exc)}
            )
            return
        payload = asdict(result) if is_dataclass(result) else dict(result)
        ws_manager.broadcast_threadsafe({"type": "capture_added", **payload})


service = HotkeyService()
