import { z } from 'zod'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import type { PluginLlmJob, PluginLlmMeasurement, PluginLlmProfile, PluginProfileAsset, PluginLlmDiscardResult } from '@conai/shared'
import { canRequesterViewImages, requireRequesterImagePermission } from '../../middleware/imageAccess'
import { resolveProfileAsset } from '../codex-chat/chatProfileAssets'
import { MEDIA_MAX_PIXELS } from '../codex-chat/chatMediaLinks'
import type { McpRequester } from '../../mcp/context'
import { ChatProfileStore, type ChatProfile } from '../codex-chat/chatProfiles'
import { LLM_CONNECTION_TYPES, ModelSlotStore } from '../codex-chat/modelSlots'
import { ChatJudgePresetStore } from '../codex-chat/chatJudgePresets'
import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { canUseChatProfile, resolveChatAccess } from '../codex-chat/codexChatAccess'
import { loadChatSettings } from '../codex-chat/chatSettings'
import { buildChatProfileReplyMessages } from '../codex-chat/chatProfileReply'
import { fileOwnerKey } from '../fileStoreService'
import { hasTranslation } from '../codex-chat/chatModelRoles'
import { planStructuredTranslation, structuredProseIn, translateStructuredFields } from '../codex-chat/chatTranslation'
import { resolveWorkflowLlm, runWorkflowLlmText, workflowCodexRequest, workflowLlmBudget, type WorkflowLlmRequest } from '../graph-workflow-executor/workflow-llm-runtime'
import { estimateMessagesTokens, rawMessagesEstimate } from '../codex-chat/llmChatContext'
import { codexMessagePrompt } from '../codexMessageService'
import { buildJsonInstruction } from '../llmProviderService'
import { RuntimeJobRunner } from '../runtimeJobs/runtimeJobRunner'
import { RuntimeJobStore, RUNTIME_JOB_TTL_MS } from '../runtimeJobs/runtimeJobStore'
import { getPlugin } from './pluginRegistry'
import { onPluginChanged, pluginDb, PluginError, sha256 } from './pluginStore'
import { refreshPluginProfileRun, runPluginProfile, acquirePluginProfileLock, ensurePluginProfileRoom, forgetPluginProfileRooms, discardPluginProfileRun } from './pluginProfileRun'
import { validatePluginProfileTools } from './pluginServerTools'
import { requireResearchProfile } from '../codex-chat/chatResearch'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import { usableBlocks } from '../codex-chat/chatBlockState'
import { callPluginJudge, pluginJudgeSettings } from './pluginJudge'
import { pluginLlmFailure } from './pluginLlmErrors'
import { acquireLlmRequestSlot } from '../llmRequestScheduler'
import { pluginLlmInputBytes } from './pluginLlmInput'
import { readRuntimeJobResult } from '../runtimeJobs/runtimeJobResults'
import { CHAT_THREAD_TITLE_MAX_LENGTH } from '@conai/shared'

