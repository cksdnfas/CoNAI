import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { parseMcpMarkedFields, normalizeMcpWorkflowInputs } from '../../mcp/tools/mcpComfyWorkflowService'
import { resolveMcpGenerationRoutingInput } from '../../mcp/tools/generationJobRouting'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { hasConfiguredAuth } from '../../routes/auth-route-helpers'
import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { activeMediaFile } from '../codex-chat/chatCardAssets'
import { buildChatGenerationPresetJob } from '../codex-chat/chatGenerationPayload'
import { ChatGenerationPresetStore, comfyAssetFields, resolvePresetWorkflow } from '../codex-chat/chatGenerationPresets'
import { ChatLorebookStore, loreEntryMatches, loreEntryTitle, type ChatLoreEntry } from '../codex-chat/chatLorebook'
import { OwnedLorebookStore } from '../codex-chat/chatLorebookFiles'
import { MEDIA_MIME_TYPES } from '../codex-chat/chatMediaLinks'
import { fillCharacterPlaceholders } from '../codex-chat/chatPlaceholders'
import { resolveProfileAsset, type ChatProfileAssetKind } from '../codex-chat/chatProfileAssets'
import { ChatProfileStore, type ChatProfile } from '../codex-chat/chatProfiles'
import { CodexChatStore } from '../codex-chat/codexChatStore'
import { ensureAutomationRoom, wakeChatRoom, wakeReplyText, ChatWakeBusyError } from '../codex-chat/chatRoomWake'
import { resolveAutomationRunAs } from '../automationRunAs'
import { actorFromRequester } from '../posts/postActor'
import { PostStore } from '../posts/postStore'
import { buildPersonaPrompt } from '../codex-chat/llmChatContext'
import { fileOwnerKey } from '../fileStoreService'
import { GenerationQueueService } from '../generationQueueService'
import { publishQueueJobEvent } from '../runtime-events/runtimeEventPublishers'
import { publishRuntimeEvent } from '../runtime-events/runtimeEventBus'
import { normalizeWorkflowNumericPromptValues } from '../workflowNumericFieldPolicy'
import { ingestWorkflowInputImage, isLibraryImageRef } from '../workflowInputImages'
import { saveArtifactBuffer } from './artifacts'
import { buildQueuePayload, resolveQueueBackedOutput } from './execute-comfy'
import { executeNaiModule } from './execute-nai'
import { waitForGraphQueueCompletion } from './queue-wait'
import { isProfileAllowedForRun } from './workflow-llm-runtime'
import { buildRuntimeArtifact, completeSystemNode } from './system-module-artifacts'
import {
  bufferToDataUrl,
  parsePositiveIntegerish,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'

const STILL_IMAGE_HASH = /^[a-f0-9]{48}$/
const SEED_FIELD = /(?:^|[._])(?:noise_seed|seed)$/
const LORE_MAX_ENTRIES_LIMIT = 50

function hasConnectedOutput(context: ExecutionContext, node: GraphWorkflowNode, outputPortKey: string) {
  return context.workflow.graph.edges.some((edge) => edge.source_node_id === node.id && edge.source_port_key === outputPortKey)
}

function optionalText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function joinPrompt(parts: string[]) {
  return parts.map((part) => part.trim().replace(/^,+|,+$/g, '').trim()).filter(Boolean).join(', ')
}

/** The account that started the run; null for scheduled runs and while no accounts are configured. */
function runRequester(context: ExecutionContext) {
  return context.requestedByAccountId ?? null
}

/** The file store owner whose account books this run may read; null when the run has no account (and accounts exist). */
function runFileOwner(context: ExecutionContext) {
  const requester = runRequester(context)
  if (requester !== null) return fileOwnerKey(requester)
  return hasConfiguredAuth() ? null : fileOwnerKey(null)
}

/**
 * A character a workflow may use: it exists and is switched on, and when it is limited to some groups the run's
 * account is in one of them (administrators always are). Runs without an account (schedules) are not group-checked.
 */
function requireWorkflowProfile(context: ExecutionContext, value: unknown): ChatProfile {
  const profileId = parsePositiveIntegerish(value)
  if (profileId === null) throw new Error('캐릭터를 골라줘.')
  const profile = ChatProfileStore.find(profileId)
  if (!profile) throw new Error(`캐릭터를 찾을 수 없어: ${profileId}`)
  if (!profile.isEnabled) throw new Error(`꺼진 캐릭터야: ${profile.name}`)
  if (!isProfileAllowedForRun(profile, runRequester(context))) throw new Error(`이 캐릭터는 실행한 계정이 쓸 수 없어: ${profile.name}`)
  return profile
}

/** The library id of an image input: a library ref as it is, a data URL put into the library (reused when already there). */
async function libraryHashOfImageInput(value: unknown): Promise<string | null> {
  const input = Array.isArray(value) ? value[0] : value
  if (input === undefined || input === null || input === '') return null
  if (isLibraryImageRef(input)) return input.composite_hash
  if (typeof input === 'string' && input.trim().startsWith('data:image/')) return (await ingestWorkflowInputImage(input)).composite_hash
  throw new Error('이미지 입력을 읽지 못했어.')
}

const PROFILE_IMAGE_LABELS: Record<ChatProfileAssetKind, string> = {
  reference: '기준 이미지',
  avatar: '아바타',
  background: '배경 이미지',
}

/** One profile image as a graph image, read only when the port is connected; null when the profile has none. */
async function profileImageArtifact(context: ExecutionContext, node: GraphWorkflowNode, profile: ChatProfile, kind: ChatProfileAssetKind, portKey: string): Promise<RuntimeArtifact | null> {
  if (!hasConnectedOutput(context, node, portKey)) return null
  const asset = resolveProfileAsset(profile, kind)
  if (asset.state === 'hidden') throw new Error(`안전 등급 때문에 ${PROFILE_IMAGE_LABELS[kind]}를 쓸 수 없어.`)
  if (asset.state === 'missing') return null
  const sourcePath = asset.state === 'file' ? asset.file.path : null
  const mimeType = asset.state === 'file' ? asset.file.mimeType : asset.mimeType
  const buffer = asset.state === 'file' ? await fs.promises.readFile(asset.file.path) : asset.buffer
  let storagePath: string | undefined
  let artifactRecordId: number | undefined
  if (context.debugMode) {
    const saved = await saveArtifactBuffer(context.executionId, node.id, portKey, 'image', buffer, {
      mimeType,
      sourcePathForMetadata: sourcePath ?? undefined,
      originalFileName: sourcePath ? path.basename(sourcePath) : undefined,
    })
    storagePath = saved.storagePath
    artifactRecordId = saved.artifactRecordId
  }
  const compositeHash = kind === 'avatar' ? profile.avatarHash : kind === 'background' ? profile.backgroundHash : profile.referenceHash
  return {
    type: 'image',
    value: bufferToDataUrl(buffer, mimeType),
    storagePath,
    artifactRecordId,
    metadata: { kind: 'system-chat-profile-image', asset: kind, profile_id: profile.id, composite_hash: sourcePath ? compositeHash : null },
  }
}

/** Load one chat character's texts and pictures. */
export async function executeLoadChatProfileNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const profile = requireWorkflowProfile(context, resolvedInputs.profile_id)
  const meta = { kind: 'system-load-chat-profile', profile_id: profile.id }
  const images = {
    reference_image: await profileImageArtifact(context, node, profile, 'reference', 'reference_image'),
    avatar_image: await profileImageArtifact(context, node, profile, 'avatar', 'avatar_image'),
    background_image: await profileImageArtifact(context, node, profile, 'background', 'background_image'),
  }
  const profileValue = {
    id: profile.id,
    name: profile.name,
    tagline: profile.tagline,
    appearance: profile.appearance,
    engine: profile.engine,
    greeting: profile.greeting,
    alternate_greetings: profile.alternateGreetings,
    lorebook_ids: profile.lorebookIds,
    generation_preset_ids: profile.generationPresetIds,
    reference_hash: profile.referenceHash,
    avatar_hash: profile.avatarHash,
    background_hash: profile.backgroundHash,
  }
  const nodeArtifacts: Record<string, RuntimeArtifact> = {
    name: buildRuntimeArtifact(context.executionId, node.id, 'name', 'text', profile.name, meta),
    appearance: buildRuntimeArtifact(context.executionId, node.id, 'appearance', 'prompt', profile.appearance, meta),
    persona: buildRuntimeArtifact(context.executionId, node.id, 'persona', 'text', buildPersonaPrompt(profile), meta),
    greeting: buildRuntimeArtifact(context.executionId, node.id, 'greeting', 'text', fillCharacterPlaceholders(profile.greeting, profile), meta),
    profile: buildRuntimeArtifact(context.executionId, node.id, 'profile', 'json', profileValue, meta),
  }
  for (const [portKey, artifact] of Object.entries(images)) {
    if (artifact) nodeArtifacts[portKey] = artifact
  }
  completeSystemNode(context, node, moduleDefinition, 'system.load_chat_profile', nodeArtifacts)
}

