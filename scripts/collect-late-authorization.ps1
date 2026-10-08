# One future diagnostic capture. PowerShell 5.1+, Android platform-tools.
# No installation, data deletion, permission changes, logcat clearing or network changes.
param(
    [ValidateRange(145,600)][int]$Seconds = 180,
    [string]$OutputDir = ".",
    [string]$Serial = "",
    [ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedBuildSha = "",
    [switch]$NoRestart,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$package = 'il.kidsyoutube'
$adbTool = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adbTool) { throw 'Android platform-tools (adb) not available in PATH.' }
$adb = $adbTool.Source
$deviceRows = @(& $adb devices)
$available = @($deviceRows | ForEach-Object {
    if ($_ -match '^(\S+)\s+device(?:\s|$)') { $Matches[1] }
} | Sort-Object -Unique)
if ($Serial) {
    if ($Serial -notin $available) {
        throw "Requested device '$Serial' is not an authorized online ADB target. Available: $($available -join ', ')."
    }
} elseif ($available.Count -eq 1) {
    $Serial = $available[0]
} else {
    throw "Expected one authorized device or an explicit -Serial. Found $($available.Count): $($available -join ', ')."
}
$installed = @(& $adb -s $Serial shell pm path $package)
if ($LASTEXITCODE -ne 0 -or -not (@($installed | Where-Object { $_ -match '^package:' }).Count)) {
    throw "Package $package is not installed on selected device $Serial."
}
$versionLine = @(& $adb -s $Serial shell dumpsys package $package |
    Where-Object { $_ -match '^\s*versionName=([A-Za-z0-9._-]{1,70})\s*$' } |
    Select-Object -First 1)
$version = if ($versionLine.Count -gt 0) { ($versionLine[0] -replace '^\s*versionName=', '').Trim() } else { 'unavailable' }
if ($ValidateOnly) {
    Write-Host "VALIDATED device=$Serial package=$package version=$version"
    Write-Host 'No app restart, recording or settings change was performed.'
    return
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $OutputDir "kids-auth-$stamp.log"
$summary = Join-Path $OutputDir "kids-auth-$stamp-summary.txt"
$raw = Join-Path $OutputDir "kids-auth-$stamp-raw-tmp.log"
$errors = Join-Path $OutputDir "kids-auth-$stamp-adb-errors-tmp.txt"
$reader = $null
try {
    $args = @('-s', $Serial, 'logcat', '-v', 'threadtime', '-T', '1',
        'KidsStartup:D', 'KidsNetwork:D', 'KidsCatalog:D',
        'KidsWeb:D', 'KidsPlayback:D', '*:S')
    $reader = Start-Process -FilePath $adb -ArgumentList $args -NoNewWindow -PassThru -RedirectStandardOutput $raw -RedirectStandardError $errors
    if (-not $NoRestart) {
        & $adb -s $Serial shell am force-stop $package | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Unable to stop $package on $Serial." }
        & $adb -s $Serial shell am start -n "$package/.MainActivity" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Unable to start $package on $Serial." }
    }
    for ($i = 0; $i -lt $Seconds; $i++) {
        Start-Sleep -Seconds 1
        if ($reader.HasExited) { throw 'ADB logcat exited before capture completed.' }
    }
    if (-not $reader.HasExited) {
        Stop-Process -Id $reader.Id -Force -ErrorAction SilentlyContinue
        $reader.WaitForExit(5000) | Out-Null
    }
    # Do not distribute untrusted WebView/Android console text. The released
    # file contains only explicit diagnostic tags and a restrictive character
    # grammar, excluding URL paths, credentials, query strings and tokens.
    $rows = @()
    foreach ($line in (Get-Content -LiteralPath $raw -ErrorAction SilentlyContinue)) {
        if ($line -match '(KidsStartup|KidsNetwork|KidsCatalog|KidsWeb|KidsPlayback):\s+([A-Za-z0-9_=:,.\- ]{1,600})\s*$') {
            $tag=$Matches[1];$payload=$Matches[2].Trim()
            $accepted = switch ($tag) {
                'KidsStartup' { $payload -match '^(onCreate-start|native-api-created|webview-created|view-hierarchy-ready|webview-load-started|webview-page-finished|newpipe-init-worker-ms=)' }
                'KidsNetwork' { $payload -match '^id=\d+ kind=(authorization|catalog|extractor) bridgeId=[0-9-]+ loadCycle=\d+ jsRequestId=\d+ phase=' }
                'KidsCatalog' { $payload -match '^(native-request |native-phase |native-failure )' }
                'KidsWeb' { $payload -match '^event=[a-z0-9-]+' }
                'KidsPlayback' { $payload -match '^request=\d+ stage=' }
            }
            if ($accepted) { $rows += "$($tag): $payload" }
        }
    }
    $rows | Set-Content -LiteralPath $log -Encoding UTF8
    $builds = @($rows | Select-String 'build=([0-9a-f]{40})' -AllMatches |
        ForEach-Object { foreach ($m in $_.Matches) { $m.Groups[1].Value } } | Select-Object -Unique)
    if ($ExpectedBuildSha -and $ExpectedBuildSha -notin $builds) {
        throw "Build mismatch: expected $ExpectedBuildSha; observed $($builds -join ', ')."
    }
    $starts = @($rows | Where-Object { $_ -match '^KidsWeb: event=load-start\b' }).Count
    $polls = @($rows | Where-Object {
        $_ -match '^KidsWeb: event=authorization-check-start\b' -and $_ -match 'source=poll\b'
    }).Count
    $phases = @($rows | Select-String 'phase=([A-Za-z0-9_-]+)' -AllMatches |
        ForEach-Object { $_.Matches.Value } | Group-Object | Sort-Object Name |
        ForEach-Object { "$($_.Name): $($_.Count)" })
    $correlations = @($rows | Where-Object { $_ -match 'loadCycle=\d+' -and
        ($_ -match 'jsRequestId=\d+' -or $_ -match 'requestId=\d+') } |
        ForEach-Object {
            if ($_ -match 'loadCycle=(\d+)') { $cycle=$Matches[1] }
            if ($_ -match 'jsRequestId=(\d+)') { $request=$Matches[1] }
            elseif ($_ -match 'requestId=(\d+)') { $request=$Matches[1] }
            "loadCycle=$cycle jsRequestId=$request"
        } | Sort-Object -Unique)
    $status = if ($starts -ge 1 -and $polls -ge 2 -and $builds.Count -ge 1) {
        'CAPTURE_COMPLETE'
    } else { 'INCOMPLETE_EVIDENCE' }
    @(
        "Status: $status"
        "Collected: $(Get-Date -Format o)"
        "DurationSeconds: $Seconds"
        "Device: $Serial"
        "Package: $package"
        "VersionName: $version"
        "BuildSHAs: $($builds -join ', ')"
        "StartupCycles: $starts"
        "PeriodicAuthorizationChecks: $polls"
        "Events: $($rows.Count)"
        'Network phase counts:'
        $phases
        'Correlations:'
        $correlations
        '-------- ALLOWLISTED DIAGNOSTIC TIMELINE --------'
        $rows
    ) | Set-Content -LiteralPath $summary -Encoding UTF8
    Write-Host "Status: $status"
    Write-Host "Device: $Serial | Version: $version | BuildSHA: $($builds -join ', ')"
    Write-Host "Saved: $log"
    Write-Host "Saved: $summary"
    if ($status -ne 'CAPTURE_COMPLETE') {
        Write-Warning 'Expected one startup and two periodic authorization checks; inspect the summary for missing evidence.'
    }
} finally {
    if ($reader -and -not $reader.HasExited) {
        Stop-Process -Id $reader.Id -Force -ErrorAction SilentlyContinue
        $reader.WaitForExit(5000) | Out-Null
    }
    Remove-Item -LiteralPath $raw,$errors -Force -ErrorAction SilentlyContinue
}
