/**
 * Unicode-aware Russian text normalization and matching utilities.
 * Prevents dangerous substring matches (e.g. "рядом" matching "дом",
 * "ипотека" matching "ип", "важен" matching "жен").
 */

export function normalizeRussianText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeRussianText(text: string): string[] {
  const norm = normalizeRussianText(text);
  if (!norm) return [];
  return norm.split(/\s+/).filter(Boolean);
}

/**
 * Checks if the exact word exists as a distinct token in the text.
 */
export function hasWholeWord(text: string, word: string): boolean {
  if (!text || !word) return false;
  const tokens = tokenizeRussianText(text);
  const target = normalizeRussianText(word);
  return tokens.includes(target);
}

/**
 * Checks if any of the provided words exist as distinct tokens in the text.
 */
export function hasAnyWholeWord(text: string, words: string[]): boolean {
  if (!text || !words || words.length === 0) return false;
  const tokens = tokenizeRussianText(text);
  const tokenSet = new Set(tokens);
  return words.some((w) => tokenSet.has(normalizeRussianText(w)));
}

/**
 * Checks if the multi-word phrase exists in normalized text with word boundary spacing.
 */
export function hasPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  const normText = ' ' + normalizeRussianText(text) + ' ';
  const normPhrase = ' ' + normalizeRussianText(phrase) + ' ';
  return normText.includes(normPhrase);
}

/**
 * Checks if any of the provided phrases exist in the text.
 */
export function hasAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((p) => hasPhrase(text, p));
}

/**
 * Evidence Invariant Validator:
 * Confirmed facts MUST be backed by an actual verbatim substring in the turn text.
 * Safe punctuation and whitespace normalization is performed on both.
 */
export function validateEvidenceQuote(turnText: string, evidenceQuote: string): boolean {
  if (!turnText || !evidenceQuote) return false;
  const normTurn = normalizeRussianText(turnText);
  const normQuote = normalizeRussianText(evidenceQuote);
  if (!normTurn || !normQuote) return false;
  return normTurn.includes(normQuote);
}
