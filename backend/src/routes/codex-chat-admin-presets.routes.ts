import express, { type Request, type Response } from 'express'
import type { ChatJudgePresetInput } from '@conai/shared'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import { ChatProfileStore } from '../services/codex-chat/chatProfiles'
import { ChatSharedBlockStore, readBlockFile } from '../services/codex-chat/chatDisplayBlocks'
import { ChatToolPresetStore, readToolPresetFile } from '../services/codex-chat/chatToolPresets'
import { ChatJudgePresetStore, readJudgePresetFile } from '../services/codex-chat/chatJudgePresets'
import { ChatJudgeLogStore } from '../services/codex-chat/chatJudgeLogs'
import { isJudgeConnectionReady, JudgeError } from '../services/judge/judgeEngine'
import { testJudgePreset } from '../services/codex-chat/chatJudge'
import { ModelSlotStore } from '../services/codex-chat/modelSlots'
import { buildModelUsage } from '../services/codex-chat/modelUsage'
import { buildLlmUsageSummary } from '../services/llmUsage'
import { ChatGenerationPresetStore, readGenerationPresetFile, type ChatGenerationPresetInput } from '../services/codex-chat/chatGenerationPresets'
import { CodexChatStore } from '../services/codex-chat/codexChatStore'
import { isChatTargetReady } from '../services/codex-chat/llmChatCompletion'
import { sharedServerProfiles } from '../services/codex-chat/chatServerSharing'
import { requireFileStoreOwner } from '../services/fileStoreAccess'
import { getRequesterAccountId } from './requester-session-helpers'
import { sendRouteBadRequest } from './routeValidation'
import { parseId, requesterFrom, requireChatAccess, sendChatError } from './codex-chat-route-helpers'

/** /api/codex-chat admin library: display blocks, model rows and representative models, usage, tool/judge/generation presets. */
const router = express.Router()

/** Shared display blocks (status cards). Profiles link them by id, so an edit reaches every linked profile at once. */
router.get('/admin/blocks', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: ChatSharedBlockStore.list() })
})

router.post('/admin/blocks', requireAdmin, (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown; block?: unknown }
    res.status(201).json({ success: true, data: ChatSharedBlockStore.create(body) })
  } catch (error) { sendChatError(res, error) }
})

/** POST /admin/blocks/import — the parsed contents of a block JSON file (one block, an export, or an array); each becomes a shared block. */
router.post('/admin/blocks/import', requireAdmin, (req: Request, res: Response) => {
  try {
    const created = readBlockFile(req.body).map((item) => ChatSharedBlockStore.create(item))
    res.status(201).json({ success: true, data: created })
  } catch (error) { sendChatError(res, error) }
})

router.put('/admin/blocks/:blockId', requireAdmin, (req: Request, res: Response) => {
  const blockId = parseId(req.params.blockId)
  if (blockId === null) { sendRouteBadRequest(res, 'Invalid block id'); return }
  try {
    const body = (req.body ?? {}) as { name?: unknown; block?: unknown }
    const updated = ChatSharedBlockStore.update(blockId, { name: body.name, block: body.block })
    if (!updated) { res.status(404).json({ success: false, error: '표시 블록을 찾을 수 없어.' }); return }
    res.json({ success: true, data: updated })
  } catch (error) { sendChatError(res, error) }
})

router.delete('/admin/blocks/:blockId', requireAdmin, (req: Request, res: Response) => {
  const blockId = parseId(req.params.blockId)
  if (blockId === null) { sendRouteBadRequest(res, 'Invalid block id'); return }
  res.json({ success: true, data: { deleted: ChatSharedBlockStore.delete(blockId) } })
})

/**
 * Model rows: the representative models (대표모델) and the models each LLM connection serves (Settings → LLM lists
 * them under their connection). Profiles, judge presets, user profiles and chats reference rows of either kind by id,
 * so changing a row's model, or where a representative model points, reaches all of them.
 */
router.get('/admin/model-slots', requireAdmin, (_req: Request, res: Response) => {
  // TypeSafe decision rows are not chat targets, so their readiness is the judge's. `sharedServer`: the profiles that
  // send their reply and a per-turn helper to this row's connection (the connection editor warns about them).
  const shared = sharedServerProfiles()
  res.json({ success: true, data: ModelSlotStore.list().map((slot) => ({ ...slot, ready: slot.model === '' ? false : slot.providerType === 'decision_typesafe' ? isJudgeConnectionReady(slot.providerName, slot.model) : isChatTargetReady(slot.providerName, slot.model), sharedServer: shared.get(slot.providerName) ?? [] })) })
})

