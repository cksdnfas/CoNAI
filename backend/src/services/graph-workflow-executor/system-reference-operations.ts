import fs from 'fs'
import path from 'path'
import { ImageFileModel } from '../../models/Image/ImageFileModel'
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel'
import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { saveArtifactBuffer } from './artifacts'
import { buildRuntimeArtifact } from './system-module-artifacts'
import {
  bufferToDataUrl,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'

function hasConnectedOutput(context: ExecutionContext, node: GraphWorkflowNode, outputPortKey: string) {
  return context.workflow.graph.edges.some((edge) => edge.source_node_id === node.id && edge.source_port_key === outputPortKey)
}

/** Resolve one composite hash from direct input or a structured reference payload. */
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

  const numericIndex = Number(indexValue)
  const selectedIndex = Number.isFinite(numericIndex) ? Math.max(0, Math.trunc(numericIndex)) : 0

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

/** Load prompt metadata from one referenced library image. */
export async function executeLoadPromptFromReference(
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

  const nodeArtifacts = {
    prompt: buildRuntimeArtifact(context.executionId, node.id, 'prompt', 'prompt', promptText, {
      kind: 'system-load-prompt-from-reference',
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
export async function executeLoadImageFromReference(
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

  const shouldMaterializeImage = hasConnectedOutput(context, node, 'image')
  const mimeType = activeFile.mime_type || 'image/png'
  let storagePath: string | null = null
  let artifactRecordId: number | null = null
  let imageDataUrl: string | null = null

  if (shouldMaterializeImage) {
    const imageBuffer = await fs.promises.readFile(activeFile.original_file_path)
    imageDataUrl = bufferToDataUrl(imageBuffer, mimeType)
    const savedArtifact = await saveArtifactBuffer(context.executionId, node.id, 'image', 'image', imageBuffer, {
      mimeType,
      sourcePathForMetadata: activeFile.original_file_path,
      originalFileName: path.basename(activeFile.original_file_path),
    })
    storagePath = savedArtifact.storagePath
    artifactRecordId = savedArtifact.artifactRecordId
  }

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
    ...(imageDataUrl && storagePath && artifactRecordId ? {
      image: {
        type: 'image' as const,
        value: imageDataUrl,
        storagePath,
        artifactRecordId,
        metadata: {
          kind: 'system-load-image-from-reference',
          composite_hash: metadata.composite_hash,
        },
      },
    } : {}),
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
export async function executeRandomImageFromLibrary(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
) {
  const metadata = MediaMetadataModel.getRandomImage()
  if (!metadata || typeof metadata.composite_hash !== 'string' || !metadata.composite_hash.trim()) {
    throw new Error('Random Image From Library requires at least one indexed image in the library')
  }

  const activeFiles = ImageFileModel.findActiveByHash(metadata.composite_hash)
  const activeFile = activeFiles.find((file) => file.file_type === 'image') ?? activeFiles[0]
  if (!activeFile) {
    throw new Error(`Random library image file not found: ${metadata.composite_hash}`)
  }

  const shouldMaterializeImage = hasConnectedOutput(context, node, 'image')
  const mimeType = activeFile.mime_type || 'image/png'
  let storagePath: string | null = null
  let artifactRecordId: number | null = null
  let imageDataUrl: string | null = null

  if (shouldMaterializeImage) {
    const imageBuffer = await fs.promises.readFile(activeFile.original_file_path)
    imageDataUrl = bufferToDataUrl(imageBuffer, mimeType)
    const savedArtifact = await saveArtifactBuffer(context.executionId, node.id, 'image', 'image', imageBuffer, {
      mimeType,
      sourcePathForMetadata: activeFile.original_file_path,
      originalFileName: path.basename(activeFile.original_file_path),
    })
    storagePath = savedArtifact.storagePath
    artifactRecordId = savedArtifact.artifactRecordId
  }

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
    ...(imageDataUrl && storagePath && artifactRecordId ? {
      image: {
        type: 'image' as const,
        value: imageDataUrl,
        storagePath,
        artifactRecordId,
        metadata: {
          kind: 'system-random-image-from-library',
          composite_hash: metadata.composite_hash,
        },
      },
    } : {}),
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

/** Load one random library video into a graph file artifact. */
export async function executeRandomVideoFromLibrary(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
) {
  const metadata = MediaMetadataModel.getRandomVideo()
  if (!metadata || typeof metadata.composite_hash !== 'string' || !metadata.composite_hash.trim()) {
    throw new Error('Random Video From Library requires at least one indexed video in the library')
  }

  const activeFiles = ImageFileModel.findActiveByHash(metadata.composite_hash)
  const activeFile = activeFiles.find((file) => file.file_type === 'video') ?? activeFiles[0]
  if (!activeFile) {
    throw new Error(`Random library video file not found: ${metadata.composite_hash}`)
  }

  const videoBuffer = await fs.promises.readFile(activeFile.original_file_path)
  const mimeType = activeFile.mime_type || 'video/mp4'
  const videoDataUrl = bufferToDataUrl(videoBuffer, mimeType)
  const { storagePath, artifactRecordId } = await saveArtifactBuffer(context.executionId, node.id, 'video', 'file', videoBuffer, {
    mimeType,
    sourcePathForMetadata: activeFile.original_file_path,
    originalFileName: path.basename(activeFile.original_file_path),
  })

  const referenceValue = {
    composite_hash: metadata.composite_hash,
    original_file_path: activeFile.original_file_path,
    mime_type: activeFile.mime_type,
    file_size: activeFile.file_size,
    thumbnail_path: metadata.thumbnail_path,
    duration: metadata.duration,
    fps: metadata.fps,
    video_codec: metadata.video_codec,
    audio_codec: metadata.audio_codec,
    prompt: metadata.prompt,
    negative_prompt: metadata.negative_prompt,
    auto_tags: metadata.auto_tags,
  }

  const metadataValue = {
    composite_hash: metadata.composite_hash,
    ai_tool: metadata.ai_tool,
    model_name: metadata.model_name,
    width: metadata.width,
    height: metadata.height,
    duration: metadata.duration,
    fps: metadata.fps,
    video_codec: metadata.video_codec,
    audio_codec: metadata.audio_codec,
    prompt: metadata.prompt,
    negative_prompt: metadata.negative_prompt,
    auto_tags: metadata.auto_tags,
    first_seen_date: metadata.first_seen_date,
    metadata_updated_date: metadata.metadata_updated_date,
  }

  const nodeArtifacts = {
    video: {
      type: 'file' as const,
      value: videoDataUrl,
      storagePath,
      artifactRecordId,
      metadata: {
        kind: 'system-random-video-from-library',
        composite_hash: metadata.composite_hash,
        mimeType,
      },
    },
    video_ref: buildRuntimeArtifact(context.executionId, node.id, 'video_ref', 'json', referenceValue, {
      kind: 'system-random-video-reference',
      composite_hash: metadata.composite_hash,
    }),
    metadata: buildRuntimeArtifact(context.executionId, node.id, 'metadata', 'json', metadataValue, {
      kind: 'system-random-video-metadata',
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
      operationKey: 'system.random_video_from_library',
      compositeHash: metadata.composite_hash,
      storagePath,
    },
  })
}
