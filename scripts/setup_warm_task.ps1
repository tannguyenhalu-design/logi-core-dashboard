# setup_warm_task.ps1 — Tạo Task Scheduler gọi keep_warm.ps1 mỗi 5 phút, 07:00–23:00 VN.
# Chạy 1 lần với quyền Admin: Right-click → Run as Administrator

$taskName = "LogicoreKeepWarm"
$scriptPath = Join-Path $PSScriptRoot "keep_warm.ps1"

# Xóa task cũ nếu có
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NonInteractive -WindowStyle Hidden -File `"$scriptPath`""

# Chạy mỗi 5 phút, bắt đầu 07:00 VN (+7)
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -Once -At "07:00" -RepetitionDuration (New-TimeSpan -Hours 16)

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Keep Logicore Vercel functions warm — runs every 5min 07:00-23:00 VN" `
    -Force

Write-Host "Task '$taskName' đã tạo. Kiểm tra trong Task Scheduler > Task Scheduler Library."
Write-Host "Script: $scriptPath"

# Test chạy ngay
Write-Host "`nTest chạy warm ping ngay..."
& powershell.exe -NonInteractive -File $scriptPath