type ComfyPresetJob = Extract<Awaited<ReturnType<typeof buildChatGenerationPresetJob>>, { service_type: 'comfyui' }>
type PresetWorkflow = NonNullable<ReturnType<typeof resolvePresetWorkflow>['workflow']>

/** Enqueue a ComfyUI preset job the way graph ComfyUI nodes do and wait for its image. */
async function runComfyPresetJob(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  job: ComfyPresetJob,
  workflow: PresetWorkflow,
  markedFields: ReturnType<typeof parseMcpMarkedFields>,
) {
  const routing = resolveMcpGenerationRoutingInput({ serviceType: 'comfyui', workflowId: workflow.id, serverId: job.server_id ?? null, serverTag: job.server_tag ?? null })
  const promptData = normalizeMcpWorkflowInputs(markedFields, normalizeWorkflowNumericPromptValues(markedFields, job.inputs))
  const jobId = GenerationQueueModel.create({
    service_type: 'comfyui',
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    requested_server_id: routing.requestedServerId,
    requested_server_tag: routing.requestedServerTag,
    request_payload: buildQueuePayload(promptData, context),
    request_summary: `${context.workflow.name} · ${node.label || moduleDefinition.name}`,
  })
  publishQueueJobEvent('queue.job.created', GenerationQueueModel.findListRecordById(jobId))
  GenerationQueueService.requestDispatch()
  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_queue_registered',
    message: `Queue-backed chat preset registered: ${moduleDefinition.name}`,
    details: { queueJobId: jobId, workflowId: workflow.id, requestedServerId: routing.requestedServerId, requestedServerTag: routing.requestedServerTag },
  })
  const completedJob = await waitForGraphQueueCompletion({
    context,
    nodeId: node.id,
    jobId,
    cancellationMessage: `Queue cancellation requested for chat preset node job ${jobId}`,
  })
  await resolveQueueBackedOutput({
    context,
    node,
    moduleDefinition,
    outputPortKey: 'image',
    completedJobId: completedJob.id,
    target: {
      mode: routing.requestedServerId !== null ? 'server' : routing.requestedServerTag ? 'tag' : 'auto',
      requestedServerId: routing.requestedServerId,
      requestedServerTag: routing.requestedServerTag,
    },
  })
}

