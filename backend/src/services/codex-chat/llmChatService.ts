import { prepareChatSend } from './chatSendPreparation'
import { deletingThreads } from './chatThreadReservation'
import { requestChatModel, withChatTokenModel } from './llmChatContext'
import { addChatOpening } from './chatGreeting'
import type { ChatExecutionContext, ChatPageSnapshot, ChatProposal } from '@conai/shared'
import { isCodexChatCreationTool } from '@conai/shared'
import { ChatProposalStore, isChatProposalToolAvailable } from './chatProposals'
import { beginDirectReply } from './chatReplies'
import type { McpRequester } from '../../mcp/context'
import type { LlmGenerationOptions } from '../llmGenerationOptions'
import { profileGenerationOptions } from './chatProfiles'
import { inlineTextsForChat, loadAttachedImages, withLatestMediaGeneration } from './chatAttachments'
import { ChatFlagStore } from './chatFlags'
import { profileContentLimit } from './chatContentRating'
import { openChatMcpBridge, type ChatMcpBridge } from './chatMcpBridge'
import { chatWorkspace, workspaceInstructions } from './chatWorkspace'
import { applyChatInstructionHooks, hasPluginServerHook } from '../plugins/pluginServerRuntime'
import { CATALOG_OPEN_TOOL, unwrapCatalogCall } from '../../mcp/toolCatalog'
import { readMcpToolResult, truncateToolSummary } from './chatToolReferences'
import { ChatProfileStore, isVisionTool, sessionRuntimeOf, type ChatProfile } from './chatProfiles'
import { translateReply, translateUserMessage } from './chatTranslation'
import { hasTranslation, resolveProfileModel } from './chatModelRoles'
import { titleAfterFirstReply } from './chatAutoTitle'
import { stripEchoedAddresses, withoutNarrationMarks } from '@conai/shared'
import { ChatUserProfileStore, userPersonaForThread, userPersonaOf } from './chatUserProfiles'
import { chatToolRoundLimit, loadChatSettings } from './chatSettings'
import { canUseChatProfile, resolveChatProfileToolGrant, resolveChatAccess } from './codexChatAccess'
import { CodexChatStore, type ChatHistorySource, type CodexChatMessageRecord, type CodexChatThreadRecord, type CodexChatToolCall } from './codexChatStore'
import { withGenerationOutcomes } from './codexChatMedia'
import { generatedImagesTokens, loadInlineGeneratedImages, withGeneratedImages } from './chatGenerationPrompting'
import { buildClaudeSessionTurn } from './claudeChatSessions'
import type { EngineSession } from './claudeChatSessions'
import type { CodexChatStreamEvent } from './codexChatService'
import { resolveChatCompletionTarget, streamChatCompletion, type ChatCompletionMessage, type ChatCompletionTool } from './llmChatCompletion'
import { ChatSummaryStore } from './chatMemory'
import { appendUserDirective, buildChatMessages, cutToolOutput, directContextTurns, estimateMessagesTokens, estimateTokens, type ChatContextMeta, fillCharacterPlaceholders, fitChatContext, fitThreadSummary, fitWorkspaceRead, latestWindow, prefixUserContent, rawMessagesEstimate, recordPromptUsage, replyCapFor, resolveContextConfig, sendableMessages, stripThinking, summarizeAhead, summarizeAll, unsummarizedMessages, wrapUpRequest } from './llmChatContext'
import { addressLabelFilter, restatement, roundSeparator } from './chatReplyText'
import { noteTextToolCalls, recoverTextToolCalls, textToolCallFilter } from './textToolCalls'
import { chatPageReference, NO_PAGE_NOTE, proposalOutcomeNote } from './chatPageContext'
import { knowledgePageForExecution, recordQuotedBoardKnowledge } from '../posts/knowledge/knowledgePage'
import type { ChatSendOptions } from './chatTasks'
import { rememberChatPage } from './chatPageBridge'
import { notifyChatUserSend } from './chatSendEvents'
import { requireResearchProfile, type ChatResearchExecution } from './chatResearch'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import { contextContentText, contextPartsOf, contextSections, limitContextMeta, markContextMessage, markContextParts, legacyContextMeta } from './chatContextDiagnostics'
import { redactChatRequestBody, saveChatRequestCapture } from './chatRequestCaptures'
import { ChatGroupStore, groupLimitsOf } from './chatGroupStore'
import { buildGroupLlmMessages, groupSummaryOn, readGroupReplyHistory, withoutStaleWakes, type GroupHistory } from './groupChatContext'
import { skipThreadGenerationReactions } from './chatReplyRegistry'
import { isChatOrderRunning, stopChatOrderRun } from './chatOrderRuns'
import { cancelJudgeFollowUp, endJudgedTurn, judgeAfterReply, judgeBeforeReply, judgeDirectiveText, judgeSetupOf, readReplyHistory, type JudgedTurn } from './chatJudge'
import { withSemanticContext, type JudgedContext } from './chatJudgeContext'
import { semanticContextFor, type SemanticContext } from '../embeddings/chatSemantic'
import { embeddingFeatureOn } from '../aiWorker/textEmbeddingService'
import { judgeStatusFields } from './chatJudgeFields'
import { serverContextLimit, withServerContextLimit } from './serverContextLimit'
import { withLlmUsageContext } from '../llmUsage'

type GenerationReaction = {
  result: ChatCompletionMessage
  persist: (save: (() => number) | null) => number | null
  skip: () => void
  /** A judge's follow-up message (not a generation result): the judge may follow it up once more, within its limit. */
  followUp?: boolean
}

/** Tool output kept on the stored call for replay; the model gets more of it within the reply itself. */
const STORED_TOOL_OUTPUT_LENGTH = 4000
const STOP_WAIT_MS = 8000
/** How often a reply that waits for a running summary says so on its stream (keeping the connection busy). */
const WAITING_EVENT_MS = 15_000

/** Why a reply is stored as failed although its request succeeded. */
export const REPLY_FAILURES = {
  toolCallsCut: '출력 상한에 걸려 도구 호출이 잘렸어. 최대 출력 토큰을 늘려줘.',
  emptyAtCap: '생각만 하다가 출력 상한에 닿았어. 최대 출력 토큰을 늘리거나 추론을 줄여줘.',
  empty: '빈 답변이 왔어.',
} as const

/** The reply as stored: no inline thinking, no echoed address labels. */
function replyContent(text: string) {
  return stripEchoedAddresses(stripThinking(text)).trim()
}

export class LlmChatError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

/** The connection an API LLM profile chats through (its model slot, direct connection or the default slot). */
function chatConnectionOf(profile: ChatProfile) {
  const resolved = requestChatModel(profile)
  if (!resolved) throw new LlmChatError('LLM 연결을 찾을 수 없어. 프로필의 모델을 골라줘.')
  return resolved.providerName
}

type LlmTurn = {
  research?: ChatResearchExecution
  reaction?: GenerationReaction
  /**
   * An order on an earlier reply (see chatOrderRunner): no judge, no reply text needed, and the tool rounds end once a
   * call that does the job (`done`) went through.
   */
  order?: { done: (call: CodexChatToolCall) => boolean }
  chatContext?: ChatExecutionContext
  page?: ChatPageSnapshot
  delivery?: ReturnType<typeof beginDirectReply>
  threadId: number
  replacingMessageId?: number
  controller: AbortController
  /** Reply text across tool rounds, separated by blank lines. */
  text: string
  reasoning: string
  toolCalls: Map<string, CodexChatToolCall>
  offeredTools: ChatCompletionTool[]
  /** The provider's finish_reason of the last round ('length': the token cap cut the reply; 'repetition': a loop was cut off). */
  finishReason: string | null
  /** The user message's translation for the model, running beside the judge; the reply is built once it is stored. */
  translation?: Promise<unknown>
  /** One active-path history shared by routing, semantic retrieval, judging and request preparation. */
  history?: CodexChatMessageRecord[]
  historySource?: ChatHistorySource
  groupHistory?: GroupHistory
  /** Continuing a cut reply: its text, which `text` starts with, and the model is asked to carry on from. */
  continuing?: string
  /** …and its routing: the continuation keeps its quote and recipients, and takes over its generation jobs. */
  continuingRouting?: CodexChatMessageRecord['routing']
  /** What the request carried and the prompt tokens the server counted for it, stored with the reply. */
  contextMeta?: ChatContextMeta & { model: string | null; promptTokens?: number | null }
  requestCapture?: string
  requestSent?: boolean
  /** A Claude Code or pi reply that continues the chat's session (see claudeChatSessions): set while the request is built. */
  engineSession?: EngineSession
  listeners: Set<(event: CodexChatStreamEvent) => void>
  finished: Promise<CodexChatMessageRecord | null>
}