const MAX_PENDING_REQUESTS = 64
const MAX_QUEUED_INPUT_BYTES = 64 * 1024 * 1024
const roomKeySchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.:-]+$/)
const roomTitleSchema = z.string().trim().min(1).max(CHAT_THREAD_TITLE_MAX_LENGTH)
const inputFields = z.object({
  requestId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.:-]+$/),
  profileId: z.number().int().positive(), message: z.string().trim().min(1),
  history: z.string().default(''), userName: z.string().trim().min(1).default('사용자'),
  useLorebooks: z.boolean().default(true), maxTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  timeoutMs: z.number().int().min(1000).max(1_800_000).optional(),
  mode: z.enum(['text', 'profile']).optional(),
  pluginTools: z.array(z.string().regex(/^[a-z0-9_]+$/).max(64)).optional(),
  roomKey: roomKeySchema.optional(),
  roomTitle: roomTitleSchema.optional(),
  expectedThreadId: z.number().int().positive().optional(),
  research: z.object({
    slotId: z.string().trim().min(1).max(100), activityId: z.string().trim().min(1).max(100),
    allowedPostIds: z.array(z.number().int().positive()).min(1).max(100),
    purpose: z.enum(['research', 'summary']).default('research'),
    // Accepted for older plugins and ignored: research follows the app-wide tool round limit (ChatResearchExecution).
    maxModelCalls: z.number().int().optional(), maxToolCalls: z.number().int().optional(), maxTurns: z.number().int().optional(),
  }).strict().optional(),
  translation: z.object({ fields: z.array(z.string().regex(/^[a-zA-Z][\w]*(?:\.(?:[a-zA-Z][\w]*|\*)){0,4}$/)).min(1).max(20), only: z.boolean().optional(), direction: z.enum(['model', 'display']).optional() }).strict().optional(),
  /** judge: the profile's prompt on its judge model (else the default judge row) instead of its chat model. */
  model: z.enum(['chat', 'judge']).optional(),
  structuredOutput: z.union([z.string().min(1), z.record(z.string(), z.unknown())]).refine(value => {
    try { JSON.parse(typeof value === 'string' ? value : JSON.stringify(value)); return true } catch { return false }
  }, 'structuredOutput must be valid JSON').optional(),
}).strict()
const measureSchema = inputFields.omit({ requestId: true, mode: true, research: true, timeoutMs: true, pluginTools: true, roomKey: true, roomTitle: true, expectedThreadId: true })
const inputSchema = inputFields.refine(input => input.mode !== 'profile' || input.structuredOutput === undefined, 'structuredOutput is only available in text mode')
  .refine(input => input.mode !== 'profile' || input.translation === undefined, 'profile mode uses native translation')
  .refine(input => input.mode !== 'profile' || input.research || input.useLorebooks, 'Profile execution uses the profile lorebook settings; use text mode to disable lorebooks')
  .refine(input => input.mode !== 'profile' || input.model !== 'judge', 'The judge model is only available in text mode')
  .refine(input => !input.research || input.mode === 'profile', 'research requires profile mode')
  .refine(input => (input.pluginTools === undefined && input.roomKey === undefined && input.expectedThreadId === undefined) || (input.mode === 'profile' && !input.research), 'pluginTools, roomKey and expectedThreadId require ordinary profile mode')
  .refine(input => input.roomTitle === undefined || (input.roomKey !== undefined && input.mode === 'profile' && !input.research), 'roomTitle requires roomKey and ordinary profile mode')
type Input = z.infer<typeof inputSchema>
type Row = { plugin_id: string; owner_key: string; request_key: string; fingerprint: string; digest: string; profile_id: number; job_id: string; expires_at: number; delivery?: string | null }
type Params = { pluginId: string; requester: McpRequester; digest: string; inputKey: string; inputBytes: number }
// Prompts live only for admitted work, never in runtime_jobs.params or the idempotency table.
const inputs = new Map<string, { input: Input; measured?: PluginLlmMeasurement }>()

function access(pluginId: string, requester: McpRequester | undefined) {
  const plugin = getPlugin(pluginId)
  if (!requester || !loadChatSettings().enabled) throw new PluginError('채팅이 꺼졌거나 사용할 계정이 없어.', 403)
  const chat = resolveChatAccess(requester.accountId)
  if (!chat.llm && !chat.claude && !chat.codex) throw new PluginError('채팅 권한이 없어.', 403)
  return { plugin, chat, requester, owner: String(requester.accountId ?? 'bootstrap') }
}
function profileAccess(pluginId: string, requester: McpRequester | undefined, profileId: number, digest?: string) {
  const current = access(pluginId, requester)
  if (digest && current.plugin.digest !== digest) throw new PluginError('플러그인 버전이 바뀌었어.', 409)
  const profile = ChatProfileStore.find(profileId)
  if (!profile?.isEnabled || !canUseChatProfile(current.chat, profile)) throw new PluginError('사용할 수 없는 프로필이야.', 403)
  return { ...current, profile }
}

/**
 * The row a `model: 'judge'` request runs on, in the order every judge uses: the profile's own judge model, else its
 * judge preset's, else the judge representative model. Only LLM connections answer free text; a TypeSafe decision
 * model is skipped.
 */
function judgeSlotOf(profile: ChatProfile): number {
  const llm = (id: number | null | undefined) => {
    const row = id ? ModelSlotStore.target(id) : null
    const type = row ? ExternalApiProvider.findByName(row.providerName)?.provider_type : null
    return row && type && LLM_CONNECTION_TYPES.includes(type) ? row.routeId ?? row.id : null
  }
  const preset = profile.judgePresetId ? ChatJudgePresetStore.find(profile.judgePresetId) : null
  const slot = llm(profile.judgeSlotId) ?? llm(preset?.modelSlotId) ?? llm(ModelSlotStore.routeId('judge'))
  if (!slot) throw new PluginError('판단 모델이 없어. 프로필의 판단 모델이나 판단 대표모델을 LLM 연결 모델로 정해줘.', 409)
  return slot
}

