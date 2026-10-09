import { type GraphWorkflowNode } from '../../types/moduleGraph'
import {
  APPEARANCE_DRAFT_MAX_LENGTH,
  APPEARANCE_DRAFT_PROMPT,
  appearanceDescriptionOf,
  appearanceGenerationOptions,
  appearanceImageDataUrl,
  appearanceSourceText,
  profileReferenceImageDataUrl,
} from '../codex-chat/chatAppearanceDraft'
import { textTranslationPrompt } from '../codex-chat/chatTranslation'
import { PLAIN_USER, type ChatUserPersona } from '../codex-chat/chatUserProfiles'
import type { ChatCompletionMessage, ChatContentPart } from '../codex-chat/llmChatCompletion'
import {
  appendUserDirective,
  buildLeadingMessages,
  depthBlocks,
  insertDepthBlocks,
  parseExampleDialogue,
  postHistoryText,
  referenceBlock,
  resolveAuthorNote,
  selectChatLore,
} from '../codex-chat/llmChatContext'
import { ModelSlotStore } from '../codex-chat/modelSlots'
import { askJudge, choiceQuestion, resolveJudgeConnection, yesNoQuestion } from '../judge/judgeEngine'
import { parseImageDataUrl } from '../llmProviderService'
import { buildRuntimeArtifact, completeSystemNode } from './system-module-artifacts'
import { normalizeOptionalId, normalizeOptionalNumber, runNodeLlmRequest } from './system-llm-operations'
import { requireWorkflowProfile, runWorkflowLlmText } from './workflow-llm-runtime'
import {
  normalizeOptionalString,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'

/** The language a translation node's choice names for the model; anything else (a connected value) goes as written. */
const TRANSLATION_LANGUAGES: Record<string, string> = {
  '한국어': 'Korean',
  'English': 'English',
  '日本語': 'Japanese',
  '简体中文': 'Simplified Chinese',
}

function logRequestStarted(context: ExecutionContext, node: GraphWorkflowNode, moduleDefinition: ParsedModuleDefinition, operationKey: string, details: Record<string, unknown>) {
  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_progress',
    message: `LLM node request started: ${moduleDefinition.name}`,
    details: { operationKey, ...details },
  })
}

export async function executeTranslateTextNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const operationKey = 'system.translate_text'
  const text = normalizeOptionalString(resolvedInputs.text)
  if (!text) throw new Error('번역할 텍스트가 비어 있어')
  const choice = normalizeOptionalString(resolvedInputs.target_language) ?? '한국어'
  const language = TRANSLATION_LANGUAGES[choice] ?? choice
  const profileId = normalizeOptionalId(resolvedInputs.profile_id)
  const modelSlotId = normalizeOptionalId(resolvedInputs.model_slot_id)
  const requesterAccountId = context.requestedByAccountId ?? null
  const profile = profileId !== null ? requireWorkflowProfile(profileId, requesterAccountId) : null
  logRequestStarted(context, node, moduleDefinition, operationKey, { profileId, modelSlotId, language })

  // Translation runs cool and without thinking, like the chat's.
  const result = await runNodeLlmRequest(context, node, () => runWorkflowLlmText({
    target: { profileId, modelSlotId, role: 'translation', requesterAccountId },
    systemPrompt: textTranslationPrompt(language, { profile, instructions: normalizeOptionalString(resolvedInputs.instructions) }),
    prompt: text,
    generation: () => ({ temperature: 0.2, reasoningEffort: 'none' }),
    task: 'Translate the text.',
    signal: context.signal,
  }))

  completeSystemNode(context, node, moduleDefinition, operationKey, {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', result.text, { kind: 'system-llm-text', operationKey, providerName: result.providerName, model: result.model }),
  })
}

