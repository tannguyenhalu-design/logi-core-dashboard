@echo off
cd /d "%~dp0\.."

:: 1. Đọc secret từ .env.local
for /f "tokens=1,* delims==" %%A in (.env.local) do (
    if "%%A"=="KPI_SYNC_SECRET" set KPI_SYNC_SECRET=%%B
    if "%%A"=="RILLNET_SYNC_SECRET" set RILLNET_SYNC_SECRET=%%B
)

:: 2. Khởi động Chrome (dùng profile riêng, đẩy ra ngoài màn hình để không làm phiền)
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="C:\chrome-bot-profile" --window-position=-3000,-3000

:: Đợi Chrome khởi động xong
timeout /t 5 /nobreak >nul

:: Thiết lập encoding utf-8 để không bị lỗi in emoji
set PYTHONIOENCODING=utf-8

:: 3. Chạy script lấy dữ liệu KPI
python scripts\kpi_scraper.py

:: 4. Chạy script lấy dữ liệu LTL từ Google Sheet nội bộ
python scripts\sheet_scraper.py

:: 5. Chạy script lấy dữ liệu bể vỡ + nguyên nhân từ Rillnet
python scripts\rillnet_scraper.py

:: 6. Đóng Chrome bot (chỉ đóng bot, không ảnh hưởng Chrome chính của user)
powershell -command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -match 'chrome-bot-profile' } | Invoke-CimMethod -MethodName Terminate -ErrorAction SilentlyContinue"