/**
 * Generate one image with a chat generation preset. A character puts its appearance before the prompt and lends its
 * reference image where the preset takes one; a connected reference image always goes in (and replaces the
 * character's). Without either the preset draws from the text alone.
 */
export async function executeGenerateWithChatPresetNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const presetId = parsePositiveIntegerish(resolvedInputs.preset_id)
  if (presetId === null) throw new Error('생성 프리셋을 골라줘.')
  const preset = ChatGenerationPresetStore.find(presetId)
  if (!preset) throw new Error(`생성 프리셋을 찾을 수 없어: ${presetId}`)
  const prompt = optionalText(resolvedInputs.prompt)
  if (!prompt) throw new Error('프롬프트를 넣어줘.')
  const hasProfile = resolvedInputs.profile_id !== undefined && resolvedInputs.profile_id !== null && resolvedInputs.profile_id !== ''
  const profile = hasProfile ? requireWorkflowProfile(context, resolvedInputs.profile_id) : null
  const explicitReference = await libraryHashOfImageInput(resolvedInputs.reference_image)
  const referenceHash = explicitReference ?? profile?.referenceHash ?? null
  const fullPrompt = joinPrompt([profile?.appearance ?? '', prompt])
  // The builder reads only the reference from the profile; a connected reference image stands in for the character's.
  const referenceSource = profile ? { ...profile, referenceHash } : ({ referenceHash } as ChatProfile)
  const options = { forceReference: explicitReference !== null, omitReference: referenceHash === null }

  if (preset.kind === 'nai') {
    const job = await buildChatGenerationPresetJob(preset, { prompt: fullPrompt }, referenceSource, options)
    if (job.service_type !== 'novelai') throw new Error('NAI 프리셋 설정을 찾을 수 없어.')
    await executeNaiModule(context, node, moduleDefinition, job.request_payload)
  } else {
    const config = preset.comfyui
    if (!config) throw new Error('ComfyUI 프리셋 설정을 찾을 수 없어.')
    const { workflow, problem } = resolvePresetWorkflow(config)
    if (!workflow) throw new Error(problem ?? '워크플로를 찾을 수 없어.')
    const markedFields = parseMcpMarkedFields(workflow)
    const promptField = comfyAssetFields(config, markedFields).promptField
    if (!promptField) throw new Error('프롬프트를 넣을 텍스트 필드를 생성 프리셋에서 골라줘.')
    const job = await buildChatGenerationPresetJob(preset, {}, referenceSource, options)
    if (job.service_type !== 'comfyui') throw new Error('ComfyUI 프리셋 설정을 찾을 수 없어.')
    // The prompt follows the field's fixed text, whether the field is exposed to chat models or fixed.
    job.inputs[promptField] = [String(config.fixedInputs[promptField] ?? ''), fullPrompt].filter(Boolean).join(', ')
    // A run makes a new picture: every seed is drawn again (NAI already randomizes its omitted seed).
    for (const field of markedFields) {
      if (field.type === 'number' && SEED_FIELD.test(field.jsonPath)) job.inputs[field.id] = crypto.randomInt(1, 4294967288)
    }
    await runComfyPresetJob(context, node, moduleDefinition, job, workflow, markedFields)
  }

  const metadata = context.artifactsByNode.get(node.id)?.metadata
  if (metadata && metadata.value && typeof metadata.value === 'object' && !Array.isArray(metadata.value)) {
    metadata.value = { ...metadata.value, chat_preset: { id: preset.id, name: preset.name, kind: preset.kind }, profile_id: profile?.id ?? null, reference_hash: referenceHash }
  }
}

