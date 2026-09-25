export type CopilotAnalysisMode = 'auto' | 'local' | 'gemini';

export function parseAnalysisMode(value: string | null | undefined): CopilotAnalysisMode {
  const normalized = String(value || 'auto').trim().toLowerCase();
  return normalized === 'local' || normalized === 'gemini' || normalized === 'auto'
    ? normalized
    : 'auto';
}

/**
 * `auto` means hybrid runtime: deterministic local decision first, then Gemini
 * semantic enhancement when a server-side key is available.
 */
export function shouldUseRemoteSemanticAnalysis(
  mode: CopilotAnalysisMode,
  hasGeminiKey: boolean,
): boolean {
  return mode !== 'local' && hasGeminiKey;
}

/**
 * The existing browser health handshake understands only `local` or `gemini`
 * as effective runtime modes. Keep the configured mode separate and expose the
 * effective mode so `auto` can actually enable AnalysisProvider refinement.
 */
export function getEffectiveAnalysisMode(
  mode: CopilotAnalysisMode,
  hasGeminiKey: boolean,
): 'local' | 'gemini' {
  return shouldUseRemoteSemanticAnalysis(mode, hasGeminiKey) ? 'gemini' : 'local';
}

/** Mutates only the process-local runtime value before server.ts is imported. */
export function resolveRuntimeAnalysisMode(
  configuredMode: string | null | undefined,
  hasGeminiKey: boolean,
): CopilotAnalysisMode {
  const parsed = parseAnalysisMode(configuredMode);
  if (parsed !== 'auto') return parsed;
  return hasGeminiKey ? 'gemini' : 'local';
}
