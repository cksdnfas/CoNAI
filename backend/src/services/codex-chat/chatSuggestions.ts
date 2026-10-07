import { resolveProfileModel } from './chatModelRoles'
import { ChatProfileStore, profileGenerationOptions, type ChatProfile } from './chatProfiles'
import { stripBlockFences, usableBlockKeys } from './chatBlockState'
import { fillCharacterPlaceholders } from './chatPlaceholders'
import { completeChat, isChatTargetReady, resolveChatCompletionTarget, type ChatCompletionTarget } from './llmChatCompletion'
import { ChatUserProfileStore, userPersonaForThread, userPersonaPrompt, type ChatUserPersona, type ChatUserProfile } from './chatUserProfiles'
import { ModelSlotStore } from './modelSlots'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from './codexChatStore'

/**
 * Reply suggestions: the composer's sparkle button asks a model for a few things the user might say next. Nothing
 * is generated until the button is pressed, so a chat that never uses it costs nothing. The call has its own
 * prompt: the user's persona, the character's name, and the last few turns as the reader sees them. The chat's
 * system prompt and lore are left out on purpose; the recent turns carry the scene.
 *
 * Who writes them: a chat profile linked as the writer (another one or the chat's own; its model, and its prompt as
 * extra direction) or a user profile (its model and description), else the profile's suggest role (slot, connection,
 * or the chat's own connection). A Codex profile with none of these asks its own Codex model in a one-shot run.
 */

export const SUGGESTION_COUNT = 3
const SUGGESTION_TIMEOUT_MS = 60_000
/** The chat's own Codex model, asked only for a few short lines. */
const CODEX_SUGGESTION_EFFORT = 'low'
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

/** Who writes the suggestions besides the model: a chat profile (its prompt) or a user profile (its description). */
export type SuggestionWriter = { kind: 'profile'; profile: ChatProfile } | { kind: 'user'; profile: ChatUserProfile }

/** How suggestions are written: an API call or a one-shot Codex run, with the linked writer when there is one. */
export type SuggestionRunner =
  | { kind: 'llm'; target: ChatCompletionTarget; writer: SuggestionWriter | null }
  | { kind: 'codex'; model: string | null; reasoningEffort: string | null; writer: SuggestionWriter | null }

/**
 * The linked writer, or null when none applies: a chat profile that went missing or is off (the profile itself always
 * counts), a user profile of another account (`accountId` given) or one without a model.
 */
export function suggestionWriterOf(profile: ChatProfile, accountId?: number | null): SuggestionWriter | null {
  if (profile.suggestProfileId) {
    const writer = profile.suggestProfileId === profile.id ? profile : ChatProfileStore.find(profile.suggestProfileId)
    return writer && (writer === profile || writer.isEnabled) ? { kind: 'profile', profile: writer } : null
  }
  if (profile.suggestUserProfileId) {
    const writer = ChatUserProfileStore.findById(profile.suggestUserProfileId)
    if (!writer || writer.modelSlotId === null || (accountId !== undefined && writer.accountId !== accountId)) return null
    return { kind: 'user', profile: writer }
  }
  return null
}

function writerRunner(writer: SuggestionWriter): SuggestionRunner | null {
  if (writer.kind === 'user') {
    const slot = ModelSlotStore.target(writer.profile.modelSlotId)
    return slot ? { kind: 'llm', target: resolveChatCompletionTarget(slot.providerName, { model: slot.model, generation: { temperature: 0.9, reasoningEffort: 'none' } }), writer } : null
  }
  const profile = writer.profile
  if (profile.engine === 'codex') return { kind: 'codex', model: profile.model || null, reasoningEffort: profile.reasoningEffort || null, writer }
  const resolved = resolveProfileModel(profile, 'chat')
  if (!resolved) return null
  const generation = profileGenerationOptions(profile)
  return { kind: 'llm', target: resolveChatCompletionTarget(resolved.providerName, { model: resolved.model, generation: { ...generation, temperature: generation.temperature ?? 0.9 } }), writer }
}

/**
 * Who writes a profile's suggestions, or null when they are off or nothing can answer. Throws when the chosen
 * connection cannot be used (missing, or no model). `accountId`: the chat's account (a user profile writes only there).
 */
