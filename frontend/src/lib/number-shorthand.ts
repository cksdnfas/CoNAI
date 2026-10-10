/**
 * A typed number, read as people write token counts: "260K", "1.5m", "262,144", "200 000". NaN when it is not one.
 * Without `shorthand` only a plain number is read.
 */
export function parseNumberDraft(text: string, shorthand = false) {
  const trimmed = text.trim()
  if (!shorthand) return Number(trimmed)
  const compact = trimmed.replace(/[,_\s]/g, '')
  const match = /^(\d+(?:\.\d+)?)([km])$/i.exec(compact)
  if (match) return Math.round(Number(match[1]) * (match[2].toLowerCase() === 'k' ? 1000 : 1_000_000))
  return compact === '' ? Number.NaN : Number(compact)
}
