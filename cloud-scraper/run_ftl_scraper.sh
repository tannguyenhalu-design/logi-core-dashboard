#!/bin/bash
# Called by cron every 30 minutes — separate cadence from run_scrapers.sh's
# 3x/day (KPI/raw_ontime/Rillnet) because FTL needs same-day intervention
# with drivers, not just a daily snapshot.
#
# Lock guard: there's only one Chrome instance (one CDP debug port) shared
# by every scraper on this container. A manual SSH-triggered run that
# overlaps a scheduled cron run races for control of that same browser tab —
# confirmed live on 2026-08-16 13:00 (both processes navigated the page
# concurrently, and the "Xuất dữ liệu" button search failed because the
# other process had already moved the page elsewhere). flock skips this run
# entirely rather than let two instances fight over the browser.
LOCK=/tmp/chrome_scraper.lock
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[$(date)] run_ftl_scraper.sh: lan chay truoc van dang chay, bo qua lan nay." >> /data/scraper_log.txt
  exit 0
fi

source /app/env.sh
export DISPLAY=:99
cd /app

LOG=/data/scraper_log.txt
echo "[$(date)] Bat dau chay run_ftl_scraper.sh" >> "$LOG"

# `timeout N` here is a second, outer safety net on top of each script's own
# internal CDP timeout (see ftl_scraper.py/ftl_enrich_vehicle.py) — belt and
# suspenders, so this flock ALWAYS releases within a bounded time no matter
# what hangs. Real incident 2026-08-20/21: ftl_scraper.py had no CDP
# timeout, one run hung and held this same lock for ~2 hours straight,
# during which every scheduled run_scrapers.sh (LTL, 3x/day) attempt got
# skipped — LTL data went stale for 2 full days before anyone noticed.
FAILED=0
timeout 300 python3 ftl_scraper.py >> "$LOG" 2>&1 || FAILED=1
# Vehicle enrich runs even if the main scraper step above had issues — no
# reason to skip it since it reads whatever's already in the sheet.
timeout 900 python3 ftl_enrich_vehicle.py >> "$LOG" 2>&1 || FAILED=1

if [ "$FAILED" -eq 0 ]; then
  echo "[$(date)] Hoan tat run_ftl_scraper.sh (OK)" >> "$LOG"
else
  echo "[$(date)] Hoan tat run_ftl_scraper.sh (CO LOI - xem log phia tren)" >> "$LOG"
fi
echo "" >> "$LOG"

if [ "$FAILED" -eq 1 ] && [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    -d text="⚠️ SD3 FTL scraper: loi luc $(date). Check /data/scraper_log.txt tren Railway." > /dev/null || true
fi

exit "$FAILED"
