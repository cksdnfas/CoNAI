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

const codeBlockToken = (index: number) => `{{code-block-${index + 1}}}`

/**
 * Fenced code blocks (``` or ~~~, an unclosed one runs to the end) swapped for `{{code-block-N}}` lines: the
 * translator never sees code, so it can neither translate it nor break its fences.
 */
export function maskCodeBlocks(text: string): { text: string; blocks: string[] } {
  const lines = text.split('\n')
  const kept: string[] = []
  const blocks: string[] = []
  for (let index = 0; index < lines.length; index++) {
    const fence = /^[ \t]*(`{3,}|~{3,})/.exec(lines[index])?.[1]
    if (!fence) { kept.push(lines[index]); continue }
    const close = new RegExp(`^[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`)
    let end = index + 1
    while (end < lines.length && !close.test(lines[end])) end++
    blocks.push(lines.slice(index, end + 1).join('\n'))
    kept.push(codeBlockToken(blocks.length - 1))
    index = end
  }
  return { text: kept.join('\n'), blocks }
}

/** The text without its code blocks: code is never translated, so only the prose decides whether a text needs it. */
function proseOf(text: string) {
  return maskCodeBlocks(text).text.replace(/\{\{code-block-\d+\}\}/g, '')
}

/** The masked blocks put back; null when the translation lost or repeated a placeholder. */
export function restoreCodeBlocks(text: string, blocks: string[]): string | null {
  let result = text
  for (const [index, block] of blocks.entries()) {
    const parts = result.split(codeBlockToken(index))
    if (parts.length !== 2) return null
    result = parts.join(block)
  }
  return result
}

/**
 * The masked text split before the code blocks it ends with (a reply's status block): those placeholders are not sent
 * at all, so a translator that drops or rewrites the last line cannot cost the whole translation.
 */
function splitTrailingBlocks(masked: string) {
  const match = /(?:\s*\{\{code-block-\d+\}\})+\s*$/.exec(masked)
  return match ? { body: masked.slice(0, match.index), tail: masked.slice(match.index) } : { body: masked, tail: '' }
}

async function translate(target: ChatCompletionTarget, system: string, text: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(TRANSLATION_TIMEOUT_MS)
  try {
    const masked = maskCodeBlocks(text)
    const { body, tail } = splitTrailingBlocks(masked.text)
    if (!body.trim()) return null
    const answer = (await completeChat(target, [
      { role: 'system', content: system },
      { role: 'user', content: body },
    ], signal ? AbortSignal.any([signal, timeout]) : timeout, { purpose: 'translation' })).trim()
    if (!answer) return null
    const output = answer + tail
    const translated = keepsMarkup(masked.text, output) ? restoreCodeBlocks(output, masked.blocks) : null
    if (translated === null) {
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
  if (!target || !trimmed || model === display || letterCounts(proseOf(trimmed), display).own === 0) return null
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
  const letters = letterCounts(proseOf(trimmed), languagesOf(profile).display)
  if (letters.other === 0 || letters.own > letters.other) return null
  const translated = await translate(target, replyTranslationPrompt(profile, userName), trimmed, signal)
  return translated && translated !== trimmed ? translated : null
}

/** Group rooms: the member whose translation model the room's user messages go through (the representative first). */
export function translatorOf(profiles: ChatProfile[]) {
  return profiles.find((profile) => hasTranslation(profile)) ?? null
}
