#!/bin/sh
set -e

GIT_REPO="${GIT_REPO:-https://github.com/sshsrv/sharkai.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"
POLL_SECONDS="${POLL_SECONDS:-60}"
DATA_DIR="${DATA_DIR:-/app/data}"

echo "[sharkai] data=$DATA_DIR poll=${POLL_SECONDS}s branch=$GIT_BRANCH"

# El repo vive en el volumen sharkai-code (montado en /app).
# Si no hay .git: el volumen está vacío → clonar el repo sobre /app.
if [ ! -d /app/.git ]; then
  echo "[sharkai] /app vacío — clonando $GIT_REPO..."
  rm -rf /tmp/sharkai-clone
  git clone --depth 1 -b "$GIT_BRANCH" "$GIT_REPO" /tmp/sharkai-clone
  rm -rf /app/* /app/.[!.]* 2>/dev/null || true
  cp -a /tmp/sharkai-clone/. /app/
  rm -rf /tmp/sharkai-clone
fi

cd /app

last_head=""
BOT_PID=""

start_bot() {
  echo "[sharkai] npm install + build..."
  npm install --omit=dev >/dev/null 2>&1 || true
  npm run build || true
  echo "[sharkai] Arrancando node dist/index.js"
  node dist/index.js &
  BOT_PID=$!
  last_head=$(git rev-parse HEAD)
  echo "[sharkai] Bot PID=$BOT_PID (commit $last_head)"
}

stop_bot() {
  if [ -n "$BOT_PID" ] && kill -0 "$BOT_PID" 2>/dev/null; then
    echo "[sharkai] Deteniendo bot ($BOT_PID)..."
    kill "$BOT_PID"
    wait "$BOT_PID" 2>/dev/null || true
  fi
}

start_bot
trap stop_bot INT TERM

# Watcher de auto-update: pull cada POLL_SECONDS y reinicio si hay cambios
while true; do
  sleep "$POLL_SECONDS"
  cd /app
  git fetch origin "$GIT_BRANCH" >/dev/null 2>&1 || continue
  remote_head=$(git rev-parse origin/"$GIT_BRANCH" 2>/dev/null) || continue
  if [ -n "$remote_head" ] && [ "$remote_head" != "$last_head" ]; then
    echo "[sharkai] Nuevo commit detectado ($remote_head). Actualizando..."
    git reset --hard origin/"$GIT_BRANCH"
    stop_bot
    start_bot
  fi
done