function measurement(inputTokens: number, outputReserve: number, contextTokens: number | null, engine: PluginLlmMeasurement['engine']): PluginLlmMeasurement {
  return { inputTokens, outputReserve, contextTokens, available: contextTokens === null ? null : contextTokens - outputReserve - inputTokens, engine, estimator: 'heuristic' }
}

function prepareText(profile: ChatProfile, input: z.infer<typeof measureSchema>, requester: McpRequester) {
  try { return buildText(profile, input, requester) } catch (error) { throw pluginLlmFailure(error) }
}

function buildText(profile: ChatProfile, input: z.infer<typeof measureSchema>, requester: McpRequester) {
  if (input.model === 'judge') judgeSlotOf(profile)
  if (input.translation?.only) {
    let json: unknown
    try { json = JSON.parse(input.message) } catch { throw new PluginError('번역할 JSON을 확인해줘.') }
    const language = input.translation.direction === 'model' ? profile.translationModelLanguage : profile.translationDisplayLanguage
    const plan = planStructuredTranslation(profile, json, input.translation.fields, language)
    if (!plan) throw new PluginError('번역 모델과 입력을 확인해줘.')
    return { request: null, admissionReserve: plan.target.generation.maxTokens ?? 0, measured: measurement(Math.max(0, ...plan.chunks.map(chunk => chunk.inputTokens)), plan.outputReserve, plan.contextTokens, plan.target.transport === 'claude-code' ? 'claude-code' : 'api') }
  }
  // Omit only display blocks for JSON, preserving all persona, example, lore and translation instructions.
  const replyProfile = input.structuredOutput === undefined ? profile : { ...profile, style: { ...profile.style, blocks: [] } }
  const messages = buildChatProfileReplyMessages({ profile: replyProfile, message: input.message, history: input.history || null, userName: input.userName, useLorebooks: input.useLorebooks, loreOwner: fileOwnerKey(requester.accountId), translate: !!input.translation })
  if (input.structuredOutput !== undefined) {
    const instruction = buildJsonInstruction('json', typeof input.structuredOutput === 'string' ? input.structuredOutput : JSON.stringify(input.structuredOutput))
    const system = messages.find(message => message.role === 'system' && typeof message.content === 'string')
    if (instruction && system) system.content = `${system.content}\n\n${instruction}`
    else if (instruction) messages.unshift({ role: 'system', content: instruction })
  }
  const target = input.model === 'judge' ? { modelSlotId: judgeSlotOf(profile), requesterAccountId: requester.accountId } : { profileId: profile.id, requesterAccountId: requester.accountId }
  const resolved = resolveWorkflowLlm(target)
  const budget = workflowLlmBudget(resolved, input.maxTokens)
  const request: WorkflowLlmRequest = { target, messages, structuredOutputJson: input.structuredOutput, task: `Reply as ${profile.name}.`,
    overrides: budget.effectiveMaxTokens === undefined ? undefined : { maxTokens: budget.effectiveMaxTokens } }
  const inputTokens = resolved.engine === 'codex'
    ? rawMessagesEstimate([{ role: 'user', content: codexMessagePrompt(workflowCodexRequest(request, resolved)) }])
    : input.model === 'judge' ? rawMessagesEstimate(messages) : estimateMessagesTokens(profile.id, messages)
  return { request, admissionReserve: budget.admissionReserve, measured: measurement(inputTokens, budget.outputReserve, budget.contextTokens, resolved.engine) }
}

function assertMeasuredFits({ measured, admissionReserve }: ReturnType<typeof prepareText>) {
  if (measured.contextTokens !== null && measured.inputTokens + admissionReserve > measured.contextTokens) {
    throw new PluginError(`문맥이 모델 한도를 넘었어 (입력 약 ${measured.inputTokens} + 출력 ${admissionReserve} > 한도 ${measured.contextTokens} 토큰). 입력을 줄여줘.`, 413)
  }
}

