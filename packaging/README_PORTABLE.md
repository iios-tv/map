# iiosMap (packaging scripts)

These scripts support **two** layouts:

1. **Portable ZIP** — produced by `scripts/build-portable.ps1` at `dist/iiosMap-portable/`. Contains `wheels/`, `app/frontend/dist/`, and these `.ps1` files.
2. **Git clone** — run `setup-venv.ps1` from `packaging/` inside the repo; it installs the backend from `../backend` in editable mode (no `wheels/` folder needed). Build the frontend once: `cd ../frontend && npm install && npm run build`.

## First-time setup (Windows)

1. Install [Python 3.11+](https://www.python.org/downloads/) and ensure **Add python.exe to PATH** is enabled (or use the `py` launcher).
2. Install [Node.js 18+](https://nodejs.org/) (needed once to build the web UI).
3. From the **repository root** (the folder that contains `frontend` and `packaging`), build the web UI once:
   ```powershell
   cd frontend
   npm install
   npm run build
   cd ..
   ```
4. Open PowerShell **in the `packaging` folder** (Shift+Right-click - Open in Terminal).
5. Run:

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   .\setup-venv.ps1
   ```

   This creates `.venv\` and installs **iiosmap** (from `wheels\` in the portable bundle, or `pip install -e ..\backend` when run from a full clone).

## Run

```powershell
.\Start-iiosMap.ps1
```

Then open [http://127.0.0.1:8765/](http://127.0.0.1:8765/) in your browser.

- **Data** is stored under `%LOCALAPPDATA%\iiosMap\` by default (SQLite + images).
- To override, set `IIOSMAP_DATA_DIR` before starting (e.g. in PowerShell:
  `$env:IIOSMAP_DATA_DIR = "D:\iiosMap-data"`).

## La-Mulana

With the game running, press **Ctrl+Alt+S** (default) to capture the `La.MuLANA` window.

## Troubleshooting

- **Port in use**: set `$env:IIOSMAP_PORT = "8766"` then run `Start-iiosMap.ps1` again.
- **Frontend missing (git clone)**: run `npm install` and `npm run build` in `..\frontend` so `..\frontend\dist` exists.
- **Frontend missing (portable zip)**: ensure `app\frontend\dist\` exists (rebuild the portable zip from source if needed).
