import crypto from 'crypto'
import { z } from 'zod'
import type { ChatAssetBatch, ChatAssetBatchInput, ChatAssetApplyInput, ChatAssetApplyResult, ChatAssetKind, ChatAssetAttempt, ChatAssetCandidate } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { McpRequester } from '../../mcp/context'
import { enqueueProfileAssetGenerationJob } from '../../mcp/tools/generationJobTools'
import { parseMcpMarkedFields } from '../../mcp/tools/mcpComfyWorkflowService'
import { PromptPresetModel } from '../../models/PromptPreset'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { GenerationQueueService } from '../generationQueueService'
import { GroupPathService } from '../groupPathService'
import { attachMainImagesDatabase } from '../../database/userSettingsBootstrap'
import { EmoticonService, normalizeKeyword } from '../emoticonService'
import { ChatProfileStore, type ChatProfileInput } from './chatProfiles'
import { ChatGenerationPresetStore, resolvePresetWorkflow, type ChatGenerationPreset } from './chatGenerationPresets'
import { buildChatGenerationPresetJob, CHAT_NAI_PAYLOAD_MAX_BYTES } from './chatGenerationPayload'
import { chatCharacterGroupPath, normalizeAvatarCrop, normalizeProfileAssetHash, isProfileAssetHidden } from './chatProfileAssets'
import { activeMediaFile } from './chatCardAssets'
import { ChatAssetError, requireChatAssetAdmin, requireChatAssetGeneration } from './chatAssetAccess'
import { assetTaggerEnabled, tagAsset, reviewAsset, type AssetTagCache } from './chatAssetReview'
import { assetJudgeSetup, judgeExpression, type ExpressionJudgement } from './chatJudgeAssets'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import { normalizeChatStyle } from './chatStyle'

const positiveId = z.number().int().positive().safe()
const promptText = z.string().trim().min(1).max(8000)
export const chatAssetBatchInputSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(120), presetId: positiveId,
  expressionPresetId: positiveId.optional(), expressions: z.array(z.string().trim().min(1).max(40)).max(32).optional(),
  slots: z.array(z.object({ slotKey: z.string().trim().min(1).max(40), kind: z.enum(['background', 'full', 'avatar', 'reference']), prompt: promptText, size: z.string().max(40).optional(), inputs: z.record(z.string(), z.unknown()).optional() }).strict()).max(32).optional(),
  promptField: z.string().trim().min(1).max(200).optional(),
}).strict()

type SlotRecipe = { slotKey: string; kind: ChatAssetKind; prompt: string; size?: string; inputs?: Record<string, unknown> }
type Snapshot = { requestKey: string; request: string; preset: ChatGenerationPreset; appearance: string; referenceHash: string | null; slots: SlotRecipe[]; promptField?: string; groupPath: string }
type BatchRow = { id: number; account_id: number | null; profile_id: number; preset_id: number; snapshot: string; created_at: string }
type StoredAttempt = { jobId: number; createdAt: string; useCurrentPreset: boolean; referenceHash: string | null; tags?: Record<string, AssetTagCache>; tagCheckedAt?: Record<string, number>; judged?: Record<string, ExpressionJudgement> }
type SlotRow = { batch_id: number; slot_key: string; kind: ChatAssetKind; prompt: string; attempts: string; chosen_hash: string | null }

function parseInput(value: unknown): ChatAssetBatchInput {
  const result = chatAssetBatchInputSchema.safeParse(value)
  if (!result.success) throw new ChatAssetError('자산 묶음 입력을 확인해줘.', 400, { issues: result.error.issues })
  return result.data
}
function batchRow(id: number) {
  const row = getUserSettingsDb().prepare('SELECT * FROM chat_asset_batches WHERE id = ?').get(id) as BatchRow | undefined
  if (!row) throw new ChatAssetError('자산 묶음을 찾을 수 없어.', 404)
  return row
}
function slotRows(id: number) { return getUserSettingsDb().prepare('SELECT * FROM chat_asset_slots WHERE batch_id = ? ORDER BY rowid').all(id) as SlotRow[] }
function slotRow(id: number, key: string) {
  const slot = slotRows(id).find((row) => row.slot_key === key)
  if (!slot) throw new ChatAssetError('슬롯을 찾을 수 없어.', 404)
  return slot
}
function attemptsOf(slot: SlotRow): StoredAttempt[] { return JSON.parse(slot.attempts) as StoredAttempt[] }
function snapshotOf(row: BatchRow): Snapshot { return JSON.parse(row.snapshot) as Snapshot }
function authorize(requester: McpRequester, id: number, profileId?: number) {
  requireChatAssetAdmin(requester)
  const row = batchRow(id)
  if (profileId !== undefined && row.profile_id !== profileId) throw new ChatAssetError('자산 묶음을 찾을 수 없어.', 404)
  if (!ChatProfileStore.find(row.profile_id)) throw new ChatAssetError('프로필을 찾을 수 없어.', 404)
  return row
}

