import { createHash } from 'node:crypto'
import { isChatTranslationLanguage, type BilingualLore, type LoreTranslation } from '@conai/shared'
import type { ChatProfile } from './chatProfiles'
import { hasTranslation } from './chatModelRoles'
import { translateStructuredFields, needsLanguageTranslation } from './chatTranslation'
import type { LlmUsageTag } from '../llmUsage'

type Text = { title: string; keys: string[]; content: string }
/** chatLorebook's isRegexKeyword, repeated here because chatLorebook imports this module. */
const isRegexKeyword = (word: string) => /^\/.+\/[a-z]*$/s.test(word)
export const loreTextHash = (entry: Text) => createHash('sha256').update(JSON.stringify([entry.title, entry.keys, entry.content])).digest('hex')
export function normalizeLoreTranslation(entry: Text, value: unknown): LoreTranslation | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<LoreTranslation>
  if (!isChatTranslationLanguage(row.language) || typeof row.content !== 'string' || !row.content.trim() || typeof row.title !== 'string' || !Array.isArray(row.keys)) return null
  const sourceHash = loreTextHash(entry)
  if (row.sourceHash && row.sourceHash !== sourceHash) return null
  return { language: row.language, title: row.title.trim().slice(0, 80), keys: row.keys.filter((k): k is string => typeof k === 'string' && !!k.trim()).map(k => k.trim().slice(0, 100)).slice(0, 20), content: row.content.trim().slice(0, 20000), sourceHash }
}

/** No writes here: callers retain their normal validation, conflict and approval rules after translation. */
export async function bilingualLore(profile: ChatProfile, input: Text, signal?: AbortSignal, attribution?: Omit<LlmUsageTag, 'purpose'>): Promise<Text & BilingualLore> {
  input = { title: input.title.normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 80), keys: [...new Set(input.keys.map(k => k.trim()).filter(Boolean))], content: input.content.trim() }
  if (!hasTranslation(profile)) return input
  // A /regex/ keyword is code, not prose: it is neither measured for language nor sent to the translator.
  const patterns = input.keys.filter(isRegexKeyword), words = input.keys.filter(key => !isRegexKeyword(key))
  const prose = { ...input, keys: words }
  const withPatterns = (text: Text): Text => ({ ...text, keys: [...text.keys, ...patterns] })
  let original = prose, written = prose
  const modelLanguage = profile.translationModelLanguage, displayLanguage = profile.translationDisplayLanguage
  if (needsLanguageTranslation(prose.content, modelLanguage) || needsLanguageTranslation(prose.title, modelLanguage) || words.some(key => needsLanguageTranslation(key, modelLanguage))) {
    const converted = await translateStructuredFields(profile, prose, ['title', 'keys.*', 'content'], modelLanguage, signal, attribution)
    if (!converted) return input // preserve the real source; never mislabel a failed conversion as English
    const text = converted as Text
    // Keys translate position by position. Two keys can become one ("포션", "회복약" → "potion"): drop the repeat as a
    // pair, so every remaining key keeps its own written key at the same index (save_lore pairs them by index).
    const pairs = new Map<string, string>()
    text.keys.forEach((key, i) => { key = key.trim(); if (key && !pairs.has(key)) pairs.set(key, words[i] ?? key) })
    original = { title: text.title.normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 80), keys: [...pairs.keys()], content: text.content.trim() }
    written = { ...prose, keys: [...pairs.values()] }
  }
  if (modelLanguage === displayLanguage) return { ...withPatterns(original), language: modelLanguage }
  const display = original !== prose && !needsLanguageTranslation(prose.content, displayLanguage) ? written : await translateStructuredFields(profile, original, ['title', 'keys.*', 'content'], displayLanguage, signal, attribution) as Text | null
  const source = withPatterns(original)
  return { ...source, language: modelLanguage, translation: display ? normalizeLoreTranslation(source, { ...withPatterns(display), language: displayLanguage }) : null }
}
