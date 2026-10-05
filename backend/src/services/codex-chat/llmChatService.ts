import { validateChatMediaAttachments } from './chatMediaAttachments'
import type { ChatExecutionContext } from '@conai/shared'
import { isCodexChatCreationTool } from '@conai/shared'
import { beginDirectReply, userReplyRouting } from './chatReplies'
import type { McpRequester } from '../../mcp/context'
import type { LlmGenerationOptions } from '../llmGenerationOptions'
import { retryLlmRequest } from '../llmRequestRetry'
import { profileGenerationOptions } from './chatProfiles'
import { validateChatAttachments } from './chatAttachments'
import { ChatFlagStore, parseFlagIds, parsePicks } from './chatFlags'
import { openChatMcpBridge, type ChatMcpBridge } from './chatMcpBridge'
import { readMcpToolResult, truncateToolSummary } from './chatToolReferences'
import { ChatProfileStore, pickChatGreeting, type ChatProfile } from './chatProfiles'
import { translateReply, translateUserInput } from './chatTranslation'
import { ChatUserProfileStore, userPersonaOf } from './chatUserProfiles'
import { loadChatSettings } from './chatSettings'
import { intersectChatScopes, resolveChatAccess } from './codexChatAccess'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord, type CodexChatToolCall } from './codexChatStore'
import type { CodexChatStreamEvent } from './codexChatService'
import { resolveChatCompletionTarget, streamChatCompletion, type ChatCompletionMessage, type ChatCompletionTool } from './llmChatCompletion'
import { assertChatContextFits, buildChatMessages, fillCharacterPlaceholders, fitThreadSummary, rawMessagesEstimate, recordPromptUsage, resolveContextConfig, stripThinking, summarizeAhead, summarizeAll } from './llmChatContext'

/** Tool output kept on the stored call for replay; the model gets more of it within the reply itself. */
const STORED_TOOL_OUTPUT_LENGTH = 4000
const STOP_WAIT_MS = 8000

export class LlmChatError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

type LlmTurn = {
  chatContext?: ChatExecutionContext
  delivery?: ReturnType<typeof beginDirectReply>
  threadId: number
  replacingMessageId?: number
  controller: AbortController
  /** Reply text across tool rounds, separated by blank lines. */
  text: string
  reasoning: string
  toolCalls: Map<string, CodexChatToolCall>
  offeredTools: ChatCompletionTool[]
  /** The provider's finish_reason of the last round ('length': the token cap cut the reply). */
  finishReason: string | null
  listeners: Set<(event: CodexChatStreamEvent) => void>
  finished: Promise<CodexChatMessageRecord>
}

const activeTurns = new Map<number, LlmTurn>()

function emit(turn: LlmTurn, event: CodexChatStreamEvent) {
  for (const listener of turn.listeners) {
    try {
      listener(event)
    } catch {
      // A closed response must not break the turn.
    }
  }
}

export function assertLlmChatAvailable(requester: McpRequester) {
  if (!loadChatSettings().enabled) {
    throw new LlmChatError('채팅이 꺼져 있어.', 403)
  }
  if (!resolveChatAccess(requester.accountId).llm) {
    throw new LlmChatError('LLM 채팅 권한이 없어.', 403)
  }
}

function requireUsableProfile(profileId: number | null) {
  const profile = profileId === null ? null : ChatProfileStore.find(profileId)
  if (!profile || profile.engine !== 'llm') {
    throw new LlmChatError('이 채팅의 프로필이 지워졌어.', 409)
  }
  if (!profile.isEnabled) {
    throw new LlmChatError('이 채팅의 프로필이 꺼져 있어.', 409)
  }
  return profile
}

