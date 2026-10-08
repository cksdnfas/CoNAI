import type { ChatJudgeDiagnostics, ChatJudgeItem, ChatJudgeItemResult, ChatJudgePreset, ChatJudgeStage, ChatJudgeTestTurn, ChatJudgeVerdict } from '@conai/shared'
import { resolveProfileModel } from './chatModelRoles'
import { askableJudgeItems, ChatJudgePresetStore } from './chatJudgePresets'
import { askJudge, JudgeError, resolveJudgeConnection, type JudgeAnswer, type JudgeConnection } from './chatJudgeEngine'
import { ChatJudgeLogStore, judgeToolMatches } from './chatJudgeLogs'
import { DEFAULT_FOLLOW_UP_DIRECTIVE } from './chatJudgeDefaults'
import { ChatProfileStore, type ChatProfile } from './chatProfiles'
import { userPersonaForThread } from './chatUserProfiles'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import type { ChatCompletionTool } from './llmChatCompletion'

/**
 * The judge step of an API LLM chat turn (profiles with a judge preset only; Claude and Codex never). Before the
 * reply, the preset's questions about the latest exchange decide which steered tools the reply is offered and what it
 * is told; after a direct chat's reply, they decide whether the character sends a follow-up message. The judge reads
 * the conversation in its original words (the user's own text, the model's own reply), never a translation. When the
 * judge cannot be reached the turn goes on exactly as without one.
 */

/** Characters of one message the judge reads. */
const MESSAGE_CHARS = 1500

export type JudgeSetup = { preset: ChatJudgePreset; providerName: string; model: string }

/** The preset and connection that judge this profile's turns, or null (no preset, no connection, not an API LLM). */
export function judgeSetupOf(profile: ChatProfile): JudgeSetup | null {
  if (profile.engine !== 'llm' || !profile.judgePresetId) return null
  const preset = ChatJudgePresetStore.find(profile.judgePresetId)
  if (!preset) return null
  const providerName = profile.judgeProviderName ?? preset.providerName
  if (!providerName) return null
  return { preset, providerName, model: profile.judgeProviderName ? profile.judgeModel : preset.model }
}

/** What the judge reads of a message: the user's own words, or the reply as the model wrote it. */
export function originalTextOf(message: Pick<CodexChatMessageRecord, 'role' | 'content' | 'display_content'>) {
  return message.role === 'user' ? (message.display_content ?? message.content) : message.content
}

function cut(text: string) {
  const trimmed = text.trim()
  return trimmed.length > MESSAGE_CHARS ? `${trimmed.slice(0, MESSAGE_CHARS)}…` : trimmed
}

/**
 * The state the judge reads: who is talking and the last `window` messages up to the end of `messages`, each with
 * who sent it. In a group room a reply names the member who wrote it.
 */
export function judgeStateOf(profile: Pick<ChatProfile, 'name'>, thread: Pick<CodexChatThreadRecord, 'account_id' | 'user_profile_id'> | null | undefined, messages: CodexChatMessageRecord[], window: number) {
  const user = userPersonaForThread(thread).name
  const names = new Map<number, string>()
  const speaker = (id: number | null) => {
    if (id === null) return profile.name
    if (!names.has(id)) names.set(id, ChatProfileStore.find(id)?.name ?? profile.name)
    return names.get(id) as string
  }
  const conversation = messages
    .filter((message) => originalTextOf(message).trim())
    .slice(-window)
    .map((message) => (message.role === 'user' ? { from: 'user', name: user, text: cut(originalTextOf(message)) } : { from: 'character', name: speaker(message.speaker_profile_id), text: cut(originalTextOf(message)) }))
  return { character: profile.name, user, conversation }
}

function verdictOf(item: ChatJudgeItem, probability: number): ChatJudgeVerdict {
  if (probability >= item.yesThreshold) return 'yes'
  if (probability <= item.noThreshold) return 'no'
  return 'uncertain'
}

function actionOf(item: ChatJudgeItem, verdict: ChatJudgeVerdict): ChatJudgeItemResult['action'] {
  if (item.stage === 'after') return verdict === 'yes' ? 'follow-up' : 'none'
  if (verdict === 'yes' && (item.tools.length > 0 || item.directive)) return 'offered'
  if (verdict === 'no' && item.tools.length > 0) return 'withheld'
  return 'none'
}

/** The LLM asked again for uncertain items set to `llm`: the preset's escalation connection, else the chat's own. */
function escalationConnectionOf(preset: ChatJudgePreset, profile: ChatProfile): JudgeConnection | null {
  try {
    if (preset.escalationProviderName) return resolveJudgeConnection(preset.escalationProviderName, preset.escalationModel)
    const chat = resolveProfileModel(profile, 'chat')
    if (!chat) return null
    const connection = resolveJudgeConnection(chat.providerName, chat.model)
    return connection.engine === 'llm' ? connection : null
  } catch {
    return null
  }
}

