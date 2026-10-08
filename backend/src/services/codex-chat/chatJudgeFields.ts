import type { ChatJudgeItemResult } from '@conai/shared'
import { choiceQuestion, type JudgeQuestion } from '../judge/judgeEngine'
import { extractBlockPatches, foldBlockState, parseBlockEdits, usableBlocks, type BlockData } from './chatBlockState'
import { askBuiltQuestions, judgeSetupOf, judgeStateOf, logJudgeRun } from './chatJudge'
import type { JudgeLogItem } from './chatJudgeLogs'
import type { ChatProfile } from './chatProfiles'
import type { ChatBlockField, ChatDisplayBlock } from './chatStyle'
import { CodexChatStore } from './codexChatStore'

/**
 * Status fields settled by the judge: after a completed reply, every status block field with a fixed list of values
 * (an emotion, a place, a time of day) that the reply did not write is asked about, and a value the judge picks with
 * enough probability that differs from the current one is written as if the model had written it — a ```key fence
 * added to the end of the stored reply. The chat folds it like any other fence (field rules, regenerating, switching
 * an alternative), shows it as the reply's change chips, and the status panel and sprite follow.
 *
 * Any engine, direct chats and group rooms (each member's own blocks). Runs in the background; nothing here throws.
 */

/** Fields asked about in one reply, at most. */
const FIELDS_MAX = 8

const running = new Set<number>()

type Candidate = { block: ChatDisplayBlock; field: ChatBlockField; current: string | null }

function fieldsToAsk(blocks: ChatDisplayBlock[], state: Record<string, BlockData>, written: Set<string>) {
  const result: Candidate[] = []
  for (const block of blocks) {
    for (const field of block.fields) {
      if (!field.name || field.readonly || field.values.length < 2 || written.has(`${block.key}.${field.name}`)) continue
      const value = state[block.key]?.[field.name]
      result.push({ block, field, current: value === undefined || value === null ? null : String(value) })
    }
  }
  return result.slice(0, FIELDS_MAX)
}

function questionOf(candidate: Candidate, index: number, character: string): JudgeQuestion {
  const { block, field, current } = candidate
  // Each value as an option; one that differs from the current value counts as a change (yes).
  return choiceQuestion(`field-${index}`, `Right after the latest message, which value of "${field.name}" (in ${character}'s status "${block.key}") fits the scene now? Keep the current value${current === null ? '' : ` ("${current}")`} unless the conversation clearly moved on.`,
    field.values.map((value, option) => [`v${option + 1}`, value, value !== current]))
}

/**
 * Judges the status fields of the reply `messageId` (when it is a completed reply of `profile`, or of the member
 * `speakerId` in a group room) and writes the changes. Background; at most one run per reply at a time.
 */
export function judgeStatusFields(params: { profile: ChatProfile; threadId: number; messageId: number; speakerId?: number }) {
  const setup = judgeSetupOf(params.profile)
  if (!setup || !setup.preset.fields.enabled || running.has(params.messageId)) return
  const blocks = usableBlocks(params.profile.style.blocks)
  if (!blocks.some((block) => block.fields.some((field) => field.values.length >= 2 && !field.readonly))) return
  running.add(params.messageId)
  void settleFields(setup, params).catch((error: unknown) => {
    console.warn('[chat-judge] status fields failed:', error instanceof Error ? error.message : error)
  }).finally(() => running.delete(params.messageId))
}

async function settleFields(setup: NonNullable<ReturnType<typeof judgeSetupOf>>, params: { profile: ChatProfile; threadId: number; messageId: number; speakerId?: number }) {
  const thread = CodexChatStore.findThreadById(params.threadId)
  if (!thread) return
  const messages = CodexChatStore.listMessages(params.threadId)
  const index = messages.findIndex((message) => message.id === params.messageId)
  const message = messages[index]
  if (!message || message.role !== 'assistant' || message.status !== 'completed' || !message.content.trim()) return
  if (params.speakerId !== undefined && message.speaker_profile_id !== params.speakerId) return
  const upTo = messages.slice(0, index + 1)
  const folded = foldBlockState(params.profile, upTo, parseBlockEdits(thread.block_edits), params.speakerId)
  if (!folded) return
  const blocks = usableBlocks(params.profile.style.blocks)
  const keys = new Set(blocks.map((block) => block.key))
  const written = new Set(extractBlockPatches(message.content, keys).flatMap(({ key, data }) => Object.keys(data).map((field) => `${key}.${field}`)))
  const candidates = fieldsToAsk(blocks, folded.state, written)
  if (candidates.length === 0) return

  const questions = candidates.map((candidate, at) => questionOf(candidate, at, params.profile.name))
  const state = { ...judgeStateOf(params.profile, thread, upTo, setup.preset.fields.window), status: Object.fromEntries(blocks.map((block) => [block.key, folded.state[block.key] ?? {}])) }
  const asked = await askBuiltQuestions(setup, state, questions)

  const patches = new Map<string, BlockData>()
  const results: JudgeLogItem[] = candidates.map((candidate, at) => {
    const answer = asked.answers.get(`field-${at}`)
    const picked = answer?.choice ? candidate.field.values[Number(answer.choice.slice(1)) - 1] ?? null : null
    const pickedProbability = answer?.choice ? answer.distribution?.[answer.choice] ?? 0 : 0
    const change = picked !== null && picked !== candidate.current && pickedProbability >= setup.preset.fields.threshold
    if (change) patches.set(candidate.block.key, { ...(patches.get(candidate.block.key) ?? {}), [candidate.field.name]: picked })
    const verdict: ChatJudgeItemResult['verdict'] = !answer ? 'uncertain' : change ? 'yes' : 'no'
    return {
      itemId: `field:${candidate.block.key}.${candidate.field.name}`, name: `${candidate.block.key}.${candidate.field.name}`.slice(0, 40), stage: 'fields', tools: [],
      probability: answer?.probability ?? null, confidence: answer?.confidence ?? null, choice: picked,
      verdict, decidedBy: answer ? 'judge' : 'fallback', action: change ? 'set' : 'none',
    }
  })

  if (patches.size > 0) {
    const suffix = [...patches].map(([key, data]) => `\n\n\`\`\`${key}\n${JSON.stringify(data)}\n\`\`\``).join('')
    // Written only onto the reply the judge read; a reply changed meanwhile keeps what it has.
    if (!CodexChatStore.appendToReply(params.threadId, params.messageId, message.content, suffix)) {
      for (const result of results) if (result.action === 'set') result.action = 'none'
    }
  }
  logJudgeRun({ setup, threadId: params.threadId, profileId: params.profile.id, stage: 'fields', messageId: params.messageId, replyId: message.routing?.replyId ?? null,
    run: { connection: asked.connection, results, request: asked.request, latencyMs: asked.latencyMs, error: asked.error } })
}
