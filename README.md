# iiosMap

Local map - hotkey capture, a grid map, and annotations. Data stays on your PC (SQLite + images). Currently **Windows only**.

## Requirements
- **Python 3.11+** — always ([download](https://www.python.org/downloads/))
- **Node.js** — optional. The prebuilt web UI in `frontend/dist/` is committed and refreshed by CI, so neither the [Release](#download-no-nodejs-required) zip nor a fresh clone needs Node to run. Install Node.js 18+ ([download](https://nodejs.org/en/download)) only if you want to rebuild the frontend yourself.

## Run the project

- From the **repository root** double-click **`Run-iiosMap.bat`** or run `.\Run-iiosMap.ps1` in powershell

That creates/updates `.venv`, installs the backend, and starts the server. If Node.js / npm is installed it will also refresh the frontend bundle; otherwise it uses the committed `frontend/dist/`. Open **http://127.0.0.1:8765/** when it is ready (your browser may open automatically after a moment). With your targeted app running, press **Ctrl+Alt+S** to capture.

![screenshot2](screenshot2.png?raw=true)

## Download (no Node.js required)

Releases include a **prebuilt** zip: static UI is already in `app/frontend/dist/`, so you only need **Python 3.11+** on Windows.

1. Open [**Releases**](https://github.com/iios-tv/map/releases) and download `iiosMap-portable-v*.zip` for the version you want.
2. Unzip, then in that folder run `setup-venv.ps1` once, then `Start-iiosMap.ps1` (see [packaging/README_PORTABLE.md](packaging/README_PORTABLE.md)).

Maintainers: push a version tag (e.g. `git tag v0.1.0 && git push origin v0.1.0`) and GitHub Actions builds and attaches the zip to that release.

## Build from source (clone)

The clone path also works without Node, because `frontend/dist/` is committed and kept current by `.github/workflows/build-frontend.yml`. Install Node.js 18+ only if you plan to edit the frontend — `Run-iiosMap.ps1` will then run `npm install` / `npm run build` to refresh the bundle.