/** Same-process serialization is an optimization; queue+attempt writes below share a durable transaction. */
export const assertChatAssetBatchProfile = authorize

const operations = new Map<number, Promise<unknown>>()
async function serialized<T>(batchId: number, run: () => Promise<T>): Promise<T> {
  const previous = operations.get(batchId) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(run)
  operations.set(batchId, current)
  try { return await current } finally { if (operations.get(batchId) === current) operations.delete(batchId) }
}

function recipes(input: ChatAssetBatchInput): SlotRecipe[] {
  const result: SlotRecipe[] = []
  if (input.expressionPresetId) {
    const preset = PromptPresetModel.findByIdWithItems(input.expressionPresetId)
    if (!preset) throw new ChatAssetError('표정 프롬프트 프리셋을 찾을 수 없어.')
    const selected = input.expressions ? new Set(input.expressions) : null
    for (const item of preset.items) {
      if (selected && !selected.has(item.description)) continue
      const name = normalizeKeyword(item.description)
      if (!name || name !== item.description.trim() || !item.value.trim() || item.value.length > 8000) throw new ChatAssetError('표정 항목의 감정 이름과 프롬프트를 확인해줘.')
      result.push({ slotKey: name, kind: 'expression', prompt: item.value.trim() })
    }
    if (selected && [...selected].some((name) => !result.some((slot) => slot.slotKey === name))) throw new ChatAssetError('표정 프리셋에 없는 감정 이름이야.')
  } else if (input.expressions) throw new ChatAssetError('표정 프롬프트 프리셋을 골라줘.')
  result.push(...(input.slots ?? []))
  if (!result.length || result.length > 32) throw new ChatAssetError('자산 슬롯은 1~32개 골라줘.')
  const seen = new Set<string>()
  const kinds = new Set<string>()
  for (const slot of result) {
    if (/[\/\\\u0000-\u001f]/.test(slot.slotKey) || seen.has(slot.slotKey.toLowerCase())) throw new ChatAssetError('슬롯 이름이 겹치거나 올바르지 않아.')
    if (slot.kind !== 'expression' && kinds.has(slot.kind)) throw new ChatAssetError('같은 종류의 자산 슬롯은 하나만 골라줘.')
    seen.add(slot.slotKey.toLowerCase()); kinds.add(slot.kind)
  }
  return result
}

function requireComfyFields(preset: ChatGenerationPreset, promptField?: string, needsReference = true) {
  if (preset.kind !== 'comfyui') return
  if (!preset.comfyui) throw new ChatAssetError('ComfyUI 프리셋 설정을 찾을 수 없어.')
  const { workflow, problem } = resolvePresetWorkflow(preset.comfyui)
  if (!workflow) throw new ChatAssetError(problem ?? '워크플로를 찾을 수 없어.')
  const fields = parseMcpMarkedFields(workflow)
  const field = fields.find((entry) => entry.id === promptField)
  if (!field || !['text', 'textarea'].includes(field.type) || !preset.comfyui.exposedFieldIds.includes(field.id)) throw new ChatAssetError('슬롯 프롬프트를 넣을 노출 텍스트 필드(promptField)를 골라줘.')
  if (needsReference && !preset.comfyui.referenceField) throw new ChatAssetError('자산 생성에는 ComfyUI 기준 이미지 필드를 지정해줘.')
  if (!fields.some((entry) => entry.type === 'number' && /(?:^|[._])(?:noise_seed|seed)$/.test(entry.jsonPath))) throw new ChatAssetError('자산 생성에는 워크플로의 시드 입력을 숫자 필드로 표시해줘.')
}