function parseArguments(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/** Image parts of an MCP result (e.g. view_images), as data URLs. */
function readToolImages(result: { content?: unknown[] }) {
  return (result.content ?? []).flatMap((part) => {
    const record = part as { type?: unknown; data?: unknown; mimeType?: unknown } | null
    return record?.type === 'image' && typeof record.data === 'string' && typeof record.mimeType === 'string'
      ? [`data:${record.mimeType};base64,${record.data}`]
      : []
  })
}

async function runToolCall(turn: LlmTurn, bridge: ChatMcpBridge, call: { id: string; function: { name: string; arguments: string } }, outputLimit: number, images: string[]) {
  const record: CodexChatToolCall = {
    id: call.id,
    tool: call.function.name,
    status: 'running',
    arguments: null,
    summary: null,
    historyIds: [],
    compositeHashes: [],
    generated: isCodexChatCreationTool(call.function.name),
  }
  turn.toolCalls.set(record.id, record)

  let output: string
  try {
    record.arguments = parseArguments(call.function.arguments)
    emit(turn, { type: 'tool', call: { ...record } })
    const result = await bridge.call(record.tool, record.arguments as Record<string, unknown>, turn.controller.signal)
    const { texts, historyIds, compositeHashes, jobIds, pendingJobIds } = readMcpToolResult(result, record.tool)
    output = texts.join('\n') || (result.structuredContent ? JSON.stringify(result.structuredContent) : '')
    const found = readToolImages(result)
    if (found.length > 0) {
      images.push(...found)
      output = `${output}\n(${found.length} image(s) follow in the next message.)`
    }
    record.status = result.isError ? 'failed' : 'completed'
    record.historyIds = historyIds
    record.compositeHashes = compositeHashes
    if (jobIds.length > 0) record.jobIds = jobIds
    if (jobIds.length > 0) record.pendingJobIds = pendingJobIds
  } catch (error) {
    output = `Error: ${error instanceof Error ? error.message : String(error)}`
    record.status = 'failed'
    if (record.arguments === null) {
      record.arguments = call.function.arguments
    }
  }

  record.summary = output ? truncateToolSummary(output) : null
  record.output = output.slice(0, STORED_TOOL_OUTPUT_LENGTH)
  emit(turn, { type: 'tool', call: { ...record } })
  return (output.length > outputLimit ? `${output.slice(0, outputLimit)}\n…(truncated)` : output) || '(no output)'
}

/** A direct chat's reply: the profile's prompt and the thread's context window (summarized first if it overflows). */
async function runReply(turn: LlmTurn, requester: McpRequester, thread: CodexChatThreadRecord, profile: ChatProfile) {
  const listMessages = () => CodexChatStore.listMessages(thread.id).filter((message) => message.id !== turn.replacingMessageId)
  const config = resolveContextConfig(thread, profile)
  return streamReply(turn, requester, profile, async (tools) => {
    if (config.summaryEnabled) {
      await fitThreadSummary(thread.id, profile, listMessages(), turn.controller.signal, tools)
    }
    const current = CodexChatStore.findThreadById(thread.id) ?? thread
    return buildChatMessages({ profile, thread: current, messages: listMessages(), config, tools })
  }, false, { maxTokens: config.maxTokens })
}

/**
 * Model ↔ tool rounds until the model answers in text; the last round withholds tools so it must answer.
 * `roomTools` adds the group room history tools (offered even when the profile has no MCP scopes).
 * `generation` overrides the profile's generation options (a direct chat's own reply cap).
 */
async function streamReply(turn: LlmTurn, requester: McpRequester, profile: ChatProfile, buildMessages: (tools: ChatCompletionTool[]) => ChatCompletionMessage[] | Promise<ChatCompletionMessage[]>, roomTools: 'call' | 'all' | false = false, generation: Partial<LlmGenerationOptions> = {}) {
  const target = resolveChatCompletionTarget(profile.providerName, { model: profile.model || null, generation: { ...profileGenerationOptions(profile), ...generation } })
  const scopes = profile.mcpEnabled ? intersectChatScopes(profile.mcpScopes, resolveChatAccess(requester.accountId)) : []
  const chatContext = turn.chatContext ?? turn.delivery?.context
  const bridge = scopes.length > 0 || roomTools || chatContext ? await openChatMcpBridge(requester, scopes, profile.toolAllowlist, { roomTools, generationPresetIds: profile.generationPresetIds, chatContext }) : null

  try {
    // Image viewing is only offered to models the profile says can see images.
    const offeredTools = (bridge?.tools ?? []).filter((tool) => profile.visionEnabled || tool.function.name !== 'view_images')
    turn.offeredTools = offeredTools
    const messages = await buildMessages(offeredTools)
    for (let round = 1; ; round += 1) {
      turn.controller.signal.throwIfAborted()
      const tools = bridge && round <= profile.maxToolRounds ? offeredTools : []
      assertChatContextFits(profile, messages, tools, target.generation.maxTokens)
      const rawEstimate = round === 1 ? rawMessagesEstimate(messages, tools) : 0
      let separated = turn.text.length === 0
      const result = await retryLlmRequest(() => streamChatCompletion({
        target,
        messages,
        tools,
        signal: turn.controller.signal,
        onContent: (text) => {
          const delta = separated ? text : `\n\n${text}`
          separated = true
          turn.text += delta
          emit(turn, { type: 'delta', text: delta })
        },
        onReasoning: (text) => {
          turn.reasoning += text
          emit(turn, { type: 'reasoning', text })
        },
      }), { signal: turn.controller.signal, canRetry: () => turn.text.length === 0 && turn.reasoning.length === 0 })

      if (round === 1 && result.promptTokens) {
        recordPromptUsage(profile.id, rawEstimate, result.promptTokens)
      }
      if (!bridge || tools.length === 0 || result.toolCalls.length === 0) {
        turn.finishReason = result.finishReason
        return
      }

      messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls })
      const images: string[] = []
      for (const call of result.toolCalls) {
        if (turn.controller.signal.aborted) {
          return
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: await runToolCall(turn, bridge, call, profile.toolOutputLimit, images) })
      }
      // Tool messages carry text only, so images ride in a user message right after them (this request only).
      if (images.length > 0 && profile.visionEnabled) {
        messages.push({ role: 'user', content: [{ type: 'text', text: 'Images returned by the tools above, in order:' }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))] })
      }
    }
  } finally {
    await bridge?.close()
  }
}