/** Adds one model to a connection (returns the existing row when it is already there). */
router.post('/admin/model-slots', requireAdmin, (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { providerName?: unknown; model?: unknown }
    const id = ModelSlotStore.ensure(body.providerName, typeof body.model === 'string' && body.model.trim() ? body.model : null) as number
    res.status(201).json({ success: true, data: ModelSlotStore.find(id) })
  } catch (error) { sendChatError(res, error) }
})

/** Sets a connection's models to exactly the given list (the checklist of the connection editor); rows in use are never dropped. */
router.put('/admin/connections/:providerName/models', requireAdmin, (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: ModelSlotStore.syncConnection(req.params.providerName, (req.body ?? {}).models) })
  } catch (error) { sendChatError(res, error) }
})

router.put('/admin/model-slots/:slotId', requireAdmin, (req: Request, res: Response) => {
  const slotId = parseId(req.params.slotId)
  if (slotId === null) { sendRouteBadRequest(res, 'Invalid model slot id'); return }
  try {
    const updated = ModelSlotStore.update(slotId, (req.body ?? {}) as Record<string, unknown>)
    if (!updated) { res.status(404).json({ success: false, error: '모델을 찾을 수 없어.' }); return }
    res.json({ success: true, data: updated })
  } catch (error) { sendChatError(res, error) }
})

/** A named representative model: `{ name, targetSlotId, contentRatingTierId? }`. */
router.post('/admin/model-routes', requireAdmin, (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, data: ModelSlotStore.createRoute((req.body ?? {}) as Record<string, unknown>) })
  } catch (error) { sendChatError(res, error) }
})

/** Changes a representative model: `{ name?, targetSlotId?, prompt?, contentRatingTierId? }` (it is deleted through /admin/model-slots). */
router.put('/admin/model-routes/:routeId', requireAdmin, (req: Request, res: Response) => {
  const routeId = parseId(req.params.routeId)
  if (routeId === null) { sendRouteBadRequest(res, 'Invalid route id'); return }
  try {
    const updated = ModelSlotStore.updateRoute(routeId, (req.body ?? {}) as Record<string, unknown>)
    if (!updated) { res.status(404).json({ success: false, error: '대표모델을 찾을 수 없어.' }); return }
    res.json({ success: true, data: updated })
  } catch (error) { sendChatError(res, error) }
})

router.post('/admin/model-slots/:slotId/default', requireAdmin, (req: Request, res: Response) => {
  const slotId = parseId(req.params.slotId)
  if (slotId === null) { sendRouteBadRequest(res, 'Invalid model slot id'); return }
  const slot = ModelSlotStore.setDefault(slotId)
  if (!slot) { res.status(404).json({ success: false, error: '모델을 찾을 수 없어.' }); return }
  res.json({ success: true, data: slot })
})

/** `{ on }`: makes the row the default judge, or clears it. */
router.post('/admin/model-slots/:slotId/default-judge', requireAdmin, (req: Request, res: Response) => {
  const slotId = parseId(req.params.slotId)
  if (slotId === null) { sendRouteBadRequest(res, 'Invalid model slot id'); return }
  try {
    const slot = ModelSlotStore.setDefaultJudge(slotId, (req.body ?? {}).on !== false)
    if (!slot) { res.status(404).json({ success: false, error: '모델을 찾을 수 없어.' }); return }
    res.json({ success: true, data: slot })
  } catch (error) { sendChatError(res, error) }
})

router.delete('/admin/model-slots/:slotId', requireAdmin, (req: Request, res: Response) => {
  const slotId = parseId(req.params.slotId)
  if (slotId === null) { sendRouteBadRequest(res, 'Invalid model slot id'); return }
  try {
    res.json({ success: true, data: { deleted: ModelSlotStore.delete(slotId) } })
  } catch (error) { sendChatError(res, error) }
})

/** Saved workflow nodes per model row (a row's other uses come with the row). */
router.get('/admin/model-usage', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: buildModelUsage() })
})

/** GET /admin/llm-usage?days=7|30&offset=<minutes east of UTC> — the LLM dashboard: requests and tokens by day, purpose and model. */
router.get('/admin/llm-usage', requireAdmin, (req: Request, res: Response) => {
  const days = Number(req.query.days ?? 7)
  const offset = Number(req.query.offset ?? 0)
  if (!Number.isSafeInteger(days) || days < 1 || days > 90 || !Number.isSafeInteger(offset) || Math.abs(offset) > 14 * 60) {
    sendRouteBadRequest(res, 'Invalid days or offset')
    return
  }
  res.json({ success: true, data: buildLlmUsageSummary(days, offset) })
})