type SearchBook = { id: number; name: string; entries: ChatLoreEntry[] }

/**
 * The books a search reads, in order: the chosen book, then the character's. Global books always; an account book
 * only when the run's account owns it. A chosen book of another account is an error; one that a shared character
 * links is skipped, as the chat does.
 */
function searchBooks(context: ExecutionContext, lorebookId: number | null, profile: ChatProfile | null): SearchBook[] {
  const owner = runFileOwner(context)
  const books: SearchBook[] = []
  const seen = new Set<number>()
  const readable = (bookId: number) => {
    const book = ChatLorebookStore.find(bookId)
    if (!book) return { book: null, found: false }
    if (book.kind === 'global') return { book, found: true }
    return { book: owner ? OwnedLorebookStore.find(bookId, owner) : null, found: true }
  }
  const add = (book: SearchBook) => {
    if (seen.has(book.id)) return
    seen.add(book.id)
    books.push(book)
  }
  if (lorebookId !== null) {
    const { book, found } = readable(lorebookId)
    if (!found) throw new Error(`로어북을 찾을 수 없어: ${lorebookId}`)
    if (!book) throw new Error('실행한 계정의 로어북이 아니라서 쓸 수 없어.')
    add(book)
  }
  for (const bookId of profile?.lorebookIds ?? []) {
    const { book } = readable(bookId)
    if (book) add(book)
  }
  return books
}

