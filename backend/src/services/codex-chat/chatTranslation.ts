import { CHAT_TRANSLATION_DEFAULTS, CHAT_TRANSLATION_LANGUAGES, type ChatTranslationLanguage } from '@conai/shared'
import { hasTranslation, resolveProfileModel, type ModelRoleProfile } from './chatModelRoles'
import type { ChatProfile } from './chatProfiles'
import { completeChat, resolveChatCompletionTarget, type ChatCompletionTarget } from './llmChatCompletion'

/**
 * Chats with a translation model talk to the chat model in its language (the profile's `translationModelLanguage`,
 * English unless set): the user's message is translated before it is sent (and stored as what the model sees), and
 * the reply is translated into the display language (`translationDisplayLanguage`, Korean unless set) for the reader.
 * The reader's text is kept beside the model's on the message (`display_content`); the toggle in the transcript shows
 * either.
 *
 * Translation never blocks a chat: when it fails, times out, or would damage the markup the chat relies on, the
 * message goes through untranslated.
 */

const TRANSLATION_TIMEOUT_MS = 90_000

/** The letters each language is written in; the Han characters Japanese borrows count for both. */
const SCRIPTS = {
  hangul: /[ᄀ-ᇿ㄰-㆏가-힯]/g,
  kana: /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/g,
  han: /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g,
  latin: /[A-Za-z\u00c0-\u024f]/g,
} as const
const LANGUAGE_SCRIPTS: Record<ChatTranslationLanguage, Array<keyof typeof SCRIPTS>> = {
  ko: ['hangul'],
  en: ['latin'],
  ja: ['kana', 'han'],
  zh: ['han'],
}

/** The languages a profile translates between (a partial profile, a test double too, falls back to English / Korean). */
export type TranslationLanguages = { translationModelLanguage?: ChatTranslationLanguage; translationDisplayLanguage?: ChatTranslationLanguage }

function languagesOf(profile: TranslationLanguages | null | undefined) {
  return {
    model: profile?.translationModelLanguage ?? CHAT_TRANSLATION_DEFAULTS.modelLanguage,
    display: profile?.translationDisplayLanguage ?? CHAT_TRANSLATION_DEFAULTS.displayLanguage,
  }
}

/** The language's English name, as the prompts name it. */
function languageName(language: ChatTranslationLanguage) {
  return CHAT_TRANSLATION_LANGUAGES.find((entry) => entry.id === language)?.name ?? language
}

const PRESERVE_RULES = [
  'Keep these exactly as they are, character for character, in their original positions:',
  '- fenced code blocks (```...```) including their language tag and everything inside them',
  '- inline code in backticks, URLs, file names, and markdown syntax (headings, lists, emphasis, links, images)',
  '- `@name` mentions, `{{...}}` placeholders, `&*keyword*&` tokens, and `[Name]` speaker tags at the start of a line',
  '- emoji, numbers, and proper names (do not transliterate names)',
  'Keep the paragraph and line structure. Output only the translation, with no preface, notes, or quotation marks.',
].join('\n')

export function userTranslationPrompt(profile?: TranslationLanguages | null) {
  const language = languageName(languagesOf(profile).model)
  return [
    `You translate a chat user's message into natural, fluent ${language} for an AI character to read.`,
    'Preserve the meaning, tone, and register (casual stays casual, polite stays polite); keep roleplay actions in *asterisks* as actions.',
    `If the message is already in ${language}, return it unchanged.`,
    PRESERVE_RULES,
  ].join('\n')
}

/** Who is speaking, and the profile's own notes on its voice (they come after the rules, which still win on markup). */
export function replyTranslationPrompt(profile: TranslationLanguages & { name?: string; translationInstructions?: string }, userName?: string) {
  const display = languagesOf(profile).display
  const language = languageName(display)
  const name = profile.name?.trim()
  const notes = (profile.translationInstructions ?? '').trim()
    .replace(/\{\{char\}\}/gi, name || 'the character')
    .replace(/\{\{user\}\}/gi, userName?.trim() || 'the user')
  return [
    `You translate an AI character's chat reply into natural, fluent ${language} for the reader.`,
    `Match the character's tone and register: casual speech${display === 'ko' ? ' (반말)' : ''} stays casual, polite speech stays polite; keep roleplay actions in *asterisks* as actions.`,
    `If the reply is already in ${language}, return it unchanged.`,
    PRESERVE_RULES,
    ...(name ? [`The speaking character is "${name}".`] : []),
    ...(notes ? ['Notes on this character\'s voice and terms (follow them; the rules above still apply):', notes] : []),
  ].join('\n')
}

/**
 * What the chat model is told about its language when the profile translates: it writes in the model language, whatever
 * the language of the instructions or the greeting, so the reply comes to the translator as the profile expects.
 */
export function modelLanguageGuidance(profile: ModelRoleProfile & TranslationLanguages) {
  if (!hasTranslation(profile)) return ''
  const { model, display } = languagesOf(profile)
  if (model === display) return ''
  const language = languageName(model)
  return `Write every reply in ${language}, whatever language the instructions, the greeting or earlier messages use. The user's messages reach you in ${language}; the app translates your reply for the user.`
}