/** Validate a creation proposal without writing a batch or job. */
export function validateChatAssetBatchProposal(requester: McpRequester, profileId: number, value: unknown) {
  requireChatAssetAdmin(requester)
  const input = parseInput(value)
  const preset = ChatGenerationPresetStore.find(input.presetId)
  if (!preset) throw new ChatAssetError('생성 프리셋을 찾을 수 없어.')
  const profile = requireChatAssetGeneration(requester, profileId, preset.kind === 'nai' ? 'novelai' : 'comfyui')
  const slots = recipes(input)
  if (!profile.referenceHash && !slots.some((slot) => slot.kind === 'reference')) throw new ChatAssetError('기준 이미지를 고르거나 기준 이미지 슬롯을 먼저 만들어줘.')
  requireComfyFields(preset, input.promptField, slots.some((slot) => slot.kind !== 'reference') || Boolean(profile.referenceHash))
  return input
}

export async function createChatAssetBatch(requester: McpRequester, profileId: number, value: unknown): Promise<ChatAssetBatch> {
  requireChatAssetAdmin(requester)
  const input = parseInput(value)
  const request = JSON.stringify(input)
  const db = getUserSettingsDb()
  const id = db.transaction(() => {
    const existing = db.prepare("SELECT * FROM chat_asset_batches WHERE account_id IS ? AND profile_id = ? AND json_extract(snapshot, '$.requestKey') = ?").get(requester.accountId, profileId, input.idempotencyKey) as BatchRow | undefined
    if (existing) {
      if (snapshotOf(existing).request !== request) throw new ChatAssetError('같은 멱등 키로 다른 묶음을 만들 수 없어.', 409)
      return existing.id
    }
    const preset = ChatGenerationPresetStore.find(input.presetId)
    if (!preset) throw new ChatAssetError('생성 프리셋을 찾을 수 없어.')
    const profile = requireChatAssetGeneration(requester, profileId, preset.kind === 'nai' ? 'novelai' : 'comfyui')
    const slots = recipes(input)
    if (!profile.referenceHash && !slots.some((slot) => slot.kind === 'reference')) throw new ChatAssetError('기준 이미지를 고르거나 기준 이미지 슬롯을 먼저 만들어줘.')
    requireComfyFields(preset, input.promptField, slots.some((slot) => slot.kind !== 'reference') || Boolean(profile.referenceHash))
    const snapshot: Snapshot = { requestKey: input.idempotencyKey, request, preset, appearance: profile.appearance, referenceHash: profile.referenceHash, slots, promptField: input.promptField, groupPath: `${chatCharacterGroupPath(profile.name)}/후보` }
    const batchId = Number(db.prepare('INSERT INTO chat_asset_batches(account_id, profile_id, preset_id, snapshot) VALUES (?, ?, ?, ?)').run(requester.accountId, profileId, preset.id, JSON.stringify(snapshot)).lastInsertRowid)
    const insert = db.prepare('INSERT INTO chat_asset_slots(batch_id, slot_key, kind, prompt) VALUES (?, ?, ?, ?)')
    slots.forEach((slot) => insert.run(batchId, slot.slotKey, slot.kind, slot.prompt))
    return batchId
  }).immediate()
  return serialized(id, async () => {
    await submitInitialSlots(requester, id)
    return getChatAssetBatch(requester, id, profileId)
  })
}

function effectiveReference(row: BatchRow, slot: SlotRow) {
  const reference = slotRows(row.id).find((entry) => entry.kind === 'reference')
  if (slot.kind !== 'reference' && reference && !reference.chosen_hash) throw new ChatAssetError('기준 이미지가 성공한 뒤 먼저 골라줘.', 409)
  return slot.kind !== 'reference' && reference ? reference.chosen_hash : snapshotOf(row).referenceHash
}

