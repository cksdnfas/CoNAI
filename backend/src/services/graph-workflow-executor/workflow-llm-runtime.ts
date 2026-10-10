import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { ChatProfileStore, profileGenerationOptions, type ChatProfile } from '../codex-chat/chatProfiles'
import { resolveChatAccess } from '../codex-chat/codexChatAccess'
import { resolveProfileModel } from '../codex-chat/chatModelRoles'
import { slotContentLimit } from '../codex-chat/chatContentRating'
import { imageDataUrlAllowed } from '../contentRating'
import { stripThinking } from '../codex-chat/llmChatContext'
import {
  resolveChatCompletionTarget,
  streamChatCompletion,
  type ChatCompletionMessage,
  type ChatCompletionTarget,
  type ChatContentPart,
} from '../codex-chat/llmChatCompletion'
import { LLM_CONNECTION_TYPES, ModelSlotStore } from '../codex-chat/modelSlots'
import { executeCodexMessageRequest } from '../codexMessageService'
import {
  isClaudeReasoningEffort,
  isLlmReasoningEffort,
  type LlmGenerationOptions,
  type LlmThinkingSwitch,
} from '../llmGenerationOptions'
import {
  buildJsonInstruction,
  buildUserPrompt,
  normalizeStructuredOutputJson,
  normalizeVisionImageDataUrl,
  parseRequestedJson,
  type LlmResponseMode,
} from '../llmProviderService'
import { retryLlmRequest } from '../llmRequestRetry'
import { normalizeOptionalString } from '../../utils/valueNormalization'

/**
 * How workflow nodes talk to a model, the same way chat does. A node names a model row (★ default when empty), a chat
 * profile, or both: the profile brings its engine (API LLM, Claude Code, Codex), model and generation options, a row
 * replaces an API profile's model, and the node's own temperature / output limit / reasoning win over both. Graphs
 * saved before rows still name a connection + model (`legacy`). Every request goes into the usage ledger as
 * `workflow`, with the profile when there is one.
 */

export type WorkflowLlmRole = 'chat' | 'translation' | 'summary'

export type WorkflowLlmTarget = {
  profileId?: number | null
  /** The account that started the run: a profile limited to some groups has to be usable by it. */
  requesterAccountId?: number | null
  modelSlotId?: number | null
  /** The profile's model role to use (its translation / summary row; the chat model when it has none). */
  role?: WorkflowLlmRole
  legacy?: { providerName: string | null; model: string | null } | null
}

export type WorkflowLlmOverrides = {
  temperature?: number | null
  maxTokens?: number | null
  reasoningEffort?: string | null
}

export type ResolvedWorkflowLlm =
  | {
    engine: 'api' | 'claude-code'
    providerName: string
    model: string
    label: string
    via: 'slot' | 'profile' | 'default' | 'legacy'
    profile: ChatProfile | null
    modelSlotId: number | null
    /** The profile's generation options (empty without a profile). */
    profileGeneration: LlmGenerationOptions
  }
  | {
    engine: 'codex'
    model: string | null
    reasoningEffort: string | null
    label: string
    via: 'profile'
    profile: ChatProfile
    modelSlotId: null
  }

function apiTargetOfRow(slotId: number, profile: ChatProfile | null, via: 'slot' | 'default'): ResolvedWorkflowLlm {
  const row = ModelSlotStore.target(slotId)
  if (!row) throw new Error(`모델을 찾을 수 없어 (지워졌을 수 있어): ${slotId}`)
  const type = ExternalApiProvider.findByName(row.providerName)?.provider_type
  if (type && !LLM_CONNECTION_TYPES.includes(type)) throw new Error(`판단 전용 모델은 여기서 쓸 수 없어: ${row.label}`)
  return {
    engine: 'api',
    providerName: row.providerName,
    model: row.model,
    label: row.label,
    via,
    profile,
    modelSlotId: row.id,
    // A Claude Code / Codex profile's options belong to its engine, not to an API row it borrows for a role.
    profileGeneration: profile && profile.engine === 'llm' ? profileGenerationOptions(profile) : {},
  }
}

