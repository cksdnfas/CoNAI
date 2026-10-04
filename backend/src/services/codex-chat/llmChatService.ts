import type { McpRequester } from '../../mcp/context'
import { openChatMcpBridge, type ChatMcpBridge } from './chatMcpBridge'
import { readMcpToolResult, truncateToolSummary } from './chatToolReferences'
import { intersectChatScopes, resolveChatAccess } from './codexChatAccess'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord, type CodexChatToolCall } from './codexChatStore'
import type { CodexChatStreamEvent } from './codexChatService'
import { resolveChatCompletionTarget, streamChatCompletion, type ChatCompletionMessage } from './llmChatCompletion'
import { buildChatMessages, fillCharacterPlaceholders, resolveContextConfig, stripThinking, updateThreadSummary } from './llmChatContext'
import { LlmChatProfileStore, type LlmChatProfile } from './llmChatProfiles'
import { loadLlmChatSettings } from './llmChatSettings'

/** Tool output kept on the stored call for replay; the model gets more of it within the reply itself. */
const STORED_TOOL_OUTPUT_LENGTH = 4000
const LIVE_TOOL_OUTPUT_LENGTH = 12_000
const STOP_WAIT_MS = 8000

export class LlmChatError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

type LlmTurn = {
  threadId: number
  controller: AbortController
  /** Reply text across tool rounds, separated by blank lines. */
  text: string
  reasoning: string
  toolCalls: Map<string, CodexChatToolCall>
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
  if (!loadLlmChatSettings().enabled) {
    throw new LlmChatError('LLM 채팅이 꺼져 있어.', 403)
  }
  if (!resolveChatAccess(requester.accountId).llm) {
    throw new LlmChatError('LLM 채팅 권한이 없어.', 403)
  }
}

function requireUsableProfile(profileId: number | null) {
  const profile = profileId === null ? null : LlmChatProfileStore.find(profileId)
  if (!profile) {
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

async function runToolCall(turn: LlmTurn, bridge: ChatMcpBridge, call: { id: string; function: { name: string; arguments: string } }) {
  const record: CodexChatToolCall = {
    id: call.id,
    tool: call.function.name,
    status: 'running',
    arguments: null,
    summary: null,
    historyIds: [],
    compositeHashes: [],
  }
  turn.toolCalls.set(record.id, record)

  let output: string
  try {
    record.arguments = parseArguments(call.function.arguments)
    emit(turn, { type: 'tool', call: { ...record } })
    const result = await bridge.call(record.tool, record.arguments as Record<string, unknown>)
    const { texts, historyIds, compositeHashes } = readMcpToolResult(result)
    output = texts.join('\n') || (result.structuredContent ? JSON.stringify(result.structuredContent) : '')
    record.status = result.isError ? 'failed' : 'completed'
    record.historyIds = historyIds
    record.compositeHashes = compositeHashes
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
  return output.slice(0, LIVE_TOOL_OUTPUT_LENGTH) || '(no output)'
}

/** Model ↔ tool rounds until the model answers in text; the last round withholds tools so it must answer. */
async function runReply(turn: LlmTurn, requester: McpRequester, thread: CodexChatThreadRecord, profile: LlmChatProfile) {
  const settings = loadLlmChatSettings()
  const target = resolveChatCompletionTarget(profile.providerName, { model: profile.model || null, temperature: profile.temperature, maxTokens: profile.maxTokens })
  const scopes = profile.mcpEnabled ? intersectChatScopes(profile.mcpScopes, resolveChatAccess(requester.accountId)) : []
  const bridge = scopes.length > 0 ? await openChatMcpBridge(requester, scopes) : null

  try {
    const messages: ChatCompletionMessage[] = buildChatMessages({
      profile,
      thread,
      messages: CodexChatStore.listMessages(thread.id),
      config: resolveContextConfig(thread, profile),
      withTools: Boolean(bridge),
    })

    for (let round = 1; ; round += 1) {
      const tools = bridge && round <= settings.maxToolRounds ? bridge.tools : []
      let separated = turn.text.length === 0
      const result = await streamChatCompletion({
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
      })

      if (!bridge || tools.length === 0 || result.toolCalls.length === 0) {
        return
      }

      messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls })
      for (const call of result.toolCalls) {
        if (turn.controller.signal.aborted) {
          return
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: await runToolCall(turn, bridge, call) })
      }
    }
  } finally {
    await bridge?.close()
  }
}

