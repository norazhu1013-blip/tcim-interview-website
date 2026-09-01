@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-local-comparison.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local-comparison.ps1"
if errorlevel 1 pause
