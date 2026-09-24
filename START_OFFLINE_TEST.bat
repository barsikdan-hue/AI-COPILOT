@echo off
cd /d "%~dp0"
set COPILOT_ANALYSIS_MODE=local
set PORT=3000

echo ==============================================
echo AI Copilot ANDREI OS 4.0.2-rc.5 - local mode
echo ==============================================

if not exist node_modules (
  echo Dependencies not found. Installing once...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Check internet access and Node.js installation.
    pause
    exit /b 1
  )
)

echo Starting local deterministic mode on http://localhost:3000 ...
call npm run dev
pause
