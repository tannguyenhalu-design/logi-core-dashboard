# keep_warm.ps1 — Gọi warm ping cho logicore-app mỗi 5 phút để tránh cold start.
# Chạy bởi Windows Task Scheduler (xem scripts/setup_warm_task.ps1).

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env.local"

# Đọc SNAPSHOT_SECRET từ .env.local
$secret = $null
foreach ($line in Get-Content $envFile) {
    if ($line -match '^SNAPSHOT_SECRET=(.+)$') {
        $secret = $Matches[1].Trim().Trim('"')
        break
    }
}

if (-not $secret) {
    Write-Host "[keep_warm] Không tìm thấy SNAPSHOT_SECRET trong .env.local"
    exit 1
}

$baseUrl = "https://logicore-app.vercel.app"
$endpoints = @("/api/data", "/api/system-health")
$headers = @{ "x-snapshot-secret" = $secret }

foreach ($ep in $endpoints) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri "$baseUrl$ep?warm=1" -Headers $headers `
             -UseBasicParsing -TimeoutSec 15
        $sw.Stop()
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $ep OK $($r.StatusCode) $($sw.ElapsedMilliseconds)ms"
    } catch {
        $sw.Stop()
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $ep FAIL $($sw.ElapsedMilliseconds)ms — $($_.Exception.Message)"
    }
}
