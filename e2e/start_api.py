"""Starts an ISOLATED CareHub API for end-to-end tests: fresh store, demo seed, port 8090."""
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
STORE = ROOT / "e2e" / ".data" / "e2e-store.json"
STORE.parent.mkdir(parents=True, exist_ok=True)
if STORE.exists():
    STORE.unlink()

env = {**os.environ, "ENVIRONMENT": "development", "MEMORY_STORE_PATH": str(STORE), "RUN_SCHEDULER_IN_PROCESS": "false",
       "AUTH_RATE_LIMIT": "500", "LOCAL_FILE_DIR": str(STORE.parent / "files")}
py = sys.executable
subprocess.run([py, "-m", "scripts.seed_demo"], cwd=BACKEND, env=env, check=True)
os.execve(py, [py, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8090"], {**env, "PYTHONPATH": str(BACKEND)}) \
    if os.name != "nt" else sys.exit(subprocess.call([py, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8090"],
                                                      cwd=BACKEND, env=env))
