@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\capture-family-playback.ps1"
if errorlevel 1 (
  echo.
  echo Family playback diagnostic failed. No device data has been changed.
)
echo.
pause
