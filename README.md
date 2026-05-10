# iiosMap

A local-only web app for building your own interactive map of
[La-Mulana](https://en.wikipedia.org/wiki/La-Mulana) (the 2005/2006 freeware
PC original) from your own gameplay screenshots. A global Windows hotkey grabs
the `La.MuLANA` window, auto-crops the VIT/EXP HUD, and drops the screenshot
into a "pending" tray; you then arrange the screens on a pan/zoom grid map,
annotate them (gravestones, skeletons, visual hints, quest gates, notes), and
optionally combine multiple captures of an over-tall room into one big tile.

Everything is stored locally (SQLite + PNGs). Nothing leaves your machine.
During development from a git checkout, data defaults to `./data/`. When the
app is installed from a wheel without a dev tree, data defaults to
`%LOCALAPPDATA%\iiosMap\` on Windows unless you set `IIOSMAP_DATA_DIR`.

Upstream repository: [github.com/iios-tv/map](https://github.com/iios-tv/map).

## Features

- Global hotkey (default `Ctrl+Alt+S`) captures the La.MuLANA client area
  via `PrintWindow` (works even if the game is unfocused or partially
  occluded).
- Configurable HUD top-crop (default `40px`) so the VIT/EXP bar is never in
  your map.
- Multi-layer grid map (e.g. "Surface", "Guidance Gate", "Mausoleum"); each
  screen occupies a cell, multi-cell tiles supported for tall/wide rooms.
- Drag-to-place from the pending tray, plus `N/S/E/W` placement buttons
  relative to a selected anchor for keyboard-friendly traversal.
- Per-screen annotations with kinds (gravestone, skeleton, visual hint,
  quest gate, note), free-form tags (e.g. `swim`, `heat`), and click-to-place
  pin position on the tile.
- Sub-region crop tool — useful for pulling just a sign or gravestone out of
  a screenshot.
- Composite editor — overlay 2+ captures with an opacity slider and per-image
  drag/arrow-key alignment, saved as a single multi-cell tile.
- Live updates over WebSocket without clobbering in-progress edits.

## Requirements

- Windows (the capture path uses Win32 `PrintWindow`).
- Python 3.11+
- Node.js 18+ (for building the frontend from source)

## One-time setup

From the repo root, in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .\backend

cd frontend
npm install
npm run build
cd ..
```

This installs the **`iiosmap`** package in editable mode and pulls every dependency
listed in [`backend/pyproject.toml`](backend/pyproject.toml). Re-run `pip install -e`
after `pyproject.toml` changes.

## Running

```powershell
.\.venv\Scripts\Activate.ps1
python -m iiosmap
```

Then open <http://127.0.0.1:8765/> in any browser. With La-Mulana running,
press `Ctrl+Alt+S` to capture; new screens appear in the bottom tray.

Environment variables (optional): `IIOSMAP_DATA_DIR`, `IIOSMAP_APP_ROOT` (bundle
root containing `frontend/dist`), `IIOSMAP_HOST`, `IIOSMAP_PORT`. Legacy
`LAMULANA_*` names still work for data dir, host, and port.

### Development mode (frontend hot reload)

```powershell
# terminal 1
.\.venv\Scripts\Activate.ps1
python -m iiosmap

# terminal 2
cd frontend
npm run dev
```

Then visit <http://localhost:5173/>. The Vite dev server proxies `/api`,
`/images`, `/composites`, and `/ws` to the backend on `127.0.0.1:8765`.

For Vite, set `IIOSMAP_BACKEND` (or legacy `LAMULANA_BACKEND`) if the API is not
on the default URL.

## Portable distribution zip

From the repo root:

```powershell
.\scripts\build-portable.ps1
```

This builds the frontend, builds a Python wheel, and assembles `dist/iiosMap-portable/`
with `app/frontend/dist/`, `wheels/`, launcher scripts, and
[`packaging/README_PORTABLE.md`](packaging/README_PORTABLE.md). End users run
`setup-venv.ps1` once, then `Start-iiosMap.ps1`.

