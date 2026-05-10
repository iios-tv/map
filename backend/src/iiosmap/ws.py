from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket


logger = logging.getLogger(__name__)


class WSManager:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Remember the FastAPI event loop so background threads can broadcast."""
        self._loop = loop

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)
        logger.info("WS client connected (%d total)", len(self._clients))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)
        logger.info("WS client disconnected (%d total)", len(self._clients))

    async def broadcast(self, payload: dict[str, Any]) -> None:
        msg = json.dumps(payload, default=str)
        async with self._lock:
            stale: list[WebSocket] = []
            for ws in self._clients:
                try:
                    await ws.send_text(msg)
                except Exception as exc:  # pragma: no cover - defensive
                    logger.warning("WS send failed: %s", exc)
                    stale.append(ws)
            for ws in stale:
                self._clients.discard(ws)

    def broadcast_threadsafe(self, payload: dict[str, Any]) -> None:
        """Broadcast from a non-async context (e.g. the hotkey thread)."""
        if self._loop is None:
            logger.warning("WS broadcast attempted before loop attached: %s", payload)
            return
        asyncio.run_coroutine_threadsafe(self.broadcast(payload), self._loop)


manager = WSManager()