async function submitSlot(requester: McpRequester, row: BatchRow, slot: SlotRow, attempt: number, useCurrentPreset: boolean) {
  const existing = attemptsOf(slot)
  if (attempt <= existing.length) {
    if (existing[attempt - 1].useCurrentPreset !== useCurrentPreset) throw new ChatAssetError('같은 시도 번호의 프리셋 옵션을 바꿀 수 없어.', 409)
    return
  }
  if (attempt !== existing.length + 1) throw new ChatAssetError('다음 시도 번호를 보내줘.', 409)
  const snapshot = snapshotOf(row)
  const preset = useCurrentPreset ? ChatGenerationPresetStore.find(row.preset_id) : snapshot.preset
  if (!preset) throw new ChatAssetError('현재 생성 프리셋을 찾을 수 없어.')
  const profile = requireChatAssetGeneration(requester, row.profile_id, preset.kind === 'nai' ? 'novelai' : 'comfyui')
  const referenceHash = effectiveReference(row, slot)
  const recipe = snapshot.slots.find((entry) => entry.slotKey === slot.slot_key)!
  requireComfyFields(preset, snapshot.promptField, Boolean(referenceHash) || slot.kind !== 'reference')
  const prompt = [snapshot.appearance, recipe.prompt].map((part) => part.trim()).filter(Boolean).join(', ')
  const args: Record<string, unknown> = { ...recipe.inputs, prompt, size: recipe.size }
  if (preset.comfyui && snapshot.promptField) {
    args[snapshot.promptField] = [String(preset.comfyui.fixedInputs[snapshot.promptField] ?? ''), prompt].filter(Boolean).join(', ')
  }
  const input = await buildChatGenerationPresetJob(preset, args, { ...profile, referenceHash }, { forceReference: true, omitReference: slot.kind === 'reference' && !referenceHash })
  // NAI already randomizes an omitted seed. Every exposed or fixed ComfyUI seed is replaced per attempt.
  if (preset.comfyui && 'inputs' in input && input.inputs) {
    const { workflow } = resolvePresetWorkflow(preset.comfyui)
    for (const field of parseMcpMarkedFields(workflow!)) {
      if (field.type === 'number' && /(?:^|[._])(?:noise_seed|seed)$/.test(field.jsonPath)) input.inputs[field.id] = crypto.randomInt(1, 4294967288)
    }
  }
  const next = { ...input, request_summary: `캐릭터 자산 · ${profile.name} · ${slot.slot_key}`, group_path: snapshot.groupPath, idempotency_key: `asset:${row.id}:${slot.slot_key}:${attempt}` }
  await enqueueProfileAssetGenerationJob(requester, row.profile_id, next, (jobId) => {
    authorize(requester, row.id)
    const live = slotRow(row.id, slot.slot_key)
    const liveAttempts = attemptsOf(live)
    if (JSON.stringify(liveAttempts.map((entry) => entry.jobId)) !== JSON.stringify(existing.map((entry) => entry.jobId)) || effectiveReference(row, live) !== referenceHash) throw new ChatAssetError('슬롯이 다른 요청에서 바뀌었어. 다시 읽고 시도해줘.', 409)
    const saved: StoredAttempt = { jobId, createdAt: new Date().toISOString(), useCurrentPreset, referenceHash }
    getUserSettingsDb().prepare('UPDATE chat_asset_slots SET attempts = ? WHERE batch_id = ? AND slot_key = ?').run(JSON.stringify([...liveAttempts, saved]), row.id, slot.slot_key)
  }, preset.kind === 'nai' ? CHAT_NAI_PAYLOAD_MAX_BYTES : undefined)
}

async function submitInitialSlots(requester: McpRequester, id: number) {
  const row = authorize(requester, id)
  const slots = slotRows(id)
  const reference = slots.find((slot) => slot.kind === 'reference')
  const eligible = reference && !reference.chosen_hash ? [reference] : slots
  for (const slot of eligible) {
    if (attemptsOf(slot).length) continue
    try { await submitSlot(requester, row, slot, 1, false) }
    catch (error) {
      throw new ChatAssetError(error instanceof Error ? error.message : '작업을 제출하지 못했어.', error instanceof ChatAssetError ? error.status : 400, { batchId: id, submittedSlots: slotRows(id).filter((entry) => attemptsOf(entry).length).map((entry) => entry.slot_key) })
    }
  }
}

