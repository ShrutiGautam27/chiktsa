"""Vercel serverless entry point for the CareHub AI API (public DEMO deployment).

Vercel runs this file as a Python function and routes /api/* here (see vercel.json). The demo uses
the in-memory store seeded with sample households, so data resets whenever the instance restarts.
Real deployments use Cloud Run + Firestore + Firebase Auth (docs/DEPLOYMENT.md); the API refuses the
in-memory store when ENVIRONMENT=production.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

# Demo defaults (Vercel environment variables override these).
os.environ.setdefault("ENVIRONMENT", "demo")
os.environ.setdefault("DATA_STORE", "memory")
os.environ.setdefault("AUTH_PROVIDER", "local")
os.environ.setdefault("MEMORY_STORE_PATH", "/tmp/carehub-demo-store.json")
os.environ.setdefault("LOCAL_FILE_DIR", "/tmp/carehub-files")
os.environ.setdefault("RUN_SCHEDULER_IN_PROCESS", "false")
os.environ.setdefault("COOKIE_SECURE", "true")

from app.main import app  # noqa: E402,F401  (ASGI app picked up by Vercel)
