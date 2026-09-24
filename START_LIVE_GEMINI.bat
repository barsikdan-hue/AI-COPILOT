@echo off
cd /d "%~dp0"
set COPILOT_ANALYSIS_MODE=auto
set PORT=3000

echo ==============================================
echo AI Copilot ANDREI OS 4.0.2-rc.5 - LIVE GEMINI
echo ==============================================

if not exist .env (
  echo.
  echo ERROR: .env not found.
  echo Copy .env.example to .env and put GEMINI_API_KEY there.
  echo The key stays server-side and must not be committed to Git.
  echo.
  pause
  exit /b 1
)

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

echo Starting local-first Copilot + Gemini runtime on http://localhost:3000 ...
call npm run dev
pause
