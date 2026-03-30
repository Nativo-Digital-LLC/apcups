#!/bin/sh
set -e

echo "[entrypoint] Starting Mira..."

# ── Start Node backend ────────────────────────────────────────────────────────
cd /app/backend
node dist/index.js &
BACKEND_PID=$!
echo "[entrypoint] Backend started (PID $BACKEND_PID)"

# ── Give the backend a moment to initialize ───────────────────────────────────
sleep 1

# ── Start Nginx in foreground ─────────────────────────────────────────────────
echo "[entrypoint] Starting Nginx..."
exec nginx -g "daemon off;"
