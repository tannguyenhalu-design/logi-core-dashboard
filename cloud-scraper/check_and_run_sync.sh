#!/bin/bash
# Runs every 1 minute via cron. Cheap no-op most of the time (one Sheets
# read) — only does real work when someone clicked "Đồng bộ ngay từ GHN" on
# the dashboard since the last completed sync.
#
# Uses the SAME lock file as run_ftl_scraper.sh/run_scrapers.sh, so it can
# never race the regular */30 cron for the one shared Chrome instance. If
# the lock is already held (by the schedule or a previous manual trigger
# still running), this run just skips silently — the request stays pending
# in the sheet and gets picked up on a later minute once the lock frees up.
LOCK=/tmp/chrome_scraper.lock
exec 9>"$LOCK"
if ! flock -n 9; then
  exit 0
fi

source /app/env.sh
export DISPLAY=:99
cd /app

if ! node check_sync_trigger.js; then
  exit 0
fi

LOG=/data/scraper_log.txt
echo "[$(date)] Dong bo thu cong duoc yeu cau tu dashboard, dang chay..." >> "$LOG"
python3 ftl_scraper.py >> "$LOG" 2>&1
python3 ftl_enrich_vehicle.py >> "$LOG" 2>&1
node mark_sync_complete.js >> "$LOG" 2>&1
echo "[$(date)] Hoan tat dong bo thu cong." >> "$LOG"
echo "" >> "$LOG"
