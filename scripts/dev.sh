#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d --wait db
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --app-dir backend --reload --reload-dir backend --host 127.0.0.1 --port 8017 &
OCHEN_BACKEND_PID=$!
trap 'kill "$OCHEN_BACKEND_PID" 2>/dev/null || true' EXIT INT TERM
npm --prefix frontend run dev