/** Tool presets (MCP scopes + tool allowlist). Profiles link one by id, so an edit reaches every linked profile at once. */
router.get('/admin/tool-presets', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: ChatToolPresetStore.list() })
})

router.post('/admin/tool-presets', requireAdmin, (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown; scopes?: unknown; toolAllowlist?: unknown }
    res.status(201).json({ success: true, data: ChatToolPresetStore.create(body) })
  } catch (error) { sendChatError(res, error) }
})

/** POST /admin/tool-presets/import — the parsed contents of a preset JSON file (one preset, an export, or an array); each becomes a preset. */
router.post('/admin/tool-presets/import', requireAdmin, (req: Request, res: Response) => {
  try {
    const created = readToolPresetFile(req.body).map((item) => ChatToolPresetStore.create(item))
    res.status(201).json({ success: true, data: created })
  } catch (error) { sendChatError(res, error) }
})

router.put('/admin/tool-presets/:presetId', requireAdmin, (req: Request, res: Response) => {
  const presetId = parseId(req.params.presetId)
  if (presetId === null) { sendRouteBadRequest(res, 'Invalid preset id'); return }
  try {
    const body = (req.body ?? {}) as { name?: unknown; scopes?: unknown; toolAllowlist?: unknown }
    const updated = ChatToolPresetStore.update(presetId, { name: body.name, scopes: body.scopes, toolAllowlist: body.toolAllowlist })
    if (!updated) { res.status(404).json({ success: false, error: '도구 프리셋을 찾을 수 없어.' }); return }
    res.json({ success: true, data: updated })
  } catch (error) { sendChatError(res, error) }
})

router.delete('/admin/tool-presets/:presetId', requireAdmin, (req: Request, res: Response) => {
  const presetId = parseId(req.params.presetId)
  if (presetId === null) { sendRouteBadRequest(res, 'Invalid preset id'); return }
  try {
    res.json({ success: true, data: { deleted: ChatToolPresetStore.delete(presetId) } })
  } catch (error) { sendChatError(res, error) }
})

/** GET /judge-presets — the judge presets by name, for a room owner picking one for a group room (the rest is admin only). */
router.get('/judge-presets', requireChatAccess, (_req: Request, res: Response) => {
  res.json({ success: true, data: ChatJudgePresetStore.list().map((preset) => ({ id: preset.id, name: preset.name })) })
})

/** Judge presets (a decision model's questions about chat turns, group rooms, status fields and assets). Profiles and rooms reference one, so an edit reaches them all. */
router.get('/admin/judge-presets', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: ChatJudgePresetStore.list() })
})

router.post('/admin/judge-presets', requireAdmin, (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, data: ChatJudgePresetStore.create((req.body ?? {}) as ChatJudgePresetInput) })
  } catch (error) { sendChatError(res, error) }
})

/** POST /admin/judge-presets/import — the parsed contents of a judge preset JSON file; each becomes a preset (without a connection). */
router.post('/admin/judge-presets/import', requireAdmin, (req: Request, res: Response) => {
  try {
    const created = readJudgePresetFile(req.body).map((item) => ChatJudgePresetStore.create(item))
    res.status(201).json({ success: true, data: created })
  } catch (error) { sendChatError(res, error) }
})

/**
 * POST /admin/judge-presets/test — runs a preset (`presetId`, or the unsaved `preset` draft) over the last `turns`
 * messages of one of the requester's own API LLM chats. Nothing is logged or changed.
 */
router.post('/admin/judge-presets/test', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { presetId?: unknown; preset?: ChatJudgePresetInput; threadId?: unknown; turns?: unknown; slotId?: unknown }
  const threadId = parseId(body.threadId)
  const thread = threadId === null ? undefined : CodexChatStore.findThreadById(threadId)
  if (!thread || thread.account_id !== getRequesterAccountId(req) || thread.kind === 'group' || thread.profile_id === null) {
    res.status(404).json({ success: false, error: '테스트할 대화를 찾을 수 없어. 내 1:1 채팅만 고를 수 있어.' })
    return
  }
  const profile = ChatProfileStore.find(thread.profile_id)
  if (!profile) { res.status(404).json({ success: false, error: '이 대화의 프로필이 지워졌어.' }); return }
  try {
    const presetId = parseId(body.presetId)
    const preset = body.preset ? ChatJudgePresetStore.draft(body.preset) : presetId === null ? null : ChatJudgePresetStore.find(presetId)
    if (!preset) { res.status(404).json({ success: false, error: '판단 프리셋을 찾을 수 없어.' }); return }
    // The model picked for the test, else the order every judge uses: the profile's own, the preset's, the judge representative model.
    const target = ModelSlotStore.target(parseId(body.slotId) ?? profile.judgeSlotId ?? preset.modelSlotId) ?? ModelSlotStore.defaultJudgeTarget()
    if (!target) { res.status(400).json({ success: false, error: '판단 모델을 골라줘.' }); return }
    const { providerName, model } = target
    const turns = Math.min(20, Math.max(1, Number(body.turns) || 6))
    res.json({ success: true, data: await testJudgePreset({ preset, providerName, model, profile, thread, turns }) })
  } catch (error) {
    if (error instanceof JudgeError) { res.status(400).json({ success: false, error: error.message }); return }
    sendChatError(res, error)
  }
}))

