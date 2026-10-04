@echo off
cd /d "%~dp0\.."

REM 1. Doc secret tu .env.local (strip dau ngoac kep neu co)
for /f "tokens=1,* delims==" %%A in (.env.local) do (
    if "%%A"=="KPI_SYNC_SECRET" set KPI_SYNC_SECRET=%%B
    if "%%A"=="RILLNET_SYNC_SECRET" set RILLNET_SYNC_SECRET=%%B
)
set RILLNET_SYNC_SECRET=%RILLNET_SYNC_SECRET:"=%
set KPI_SYNC_SECRET=%KPI_SYNC_SECRET:"=%

REM 2. Khoi dong Chrome (dung profile rieng, day ra ngoai man hinh de khong lam phien)
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="C:\chrome-bot-profile" --window-position=-3000,-3000

REM Doi Chrome khoi dong xong
timeout /t 5 /nobreak >nul

REM Thiet lap encoding utf-8 de khong bi loi in emoji
set PYTHONIOENCODING=utf-8
set SCRAPER_FAILED=

REM Ghi log bat dau
echo [%date% %time%] Bat dau chay run_scraper.bat >> "%~dp0scraper_log.txt"

REM 3. Chay script lay du lieu KPI
python scripts\kpi_scraper.py >> "%~dp0scraper_log.txt" 2>&1

REM 4. Chay script lay du lieu LTL tu Google Sheet noi bo
python scripts\sheet_scraper.py >> "%~dp0scraper_log.txt" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [%date% %time%] FAIL: sheet_scraper.py exit code %ERRORLEVEL% >> "%~dp0scraper_log.txt"
    set SCRAPER_FAILED=sheet
)

REM 5. Chay script lay du lieu be vo + nguyen nhan tu Rillnet
python scripts\rillnet_scraper.py >> "%~dp0scraper_log.txt" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [%date% %time%] FAIL: rillnet_scraper.py exit code %ERRORLEVEL% >> "%~dp0scraper_log.txt"
    if defined SCRAPER_FAILED (set SCRAPER_FAILED=sheet+rillnet) else (set SCRAPER_FAILED=rillnet)
)

echo [%date% %time%] Hoan tat run_scraper.bat >> "%~dp0scraper_log.txt"
echo. >> "%~dp0scraper_log.txt"

REM 6. Dong Chrome bot (chi dong bot, khong anh huong Chrome chinh cua user)
powershell -command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -match 'chrome-bot-profile' } | Invoke-CimMethod -MethodName Terminate -ErrorAction SilentlyContinue"

REM 7. Alert neu co loi
if defined SCRAPER_FAILED (
    msg * "SD3 Scraper FAIL [%SCRAPER_FAILED%] luc %time% - Kiem tra: D:\Dien May\nextjs-dashboard\scripts\scraper_log.txt"
)
