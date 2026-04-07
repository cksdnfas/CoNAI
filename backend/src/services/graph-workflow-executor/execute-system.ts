import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'
import { db } from '../../database/init'
import { GraphExecutionFinalResultModel } from '../../models/GraphExecutionFinalResult'
import { PromptCollectionModel } from '../../models/PromptCollection'
import { PromptGroupModel } from '../../models/PromptGroup'
import { ImageSimilarityService } from '../imageSimilarity'
import { imageTaggerService } from '../imageTaggerService'
import { kaloscopeTaggerService } from '../kaloscopeTaggerService'
import { settingsService } from '../settingsService'
import { SIMILARITY_THRESHOLDS } from '../../types/similarity'
import { type GraphWorkflowNode } from '../../types/moduleGraph'
import {
  normalizeBase64ImageData,
  sanitizeFileSegment,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'
import { saveArtifactBuffer } from './artifacts'
import { buildRuntimeArtifact } from './system-module-artifacts'
import {
  executeLoadImageFromReference,
  executeLoadPromptFromReference,
  executeRandomImageFromLibrary,
} from './system-reference-operations'

type PromptCollectionType = 'positive' | 'negative' | 'auto'

type PromptRecord = {
  id: number
  prompt: string
  usage_count: number
  group_id: number | null
  synonyms?: string[]
}

type SimilarImageCandidate = {
  composite_hash: string
  perceptual_hash: string
  thumbnail_path: string | null
  prompt: string | null
  negative_prompt: string | null
  auto_tags: string | null
  first_seen_date: string
  original_file_path: string | null
  file_size: number | null
  mime_type: string | null
}


/** Normalize prompt collection type inputs. */
function normalizePromptCollectionType(value: unknown): PromptCollectionType {
  if (typeof value !== 'string') {
    return 'positive'
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'negative' || normalized === 'auto') {
    return normalized
  }

  return 'positive'
}

/** Normalize boolean-ish workflow inputs. */
function normalizeBooleanInput(value: unknown, fallback = false) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }

  return fallback
}

/** Normalize number-ish workflow inputs. */
function normalizeNumberInput(value: unknown, fallback: number) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

/** Normalize a required string-ish constant-node input. */
function normalizeRequiredStringInput(value: unknown, label: string) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  throw new Error(`${label} requires a non-empty string input`)
}

/** Normalize a JSON constant-node input from either a parsed value or a JSON string. */
function normalizeJsonConstantInput(value: unknown) {
  if (typeof value === 'string') {
    const trimmedValue = value.trim()
    if (trimmedValue.length === 0) {
      throw new Error('Constant JSON requires one JSON value')
    }

    try {
      return JSON.parse(trimmedValue)
    } catch {
      throw new Error('Constant JSON requires valid JSON text')
    }
  }

  if (value === undefined) {
    throw new Error('Constant JSON requires one JSON value')
  }

  return value
}

/** Normalize a number constant-node input. */
function normalizeRequiredNumberInput(value: unknown, label: string) {
  const numericValue = Number(value)
  if (Number.isFinite(numericValue)) {
    return numericValue
  }

  throw new Error(`${label} requires a valid number input`)
}

/** Normalize a boolean constant-node input. */
function normalizeRequiredBooleanInput(value: unknown, label: string) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }

  throw new Error(`${label} requires a boolean input`)
}

/** Execute a constant text or prompt system node. */
function executeConstantStringNode(params: {
  context: ExecutionContext
  node: GraphWorkflowNode
  moduleDefinition: ParsedModuleDefinition
  resolvedInputs: Record<string, any>
  operationKey: 'system.constant_text' | 'system.constant_prompt'
  inputKey: 'text' | 'prompt'
  artifactType: 'text' | 'prompt'
}) {
  const value = normalizeRequiredStringInput(params.resolvedInputs[params.inputKey], params.moduleDefinition.name)
  const nodeArtifacts = {
    [params.inputKey]: buildRuntimeArtifact(
      params.context.executionId,
      params.node.id,
      params.inputKey,
      params.artifactType,
      value,
      {
        kind: 'system-constant-input',
        operationKey: params.operationKey,
      },
    ),
  }

  params.context.artifactsByNode.set(params.node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: params.context.executionId,
    nodeId: params.node.id,
    eventType: 'node_engine_complete',
    message: `System module completed: ${params.moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey: params.operationKey,
      outputKeys: Object.keys(nodeArtifacts),
    },
  })
}

/** Execute a constant JSON system node. */
function executeConstantJsonNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const jsonValue = normalizeJsonConstantInput(resolvedInputs.json)
  const nodeArtifacts = {
    json: buildRuntimeArtifact(context.executionId, node.id, 'json', 'json', jsonValue, {
      kind: 'system-constant-input',
      operationKey: 'system.constant_json',
    }),
  }

  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `System module completed: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey: 'system.constant_json',
      outputKeys: Object.keys(nodeArtifacts),
    },
  })
}

