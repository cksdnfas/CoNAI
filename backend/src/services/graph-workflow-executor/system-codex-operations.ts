import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { resolveUploadsPath } from '../../config/runtimePaths'
import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { type AIMetadata } from '../metadata/types'
import { APIImageProcessor } from '../APIImageProcessor'
import { settingsService } from '../settingsService'
import {
  cleanupCodexImageGenerationWorkDir,
  CODEX_IMAGE_GENERATION_CANCELLED_MESSAGE,
  generateImageWithCodex,
} from '../codexImageGenerationService'
import { saveArtifactBuffer, saveMetadataArtifact } from './artifacts'
import { buildRuntimeArtifact } from './system-module-artifacts'
import {
  bufferToDataUrl,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function clampPositiveInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value)
    return rounded > 0 ? rounded : null
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10)
    return parsed > 0 ? parsed : null
  }

  return null
}

function resolveMimeTypeFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg'
  }
  if (extension === '.webp') {
    return 'image/webp'
  }
  return 'image/png'
}

function buildCodexMetadataPatch(params: {
  prompt: string
  negativePrompt: string | null
  requestedWidth: number | null
  requestedHeight: number | null
}): Partial<AIMetadata> {
  return {
    ai_tool: 'codex',
    model: 'codex.image_gen',
    software: 'OpenAI Codex',
    prompt: params.prompt,
    positive_prompt: params.prompt,
    negative_prompt: params.negativePrompt ?? undefined,
    uc: params.negativePrompt ?? undefined,
    width: params.requestedWidth ?? undefined,
    height: params.requestedHeight ?? undefined,
  }
}

/** Execute one system-native Codex image-generation module and import its result through the CoNAI image pipeline. */
export async function executeCodexImageGenerationNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const prompt = normalizeOptionalString(resolvedInputs.prompt)
  if (!prompt) {
    throw new Error('Codex image generation requires a prompt input')
  }

  const negativePrompt = normalizeOptionalString(resolvedInputs.negative_prompt)
  const requestedWidth = clampPositiveInteger(resolvedInputs.width)
  const requestedHeight = clampPositiveInteger(resolvedInputs.height)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_start',
    message: `System module start: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey: 'system.generate_image_codex',
      requestedWidth,
      requestedHeight,
      hasNegativePrompt: Boolean(negativePrompt),
    },
  })

  let workDir: string | null = null
  let cleanupSucceeded = false

  try {
    const generation = await generateImageWithCodex({
      prompt,
      negativePrompt,
      width: requestedWidth,
      height: requestedHeight,
      contextLabel: `${context.workflow.name} / ${node.label || moduleDefinition.name}`,
      shouldCancel: context.shouldCancel,
    })

    workDir = generation.workDir

    const imageSaveSettings = settingsService.loadSettings().imageSave
    const metadataPatch = buildCodexMetadataPatch({
      prompt,
      negativePrompt,
      requestedWidth,
      requestedHeight,
    })

    const imported = await APIImageProcessor.processGeneratedFile(generation.outputPath, 'codex', {
      format: imageSaveSettings.applyToWorkflowOutputs ? imageSaveSettings.defaultFormat : undefined,
      quality: imageSaveSettings.applyToWorkflowOutputs ? imageSaveSettings.quality : undefined,
      resizeEnabled: imageSaveSettings.applyToWorkflowOutputs ? imageSaveSettings.resizeEnabled : undefined,
      maxWidth: imageSaveSettings.applyToWorkflowOutputs ? imageSaveSettings.maxWidth : undefined,
      maxHeight: imageSaveSettings.applyToWorkflowOutputs ? imageSaveSettings.maxHeight : undefined,
      sourcePathForMetadata: generation.outputPath,
      sourceMimeType: 'image/png',
      originalFileName: path.basename(generation.outputPath),
      metadataPatch,
    })

    const importedAbsolutePath = resolveUploadsPath(imported.originalPath)
    const importedBuffer = await fs.promises.readFile(importedAbsolutePath)
    const importedMimeType = resolveMimeTypeFromPath(importedAbsolutePath)
    const importedImageMetadata = await sharp(importedBuffer).metadata()
    const imageDataUrl = bufferToDataUrl(importedBuffer, importedMimeType)
    const { storagePath, artifactRecordId } = await saveArtifactBuffer(
      context.executionId,
      node.id,
      'image',
      'image',
      importedBuffer,
      {
        mimeType: importedMimeType,
        sourcePathForMetadata: importedAbsolutePath,
        originalFileName: path.basename(importedAbsolutePath),
      },
    )

    const referenceValue = {
      composite_hash: imported.compositeHash,
      original_path: imported.originalPath,
      original_file_path: importedAbsolutePath,
      mime_type: importedMimeType,
      file_size: imported.fileSize,
      width: imported.width || importedImageMetadata.width || 0,
      height: imported.height || importedImageMetadata.height || 0,
      ai_tool: 'codex',
      model: 'codex.image_gen',
      prompt,
      negative_prompt: negativePrompt,
    }

    const metadataValue = {
      ...referenceValue,
      workflow_execution_id: context.executionId,
      node_id: node.id,
      codex_session_id: generation.sessionId,
      codex_work_dir: generation.workDir,
      metadata_patch_applied: true,
      imported_storage_path: storagePath,
      image_artifact_id: artifactRecordId,
    }

    const nodeArtifacts = {
      image: {
        type: 'image' as const,
        value: imageDataUrl,
        storagePath,
        artifactRecordId,
        metadata: {
          kind: 'system-codex-image',
          composite_hash: imported.compositeHash,
          codex_session_id: generation.sessionId,
        },
      },
      image_ref: buildRuntimeArtifact(context.executionId, node.id, 'image_ref', 'json', referenceValue, {
        kind: 'system-codex-image-reference',
        composite_hash: imported.compositeHash,
      }),
      metadata: buildRuntimeArtifact(context.executionId, node.id, 'metadata', 'json', metadataValue, {
        kind: 'system-codex-image-metadata',
        composite_hash: imported.compositeHash,
      }),
    }

    saveMetadataArtifact(context.executionId, node.id, metadataValue)
    context.artifactsByNode.set(node.id, nodeArtifacts)

    cleanupSucceeded = true

    writeExecutionLog({
      executionId: context.executionId,
      nodeId: node.id,
      eventType: 'node_engine_complete',
      message: `System module completed: ${moduleDefinition.name}`,
      details: {
        engine: 'system',
        operationKey: 'system.generate_image_codex',
        compositeHash: imported.compositeHash,
        codexSessionId: generation.sessionId,
        importedOriginalPath: imported.originalPath,
        storagePath,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === CODEX_IMAGE_GENERATION_CANCELLED_MESSAGE) {
      throw new Error('__GRAPH_EXECUTION_CANCELLED__')
    }
    throw error
  } finally {
    if (workDir && cleanupSucceeded) {
      try {
        await cleanupCodexImageGenerationWorkDir(workDir)
      } catch (cleanupError) {
        writeExecutionLog({
          executionId: context.executionId,
          nodeId: node.id,
          level: 'warn',
          eventType: 'node_cleanup_warn',
          message: `Codex temp cleanup failed for ${moduleDefinition.name}`,
          details: {
            workDir,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          },
        })
      }
    }
  }
}
