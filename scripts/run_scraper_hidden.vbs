Set WshShell = CreateObject("WScript.Shell") 
WshShell.Run chr(34) & "D:\Điện Máy\nextjs-dashboard\scripts\run_scraper.bat" & Chr(34), 0
Set WshShell = Nothing