/** Stores the reply (translated for the reader first, while the turn still counts as running) and announces it. */
async function finishTurn(turn: LlmTurn, profile: ChatProfile, status: CodexChatMessageRecord['status'], error: string | null) {
  const toolCalls = [...turn.toolCalls.values()].map((call) => (call.status === 'running' ? { ...call, status: 'failed' as const } : call))
  const content = stripThinking(turn.text).trim()
  const finishReason = status === 'completed' ? turn.finishReason : null
  let displayContent: string | null = null
  if (status === 'completed' && content && profile.translationProviderName) {
    emit(turn, { type: 'translating' })
    displayContent = await translateReply(profile, content, turn.controller.signal)
  }
  const messageId = turn.replacingMessageId ?? CodexChatStore.addMessage({
    thread_id: turn.threadId,
    role: 'assistant',
    content,
    display_content: displayContent,
    tool_calls: toolCalls,
    status,
    error,
    finish_reason: finishReason,
    routing: turn.delivery?.routing,
  })
  if (turn.replacingMessageId) {
    // A connection failure must not replace a usable answer with an empty failed alternative.
    if (status === 'completed' || content || toolCalls.length) {
      CodexChatStore.addAlternative(turn.threadId, messageId, { content, display_content: displayContent, tool_calls: toolCalls, status, error, finish_reason: finishReason, routing: turn.delivery?.routing, created_at: new Date().toISOString() })
    } else if (error) {
      emit(turn, { type: 'error', message: error })
    }
  }
  const message = CodexChatStore.listMessages(turn.threadId).find((entry) => entry.id === messageId) as CodexChatMessageRecord
  activeTurns.delete(turn.threadId)
  emit(turn, { type: 'done', message })
  turn.listeners.clear()
  return message
}

/** All validation and rewrites happen synchronously while this thread is reserved. */
function startReply(requester: McpRequester, thread: CodexChatThreadRecord, profile: ChatProfile, listener: (event: CodexChatStreamEvent) => void,
  prepare: () => CodexChatStreamEvent, replacingMessageId?: number) {
  if (activeTurns.has(thread.id)) throw new LlmChatError('이전 답변이 아직 진행 중이야.', 409)
  let resolveFinished: (message: CodexChatMessageRecord) => void = () => {}
  let rejectFinished: (error: unknown) => void = () => {}
  const turn: LlmTurn = {
    threadId: thread.id, replacingMessageId, controller: new AbortController(), text: '', reasoning: '', toolCalls: new Map(), finishReason: null,
    offeredTools: [], listeners: new Set([listener]), finished: new Promise((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject }),
  }
  activeTurns.set(thread.id, turn)
  try {
    emit(turn, prepare())
  } catch (error) {
    activeTurns.delete(thread.id)
    throw error
  }
  const updatedThread = CodexChatStore.findThreadById(thread.id) as CodexChatThreadRecord
  const history = CodexChatStore.listMessages(thread.id).filter((entry) => entry.id !== replacingMessageId)
  turn.delivery = beginDirectReply(updatedThread, profile.id, history, [...history].reverse().find((entry) => entry.role === 'user') ?? null, turn.controller.signal, (routing) => emit(turn, { type: 'routing', routing }))
  void runReply(turn, requester, updatedThread, profile)
    .then(() => finishTurn(turn, profile, turn.controller.signal.aborted ? 'interrupted' : 'completed', null), (error: unknown) => {
      const aborted = turn.controller.signal.aborted
      return finishTurn(turn, profile, aborted ? 'interrupted' : 'failed', aborted ? null : error instanceof Error ? error.message : String(error))
    })
    .then(resolveFinished, rejectFinished)
    .finally(() => {
      turn.delivery?.close()
      if (activeTurns.get(thread.id) === turn) activeTurns.delete(thread.id)
      turn.listeners.clear()
      if (turn.controller.signal.aborted) return
      summarizeAhead(thread.id, profile, turn.offeredTools).catch((error: unknown) => {
        console.warn('[llm-chat] summary update failed:', error instanceof Error ? error.message : error)
      })
    })
  return turn.finished
}

