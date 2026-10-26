param([string]$DeviceSerial = "")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$paths = @("adb.exe")
if ($env:ANDROID_HOME) { $paths += (Join-Path $env:ANDROID_HOME "platform-tools\adb.exe") }
if ($env:ANDROID_SDK_ROOT) { $paths += (Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe") }
$paths += (Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe")
$adb = $null
foreach ($path in $paths) {
  if (Get-Command $path -ErrorAction SilentlyContinue) { $adb = (Get-Command $path).Source; break }
}
if (-not $adb) { throw "ADB not found. Install Android SDK Platform Tools or add adb to PATH." }
$lines = @(& $adb devices) | Select-Object -Skip 1 | Where-Object { $_ -match "^\S+\s+device\s*$" }
$serials = @($lines | ForEach-Object { ($_ -split "\s+")[0] })
if ($DeviceSerial) {
  if ($serials -notcontains $DeviceSerial) { throw "Specified Android device is not connected and authorized." }
  $serial = $DeviceSerial
} elseif ($serials.Count -eq 1) {
  $serial = $serials[0]
} elseif ($serials.Count -eq 0) {
  throw "No authorized Android device found. Connect tablet with USB debugging."
} else { throw "Multiple Android devices connected. Run: powershell -File capture-family-playback.ps1 -DeviceSerial SERIAL" }
$pkg = & $adb -s $serial shell pm path il.kidsyoutube 2>&1
if ($LASTEXITCODE -ne 0 -or -not ($pkg -match "package:")) {
  throw "Kids YouTube app is not installed on the selected Android device."
}
Write-Host "Capture for Kids YouTube family pilot (non-destructive)."
Write-Host "On tablet: open debug app > Family pilot > enter approved video ID > Media3 test."
Write-Host "No app data, credentials, or other apps will be changed."
Read-Host "Press Enter after completing the smoke test on the tablet"
$logs = @(& $adb -s $serial logcat -d -v threadtime -s KidsFamilyPilot:I '*:S')
if ($LASTEXITCODE -ne 0) { throw "Unable to read Android diagnostic log." }
# Defense in depth: only emit instrumented stage/elapsed/HTTP lines; no raw log messages.
$clean = @($logs | Where-Object { $_ -match 'KidsFamilyPilot\s*:\s*stage=' } |
  ForEach-Object {
    if ($_ -match 'stage=(?<stage>[a-z0-9-]{1,48})(?:\s+elapsedMs=(?<ms>\d{1,10})|\s+status=(?<code>HTTP_[1-5][0-9]{2}))') {
      $stamp = [regex]::Match($_, '^\s*\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d{3}').Value
      if ($Matches['ms']) { "$stamp stage=$($Matches['stage']) elapsedMs=$($Matches['ms'])" }
      elseif ($Matches['code']) { "$stamp stage=$($Matches['stage']) status=$($Matches['code'])" }
    }
  })
# Report only the latest complete attempt. Historic logcat entries must not
# cause an old success to be attributed to a new playback attempt.
$starts = @($clean | ForEach-Object -Begin { $index = -1 } -Process {
  $index++
  if ($_ -match 'stage=smoke-start(?:\s|$)') { $index }
})
if ($starts.Count -gt 0) {
  $clean = @($clean[$starts[-1]..($clean.Count-1)])
}
$confirmed = @($clean | Where-Object { $_ -match 'stage=outcome-first-frame-confirmed(?:\s|$)' }).Count -gt 0
$noFrame = @($clean | Where-Object { $_ -match 'stage=outcome-no-first-frame(?:\s|$)' }).Count -gt 0
$failed = @($clean | Where-Object { $_ -match 'stage=(?:player-error|smoke-preflight-failed|media-start-blocked)(?:\s|$)' }).Count -gt 0
$verdict = if ($confirmed) { "FIRST_FRAME_CONFIRMED" }
           elseif ($failed) { "FAILED_OR_BLOCKED" }
           elseif ($noFrame) { "NO_FIRST_FRAME" }
           else { "INCONCLUSIVE" }
$dir = Join-Path $root "family-pilot-diagnostics"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file = Join-Path $dir "family-media3-$stamp.txt"
@(
"Kids YouTube family Media3 smoke test"
"Timestamp: $(Get-Date -Format o)"
"Evidence: sanitized KidsFamilyPilot events only"
"Device identifier deliberately omitted"
"Verdict: $verdict"
""
) + $clean | Set-Content -LiteralPath $file -Encoding UTF8
Write-Host "Saved sanitized diagnostic report: $file"
Write-Host "Result: $verdict"
if (-not $clean.Count) { Write-Warning "No family pilot events found. Verify you installed and opened a DEBUG build." }
