#!/bin/bash
# Called by cron 3x/day — same sequence as the local run_scraper.bat:
# KPI portal -> raw_ontime source sheet -> Rillnet damage report.
#
# Shares this lock with run_ftl_scraper.sh — both scripts drive the same
# single Chrome instance (one CDP debug port), so overlapping runs race for
# control of the browser. See run_ftl_scraper.sh for the incident that
# motivated this.
#
# This runs only 3x/day (08:50/12:50/17:50) sitting right in the middle of
# FTL's every-30-min cycle (:00/:30) — a non-blocking `flock -n` meant that
# whenever FTL's own run happened to still be going at :50 (which does
# happen — vehicle enrichment alone can take several minutes), this whole
# script skipped outright and the data stayed stale for the full 4-hour gap
# until the next slot. Confirmed live 2026-08-23: raw_ontime sat 22+ hours
# stale from exactly this. `flock -w` waits for the lock instead of failing
# immediately — 1500s is comfortably longer than FTL's own worst-case
# runtime (its two steps are capped at 300s+900s=1200s by their own `timeout`
# wrappers below), so this only truly gives up if something is hung well
# beyond FTL's own timeout protection, not just running a bit long.
LOCK=/tmp/chrome_scraper.lock
exec 9>"$LOCK"
if ! flock -w 1500 9; then
  echo "[$(date)] run_scrapers.sh: doi 1500s nhung FTL van chua nha khoa (co the dang treo that su), bo qua lan nay." >> /data/scraper_log.txt
  exit 0
fi

source /app/env.sh
export DISPLAY=:99
cd /app

LOG=/data/scraper_log.txt
echo "[$(date)] Bat dau chay run_scrapers.sh" >> "$LOG"

# `timeout N` per step — outer safety net on top of each script's own CDP
# timeout, so this flock always releases within a bounded time even if
# something unexpected hangs. Same shared lock as run_ftl_scraper.sh, so a
# hang here would starve FTL just like the reverse incident (2026-08-20/21,
# see run_ftl_scraper.sh) starved this script for 2 days straight.
FAILED=0
RUN_STARTED=$(date -Iseconds)

# Restart Chrome (called when CDP connection fails).
# Chrome chay nen (background process) nen khi treo se khong tu restart.
restart_chrome() {
  echo "[$(date)] [heal] Dang tat Chrome..." >> "$LOG"
  pkill -f "google-chrome" 2>/dev/null || true
  sleep 8
  echo "[$(date)] [heal] Khoi dong lai Chrome..." >> "$LOG"
  google-chrome \
    --remote-debugging-port=9222 \
    --remote-allow-origins=* \
    --user-data-dir="${CHROME_PROFILE_DIR:-/data/chrome-profile}" \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --window-position=0,0 \
    --window-size=1280,800 \
    about:blank &
  sleep 10
  echo "[$(date)] [heal] Chrome da khoi dong lai." >> "$LOG"
}

# Each step's output is kept separately (and still appended to the main log)
# so report_health.py can classify it (ok / session expired / error) for the
# dashboard's "Trạng thái hệ thống" page.
# For CDP-based scripts (sheet_scraper, kpi_scraper): if it fails with a
# Chrome/WebSocket error, restart Chrome and retry once automatically.
is_chrome_error() {
  grep -qE "WebSocketTimeoutException|WebSocketConnectionClosedException|Khong ket noi duoc Chrome|Connection timed out|ConnectionRefusedError.*9222" "$1"
}
run_step() {
  local name="$1" script="$2"
  timeout 600 python3 "$script" > "/tmp/step_${name}.log" 2>&1
  local code=$?
  cat "/tmp/step_${name}.log" >> "$LOG"
  echo "$code" > "/tmp/step_${name}.code"
  if [ "$code" -ne 0 ] && is_chrome_error "/tmp/step_${name}.log"; then
    echo "[$(date)] [heal] $script gap loi Chrome - restart Chrome va thu lai lan 2..." >> "$LOG"
    restart_chrome
    timeout 600 python3 "$script" > "/tmp/step_${name}.log" 2>&1
    code=$?
    cat "/tmp/step_${name}.log" >> "$LOG"
    echo "$code" > "/tmp/step_${name}.code"
    echo "[$(date)] [heal] Lan 2 ket qua: exit $code" >> "$LOG"
  fi
  [ "$code" -eq 0 ] || FAILED=1
}
run_step kpi kpi_scraper.py
run_step raw_ontime sheet_scraper.py
run_step rillnet rillnet_scraper.py

# Rebuild the dashboard's LTL snapshot (Vercel Blob) right away so the new
# raw_ontime / damage data shows up now instead of at the next Vercel cron.
# Runs even if a step failed — whatever did sync should still be published.
if [ -n "$SNAPSHOT_SECRET" ]; then
  echo "[$(date)] Rebuild snapshot dashboard..." >> "$LOG"
  curl -s -m 120 -H "x-snapshot-secret: ${SNAPSHOT_SECRET}" -H "x-caller: railway" \
    "https://logicore-app.vercel.app/api/cron/build-snapshot" >> "$LOG" 2>&1 || echo "  (goi build-snapshot that bai)" >> "$LOG"
  echo "" >> "$LOG"
fi

if [ -n "$SNAPSHOT_SECRET" ]; then
  python3 report_health.py "$RUN_STARTED" >> "$LOG" 2>&1 || echo "  (gui heartbeat that bai)" >> "$LOG"
fi

if [ "$FAILED" -eq 0 ]; then
  echo "[$(date)] Hoan tat run_scrapers.sh (OK)" >> "$LOG"
else
  echo "[$(date)] Hoan tat run_scrapers.sh (CO LOI - xem log phia tren)" >> "$LOG"
fi
echo "" >> "$LOG"

# Optional: ping a Telegram bot when any of the 3 scripts exits non-zero, so
# a broken run doesn't sit silent for half a day like the Windows Task
# Scheduler incident did. Only fires if both vars are set.
if [ "$FAILED" -eq 1 ] && [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    -d text="⚠️ SD3 scraper: 1 trong 3 script loi luc $(date). Check /data/scraper_log.txt tren Railway." > /dev/null || true
fi

exit "$FAILED"