export function measurePluginLlm(pluginId: string, requester: McpRequester | undefined, raw: unknown): PluginLlmMeasurement {
  pluginLlmInputBytes(raw)
  const input = measureSchema.parse(raw)
  const { profile, requester: actor } = profileAccess(pluginId, requester, input.profileId)
  return prepareText(profile, input, actor).measured
}

function profileContext(profile: ChatProfile) {
  try {
    const { contextTokens, maxOutputTokens } = workflowLlmBudget(resolveWorkflowLlm({ profileId: profile.id }))
    return { contextTokens, maxOutputTokens }
  } catch {
    // An enabled profile with a removed model remains listable; start still rejects it.
    return { contextTokens: profile.engine === 'llm' && profile.llmRuntime !== 'pi' ? profile.contextTokens : null, maxOutputTokens: profile.engine === 'codex' ? null : profile.maxTokens }
  }
}

export function listPluginLlmProfiles(pluginId: string, requester: McpRequester | undefined): PluginLlmProfile[] {
  const { chat, requester: actor } = access(pluginId, requester)
  const images = canRequesterViewImages(actor)
  return ChatProfileStore.list({ enabledOnly: true }).filter(profile => canUseChatProfile(chat, profile))
    .map(profile => ({ id: profile.id, name: profile.name, tagline: profile.tagline, engine: profile.engine, appearance: profile.appearance ?? '',
      context: profileContext(profile),
      translation: { enabled: hasTranslation(profile), modelLanguage: profile.translationModelLanguage, displayLanguage: profile.translationDisplayLanguage },
      assetVersion: images ? `${profile.updatedDate}:${profile.avatarHash ?? ''}:${profile.backgroundHash ?? ''}:${profile.referenceHash ?? ''}` : null,
      avatarCrop: images ? profile.avatarCrop : null,
      assets: { avatar: images && Boolean(profile.avatarHash || profile.avatar), background: images && Boolean(profile.backgroundHash || profile.background), reference: images && Boolean(profile.referenceHash) },
      judge: pluginJudgeSettings(profile),
      statusBlocks: usableBlocks(profile.style.blocks).map(block => ({
        key: block.key, name: block.name ?? block.key,
        fields: block.fields.map(field => ({ name: field.name, label: field.label ?? field.name, min: field.min, max: field.max, step: field.step, values: field.values, readonly: field.readonly })),
      })),
    }))
}

