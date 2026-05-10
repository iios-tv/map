from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .hotkey import service as hotkey_service
from .routes import (
    annotation_types,
    annotations,
    backup,
    captures,
    composites,
    layers,
    screens,
    settings,
    windows_route,
)
from .ws import manager as ws_manager


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    db.init()
    ws_manager.attach_loop(asyncio.get_running_loop())
    hotkey_service.start()
    try:
        yield
    finally:
        hotkey_service.stop()


def create_app() -> FastAPI:
    app = FastAPI(title="iiosMap", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    api = FastAPI(title="La-Mulana Map API")
    api.include_router(backup.router)
    api.include_router(captures.router)
    api.include_router(screens.router)
    api.include_router(annotation_types.router)
    api.include_router(annotations.router)
    api.include_router(layers.router)
    api.include_router(composites.router)
    api.include_router(settings.router)
    api.include_router(windows_route.router)

    @api.get("/health")
    def health() -> dict:
        return {"ok": True}

    app.mount("/api", api)

    config.ensure_dirs()
    app.mount(
        "/images",
        StaticFiles(directory=str(config.IMAGES_DIR), check_dir=False),
        name="images",
    )
    app.mount(
        "/composites",
        StaticFiles(directory=str(config.COMPOSITES_DIR), check_dir=False),
        name="composites",
    )

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket) -> None:
        await ws_manager.connect(websocket)
        try:
            while True:
                # We don't currently expect client->server messages, but we
                # need to await something to keep the connection open.
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await ws_manager.disconnect(websocket)

    if config.FRONTEND_DIST.exists():
        app.mount(
            "/assets",
            StaticFiles(directory=str(config.FRONTEND_DIST / "assets"), check_dir=False),
            name="assets",
        )

        @app.get("/{full_path:path}")
        async def spa_fallback(full_path: str):
            index = config.FRONTEND_DIST / "index.html"
            if not index.exists():
                return JSONResponse(
                    {
                        "detail": (
                            "frontend not built. From the repo root: "
                            "`cd frontend && npm install && npm run build` "
                            "(creates frontend/dist). Or run `npm run dev` in frontend "
                            "and use the Vite URL for development."
                        ),
                    },
                    status_code=503,
                )
            return FileResponse(index)
    else:
        @app.get("/")
        async def root() -> dict:
            return {
                "ok": True,
                "message": (
                    "iiosMap backend is running, but there is no built UI yet. "
                    f"Expected bundle at {config.FRONTEND_DIST}. "
                    "From the repository root run: "
                    "`cd frontend` then `npm install` then `npm run build`. "
                    "Alternatively, for hot reload, use two terminals: "
                    "`python -m iiosmap` and `npm run dev` in frontend (see README)."
                ),
            }

    return app


app = create_app()