export function suggestionRunnerOf(profile: ChatProfile, accountId?: number | null): SuggestionRunner | null {
  if (!profile.suggestEnabled) return null
  const writer = suggestionWriterOf(profile, accountId)
  if (writer) return writerRunner(writer)
  const resolved = resolveProfileModel(profile, 'suggest')
  if (resolved) {
    return {
      kind: 'llm',
      target: resolveChatCompletionTarget(resolved.providerName, { model: resolved.model, generation: { temperature: 0.9, reasoningEffort: 'none' } }),
      writer: null,
    }
  }
  return profile.engine === 'codex' ? { kind: 'codex', model: profile.model || null, reasoningEffort: CODEX_SUGGESTION_EFFORT, writer: null } : null
}

/** Whether the composer's suggestion button has someone to ask (a connection that cannot be used counts as none). */
export function canSuggest(profile: ChatProfile, accountId?: number | null) {
  try {
    return suggestionRunnerOf(profile, accountId)?.kind === 'llm'
  } catch {
    return false
  }
}

/** Whether a chat profile could write suggestions: Codex, or an API model whose connection can be used. */
export function profileWriterReady(profile: ChatProfile) {
  if (profile.engine === 'codex') return true
  const resolved = resolveProfileModel(profile, 'chat')
  return resolved !== null && isChatTargetReady(resolved.providerName, resolved.model)
}

/** Whether a user profile could write suggestions: it has a model whose connection can be used. */
export function userWriterReady(profile: Pick<ChatUserProfile, 'modelSlotId'>) {
  const slot = ModelSlotStore.target(profile.modelSlotId)
  return slot !== null && isChatTargetReady(slot.providerName, slot.model)
}

/**
 * The writer's direction: a chat profile's prompt (system prompt and enabled sections) or a user profile's description
 * (left out when it is the chat's own user, whose description is already there).
 */
function writerDirection(writer: SuggestionWriter, character: ChatProfile, user: ChatUserPersona, threadUserProfileId: number | null) {
  let text: string
  let heading: string
  if (writer.kind === 'user') {
    if (writer.profile.id === threadUserProfileId) return ''
    text = writer.profile.persona.trim()
    heading = `## 추천 지시 (${writer.profile.name})`
  } else {
    const sections = writer.profile.promptSections
      .filter((section) => section.enabled && section.content.trim())
      .map((section) => (section.title ? `### ${section.title}\n${section.content}` : section.content))
    text = [writer.profile.systemPrompt, ...sections].map((part) => part.trim()).filter(Boolean).join('\n\n')
    // The chat's own profile as the writer: its card is about the character, not direction.
    heading = writer.profile.id === character.id ? `## 캐릭터 설정 (${character.name})` : `## 추천 지시 (${writer.profile.name})`
  }
  // {{char}} is the character the user talks to, {{user}} the user the options are written for.
  return text ? [heading, fillCharacterPlaceholders(text, character, user)].join('\n') : ''
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
  let runner: SuggestionRunner | null
  try {
    runner = suggestionRunnerOf(profile, thread.account_id)
  } catch (error) {
    throw new ChatSuggestError(`추천 모델 연결을 쓸 수 없어: ${error instanceof Error ? error.message : String(error)}`, 409)
  }
  if (!runner) throw new ChatSuggestError(profile.suggestEnabled ? '이 프로필에는 추천에 쓸 연결이 없어. 프로필 설정에서 추천 연결을 골라줘.' : '이 프로필은 답장 추천을 안 써.', 409)
  if (runner.kind === 'codex') throw new ChatSuggestError('Codex 단독 실행은 채팅에서 사용할 수 없어. 답장 추천에는 API LLM 연결을 골라줘.', 409)

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
    runner.writer ? writerDirection(runner.writer, profile, user, thread.user_profile_id ?? null) : '',
  ].filter(Boolean).join('\n')
  const prompt = `${transcript}\n\n---\n${user.name}이(가) 다음에 할 말 ${SUGGESTION_COUNT}개를 JSON 배열로.`

  const timeout = AbortSignal.timeout(SUGGESTION_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let answer: string
  try {
    answer = await completeChat(runner.target, [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ], combined)
  } catch (error) {
    if (signal?.aborted) throw new ChatSuggestError('추천을 멈췄어.', 499)
    if (timeout.aborted) throw new ChatSuggestError('추천이 너무 오래 걸려서 멈췄어.', 504)
    throw new ChatSuggestError(`추천을 받지 못했어: ${error instanceof Error ? error.message : String(error)}`, 502)
  }
  const suggestions = parseSuggestions(answer)
  if (suggestions.length === 0) throw new ChatSuggestError('모델이 쓸 만한 추천을 주지 않았어. 다시 뽑아봐.', 502)
  return suggestions
}
