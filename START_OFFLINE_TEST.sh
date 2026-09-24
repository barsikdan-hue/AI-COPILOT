#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
export COPILOT_ANALYSIS_MODE=local
export PORT=3000
if [ ! -d node_modules ]; then
  echo "Dependencies not found. Installing once..."
  npm install
fi
echo "Starting AI Copilot ANDREI OS 4.0.2-rc.5 on http://localhost:3000"
npm run dev