export async function executeJudgeTextNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const operationKey = 'system.judge_text'
  const text = normalizeOptionalString(resolvedInputs.text)
  if (!text) throw new Error('판단할 텍스트가 비어 있어')
  const question = normalizeOptionalString(resolvedInputs.question)
  if (!question) throw new Error('질문이 비어 있어')
  const mode = resolvedInputs.mode === 'choice' ? 'choice' : 'yes_no'
  const choices = mode === 'choice'
    ? [...new Set(String(resolvedInputs.choices ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
    : []
  if (mode === 'choice' && choices.length < 2) throw new Error('선택지를 두 줄 이상 적어줘')
  const threshold = Math.min(1, Math.max(0, normalizeOptionalNumber(resolvedInputs.threshold) ?? 0.5))

  // The judge model: the picked row (LLM or TypeSafe), else the ★ default row.
  const modelSlotId = normalizeOptionalId(resolvedInputs.model_slot_id)
  const row = modelSlotId !== null ? ModelSlotStore.target(modelSlotId) : ModelSlotStore.defaultTarget()
  if (!row) {
    throw new Error(modelSlotId !== null
      ? `모델을 찾을 수 없어 (지워졌을 수 있어): ${modelSlotId}`
      : '기본 모델이 없어. 설정 › LLM에서 ★ 기본 모델을 정하거나 노드에서 모델을 골라줘.')
  }
  const connection = resolveJudgeConnection(row.providerName, row.model)
  logRequestStarted(context, node, moduleDefinition, operationKey, { modelSlotId: row.id, engine: connection.engine, mode })

  const asked = mode === 'choice'
    ? choiceQuestion('answer', question, choices.map((label) => [label, '', false]))
    : yesNoQuestion('answer', question)
  const result = await runNodeLlmRequest(context, node, () => askJudge(connection, { text }, [asked], context.signal, { purpose: 'workflow' }))
  const answer = result.answers.get('answer')
  if (!answer) throw new Error('판단 모델이 답하지 않았어')

  // Yes/no: the probability of yes. Choice: the picked option and how sure the judge is of it.
  const choice = mode === 'choice' ? answer.choice ?? '' : null
  const probability = mode === 'choice' ? (choice ? answer.distribution?.[choice] ?? answer.confidence ?? 0 : 0) : answer.probability
  const yes = probability >= threshold
  const json = {
    mode,
    question,
    yes,
    choice: choice ?? (yes ? 'yes' : 'no'),
    probability,
    threshold,
    distribution: answer.distribution,
    engine: connection.engine,
    provider_name: connection.providerName,
    model: result.model,
    model_slot_id: row.id,
  }
  const meta = { kind: 'system-llm-judge', operationKey, providerName: connection.providerName, model: result.model }

  completeSystemNode(context, node, moduleDefinition, operationKey, {
    yes: buildRuntimeArtifact(context.executionId, node.id, 'yes', 'boolean', yes, meta),
    choice: buildRuntimeArtifact(context.executionId, node.id, 'choice', 'text', json.choice, meta),
    probability: buildRuntimeArtifact(context.executionId, node.id, 'probability', 'number', probability, meta),
    json: buildRuntimeArtifact(context.executionId, node.id, 'json', 'json', json, meta),
  })
}

/**
 * One character turn the way a chat builds it, without a chat: the profile's leading messages (persona, guidance,
 * lore index and "always on" entries), the earlier conversation, keyword lore and the author's note at their depths,
 * then the message with the profile's after-history instructions. `history` written as `사용자:` / `{{char}}:` lines
 * becomes turns; any other text goes in as reference.
 */
export function buildChatProfileReplyMessages(params: {
  profile: ReturnType<typeof requireWorkflowProfile>
  message: string
  history: string | null
  userName: string | null
  useLorebooks: boolean
}): ChatCompletionMessage[] {
  const { profile, message, history } = params
  const user: ChatUserPersona = { ...PLAIN_USER, name: params.userName ?? PLAIN_USER.name }
  const scanned = [...(history ? [{ role: 'user', content: history }] : []), { role: 'user', content: message }]
  const lore = selectChatLore(profile, scanned, user, params.useLorebooks ? {} : { books: [] })
  const leading = buildLeadingMessages(profile, null, { summaryEnabled: false }, false, lore, user)
  const turns = history ? parseExampleDialogue(history, profile, user) : null
  const latest = history && !turns ? `${referenceBlock([`## 앞 대화\n${history}`])}\n\n${message}` : message
  const conversation = insertDepthBlocks([...(turns ?? []), { role: 'user', content: latest }], depthBlocks(lore, profile.loreDepth, resolveAuthorNote(null, profile, user)))
  return appendUserDirective([...leading, ...conversation], postHistoryText(profile, user))
}

export async function executeChatProfileReplyNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const operationKey = 'system.chat_profile_reply'
  const profileId = normalizeOptionalId(resolvedInputs.profile_id)
  if (profileId === null) throw new Error('캐릭터 프로필을 골라줘')
  const message = normalizeOptionalString(resolvedInputs.message)
  if (!message) throw new Error('메시지가 비어 있어')
  const requesterAccountId = context.requestedByAccountId ?? null
  const profile = requireWorkflowProfile(profileId, requesterAccountId)
  const modelSlotId = normalizeOptionalId(resolvedInputs.model_slot_id)
  const messages = buildChatProfileReplyMessages({
    profile,
    message,
    history: normalizeOptionalString(resolvedInputs.history),
    userName: normalizeOptionalString(resolvedInputs.user_name),
    useLorebooks: resolvedInputs.use_lorebooks !== false && resolvedInputs.use_lorebooks !== 'false',
  })
  logRequestStarted(context, node, moduleDefinition, operationKey, { profileId, modelSlotId, messageCount: messages.length })

  const result = await runNodeLlmRequest(context, node, () => runWorkflowLlmText({
    target: { profileId, modelSlotId, requesterAccountId },
    messages,
    task: `Reply as ${profile.name}.`,
    signal: context.signal,
  }))
  const meta = { kind: 'system-llm-text', operationKey, providerName: result.providerName, model: result.model }

  completeSystemNode(context, node, moduleDefinition, operationKey, {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', result.text, meta),
    metadata: buildRuntimeArtifact(context.executionId, node.id, 'metadata', 'json', { ...result.metadata, profile_name: profile.name, message_count: messages.length }, { ...meta, kind: 'system-llm-metadata' }),
  })
}

export async function executeDraftAppearanceTagsNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const operationKey = 'system.draft_appearance_tags'
  const profileId = normalizeOptionalId(resolvedInputs.profile_id)
  const modelSlotId = normalizeOptionalId(resolvedInputs.model_slot_id)
  const requesterAccountId = context.requestedByAccountId ?? null
  const profile = profileId !== null ? requireWorkflowProfile(profileId, requesterAccountId) : null

  // The node's own description and image first; the profile fills what is empty (its text sections, its reference).
  const imageValue = normalizeOptionalString(resolvedInputs.image)
  const parsedImage = imageValue ? parseImageDataUrl(imageValue) : null
  if (imageValue && !parsedImage) throw new Error('이미지를 읽을 수 없어')
  const description = normalizeOptionalString(resolvedInputs.description) ?? (profile ? appearanceDescriptionOf(profile).trim() : '')
  const image = parsedImage
    ? await appearanceImageDataUrl(Buffer.from(parsedImage.base64, 'base64'))
    : profile ? await profileReferenceImageDataUrl(profile) : null
  if (!image && !description) throw new Error('설명이나 이미지를 넣어줘')
  logRequestStarted(context, node, moduleDefinition, operationKey, { profileId, modelSlotId, hasImage: Boolean(image), descriptionLength: description.length })

  const content: ChatContentPart[] = [{ type: 'text', text: appearanceSourceText(profile?.name ?? null, description) }]
  if (image) content.push({ type: 'image_url', image_url: { url: image } })
  const result = await runNodeLlmRequest(context, node, () => runWorkflowLlmText({
    target: { profileId, modelSlotId, role: 'summary', requesterAccountId },
    messages: [
      { role: 'system', content: APPEARANCE_DRAFT_PROMPT },
      { role: 'user', content },
    ],
    generation: ({ profileGeneration, thinkingSwitch }) => appearanceGenerationOptions(profileGeneration, thinkingSwitch),
    task: 'Describe the character\'s appearance as tags.',
    signal: context.signal,
  }))
  if (result.text.length > APPEARANCE_DRAFT_MAX_LENGTH) throw new Error('외형 태그 결과가 너무 길어')

  completeSystemNode(context, node, moduleDefinition, operationKey, {
    tags: buildRuntimeArtifact(context.executionId, node.id, 'tags', 'prompt', result.text, { kind: 'system-llm-text', operationKey, providerName: result.providerName, model: result.model }),
  })
}
