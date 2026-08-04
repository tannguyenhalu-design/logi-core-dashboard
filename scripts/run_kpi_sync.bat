@echo off
REM Chay hang ngay: mo Chrome ngam (headless, dung profile da dang nhap san),
REM cao du lieu KPI portal, day len app, roi dong Chrome lai.
REM Dang ky qua Task Scheduler bang schtasks (xem huong dan trong kpi_scraper.py).

set KPI_SYNC_SECRET=85c590ad34783c6cd6994b044c7fdca35d0d109b020c56fa
set PYTHONIOENCODING=utf-8

echo [%date% %time%] Bat dau dong bo KPI... >> "%~dp0kpi_sync_log.txt"

start "" /min "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="C:\chrome-bot-profile"

timeout /t 5 /nobreak > nul

cd /d "%~dp0"
python kpi_scraper.py >> "%~dp0kpi_sync_log.txt" 2>&1

wmic process where "CommandLine like '%%chrome-bot-profile%%'" call terminate > nul 2>&1

echo [%date% %time%] Hoan tat. >> "%~dp0kpi_sync_log.txt"
echo. >> "%~dp0kpi_sync_log.txt"