export type GroupReplyResult = Pick<CodexChatMessageRecord, 'content' | 'tool_calls' | 'status' | 'error'> & { finish_reason?: string | null }

/**
 * One group room member's reply (not stored here: the room stores it with its speaker). Streams `delta`,
 * `reasoning` and `tool` events to `emit`; `signal` stops it, leaving what was written as an interrupted reply.
 */
export async function generateLlmGroupReply(params: {
  chatContext: ChatExecutionContext
  requester: McpRequester
  threadId: number
  profile: ChatProfile
  buildMessages: (tools: ChatCompletionTool[]) => ChatCompletionMessage[]
  /** Room tools offered: `call` (room_call_member), `all` adding history search when part of the room is not shown. */
  roomTools: 'call' | 'all'
  /** Overrides of the profile's generation options (the member's or room's reply cap). */
  generation?: Partial<LlmGenerationOptions>
  signal: AbortSignal
  emit: (event: CodexChatStreamEvent) => void
}): Promise<GroupReplyResult> {
  assertLlmChatAvailable(params.requester)
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (params.signal.aborted) abort()
  params.signal.addEventListener('abort', abort, { once: true })
  const turn: LlmTurn = {
    chatContext: params.chatContext,
    threadId: params.threadId, controller, text: '', reasoning: '', toolCalls: new Map(), finishReason: null,
    offeredTools: [], listeners: new Set([params.emit]), finished: Promise.resolve({} as CodexChatMessageRecord),
  }
  let status: CodexChatMessageRecord['status'] = 'completed'
  let error: string | null = null
  try {
    await streamReply(turn, params.requester, params.profile, params.buildMessages, params.roomTools, params.generation ?? {})
    if (controller.signal.aborted) status = 'interrupted'
  } catch (caught) {
    status = controller.signal.aborted ? 'interrupted' : 'failed'
    error = controller.signal.aborted ? null : caught instanceof Error ? caught.message : String(caught)
  } finally {
    params.signal.removeEventListener('abort', abort)
  }
  const toolCalls = [...turn.toolCalls.values()].map((call) => (call.status === 'running' ? { ...call, status: 'failed' as const } : call))
  return { content: stripThinking(turn.text).trim(), tool_calls: toolCalls, status, error, finish_reason: status === 'completed' ? turn.finishReason : null }
}

