# iiosMap

Local map - hotkey capture, a grid map, and annotations. Data stays on your PC (SQLite + images). Currently **Windows only**.

## Requirements
- **Python 3.11+** — always ([download](https://www.python.org/downloads/))
- **Node.js 18+** — only if you [build from source](#build-from-source-clone) or use `Run-iiosMap.ps1` / a git clone ([download](https://nodejs.org/en/download)). Not needed for [Release](#download-no-nodejs-required) zips.

## Run the project

- From the **repository root** double-click **`Run-iiosMap.bat`** or run `.\Run-iiosMap.ps1` in powershell

That creates/updates `.venv`, installs the backend, runs `npm install` + `npm run build` in `frontend`, then starts the server. Open **http://127.0.0.1:8765/** when it is ready (your browser may open automatically after a moment). With your targeted app running, press **Ctrl+Alt+S** to capture.

![screenshot2](screenshot2.png?raw=true)

## Download (no Node.js required)

Releases include a **prebuilt** zip: static UI is already in `app/frontend/dist/`, so you only need **Python 3.11+** on Windows.

1. Open [**Releases**](https://github.com/iios-tv/map/releases) and download `iiosMap-portable-v*.zip` for the version you want.
2. Unzip, then in that folder run `setup-venv.ps1` once, then `Start-iiosMap.ps1` (see [packaging/README_PORTABLE.md](packaging/README_PORTABLE.md)).

Maintainers: push a version tag (e.g. `git tag v0.1.0 && git push origin v0.1.0`) and GitHub Actions builds and attaches the zip to that release.

## Build from source (clone)

Same as "Run the project" above: needs **Node.js** so the script can run `npm install` / `npm run build`. Prefer **Releases** if you only want to run the app.
