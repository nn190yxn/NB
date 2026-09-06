@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js and add it to PATH.
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm was not found. Repair the Node.js installation.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules\" (
  echo Dependencies are missing. Run npm install in this folder first.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'node.exe' -ArgumentList 'scripts/start-local.mjs' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
if errorlevel 1 (
  echo Startup failed. Check local-app.log.
  pause
  exit /b 1
)

exit /b 0