function candidatesOf(jobId: number): ChatAssetCandidate[] {
  const rows = getUserSettingsDb().prepare("SELECT h.id, h.composite_hash FROM api_generation_history h JOIN generation_queue_jobs j ON j.id = h.queue_job_id WHERE h.queue_job_id = ? AND j.status = 'completed' AND h.generation_status = 'completed' AND h.composite_hash IS NOT NULL ORDER BY h.id").all(jobId) as Array<{ id: number; composite_hash: string }>
  return rows.filter((entry) => !isProfileAssetHidden(entry.composite_hash) && activeMediaFile(entry.composite_hash)?.mimeType.startsWith('image/')).map((entry) => ({ historyId: entry.id, compositeHash: entry.composite_hash }))
}

/** Queue rows are the only progress authority; attempts retain job identities and tag caches only. */
export function getChatAssetBatch(requester: McpRequester, id: number, profileId?: number): ChatAssetBatch {
  const row = authorize(requester, id, profileId)
  const snapshot = snapshotOf(row)
  const rows = slotRows(id)
  const allCandidates = rows.flatMap((slot) => attemptsOf(slot).flatMap((attempt) => candidatesOf(attempt.jobId).map((candidate) => ({ slotKey: slot.slot_key, compositeHash: candidate.compositeHash }))))
  const tagCache = Object.assign({}, ...rows.flatMap((slot) => attemptsOf(slot).map((attempt) => attempt.tags ?? {}))) as Record<string, AssetTagCache>
  const enabled = assetTaggerEnabled()
  const slots = rows.map((slot) => {
    const attempts: ChatAssetAttempt[] = attemptsOf(slot).map((attempt) => {
      const job = getUserSettingsDb().prepare('SELECT status, failure_code, cancel_requested FROM generation_queue_jobs WHERE id = ?').get(attempt.jobId) as { status: string; failure_code: string | null; cancel_requested: number } | undefined
      const candidates = candidatesOf(attempt.jobId).map((candidate) => ({ ...candidate, ...(enabled && tagCache[candidate.compositeHash] ? { review: reviewAsset(slot.kind, slot.slot_key, candidate.compositeHash, tagCache[candidate.compositeHash], attempt.referenceHash ? tagCache[attempt.referenceHash] : undefined, allCandidates.filter((entry) => entry.slotKey !== slot.slot_key), attempt.judged?.[candidate.compositeHash]) } : {}) }))
      return { jobId: attempt.jobId, createdAt: attempt.createdAt, useCurrentPreset: attempt.useCurrentPreset, referenceHash: attempt.referenceHash, status: job?.status ?? 'failed', failureCode: job?.failure_code ?? (!job ? 'job_missing' : job.status === 'completed' && !candidates.length ? 'no_image' : null), cancelRequested: job?.cancel_requested === 1, candidates }
    })
    const latest = attempts[attempts.length - 1]
    return { slotKey: slot.slot_key, kind: slot.kind, prompt: slot.prompt, chosenHash: slot.chosen_hash, status: latest ? latest.status === 'completed' && !latest.candidates.length ? 'failed' : latest.status : 'waiting', attempts }
  })
  const reference = slots.find((slot) => slot.kind === 'reference')
  if (reference && !reference.chosenHash && ['failed', 'cancelled'].includes(reference.status)) {
    slots.forEach((slot) => { if (!slot.attempts.length) slot.status = 'blocked' })
  }
  if (enabled) scheduleReview(id)
  return { id: row.id, accountId: row.account_id, profileId: row.profile_id, presetId: row.preset_id, createdAt: row.created_at, snapshot: { preset: { ...snapshot.preset }, appearance: snapshot.appearance, referenceHash: snapshot.referenceHash, slots: snapshot.slots }, slots }
}