const activeTurns = new Map<number, LlmTurn>()

/** A reply (or reaction) runs, or an order holds the chat. */
function busy(threadId: number) {
  return deletingThreads.has(threadId) || activeTurns.has(threadId) || isChatOrderRunning(threadId)
}

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
  const access = resolveChatAccess(requester.accountId)
  if (!access.llm && !access.claude) {
    throw new LlmChatError('LLM 채팅 권한이 없어.', 403)
  }
}

function requireProfileAccess(requester: McpRequester, profile: ChatProfile) {
  const access = resolveChatAccess(requester.accountId)
  if (!loadChatSettings().enabled || !canUseChatProfile(access, profile)) throw new LlmChatError('이 프로필로 채팅할 권한이 없어.', 403)
  const current = ChatProfileStore.find(profile.id)
  if (!current?.isEnabled || current.engine !== profile.engine) throw new LlmChatError('프로필 사용 설정이 변경됐어.', 409)
}

function requireUsableProfile(profileId: number | null, requester: McpRequester) {
  const profile = profileId === null ? null : ChatProfileStore.find(profileId)
  if (!profile || (profile.engine !== 'llm' && profile.engine !== 'claude')) {
    throw new LlmChatError('이 채팅의 프로필이 지워졌어.', 409)
  }
  if (!profile.isEnabled) {
    throw new LlmChatError('이 채팅의 프로필이 꺼져 있어.', 409)
  }
  requireProfileAccess(requester, profile)
  return profile
}