type ItemRun = ChatJudgeItemResult & { tools: string[] }

export type JudgeRun = {
  connection: JudgeConnection | null
  results: ItemRun[]
  request: unknown
  latencyMs: number
  error: string | null
}

/**
 * Asks the judge every item (one call per distinct window), then settles the uncertain ones by their setting. A
 * failed call leaves its items `fallback` (the turn behaves as without them) and its message in `error`.
 */
export async function runJudgeItems(setup: JudgeSetup, profile: ChatProfile, items: ChatJudgeItem[], stateFor: (window: number) => unknown, signal?: AbortSignal): Promise<JudgeRun> {
  const started = Date.now()
  const answers = new Map<string, JudgeAnswer>()
  const requests: unknown[] = []
  const errors: string[] = []
  let connection: JudgeConnection | null = null
  try {
    connection = resolveJudgeConnection(setup.providerName, setup.model)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  if (connection) {
    const windows = [...new Set(items.map((item) => item.window))]
    await Promise.all(windows.map(async (window) => {
      const group = items.filter((item) => item.window === window)
      const state = stateFor(window)
      try {
        const result = await askJudge(connection as JudgeConnection, state, group, signal)
        requests.push(result.request)
        for (const [id, answer] of result.answers) answers.set(id, answer)
        if (result.answers.size < group.length) errors.push('판단 모델이 일부 질문에 답하지 않았어.')
      } catch (error) {
        signal?.throwIfAborted()
        requests.push({ state, items: group.map((item) => item.id) })
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }))
  }

  const results: ItemRun[] = items.map((item) => {
    const answer = answers.get(item.id)
    const base = { itemId: item.id, name: item.name, stage: item.stage, tools: item.tools }
    if (!answer) return { ...base, probability: null, confidence: null, choice: null, verdict: 'uncertain', decidedBy: 'fallback', action: 'none' }
    let verdict = verdictOf(item, answer.probability)
    let decidedBy: ChatJudgeItemResult['decidedBy'] = 'judge'
    if (verdict === 'uncertain' && (item.uncertain === 'yes' || item.uncertain === 'no')) {
      verdict = item.uncertain
      decidedBy = 'setting'
    }
    return { ...base, probability: answer.probability, confidence: answer.confidence, choice: answer.choice, verdict, decidedBy, action: 'none' }
  })

  // Uncertain items set to ask an LLM: one more call with the same state, read at 0.5.
  const escalate = items.filter((item) => item.uncertain === 'llm' && results.find((result) => result.itemId === item.id)?.decidedBy === 'judge' && results.find((result) => result.itemId === item.id)?.verdict === 'uncertain')
  if (escalate.length > 0) {
    const llm = escalationConnectionOf(setup.preset, profile)
    if (llm) {
      await Promise.all([...new Set(escalate.map((item) => item.window))].map(async (window) => {
        const group = escalate.filter((item) => item.window === window)
        try {
          const result = await askJudge(llm, stateFor(window), group, signal)
          requests.push({ escalation: true, ...(result.request as object) })
          for (const item of group) {
            const answer = result.answers.get(item.id)
            const entry = results.find((candidate) => candidate.itemId === item.id)
            if (!answer || !entry) continue
            entry.verdict = answer.probability >= 0.5 ? 'yes' : 'no'
            entry.decidedBy = 'llm'
          }
        } catch (error) {
          signal?.throwIfAborted()
          errors.push(`LLM 재판단 실패: ${error instanceof Error ? error.message : String(error)}`)
        }
      }))
    }
  }

  for (const entry of results) {
    const item = items.find((candidate) => candidate.id === entry.itemId) as ChatJudgeItem
    entry.action = entry.decidedBy === 'fallback' ? 'none' : actionOf(item, entry.verdict)
  }
  return { connection, results, request: requests.length === 1 ? requests[0] : requests, latencyMs: Date.now() - started, error: errors.length ? [...new Set(errors)].join(' / ') : null }
}

function logRun(setup: JudgeSetup, profile: ChatProfile, threadId: number, stage: ChatJudgeStage, messageId: number | null, replyId: string | null, run: JudgeRun) {
  try {
    return ChatJudgeLogStore.add({
      threadId, profileId: profile.id, presetId: setup.preset.id, stage, messageId, replyId,
      engine: run.connection?.engine ?? 'typesafe', providerName: setup.providerName, model: run.connection?.model ?? setup.model,
      latencyMs: run.latencyMs, error: run.error, request: run.request, items: run.results,
    })
  } catch (error) {
    console.warn('[chat-judge] log failed:', error instanceof Error ? error.message : error)
    return 0
  }
}

function diagnosticsOf(setup: JudgeSetup, runId: number, run: JudgeRun): ChatJudgeDiagnostics {
  return {
    runId,
    presetId: setup.preset.id,
    engine: run.connection?.engine ?? 'typesafe',
    latencyMs: run.latencyMs,
    error: run.error,
    items: run.results.map(({ tools: _tools, ...result }) => result),
  }
}

// ---- Before the reply ------------------------------------------------------------------------------------------

/** Replies a judge's yes on a save_lore item lets propose lore inside the usual spacing (see loreProposedRecently). */
const loreGrants = new Set<string>()

export function judgeGrantsLore(replyId: string | null | undefined) {
  return Boolean(replyId && loreGrants.has(replyId))
}

export type JudgedTurn = {
  runId: number
  replyId: string | null
  /** The offered tools minus those a no withheld (a tool another item said yes to stays). */
  filterTools: (tools: ChatCompletionTool[]) => ChatCompletionTool[]
  /** Added after the user's message; empty for none. */
  directive: string
  diagnostics: ChatJudgeDiagnostics
}

/**
 * Judges the conversation up to its latest message (without `excludeMessageId`, a reply being regenerated) for the
 * preset's before-reply items. Null when the profile has no judge or nothing to ask; the turn then goes on as usual.
 */
export async function judgeBeforeReply(params: { profile: ChatProfile; threadId: number; replyId: string | null; excludeMessageId?: number; signal?: AbortSignal }): Promise<JudgedTurn | null> {
  const setup = judgeSetupOf(params.profile)
  if (!setup) return null
  const items = askableJudgeItems(setup.preset.items).filter((item) => item.stage === 'before')
  if (items.length === 0) return null
  const thread = CodexChatStore.findThreadById(params.threadId)
  const messages = CodexChatStore.listMessages(params.threadId).filter((message) => message.id !== params.excludeMessageId)
  const run = await runJudgeItems(setup, params.profile, items, (window) => judgeStateOf(params.profile, thread, messages, window), params.signal)
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  const runId = logRun(setup, params.profile, params.threadId, 'before', latestUser?.id ?? null, params.replyId, run)

  const kept = run.results.filter((result) => result.action === 'offered').flatMap((result) => result.tools)
  const withheld = run.results.filter((result) => result.action === 'withheld').flatMap((result) => result.tools)
  const directive = run.results.filter((result) => result.action === 'offered')
    .map((result) => items.find((item) => item.id === result.itemId)?.directive ?? '').filter(Boolean).join('\n')
  if (params.replyId && kept.some((pattern) => judgeToolMatches(pattern, 'save_lore'))) loreGrants.add(params.replyId)
  return {
    runId,
    replyId: params.replyId,
    filterTools: (tools) => tools.filter((tool) => {
      const name = tool.function.name
      return !withheld.some((pattern) => judgeToolMatches(pattern, name)) || kept.some((pattern) => judgeToolMatches(pattern, name))
    }),
    directive,
    diagnostics: diagnosticsOf(setup, runId, run),
  }
}

/** The steered reply ended: what it called goes in the log, and its lore grant ends. */
export function endJudgedTurn(judged: JudgedTurn | null | undefined, toolsCalled: string[]) {
  if (!judged) return
  if (judged.replyId) loreGrants.delete(judged.replyId)
  if (judged.runId) {
    try { ChatJudgeLogStore.setToolsCalled(judged.runId, toolsCalled) } catch { /* The log is best effort. */ }
  }
}

// ---- After the reply: follow-up messages -------------------------------------------------------------------------

const pendingFollowUps = new Map<number, { controller: AbortController; timer: NodeJS.Timeout | null }>()

/** A user message (or anything that changes the end of the chat) drops a follow-up that is being judged or waits. */
export function cancelJudgeFollowUp(threadId: number) {
  const pending = pendingFollowUps.get(threadId)
  if (!pending) return
  pendingFollowUps.delete(threadId)
  pending.controller.abort()
  if (pending.timer) clearTimeout(pending.timer)
}

/** Replies at the end of the chat since the user's last message. */
function trailingReplies(messages: CodexChatMessageRecord[]) {
  let count = 0
  for (let index = messages.length - 1; index >= 0 && messages[index].role === 'assistant'; index -= 1) count += 1
  return count
}

/**
 * After a direct chat's completed reply: asks the preset's after-reply items and, on a yes, writes one follow-up
 * message after the preset's delay via `write` (a headless reply the user's next message interrupts). Follow-ups in a
 * row stop at the preset's limit. Runs in the background; nothing here throws.
 */
export function judgeAfterReply(params: { profile: ChatProfile; threadId: number; message: CodexChatMessageRecord; write: (directive: string, signal: AbortSignal) => Promise<CodexChatMessageRecord | null> }) {
  const setup = judgeSetupOf(params.profile)
  if (!setup || setup.preset.followUp.maxConsecutive <= 0) return
  const items = askableJudgeItems(setup.preset.items).filter((item) => item.stage === 'after')
  if (items.length === 0 || params.message.role !== 'assistant' || params.message.status !== 'completed' || !params.message.content.trim()) return
  const thread = CodexChatStore.findThreadById(params.threadId)
  if (!thread || thread.kind === 'group') return
  const messages = CodexChatStore.listMessages(params.threadId)
  if (messages[messages.length - 1]?.id !== params.message.id) return
  // The reply itself counts once; each follow-up after it once more.
  if (trailingReplies(messages) > setup.preset.followUp.maxConsecutive) return

  cancelJudgeFollowUp(params.threadId)
  const pending = { controller: new AbortController(), timer: null as NodeJS.Timeout | null }
  pendingFollowUps.set(params.threadId, pending)
  const stillLatest = () => pendingFollowUps.get(params.threadId) === pending && !pending.controller.signal.aborted
    && CodexChatStore.listMessages(params.threadId).at(-1)?.id === params.message.id

  void (async () => {
    const run = await runJudgeItems(setup, params.profile, items, (window) => judgeStateOf(params.profile, thread, messages, window), pending.controller.signal)
    if (pending.controller.signal.aborted) return
    const runId = logRun(setup, params.profile, params.threadId, 'after', params.message.id, params.message.routing?.replyId ?? null, run)
    if (!run.results.some((result) => result.action === 'follow-up') || !stillLatest()) {
      if (pendingFollowUps.get(params.threadId) === pending) pendingFollowUps.delete(params.threadId)
      return
    }
    pending.timer = setTimeout(() => {
      pending.timer = null
      if (!stillLatest()) return
      pendingFollowUps.delete(params.threadId)
      const directive = setup.preset.followUp.directive || DEFAULT_FOLLOW_UP_DIRECTIVE
      params.write(directive, pending.controller.signal).then((message) => {
        if (message && runId) ChatJudgeLogStore.setFollowUpMessage(runId, message.id)
      }, (error: unknown) => {
        console.warn('[chat-judge] follow-up failed:', error instanceof Error ? error.message : error)
      })
    }, setup.preset.followUp.delaySeconds * 1000)
  })().catch((error: unknown) => {
    if (pendingFollowUps.get(params.threadId) === pending) pendingFollowUps.delete(params.threadId)
    if (!pending.controller.signal.aborted) console.warn('[chat-judge] after-reply judge failed:', error instanceof Error ? error.message : error)
  })
}

// ---- Testing a preset on a chat ----------------------------------------------------------------------------------

/**
 * A preset (saved or a draft) run over a chat's last `turns` messages as if each had just arrived: user messages with
 * the before-reply items, replies with the after-reply ones. Nothing is logged and nothing in the chat changes.
 */
export async function testJudgePreset(params: { preset: ChatJudgePreset; providerName: string; model: string; profile: ChatProfile; thread: CodexChatThreadRecord; turns: number; signal?: AbortSignal }): Promise<ChatJudgeTestTurn[]> {
  const setup: JudgeSetup = { preset: params.preset, providerName: params.providerName, model: params.model }
  const items = askableJudgeItems(params.preset.items)
  if (items.length === 0) throw new JudgeError('물어볼 판단 항목이 없어.')
  const messages = CodexChatStore.listMessages(params.thread.id)
  const targets = messages.filter((message) => originalTextOf(message).trim()).slice(-params.turns)
  const results: ChatJudgeTestTurn[] = []
  for (const target of targets) {
    params.signal?.throwIfAborted()
    const stage: ChatJudgeStage = target.role === 'user' ? 'before' : 'after'
    const stageItems = items.filter((item) => item.stage === stage)
    const excerpt = cut(originalTextOf(target)).slice(0, 160)
    if (stageItems.length === 0) {
      results.push({ messageId: target.id, role: target.role, excerpt, error: null, items: [] })
      continue
    }
    const upTo = messages.slice(0, messages.findIndex((message) => message.id === target.id) + 1)
    const run = await runJudgeItems(setup, params.profile, stageItems, (window) => judgeStateOf(params.profile, params.thread, upTo, window), params.signal)
    results.push({ messageId: target.id, role: target.role, excerpt, error: run.error, items: run.results.map(({ tools: _tools, ...result }) => result) })
  }
  return results
}