export async function regenerateChatAssetSlot(requester: McpRequester, id: number, key: string, value: unknown) {
  const parsed = z.object({ attempt: positiveId, useCurrentPreset: z.boolean().optional() }).strict().safeParse(value)
  if (!parsed.success) throw new ChatAssetError('다음 시도 번호와 프리셋 옵션을 확인해줘.')
  return serialized(id, async () => {
    const row = authorize(requester, id)
    const slot = slotRow(id, key)
    await submitSlot(requester, row, slot, parsed.data.attempt, parsed.data.useCurrentPreset === true)
    return getChatAssetBatch(requester, id)
  })
}

export async function cancelChatAssetSlot(requester: McpRequester, id: number, key: string) {
  return serialized(id, async () => {
    authorize(requester, id)
    const slot = slotRow(id, key)
    // Older regenerations may still be queued/running; cancel every live job of this slot.
    if (!attemptsOf(slot).length) throw new ChatAssetError('아직 제출된 작업이 없어.', 409)
    for (const attempt of attemptsOf(slot)) {
      const job = GenerationQueueModel.findListRecordById(attempt.jobId)
      if (job && !['completed', 'failed', 'cancelled'].includes(job.status)) await GenerationQueueService.requestCancellation(attempt.jobId, { origin: 'user' })
    }
    return getChatAssetBatch(requester, id)
  })
}

export async function chooseChatAssetSlot(requester: McpRequester, id: number, key: string, hash: unknown) {
  return serialized(id, async () => {
    authorize(requester, id)
    const slot = slotRow(id, key)
    if (typeof hash !== 'string' || !attemptsOf(slot).some((attempt) => candidatesOf(attempt.jobId).some((candidate) => candidate.compositeHash === hash))) throw new ChatAssetError('이 슬롯의 성공한 후보를 골라줘.')
    normalizeProfileAssetHash(hash)
    getUserSettingsDb().prepare('UPDATE chat_asset_slots SET chosen_hash = ? WHERE batch_id = ? AND slot_key = ?').run(hash, id, key)
    if (slot.kind === 'reference') await submitInitialSlots(requester, id)
    return getChatAssetBatch(requester, id)
  })
}

/** Tag calls run later and cache successful results in attempts, without saving any queue status. */
const reviews = new Map<number, Promise<void>>()
function scheduleReview(id: number) {
  if (reviews.has(id)) return
  const task = new Promise<void>((resolve) => setImmediate(resolve)).then(() => cacheChatAssetReviews(id)).catch((error) => console.warn('Could not review character assets:', error instanceof Error ? error.message : error))
  reviews.set(id, task)
  void task.finally(() => { if (reviews.get(id) === task) reviews.delete(id) })
}

export async function cacheChatAssetReviews(id: number) {
  if (!assetTaggerEnabled()) return
  const rows = slotRows(id)
  const tags = Object.assign({}, ...rows.flatMap((slot) => attemptsOf(slot).map((attempt) => attempt.tags ?? {}))) as Record<string, AssetTagCache>
  for (const slot of rows) for (const attempt of attemptsOf(slot)) {
    const candidates = candidatesOf(attempt.jobId)
    const hashes = candidates.length ? [...new Set([...candidates.map((entry) => entry.compositeHash), ...(attempt.referenceHash ? [attempt.referenceHash] : [])])] : []
    for (const hash of hashes) {
      if (!assetTaggerEnabled()) return
      if (tags[hash] || Date.now() - (attempt.tagCheckedAt?.[hash] ?? 0) < 60000) continue
      const tagged = await tagAsset(hash)
      if (tagged) tags[hash] = tagged
      // Re-read after each await, preserving a simultaneous choice/regeneration and another cache writer.
      const live = getUserSettingsDb().prepare('SELECT * FROM chat_asset_slots WHERE batch_id = ? AND slot_key = ?').get(id, slot.slot_key) as SlotRow | undefined
      if (!live) return
      const current = attemptsOf(live)
      const target = current.find((entry) => entry.jobId === attempt.jobId)
      if (!target) continue
      target.tagCheckedAt = { ...target.tagCheckedAt, [hash]: Date.now() }
      target.tags = { ...target.tags, ...tags }
      getUserSettingsDb().prepare('UPDATE chat_asset_slots SET attempts = ? WHERE batch_id = ? AND slot_key = ?').run(JSON.stringify(current), id, slot.slot_key)
    }
  }
  await judgeExpressionCandidates(id, tags)
}