/** Execute a constant image system node. */
function executeConstantNumberNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const numberValue = normalizeRequiredNumberInput(resolvedInputs.number, moduleDefinition.name)
  const nodeArtifacts = {
    number: buildRuntimeArtifact(context.executionId, node.id, 'number', 'number', numberValue, {
      kind: 'system-constant-input',
      operationKey: 'system.constant_number',
    }),
  }

  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `System module completed: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey: 'system.constant_number',
      outputKeys: Object.keys(nodeArtifacts),
    },
  })
}

/** Execute a constant boolean system node. */
function executeConstantBooleanNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const booleanValue = normalizeRequiredBooleanInput(resolvedInputs.boolean, moduleDefinition.name)
  const nodeArtifacts = {
    boolean: buildRuntimeArtifact(context.executionId, node.id, 'boolean', 'boolean', booleanValue, {
      kind: 'system-constant-input',
      operationKey: 'system.constant_boolean',
    }),
  }

  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `System module completed: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey: 'system.constant_boolean',
      outputKeys: Object.keys(nodeArtifacts),
    },
  })
}

/** Execute a constant image system node. */
async function executeConstantImageNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const imageValue = resolvedInputs.image
  if (typeof imageValue !== 'string' || !imageValue.startsWith('data:image/')) {
    throw new Error('Constant Image requires one image input')
  }

  const base64 = normalizeBase64ImageData(imageValue)
  if (!base64) {
    throw new Error('Constant Image requires a valid image data URL input')
  }

  const mimeType = imageValue.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)?.[1] ?? 'image/png'
  const { storagePath, artifactRecordId } = await saveArtifactBuffer(
    context.executionId,
    node.id,
    'image',
    'image',
    Buffer.from(base64, 'base64'),
    { mimeType },
  )

  const nodeArtifacts = {
    image: {
      type: 'image' as const,
      value: imageValue,
      storagePath,
      artifactRecordId,
      metadata: {
        kind: 'system-constant-input',
        operationKey: 'system.constant_image',
      },
    },
  }

  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `System module completed: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey: 'system.constant_image',
      outputKeys: Object.keys(nodeArtifacts),
    },
  })
}

/** Resolve one prompt group by explicit id or exact group name. */
function resolvePromptGroup(groupIdValue: unknown, groupNameValue: unknown, type: PromptCollectionType) {
  const explicitGroupId = Number(groupIdValue)
  if (Number.isFinite(explicitGroupId) && explicitGroupId > 0) {
    return PromptGroupModel.findById(explicitGroupId, type)
  }

  if (typeof groupNameValue === 'string' && groupNameValue.trim()) {
    return PromptGroupModel.findByName(groupNameValue.trim(), type)
  }

  return null
}

/** Deterministically map an integer seed into an item index. */
function pickSeededIndex(length: number, seedValue: unknown) {
  if (!Number.isFinite(length) || length <= 0) {
    return 0
  }

  const numericSeed = Number(seedValue)
  if (!Number.isFinite(numericSeed)) {
    return Math.floor(Math.random() * length)
  }

  const normalizedSeed = Math.abs(Math.trunc(numericSeed))
  return normalizedSeed % length
}

/** Resolve a file extension from a data URL mime type. */
function getImageExtensionFromDataUrl(dataUrl: string) {
  const mimeType = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)?.[1] ?? 'image/png'

  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  return '.png'
}

/** Materialize one graph image input into a temp file so existing hash logic can reuse it. */
async function writeTempImageInput(executionId: number, nodeId: string, dataUrl: string) {
  const base64 = normalizeBase64ImageData(dataUrl)
  if (!base64) {
    throw new Error('Find Similar Images requires a valid image data URL input')
  }

  const executionDir = path.join(runtimePaths.tempDir, 'graph-executions', String(executionId), 'system-inputs')
  await fs.promises.mkdir(executionDir, { recursive: true })

  const filePath = path.join(
    executionDir,
    `${sanitizeFileSegment(nodeId)}_${Date.now()}${getImageExtensionFromDataUrl(dataUrl)}`,
  )

  await fs.promises.writeFile(filePath, Buffer.from(base64, 'base64'))
  return filePath
}

/** Load distinct active-library candidates that can participate in similarity search. */
function listSimilarImageCandidates(): SimilarImageCandidate[] {
  return db.prepare(`
    SELECT
      mm.composite_hash,
      mm.perceptual_hash,
      mm.thumbnail_path,
      mm.prompt,
      mm.negative_prompt,
      mm.auto_tags,
      mm.first_seen_date,
      if.original_file_path,
      if.file_size,
      if.mime_type
    FROM media_metadata mm
    INNER JOIN image_files if
      ON if.composite_hash = mm.composite_hash
     AND if.file_status = 'active'
    WHERE mm.perceptual_hash IS NOT NULL
    GROUP BY mm.composite_hash
  `).all() as SimilarImageCandidate[]
}

/** Execute the built-in random prompt from group system module. */
async function executeRandomPromptFromGroup(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const promptType = normalizePromptCollectionType(resolvedInputs.type)
  const promptGroup = resolvePromptGroup(resolvedInputs.group_id, resolvedInputs.group_name, promptType)

  if (!promptGroup) {
    throw new Error('Random Prompt From Group requires a valid group_id or group_name')
  }

  const promptItems = PromptCollectionModel.getPromptsByGroupId(promptGroup.id, promptType) as PromptRecord[]

  if (!Array.isArray(promptItems) || promptItems.length === 0) {
    throw new Error(`Prompt group is empty: ${promptGroup.group_name}`)
  }

  const selectedIndex = pickSeededIndex(promptItems.length, resolvedInputs.seed)
  const selectedPrompt = promptItems[selectedIndex]
  const entryJsonValue = {
    id: selectedPrompt.id,
    prompt: selectedPrompt.prompt,
    usage_count: selectedPrompt.usage_count,
    group_id: selectedPrompt.group_id,
    group_name: promptGroup.group_name,
    type: promptType,
    selected_index: selectedIndex,
    total_candidates: promptItems.length,
    synonyms: selectedPrompt.synonyms ?? [],
  }

  const nodeArtifacts = {
    prompt: buildRuntimeArtifact(context.executionId, node.id, 'prompt', 'prompt', selectedPrompt.prompt, {
      kind: 'system-random-prompt',
      group_name: promptGroup.group_name,
      type: promptType,
    }),
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', selectedPrompt.prompt, {
      kind: 'system-random-prompt',
      group_name: promptGroup.group_name,
      type: promptType,
    }),
    entry_json: buildRuntimeArtifact(context.executionId, node.id, 'entry_json', 'json', entryJsonValue, {
      kind: 'system-random-prompt-entry',
      group_name: promptGroup.group_name,
      type: promptType,
    }),
  }

  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `System module completed: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey: 'system.random_prompt_from_group',
      selectedPromptId: selectedPrompt.id,
      groupName: promptGroup.group_name,
      type: promptType,
    },
  })
}