/** Find the lorebook entries whose keywords this text names. */
export async function executeSearchLorebookNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const text = optionalText(resolvedInputs.text)
  const lorebookId = parsePositiveIntegerish(resolvedInputs.lorebook_id)
  const hasProfile = resolvedInputs.profile_id !== undefined && resolvedInputs.profile_id !== null && resolvedInputs.profile_id !== ''
  if (lorebookId === null && !hasProfile) throw new Error('로어북이나 캐릭터를 골라줘.')
  const profile = hasProfile ? requireWorkflowProfile(context, resolvedInputs.profile_id) : null
  const requestedMax = Number(resolvedInputs.max_entries)
  const maxEntries = Number.isFinite(requestedMax) && requestedMax >= 1 ? Math.min(Math.trunc(requestedMax), LORE_MAX_ENTRIES_LIMIT) : 5

  const folded = text.toLowerCase()
  const matched = text
    ? searchBooks(context, lorebookId, profile).flatMap((book) => book.entries
      .filter((entry) => entry.enabled && entry.content.trim() && loreEntryMatches(entry, text, folded))
      .map((entry) => ({ book, entry })))
    : []
  // Higher order first, as the chat keeps entries within its budget; book order breaks ties.
  const chosen = matched
    .map((item, index) => ({ ...item, index }))
    .sort((left, right) => right.entry.order - left.entry.order || left.index - right.index)
    .slice(0, maxEntries)
  const render = (content: string) => profile ? fillCharacterPlaceholders(content, profile) : content
  const entries = chosen.map(({ book, entry }) => ({
    book_id: book.id,
    book: book.name,
    entry_id: entry.id,
    title: loreEntryTitle(entry),
    keys: entry.keys,
    content: render(entry.content),
  }))
  const meta = { kind: 'system-search-lorebook', lorebook_id: lorebookId, profile_id: profile?.id ?? null, matched: matched.length }
  completeSystemNode(context, node, moduleDefinition, 'system.search_lorebook', {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', entries.map((entry) => entry.content).join('\n\n'), meta),
    entries: buildRuntimeArtifact(context.executionId, node.id, 'entries', 'json', entries, meta),
  })
}

/**
 * A room the run may write into: the run's account owns it. A run without an account (a schedule) may only while no
 * accounts are configured, when every room belongs to the bootstrap owner.
 */
function requireRunRoom(context: ExecutionContext, value: unknown) {
  const roomId = parsePositiveIntegerish(value)
  if (roomId === null) throw new Error('채팅방을 골라줘.')
  const requester = runRequester(context)
  if (requester === null && hasConfiguredAuth()) {
    throw new Error('채팅방에 올리려면 로그인한 계정으로 직접 실행해줘. 예약 실행은 채팅방에 올릴 수 없어.')
  }
  const thread = CodexChatStore.findThread(roomId, requester)
  if (!thread) throw new Error(`실행한 계정의 채팅방이 아니거나 없는 채팅방이야: ${roomId}`)
  return thread
}

