import { resolveProfileModel, type ModelRoleProfile } from './chatModelRoles'
import type { ChatProfile } from './chatProfiles'
import { stripBlockFences, usableBlockKeys } from './chatBlockState'
import { completeChat, resolveChatCompletionTarget, type ChatCompletionTarget } from './llmChatCompletion'
import { userPersonaForThread, userPersonaPrompt } from './chatUserProfiles'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from './codexChatStore'

/**
 * Reply suggestions: the composer's sparkle button asks a model for a few things the user might say next. Nothing
 * is generated until the button is pressed, so a chat that never uses it costs nothing. The call has its own
 * prompt: the user's persona, the character's name, and the last few turns as the reader sees them. The chat's
 * system prompt and lore are left out on purpose; the recent turns carry the scene.
 */

export const SUGGESTION_COUNT = 3
const SUGGESTION_TIMEOUT_MS = 60_000
const TRANSCRIPT_TURNS = 12
const TURN_MAX_CHARS = 1200
const SUGGESTION_MAX_CHARS = 300

export class ChatSuggestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

const SYSTEM_PROMPT = [
  `You suggest what the user might say next in a chat with an AI character. Write ${SUGGESTION_COUNT} options from the user's side, in the user's own voice, as if they typed them.`,
  'Keep each option short (one or two sentences) and make them differ in direction: for example one spoken line, one action, one question or a different tone. Every option must fit the scene as it stands and the user described below.',
  'Match the language and register of the user\'s recent messages (Korean casual speech stays Korean casual). In roleplay, write actions in *asterisks* and spoken lines in double quotes, the way the user does.',
  'Never answer for the character, never narrate the character\'s side, and do not repeat what the user already said.',
  'Output only a JSON array of strings, nothing else.',
].join('\n')

/** The connection and model a profile suggests with, or null when suggestions are off or no connection applies. */
export function suggestionTargetOf(profile: ModelRoleProfile & Pick<ChatProfile, 'suggestEnabled'>): ChatCompletionTarget | null {
  if (!profile.suggestEnabled) return null
  const resolved = resolveProfileModel(profile, 'suggest')
  if (!resolved) return null
  return resolveChatCompletionTarget(resolved.providerName, {
    model: resolved.model,
    generation: { temperature: 0.9, reasoningEffort: 'none' },
  })
}

function readerText(message: CodexChatMessageRecord, keys: ReadonlySet<string>) {
  const text = (message.display_content || message.content || '').trim()
  const stripped = message.role === 'assistant' ? stripBlockFences(text, keys) : text
  // The app's own reply labels are not part of what was said.
  const clean = stripped.replace(/^\[message_id=[^\]\n]*\]\n?/gm, '').trim()
  return clean.length > TURN_MAX_CHARS ? `…${clean.slice(-TURN_MAX_CHARS)}` : clean
}

/** The last turns as `Name: text` lines (the reader's text, without block fences), oldest first. */
export function buildSuggestionTranscript(messages: CodexChatMessageRecord[], userName: string, nameOf: (message: CodexChatMessageRecord) => string, keys: ReadonlySet<string>) {
  return messages
    .filter((message) => message.status === 'completed')
    .slice(-TRANSCRIPT_TURNS)
    .map((message) => ({ name: message.role === 'user' ? userName : nameOf(message), text: readerText(message, keys) }))
    .filter((turn) => turn.text)
    .map((turn) => `${turn.name}: ${turn.text}`)
    .join('\n\n')
}

/** The model's answer as a list of suggestions: a JSON array of strings, or lines when it slipped. */
export function parseSuggestions(text: string): string[] {
  const trimmed = text.trim()
  let items: unknown[] = []
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1))
      if (Array.isArray(parsed)) items = parsed
    } catch {
      items = []
    }
  }
  if (items.length === 0) {
    items = trimmed.split('\n').map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean)
  }
  const seen = new Set<string>()
  const suggestions: string[] = []
  for (const item of items) {
    const value = typeof item === 'string' ? item : item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text : ''
    const clean = value.replace(/\s+/g, ' ').trim().slice(0, SUGGESTION_MAX_CHARS)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    suggestions.push(clean)
    if (suggestions.length === SUGGESTION_COUNT) break
  }
  return suggestions
}

/**
 * A few things the user might say next in this thread. `profile` is the chat's profile (a room's representative);
 * `nameOf` names the speaker of a reply (rooms have several). Throws ChatSuggestError when the profile has no
 * suggestion model, the model answered nothing usable, or the call failed.
 */
export async function suggestReplies(profile: ChatProfile, thread: CodexChatThreadRecord, messages: CodexChatMessageRecord[], nameOf: (message: CodexChatMessageRecord) => string, signal?: AbortSignal) {
  let target: ChatCompletionTarget | null
  try {
    target = suggestionTargetOf(profile)
  } catch (error) {
    throw new ChatSuggestError(`추천 모델 연결을 쓸 수 없어: ${error instanceof Error ? error.message : String(error)}`, 409)
  }
  if (!target) throw new ChatSuggestError(profile.suggestEnabled ? '이 프로필에는 추천에 쓸 연결이 없어. 프로필 설정에서 추천 연결을 골라줘.' : '이 프로필은 답장 추천을 안 써.', 409)

  const user = userPersonaForThread(thread)
  const transcript = buildSuggestionTranscript(messages, user.name, nameOf, usableBlockKeys(profile.style.blocks))
  if (!transcript) throw new ChatSuggestError('아직 대화가 없어서 추천할 게 없어.', 409)

  const system = [
    SYSTEM_PROMPT,
    '',
    '## 캐릭터',
    `이름: ${profile.name}`,
    profile.tagline ? profile.tagline : '',
    userPersonaPrompt(user),
  ].filter(Boolean).join('\n')
  const prompt = `${transcript}\n\n---\n${user.name}이(가) 다음에 할 말 ${SUGGESTION_COUNT}개를 JSON 배열로.`

  const timeout = AbortSignal.timeout(SUGGESTION_TIMEOUT_MS)
  let answer: string
  try {
    answer = await completeChat(target, [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ], signal ? AbortSignal.any([signal, timeout]) : timeout)
  } catch (error) {
    if (signal?.aborted) throw new ChatSuggestError('추천을 멈췄어.', 499)
    throw new ChatSuggestError(`추천을 받지 못했어: ${error instanceof Error ? error.message : String(error)}`, 502)
  }
  const suggestions = parseSuggestions(answer)
  if (suggestions.length === 0) throw new ChatSuggestError('모델이 쓸 만한 추천을 주지 않았어. 다시 뽑아봐.', 502)
  return suggestions
}
