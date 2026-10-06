import { hasTranslation, resolveProfileModel, type ModelRoleProfile } from './chatModelRoles'
import type { ChatProfile } from './chatProfiles'
import { completeChat, resolveChatCompletionTarget, type ChatCompletionTarget } from './llmChatCompletion'

/**
 * Chats with a translation model talk to the chat model in English: the user's message is translated before it is
 * sent (and stored as what the model sees), and the reply is translated to Korean for the reader. The reader's text
 * is kept beside the model's on the message (`display_content`); the toggle in the transcript shows either.
 *
 * Translation never blocks a chat: when it fails, times out, or would damage the markup the chat relies on, the
 * message goes through untranslated.
 */

const TRANSLATION_TIMEOUT_MS = 90_000
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/g
const LATIN = /[A-Za-z]/g

const PRESERVE_RULES = [
  'Keep these exactly as they are, character for character, in their original positions:',
  '- fenced code blocks (```...```) including their language tag and everything inside them',
  '- inline code in backticks, URLs, file names, and markdown syntax (headings, lists, emphasis, links, images)',
  '- `@name` mentions, `{{...}}` placeholders, `&*keyword*&` tokens, and `[Name]` speaker tags at the start of a line',
  '- emoji, numbers, and proper names (do not transliterate names)',
  'Keep the paragraph and line structure. Output only the translation, with no preface, notes, or quotation marks.',
].join('\n')

const TO_MODEL_PROMPT = [
  'You translate a chat user\'s message into natural, fluent English for an AI character to read.',
  'Preserve the meaning, tone, and register (casual stays casual, polite stays polite); keep roleplay actions in *asterisks* as actions.',
  'If the message is already in English, return it unchanged.',
  PRESERVE_RULES,
].join('\n')

const TO_DISPLAY_PROMPT = [
  'You translate an AI character\'s chat reply from English into natural, fluent Korean for the reader.',
  'Match the character\'s tone and register: casual speech (반말) stays casual, polite speech stays polite; keep roleplay actions in *asterisks* as actions.',
  'If the reply is already in Korean, return it unchanged.',
  PRESERVE_RULES,
].join('\n')

/** Who is speaking, and the profile's own notes on its voice (they come after the rules, which still win on markup). */
export function replyTranslationPrompt(profile: { name?: string; translationInstructions?: string }, userName?: string) {
  const name = profile.name?.trim()
  const notes = (profile.translationInstructions ?? '').trim()
    .replace(/\{\{char\}\}/gi, name || 'the character')
    .replace(/\{\{user\}\}/gi, userName?.trim() || 'the user')
  return [
    TO_DISPLAY_PROMPT,
    ...(name ? [`The speaking character is "${name}".`] : []),
    ...(notes ? ['Notes on this character\'s voice and terms (follow them; the rules above still apply):', notes] : []),
  ].join('\n')
}

function countMatches(text: string, pattern: RegExp) {
  return (text.match(pattern) ?? []).length
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
    ], signal ? AbortSignal.any([signal, timeout]) : timeout)).trim()
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
 * The user's message as the model should see it (English), or null when the chat does not translate, the text has no
 * Korean to translate, or the translation failed (the message is then sent as written).
 */
export async function translateUserInput(profile: ModelRoleProfile | null | undefined, text: string, signal?: AbortSignal) {
  const target = profile ? translationTargetOf(profile) : null
  const trimmed = text.trim()
  if (!target || !trimmed || countMatches(trimmed, HANGUL) === 0) return null
  const translated = await translate(target, TO_MODEL_PROMPT, trimmed, signal)
  return translated && translated !== trimmed ? translated : null
}

/**
 * The reply as the reader should see it (Korean), or null when the chat does not translate, the reply is already
 * mostly Korean, or the translation failed (the reply is then shown as written). The translator is told who speaks
 * and the profile's translation notes (`userName` fills their `{{user}}`).
 */
export async function translateReply(profile: (ModelRoleProfile & { name?: string; translationInstructions?: string }) | null | undefined, text: string, signal?: AbortSignal, userName?: string) {
  const target = profile ? translationTargetOf(profile) : null
  const trimmed = text.trim()
  if (!profile || !target || !trimmed || countMatches(trimmed, LATIN) === 0 || countMatches(trimmed, HANGUL) > countMatches(trimmed, LATIN)) return null
  const translated = await translate(target, replyTranslationPrompt(profile, userName), trimmed, signal)
  return translated && translated !== trimmed ? translated : null
}

/** Group rooms: the member whose translation model the room's user messages go through (the representative first). */
export function translatorOf(profiles: ChatProfile[]) {
  return profiles.find((profile) => hasTranslation(profile)) ?? null
}
