import { describe, expect, it } from 'vitest';
import {
  getEffectiveAnalysisMode,
  parseAnalysisMode,
  resolveRuntimeAnalysisMode,
  shouldUseRemoteSemanticAnalysis,
} from './analysisMode';

describe('analysis mode resolution', () => {
  it('treats auto + server key as hybrid Gemini enhancement', () => {
    expect(parseAnalysisMode('auto')).toBe('auto');
    expect(shouldUseRemoteSemanticAnalysis('auto', true)).toBe(true);
    expect(getEffectiveAnalysisMode('auto', true)).toBe('gemini');
    expect(resolveRuntimeAnalysisMode('auto', true)).toBe('gemini');
  });

  it('keeps explicit local mode strictly local even when a key exists', () => {
    expect(shouldUseRemoteSemanticAnalysis('local', true)).toBe(false);
    expect(getEffectiveAnalysisMode('local', true)).toBe('local');
    expect(resolveRuntimeAnalysisMode('local', true)).toBe('local');
  });

  it('falls back to local when auto has no Gemini key', () => {
    expect(shouldUseRemoteSemanticAnalysis('auto', false)).toBe(false);
    expect(getEffectiveAnalysisMode('auto', false)).toBe('local');
    expect(resolveRuntimeAnalysisMode('auto', false)).toBe('local');
  });

  it('keeps explicit gemini mode explicit so missing-key diagnostics remain visible', () => {
    expect(parseAnalysisMode('gemini')).toBe('gemini');
    expect(resolveRuntimeAnalysisMode('gemini', false)).toBe('gemini');
    expect(shouldUseRemoteSemanticAnalysis('gemini', false)).toBe(false);
  });

  it('normalizes an invalid value to auto semantics', () => {
    expect(parseAnalysisMode('something-else')).toBe('auto');
    expect(resolveRuntimeAnalysisMode('something-else', true)).toBe('gemini');
  });
});