function defaultTarget(profile: ChatProfile | null): ResolvedWorkflowLlm {
  const row = ModelSlotStore.defaultTarget()
  if (!row) throw new Error('기본 모델이 없어. 설정 › LLM에서 ★ 기본 모델을 정하거나 노드에서 모델을 골라줘.')
  return apiTargetOfRow(row.id, profile, 'default')
}

/** The chat role of a profile: Claude Code, Codex, or its API model row (the default row when it has none). */
function profileChatTarget(profile: ChatProfile): ResolvedWorkflowLlm {
  if (profile.engine === 'codex') {
    return {
      engine: 'codex',
      model: normalizeOptionalString(profile.model),
      reasoningEffort: normalizeOptionalString(profile.reasoningEffort),
      label: `Codex · ${profile.model || '기본 모델'}`,
      via: 'profile',
      profile,
      modelSlotId: null,
    }
  }
  const resolved = resolveProfileModel(profile, 'chat')
  if (!resolved) throw new Error(`프로필에 모델이 없어: ${profile.name}`)
  return {
    engine: resolved.via === 'engine' ? 'claude-code' : 'api',
    providerName: resolved.providerName,
    model: resolved.model,
    label: resolved.label,
    via: 'profile',
    profile,
    modelSlotId: resolved.slotId,
    profileGeneration: profileGenerationOptions(profile),
  }
}

/**
 * Whether the run's account may use a profile limited to some groups (administrators always may). Runs without an
 * account (schedules, or no accounts configured) are not group-checked.
 */
export function isProfileAllowedForRun(profile: ChatProfile, requesterAccountId: number | null | undefined) {
  if (requesterAccountId === null || requesterAccountId === undefined || profile.allowedGroupKeys.length === 0) return true
  const access = resolveChatAccess(requesterAccountId)
  return access.isAdmin || profile.allowedGroupKeys.some((key) => access.groupKeys.includes(key))
}

/** A chat profile a node names: it has to exist, be on, and be usable by the run's account. */
export function requireWorkflowProfile(profileId: number, requesterAccountId: number | null = null): ChatProfile {
  const profile = ChatProfileStore.find(profileId)
  if (!profile) throw new Error(`채팅 프로필을 찾을 수 없어: ${profileId}`)
  if (!profile.isEnabled) throw new Error(`꺼진 프로필이야: ${profile.name}`)
  if (!isProfileAllowedForRun(profile, requesterAccountId)) throw new Error(`이 프로필은 실행한 계정이 쓸 수 없어: ${profile.name}`)
  return profile
}

/** Which model a node request goes to (see the module comment); throws a readable error when there is none. */
export function resolveWorkflowLlm(target: WorkflowLlmTarget): ResolvedWorkflowLlm {
  const profile = target.profileId !== null && target.profileId !== undefined ? requireWorkflowProfile(target.profileId, target.requesterAccountId ?? null) : null

  // A row replaces an API profile's model; Claude Code / Codex profiles keep their engine's own model.
  if (target.modelSlotId !== null && target.modelSlotId !== undefined && (!profile || profile.engine === 'llm')) {
    return apiTargetOfRow(target.modelSlotId, profile, 'slot')
  }

  if (profile) {
    const role = target.role ?? 'chat'
    if (role !== 'chat') {
      const resolved = resolveProfileModel(profile, role)
      if (resolved && resolved.via !== 'engine' && resolved.slotId !== null) {
        return { ...apiTargetOfRow(resolved.slotId, profile, 'slot'), via: 'profile' }
      }
    }
    return profileChatTarget(profile)
  }

  const legacyProvider = normalizeOptionalString(target.legacy?.providerName)
  if (legacyProvider) {
    const model = normalizeOptionalString(target.legacy?.model)
    const resolved = resolveChatCompletionTarget(legacyProvider, { model })
    return {
      engine: 'api',
      providerName: resolved.providerName,
      model: resolved.model,
      label: `${resolved.displayName} · ${resolved.model}`,
      via: 'legacy',
      profile: null,
      modelSlotId: null,
      profileGeneration: {},
    }
  }

  return defaultTarget(null)
}