/** Execute the built-in image similarity search against an input image. */
async function executeFindSimilarImages(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  if (typeof resolvedInputs.image !== 'string' || !resolvedInputs.image.startsWith('data:image/')) {
    throw new Error('Find Similar Images requires an image input')
  }

  const limit = Math.max(1, Math.min(100, Math.trunc(normalizeNumberInput(resolvedInputs.limit, 12))))
  const threshold = Math.max(0, Math.min(64, Math.trunc(normalizeNumberInput(resolvedInputs.threshold, SIMILARITY_THRESHOLDS.SIMILAR))))
  const includePrompt = normalizeBooleanInput(resolvedInputs.include_prompt, true)
  const tempFilePath = await writeTempImageInput(context.executionId, node.id, resolvedInputs.image)

  try {
    const { compositeHash, perceptualHash, dHash, aHash } = await ImageSimilarityService.generateCompositeHash(tempFilePath)
    const matchedItems = listSimilarImageCandidates()
      .map((candidate) => {
        const hammingDistance = ImageSimilarityService.calculateHammingDistance(perceptualHash, candidate.perceptual_hash)
        const similarity = ImageSimilarityService.hammingDistanceToSimilarity(hammingDistance)
        const matchType = ImageSimilarityService.determineMatchType(hammingDistance)

        return {
          composite_hash: candidate.composite_hash,
          similarity,
          hamming_distance: hammingDistance,
          match_type: matchType,
          original_file_path: candidate.original_file_path,
          thumbnail_path: candidate.thumbnail_path,
          file_size: candidate.file_size,
          mime_type: candidate.mime_type,
          first_seen_date: candidate.first_seen_date,
          prompt: includePrompt ? candidate.prompt : undefined,
          negative_prompt: includePrompt ? candidate.negative_prompt : undefined,
          auto_tags: includePrompt ? candidate.auto_tags : undefined,
        }
      })
      .filter((item) => item.hamming_distance <= threshold)
      .sort((left, right) => {
        if (left.hamming_distance !== right.hamming_distance) {
          return left.hamming_distance - right.hamming_distance
        }
        return new Date(right.first_seen_date).getTime() - new Date(left.first_seen_date).getTime()
      })

    const matchesValue = {
      target: {
        composite_hash: compositeHash,
        perceptual_hash: perceptualHash,
        dhash: dHash,
        ahash: aHash,
      },
      query: {
        threshold,
        limit,
        include_prompt: includePrompt,
      },
      total_matches: matchedItems.length,
      items: matchedItems.slice(0, limit),
    }

    const nodeArtifacts = {
      matches: buildRuntimeArtifact(context.executionId, node.id, 'matches', 'json', matchesValue, {
        kind: 'system-find-similar-images',
        threshold,
        limit,
      }),
    }

    context.artifactsByNode.set(node.id, nodeArtifacts)

    writeExecutionLog({
      executionId: context.executionId,
      nodeId: node.id,
      eventType: 'node_engine_complete',
      message: `System module completed: ${moduleDefinition.name}`,
      details: {
        engine: 'system',
        operationKey: 'system.find_similar_images',
        threshold,
        limit,
        totalMatches: matchedItems.length,
      },
    })
  } finally {
    await fs.promises.unlink(tempFilePath).catch(() => undefined)
  }
}