/** When the judge last failed on a candidate: a batch view polls, and a judge that is down is not asked every poll. */
const judgeFailedAt = new Map<string, number>()
const JUDGE_RETRY_MS = 5 * 60_000

/** Expression candidates with tags and no reading yet: the profile's judge says which emotion they show (cached on the attempt). */
async function judgeExpressionCandidates(id: number, tags: Record<string, AssetTagCache>) {
  const batch = getUserSettingsDb().prepare('SELECT profile_id FROM chat_asset_batches WHERE id = ?').get(id) as { profile_id: number } | undefined
  const profile = batch ? ChatProfileStore.find(batch.profile_id) : null
  if (!profile || !assetJudgeSetup(profile)) return
  const rows = slotRows(id)
  const emotions = rows.filter((slot) => slot.kind === 'expression').map((slot) => slot.slot_key)
  if (emotions.length < 2) return
  for (const slot of rows) {
    if (slot.kind !== 'expression') continue
    for (const attempt of attemptsOf(slot)) {
      for (const { compositeHash: hash } of candidatesOf(attempt.jobId)) {
        const failedKey = `${slot.slot_key}:${hash}`
        if (!tags[hash] || attempt.judged?.[hash] || Date.now() - (judgeFailedAt.get(failedKey) ?? 0) < JUDGE_RETRY_MS) continue
        const judged = await judgeExpression({ profile, emotions, emotion: slot.slot_key, tags: tags[hash] })
        if (!judged) {
          if (judgeFailedAt.size > 1000) judgeFailedAt.clear()
          judgeFailedAt.set(failedKey, Date.now())
          continue
        }
        // Re-read after the await, preserving a simultaneous choice/regeneration and another cache writer.
        const live = getUserSettingsDb().prepare('SELECT * FROM chat_asset_slots WHERE batch_id = ? AND slot_key = ?').get(id, slot.slot_key) as SlotRow | undefined
        if (!live) return
        const current = attemptsOf(live)
        const target = current.find((entry) => entry.jobId === attempt.jobId)
        if (!target) continue
        target.judged = { ...target.judged, [hash]: judged }
        getUserSettingsDb().prepare('UPDATE chat_asset_slots SET attempts = ? WHERE batch_id = ? AND slot_key = ?').run(JSON.stringify(current), id, slot.slot_key)
      }
    }
  }
}

