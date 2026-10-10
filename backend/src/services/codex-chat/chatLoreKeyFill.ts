import { normalizeLoreKeyLanguage } from '@conai/shared'
import { ChatProfileError } from './chatProfileError'
import { ChatProfileStore } from './chatProfiles'
import { translationTargetOf } from './chatTranslation'
import { completeChat } from './llmChatCompletion'
import { completeSummary, stripThinking, SUMMARY_TIMEOUT_MS } from './llmChatContext'

/**
 * "빠진 키 채우기": a profile's model writes, for entries that have English keywords only, the keywords of the book's
 * key language (names in their usual spellings, terms translated). Its translation model when it has one, else its
 * summary model (which borrows the chat model). Nothing is saved: the editor shows the result for review.
 */

const FILL_BATCH = 20
const FILL_MAX_ENTRIES = 500
const FILL_MAX_KEYS = 8
const FILL_CONTENT_CHARS = 300
const FILL_MAX_TOKENS = 4000

const LANGUAGE_NAMES: Record<string, string> = { ko: 'Korean', ja: 'Japanese', zh: 'Chinese' }

export type LoreKeyFillResult = { keys: Record<string, string[]>; failed: string[] }

type FillEntry = { id: string; title: string; keys: string[]; content: string }

function fillEntries(value: unknown): FillEntry[] {
  if (!Array.isArray(value)) throw new ChatProfileError('entries는 항목 목록이어야 해.')
  return value.slice(0, FILL_MAX_ENTRIES).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const row = raw as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id.slice(0, 80) : ''
    const keys = Array.isArray(row.keys) ? row.keys.filter((key): key is string => typeof key === 'string').map((key) => key.trim().slice(0, 100)).filter(Boolean).slice(0, 20) : []
    const title = typeof row.title === 'string' ? row.title.trim().slice(0, 80) : ''
    const content = typeof row.content === 'string' ? row.content.trim().slice(0, FILL_CONTENT_CHARS) : ''
    return id && (keys.length || title) ? [{ id, title, keys, content }] : []
  })
}

function systemPrompt(language: string) {
  return [
    `You write lorebook keywords in ${language}. Each entry below has English keywords; give the keywords a person writing in ${language} would use for the same thing.`,
    `- Names: the usual ${language} spellings (add a common variant spelling when there is one).`,
    '- Terms: their usual translation. Short keywords only, no sentences, at most 5 per entry.',
    '- Skip regular-expression keywords (/.../).',
    'Reply with one JSON object only, mapping each entry id to its list: {"<id>": ["…", "…"]}.',
  ].join('\n')
}

/** The reply's JSON object, also when the model wrapped it in a code fence or prose. */
function parseReply(text: string): Record<string, unknown> | null {
  const clean = stripThinking(text)
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(clean.slice(start, end + 1)) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

export async function fillLoreKeys(input: { profileId?: unknown; language?: unknown; entries?: unknown }, signal?: AbortSignal): Promise<LoreKeyFillResult> {
  const language = normalizeLoreKeyLanguage(input.language)
  if (!language) throw new ChatProfileError('채울 언어를 골라줘.')
  const profile = ChatProfileStore.find(Number(input.profileId))
  if (!profile) throw new ChatProfileError('프로필을 찾을 수 없어.')
  const entries = fillEntries(input.entries)
  const languageName = LANGUAGE_NAMES[language] ?? language
  const translation = translationTargetOf(profile)
  const system = systemPrompt(languageName)
  const timeout = AbortSignal.timeout(SUMMARY_TIMEOUT_MS)
  const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout
  const keys: Record<string, string[]> = {}
  const failed: string[] = []
  for (let start = 0; start < entries.length; start += FILL_BATCH) {
    const batch = entries.slice(start, start + FILL_BATCH)
    if (bounded.aborted) { failed.push(...batch.map((entry) => entry.id)); continue }
    const content = JSON.stringify(batch.map(({ id, title, keys: english, content: text }) => ({ id, title, keys: english.filter((key) => !/^\/.+\/[a-z]*$/s.test(key)), content: text })), null, 1)
    let reply: Record<string, unknown> | null = null
    try {
      const text = translation
        ? await completeChat(translation, [{ role: 'system', content: system }, { role: 'user', content }], bounded, { purpose: 'translation', profileId: profile.id })
        : await completeSummary(profile, system, content, bounded, FILL_MAX_TOKENS)
      reply = parseReply(text)
    } catch (error) {
      if (signal?.aborted) throw error
      console.warn('[lore-key-fill] batch failed:', error instanceof Error ? error.message : error)
    }
    for (const entry of batch) {
      const value = reply?.[entry.id]
      const english = new Set(entry.keys.map((key) => key.toLowerCase()))
      const found = Array.isArray(value)
        ? [...new Set(value.filter((key): key is string => typeof key === 'string').map((key) => key.trim().slice(0, 100)).filter((key) => key && !english.has(key.toLowerCase())))].slice(0, FILL_MAX_KEYS)
        : []
      if (found.length) keys[entry.id] = found
      else failed.push(entry.id)
    }
  }
  return { keys, failed }
}
