@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-model.ps1"
if errorlevel 1 pause
