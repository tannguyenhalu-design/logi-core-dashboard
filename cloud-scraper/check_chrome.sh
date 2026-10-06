#!/bin/bash
# check_chrome.sh — Chrome health watchdog (chay moi gio qua cron).
# Neu Chrome khong phan hoi tren CDP port 9222, tu dong restart de lan
# chay scraper tiep theo khong bi loi WebSocketTimeoutException / ConnectionRefused.
source /app/env.sh
export DISPLAY=:99

LOG=/data/scraper_log.txt

if curl -s --max-time 5 http://localhost:9222/json > /dev/null 2>&1; then
  # Chrome binh thuong, khong lam gi.
  exit 0
fi

echo "[$(date)] [watchdog] Chrome khong phan hoi tren port 9222 — restart..." >> "$LOG"
pkill -f "google-chrome" 2>/dev/null || true
sleep 8
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
sleep 5

if curl -s --max-time 10 http://localhost:9222/json > /dev/null 2>&1; then
  echo "[$(date)] [watchdog] Chrome da restart thanh cong." >> "$LOG"
else
  echo "[$(date)] [watchdog] CANH BAO: Chrome van khong phan hoi sau khi restart." >> "$LOG"
fi
