import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'
import { db } from '../../database/init'
import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import { PromptCollectionModel } from '../../models/PromptCollection'
import { PromptGroupModel } from '../../models/PromptGroup'
import { ImageSimilarityService } from '../imageSimilarity'
import { SIMILARITY_THRESHOLDS } from '../../types/similarity'
import { type GraphWorkflowNode } from '../../types/moduleGraph'
import {
  normalizeBase64ImageData,
  sanitizeFileSegment,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'

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

/** Persist one structured runtime artifact row and keep it available to downstream nodes. */
function buildRuntimeArtifact(executionId: number, nodeId: string, portKey: string, artifactType: 'prompt' | 'text' | 'json', value: unknown, metadata?: Record<string, unknown>): RuntimeArtifact {
  GraphExecutionArtifactModel.create({
    execution_id: executionId,
    node_id: nodeId,
    port_key: portKey,
    artifact_type: artifactType,
    metadata: JSON.stringify({ value, ...(metadata ?? {}) }),
  })

  return {
    type: artifactType,
    value,
    metadata,
  }
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

  if (operationKey === 'system.random_prompt_from_group') {
    await executeRandomPromptFromGroup(context, node, moduleDefinition, resolvedInputs)
    return
  }

  if (operationKey === 'system.find_similar_images') {
    await executeFindSimilarImages(context, node, moduleDefinition, resolvedInputs)
    return
  }

  throw new Error(`System module operation not implemented yet: ${operationKey}`)
}
