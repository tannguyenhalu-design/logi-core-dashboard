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
timeout 600 python3 kpi_scraper.py >> "$LOG" 2>&1 || FAILED=1
timeout 600 python3 sheet_scraper.py >> "$LOG" 2>&1 || FAILED=1
timeout 600 python3 rillnet_scraper.py >> "$LOG" 2>&1 || FAILED=1

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