/** Extract prompt-friendly tags from one input image using the configured WD tagger. */
async function executeExtractTagsFromImage(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  if (typeof resolvedInputs.image !== 'string' || !resolvedInputs.image.startsWith('data:image/')) {
    throw new Error('Extract Tags From Image requires an image input')
  }

  const settings = settingsService.loadSettings()
  if (!settings.tagger.enabled) {
    throw new Error('Extract Tags From Image requires the tagger feature to be enabled')
  }

  const tempFilePath = await writeTempImageInput(context.executionId, node.id, resolvedInputs.image)

  try {
    const taggerResult = await imageTaggerService.tagImage(tempFilePath)
    if (!taggerResult.success) {
      throw new Error(taggerResult.error || 'Tagger extraction failed')
    }

    const tagsText = typeof taggerResult.taglist === 'string' && taggerResult.taglist.trim()
      ? taggerResult.taglist.trim()
      : typeof taggerResult.caption === 'string' && taggerResult.caption.trim()
        ? taggerResult.caption.trim()
        : Object.keys(taggerResult.general || {}).join(', ')

    if (!tagsText) {
      throw new Error('Tagger returned no usable tags')
    }

    const tagsJsonValue = {
      caption: taggerResult.caption || '',
      taglist: taggerResult.taglist || '',
      general: taggerResult.general || {},
      character: taggerResult.character || {},
      rating: taggerResult.rating || {},
      model: taggerResult.model || settings.tagger.model,
      thresholds: taggerResult.thresholds || {
        general: settings.tagger.generalThreshold,
        character: settings.tagger.characterThreshold,
      },
    }

    const nodeArtifacts = {
      tags_text: buildRuntimeArtifact(context.executionId, node.id, 'tags_text', 'text', tagsText, {
        kind: 'system-extract-tags',
      }),
      tags_prompt: buildRuntimeArtifact(context.executionId, node.id, 'tags_prompt', 'prompt', tagsText, {
        kind: 'system-extract-tags',
      }),
      tags_json: buildRuntimeArtifact(context.executionId, node.id, 'tags_json', 'json', tagsJsonValue, {
        kind: 'system-extract-tags-json',
      }),
    }

    context.artifactsByNode.set(node.id, nodeArtifacts)

    writeExecutionLog({
      executionId: context.executionId,
      nodeId: node.id,
      eventType: 'node_engine_complete',
      message: `System module completed: ${moduleDefinition.name}`,
      details: {
        engine: 'system',
        operationKey: 'system.extract_tags_from_image',
        tagCount: tagsText.split(',').map((tag) => tag.trim()).filter(Boolean).length,
      },
    })
  } finally {
    await fs.promises.unlink(tempFilePath).catch(() => undefined)
  }
}

