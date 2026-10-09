@echo off
cd /d "%~dp0"
rem Already set up: start Minapp straight away, with no console window.
if exist "runtime\electron.exe" if exist "app\node_modules\webamp\built\webamp.bundle.min.js" (
  start "" "runtime\electron.exe" "app"
  exit /b 0
)
rem First run: download the player engine (this window shows the progress, then closes by itself).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 (
  echo.
  echo Something went wrong. The message above says what.
  pause
)
exit /b 0
