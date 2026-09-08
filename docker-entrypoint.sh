#!/bin/sh
set -e

GIT_REPO="${GIT_REPO:-https://github.com/sshsrv/sharkai.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"
POLL_SECONDS="${POLL_SECONDS:-60}"
DATA_DIR="${DATA_DIR:-/app/data}"

echo "[sharkai] Entorno: data=$DATA_DIR poll=${POLL_SECONDS}s branch=$GIT_BRANCH"

# Asegurar que /app contiene el repo clonado
if [ ! -d /app/.git ]; then
  echo "[sharkai] Clonando $GIT_REPO..."
  rm -rf /app.tmp
  git clone --depth 1 -b "$GIT_BRANCH" "$GIT_REPO" /app.tmp
  rm -rf /app/* /app/.[!.]* 2>/dev/null || true
  cp -a /app.tmp/. /app/
  rm -rf /app.tmp
fi

cd /app

# Función de build + arranque
last_head=""
start_bot() {
  echo "[sharkai] npm ci + build..."
  npm ci --omit=dev >/dev/null 2>&1 || npm install --omit=dev >/dev/null 2>&1 || true
  npm run build || true
  echo "[sharkai] Arrancando node dist/index.js"
  node dist/index.js > /proc/1/fd/1 2>&1 &
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

# Watcher de auto-update
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