/** Profile and group writes share the user.db connection and its attached image database transaction. */
export function applyChatAssetBatch(requester: McpRequester, id: number, value: ChatAssetApplyInput = {}, expected?: Record<string, string>): ChatAssetApplyResult {
  const row = authorize(requester, id)
  const parsed = z.object({ avatarCrop: z.unknown().optional() }).strict().safeParse(value)
  if (!parsed.success) throw new ChatAssetError('자산 적용 입력을 확인해줘.')
  requireRequesterPermission(requester, 'images.edit')
  const crop = normalizeAvatarCrop(value.avatarCrop)
  const selected = slotRows(id).filter((slot) => slot.chosen_hash)
  if (!selected.length) throw new ChatAssetError('적용할 후보를 먼저 골라줘.')
  const chosen = Object.fromEntries(selected.map((slot) => [slot.slot_key, slot.chosen_hash!]))
  if (expected && (Object.keys(expected).length !== selected.length || selected.some((slot) => expected[slot.slot_key] !== slot.chosen_hash))) throw new ChatAssetError('고른 후보가 제안 뒤 바뀌었어. 새 적용 제안을 만들어줘.', 409)
  for (const slot of selected) {
    if (!attemptsOf(slot).some((attempt) => candidatesOf(attempt.jobId).some((candidate) => candidate.compositeHash === slot.chosen_hash))) throw new ChatAssetError('고른 후보를 더 이상 사용할 수 없어.', 409)
    normalizeProfileAssetHash(chosen[slot.slot_key])
  }
  const applied: ChatAssetApplyResult['applied'] = { profileFields: [], expressionSlots: [], expressionGroupId: null, backgroundGroupId: null }
  const database = getUserSettingsDb()
  attachMainImagesDatabase(database)
  try {
    database.transaction(() => {
      const liveChosen = Object.fromEntries(slotRows(id).filter((slot) => slot.chosen_hash).map((slot) => [slot.slot_key, slot.chosen_hash]))
      if (JSON.stringify(liveChosen) !== JSON.stringify(chosen)) throw new ChatAssetError('고른 후보가 다른 요청에서 바뀌었어. 다시 읽어줘.', 409)
      const profile = ChatProfileStore.find(row.profile_id)!
      const path = chatCharacterGroupPath(profile.name)
      const patch: ChatProfileInput = {}
      for (const slot of selected) {
        const hash = slot.chosen_hash!
        if (slot.kind === 'avatar') { patch.avatarHash = hash; patch.avatarCrop = value.avatarCrop === undefined ? null : crop; if (hash !== profile.avatarHash) patch.avatar = null; applied.profileFields.push('avatarHash', 'avatarCrop') }
        if (slot.kind === 'reference') { patch.referenceHash = hash; applied.profileFields.push('referenceHash') }
        if (slot.kind === 'background') {
          patch.backgroundHash = hash; if (hash !== profile.backgroundHash) patch.background = null; applied.profileFields.push('backgroundHash')
          const group = GroupPathService.resolveOrCreate(`${path}/배경`, database)
          applied.backgroundGroupId = group.groupId
          const added = EmoticonService.addImages(group.groupId, [{ compositeHash: hash, keywords: [] }], database)
          if (added.missing.length) throw new ChatAssetError('배경 이미지를 찾을 수 없어.', 409)
        }
      }
      const expressions = selected.filter((slot) => slot.kind === 'expression')
      if (expressions.length) {
        const group = GroupPathService.resolveOrCreate(`${path}/표정`, database)
        database.prepare('UPDATE groups SET emoticon_enabled = 1 WHERE id = ?').run(group.groupId)
        const byHash = new Map<string, string[]>()
        expressions.forEach((slot) => byHash.set(slot.chosen_hash!, [...(byHash.get(slot.chosen_hash!) ?? []), slot.slot_key]))
        const entries = new Map(EmoticonService.listEntries(group.groupId, database).map((entry) => [entry.compositeHash, entry]))
        const items = [...byHash].map(([compositeHash, keywords]) => ({ compositeHash, keywords: [...new Set([...(entries.get(compositeHash)?.explicit ? entries.get(compositeHash)!.keywords : []), ...keywords])] }))
        if (items.some((item) => item.keywords.length > 12)) throw new ChatAssetError('한 이미지에 표정 키워드를 12개 넘게 넣을 수 없어.', 409)
        const result = EmoticonService.addImages(group.groupId, items, database)
        if (result.conflicts.length || result.missing.length) throw new ChatAssetError('표정 그룹의 키워드가 겹치거나 이미지가 사라졌어.', 409, { conflicts: result.conflicts, missing: result.missing })
        const groupIds = [group.groupId, ...profile.style.emoticonGroupIds.filter((groupId) => groupId !== group.groupId)]
        const style = { ...profile.style, emoticonGroupIds: groupIds }
        if (normalizeChatStyle(style).emoticonGroupIds.length !== groupIds.length) throw new ChatAssetError('이모티콘 그룹 연결이 상한에 닿았어. 먼저 연결 하나를 풀어줘.', 409)
        patch.style = style
        applied.expressionGroupId = group.groupId
        applied.expressionSlots = expressions.map((slot) => slot.slot_key)
        applied.profileFields.push('style.emoticonGroupIds')
      }
      // Full-body art remains a library candidate until the later standing-image feature.
      if (Object.keys(patch).length) ChatProfileStore.update(row.profile_id, patch, database)
    }).immediate()
    return { profileId: row.profile_id, applied }
  } catch (error) {
    throw new ChatAssetError(error instanceof Error ? error.message : '자산을 적용하지 못했어.', error instanceof ChatAssetError ? error.status : 400, {
      ...(error instanceof ChatAssetError ? error.details : {}), rolledBack: true,
      applied: { profileFields: [], expressionSlots: [], expressionGroupId: null, backgroundGroupId: null },
    })
  }
}
