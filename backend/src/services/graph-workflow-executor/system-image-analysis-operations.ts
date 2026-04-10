import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'
import { db } from '../../database/init'
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
import { buildRuntimeArtifact } from './system-module-artifacts'

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

/** Execute the built-in image similarity search against an input image. */
export async function executeFindSimilarImages(
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
export async function executeExtractTagsFromImage(
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
export async function executeExtractArtistFromImage(
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