/** Post a text and/or an image into a chat room, as its character or as a note from the room's owner. */
export async function executePostToChatRoomNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const thread = requireRunRoom(context, resolvedInputs.room_id)
  const text = optionalText(resolvedInputs.text)
  const asNote = resolvedInputs.as === 'note'
  const compositeHash = await libraryHashOfImageInput(resolvedInputs.image)
  if (!text && !compositeHash) throw new Error('올릴 내용이나 이미지를 넣어줘.')
  const file = compositeHash ? activeMediaFile(compositeHash) : null
  if (compositeHash && (!STILL_IMAGE_HASH.test(compositeHash) || !file?.mimeType.startsWith('image/'))) {
    throw new Error('이 이미지는 채팅방에 올릴 수 없어.')
  }

  let content = text
  let mediaAttachments: Array<{ compositeHash: string; name: string; mimeType: string | null }> = []
  if (compositeHash && file) {
    if (asNote) {
      // The owner's messages show library media as attachment chips.
      mediaAttachments = [{ compositeHash, name: path.basename(file.path) || compositeHash, mimeType: file.mimeType }]
    } else {
      // A reply shows library media written into its text (see chatMediaLinks).
      const extension = Object.entries(MEDIA_MIME_TYPES).find(([, mimeType]) => mimeType === file.mimeType)?.[0] ?? 'png'
      content = [text, `![](media:${compositeHash}.${extension})`].filter(Boolean).join('\n\n')
    }
  }

  const messageId = CodexChatStore.addMessage({
    thread_id: thread.id,
    role: asNote ? 'user' : 'assistant',
    content,
    tool_calls: [],
    status: 'completed',
    error: null,
    mediaAttachments,
    // Group rooms name who wrote each reply; the room's representative character speaks for the workflow.
    speaker_profile_id: !asNote && thread.kind === 'group' ? thread.profile_id : null,
  })
  // Replies already tell the owner's open chats; a note is written as the owner's own message, which does not.
  if (asNote) {
    publishRuntimeEvent({ name: 'chat.message.created', topic: 'generation-queue', visibility: 'owner', accountId: thread.account_id,
      payload: { threadId: thread.id, messageId, requestedByAccountId: thread.account_id } })
  }

  const message = {
    id: messageId,
    room_id: thread.id,
    role: asNote ? 'user' : 'assistant',
    as: asNote ? 'note' : 'character',
    content,
    composite_hash: compositeHash,
  }
  completeSystemNode(context, node, moduleDefinition, 'system.post_to_chat_room', {
    message: buildRuntimeArtifact(context.executionId, node.id, 'message', 'json', message, { kind: 'system-post-to-chat-room', room_id: thread.id }),
  })
}

/**
 * Post to the board as the run's account, or as a character the account may use. The image goes into the body as a
 * library embed under the text. Schedules post with their run-as account.
 */
export async function executePostToBoardNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const title = optionalText(resolvedInputs.title)
  if (!title) throw new Error('게시물 제목을 넣어줘.')
  const runAs = resolveAutomationRunAs(runRequester(context), ['posts.view', 'posts.write'])
  if (!runAs.ok) throw new Error(runAs.message)
  const profile = parsePositiveIntegerish(resolvedInputs.profile_id) === null ? null : requireWorkflowProfile(context, resolvedInputs.profile_id)
  const compositeHash = await libraryHashOfImageInput(resolvedInputs.image)
  const body = [optionalText(resolvedInputs.text), compositeHash ? `![](media:${compositeHash})` : ''].filter(Boolean).join('\n\n')
  const categoryId = parsePositiveIntegerish(resolvedInputs.category_id)
  const post = PostStore.create(actorFromRequester(runAs.requester, profile?.id ?? null), {
    title,
    body,
    categoryId,
    tags: optionalText(resolvedInputs.tags),
    status: resolvedInputs.status === 'draft' ? 'draft' : 'published',
  }, 'workflow')
  writeExecutionLog({ executionId: context.executionId, nodeId: node.id, eventType: 'node_post_to_board', message: `Post ${post.id} written`, details: { postId: post.id, status: post.status } })
  const output = { id: post.id, title: post.title, status: post.status, author: post.author.name, category_id: post.categoryId }
  completeSystemNode(context, node, moduleDefinition, 'system.post_to_board', {
    post: buildRuntimeArtifact(context.executionId, node.id, 'post', 'json', output, { kind: 'system-post-to-board', post_id: post.id }),
  })
}

