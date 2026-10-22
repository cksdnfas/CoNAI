export type ChatLoreSource = { threadId: number; replyId: string; proposalId: number }
export type ChatBlockTone = Array<{ min: number; max: number; text: string }> | Record<string, string>

/** Card import and section editing accept the same placeholder spelling. */
export function unknownChatMacros(text: string): string[] {
  return [...new Set(text.match(/\{\{[^{}]{1,40}\}\}/g) ?? [])]
    .filter((macro) => !/^\{\{\s*(char|user|original)\s*\}\}$/i.test(macro))
}

const USER_SPEAKERS = /^(?:\{\{\s*user\s*\}\}|user|사용자|유저|나)\s*[:：]\s?/i
const ASSISTANT_SPEAKERS = /^(?:\{\{\s*char\s*\}\}|char|assistant|ai|캐릭터)\s*[:：]\s?/i

export type ExampleDialogueTurn = { role: 'user' | 'assistant'; text: string }

/**
 * An example dialogue section as speaker turns: each `사용자:` / `{{user}}:` or `{{char}}:` / `<name>:` line starts an
 * utterance, unlabelled lines continue it and `<START>` separators are dropped. `leading` is the text before the first
 * speaker line, which a dialogue reading leaves out. The server and the profile editor read sections the same way.
 */
export function splitExampleDialogue(content: string, characterName: string): { turns: ExampleDialogueTurn[]; leading: string } {
  const namePattern = characterName ? new RegExp(`^${characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]\\s?`) : null
  const turns: Array<{ role: 'user' | 'assistant'; lines: string[] }> = []
  const leading: string[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (/^\s*<start>\s*$/i.test(line)) continue
    const label = USER_SPEAKERS.test(line) ? USER_SPEAKERS : ASSISTANT_SPEAKERS.test(line) ? ASSISTANT_SPEAKERS : namePattern?.test(line) ? namePattern : null
    const last = turns[turns.length - 1]
    if (label) {
      const role = label === USER_SPEAKERS ? 'user' : 'assistant'
      const text = line.replace(label, '')
      if (last?.role === role) last.lines.push(text)
      else turns.push({ role, lines: [text] })
    } else if (last) {
      if (line.trim()) last.lines.push(line)
    } else {
      leading.push(line)
    }
  }
  return { turns: turns.map((turn) => ({ role: turn.role, text: turn.lines.join('\n').trim() })), leading: leading.join('\n').trim() }
}

/** A dialogue section goes out as user/assistant turns only when both sides speak; otherwise it is sent as text. */
export function bothSidesSpeak(turns: ReadonlyArray<ExampleDialogueTurn>): boolean {
  return turns.some((turn) => turn.role === 'user') && turns.some((turn) => turn.role === 'assistant')
}

/** Turns (and any leading text) back to the text `splitExampleDialogue` reads, as `사용자:` / `{{char}}:` lines. */
export function joinExampleDialogue(turns: ReadonlyArray<ExampleDialogueTurn>, leading = ''): string {
  return [leading.trim(), ...turns.map((turn) => `${turn.role === 'user' ? '사용자' : '{{char}}'}: ${turn.text}`)].filter(Boolean).join('\n')
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
