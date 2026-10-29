#!/bin/bash
#
# Bring the live site up to date with main, and restart it.
#
# On the Mac Mini: double-click this file, or run ./DEPLOY.command
# It pulls, installs, migrates, builds, and restarts the server on port 3000.
#
# Your database is never touched beyond `npm run migrate`, which only adds
# tables and columns that do not exist yet. Shows and tips are left alone.

set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
PORT=3000
LOG="$ROOT/web/server.log"

say() { printf '\n==> %s\n' "$1"; }

# ---------------------------------------------------------------- 1. the code
if [ ! -d .git ]; then
  cat <<'NOTE'

This folder is not a git clone, so there is nothing to pull into it. It was
most likely unzipped from a GitHub download — those arrive named
"SpiritProductions_Tips-main" and carry no history.

Clone it properly once, and every later update is just this script:

    cd ~
    git clone https://github.com/DebopriyoRoy/SpiritProductions_Tips.git
    cp "OLD_FOLDER/web/.env.local" SpiritProductions_Tips/web/.env.local
    cd SpiritProductions_Tips && ./DEPLOY.command

Replace OLD_FOLDER with this folder. Copying .env.local carries your database
settings across; without it the new copy cannot connect.

NOTE
  exit 1
fi

say "Fetching main"
git pull origin main

say "Now at"
git log --oneline -1

# ------------------------------------------------------------- 2. the build
cd web

if [ ! -f .env.local ]; then
  echo "No web/.env.local — the app has no database to connect to. Stopping." >&2
  exit 1
fi

say "Installing dependencies"
npm install

say "Applying any new tables or columns"
npm run migrate

say "Building"
rm -rf .next
npm run build

# ----------------------------------------------------------- 3. the restart
# Only whatever is listening on this port, so an unrelated node process on
# this Mac is left alone.
say "Stopping the old server"
if PIDS="$(lsof -ti tcp:"$PORT" 2>/dev/null)" && [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill
  sleep 2
  # Still there? It is wedged; end it rather than leave the port taken.
  if PIDS="$(lsof -ti tcp:"$PORT" 2>/dev/null)" && [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill -9
    sleep 1
  fi
else
  echo "Nothing was running on port $PORT."
fi

say "Starting"
nohup npm start > "$LOG" 2>&1 &
sleep 6

if curl -fsS -o /dev/null --max-time 20 "http://127.0.0.1:$PORT/"; then
  say "Live. The site is serving the version above."
  echo "Log: $LOG"
  echo
  echo "Reload the page in your browser with Cmd+Shift+R — the old CSS and"
  echo "JavaScript are cached and a plain refresh can keep showing them."
else
  say "The server did not answer on port $PORT."
  echo "The last lines of the log:"
  tail -30 "$LOG" || true
  exit 1
fi
