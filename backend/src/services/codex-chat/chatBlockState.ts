import { createHash } from 'node:crypto'
import type { ChatProfile } from './chatProfiles'
import { fieldRuleLines, type ChatBlockField, type ChatDisplayBlock } from './chatStyle'
import type { CodexChatMessageRecord } from './codexChatStore'
import { fillCharacterPlaceholders } from './chatPlaceholders'

/**
 * Display block state: each enabled block of a profile is a JSON object the chat keeps per thread. It starts from
 * the block's example values; every assistant reply may carry a ```key fence with the fields that changed, and the
 * user can set or reset a block by hand. The state is never stored as such — it is folded from the messages (and
 * the hand edits, kept on the thread) whenever it is needed, so regenerating, switching an alternative or deleting
 * messages cannot leave it stale.
 */

export type BlockData = Record<string, unknown>

/** One field that a reply (or an edit) changed; `from` / `to` are undefined when the field was added / removed. */
export type BlockChange = { field: string; from?: unknown; to?: unknown }

/**
 * A hand edit: the block's whole data (`null`: back to the example values), applied after `afterMessageId`.
 * `profileId`: group rooms, the member whose block it is.
 */
export type BlockEdit = { id: string; key: string; afterMessageId: number; data: BlockData | null; at: string; profileId?: number }

type FoldMessage = Pick<CodexChatMessageRecord, 'id' | 'role' | 'content'> & { speaker_profile_id?: number | null }

export type ChatBlocksState = {
  /** Current data by block key. */
  state: Record<string, BlockData>
  /** What each assistant message with a fence changed, by message id then block key (nothing: an empty object). */
  changes: Record<number, Record<string, BlockChange[]>>
  /** Changes of hand edits, by edit id. */
  edits: Record<string, Record<string, BlockChange[]>>
}

export const BLOCK_EDITS_MAX = 500
export const BLOCK_DATA_MAX_LENGTH = 8000

/** The blocks the model is told about and the panel shows (a block without a template shows as a plain field list). */
export function usableBlocks(blocks: ChatDisplayBlock[]) {
  return blocks.filter((block) => block.enabled && block.key)
}

/** Values the model wrote: JSON, or `field: value` lines when it slipped. Null when nothing usable was written. */
export function parseBlockValues(text: string): BlockData | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as BlockData
    return { value: parsed }
  } catch {
    const entries = trimmed.split('\n')
      .map((line) => /^\s*"?([\w.-]+)"?\s*[:=]\s*(.+?)\s*,?\s*$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
    return entries.length > 0 ? Object.fromEntries(entries.map(([, key, value]) => [key, value.replace(/^"(.*)"$/, '$1')])) : null
  }
}

/** A block's starting values: its example, with `{{char}}` filled. */
export function initialBlockData(block: ChatDisplayBlock, profile: ChatProfile): BlockData {
  return parseBlockValues(fillCharacterPlaceholders(block.example, profile)) ?? {}
}

const FENCE_PATTERN = /^[ \t]*```[ \t]*([a-z][a-z0-9_-]*)[^\n]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gm

/** The ```key fences of a reply whose name is a block key, in order (a fence that is not valid values is skipped). */
export function extractBlockPatches(content: string, keys: ReadonlySet<string>) {
  const patches: Array<{ key: string; data: BlockData }> = []
  if (!content.includes('```')) return patches
  for (const match of content.matchAll(FENCE_PATTERN)) {
    const key = match[1].toLowerCase()
    if (!keys.has(key)) continue
    const data = parseBlockValues(match[2])
    if (data) patches.push({ key, data })
  }
  return patches
}

/**
 * A reply without its block fences, for the history sent to the model: the current values go in once, with the
 * state, so old fences cannot contradict them (a small model otherwise trusts its own earlier numbers over a hand
 * edit). The stored message keeps them.
 */
export function stripBlockFences(content: string, keys: ReadonlySet<string>) {
  if (keys.size === 0 || !content.includes('```')) return content
  return content.replace(FENCE_PATTERN, (fence, key: string) => (keys.has(key.toLowerCase()) ? '' : fence)).replace(/\n{3,}/g, '\n\n').trim()
}

/** The keys of the blocks the model is told about. */
export function usableBlockKeys(blocks: ChatDisplayBlock[]) {
  return new Set(usableBlocks(blocks).map((block) => block.key))
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

/**
 * The model's patch held to the block's field rules: a read-only field is dropped, a value outside the allowed list
 * is dropped, a number is clamped to its range and to `step` away from the current value. Hand edits skip this.
 */
export function constrainPatch(fields: ChatBlockField[], before: BlockData, patch: BlockData): BlockData {
  if (fields.length === 0) return patch
  const rules = new Map(fields.filter((field) => field.name).map((field) => [field.name, field]))
  const result: BlockData = {}
  for (const [name, value] of Object.entries(patch)) {
    const rule = rules.get(name)
    if (!rule) {
      result[name] = value
      continue
    }
    if (rule.readonly) continue
    if (value === null) {
      result[name] = value
      continue
    }
    if (rule.values.length > 0 && !rule.values.includes(String(value))) continue
    const number = asNumber(value)
    if (number === null || (rule.min === null && rule.max === null && rule.step === null)) {
      result[name] = value
      continue
    }
    let next = number
    const current = asNumber(before[name])
    if (rule.step !== null && current !== null) next = Math.min(current + rule.step, Math.max(current - rule.step, next))
    if (rule.min !== null) next = Math.max(rule.min, next)
    if (rule.max !== null) next = Math.min(rule.max, next)
    result[name] = typeof value === 'string' ? String(next) : next
  }
  return result
}

/** Top-level merge: a field set to null is removed, everything else (lists included) is replaced whole. */
export function mergeBlockData(base: BlockData, patch: BlockData): BlockData {
  const result: BlockData = { ...base }
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) delete result[field]
    else result[field] = value
  }
  return result
}

