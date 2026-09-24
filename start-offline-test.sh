#!/usr/bin/env bash
set -euo pipefail
export COPILOT_ANALYSIS_MODE=local
export PORT=3000
echo "Starting AI Copilot in local deterministic mode..."
npm run dev

