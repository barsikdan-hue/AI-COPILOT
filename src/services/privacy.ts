/** Removes contact and identity data before transcript text is sent to an LLM. */
export function redactSensitiveText(text: string): string {
  return String(text || '')
    .replace(/[\w.+-]+@[\w.-]+\.[a-zа-я]{2,}/giu, '[email скрыт]')
    .replace(/(?:\+7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/gu, '[телефон скрыт]')
    .replace(/\b(?:(?:\d{4}[\s-]){3}\d{4}|\d{16})\b/gu, '[карта скрыта]')
    .replace(/((?:паспорт|серия|номер)\s*[:№-]?\s*)\d{4}\s*\d{6}/giu, '$1[паспорт скрыт]')
    .replace(/\b\d{3}-\d{3}-\d{3}[ -]\d{2}\b/gu, '[СНИЛС скрыт]');
}
