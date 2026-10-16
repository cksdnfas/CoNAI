import { createHash } from 'node:crypto'
import { isChatTranslationLanguage, type BilingualLore, type LoreTranslation } from '@conai/shared'
import type { ChatProfile } from './chatProfiles'
import { hasTranslation } from './chatModelRoles'
import { translateStructuredFields, needsLanguageTranslation } from './chatTranslation'
import type { LlmUsageTag } from '../llmUsage'

type Text = { title: string; keys: string[]; content: string }
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
  input = { title: input.title.trim().replace(/\s+/g, ' ').slice(0, 80), keys: [...new Set(input.keys.map(k => k.trim()).filter(Boolean))], content: input.content.trim() }
  if (!hasTranslation(profile)) return input
  let original = input
  const modelLanguage = profile.translationModelLanguage, displayLanguage = profile.translationDisplayLanguage
  if (needsLanguageTranslation(input.content, modelLanguage) || needsLanguageTranslation(input.title, modelLanguage) || input.keys.some(key => needsLanguageTranslation(key, modelLanguage))) {
    const converted = await translateStructuredFields(profile, input, ['title', 'keys.*', 'content'], modelLanguage, signal, attribution)
    if (!converted) return input // preserve the real source; never mislabel a failed conversion as English
    const text = converted as Text
    original = { title: text.title.trim().replace(/\s+/g, ' ').slice(0, 80), keys: [...new Set(text.keys.map(k => k.trim()).filter(Boolean))], content: text.content.trim() }
  }
  if (modelLanguage === displayLanguage) return { ...original, language: modelLanguage }
  const display = original !== input && !needsLanguageTranslation(input.content, displayLanguage) ? input : await translateStructuredFields(profile, original, ['title', 'keys.*', 'content'], displayLanguage, signal, attribution) as Text | null
  return { ...original, language: modelLanguage, translation: display ? normalizeLoreTranslation(original, { ...display, language: displayLanguage }) : null }
}
