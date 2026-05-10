# iiosMap (portable zip)

This folder is produced by `scripts/build-portable.ps1` in the source repository.

## First-time setup (Windows)

1. Install [Python 3.11+](https://www.python.org/downloads/) and ensure **Add python.exe to PATH** is enabled (or use the `py` launcher).
2. Open PowerShell **in this folder** (Shift+Right-click → Open in Terminal).
3. Run:

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   .\setup-venv.ps1
   ```

   This creates `.venv\` and installs the `iiosmap` wheel from `wheels\`.

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
- **Frontend missing**: ensure `app\frontend\dist\` exists inside this folder (rebuild the portable zip from source if needed).
