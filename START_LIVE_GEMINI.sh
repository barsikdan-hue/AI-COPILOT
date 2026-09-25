#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
export COPILOT_ANALYSIS_MODE=gemini
export PORT=3000
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example to .env and set GEMINI_API_KEY server-side."
  exit 1
fi
if [ ! -d node_modules ]; then npm install; fi
npm run dev