export type WorkflowLlmRequest = {
  target: WorkflowLlmTarget
  systemPrompt?: string | null
  prompt?: string | null
  context?: string | null
  /** An image data URL sent with the prompt (any model; one that cannot see images refuses it). */
  image?: string | null
  /** An example / schema the answer should match; turns the answer into JSON (text or an object). */
  structuredOutputJson?: unknown
  /** The node's own options; they win over the profile's and over `generation`. */
  overrides?: WorkflowLlmOverrides
  /**
   * Generation options for this kind of request instead of the profile's (e.g. translation runs cool and without
   * thinking); gets the profile's options and the connection's thinking switch.
   */
  generation?: (context: { profileGeneration: LlmGenerationOptions; thinkingSwitch?: LlmThinkingSwitch }) => LlmGenerationOptions
  /** A conversation built by the caller instead of system prompt + context + prompt (character replies). */
  messages?: ChatCompletionMessage[]
  /** Codex engine: the first line of its prompt (what the run is for). */
  task?: string
  signal?: AbortSignal
}

export type WorkflowLlmResult = {
  text: string
  json: unknown | null
  engine: 'api' | 'claude-code' | 'codex'
  providerName: string
  model: string
  metadata: Record<string, unknown>
}

function structuredOutputText(value: unknown) {
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2)
  return normalizeStructuredOutputJson(value)
}

function applyOverrides(base: LlmGenerationOptions, engine: 'api' | 'claude-code', overrides: WorkflowLlmOverrides | undefined): LlmGenerationOptions {
  const next = { ...base }
  if (typeof overrides?.temperature === 'number' && Number.isFinite(overrides.temperature)) next.temperature = overrides.temperature
  if (typeof overrides?.maxTokens === 'number' && Number.isFinite(overrides.maxTokens) && overrides.maxTokens > 0) next.maxTokens = Math.round(overrides.maxTokens)
  const effort = normalizeOptionalString(overrides?.reasoningEffort)
  if (effort && (engine === 'claude-code' ? isClaudeReasoningEffort(effort) : isLlmReasoningEffort(effort))) next.reasoningEffort = effort as LlmGenerationOptions['reasoningEffort']
  return next
}

/**
 * A caller-built conversation as one Codex prompt: the system part, the earlier turns as context, the last user turn
 * (with its image, when it has one).
 */
