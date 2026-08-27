#!/bin/bash
# Orchestrates everything the container needs: a virtual display, Chrome
# (logged in once via noVNC, then persists via the mounted volume), noVNC
# itself (so the one-time login is reachable from any browser), and cron
# running the 3 scraper scripts on the same 08:50/12:50/17:50 schedule the
# Windows Task Scheduler used to run.
set -e

mkdir -p "$CHROME_PROFILE_DIR"

# Cron jobs don't inherit this process's environment — dump it to a file the
# cron job sources first. (This is the #1 reason "it works when I run it by
# hand but not on the schedule" happens with cron; the local machine's
# equivalent bug was the Task Scheduler path-encoding issue instead.)
#
# Values must be shell-quoted (printf %q) before being written as
# `export NAME=value` — GOOGLE_SERVICE_ACCOUNT_KEY is a JSON blob full of
# `{`, `"`, `:`, spaces; written unquoted, re-sourcing it word-splits on
# whitespace and `export` silently keeps only the first token, truncating
# the value mid-string. Confirmed live: sync_to_db.js's JSON.parse failed
# right at the tail of the key ("...universe_domain" cut off) until this
# was quoted properly.
: > /app/env.sh
while IFS='=' read -r -d '' name value; do
  case "$name" in
    ''|*[!A-Za-z0-9_]*) continue ;;
  esac
  printf 'export %s=%q\n' "$name" "$value" >> /app/env.sh
done < <(env -0)
chmod 600 /app/env.sh

echo "[entrypoint] Starting Xvfb on :99 ..."
Xvfb :99 -screen 0 1280x800x24 &
export DISPLAY=:99
sleep 2

echo "[entrypoint] Starting x11vnc ..."
if [ -n "$VNC_PASSWORD" ]; then
  x11vnc -display :99 -forever -shared -passwd "$VNC_PASSWORD" -rfbport 5900 -o /var/log/x11vnc.log &
else
  echo "[entrypoint] WARNING: VNC_PASSWORD not set — noVNC will be reachable with no password. Set it in Railway variables."
  x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -o /var/log/x11vnc.log &
fi
sleep 2

echo "[entrypoint] Starting noVNC on port ${PORT:-8080} ..."
websockify --web=/usr/share/novnc/ "${PORT:-8080}" localhost:5900 &

echo "[entrypoint] Starting Chrome (remote debugging :9222) ..."
google-chrome \
  --remote-debugging-port=9222 \
  --remote-allow-origins=* \
  --user-data-dir="$CHROME_PROFILE_DIR" \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --window-position=0,0 \
  --window-size=1280,800 \
  about:blank &

echo "[entrypoint] Installing crontab ..."
crontab /app/crontab
cron -f &

echo "[entrypoint] Ready. Open the Railway public URL to do the one-time login via noVNC."
wait
