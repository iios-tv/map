# iiosMap

Local map - hotkey capture, a grid map, and annotations. Data stays on your PC (SQLite + images). Currently **Windows only**.

## Requirements
- **Python 3.11+** https://www.python.org/downloads/
- **Node.js 18+** https://nodejs.org/en/download

## Run the project

- From the **repository root** double-click **`Run-iiosMap.bat`** or run `.\Run-iiosMap.ps1` in powershell

That creates/updates `.venv`, installs the backend, runs `npm install` + `npm run build` in `frontend`, then starts the server. Open **http://127.0.0.1:8765/** when it is ready (your browser may open automatically after a moment). With your targeted app running, press **Ctrl+Alt+S** to capture.

![screenshot2](screenshot2.png?raw=true)