let activeAssetReads = 0
export async function readPluginProfileAsset(pluginId: string, requester: McpRequester | undefined, raw: unknown): Promise<PluginProfileAsset> {
  const input = z.object({ profileId: z.number().int().positive(), kind: z.enum(['avatar','background','reference']).default('avatar'), maxSize: z.number().int().min(64).max(512).default(256) }).strict().parse(raw)
  const { profile } = profileAccess(pluginId, requester, input.profileId)
  requireRequesterImagePermission(requester)
  const versionOf = (p: typeof profile) => sha256(JSON.stringify([p.updatedDate, p.avatarHash, p.backgroundHash, p.referenceHash, p.avatarCrop, p.avatar, p.background]))
  const version = versionOf(profile), asset = resolveProfileAsset(profile, input.kind)
  const base = { profileId: profile.id, kind: input.kind, version, crop: input.kind === 'avatar' ? profile.avatarCrop : null }
  if (asset.state === 'missing' || asset.state === 'hidden') return { ...base, state: asset.state }
  if (activeAssetReads >= 4) throw new PluginError('프로필 이미지를 처리 중이야. 잠시 후 다시 요청해줘.', 429)
  activeAssetReads++
  try {
    const size = asset.state === 'file' ? (await fs.stat(asset.file.path)).size : asset.buffer.length
    if (size > 50 * 1024 * 1024) throw new PluginError('프로필 이미지가 너무 커. 50MB 이하 이미지를 사용해줘.')
    const { data, info } = await sharp(asset.state === 'file' ? asset.file.path : asset.buffer, { limitInputPixels: MEDIA_MAX_PIXELS, animated: false })
      .rotate().resize(input.maxSize, input.maxSize, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).timeout({ seconds: 5 }).toBuffer({ resolveWithObject: true })
    // Conversion is asynchronous: revocation, safety changes and profile replacements must still take effect.
    const current = profileAccess(pluginId, requester, profile.id).profile
    requireRequesterImagePermission(requester)
    if (versionOf(current) !== version) throw new PluginError('프로필 이미지가 바뀌었어. 다시 조회해줘.', 409)
    const live = resolveProfileAsset(current, input.kind)
    if (live.state === 'missing' || live.state === 'hidden') return { ...base, state: live.state }
    if (data.length > 192 * 1024) throw new PluginError('이미지 결과가 너무 커. maxSize를 줄여줘.')
    return { ...base, state: 'ready', mimeType: 'image/webp', data: data.toString('base64'), width: info.width, height: info.height }
  } catch (error) {
    if (error instanceof PluginError) throw error
    // Do not expose native paths or decoding internals through the plugin bridge.
    throw new PluginError('프로필 이미지를 읽을 수 없어. 이미지 조회 권한과 원본을 확인해줘.', 403)
  } finally { activeAssetReads-- }
}
function view(row: Row): PluginLlmJob {
  const job = RuntimeJobStore.get(row.job_id)
  if (!job || row.expires_at <= Date.now()) throw new PluginError('답변 작업이 만료됐어. 같은 요청을 자동 재전송하지 마.', 410)
  try { job.result = readRuntimeJobResult(row.job_id, job.result) }
  catch { throw new PluginError('답변 결과 파일이 없거나 손상됐어. 같은 요청을 자동 재전송하지 마.', 410) }
  return { jobId: job.jobId, requestId: row.request_key, profileId: row.profile_id, status: job.status,
    cancelRequested: job.cancelRequested, result: job.result as PluginLlmJob['result'], error: job.failureMessage, expiresAt: row.expires_at,
    ...(row.delivery ? { delivery: JSON.parse(row.delivery) } : {}) }
}
function owned(pluginId: string, requester: McpRequester | undefined, jobId: unknown) {
  const { owner } = access(pluginId, requester)
  const id = z.string().uuid().parse(jobId)
  const row = pluginDb().prepare('SELECT * FROM plugin_llm_requests WHERE job_id=? AND plugin_id=? AND owner_key=?').get(id, pluginId, owner) as Row | undefined
  if (!row) throw new PluginError('답변 작업을 찾을 수 없어.', 404)
  return row
}
export function getPluginLlmJob(pluginId: string, requester: McpRequester | undefined, jobId: unknown) {
  const row = owned(pluginId, requester, jobId)
  profileAccess(pluginId, requester, row.profile_id)
  const result = view(row)
  if (result.result?.profileRun) result.result = { ...result.result, profileRun: refreshPluginProfileRun(result.result.profileRun, requester!) }
  return result
}
export function cancelPluginLlmJob(pluginId: string, requester: McpRequester | undefined, jobId: unknown) {
  const row = owned(pluginId, requester, jobId)
  // A removed/disabled profile must not prevent stopping a previously admitted call.
  RuntimeJobRunner.cancel(row.job_id)
  const result = view(row)
  if (result.result?.profileRun?.research) requireRequesterPermission(requester, 'posts.view')
  return result
}

export async function discardPluginLlmJob(pluginId: string, requester: McpRequester | undefined, jobId: unknown): Promise<PluginLlmDiscardResult> {
  const row = owned(pluginId, requester, jobId)
  const job = view(row)
  if (!['completed', 'failed', 'cancelled'].includes(job.status)) throw new PluginError('답변 작업이 아직 끝나지 않았어.', 409)
  // Only native profile execution produces profileRun. Research has its own isolated room and is never discarded.
  const run = job.result?.profileRun
  if (!run || run.research || !job.delivery || job.delivery.threadId !== run.threadId) {
    throw new PluginError('입력 영수증과 실행 결과가 있는 일반 프로필 답변만 버릴 수 있어.', 409)
  }
  const deleted = await discardPluginProfileRun(pluginId, requester!, row.profile_id, run, job.delivery.messageId)
  return { jobId: job.jobId, deleted }
}

