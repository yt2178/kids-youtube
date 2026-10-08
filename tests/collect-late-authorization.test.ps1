# Windows CI smoke-test: PowerShell parser and device selection without ADB hardware.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script=Join-Path $root 'scripts\collect-late-authorization.ps1'
$tokens=$null;$parseErrors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($script,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw "Capture script does not parse: $($parseErrors | Out-String)"}
$fake=Join-Path $env:TEMP ('kids-adb-mock-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $fake | Out-Null
$originalPath=$env:PATH
try {
    @'
@echo off
if "%1"=="devices" (
  echo List of devices attached
  echo emulator-5554 device
  echo USB-123 device
  exit /b 0
)
if "%1"=="-s" (
  if "%2"=="USB-123" (
    if "%4"=="pm" (
      echo package:/data/app/il.kidsyoutube/base.apk
      exit /b 0
    )
    if "%4"=="dumpsys" (
      echo     versionName=0.3-beta
      exit /b 0
    )
  )
)
exit /b 2
'@ | Set-Content -LiteralPath (Join-Path $fake 'adb.cmd') -Encoding ascii
    $env:PATH="$fake;$originalPath"
    $rejected=$false
    try{ & $script -ValidateOnly 2>&1 | Out-Null }catch{ $rejected=$true }
    if(-not $rejected){throw 'Ambiguous emulator+phone configuration was silently accepted.'}
    $verified=@(& $script -ValidateOnly -Serial 'USB-123')
    if(-not ($verified -match 'VALIDATED device=USB-123 package=il.kidsyoutube version=0.3-beta')){
        throw "Explicit device was not verified: $($verified -join ', ')"
    }
    foreach($bad in @('emulator-5554','missing-phone')){
        $rejected=$false
        try{& $script -ValidateOnly -Serial $bad 2>&1 | Out-Null}catch{$rejected=$true}
        if(-not $rejected){throw "Invalid target '$bad' was accepted."}
    }
    Write-Host 'PASS: syntax, ambiguous-device refusal, explicit physical target and invalid serial rejection.'
} finally {
    $env:PATH=$originalPath
    Remove-Item -LiteralPath $fake -Recurse -Force -ErrorAction SilentlyContinue
}
