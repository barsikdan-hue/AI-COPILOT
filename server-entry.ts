import dotenv from 'dotenv';
import { resolveRuntimeAnalysisMode } from './src/services/analysisMode';

dotenv.config();

const configuredMode = process.env.COPILOT_ANALYSIS_MODE || 'auto';
const runtimeMode = resolveRuntimeAnalysisMode(configuredMode, Boolean(process.env.GEMINI_API_KEY));

// server.ts currently exposes Gemini semantic enhancement only when its runtime
// mode is `gemini`. Resolve `auto` before importing it so the browser still gets
// the deterministic local-first hint and the provider can request Gemini
// refinement afterwards. Explicit `local` remains strictly local.
process.env.COPILOT_ANALYSIS_MODE = runtimeMode;
process.env.COPILOT_CONFIGURED_ANALYSIS_MODE = configuredMode;

import('./server').catch((error) => {
  console.error('Failed to start AI Copilot server:', error);
  process.exit(1);
});
