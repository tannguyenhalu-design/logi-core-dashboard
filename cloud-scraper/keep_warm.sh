#!/bin/bash
# Keep-warm pings for the dashboard (Kế hoạch A · P5, 28/09).
# A Vercel function nobody called for a few minutes starts cold, so the first
# click of the day/after a pause waited 1–5s. Every 5 minutes during working
# hours (crontab) this calls the main routes with ?warm=1 + SNAPSHOT_SECRET;
# each only loads what its first real request needs (lib/warm.js) and answers
# {ok} — no data leaves Vercel, nothing is written. Output is discarded.
source /app/env.sh
[ -n "$SNAPSHOT_SECRET" ] || exit 0
BASE="https://logicore-app.vercel.app"
for p in /api/data /api/report/biweekly /api/trials /api/system-health /api/audit-log /dashboard; do
  curl -s -o /dev/null -m 60 -H "x-snapshot-secret: ${SNAPSHOT_SECRET}" "${BASE}${p}?warm=1" &
done
wait