function parseArguments(raw: string): Record<string, unknown> {
  // Some servers pass the arguments on fenced as the model wrote them.
  const text = (raw || '').trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1') || '{}'
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`Tool arguments are not valid JSON (${error instanceof Error ? error.message : String(error)}). Call the tool again with one JSON object matching its input schema.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/** The tool a call runs: a catalog `run_tool` call counts as the tool it names. */
function calledTool(name: string, rawArguments: string) {
  try { return unwrapCatalogCall(name, parseArguments(rawArguments)).tool } catch { return name }
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
  let nativeResult: Awaited<ReturnType<ChatMcpBridge['call']>> | null = null
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
    // A run_tool call is recorded as the catalogued tool it runs; the bridge routes that name through the catalog.
    const target = unwrapCatalogCall(record.tool, record.arguments)
    record.tool = target.tool
    record.arguments = target.arguments
    record.generated = isCodexChatCreationTool(record.tool)
    emit(turn, { type: 'tool', call: { ...record } })
    const result = await bridge.call(record.tool, record.arguments as Record<string, unknown>, turn.controller.signal)
    nativeResult = result
    if (['propose_page_changes', 'propose_workflow_changes', 'propose_page_action'].includes(record.tool) && !result.isError) {
      // propose_page_changes / propose_workflow_changes are retired; the names stay for chats recorded before.
      const structured = result.structuredContent as { proposal?: ChatProposal } | undefined
      // The card shows the stored proposal: the tool result may carry a copy with text above the rating ceiling hidden.
      if (structured?.proposal?.kind === 'page_fields' || structured?.proposal?.kind === 'workflow_graph' || structured?.proposal?.kind === 'page_action') record.proposal = ChatProposalStore.find(structured.proposal.id) ?? structured.proposal
    }
    const { texts, historyIds, compositeHashes, jobIds, pendingJobIds, audioCandidateIds, pageOperation } = readMcpToolResult(result, record.tool)
    if (pageOperation && !result.isError) record.pageOperation = pageOperation
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
    if (audioCandidateIds.length > 0) record.audioCandidateIds = audioCandidateIds
  } catch (error) {
    output = `Error: ${error instanceof Error ? error.message : String(error)}`
    record.status = 'failed'
    if (record.arguments === null) {
      record.arguments = call.function.arguments
    }
  }

  // A later request must read its own fresh snapshot, not replay private state from an old page.
  const pageRead = ['get_current_page', 'get_workflow_editor', 'list_workflow_modules', 'read_page_data'].includes(record.tool) && record.status === 'completed'
  // Opened tool schemas are for this reply; a later one opens them again rather than carrying them in every request.
  const catalogRead = record.tool === CATALOG_OPEN_TOOL && record.status === 'completed'
  record.summary = pageRead ? '현재 요청에 연결한 페이지를 읽었어.' : catalogRead ? '도구 설명을 열람했어.' : record.pageOperation ? record.pageOperation.label : output ? truncateToolSummary(output) : null
  record.output = pageRead ? '(Page/editor snapshot omitted; use the screen in the current request, or the page tools for what it does not show.)' : catalogRead ? '(Tool schemas omitted; open them again with open_tools when needed.)' : record.pageOperation ? `(Page operation done: ${record.pageOperation.label}. Screen snapshot omitted; use the screen in the current request.)` : cutToolOutput(output, STORED_TOOL_OUTPUT_LENGTH)
  emit(turn, { type: 'tool', call: { ...record } })
  // The catalog pages at whole-schema boundaries; cutting JSON here makes the opened tools unusable.
  // A workspace read is shortened at a resumable offset instead, so a cut file never looks whole.
  const fitted = record.tool === 'workspace_read' && output.length > outputLimit ? fitWorkspaceRead(output, outputLimit) : null
  const text = (fitted ?? (!catalogRead && output.length > outputLimit ? cutToolOutput(output, outputLimit) : output)) || '(no output)'
  return { text, nativeResult: nativeResult ? { ...nativeResult, content: [{ type: 'text', text }, ...(nativeResult.content ?? []).filter((part) => (part as { type?: unknown })?.type === 'image')] } : { isError: true, content: [{ type: 'text', text }] } }
}

/** A direct chat's reply: the profile's prompt and the thread's context window (summarized first if it overflows). */
async function runReply(turn: LlmTurn, requester: McpRequester, thread: CodexChatThreadRecord, chatProfile: ChatProfile) {
  // Without its own context length, the profile is sized to what a small local server holds.
  const profile = withServerContextLimit(chatProfile)
  // Creation calls replay with their outcome (image attached / failed / running), not the "queued" JSON of their submission.
  const listMessages = () => withGenerationOutcomes(turnHistory(turn, profile))
  const config = resolveContextConfig(thread, profile)
  if (turn.reaction && thread.kind === 'group') config.maxTokens = ChatGroupStore.member(thread.id, profile.id)?.max_tokens ?? config.maxTokens
  // A Claude Code or pi direct reply continues the chat's session: it sends only what is new, and the session (not
  // the context window or the summary) holds the conversation. A continuation of a cut reply stays a one-off request
  // (through CoNAI itself for a pi profile).
  const sessionRuntime = sessionRuntimeOf(profile)
  const inSession = sessionRuntime !== null && thread.kind === 'direct' && !turn.reaction && turn.continuing === undefined
  // Everything the request needs but the judge's answers: the conversation (read once, after the user's message is
  // translated), its attachments, the page reference and, for a long chat, the summary fitted. It runs beside the
  // judge, whose answers only add lore, episodes and a directive.
  let preparing: Promise<Awaited<ReturnType<typeof prepareRequest>>> | null = null
  const prepareRequest = async (tools: ChatCompletionTool[]) => {
    await turn.translation
    const history = withLatestMediaGeneration(listMessages(), profile, requester)
    const current = CodexChatStore.findThreadById(thread.id) ?? thread
    // A session prepares its latest input itself. Other requests can only show their unsummarized window.
    const attachmentMessages = inSession ? [] : thread.kind === 'group'
      ? latestWindow(withoutStaleWakes(sendableMessages(unsummarizedMessages(history, current, { summaryEnabled: groupSummaryOn(current) }))), groupLimitsOf(current).window)
      : directContextTurns(history, current, config).flat()
    const [attachmentTexts, attachedImages, generatedImages] = await Promise.all([
      inSession ? undefined : inlineTextsForChat(turn.reaction ? { ...profile, mcpEnabled: false } : profile, requester.accountId, attachmentMessages),
      inSession ? null : loadAttachedImages(profile, requester, attachmentMessages),
      // The chat's latest pictures, for presets that let the chat model see them (a reaction carries its own).
      turn.reaction || inSession ? [] : loadInlineGeneratedImages(profile, requester, thread.id),
    ])
    // Continuing: the cut reply as the model's own turn, then the request to carry on from its last word — room for
    // both is kept before the window is chosen.
    const continuation: ChatCompletionMessage[] = turn.continuing === undefined ? [] : [markContextMessage({ role: 'assistant', content: turn.continuing }, 'continuation'), markContextMessage({ role: 'user', content: CONTINUE_DIRECTIVE }, 'continuation')]
    // The "no page" note only matters to a model that has tools to misuse; a plain roleplay reply goes without it.
    const reference = [turn.page ? chatPageReference(turn.page, requester, profileContentLimit(profile)) : tools.length > 0 ? NO_PAGE_NOTE : '', proposalOutcomeNote(thread.id)].filter(Boolean).join('\n\n')
    const pageMessages: ChatCompletionMessage[] = reference ? [markContextMessage({ role: 'user', content: reference }, 'page')] : []
    const reactionMessages = turn.reaction ? [turn.reaction.result] : []
    const extraTokens = estimateMessagesTokens(profile.id, [...continuation, ...pageMessages, ...reactionMessages]) + generatedImagesTokens(profile.id, generatedImages)
    // Claude and pi sessions fold themselves; a direct chat with one keeps no summary of its own.
    if (config.summaryEnabled && !turn.reaction && !(sessionRuntime && thread.kind === 'direct')) {
      await whileWaiting(turn, 'summary', fitThreadSummary(thread.id, profile, history, turn.controller.signal, tools, { attachmentTexts, attachedImages, extraTokens, historySource: turn.historySource }))
    }
    return { history, attachmentTexts, attachedImages, generatedImages, continuation, reference, reactionMessages, extraTokens }
  }
  const prepare = (tools: ChatCompletionTool[]) => (preparing ??= prepareRequest(tools))
  return streamReply(turn, requester, profile, async (tools, judged) => {
    const { history, attachmentTexts, attachedImages, generatedImages, continuation, reference, reactionMessages, extraTokens } = await prepare(tools)
    if (inSession) {
      const sessionTurn = await buildClaudeSessionTurn({ requester, threadId: thread.id, profile, history, historySource: turn.historySource, page: turn.page, withTools: tools.length > 0, runtime: sessionRuntime ?? 'claude', judged, signal: turn.controller.signal })
      turn.engineSession = sessionTurn.session
      turn.contextMeta = { ...sessionTurn.contextMeta, model: resolveProfileModel(profile, 'chat')?.model ?? null }
      return sessionTurn.messages
    }
    if (turn.reaction && thread.kind === 'group') {
      const members = ChatGroupStore.members(thread.id).flatMap((member) => ChatProfileStore.find(member.profile_id) ?? [])
      const messages = buildGroupLlmMessages({ profile, thread, members, messages: history, history: turn.groupHistory, routing: turn.delivery!.routing,
        windowLimit: groupLimitsOf(thread).window, tools: [], maxTokens: config.maxTokens, withTools: false, extraTokens: estimateMessagesTokens(profile.id, [turn.reaction.result]),
        segments: thread.summary_enabled === 1 ? ChatSummaryStore.list(thread.id) : undefined, attachmentTexts, attachedImages,
        onMeta: (meta) => { turn.contextMeta = { ...meta, model: resolveProfileModel(profile, 'chat')?.model ?? null } } })
      return [...messages, turn.reaction.result]
    }
    const current = CodexChatStore.findThreadById(thread.id) ?? thread
    const request = buildChatMessages({
      profile, thread: current, messages: history, historySource: turn.historySource, config, tools, segments: config.summaryEnabled ? ChatSummaryStore.list(thread.id) : [], attachmentTexts, attachedImages, extraTokens, judged,
      onMeta: (meta) => { turn.contextMeta = { ...meta, model: resolveProfileModel(profile, 'chat')?.model ?? null } },
    })
    const final = withGeneratedImages([...withPageReference(request, reference), ...continuation, ...reactionMessages], generatedImages)
    if (turn.contextMeta?.version === 2) {
      turn.contextMeta = limitContextMeta({ ...turn.contextMeta, sections: contextSections(final, tools, (text) => estimateTokens(profile.id, text)), estimatedTokens: estimateMessagesTokens(profile.id, final, tools) })
    }
    return final
  }, { maxTokens: config.maxTokens }, prepare)
}

/**
 * The page reference in front of the latest user message, merged into it: a separate user message would put two user
 * turns in a row, which chat templates that require alternating roles (Gemma and others) refuse.
 */
export function withPageReference(messages: ChatCompletionMessage[], reference: string): ChatCompletionMessage[] {
  if (!reference) return messages
  const latestUser = messages.map((message) => message.role).lastIndexOf('user')
  if (latestUser < 0) return [...messages, markContextMessage({ role: 'user', content: reference }, 'page')]
  return messages.map((message, index) => (index === latestUser && message.role === 'user' ? markContextParts({ ...message, content: prefixUserContent(message.content, reference) }, [
    { kind: 'page', text: reference },
    ...(contextPartsOf(message).length ? contextPartsOf(message) : [{ kind: 'window' as const, text: contextContentText(message.content) }]),
  ]) : message))
}

/** `work`, with a `waiting` event every WAITING_EVENT_MS while it runs: the stream carries bytes and says why it is quiet. */
async function whileWaiting<T>(turn: LlmTurn, reason: 'summary', work: Promise<T>) {
  const timer = setInterval(() => emit(turn, { type: 'waiting', reason }), WAITING_EVENT_MS)
  try {
    return await work
  } finally {
    clearInterval(timer)
  }
}

type TextSpan = { start: number; end: number }

/**
 * After a round that wrote text: when it writes the previous round's text again (see `restatement`), only one of them
 * stays, and the stream gets the whole text anew. Returns the span (separator included) the next round is compared to.
 */
function settleRestatement(turn: LlmTurn, previous: TextSpan | null, roundStart: number): TextSpan | null {
  if (turn.text.length === roundStart) return previous
  const current = { start: roundStart, end: turn.text.length }
  const kind = previous ? restatement(turn.text.slice(previous.start, previous.end), turn.text.slice(current.start)) : null
  if (!previous || !kind) return current
  if (kind === 'repeats') {
    turn.text = turn.text.slice(0, roundStart)
    emit(turn, { type: 'text', text: turn.text })
    return previous
  }
  const before = turn.text.slice(0, previous.start)
  const body = turn.text.slice(current.start).replace(/^\s+/, '')
  turn.text = `${before}${roundSeparator(before)}${body}`
  emit(turn, { type: 'text', text: turn.text })
  return { start: previous.start, end: turn.text.length }
}

/**
 * Model ↔ tool rounds until the model answers in text; the last round withholds tools so it must answer.
 * `generation` overrides the profile's generation options (a direct chat's own reply cap).
 *
 * Fails the reply (LlmChatError) when the output cap cut tool calls (their arguments are broken: never run, never
 * stored) or when the model answered nothing at all.
 */
/**
 * Meaning-based context of one reply (see chatSemantic), or null when embeddings are off or not answering. Never
 * fails the reply: the keyword paths stand on their own.
 */
function turnHistory(turn: LlmTurn, profile: ChatProfile) {
  // Headless judging/semantic retrieval has its own current view, not the historical order or regeneration window.
  turn.historySource ??= { threadId: turn.threadId, excludeMessageId: turn.replacingMessageId, untilMessageId: CodexChatStore.latestMessageId(turn.threadId) ?? 0 }
  return turn.history ??= readReplyHistory(profile, turn.historySource)
}

/** Translate a stored user row under the same cancellation and lock as its reply. */
function translateTurnInput(turn: LlmTurn, profile: ChatProfile, messageId: number, text: string) {
  if (!hasTranslation(profile)) return
  const flags = CodexChatStore.findMessage(turn.threadId, messageId)?.flags ?? []
  turn.translation = Promise.resolve().then(() => translateUserMessage(profile, text, flags, turn.controller.signal, { threadId: turn.threadId, replyId: turn.delivery?.context.replyId })).then((translated) => {
    if (turn.controller.signal.aborted) return
    // Nothing to translate (an English message, an already-translated row): the stored row stays as it is.
    if (translated.display_content === null && translated.error === null && translated.flags === flags) return
    CodexChatStore.setUserMessageTranslation(turn.threadId, messageId, translated.content, translated.display_content, translated.flags, translated.error)
    turn.history = turn.history?.map((message) => message.id === messageId ? { ...message, ...translated, display_content: translated.display_content ?? message.display_content } : message)
    if (translated.error) emit(turn, { type: 'error', message: translated.error })
  })
  turn.translation.catch(() => undefined)
}

async function replySemanticContext(threadId: number, profile: ChatProfile, messages: CodexChatMessageRecord[], signal: AbortSignal, historySource?: ChatHistorySource): Promise<SemanticContext | null> {
  if (!embeddingFeatureOn('chatRecall') && !embeddingFeatureOn('lorebook')) return null
  try {
    const thread = CodexChatStore.findThreadById(threadId)
    if (!thread) return null
    return await semanticContextFor({ profile, thread, messages, historySource, judgeDecidesLore: Boolean(judgeSetupOf(profile)?.preset.context.lore.enabled), signal })
  } catch (error) {
    console.warn('[LlmChat] semantic context skipped:', error instanceof Error ? error.message : error)
    return null
  }
}

async function streamReply(turn: LlmTurn, requester: McpRequester, profile: ChatProfile, buildMessages: (tools: ChatCompletionTool[], judged: JudgedContext | null) => ChatCompletionMessage[] | Promise<ChatCompletionMessage[]>, generation: Partial<LlmGenerationOptions> = {}, prepare?: (tools: ChatCompletionTool[]) => Promise<unknown>) {
  requireProfileAccess(requester, profile)
  if (turn.research) requireResearchProfile(profile)
  const target = resolveChatCompletionTarget(chatConnectionOf(profile), { model: requestChatModel(profile)?.model ?? null, generation: { ...profileGenerationOptions(profile), ...generation } })
  if (target.transport === 'claude-code' && !resolveChatAccess(requester.accountId).claude) throw new LlmChatError('Claude Code를 사용할 권한이 없어.', 403)
  const { scopes, toolAllowlist } = resolveChatProfileToolGrant(profile, resolveChatAccess(requester.accountId), turn.threadId)
  const chatContext = turn.chatContext ?? turn.delivery?.context
  if (chatContext) {
    chatContext.knowledgeProvider = target.providerName
    chatContext.knowledgeModel = target.model
    chatContext.knowledgeOutputLimit = profile.toolOutputLimit
    recordQuotedBoardKnowledge({ requester, chatContext, source: 'llm-chat', scopes: ['read'] })
  }
  if (chatContext?.page) {
    const page = knowledgePageForExecution({ requester, chatContext, source: 'llm-chat', scopes: ['read'] }, chatContext.page)
    chatContext.page = page
    turn.page = page
  }
  let catalogBudget = () => 12000
  const bridge = !turn.reaction && (scopes.length > 0 || chatContext) ? await openChatMcpBridge(requester, scopes, toolAllowlist, { generationPresetIds: profile.generationPresetIds, chatContext, contentRatingLimit: profileContentLimit(profile), toolCatalogBudget: () => catalogBudget(), research: turn.research }) : null

  // The judge reads the conversation before the request is built: its answers decide the tools, the directive, and
  // the lore and past episodes beyond keywords. A reply carried on or a headless reaction is not judged again.
  let judged: JudgedTurn | null = null
  try {
    // Image viewing is only offered to models the profile says can see images.
    const visible = (bridge?.tools ?? []).filter((tool) => profile.visionEnabled || !isVisionTool(tool.function.name))
    // The tools behind the catalog (open_tools / run_tool) are steered and refused by their own names too.
    const catalogued = [...(bridge?.catalogTools ?? [])].filter((name) => profile.visionEnabled || !isVisionTool(name))
    const cataloguedSet = new Set(catalogued)
    const preparation = prepare ? prepare(visible) : turn.translation
    // Preparation does not depend on semantic scores. Observe early rejection while retrieval is pending.
    preparation?.catch(() => undefined)
    // Closeness in meaning to the latest exchange comes first: the judge's lore and recall candidates use it.
    const semantic = !turn.research && !turn.reaction && !turn.order && turn.continuing === undefined ? await replySemanticContext(turn.threadId, profile, turnHistory(turn, profile), turn.controller.signal, turn.historySource) : null
    // The judge reads the user's own words, so it runs while their message is translated for the model.
    const judging = !turn.research && !turn.reaction && !turn.order && turn.continuing === undefined
      ? judgeBeforeReply({ profile, threadId: turn.threadId, replyId: chatContext?.replyId ?? null, availableTools: [...visible.map((tool) => tool.function.name), ...catalogued], messages: turnHistory(turn, profile), context: true, signal: turn.controller.signal, semantic })
      : Promise.resolve(null)
    judged = (await Promise.all([judging, preparation]))[0]
    // The tool list stays the profile's every turn: tool definitions open the prompt, so a list that changes with the
    // judge's verdicts would make a local server or a provider cache read the whole prompt again. Tools the judge
    // withholds this turn are named in the directive and refused if called, unless the user's flags are on: those
    // come first, so a flag asking for a withheld tool still gets it.
    const allowed = judged ? judged.filterTools(visible) : visible
    const withheld = [
      ...visible.filter((tool) => !allowed.includes(tool)).map((tool) => tool.function.name),
      ...catalogued.filter((name) => judged !== null && judged.filterTools([{ type: 'function', function: { name, parameters: {} } }]).length === 0),
    ]
    const blocked = new Set(judged?.userInstructed ? [] : withheld)
    const offeredTools = visible
    turn.offeredTools = offeredTools
    const built = await buildMessages(offeredTools, withSemanticContext(judged?.context ?? null, semantic))
    // Plugins listening to chat.instructions rewrite the system message (session engines do it where they build theirs).
    if (!turn.research && !turn.engineSession && hasPluginServerHook('chat.instructions')) {
      const at = built.findIndex((message) => message.role === 'system')
      const current = at >= 0 && typeof built[at].content === 'string' ? built[at].content as string : ''
      const next = await applyChatInstructionHooks(current, { engine: 'llm', threadId: turn.threadId, group: CodexChatStore.findThreadById(turn.threadId)?.kind === 'group', profile: { id: profile.id, name: profile.name } }, requester)
      if (next !== current) {
        if (at >= 0) built[at] = { ...built[at], content: next } as typeof built[number]
        else built.unshift({ role: 'system', content: next })
      }
    }
    if (!turn.engineSession && offeredTools.some(tool => tool.function.name === 'workspace_read')) {
      const instruction = workspaceInstructions(chatWorkspace(requester, turn.threadId, profile.id))
      if (instruction) built.unshift({ role: 'system', content: instruction })
    }
    // Record the completed session without capturing its private history or filesystem path.
    const engineSession = turn.engineSession ? {
      ...turn.engineSession,
      onDone: (id: string, compacted: boolean) => {
        turn.engineSession!.onDone(id, compacted)
        if (turn.contextMeta?.session) turn.contextMeta.session.compacted = compacted === true
      },
    } : undefined
    if (turn.engineSession?.runtime === 'pi') {
      // The same connection and model, run by pi, which folds its session at the profile's context (its 최대
      // 컨텍스트 or what the server runs with; the first reply waits for the lookup the sizing above started).
      target.transport = 'pi'
      target.piSession = engineSession
      target.contextWindow = profile.contextTokens ?? await serverContextLimit(target)
      target.piVision = profile.visionEnabled
    } else if (engineSession) target.claudeSession = engineSession
    const directive = judgeDirectiveText(judged, withheld)
    const messages = directive ? appendUserDirective(built, directive, 'judge') : built
    // Session engines own their accumulated context; only direct API requests can calculate the remaining room here.
    if (!engineSession && profile.contextTokens !== null) catalogBudget = () => Math.max(0, profile.contextTokens! - estimateMessagesTokens(profile.id, messages, offeredTools) - 2048)
    const offeredNames = new Set([...offeredTools.map((tool) => tool.function.name), ...catalogued])
    const refreshTools = async () => {
      await bridge?.refresh()
      offeredTools.splice(0, offeredTools.length, ...(bridge?.tools ?? []).filter(tool => profile.visionEnabled || !isVisionTool(tool.function.name)))
      cataloguedSet.clear()
      for (const name of bridge?.catalogTools ?? []) if (profile.visionEnabled || !isVisionTool(name)) cataloguedSet.add(name)
      offeredNames.clear()
      for (const name of [...offeredTools.map(tool => tool.function.name), ...cataloguedSet]) offeredNames.add(name)
      return offeredTools.filter(tool => isChatProposalToolAvailable(chatContext, tool.function.name))
    }
    const permitted = (name: string) => offeredNames.has(name) && !blocked.has(name) && isChatProposalToolAvailable(chatContext, name)
    if (judged && turn.contextMeta) turn.contextMeta.judge = judged.diagnostics
    let previousRound: TextSpan | null = null
    const replyCap = target.generation.maxTokens
    // Where this reply's tool rounds begin in `messages` (fitting may drop conversation before them).
    let turnStart = messages.length
    let wrapUp = false
    // Research carries its own count of the same limit (ChatResearchExecution); a chat reply reads it as it starts.
    const toolRounds = turn.research ? turn.research.maxTurns - 1 : chatToolRoundLimit()
    for (let round = 1; ; round += 1) {
      turn.controller.signal.throwIfAborted()
      if (turn.research && !turn.research.canCallModel()) return
      let tools = bridge ? await refreshTools() : []
      // A request over the limit sheds old turns and cuts tool results first (fitChatContext). When a later round
      // still does not fit, the reply wraps up with what it did instead of failing; a first round has nothing to tell.
      try {
        const fitted = fitChatContext(profile, messages, tools, replyCap, turnStart)
        turnStart = fitted.length - (messages.length - turnStart)
        if (fitted !== messages) messages.splice(0, messages.length, ...fitted)
      } catch (error) {
        if (round === 1) throw error
        const last = wrapUpRequest(profile, messages, tools, replyCap, turnStart)
        messages.splice(0, messages.length, ...last.messages)
        tools = last.tools
        wrapUp = true
      }
      // The last round keeps the same tool list (and so the cached prompt) and tells the model to answer in text.
      const researchFinal = turn.research?.finalModelRound() ?? false
      const lastRound = wrapUp || (!turn.research && round > toolRounds) || researchFinal
      if (turn.research && lastRound) tools = []
      // The cap goes out cut to the room this round's prompt leaves.
      target.generation = { ...target.generation, maxTokens: replyCapFor(profile, messages, tools, replyCap) }
      const rawEstimate = round === 1 ? rawMessagesEstimate(messages, tools) : 0
      if (turn.contextMeta?.version === 2 && round === 1) {
        turn.contextMeta = limitContextMeta({ ...turn.contextMeta, sections: contextSections(messages, tools, (text) => estimateTokens(profile.id, text)), estimatedTokens: estimateMessagesTokens(profile.id, messages, tools) })
      }
      // A continuation joins the cut text directly; other rounds start a new paragraph, without leading blank lines.
      const joins = round === 1 && turn.continuing !== undefined
      const roundStart = turn.text.length
      const requestRound = () => {
        let started = false
        // An echoed `[message_id=…]` label at the start never reaches the reader, live or stored.
        const filter = addressLabelFilter((text) => {
          let delta = text
          if (!started) {
            if (!joins) delta = delta.replace(/^\s+/, '')
            if (!delta) return
            if (!joins) delta = `${roundSeparator(turn.text)}${delta}`
            started = true
          }
          turn.text += delta
          emit(turn, { type: 'delta', text: delta })
        })
        // A tool call the server left in the text (no tool-call parser for this model) is held back and run as a
        // call; session transports recover their own inside the run (piChatCompletion).
        // Even on the final text-only round, recognized markup must not become assistant speech.
        const recovering = !target.transport
        const textFilter = textToolCallFilter(filter.push)
        return streamChatCompletion({
          target,
          messages,
          tools,
          refreshTools: lastRound ? undefined : refreshTools,
          catalogued: cataloguedSet,
          ...(lastRound && tools.length > 0 ? { toolChoice: 'none' as const } : {}),
          signal: turn.controller.signal,
          allowCompatibilityFallback: !turn.reaction && !turn.research,
          retry: !turn.reaction && !turn.research,
          canRetry: () => turn.text.length === (turn.continuing?.length ?? 0) && turn.reasoning.length === 0,
          stopLoops: true,
          maxToolRounds: toolRounds,
          research: turn.research,
          usage: { purpose: 'chat', profileId: profile.id, threadId: turn.threadId, replyId: chatContext?.replyId, round: target.transport ? null : round },
          callTool: bridge ? async (name, args, id) => {
            await refreshTools()
            requireProfileAccess(requester, profile)
            if (turn.research) {
              requireRequesterPermission(requester, 'posts.view')
              turn.research.validateSources(requester, profile.id)
              if (!turn.research.takeTool()) return { isError: true, content: [{ type: 'text', text: 'A summary has no tools. Answer only from the text already supplied.' }] }
            }
            const target = unwrapCatalogCall(name, args).tool
            if (!permitted(target)) return { isError: true, content: [{ type: 'text', text: `${target} is not available in this reply.` }] }
            return (await runToolCall(turn, bridge, { id, function: { name, arguments: JSON.stringify(args) } }, profile.toolOutputLimit, [])).nativeResult
          } : undefined,
          onRequestBody: (body, actualTarget) => {
            if (turn.research) {
              requireProfileAccess(requester, profile)
              requireRequesterPermission(requester, 'posts.view')
              turn.research.validateSources(requester, profile.id)
              turn.research.takeModel()
            }
            turn.requestSent = true
            if (turn.contextMeta?.version === 2) {
              turn.contextMeta.runtime = actualTarget.transport ?? 'direct'
              if (engineSession) turn.contextMeta.session = { resumed: Boolean(engineSession.resumeId) }
            }
            const diagnostics = loadChatSettings().diagnostics
            if (diagnostics.enabled && diagnostics.captureRaw) turn.requestCapture = redactChatRequestBody(body, actualTarget)
          },
          onContent: recovering ? textFilter.push : filter.push,
          onReasoning: (text) => {
            turn.reasoning += text
            emit(turn, { type: 'reasoning', text })
          },
        }).then((answer) => {
          const held = textFilter.end()
          // Cut calls never execute, but recognized tool markup is not assistant speech either.
          const recovered = recovering ? recoverTextToolCalls(answer.content, held, { tools, catalogued: cataloguedSet }, true) : null
          filter.push(recovered ? recovered.tail : held.text)
          filter.flush()
          if (recovered) noteTextToolCalls(target)
          // Native calls take precedence over a textual copy, so recovery cannot execute the same write twice.
          const cut = answer.finishReason === 'length' || answer.finishReason === 'repetition'
          const value = recovered ? { ...answer, content: recovered.text, toolCalls: lastRound || cut || answer.toolCalls.length > 0 ? answer.toolCalls : recovered.calls } : answer
          // The loop was already shown live: take it back off the reply.
          if (value.loopCut) {
            turn.text = turn.text.slice(0, Math.max(roundStart, turn.text.length - value.loopCut)).trimEnd()
            emit(turn, { type: 'text', text: turn.text })
          }
          return value
        })
      }
      // Session transports execute tools inside this call. Retrying the whole agent can repeat a completed write;
      // pi already retries individual provider requests itself. Direct API rounds never execute tools here.
      const result = await requestRound()

      if (round === 1 && result.promptTokens) {
        recordPromptUsage(profile.id, rawEstimate, result.promptTokens)
        if (turn.contextMeta) turn.contextMeta.promptTokens = result.promptTokens
      }
      if (turn.contextMeta?.version === 2) turn.contextMeta.toolRounds = round - (result.toolCalls.length > 0 ? 0 : 1)
      // Tool calls the output cap cut off carry broken arguments: never run them, nor send them again.
      if (result.finishReason === 'length' && result.toolCalls.length > 0) {
        throw new LlmChatError(REPLY_FAILURES.toolCallsCut)
      }
      previousRound = settleRestatement(turn, previousRound, roundStart)
      if (!bridge || tools.length === 0 || lastRound || result.toolCalls.length === 0) {
        if (turn.research && lastRound && result.toolCalls.length > 0 && turn.research.result.stopReason === 'completed') turn.research.result.stopReason = 'model_limit'
        turn.finishReason = result.finishReason
        // Nothing to show at all (thinking ate the cap, or the model said nothing) is a failure the reader can retry.
        if (!turn.reaction && !turn.order && turn.continuing === undefined && turn.toolCalls.size === 0 && !replyContent(turn.text)) {
          throw new LlmChatError(result.finishReason === 'length' ? REPLY_FAILURES.emptyAtCap : REPLY_FAILURES.empty)
        }
        return
      }

      messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls })
      const images: string[] = []
      for (const call of result.toolCalls) {
        if (turn.controller.signal.aborted) {
          return
        }
        if (turn.research && !turn.research.takeTool()) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: 'A summary has no tools. Answer only from the text already supplied.' })
          continue
        }
        await refreshTools()
        const target = calledTool(call.function.name, call.function.arguments)
        messages.push({ role: 'tool', tool_call_id: call.id, content: permitted(call.function.name) && permitted(target)
          ? (await runToolCall(turn, bridge, call, profile.toolOutputLimit, images)).text
          : blocked.has(target) ? `${target} is not available in this reply.` : `Unknown or not permitted tool: ${target}` })
      }
      // An order is done once its job went through: what the model would say about it is never shown.
      if (turn.order && [...turn.toolCalls.values()].some((call) => call.status === 'completed' && turn.order!.done(call))) return
      // Tool messages carry text only, so images ride in a user message right after them (this request only).
      if (images.length > 0 && profile.visionEnabled) {
        messages.push({ role: 'user', content: [{ type: 'text', text: 'Images returned by the tools above, in order:' }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))] })
      }
    }
  } finally {
    endJudgedTurn(judged, [...turn.toolCalls.values()].map((call) => call.tool))
    await bridge?.close()
  }
}

/** Stores the reply (translated for the reader first, while the turn still counts as running) and announces it. */
async function finishTurn(turn: LlmTurn, profile: ChatProfile, status: CodexChatMessageRecord['status'], error: string | null) {
  if (turn.reaction && (turn.controller.signal.aborted || status !== 'completed')) {
    if (turn.controller.signal.aborted) return null
    throw new LlmChatError(error ?? '완료 반응을 만들지 못했어.')
  }
  const toolCalls = [...turn.toolCalls.values()].map((call) => (call.status === 'running' ? { ...call, status: 'failed' as const } : call))
  const content = replyContent(turn.text)
  const finishReason = status === 'completed' ? turn.finishReason : null
  let displayContent: string | null = null
  if (status === 'completed' && content && hasTranslation(profile)) {
    emit(turn, { type: 'translating' })
    displayContent = await translateReply(profile, content, turn.controller.signal, userPersonaForThread(CodexChatStore.findThreadById(turn.threadId)).name, { threadId: turn.threadId })
  }
  const save = () => CodexChatStore.addMessage({
    thread_id: turn.threadId,
    role: 'assistant',
    content,
    display_content: displayContent,
    tool_calls: toolCalls,
    status,
    error,
    finish_reason: finishReason,
    routing: turn.delivery?.routing,
    speaker_profile_id: turn.reaction && CodexChatStore.findThreadById(turn.threadId)?.kind === 'group' ? profile.id : null,
  })
  if (turn.reaction) turn.controller.signal.throwIfAborted()
  const messageId = turn.reaction ? turn.reaction.persist(content ? save : null) : turn.replacingMessageId ?? save()
  if (messageId === null) return null
  let stored = !turn.replacingMessageId
  let errorShown = false
  if (turn.replacingMessageId) {
    // A connection failure must not replace a usable answer with an empty failed alternative; nor may a continuation
    // that added nothing (failed, stopped, or answered empty) replace the cut reply with a copy of it.
    const continuedNothing = turn.continuing !== undefined && content === turn.continuing.trim()
    if (!continuedNothing && (status === 'completed' || content || toolCalls.length)) {
      let routing = turn.delivery?.routing
      if (turn.continuing !== undefined && routing) {
        const before = turn.continuingRouting
        const replyId = routing.replyId
        routing = { ...routing, recipients: before?.recipients ?? routing.recipients, replyTo: before?.replyTo ?? null }
        if (before?.replyId && replyId) CodexChatStore.moveGenerationLinks(turn.threadId, before.replyId, replyId)
      }
      CodexChatStore.addAlternative(turn.threadId, messageId, { content, display_content: displayContent, tool_calls: toolCalls, status, error, finish_reason: finishReason, routing, created_at: new Date().toISOString() })
      stored = true
    } else if (error || continuedNothing) {
      emit(turn, { type: 'error', message: error ?? '이어 쓸 내용이 없었어.' })
      errorShown = true
    }
  }
  // A failed reply says why on the stream too, not only on the stored message (a reply with nothing to show would
  // otherwise just end empty).
  if (error && !errorShown) emit(turn, { type: 'error', message: error })
  if (turn.contextMeta && stored && (status === 'completed' || content || turn.requestSent)) {
    CodexChatStore.setContextMeta(messageId, loadChatSettings().diagnostics.enabled ? limitContextMeta(turn.contextMeta) : legacyContextMeta(turn.contextMeta))
    saveChatRequestCapture(messageId, turn.requestCapture)
  }
  const message = CodexChatStore.findMessage(turn.threadId, messageId) as CodexChatMessageRecord
  if (activeTurns.get(turn.threadId) === turn) activeTurns.delete(turn.threadId)
  emit(turn, { type: 'done', message })
  turn.listeners.clear()
  return message
}

const CONTINUE_DIRECTIVE = '[이어쓰기] 방금 네 답변이 길이 제한으로 중간에 끊겼어. 끊긴 바로 그 지점부터 이어서 써. 이미 쓴 부분은 반복하지 말고, 앞말 없이 다음 글자부터 바로 시작해.'

/**
 * All validation and rewrites happen synchronously while this thread is reserved. `continuing`: the reply being
 * carried on — the turn starts with its text and tool calls, and is stored as a new variant of it.
 */
function startReply(requester: McpRequester, thread: CodexChatThreadRecord, profile: ChatProfile, listener: (event: CodexChatStreamEvent) => void,
  prepare: () => CodexChatStreamEvent, replacingMessageId?: number, continuing?: CodexChatMessageRecord, page?: ChatPageSnapshot): Promise<CodexChatMessageRecord>
function startReply(requester: McpRequester, thread: CodexChatThreadRecord, profile: ChatProfile, listener: (event: CodexChatStreamEvent) => void,
  prepare: null, replacingMessageId: undefined, continuing: undefined, page: undefined, reaction: GenerationReaction): Promise<CodexChatMessageRecord | null>
function startReply(requester: McpRequester, thread: CodexChatThreadRecord, profile: ChatProfile, listener: (event: CodexChatStreamEvent) => void,
  prepare: (() => CodexChatStreamEvent) | null, replacingMessageId?: number, continuing?: CodexChatMessageRecord, page?: ChatPageSnapshot, reaction?: GenerationReaction) {
  return withChatTokenModel(profile, () => {
  if (busy(thread.id)) throw new LlmChatError('이전 답변이 아직 진행 중이야.', 409)
  let resolveFinished: (message: CodexChatMessageRecord | null) => void = () => {}
  let rejectFinished: (error: unknown) => void = () => {}
  const turn: LlmTurn = {
    reaction,
    page,
    threadId: thread.id, replacingMessageId, controller: new AbortController(), text: '', reasoning: '', toolCalls: new Map(), finishReason: null,
    offeredTools: [], listeners: new Set([listener]), finished: new Promise((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject }),
  }
  if (continuing) {
    turn.continuing = continuing.content
    turn.continuingRouting = continuing.routing
    turn.text = continuing.content
    for (const call of continuing.tool_calls) turn.toolCalls.set(call.id, call)
  }
  activeTurns.set(thread.id, turn)
  try {
    if (prepare) emit(turn, prepare())
  } catch (error) {
    activeTurns.delete(thread.id)
    throw error
  }
  // The live reply shows the cut text, the continuation streams onto it.
  if (continuing) emit(turn, { type: 'delta', text: continuing.content })
  const updatedThread = CodexChatStore.findThreadById(thread.id) as CodexChatThreadRecord
  // Session recaps/outcomes and room turn boundaries have explicit historical reads, separate from request bodies.
  const source: ChatHistorySource = { threadId: thread.id, excludeMessageId: replacingMessageId, untilMessageId: CodexChatStore.latestMessageId(thread.id) ?? 0 }
  const config = resolveContextConfig(updatedThread, profile)
  const group = updatedThread.kind === 'group' ? readGroupReplyHistory(updatedThread, profile, source) : null
  const inSession = sessionRuntimeOf(profile) && !reaction && continuing === undefined
  const history = group?.messages ?? readReplyHistory(profile, source, Number.MAX_SAFE_INTEGER, inSession ? undefined : config.contextTurns)
  turn.historySource = source
  turn.groupHistory = group?.history
  turn.history = history
  turn.delivery = beginDirectReply(updatedThread, profile.id, history, [...history].reverse().find((entry) => entry.role === 'user') ?? null, turn.controller.signal, (routing) => emit(turn, { type: 'routing', routing }), turn.historySource)
  if (reaction) turn.delivery.routing = { ...turn.delivery.routing, replyTo: null, recipients: ['user'] }
  if (page) turn.chatContext = { ...turn.delivery.context, page }
  // A cancelled preparation (or a failed translation) may have left only the user's original row. Both retry
  // actions use the same translation promise as a new send, before API or session request construction.
  if (replacingMessageId && !turn.translation) {
    const latestUser = [...history].reverse().find(message => message.role === 'user')
    if (latestUser && latestUser.display_content == null) translateTurnInput(turn, profile, latestUser.id, latestUser.content)
  }
  let stored: CodexChatMessageRecord | null = null
  void withLlmUsageContext({ threadId: thread.id, replyId: turn.delivery.context.replyId }, () => runReply(turn, requester, updatedThread, profile)
    .then(() => finishTurn(turn, profile, turn.controller.signal.aborted ? 'interrupted' : 'completed', null), (error: unknown) => {
      const aborted = turn.controller.signal.aborted
      return finishTurn(turn, profile, aborted ? 'interrupted' : 'failed', aborted ? null : error instanceof Error ? error.message : String(error))
    })
    .then((message) => { stored = message ?? null; resolveFinished(message) }, rejectFinished)
    .finally(() => {
      turn.delivery?.close()
      if (activeTurns.get(thread.id) === turn) activeTurns.delete(thread.id)
      turn.listeners.clear()
      if (turn.controller.signal.aborted) return
      // The status fields the reply left alone are settled by the judge (in the background).
      if (stored) judgeStatusFields({ profile, threadId: thread.id, messageId: stored.id, speakerId: thread.kind === 'group' ? profile.id : undefined })
      // A direct chat's finished reply (or follow-up) may get a follow-up message from the judge.
      if ((!reaction || reaction.followUp) && thread.kind !== 'group') {
        const last = CodexChatStore.latestMessage(thread.id)
        if (last) judgeAfterReply({ profile, threadId: thread.id, message: last, write: (directive, signal) => writeFollowUp(requester, thread.id, profile.id, directive, signal) })
      }
      if (reaction || (sessionRuntimeOf(profile) && thread.kind === 'direct')) return
      summarizeAhead(thread.id, profile, turn.offeredTools).catch((error: unknown) => {
        console.warn('[llm-chat] summary update failed:', error instanceof Error ? error.message : error)
      })
    }))
  return turn.finished
  })
}

/**
 * The judge's follow-up: a headless reply (like a generation reaction) told to add one more message. Skipped when the
 * chat or profile changed meanwhile or another turn runs; the user's next message interrupts it.
 */
function writeFollowUp(requester: McpRequester, threadId: number, profileId: number, directive: string, signal: AbortSignal) {
  const thread = CodexChatStore.findThreadById(threadId)
  const profile = ChatProfileStore.find(profileId)
  if (!thread || thread.profile_id !== profileId || !profile?.isEnabled || (profile.engine !== 'llm' && profile.engine !== 'claude') || busy(threadId) || signal.aborted) return Promise.resolve(null)
  const onAbort = () => LlmChatService.skipReaction(threadId)
  signal.addEventListener('abort', onAbort, { once: true })
  return LlmChatService.react(requester, thread, profile, {
    result: { role: 'user', content: directive },
    persist: (save) => (save ? save() : null),
    skip: () => {},
    followUp: true,
  }).finally(() => signal.removeEventListener('abort', onAbort))
}

export type GroupReplyResult =Pick<CodexChatMessageRecord, 'content' | 'tool_calls' | 'status' | 'error'> & { finish_reason?: string | null; contextMeta?: ChatContextMeta; requestCapture?: string }

/**
 * One group room member's reply (not stored here: the room stores it with its speaker). Streams `delta`,
 * `reasoning` and `tool` events to `emit`; `signal` stops it, leaving what was written as an interrupted reply.
 */
export function generateLlmGroupReply(params: HeadlessReplyParams): Promise<GroupReplyResult> {
  return runHeadlessReply(params)
}

type HeadlessReplyParams = {
  research?: ChatResearchExecution
  chatContext: ChatExecutionContext
  requester: McpRequester
  threadId: number
  profile: ChatProfile
  /** `useSession`: a Claude member's turn continues its own session (see buildClaudeGroupSessionTurn). */
  buildMessages: (tools: ChatCompletionTool[], onMeta: (meta: ChatContextMeta) => void, judged: JudgedContext | null, useSession: (session: EngineSession) => void) => ChatCompletionMessage[] | Promise<ChatCompletionMessage[]>
  /** Overrides of the profile's generation options (the member's or room's reply cap). */
  generation?: Partial<LlmGenerationOptions>
  signal: AbortSignal
  emit: (event: CodexChatStreamEvent) => void
}

/**
 * An order on an earlier reply (see chatOrderRunner), by an API LLM profile: the request `buildMessages` lays out ends
 * with the order, the tools run in the reply's name (`chatContext.replyId`), and the rounds end once a call `done`
 * accepts went through. Nothing is stored here; the text the model writes is not kept.
 */
export function runLlmOrderTurn(params: HeadlessReplyParams & { done: (call: CodexChatToolCall) => boolean }): Promise<GroupReplyResult> {
  return runHeadlessReply(params, { done: params.done })
}

async function runHeadlessReply(params: HeadlessReplyParams, order?: LlmTurn['order']): Promise<GroupReplyResult> {
  assertLlmChatAvailable(params.requester)
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (params.signal.aborted) abort()
  params.signal.addEventListener('abort', abort, { once: true })
  const turn: LlmTurn = {
    research: params.research,
    chatContext: params.chatContext,
    order,
    threadId: params.threadId, controller, text: '', reasoning: '', toolCalls: new Map(), finishReason: null,
    offeredTools: [], listeners: new Set([params.emit]), finished: Promise.resolve({} as CodexChatMessageRecord),
  }
  let status: CodexChatMessageRecord['status'] = 'completed'
  let error: string | null = null
  try {
    await withChatTokenModel(params.profile, () => withLlmUsageContext({ threadId: params.threadId, replyId: params.chatContext?.replyId }, () => streamReply(turn, params.requester, params.profile, (tools, judged) => params.buildMessages(tools, (meta) => { turn.contextMeta = { ...meta, model: resolveProfileModel(params.profile, 'chat')?.model ?? null } }, judged, (session) => { turn.engineSession = session }), params.generation ?? {})))
    if (controller.signal.aborted) status = 'interrupted'
  } catch (caught) {
    status = controller.signal.aborted ? 'interrupted' : 'failed'
    error = controller.signal.aborted ? null : caught instanceof Error ? caught.message : String(caught)
  } finally {
    params.signal.removeEventListener('abort', abort)
  }
  const toolCalls = [...turn.toolCalls.values()].map((call) => (call.status === 'running' ? { ...call, status: 'failed' as const } : call))
  return { content: replyContent(turn.text), tool_calls: toolCalls, status, error, finish_reason: status === 'completed' ? turn.finishReason : null, contextMeta: turn.requestSent ? turn.contextMeta : undefined, requestCapture: turn.requestCapture }
}

export const LlmChatService = {
  /** Reserve the usual thread lock, without a user row, tools, retries or background summaries. */
  react(requester: McpRequester, thread: CodexChatThreadRecord, profile: ChatProfile, reaction: GenerationReaction) {
    assertLlmChatAvailable(requester)
    return startReply(requester, thread, profile, () => {}, null, undefined, undefined, undefined, reaction)
  },

  skipReaction(threadId: number) {
    const turn = activeTurns.get(threadId)
    if (!turn?.reaction) return
    turn.reaction.skip()
    turn.controller.abort()
    if (activeTurns.get(threadId) === turn) activeTurns.delete(threadId)
  },
  /** `userProfileId`: the account's user profile in the chat (already checked), null for the plain user. */
  /** The profile a new chat would talk to, when this requester may start one. */
  requireStartableProfile(requester: McpRequester, profileId: number) {
    assertLlmChatAvailable(requester)
    return requireUsableProfile(profileId, requester)
  },

  createThread(requester: McpRequester, profileId: number, userProfileId: number | null = null, greetingIndex?: number | null) {
    assertLlmChatAvailable(requester)
    const profile = requireUsableProfile(profileId, requester)
    const user = ChatUserProfileStore.requireOwn(requester.accountId, userProfileId)
    const threadId = CodexChatStore.createThread(requester.accountId, '', 'llm', profile.id)
    if (user) ChatUserProfileStore.setThreadUserProfile(threadId, user.id)
    addChatOpening(threadId, profile, userPersonaOf(user), greetingIndex)
    return threadId
  },

  running(threadId: number) {
    const turn = activeTurns.get(threadId)
    // Headless reactions appear once stored; reporting them as a user turn would disable the send button.
    return turn && !turn.reaction ? { text: turn.text, toolCalls: [...turn.toolCalls.values()], replacingMessageId: turn.replacingMessageId, routing: turn.delivery?.routing } : null
  },

  isRunning(threadId: number) {
    return busy(threadId)
  },
  hasActiveWork(threadId: number) {
    return activeTurns.has(threadId) || isChatOrderRunning(threadId)
  },
  replyFinished(threadId: number) {
    return activeTurns.get(threadId)?.finished
  },

  /**
   * Send one user message and stream the reply to `listener`. Resolves with the stored assistant message; the reply
   * keeps running (and is stored) when the listener goes away.
   */
  async sendMessage(requester: McpRequester, thread: CodexChatThreadRecord, text: string, listener: (event: CodexChatStreamEvent) => void, fileIds?: unknown, flagIds?: unknown, picks?: unknown, mediaHashes?: unknown, replyToMessageId?: unknown, pageContext?: unknown, options: ChatSendOptions = {}) {
    assertLlmChatAvailable(requester)
    const profile = requireUsableProfile(thread.profile_id, requester)
    const { page, attachments, mediaAttachments, flags, trimmed, routing } = prepareChatSend(requester, thread, profile, text,
      { fileIds, flagIds, picks, mediaHashes, replyToMessageId, pageContext, options }, LlmChatError)
    LlmChatService.skipReaction(thread.id)
    cancelJudgeFollowUp(thread.id)
    if (busy(thread.id)) throw new LlmChatError('이전 답변이 아직 진행 중이야.', 409)
    skipThreadGenerationReactions(thread.id)
    // An untitled chat is named after this message now, and after what was said once the reply is stored.
    const firstTitle = thread.title ? null : (withoutNarrationMarks(trimmed) || attachments[0]?.name || mediaAttachments[0]?.name || '').replace(/\s+/g, ' ')
    let namedFromMessage = false
    const reply = startReply(requester, thread, profile, listener, () => {
      const userMessageId = CodexChatStore.addMessage({ thread_id: thread.id, role: 'user', content: trimmed, display_content: null, tool_calls: [], status: 'completed', error: null, flags, mediaAttachments, routing }, attachments.map((file) => file.id))
      rememberChatPage(requester, page, thread.id)
      if (!options.task && !options.routine) notifyChatUserSend(thread.id, Boolean(page))
      options.onDelivered?.(userMessageId)
      // The model reads the message in English; the reader keeps their own words. The message is shown right away and
      // translated beside the judge (the turn is already reserved here, see startReply).
      const turn = activeTurns.get(thread.id)
      if (turn) translateTurnInput(turn, profile, userMessageId, trimmed)
      ChatFlagStore.setThreadFlags(thread.id, flags.filter((flag) => !flag.pick).map((flag) => flag.id))
      if (firstTitle !== null) namedFromMessage = CodexChatStore.renameThreadIf(thread.id, '', firstTitle)
      return { type: 'user', message: CodexChatStore.findMessage(thread.id, userMessageId) as CodexChatMessageRecord }
    }, undefined, undefined, page)
    if (firstTitle !== null && namedFromMessage) void titleAfterFirstReply(profile, thread, firstTitle, trimmed, reply)
    return reply
  },

  async rewriteMessage(requester: McpRequester, thread: CodexChatThreadRecord, messageId: number, content: string | undefined, listener: (event: CodexChatStreamEvent) => void) {
    assertLlmChatAvailable(requester)
    const profile = requireUsableProfile(thread.profile_id, requester)
    cancelJudgeFollowUp(thread.id)
    if (busy(thread.id)) throw new LlmChatError('이전 답변이 아직 진행 중이야.', 409)
    const message = CodexChatStore.findMessage(thread.id, messageId)
    if (!message) throw new LlmChatError('메시지를 찾을 수 없어.', 404)
    const regenerate = content === undefined
    if (regenerate ? message.role !== 'assistant' || CodexChatStore.latestMessageId(thread.id) !== messageId || CodexChatStore.latestUserMessageId(thread.id) === null : message.role !== 'user') {
      throw new LlmChatError(regenerate ? '마지막 답변만 다시 생성할 수 있어.' : '내 메시지만 수정할 수 있어.', 409)
    }
    if (!regenerate && !content.trim() && !message.attachments?.length && !message.mediaAttachments?.length) throw new LlmChatError('메시지를 입력해줘.')
    // Resolve configuration before deleting any later messages.
    resolveChatCompletionTarget(chatConnectionOf(profile), { model: resolveProfileModel(profile, 'chat')?.model ?? null, generation: profileGenerationOptions(profile) })
    const edited = regenerate ? null : content.trim()
    return startReply(requester, thread, profile, listener, () => {
      if (regenerate) CodexChatStore.prepareRegeneration(thread.id, messageId)
      else {
        CodexChatStore.editUserMessage(thread.id, messageId, edited as string)
        translateTurnInput(activeTurns.get(thread.id)!, profile, messageId, edited as string)
      }
      return { type: 'rewind', mode: regenerate ? 'regenerate' : 'edit', message: regenerate ? message : { ...message, content: edited as string, display_content: null, error: null } }
    }, regenerate ? messageId : undefined)
  },

  /** Carry on the last reply where it was cut: the result (old text + new) becomes a new variant of it. */
  continueReply(requester: McpRequester, thread: CodexChatThreadRecord, messageId: number, listener: (event: CodexChatStreamEvent) => void) {
    assertLlmChatAvailable(requester)
    const profile = requireUsableProfile(thread.profile_id, requester)
    cancelJudgeFollowUp(thread.id)
    if (busy(thread.id)) throw new LlmChatError('이전 답변이 아직 진행 중이야.', 409)
    const message = CodexChatStore.latestMessage(thread.id)
    if (!message || message.id !== messageId || message.role !== 'assistant' || CodexChatStore.latestUserMessageId(thread.id) === null) {
      throw new LlmChatError('마지막 답변만 이어 쓸 수 있어.', 409)
    }
    if (!message.content.trim()) throw new LlmChatError('이어 쓸 답변 내용이 없어.', 409)
    resolveChatCompletionTarget(chatConnectionOf(profile), { model: resolveProfileModel(profile, 'chat')?.model ?? null, generation: profileGenerationOptions(profile) })
    return startReply(requester, thread, profile, listener, () => {
      CodexChatStore.prepareRegeneration(thread.id, messageId)
      return { type: 'rewind', mode: 'regenerate', message }
    }, messageId, message)
  },

  interrupt(threadId: number) {
    activeTurns.get(threadId)?.controller.abort()
    void stopChatOrderRun(threadId, 0)
  },

  /** Stop a running reply and wait (bounded) until it is stored, e.g. before deleting the thread. */
  async stop(threadId: number) {
    cancelJudgeFollowUp(threadId)
    await stopChatOrderRun(threadId, STOP_WAIT_MS)
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
    const profile = requireUsableProfile(thread.profile_id, requester)
    if (busy(thread.id)) throw new LlmChatError('이전 답변이 아직 진행 중이야.', 409)
    const summary = await summarizeAll(thread.id, profile)
    if (summary === null) {
      throw new LlmChatError('요약할 새 대화가 없거나 이미 요약 중이야.', 409)
    }
    return summary
  },
}