function registerJob() {
  if (RuntimeJobRunner.isRegistered('plugin-llm')) return
  RuntimeJobRunner.register<Params, NonNullable<PluginLlmJob['result']>>({
    kind: 'plugin-llm', singletonKey: params => `plugin-llm:${params.inputKey}`,
    handler: async ctx => {
      // Start returns a durable ID before any provider request is made.
      await ctx.yield()
      const { pluginId, requester, digest, inputKey } = ctx.params
      const admitted = inputs.get(inputKey)
      inputs.delete(inputKey)
      if (!admitted) throw new PluginError('중단된 답변은 자동 재실행하지 않아. 새 요청이 필요해.')
      const { input } = admitted
      ctx.throwIfCancelled()
      let { profile } = profileAccess(pluginId, requester, input.profileId, digest)
      const controller = new AbortController()
      const startedAt = Date.now()
      const abort = () => controller.abort(ctx.signal.reason)
      ctx.signal.addEventListener('abort', abort, { once: true })
      // A profile run follows the profile's own engine and connection limits; only an explicit plugin deadline stops it early.
      const timeoutMs = input.timeoutMs
      const deadline = new DOMException('답변 제한 시간을 넘었어.', 'TimeoutError')
      const timeout = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(deadline), timeoutMs)
      const permissionCheck = setInterval(() => {
        try {
          ctx.throwIfCancelled()
          profileAccess(pluginId, requester, input.profileId, digest)
        } catch (error) { controller.abort(error) }
      }, 1000)
      timeout?.unref(); permissionCheck.unref()
      let releaseExecution: (() => void) | undefined
      let releaseProfile: (() => void) | undefined
      let measured = admitted.measured
      try {
        ctx.flush({ phase: 'queued', currentLabel: profile.name, total: 1 })
        if (input.mode === 'profile') {
          releaseProfile = await acquirePluginProfileLock(requester.accountId, pluginId, input.profileId, input.roomKey, controller.signal)
        }
        // Bound CLI processes too; requests beyond four wait, while connection limits still govern provider work.
        releaseExecution = await acquireLlmRequestSlot('\0plugin-llm-execution', 4, controller.signal)
        controller.signal.throwIfAborted(); ctx.throwIfCancelled()
        profile = profileAccess(pluginId, requester, input.profileId, digest).profile
        ctx.flush({ phase: 'generating', currentLabel: profile.name, total: 1 })
        if (input.mode === 'profile') {
          const result = await runPluginProfile({ pluginId, pluginName: getPlugin(pluginId).definition.name, requester, profile, input, signal: controller.signal,
            onDelivered: delivery => pluginDb().prepare('UPDATE plugin_llm_requests SET delivery=? WHERE job_id=?').run(JSON.stringify(delivery), ctx.jobId),
            onPrimaryComplete: () => { releaseExecution?.(); releaseExecution = undefined; ctx.flush({ phase: 'follow-up' }) },
            followUpDeadlineExpired: () => controller.signal.reason === deadline && !ctx.signal.aborted })
          if (!result.profileRun?.followUpTimedOut) controller.signal.throwIfAborted()
          ctx.throwIfCancelled()
          profileAccess(pluginId, requester, input.profileId, digest)
          ctx.flush({ processed: 1, succeeded: 1 })
          return result
        }
        if (input.translation?.only) {
          let json: unknown
          try { json = JSON.parse(input.message) } catch { throw new PluginError('번역할 JSON을 확인해줘.') }
          const language = input.translation.direction === 'model' ? profile.translationModelLanguage : profile.translationDisplayLanguage
          const translated = await translateStructuredFields(profile, json, input.translation.fields, language, controller.signal, { replyId: `plugin:${pluginId}:${ctx.jobId}` }, false, { followConnectionTimeout: true })
          controller.signal.throwIfAborted(); ctx.throwIfCancelled(); profileAccess(pluginId, requester, input.profileId, digest)
          if (!translated) throw new PluginError('번역에 실패했어. 프로필의 번역 모델을 확인해줘.')
          const output = { text: '', json, truncated: false, model: 'translation', engine: profile.engine, translation: { status: 'completed' as const, language, json: translated } }
          return output
        }
        // A queued job may outlive profile, route and lore edits: admit against the live target again before sending.
        const prepared = prepareText(profile, input, requester)
        measured = prepared.measured
        assertMeasuredFits(prepared)
        if (!prepared.request) throw new PluginError('답변 입력을 확인해줘.')
        const result = await runWorkflowLlmText({
          ...prepared.request, signal: controller.signal,
          timeoutMs: timeoutMs === undefined ? undefined : Math.max(1000, timeoutMs - (Date.now() - startedAt)),
          usage: { purpose: 'plugin', replyId: `plugin:${pluginId}:${ctx.jobId}` },
        })
        controller.signal.throwIfAborted(); ctx.throwIfCancelled()
        profileAccess(pluginId, requester, input.profileId, digest)
        const text = result.text
        let translation: NonNullable<PluginLlmJob['result']>['translation']
        if (input.translation) {
          // Once the original is available, a translation deadline must not discard that successful answer.
          // Explicit cancellation and permission revocation still abort the whole job via controller.
          clearTimeout(timeout)
          const translationSignal = input.timeoutMs === undefined ? controller.signal : AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, input.timeoutMs - (Date.now() - startedAt)))])
          ctx.flush({ phase: 'translating', currentLabel: profile.name, total: 1 })
          const language = profile.translationDisplayLanguage, source = result.json ?? { text }
          // A persona can answer in the display language despite the model-language directive: that answer is the
          // source as written, labelled with its real language, and has nothing to translate.
          const written = hasTranslation(profile) && structuredProseIn(source, input.translation.fields, language)
          const translated = hasTranslation(profile) && !written ? await translateStructuredFields(profile, source, input.translation.fields, language, translationSignal, { replyId: `plugin:${pluginId}:${ctx.jobId}` }, false, { followConnectionTimeout: true }) : null
          controller.signal.throwIfAborted(); ctx.throwIfCancelled(); profileAccess(pluginId, requester, input.profileId, digest)
          translation = { status: !hasTranslation(profile) ? 'disabled' : written || translated ? 'completed' : 'failed', language, ...(hasTranslation(profile) ? { sourceLanguage: written ? language : profile.translationModelLanguage } : {}), ...(translated ? { json: translated } : {}) }
        }
        ctx.flush({ processed: 1, succeeded: 1 })
        return { text, truncated: result.metadata.finish_reason === 'length', model: result.model, engine: result.engine, ...(translation ? { translation } : {}), ...(input.structuredOutput === undefined ? {} : { json: result.json }) }
      } catch (error) {
        const reason = controller.signal.aborted ? controller.signal.reason : error
        throw pluginLlmFailure(reason, {
          measurement: measured,
          ...(controller.signal.aborted && reason instanceof Error && reason.name === 'TimeoutError' ? { deadline: 'plugin', timeoutMs } : {}),
        })
      } finally {
        releaseExecution?.()
        releaseProfile?.()
        clearTimeout(timeout); clearInterval(permissionCheck)
        ctx.signal.removeEventListener('abort', abort)
      }
    },
  })
}

