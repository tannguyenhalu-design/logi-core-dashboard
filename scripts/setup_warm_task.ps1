# setup_warm_task.ps1 - Create Task Scheduler for keep-warm pings.
# Run once (no Admin needed - uses current user logon).

$taskName = "LogicoreKeepWarm"
$scriptPath = "D:\Dien May\nextjs-dashboard\scripts\keep_warm.ps1"

# Remove old task if exists
schtasks /Delete /TN $taskName /F 2>$null

# Create task: run every 5 minutes, 07:00-23:00, starting today
$startTime = "07:00"
$duration = "PT16H"

schtasks /Create `
    /TN $taskName `
    /TR "powershell.exe -NonInteractive -WindowStyle Hidden -File `"$scriptPath`"" `
    /SC MINUTE /MO 5 `
    /ST $startTime `
    /DU $duration `
    /RL LIMITED `
    /F

if ($LASTEXITCODE -eq 0) {
    Write-Host "Task '$taskName' created OK - runs every 5min from 07:00 for 16h"
} else {
    Write-Host "Task creation may have failed - check Task Scheduler manually"
}

Write-Host "Testing warm ping now..."
& powershell.exe -NonInteractive -File $scriptPath
