@echo off
title LAN Pinger helper
cd /d "%~dp0"
if not exist "%~dp0.master" (
  echo First time setup.
  set /p MASTER="Paste your main laptop's app address (like https://192.168.1.20:3000): "
  >"%~dp0.master" echo %MASTER%
)
set /p MASTER=<"%~dp0.master"
echo.
echo This computer is now findable and ringable from the app at %MASTER%
echo Leave this window open. Close it (or press Ctrl+C) to stop.
echo.
node agent.js %MASTER% "%COMPUTERNAME%"
pause