export function startPluginLlmJob(pluginId: string, requester: McpRequester | undefined, raw: unknown): PluginLlmJob {
  const inputBytes = pluginLlmInputBytes(raw)
  const input = inputSchema.parse(raw)
  const { plugin, owner, requester: actor, profile } = profileAccess(pluginId, requester, input.profileId)
  if (input.research) { requireResearchProfile(profile); requireRequesterPermission(actor, 'posts.view') }
  if (input.model === 'judge') judgeSlotOf(profile) // refuse up front, not as a failed job
  const fingerprint = sha256(JSON.stringify(input))
  const db = pluginDb()
  registerJob()
  const replay = () => {
    const previous = db.prepare('SELECT * FROM plugin_llm_requests WHERE plugin_id=? AND owner_key=? AND request_key=?').get(pluginId, owner, input.requestId) as Row | undefined
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.digest !== plugin.digest) throw new PluginError('같은 요청 ID에 다른 입력이나 플러그인 버전을 사용할 수 없어.', 409)
      return view(previous)
    }
    return null
  }
  const previous = replay()
  if (previous) return previous
  validatePluginProfileTools(pluginId, input.pluginTools)
  // Lore reads and prompt estimation must not hold the SQLite write lock.
  const prepared = input.mode === 'profile' ? undefined : prepareText(profile, input, actor)
  if (prepared) assertMeasuredFits(prepared)
  // SQLite admission and request identity remain atomic, including between API processes.
  return db.transaction(() => {
    const raced = replay()
    if (raced) return raced
    db.prepare('DELETE FROM plugin_llm_requests WHERE expires_at<? AND job_id NOT IN (SELECT job_id FROM runtime_jobs WHERE status IN (\'queued\',\'running\'))').run(Date.now())
    const queued = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(json_extract(j.params, '$.inputBytes')), 0) AS bytes
      FROM plugin_llm_requests p JOIN runtime_jobs j ON j.job_id=p.job_id
      WHERE p.plugin_id=? AND j.status IN ('queued','running') AND (j.phase IS NULL OR j.phase='queued')`).get(pluginId) as { n: number; bytes: number }
    if (queued.n >= MAX_PENDING_REQUESTS || queued.bytes + inputBytes > MAX_QUEUED_INPUT_BYTES) {
      throw new PluginError('플러그인 답변 대기열이 가득 찼어 (64개 또는 입력 합계 64 MiB). 완료 후 같은 요청 ID로 다시 시도해줘.', 429)
    }
    const inputKey = `${pluginId}:${owner}:${input.requestId}`
    inputs.set(inputKey, { input, measured: prepared?.measured })
    try {
      const job = RuntimeJobRunner.start('plugin-llm', { pluginId, requester: actor, digest: plugin.digest, inputKey, inputBytes }, { requestedByAccountId: actor.accountId, total: 1 })
      const row: Row = { plugin_id: pluginId, owner_key: owner, request_key: input.requestId, fingerprint, digest: plugin.digest, profile_id: input.profileId, job_id: job.jobId, expires_at: Date.now() + RUNTIME_JOB_TTL_MS }
      db.prepare('INSERT INTO plugin_llm_requests(plugin_id,owner_key,request_key,fingerprint,digest,profile_id,job_id,expires_at) VALUES(?,?,?,?,?,?,?,?)').run(pluginId, owner, input.requestId, fingerprint, plugin.digest, input.profileId, job.jobId, row.expires_at)
      return view(row)
    } catch (error) { inputs.delete(inputKey); throw error }
  }).immediate()
}

/** One dispatcher for the authenticated page bridge and server worker SDK. */
export function callPluginLlm(pluginId: string, requester: McpRequester | undefined, method: string, args: unknown) {
  if (method === 'profiles') return listPluginLlmProfiles(pluginId, requester)
  if (method === 'measure') return measurePluginLlm(pluginId, requester, args)
  if (method === 'asset') return readPluginProfileAsset(pluginId, requester, args)
  if (method === 'start') return startPluginLlmJob(pluginId, requester, args)
  if (method === 'room') {
    const input = z.object({ profileId: z.number().int().positive(), roomKey: roomKeySchema.optional(), roomTitle: roomTitleSchema.optional() }).strict()
      .refine(input => input.roomTitle === undefined || input.roomKey !== undefined, 'roomTitle requires roomKey').parse(args)
    const { plugin, requester: actor, profile } = profileAccess(pluginId, requester, input.profileId)
    return ensurePluginProfileRoom(pluginId, plugin.definition.name, actor, profile, input.roomKey, input.roomTitle).then(room => {
      profileAccess(pluginId, actor, profile.id, plugin.digest)
      return { threadId: room.id }
    })
  }
  if (method === 'forgetRooms') {
    const { roomKey } = z.object({ roomKey: roomKeySchema }).strict().parse(args)
    return forgetPluginProfileRooms(pluginId, access(pluginId, requester).requester, roomKey)
  }
  if (method === 'decide' || method === 'judgeTurn') return callPluginJudge(pluginId, method, args, profileId => profileAccess(pluginId, requester, profileId))
  const { jobId } = z.object({ jobId: z.string().uuid() }).strict().parse(args)
  if (method === 'get') return getPluginLlmJob(pluginId, requester, jobId)
  if (method === 'cancel') return cancelPluginLlmJob(pluginId, requester, jobId)
  if (method === 'discard') return discardPluginLlmJob(pluginId, requester, jobId)
  throw new PluginError('알 수 없는 LLM 요청이야.')
}

// Cancels native provider requests as well as stopping the plugin's worker on disable/update/removal.
onPluginChanged(pluginId => {
  let digest: string | null = null
  try { digest = getPlugin(pluginId).digest } catch { /* disabled or removed */ }
  const rows = pluginDb().prepare("SELECT r.job_id, r.digest FROM plugin_llm_requests r JOIN runtime_jobs j ON j.job_id=r.job_id WHERE r.plugin_id=? AND j.status IN ('queued','running')").all(pluginId) as Array<{ job_id: string; digest: string }>
  for (const row of rows) if (row.digest !== digest) RuntimeJobRunner.cancel(row.job_id)
})
