# keep_warm.ps1 - Warm ping for logicore-app Vercel functions.
# Called every 5 min by Task Scheduler (see setup_warm_task.ps1).
# Uses CRON_SECRET (available in .env.local) as Bearer token.

$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".env.local"

$secret = $null
foreach ($line in Get-Content $envFile -ErrorAction SilentlyContinue) {
    if ($line -match '^CRON_SECRET=(.+)$') {
        $secret = $Matches[1].Trim().Trim('"')
        break
    }
}

if (-not $secret) {
    Write-Host "[keep_warm] CRON_SECRET not found in $envFile"
    exit 1
}

$baseUrl = "https://logicore-app.vercel.app"
$endpoints = @("/api/data", "/api/system-health")
$headers = @{ Authorization = "Bearer $secret" }

foreach ($ep in $endpoints) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri "$baseUrl${ep}?warm=1" -Headers $headers `
             -UseBasicParsing -TimeoutSec 15
        $sw.Stop()
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $ep OK $($r.StatusCode) $($sw.ElapsedMilliseconds)ms"
    } catch {
        $sw.Stop()
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $ep FAIL $($sw.ElapsedMilliseconds)ms - $($_.Exception.Message)"
    }
}
