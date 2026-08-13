@echo off
echo ==============================================
echo  CAI DAT TU DONG CHAY KPI SCRAPER (SD3)
echo ==============================================
echo.

schtasks /create /tn "SD3_KPI_Scraper_Morning" /tr "wscript.exe \"D:\Điện Máy\nextjs-dashboard\scripts\run_scraper_hidden.vbs\"" /sc daily /st 08:50 /f
schtasks /create /tn "SD3_KPI_Scraper_Noon" /tr "wscript.exe \"D:\Điện Máy\nextjs-dashboard\scripts\run_scraper_hidden.vbs\"" /sc daily /st 12:50 /f
schtasks /create /tn "SD3_KPI_Scraper_Evening" /tr "wscript.exe \"D:\Điện Máy\nextjs-dashboard\scripts\run_scraper_hidden.vbs\"" /sc daily /st 17:50 /f

echo.
echo HOAN TAT! 
echo Tu nay KPI Scraper se tu dong chay ngam vao 3 khung gio: 08:50, 12:50, 17:50.
echo (Truoc 10 phut so voi lich flush cache cua he thong 09:00, 13:00, 18:00)
echo.
pause