/**
 * Translating a text into `language` outside a chat (workflow nodes): the same markup rules, then a profile's notes
 * on its voice and terms and the caller's own instructions (the rules still win on markup).
 */
export function textTranslationPrompt(language: string, notes: { profile?: { name?: string; translationInstructions?: string } | null; instructions?: string | null } = {}) {
  const name = notes.profile?.name?.trim()
  const profileNotes = (notes.profile?.translationInstructions ?? '').trim()
    .replace(/\{\{char\}\}/gi, name || 'the character')
    .replace(/\{\{user\}\}/gi, 'the user')
  const instructions = notes.instructions?.trim()
  return [
    `You translate the given text into natural, fluent ${language}.`,
    'Preserve the meaning, tone, and register (casual stays casual, polite stays polite); keep roleplay actions in *asterisks* as actions.',
    `If the text is already in ${language}, return it unchanged.`,
    PRESERVE_RULES,
    ...(profileNotes ? ['Notes on the voice and terms (follow them; the rules above still apply):', profileNotes] : []),
    ...(instructions ? ['More instructions (follow them; the rules above still apply):', instructions] : []),
  ].join('\n')
}

function countMatches(text: string, pattern: RegExp) {
  return (text.match(pattern) ?? []).length
}

/** Letters of the text written in the language's scripts, and in the other scripts known here. */
function letterCounts(text: string, language: ChatTranslationLanguage) {
  const own = new Set(LANGUAGE_SCRIPTS[language])
  let ownLetters = 0
  let otherLetters = 0
  for (const [script, pattern] of Object.entries(SCRIPTS) as Array<[keyof typeof SCRIPTS, RegExp]>) {
    const count = countMatches(text, pattern)
    if (own.has(script)) ownLetters += count
    else otherLetters += count
  }
  return { own: ownLetters, other: otherLetters }
}

/** The connection and model a profile translates with, or null when it does not translate. */
export function translationTargetOf(profile: ModelRoleProfile): ChatCompletionTarget | null {
  const resolved = resolveProfileModel(profile, 'translation')
  if (!resolved) return null
  try {
    return resolveChatCompletionTarget(resolved.providerName, {
      model: resolved.model,
      generation: { temperature: 0.2, reasoningEffort: 'none' },
    })
  } catch (error) {
    // A removed or disabled connection must not stop the chat: it just goes untranslated.
    console.warn('[chat-translation] connection unavailable:', error instanceof Error ? error.message : error)
    return null
  }
}

/** Markup the chat depends on must come out of the translation intact; otherwise the original is shown. */
function keepsMarkup(original: string, translated: string) {
  const checks: RegExp[] = [/```/g, /&\*[^*\n]+\*&/g, /\{\{[^}\n]+\}\}/g, /^[ \t]*\[[^\]\n]{1,40}\]/gm]
  return checks.every((pattern) => countMatches(original, pattern) === countMatches(translated, pattern))
}

async function translate(target: ChatCompletionTarget, system: string, text: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(TRANSLATION_TIMEOUT_MS)
  try {
    const translated = (await completeChat(target, [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ], signal ? AbortSignal.any([signal, timeout]) : timeout, { purpose: 'translation' })).trim()
    if (!translated) return null
    if (!keepsMarkup(text, translated)) {
      console.warn('[chat-translation] translation dropped: markup changed')
      return null
    }
    return translated
  } catch (error) {
    if (!signal?.aborted) console.warn('[chat-translation] translation failed:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * The user's message as the model should see it (in the model language), or null when the chat does not translate,
 * both languages are the same, the text has nothing written in the display language, or the translation failed (the
 * message is then sent as written).
 */
export async function translateUserInput(profile: (ModelRoleProfile & TranslationLanguages) | null | undefined, text: string, signal?: AbortSignal) {
  const target = profile ? translationTargetOf(profile) : null
  const trimmed = text.trim()
  const { model, display } = languagesOf(profile)
  if (!target || !trimmed || model === display || letterCounts(trimmed, display).own === 0) return null
  const translated = await translate(target, userTranslationPrompt(profile), trimmed, signal)
  return translated && translated !== trimmed ? translated : null
}

/**
 * The reply as the reader should see it (in the display language), or null when the chat does not translate, the reply
 * is already mostly in the display language, or the translation failed (the reply is then shown as written). The
 * translator is told who speaks and the profile's translation notes (`userName` fills their `{{user}}`).
 */
export async function translateReply(profile: (ModelRoleProfile & TranslationLanguages & { name?: string; translationInstructions?: string }) | null | undefined, text: string, signal?: AbortSignal, userName?: string) {
  const target = profile ? translationTargetOf(profile) : null
  const trimmed = text.trim()
  if (!profile || !target || !trimmed) return null
  const letters = letterCounts(trimmed, languagesOf(profile).display)
  if (letters.other === 0 || letters.own > letters.other) return null
  const translated = await translate(target, replyTranslationPrompt(profile, userName), trimmed, signal)
  return translated && translated !== trimmed ? translated : null
}

/** Group rooms: the member whose translation model the room's user messages go through (the representative first). */
export function translatorOf(profiles: ChatProfile[]) {
  return profiles.find((profile) => hasTranslation(profile)) ?? null
}