/** Extract artist/style hints from one input image using the configured Kaloscope tagger. */
async function executeExtractArtistFromImage(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  if (typeof resolvedInputs.image !== 'string' || !resolvedInputs.image.startsWith('data:image/')) {
    throw new Error('Extract Artist From Image requires an image input')
  }

  const settings = settingsService.loadSettings()
  if (!settings.kaloscope.enabled) {
    throw new Error('Extract Artist From Image requires the kaloscope feature to be enabled')
  }

  const tempFilePath = await writeTempImageInput(context.executionId, node.id, resolvedInputs.image)

  try {
    const kaloscopeResult = await kaloscopeTaggerService.tagImage(tempFilePath)
    if (!kaloscopeResult.success) {
      throw new Error(kaloscopeResult.error || 'Kaloscope extraction failed')
    }

    const artistText = typeof kaloscopeResult.taglist === 'string' && kaloscopeResult.taglist.trim()
      ? kaloscopeResult.taglist.trim()
      : Object.keys(kaloscopeResult.artists || {}).join(', ')

    if (!artistText) {
      throw new Error('Kaloscope returned no usable artist/style hints')
    }

    const artistJsonValue = {
      artists: kaloscopeResult.artists || {},
      taglist: kaloscopeResult.taglist || '',
      model: kaloscopeResult.model || 'kaloscope-onnx',
      topk: kaloscopeResult.topk || settings.kaloscope.topK,
      tagged_at: kaloscopeResult.tagged_at || new Date().toISOString(),
    }

    const nodeArtifacts = {
      artist_text: buildRuntimeArtifact(context.executionId, node.id, 'artist_text', 'text', artistText, {
        kind: 'system-extract-artist',
      }),
      artist_prompt: buildRuntimeArtifact(context.executionId, node.id, 'artist_prompt', 'prompt', artistText, {
        kind: 'system-extract-artist',
      }),
      artist_json: buildRuntimeArtifact(context.executionId, node.id, 'artist_json', 'json', artistJsonValue, {
        kind: 'system-extract-artist-json',
      }),
    }

    context.artifactsByNode.set(node.id, nodeArtifacts)

    writeExecutionLog({
      executionId: context.executionId,
      nodeId: node.id,
      eventType: 'node_engine_complete',
      message: `System module completed: ${moduleDefinition.name}`,
      details: {
        engine: 'system',
        operationKey: 'system.extract_artist_from_image',
        artistCount: Object.keys(kaloscopeResult.artists || {}).length,
      },
    })
  } finally {
    await fs.promises.unlink(tempFilePath).catch(() => undefined)
  }
}

