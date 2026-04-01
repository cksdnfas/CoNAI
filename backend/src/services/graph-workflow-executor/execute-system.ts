import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'
import { db } from '../../database/init'
import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import { ImageFileModel } from '../../models/Image/ImageFileModel'
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel'
import { PromptCollectionModel } from '../../models/PromptCollection'
import { PromptGroupModel } from '../../models/PromptGroup'
import { ImageSimilarityService } from '../imageSimilarity'
import { imageTaggerService } from '../imageTaggerService'
import { kaloscopeTaggerService } from '../kaloscopeTaggerService'
import { settingsService } from '../settingsService'
import { saveArtifactBuffer } from './artifacts'
import { SIMILARITY_THRESHOLDS } from '../../types/similarity'
import { type GraphWorkflowNode } from '../../types/moduleGraph'
import {
  bufferToDataUrl,
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

/** Resolve one composite hash from a direct input or a structured reference payload. */
function resolveCompositeHashFromReference(referenceValue: unknown, compositeHashValue: unknown, indexValue: unknown) {
  if (typeof compositeHashValue === 'string' && compositeHashValue.trim()) {
    return compositeHashValue.trim()
  }

  let normalizedReference = referenceValue
  if (typeof normalizedReference === 'string' && normalizedReference.trim()) {
    const trimmed = normalizedReference.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return trimmed
    }

    try {
      normalizedReference = JSON.parse(trimmed)
    } catch {
      throw new Error('Load Prompt From Reference received invalid reference JSON')
    }
  }

  const selectedIndex = Math.max(0, Math.trunc(normalizeNumberInput(indexValue, 0)))

  if (normalizedReference && typeof normalizedReference === 'object' && !Array.isArray(normalizedReference)) {
    const referenceObject = normalizedReference as { composite_hash?: unknown; items?: unknown }
    const directCompositeHash = referenceObject.composite_hash
    if (typeof directCompositeHash === 'string' && directCompositeHash.trim()) {
      return directCompositeHash.trim()
    }

    const itemList = referenceObject.items
    if (Array.isArray(itemList) && itemList.length > 0) {
      const selectedItem = itemList[Math.min(selectedIndex, itemList.length - 1)]
      const itemCompositeHash = selectedItem && typeof selectedItem === 'object'
        ? selectedItem.composite_hash
        : null

      if (typeof itemCompositeHash === 'string' && itemCompositeHash.trim()) {
        return itemCompositeHash.trim()
      }
    }
  }

  if (Array.isArray(normalizedReference) && normalizedReference.length > 0) {
    const selectedItem = normalizedReference[Math.min(selectedIndex, normalizedReference.length - 1)]
    const itemCompositeHash = selectedItem && typeof selectedItem === 'object'
      ? selectedItem.composite_hash
      : null

    if (typeof itemCompositeHash === 'string' && itemCompositeHash.trim()) {
      return itemCompositeHash.trim()
    }
  }

  throw new Error('Load Prompt From Reference requires a reference JSON or composite_hash input')
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

/** Load prompt metadata from one referenced library image. */
async function executeLoadPromptFromReference(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const compositeHash = resolveCompositeHashFromReference(
    resolvedInputs.reference,
    resolvedInputs.composite_hash,
    resolvedInputs.index,
  )
  const metadata = MediaMetadataModel.findByHash(compositeHash)

  if (!metadata) {
    throw new Error(`Referenced image metadata not found: ${compositeHash}`)
  }

  const promptText = metadata.prompt?.trim() || metadata.character_prompt_text?.trim() || ''
  if (!promptText) {
    throw new Error(`Referenced image does not have prompt text: ${compositeHash}`)
  }

  const metadataValue = {
    composite_hash: metadata.composite_hash,
    prompt: metadata.prompt,
    negative_prompt: metadata.negative_prompt,
    auto_tags: metadata.auto_tags,
    character_prompt_text: metadata.character_prompt_text,
    model_name: metadata.model_name,
    ai_tool: metadata.ai_tool,
    first_seen_date: metadata.first_seen_date,
    metadata_updated_date: metadata.metadata_updated_date,
  }

  const nodeArtifacts = {
    prompt: buildRuntimeArtifact(context.executionId, node.id, 'prompt', 'prompt', promptText, {
      kind: 'system-load-prompt-from-reference',
      composite_hash: metadata.composite_hash,
    }),
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', promptText, {
      kind: 'system-load-prompt-from-reference',
      composite_hash: metadata.composite_hash,
    }),
    metadata: buildRuntimeArtifact(context.executionId, node.id, 'metadata', 'json', metadataValue, {
      kind: 'system-load-prompt-metadata',
      composite_hash: metadata.composite_hash,
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
      operationKey: 'system.load_prompt_from_reference',
      compositeHash: metadata.composite_hash,
    },
  })
}

