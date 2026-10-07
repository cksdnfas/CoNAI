export type ChatLoreSource = { threadId: number; replyId: string; proposalId: number }
export type ChatBlockTone = Array<{ min: number; max: number; text: string }> | Record<string, string>

/** Card import and section editing accept the same placeholder spelling. */
export function unknownChatMacros(text: string): string[] {
  return [...new Set(text.match(/\{\{[^{}]{1,40}\}\}/g) ?? [])]
    .filter((macro) => !/^\{\{\s*(char|user|original)\s*\}\}$/i.test(macro))
}

/** Instructions for current scalar values; numeric ranges include both bounds. */
export function chatBlockToneText(fields: ReadonlyArray<{ name: string; values: string[]; tone?: ChatBlockTone }>, data: Record<string, unknown>): string {
  const texts = fields.flatMap((field) => {
    const value = data[field.name]
    if (value === undefined || value === null || value === '' || !field.tone) return []
    if (field.values.length > 0) {
      if (Array.isArray(field.tone) || !field.values.includes(String(value))) return []
      return Object.prototype.hasOwnProperty.call(field.tone, String(value)) ? [field.tone[String(value)]] : []
    }
    if (!Array.isArray(field.tone) || (typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) return []
    return field.tone.filter((range) => Number(value) >= range.min && Number(value) <= range.max).map((range) => range.text)
  }).map((text) => text.trim()).filter(Boolean)
  return [...new Set(texts)].join(' · ')
}