/**
 * Wake a chat room: the instruction goes in as the run's account (a thin line in the room, not a user message) and
 * the character answers with the tools its profile grants. "전용 방" keeps one room per node and character.
 */
export async function executeWakeChatRoomNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const operationKey = 'system.wake_chat_room'
  const message = optionalText(resolvedInputs.message)
  if (!message) throw new Error('보낼 지시를 넣어줘.')
  const runAs = resolveAutomationRunAs(runRequester(context), [])
  if (!runAs.ok) {
    throw new Error(runAs.code === 'run_as_missing'
      ? '실행 계정이 없어서 채팅방을 깨울 수 없어. 예약이면 한 번 다시 저장해줘.'
      : runAs.message)
  }
  const requester = runAs.requester

  let threadId: number
  if (resolvedInputs.target === 'room') {
    threadId = requireRunRoom(context, resolvedInputs.room_id).id
  } else {
    const profile = requireWorkflowProfile(context, resolvedInputs.profile_id)
    const room = await ensureAutomationRoom(requester, profile.id, `workflow:${context.workflow.id}:${node.id}`, `${context.workflow.name} · ${profile.name}`)
    threadId = room.id
  }

  const routing = { source: 'workflow' as const, id: context.workflow.id, name: context.workflow.name }
  const chainLimit = resolvedInputs.chain_limit === undefined || resolvedInputs.chain_limit === null || resolvedInputs.chain_limit === ''
    ? null
    : Math.max(0, Math.min(10, Math.floor(Number(resolvedInputs.chain_limit) || 0)))
  const wait = resolvedInputs.wait !== false && resolvedInputs.wait !== 'false'
  writeExecutionLog({ executionId: context.executionId, nodeId: node.id, eventType: 'node_chat_wake_sent', message: `Chat room ${threadId} woken`, details: { operationKey, threadId, wait } })

  let text = ''
  let replies: Array<{ id: number; speaker_profile_id: number | null; content: string; status: string }> = []
  let status: 'ok' | 'skipped' | 'sent' = 'sent'
  if (wait) {
    try {
      const result = await wakeChatRoom({ requester, threadId, instruction: message, routing, chainLimit, signal: context.signal })
      text = wakeReplyText(result)
      replies = result.replies.map((reply) => ({ id: reply.id, speaker_profile_id: reply.speaker_profile_id ?? null, content: reply.content, status: reply.status }))
      status = 'ok'
    } catch (error) {
      // The room was still answering: nothing was sent, the run goes on with empty replies.
      if (!(error instanceof ChatWakeBusyError)) throw error
      writeExecutionLog({ executionId: context.executionId, nodeId: node.id, level: 'warn', eventType: 'node_chat_wake_skipped', message: error.message, details: { operationKey, threadId }, always: true })
      status = 'skipped'
    }
  } else {
    void wakeChatRoom({ requester, threadId, instruction: message, routing, chainLimit }).catch((error: unknown) => {
      console.warn(`[workflow] wake of chat ${threadId} failed:`, error instanceof Error ? error.message : error)
    })
  }

  const meta = { kind: 'system-wake-chat-room', room_id: threadId, status }
  completeSystemNode(context, node, moduleDefinition, operationKey, {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', text, meta),
    replies: buildRuntimeArtifact(context.executionId, node.id, 'replies', 'json', { status, room_id: threadId, replies }, meta),
    room_id: buildRuntimeArtifact(context.executionId, node.id, 'room_id', 'number', threadId, meta),
  })
}