router.put('/admin/judge-presets/:presetId', requireAdmin, (req: Request, res: Response) => {
  const presetId = parseId(req.params.presetId)
  if (presetId === null) { sendRouteBadRequest(res, 'Invalid preset id'); return }
  try {
    const updated = ChatJudgePresetStore.update(presetId, (req.body ?? {}) as ChatJudgePresetInput)
    if (!updated) { res.status(404).json({ success: false, error: '판단 프리셋을 찾을 수 없어.' }); return }
    res.json({ success: true, data: updated })
  } catch (error) { sendChatError(res, error) }
})

router.delete('/admin/judge-presets/:presetId', requireAdmin, (req: Request, res: Response) => {
  const presetId = parseId(req.params.presetId)
  if (presetId === null) { sendRouteBadRequest(res, 'Invalid preset id'); return }
  try {
    res.json({ success: true, data: { deleted: ChatJudgePresetStore.delete(presetId) } })
  } catch (error) { sendChatError(res, error) }
})

function judgeLogFilter(query: Request['query']) {
  const id = (value: unknown) => parseId(value) ?? undefined
  const string = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
  return {
    profileId: id(query.profileId),
    presetId: id(query.presetId),
    threadId: id(query.threadId),
    itemId: string(query.itemId),
    verdict: string(query.verdict),
    stage: string(query.stage),
    beforeId: id(query.beforeId),
    limit: id(query.limit),
    days: id(query.days),
  }
}

/** GET /admin/judge-logs — judge runs, newest first (filters: profileId, presetId, threadId, itemId, verdict, stage; beforeId pages). */
router.get('/admin/judge-logs', requireAdmin, (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: ChatJudgeLogStore.list(judgeLogFilter(req.query)) })
  } catch (error) { sendChatError(res, error) }
})

/** GET /admin/judge-stats — per preset item over the last `days` days (default 7). */
router.get('/admin/judge-stats', requireAdmin, (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: ChatJudgeLogStore.stats(judgeLogFilter(req.query)) })
  } catch (error) { sendChatError(res, error) }
})

/** Generation presets (a fixed NAI setup or ComfyUI workflow the model fills in). Profiles link them by id. */
router.get('/admin/generation-presets', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, data: ChatGenerationPresetStore.listWithAssetSupport() })
})

router.post('/admin/generation-presets', requireAdmin, (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, data: ChatGenerationPresetStore.create((req.body ?? {}) as ChatGenerationPresetInput, { guideOwner: () => requireFileStoreOwner(requesterFrom(req)) }) })
  } catch (error) { sendChatError(res, error) }
})

/** POST /admin/generation-presets/import — the parsed contents of a preset JSON file (one preset, an export, or an array). */
router.post('/admin/generation-presets/import', requireAdmin, (req: Request, res: Response) => {
  try {
    const created = readGenerationPresetFile(req.body).map((item) => ChatGenerationPresetStore.create(item))
    res.status(201).json({ success: true, data: created })
  } catch (error) { sendChatError(res, error) }
})

router.put('/admin/generation-presets/:presetId', requireAdmin, (req: Request, res: Response) => {
  const presetId = parseId(req.params.presetId)
  if (presetId === null) { sendRouteBadRequest(res, 'Invalid preset id'); return }
  try {
    const updated = ChatGenerationPresetStore.update(presetId, (req.body ?? {}) as ChatGenerationPresetInput, { guideOwner: () => requireFileStoreOwner(requesterFrom(req)) })
    if (!updated) { res.status(404).json({ success: false, error: '생성 프리셋을 찾을 수 없어.' }); return }
    res.json({ success: true, data: updated })
  } catch (error) { sendChatError(res, error) }
})

router.delete('/admin/generation-presets/:presetId', requireAdmin, (req: Request, res: Response) => {
  const presetId = parseId(req.params.presetId)
  if (presetId === null) { sendRouteBadRequest(res, 'Invalid preset id'); return }
  try {
    res.json({ success: true, data: { deleted: ChatGenerationPresetStore.delete(presetId) } })
  } catch (error) { sendChatError(res, error) }
})

export default router
