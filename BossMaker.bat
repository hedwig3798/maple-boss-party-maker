@echo off
rem BossMaker launcher. Logic lives in scripts\BossMaker.ps1 (kept ASCII here: cmd misreads UTF-8 batch files).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\BossMaker.ps1" %*
if errorlevel 1 pause
