# iiosMap

Local map - hotkey capture, a grid map, and annotations. Data stays on your PC (SQLite + images). Currently **Windows only**.

## Run the project

You need **Python 3.11+** and **Node.js 18+**.

**One command (recommended):** from the **repository root** in PowerShell, run:

```powershell
.\Run-iiosMap.ps1
```

Or double-click **`Run-iiosMap.bat`** (uses the same script; no need to change execution policy).

That creates/updates `.venv`, installs the backend, runs `npm install` + `npm run build` in `frontend`, then starts the server. Open **http://127.0.0.1:8765/** when it is ready (your browser may open automatically after a moment). With La-Mulana running, press **Ctrl+Alt+S** to capture.
