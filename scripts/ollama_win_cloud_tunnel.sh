#!/usr/bin/env bash
set -euo pipefail

WINDOWS_HOST="${WINDOWS_HOST:-win}"
LOCAL_PORT="${OLLAMA_TUNNEL_PORT:-11435}"
REMOTE_PORT="${OLLAMA_REMOTE_PORT:-11434}"

ssh "$WINDOWS_HOST" "powershell -NoProfile -Command \"\
\$ErrorActionPreference='Stop'; \
\$uri='http://127.0.0.1:${REMOTE_PORT}/api/version'; \
try { Invoke-RestMethod \$uri | Out-Null } catch { \
  \$exe=Join-Path \$env:LOCALAPPDATA 'Programs\\Ollama\\ollama.exe'; \
  Start-Process -FilePath \$exe -ArgumentList 'serve' -WindowStyle Hidden; \
  Start-Sleep -Seconds 4; \
  Invoke-RestMethod \$uri | Out-Null; \
}\""

exec ssh \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -N \
  -L "127.0.0.1:${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
  "$WINDOWS_HOST"
