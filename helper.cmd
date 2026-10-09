@echo off
title LAN Pinger helper
cd /d "%~dp0"
echo This computer will find your main laptop on the Wi-Fi and become findable.
echo Leave this window open. Close it (or press Ctrl+C) to stop.
echo.
node agent.js "" "%COMPUTERNAME%"
pause