## Workflows

### Quick burst capture

1. Play. Hit `Ctrl+Alt+S` whenever you scroll into a new screen.
2. Switch to the browser later and arrange the pending tray onto the map by
   dragging thumbnails onto the canvas (it will snap to the nearest grid cell
   on the active layer).

### Patient one-room-at-a-time

1. Capture a screen, drag it onto the map, label it.
2. Add annotations (e.g., a gravestone with text and a placed pin).
3. Capture the next screen; click your existing tile on the map to make it
   the anchor, pick the new pending screen in the right-side panel, and click
   `N`/`S`/`E`/`W`.

### Tall / wide rooms

1. Take screenshots of the whole room as you scroll through it.
2. Click `Combine rooms…` in the top bar, then click each pending capture you
   want to merge.
3. Click `Open editor`, drag the active layer (or use arrow keys; hold Shift
   for ×10) to align overlapping pixels using the opacity slider.
4. Save — the backend renders one merged PNG and the new tile occupies the
   appropriate number of grid cells.

### Sub-cropping (e.g., just a gravestone)

1. Select the screen, click `Crop / sub-region…`.
2. Drag a rectangle on the source image. Save. The map tile renders only that
   region.

## Map controls

- Mouse wheel: zoom toward cursor
- Middle-mouse drag (or hold `Space` and left-drag): pan
- Drag a placed tile: move on grid (snaps)
- Drag a pending thumbnail onto the canvas: place at drop location
- Click any tile: select (right panel)

## Settings

Open from the top bar. You can change:

- `display_top_crop_px` / `display_bottom_crop_px` /
  `display_left_crop_px` / `display_right_crop_px` — per-edge pixels hidden
  from the canvas only. Captures are saved at full client-area size; these
  values control which pixels are masked at render time, so changing them
  takes effect immediately on every existing screen without re-capturing.
  Defaults are tuned for the 1024×768 window with the VIT/EXP HUD masked at
  the top (see `backend/src/iiosmap/config.py`).
- `hotkey` — re-registered on save (e.g., `ctrl+shift+f12`).
- `grid_cell_w` / `grid_cell_h` — visual cell size on the map canvas.

## Data

In a dev checkout, data defaults to `data/` next to the repository:

- `data/db.sqlite` — all metadata (layers, screens, annotations, composites,
  settings).
- `data/images/*.png` — raw cropped captures.
- `data/composites/*.png` — merged composite tiles.

For a shipped wheel without the dev tree, the default directory is
`%LOCALAPPDATA%\iiosMap\` (override with `IIOSMAP_DATA_DIR`). To back up your map,
use **Settings → Export backup (ZIP)** or copy the data folder.

## Project layout

```
backend/
  pyproject.toml
  src/iiosmap/
    __main__.py       # entrypoint -> uvicorn
    app.py            # FastAPI app + lifespan + static + WS
    capture.py        # Win32 PrintWindow + HUD / left crop
    hotkey.py         # global hotkey registration
    db.py             # SQLite schema + helpers
    ws.py             # WebSocket connection manager
    routes/
      captures.py screens.py annotations.py layers.py composites.py settings.py
frontend/
  src/
    main.tsx App.tsx api.ts ws.ts store.ts types.ts styles.css
    components/
      MapCanvas.tsx ScreenTile.tsx PendingTray.tsx
      LayerPicker.tsx DetailPanel.tsx
      CropTool.tsx CompositeEditor.tsx SettingsModal.tsx
data/                 # dev checkout: created on first run
```

## Known caveats

- The `keyboard` package can need elevated permissions to register hotkeys
  while certain admin-elevated games are focused. La-Mulana itself is not
  elevated, so the default install is fine.
- Capture uses the window **client** DC (`GetDC`); pairing it with
  `GetWindowDC` and client-sized bitmaps used to clip ~10px off the bottom — fixed.
- HUD and left crop defaults are calibrated for the 1024×768 window; tweak both
  in Settings if your layout differs.