function finishTurn(turn: LlmTurn, status: CodexChatMessageRecord['status'], error: string | null) {
  activeTurns.delete(turn.threadId)
  const toolCalls = [...turn.toolCalls.values()].map((call) => (call.status === 'running' ? { ...call, status: 'failed' as const } : call))
  const messageId = CodexChatStore.addMessage({
    thread_id: turn.threadId,
    role: 'assistant',
    content: stripThinking(turn.text).trim(),
    tool_calls: toolCalls,
    status,
    error,
  })
  const message = CodexChatStore.listMessages(turn.threadId).find((entry) => entry.id === messageId) as CodexChatMessageRecord
  emit(turn, { type: 'done', message })
  turn.listeners.clear()
  return message
}

export const LlmChatService = {
  createThread(requester: McpRequester, profileId: number) {
    assertLlmChatAvailable(requester)
    const profile = requireUsableProfile(profileId)
    const threadId = CodexChatStore.createThread(requester.accountId, '', 'llm', profile.id)
    if (profile.greeting) {
      CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: fillCharacterPlaceholders(profile.greeting, profile), tool_calls: [], status: 'completed', error: null })
    }
    return threadId
  },

  running(threadId: number) {
    const turn = activeTurns.get(threadId)
    return turn ? { text: turn.text, toolCalls: [...turn.toolCalls.values()] } : null
  },

  isRunning(threadId: number) {
    return activeTurns.has(threadId)
  },

  /**
   * Send one user message and stream the reply to `listener`. Resolves with the stored assistant message; the reply
   * keeps running (and is stored) when the listener goes away.
   */
  async sendMessage(requester: McpRequester, thread: CodexChatThreadRecord, text: string, listener: (event: CodexChatStreamEvent) => void) {
    assertLlmChatAvailable(requester)
    const profile = requireUsableProfile(thread.profile_id)
    const trimmed = text.trim()
    if (!trimmed) {
      throw new LlmChatError('메시지를 입력해줘.')
    }
    if (activeTurns.has(thread.id)) {
      throw new LlmChatError('이전 답변이 아직 진행 중이야.', 409)
    }

    let resolveFinished: (message: CodexChatMessageRecord) => void = () => {}
    const turn: LlmTurn = {
      threadId: thread.id,
      controller: new AbortController(),
      text: '',
      reasoning: '',
      toolCalls: new Map(),
      listeners: new Set([listener]),
      finished: new Promise((resolve) => {
        resolveFinished = resolve
      }),
    }
    activeTurns.set(thread.id, turn)

    const userMessageId = CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: trimmed, tool_calls: [], status: 'completed', error: null })
    if (!thread.title) {
      CodexChatStore.renameThread(thread.id, trimmed.replace(/\s+/g, ' '))
    }
    emit(turn, { type: 'user', message: CodexChatStore.listMessages(thread.id).find((entry) => entry.id === userMessageId) as CodexChatMessageRecord })

    void runReply(turn, requester, thread, profile)
      .then(() => resolveFinished(finishTurn(turn, turn.controller.signal.aborted ? 'interrupted' : 'completed', null)))
      .catch((error: unknown) => {
        const aborted = turn.controller.signal.aborted
        resolveFinished(finishTurn(turn, aborted ? 'interrupted' : 'failed', aborted ? null : error instanceof Error ? error.message : String(error)))
      })
      .finally(() => {
        updateThreadSummary(thread.id, profile).catch((error: unknown) => {
          console.warn('[llm-chat] summary update failed:', error instanceof Error ? error.message : error)
        })
      })

    return turn.finished
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
    await Promise.race([turn.finished, new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS))])
  },

  async summarize(requester: McpRequester, thread: CodexChatThreadRecord) {
    assertLlmChatAvailable(requester)
    const profile = requireUsableProfile(thread.profile_id)
    const summary = await updateThreadSummary(thread.id, profile, { force: true })
    if (summary === null) {
      throw new LlmChatError('요약할 새 대화가 없거나 이미 요약 중이야.', 409)
    }
    return summary
  },
}
