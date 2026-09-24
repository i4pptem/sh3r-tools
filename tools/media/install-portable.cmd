@echo off
setlocal
title Silent Hill 3 Tools - Media setup
set ELECTRON_RUN_AS_NODE=1
"%~dp0Silent Hill 3 Tools.exe" "%~dp0resources\app\tools\setup-media.mjs"
if errorlevel 1 (
  echo.
  echo Media installation failed. See the message above and resources\app\tools\media\README.md.
  pause
  exit /b 1
)
echo.
echo Media setup is complete. You can start Silent Hill 3 Tools.
pause