export function diffBlockData(before: BlockData, after: BlockData): BlockChange[] {
  const changes: BlockChange[] = []
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = before[field]
    const to = after[field]
    if (JSON.stringify(from) === JSON.stringify(to)) continue
    const change: BlockChange = { field }
    if (from !== undefined) change.from = from
    if (to !== undefined) change.to = to
    changes.push(change)
  }
  return changes
}

export function parseBlockEdits(value: string | null | undefined): BlockEdit[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is BlockEdit => Boolean(entry) && typeof entry === 'object' && typeof entry.key === 'string' && Number.isFinite(entry.afterMessageId))
      : []
  } catch {
    return []
  }
}

/**
 * The state after `messages` (assistant replies in order) and the hand `edits`, each applied right after the message
 * it was made after. Null when the profile has no usable block. `speakerId`: group rooms, fold only this member's
 * replies and edits (its blocks are its own).
 */
export function foldBlockState(profile: ChatProfile, messages: ReadonlyArray<FoldMessage>, edits: BlockEdit[], speakerId?: number): ChatBlocksState | null {
  const blocks = usableBlocks(profile.style.blocks)
  if (blocks.length === 0) return null
  const byKey = new Map(blocks.map((block) => [block.key, block]))
  const keys = new Set(byKey.keys())
  const state: Record<string, BlockData> = Object.fromEntries(blocks.map((block) => [block.key, initialBlockData(block, profile)]))
  const result: ChatBlocksState = { state, changes: {}, edits: {} }
  const own = (edit: BlockEdit) => (speakerId === undefined ? edit.profileId === undefined : edit.profileId === speakerId)
  const pending = edits.filter((edit) => keys.has(edit.key) && own(edit)).sort((a, b) => a.afterMessageId - b.afterMessageId)
  let next = 0
  const applyEditsBefore = (messageId: number) => {
    while (next < pending.length && pending[next].afterMessageId < messageId) {
      const edit = pending[next]
      next += 1
      const block = byKey.get(edit.key) as ChatDisplayBlock
      const after = edit.data === null ? initialBlockData(block, profile) : edit.data
      const changes = diffBlockData(state[edit.key], after)
      if (changes.length > 0) result.edits[edit.id] = { ...(result.edits[edit.id] ?? {}), [edit.key]: changes }
      state[edit.key] = after
    }
  }
  for (const message of messages) {
    applyEditsBefore(message.id)
    if (message.role !== 'assistant' || (speakerId !== undefined && message.speaker_profile_id !== speakerId)) continue
    const patches = extractBlockPatches(message.content, keys)
    // A message with a fence is listed even when it changed nothing, so its chips know there is nothing to show.
    if (patches.length > 0) result.changes[message.id] ??= {}
    // Every fence in this reply shares the same starting point for per-turn limits.
    const beforeReply = { ...state }
    for (const { key, data } of patches) {
      const after = mergeBlockData(state[key], constrainPatch((byKey.get(key) as ChatDisplayBlock).fields, beforeReply[key], data))
      const changes = diffBlockData(state[key], after)
      if (changes.length > 0) result.changes[message.id] = { ...(result.changes[message.id] ?? {}), [key]: [...(result.changes[message.id]?.[key] ?? []), ...changes] }
      state[key] = after
    }
  }
  applyEditsBefore(Number.MAX_SAFE_INTEGER)
  return result
}

/** A room's state: each member with usable blocks, by profile id. Null when no member has any. */
export function foldGroupBlockState(members: ChatProfile[], messages: ReadonlyArray<FoldMessage>, edits: BlockEdit[]): Record<number, ChatBlocksState> | null {
  const result: Record<number, ChatBlocksState> = {}
  for (const member of members) {
    const folded = foldBlockState(member, messages, edits, member.id)
    if (folded) result[member.id] = folded
  }
  return Object.keys(result).length > 0 ? result : null
}

/**
 * The state as the model reads it each request (inside `[참고 설정]`, beside the author's note): current values per
 * block and the block's update rules.
 */
export function blockStateText(blocks: ChatDisplayBlock[], state: Record<string, BlockData>) {
  const content = blockStateContentText(blocks, state)
  return content ? ['## 현재 상태', '아래 값이 지금 장면의 사실이야(이전 답변에 쓴 값보다 우선). 여기에 맞춰 행동하고, 바뀐 값만 같은 이름의 코드 블록에 써.', content].join('\n') : ''
}

/** Public state values and rules, without the model's fixed instructions. */
export function blockStateContentText(blocks: ChatDisplayBlock[], state: Record<string, BlockData>) {
  const parts = usableBlocks(blocks).map((block) => [
    `### ${block.key}`,
    JSON.stringify(state[block.key] ?? {}),
    block.rules ? `규칙: ${block.rules}` : '',
    ...fieldRuleLines(block).map((line) => `필드 규칙: ${line}`),
  ].filter(Boolean).join('\n'))
  return parts.join('\n')
}

export function blockStateHash(text: string) {
  return createHash('sha1').update(text).digest('hex').slice(0, 10)
}

/** Validates a hand edit's data: a JSON object, small enough to keep. Returns the reason when it is not. */
export function validateBlockData(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '값은 JSON 객체여야 해.'
  if (JSON.stringify(value).length > BLOCK_DATA_MAX_LENGTH) return `값이 너무 커. ${BLOCK_DATA_MAX_LENGTH}자 안으로 줄여줘.`
  return null
}