/** Register one upstream artifact as an explicit workflow final result without duplicating payload storage. */
async function executeFinalResultNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
) {
  const incomingEdges = context.workflow.graph.edges.filter((edge) => edge.target_node_id === node.id && edge.target_port_key === 'value')

  if (incomingEdges.length === 0) {
    throw new Error('Final Result requires one connected upstream artifact on port value')
  }

  if (incomingEdges.length > 1) {
    throw new Error('Final Result supports exactly one upstream artifact on port value')
  }

  const sourceEdge = incomingEdges[0]
  const sourceArtifact = context.artifactsByNode.get(sourceEdge.source_node_id)?.[sourceEdge.source_port_key]
  if (!sourceArtifact?.artifactRecordId) {
    throw new Error('Final Result requires one persisted upstream artifact reference')
  }

  GraphExecutionFinalResultModel.create({
    execution_id: context.executionId,
    final_node_id: node.id,
    source_artifact_id: sourceArtifact.artifactRecordId,
    source_node_id: sourceEdge.source_node_id,
    source_port_key: sourceEdge.source_port_key,
    artifact_type: sourceArtifact.type,
  })

  context.artifactsByNode.set(node.id, {})

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `System module completed: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey: 'system.final_result',
      sourceNodeId: sourceEdge.source_node_id,
      sourcePortKey: sourceEdge.source_port_key,
      sourceArtifactId: sourceArtifact.artifactRecordId,
      artifactType: sourceArtifact.type,
    },
  })
}

/** Execute a CoNAI system-native module node through a stable operation key. */
export async function executeSystemModule(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const operationKey =
    typeof moduleDefinition.template_defaults?.operation_key === 'string'
      ? moduleDefinition.template_defaults.operation_key
      : typeof moduleDefinition.internal_fixed_values?.operation_key === 'string'
        ? moduleDefinition.internal_fixed_values.operation_key
        : null

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_start',
    message: `System module start: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey,
      inputKeys: Object.keys(resolvedInputs),
    },
  })

  if (!operationKey) {
    throw new Error(`System module ${moduleDefinition.name} is missing operation_key`)
  }

  if (operationKey === 'system.constant_text') {
    executeConstantStringNode({
      context,
      node,
      moduleDefinition,
      resolvedInputs,
      operationKey,
      inputKey: 'text',
      artifactType: 'text',
    })
    return
  }

  if (operationKey === 'system.constant_prompt') {
    executeConstantStringNode({
      context,
      node,
      moduleDefinition,
      resolvedInputs,
      operationKey,
      inputKey: 'prompt',
      artifactType: 'prompt',
    })
    return
  }

  if (operationKey === 'system.constant_json') {
    executeConstantJsonNode(context, node, moduleDefinition, resolvedInputs)
    return
  }

  if (operationKey === 'system.constant_image') {
    await executeConstantImageNode(context, node, moduleDefinition, resolvedInputs)
    return
  }

  if (operationKey === 'system.constant_number') {
    executeConstantNumberNode(context, node, moduleDefinition, resolvedInputs)
    return
  }

  if (operationKey === 'system.constant_boolean') {
    executeConstantBooleanNode(context, node, moduleDefinition, resolvedInputs)
    return
  }

  if (operationKey === 'system.random_prompt_from_group') {
    await executeRandomPromptFromGroup(context, node, moduleDefinition, resolvedInputs)
    return
  }

  if (operationKey === 'system.find_similar_images') {
    await executeFindSimilarImages(context, node, moduleDefinition, resolvedInputs)
    return
  }

  if (operationKey === 'system.load_prompt_from_reference') {
    await executeLoadPromptFromReference(context, node, moduleDefinition, resolvedInputs)
    return
  }

  if (operationKey === 'system.load_image_from_reference') {
    await executeLoadImageFromReference(context, node, moduleDefinition, resolvedInputs)
    return
  }

  if (operationKey === 'system.random_image_from_library') {
    await executeRandomImageFromLibrary(context, node, moduleDefinition)
    return
  }

  if (operationKey === 'system.extract_tags_from_image') {
    await executeExtractTagsFromImage(context, node, moduleDefinition, resolvedInputs)
    return
  }

  if (operationKey === 'system.extract_artist_from_image') {
    await executeExtractArtistFromImage(context, node, moduleDefinition, resolvedInputs)
    return
  }

  if (operationKey === 'system.final_result') {
    await executeFinalResultNode(context, node, moduleDefinition)
    return
  }

  throw new Error(`System module operation not implemented yet: ${operationKey}`)
}