export const LlmChatService = {
  /** `userProfileId`: the account's user profile in the chat (already checked), null for the plain user. */
  createThread(requester: McpRequester, profileId: number, userProfileId: number | null = null) {
    assertLlmChatAvailable(requester)
    const profile = requireUsableProfile(profileId)
    const user = ChatUserProfileStore.requireOwn(requester.accountId, userProfileId)
    const threadId = CodexChatStore.createThread(requester.accountId, '', 'llm', profile.id)
    if (user) ChatUserProfileStore.setThreadUserProfile(threadId, user.id)
    const greeting = pickChatGreeting(profile)
    if (greeting) {
      CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: fillCharacterPlaceholders(greeting, profile, userPersonaOf(user)), tool_calls: [], status: 'completed', error: null })
    }
    return threadId
  },

  running(threadId: number) {
    const turn = activeTurns.get(threadId)
    return turn ? { text: turn.text, toolCalls: [...turn.toolCalls.values()], replacingMessageId: turn.replacingMessageId, routing: turn.delivery?.routing } : null
  },

  isRunning(threadId: number) {
    return activeTurns.has(threadId)
  },

  /**
   * Send one user message and stream the reply to `listener`. Resolves with the stored assistant message; the reply
   * keeps running (and is stored) when the listener goes away.
   */
  async sendMessage(requester: McpRequester, thread: CodexChatThreadRecord, text: string, listener: (event: CodexChatStreamEvent) => void, fileIds?: unknown, flagIds?: unknown, picks?: unknown, mediaHashes?: unknown, replyToMessageId?: unknown) {
    assertLlmChatAvailable(requester)
    const profile = requireUsableProfile(thread.profile_id)
    const attachments = validateChatAttachments(requester, fileIds)
    const mediaAttachments = validateChatMediaAttachments(requester, mediaHashes, attachments.length)
    const flags = [...ChatFlagStore.resolve(requester.accountId, parseFlagIds(flagIds)), ...parsePicks(picks)]
    const trimmed = text.trim()
    if (!trimmed && attachments.length === 0 && mediaAttachments.length === 0) {
      throw new LlmChatError('메시지를 입력해줘.')
    }
    const routing = userReplyRouting(thread, replyToMessageId)
    if (activeTurns.has(thread.id)) throw new LlmChatError('이전 답변이 아직 진행 중이야.', 409)
    // The model reads the message in English; the reader keeps their own words.
    const modelText = await translateUserInput(profile, trimmed)
    return startReply(requester, thread, profile, listener, () => {
      const userMessageId = CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: modelText ?? trimmed, display_content: modelText ? trimmed : null, tool_calls: [], status: 'completed', error: null, flags, mediaAttachments, routing }, attachments.map((file) => file.id))
      ChatFlagStore.setThreadFlags(thread.id, flags.filter((flag) => !flag.pick).map((flag) => flag.id))
      if (!thread.title) CodexChatStore.renameThread(thread.id, (trimmed || attachments[0]?.name || mediaAttachments[0]?.name || '').replace(/\s+/g, ' '))
      return { type: 'user', message: CodexChatStore.listMessages(thread.id).find((entry) => entry.id === userMessageId) as CodexChatMessageRecord }
    })
  },

  async rewriteMessage(requester: McpRequester, thread: CodexChatThreadRecord, messageId: number, content: string | undefined, listener: (event: CodexChatStreamEvent) => void) {
    assertLlmChatAvailable(requester)
    const profile = requireUsableProfile(thread.profile_id)
    if (activeTurns.has(thread.id)) throw new LlmChatError('이전 답변이 아직 진행 중이야.', 409)
    const messages = CodexChatStore.listMessages(thread.id)
    const message = messages.find((entry) => entry.id === messageId)
    if (!message) throw new LlmChatError('메시지를 찾을 수 없어.', 404)
    const regenerate = content === undefined
    if (regenerate ? message.role !== 'assistant' || messages[messages.length - 1].id !== messageId || !messages.some((entry) => entry.role === 'user') : message.role !== 'user') {
      throw new LlmChatError(regenerate ? '마지막 답변만 다시 생성할 수 있어.' : '내 메시지만 수정할 수 있어.', 409)
    }
    if (!regenerate && !content.trim() && !message.attachments?.length && !message.mediaAttachments?.length) throw new LlmChatError('메시지를 입력해줘.')
    // Resolve configuration before deleting any later messages.
    resolveChatCompletionTarget(profile.providerName, { model: profile.model || null, generation: profileGenerationOptions(profile) })
    const edited = regenerate ? null : content.trim()
    const modelText = edited ? await translateUserInput(profile, edited) : null
    if (activeTurns.has(thread.id)) throw new LlmChatError('이전 답변이 아직 진행 중이야.', 409)
    return startReply(requester, thread, profile, listener, () => {
      if (regenerate) CodexChatStore.prepareRegeneration(thread.id, messageId)
      else CodexChatStore.editUserMessage(thread.id, messageId, modelText ?? (edited as string), modelText ? edited : null)
      return { type: 'rewind', mode: regenerate ? 'regenerate' : 'edit', message: regenerate ? message : { ...message, content: modelText ?? (edited as string), display_content: modelText ? edited : null } }
    }, regenerate ? messageId : undefined)
  },

  interrupt(threadId: number) {
    activeTurns.get(threadId)?.controller.abort()
  },

  /** Stop a running reply and wait (bounded) until it is stored, e.g. before deleting the thread. */
  async stop(threadId: number) {
    const turn = activeTurns.get(threadId)
    if (!turn) {
      return
    }
    turn.controller.abort()
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([turn.finished, new Promise((resolve) => { timer = setTimeout(resolve, STOP_WAIT_MS) })])
    } finally {
      clearTimeout(timer)
    }
  },

  async summarize(requester: McpRequester, thread: CodexChatThreadRecord) {
    assertLlmChatAvailable(requester)
    const profile = requireUsableProfile(thread.profile_id)
    if (activeTurns.has(thread.id)) throw new LlmChatError('이전 답변이 아직 진행 중이야.', 409)
    const summary = await summarizeAll(thread.id, profile)
    if (summary === null) {
      throw new LlmChatError('요약할 새 대화가 없거나 이미 요약 중이야.', 409)
    }
    return summary
  },
}
