# Single future-only evidence collection. PowerShell 5.1+, Android platform-tools.
# Logs only safe diagnostic tags: NO URLs, tokens, HTTP bodies, or media URLs.
param(
    [ValidateRange(90,600)][int]$Seconds = 150,
    [string]$OutputDir = ".",
    [switch]$NoRestart
)
$ErrorActionPreference = 'Stop'
$package = 'il.kidsyoutube'
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    throw 'Android platform-tools (adb) not available in PATH'
}
$connected = @(adb devices | Select-String '^\S+\s+device$')
if ($connected.Count -ne 1) {
    throw "Expected exactly one authorized Android device, found $($connected.Count)."
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $OutputDir "kids-auth-$stamp.log"
$summary = Join-Path $OutputDir "kids-auth-$stamp-summary.txt"
$adbArgs = @('logcat','-v','threadtime','-T','1',
    'KidsStartup:D','KidsNetwork:D','KidsCatalog:D','KidsWeb:D','KidsPlayback:D','*:S')
$reader = Start-Process -FilePath (Get-Command adb).Source -ArgumentList $adbArgs -NoNewWindow -PassThru -RedirectStandardOutput $log
try {
    if (-not $NoRestart) {
        & adb shell am force-stop $package | Out-Null
        & adb shell am start -n "$package/.MainActivity" | Out-Null
    }
    # Covers startup, a 60-second periodic check, and bounded recovery attempts.
    Start-Sleep -Seconds $Seconds
} finally {
    if ($reader -and -not $reader.HasExited) {
        Stop-Process -Id $reader.Id -Force -ErrorAction SilentlyContinue
        $reader.WaitForExit(5000) | Out-Null
    }
}
$rows = @(Get-Content $log -ErrorAction SilentlyContinue | Where-Object {
    $_ -match 'Kids(Start|Network|Catalog|Web|Playback)'
})
$interesting = @($rows | Where-Object {
    $_ -match 'build=|kind=authorization|operation=authorization|authorization-check-|authorization-blocked|load-fatal|native-failure|root=|retry-scheduled|load-complete|phase=headers-|phase=failed-|CANCELLED|TIMEOUT|NETWORK_ERROR|AUTH_CHANGED_RETRY'
})
$builds = @($rows | Select-String -Pattern 'build=([0-9a-f]{40})' -AllMatches | ForEach-Object {
    foreach ($m in $_.Matches) { $m.Groups[1].Value }
} | Select-Object -Unique)
$counts = @($rows | Select-String -Pattern 'phase=(call-start|headers-[0-9]+|failed-[A-Za-z]+)' -AllMatches |
    ForEach-Object { $_.Matches.Value } | Group-Object | Sort-Object Name |
    ForEach-Object { "$($_.Name): $($_.Count)" })
@(
    "Collected: $(Get-Date -Format o)"
    "DurationSeconds: $Seconds"
    "BuildSHAs: $($builds -join ', ')"
    "Device: $(adb get-serialno)"
    "OriginalLog: $log"
    "Events: $($interesting.Count)"
    "Phase counts:"
    $counts
    "------ AUTHORIZATION TIMELINE ------"
    $interesting
) | Set-Content -Path $summary -Encoding UTF8
Write-Host "Diagnostic capture saved to:"
Write-Host $log
Write-Host $summary
Write-Host 'No installation or permissions changes were performed by this script.'