/** Load one referenced library image into a graph image artifact. */
async function executeLoadImageFromReference(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const compositeHash = resolveCompositeHashFromReference(
    resolvedInputs.reference,
    resolvedInputs.composite_hash,
    resolvedInputs.index,
  )
  const metadata = MediaMetadataModel.findByHash(compositeHash)
  if (!metadata) {
    throw new Error(`Referenced image metadata not found: ${compositeHash}`)
  }

  const activeFiles = ImageFileModel.findActiveByHash(compositeHash)
  const activeFile = activeFiles[0]
  if (!activeFile) {
    throw new Error(`Referenced image file not found: ${compositeHash}`)
  }

  const imageBuffer = await fs.promises.readFile(activeFile.original_file_path)
  const mimeType = activeFile.mime_type || 'image/png'
  const imageDataUrl = bufferToDataUrl(imageBuffer, mimeType)
  const storagePath = await saveArtifactBuffer(context.executionId, node.id, 'image', 'image', imageBuffer)

  const referenceValue = {
    composite_hash: metadata.composite_hash,
    original_file_path: activeFile.original_file_path,
    mime_type: activeFile.mime_type,
    file_size: activeFile.file_size,
    thumbnail_path: metadata.thumbnail_path,
    prompt: metadata.prompt,
    negative_prompt: metadata.negative_prompt,
    auto_tags: metadata.auto_tags,
  }

  const nodeArtifacts = {
    image: {
      type: 'image' as const,
      value: imageDataUrl,
      storagePath,
      metadata: {
        kind: 'system-load-image-from-reference',
        composite_hash: metadata.composite_hash,
      },
    },
    image_ref: buildRuntimeArtifact(context.executionId, node.id, 'image_ref', 'json', referenceValue, {
      kind: 'system-image-reference',
      composite_hash: metadata.composite_hash,
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
      operationKey: 'system.load_image_from_reference',
      compositeHash: metadata.composite_hash,
      storagePath,
    },
  })
}

/** Load one random library image into a graph image artifact. */
async function executeRandomImageFromLibrary(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
) {
  const metadata = MediaMetadataModel.getRandomImage()
  if (!metadata || typeof metadata.composite_hash !== 'string' || !metadata.composite_hash.trim()) {
    throw new Error('Random Image From Library requires at least one indexed image in the library')
  }

  const activeFiles = ImageFileModel.findActiveByHash(metadata.composite_hash)
  const activeFile = activeFiles[0]
  if (!activeFile) {
    throw new Error(`Random library image file not found: ${metadata.composite_hash}`)
  }

  const imageBuffer = await fs.promises.readFile(activeFile.original_file_path)
  const mimeType = activeFile.mime_type || 'image/png'
  const imageDataUrl = bufferToDataUrl(imageBuffer, mimeType)
  const storagePath = await saveArtifactBuffer(context.executionId, node.id, 'image', 'image', imageBuffer)

  const referenceValue = {
    composite_hash: metadata.composite_hash,
    original_file_path: activeFile.original_file_path,
    mime_type: activeFile.mime_type,
    file_size: activeFile.file_size,
    thumbnail_path: metadata.thumbnail_path,
    prompt: metadata.prompt,
    negative_prompt: metadata.negative_prompt,
    auto_tags: metadata.auto_tags,
    width: metadata.width,
    height: metadata.height,
  }

  const metadataValue = {
    composite_hash: metadata.composite_hash,
    ai_tool: metadata.ai_tool,
    model_name: metadata.model_name,
    width: metadata.width,
    height: metadata.height,
    prompt: metadata.prompt,
    negative_prompt: metadata.negative_prompt,
    auto_tags: metadata.auto_tags,
    first_seen_date: metadata.first_seen_date,
    metadata_updated_date: metadata.metadata_updated_date,
  }

  const nodeArtifacts = {
    image: {
      type: 'image' as const,
      value: imageDataUrl,
      storagePath,
      metadata: {
        kind: 'system-random-image-from-library',
        composite_hash: metadata.composite_hash,
      },
    },
    image_ref: buildRuntimeArtifact(context.executionId, node.id, 'image_ref', 'json', referenceValue, {
      kind: 'system-random-image-reference',
      composite_hash: metadata.composite_hash,
    }),
    metadata: buildRuntimeArtifact(context.executionId, node.id, 'metadata', 'json', metadataValue, {
      kind: 'system-random-image-metadata',
      composite_hash: metadata.composite_hash,
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
      operationKey: 'system.random_image_from_library',
      compositeHash: metadata.composite_hash,
      storagePath,
    },
  })
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

  throw new Error(`System module operation not implemented yet: ${operationKey}`)
}