function flattenForCodex(messages: ChatCompletionMessage[]) {
  const textOf = (content: ChatCompletionMessage['content']) => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content.filter((part): part is Extract<ChatContentPart, { type: 'text' }> => part.type === 'text').map((part) => part.text).join('\n')
  }
  const system = messages.filter((message) => message.role === 'system').map((message) => textOf(message.content)).join('\n\n')
  const turns = messages.filter((message) => message.role === 'user' || message.role === 'assistant')
  const last = turns.at(-1)
  const lastUser = last?.role === 'user' ? textOf(last.content) : ''
  const image = last?.role === 'user' && Array.isArray(last.content)
    ? last.content.find((part): part is Extract<ChatContentPart, { type: 'image_url' }> => part.type === 'image_url')?.image_url.url ?? null
    : null
  const earlier = (last?.role === 'user' ? turns.slice(0, -1) : turns)
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${textOf(message.content)}`)
    .join('\n\n')
  return { systemPrompt: system || null, context: earlier || null, prompt: lastUser || earlier, image }
}

/**
 * Refuses a request whose images are above the target model's content rating ceiling: the profile's own when it sets
 * one, else the model row's. Workflow images are bytes without a library record, so they are rated here.
 */
async function assertImagesWithinRating(resolved: ResolvedWorkflowLlm, request: WorkflowLlmRequest) {
  const profile = resolved.profile
  const limit = profile && (profile.contentRatingMode === 'custom' || profile.engine !== 'llm') ? profile.contentRatingTierId : slotContentLimit(resolved.modelSlotId)
  if (limit === null) return
  // Only data URLs are ever sent (the request drops anything else).
  const images = [
    normalizeOptionalString(request.image),
    ...(request.messages ?? []).flatMap((message) => Array.isArray(message.content)
      ? message.content.filter((part): part is Extract<ChatContentPart, { type: 'image_url' }> => part.type === 'image_url').map((part) => part.image_url.url)
      : []),
  ].filter((url): url is string => Boolean(url && /^data:image\//i.test(url.trim())))
  for (const image of images) {
    if (!await imageDataUrlAllowed(image, limit)) throw new Error('이미지가 이 모델의 허용 등급을 넘어서 보낼 수 없어')
  }
}

/** One request through the chat completion path (or Codex exec for Codex profiles). */
export async function runWorkflowLlmText(request: WorkflowLlmRequest): Promise<WorkflowLlmResult> {
  const resolved = resolveWorkflowLlm(request.target)
  await assertImagesWithinRating(resolved, request)
  const structuredOutputJson = structuredOutputText(request.structuredOutputJson)
  const responseMode: LlmResponseMode = structuredOutputJson ? 'json' : 'text'
  const prompt = normalizeOptionalString(request.prompt) ?? ''
  if (!request.messages && !prompt) throw new Error('LLM 프롬프트가 비어 있어')
  const usageProfileId = resolved.profile?.id ?? null

  if (resolved.engine === 'codex') {
    const flat = request.messages ? flattenForCodex(request.messages) : null
    const effort = normalizeOptionalString(request.overrides?.reasoningEffort)
    const result = await executeCodexMessageRequest({
      prompt: flat ? flat.prompt : prompt,
      systemPrompt: flat ? flat.systemPrompt : normalizeOptionalString(request.systemPrompt),
      context: flat ? flat.context : normalizeOptionalString(request.context),
      image: flat ? flat.image : normalizeOptionalString(request.image),
      model: resolved.model,
      reasoningEffort: effort ?? resolved.reasoningEffort,
      task: request.task ?? null,
      cleanup: true,
      responseMode,
      structuredOutputJson,
      shouldCancel: () => request.signal?.aborted === true,
      usage: { purpose: 'workflow', profileId: usageProfileId },
    })
    request.signal?.throwIfAborted()
    return {
      text: result.text,
      json: result.json,
      engine: 'codex',
      providerName: 'codex',
      model: resolved.model ?? '',
      metadata: {
        engine: 'codex',
        model: resolved.model,
        model_label: resolved.label,
        profile_id: usageProfileId,
        response_mode: result.responseMode,
        session_id: result.metadata.session_id ?? null,
      },
    }
  }

  const base = resolveChatCompletionTarget(resolved.providerName, { model: resolved.model })
  const generation = applyOverrides(
    request.generation ? request.generation({ profileGeneration: resolved.profileGeneration, thinkingSwitch: base.thinkingSwitch }) : resolved.profileGeneration,
    resolved.engine,
    request.overrides,
  )
  const target: ChatCompletionTarget = { ...base, generation }

  const image = await normalizeVisionImageDataUrl(request.image)
  let messages: ChatCompletionMessage[]
  if (request.messages) {
    messages = request.messages
  } else {
    const system = [normalizeOptionalString(request.systemPrompt), buildJsonInstruction(responseMode, structuredOutputJson)].filter(Boolean).join('\n\n')
    const userText = buildUserPrompt(prompt, normalizeOptionalString(request.context))
    messages = [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      { role: 'user', content: image ? [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: image } }] : userText },
    ]
  }

  const signal = request.signal ?? new AbortController().signal
  const result = await retryLlmRequest(() => streamChatCompletion({
    target,
    messages,
    signal,
    // A stuck loop is cut like in chat; JSON answers are left whole (a list may legitimately repeat an item).
    stopLoops: responseMode === 'text',
    usage: { purpose: 'workflow', profileId: usageProfileId },
  }), { signal })
  const text = stripThinking(result.content).trim()
  if (!text) throw new Error(`LLM이 빈 답을 보냈어: ${resolved.label}`)
  const parsed = parseRequestedJson(text, responseMode)

  return {
    text,
    json: parsed.value,
    engine: resolved.engine,
    providerName: target.providerName,
    model: target.model,
    metadata: {
      engine: resolved.engine,
      provider_name: target.providerName,
      provider_display_name: target.displayName,
      model: target.model,
      model_label: resolved.label,
      model_via: resolved.via,
      model_slot_id: resolved.modelSlotId,
      profile_id: usageProfileId,
      response_mode: responseMode,
      has_json: parsed.value !== null,
      json_parse_strategy: parsed.strategy,
      structured_output_json: structuredOutputJson,
      has_image: Boolean(image),
      finish_reason: result.finishReason,
      usage: result.usage ?? null,
    },
  }
}
