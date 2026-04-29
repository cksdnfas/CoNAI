import fs from 'fs'
import path from 'path'
import { APIImageProcessor } from './APIImageProcessor'
import { COMFYUI_EXECUTION_CANCELLED_MESSAGE, ComfyUIService } from './comfyuiService'
import { moveFileIntoWorkflowArtifacts } from './workflowArtifactService'
import type { GeneratedImageSaveOptions } from '../utils/fileSaver'
import type { WorkflowRecord } from '../types/workflow'

export interface ComfyGenerationRepresentativeImage {
  originalPath: string
  fileSize: number
  compositeHash: string
}

export interface ExecuteComfyGenerationInput {
  comfyService: ComfyUIService
  workflow: Record<string, any>
  imageSaveOptions?: GeneratedImageSaveOptions
  artifactWorkflow?: WorkflowRecord | null
  onPromptSubmitted?: (promptId: string) => void | Promise<void>
  shouldCancel?: () => boolean | Promise<boolean>
  onCancelRequested?: (promptId: string) => void | Promise<void>
}

export interface ComfyGenerationSavedArtifact {
  absolutePath: string
  relativePath: string
  directoryRelativePath: string
  size: number
}

export interface ExecuteComfyGenerationResult {
  promptId: string
  attemptedImageCount: number
  savedImageCount: number
  attemptedArtifactCount: number
  savedArtifactCount: number
  savedArtifacts: ComfyGenerationSavedArtifact[]
  representativeImage: ComfyGenerationRepresentativeImage | null
}

export function isComfyGenerationCancelledError(error: unknown) {
  return error instanceof Error && error.message === COMFYUI_EXECUTION_CANCELLED_MESSAGE
}

/** Backfill renamed CoNAI artifact-node inputs so older saved workflows keep running. */
function normalizeCoNaiArtifactFileOutputNodes(workflow: Record<string, any>) {
  for (const node of Object.values(workflow)) {
    if (!node || typeof node !== 'object' || node.class_type !== 'CoNAIArtifactFileOutput') {
      continue
    }

    const inputs = node.inputs
    if (!inputs || typeof inputs !== 'object' || inputs.copy_parent_folder !== undefined) {
      continue
    }

    inputs.copy_parent_folder = inputs.move_parent_folder ?? false
  }

  return workflow
}

/**
 * Submit one ComfyUI workflow, wait for completion, then save downloaded outputs
 * into the main generated-media pipeline.
 */
export async function executeComfyGeneration(
  input: ExecuteComfyGenerationInput,
): Promise<ExecuteComfyGenerationResult> {
  const { comfyService, workflow, imageSaveOptions, artifactWorkflow, onPromptSubmitted, shouldCancel, onCancelRequested } = input
  const normalizedWorkflow = normalizeCoNaiArtifactFileOutputNodes(workflow)

  const promptId = await comfyService.submitPrompt(normalizedWorkflow)
  await onPromptSubmitted?.(promptId)

  if (await shouldCancel?.()) {
    await onCancelRequested?.(promptId)
    throw new Error(COMFYUI_EXECUTION_CANCELLED_MESSAGE)
  }

  const isArtifactWorkflow = artifactWorkflow?.result_view_mode === 'artifact_explorer'
  const collectedOutputs = await comfyService.collectGeneratedOutputs(promptId, {
    shouldCancel,
    onCancelRequested,
    onlyFinalOutput: !isArtifactWorkflow,
  })

  if (await shouldCancel?.()) {
    throw new Error(COMFYUI_EXECUTION_CANCELLED_MESSAGE)
  }

  let savedImageCount = 0
  const savedArtifacts: ComfyGenerationSavedArtifact[] = []
  const artifactRunStartedAt = new Date()
  let representativeImage: ComfyGenerationRepresentativeImage | null = null
  const pendingTempPaths = new Set(collectedOutputs.map((output) => output.tempPath))

  try {
    for (const output of collectedOutputs) {
      if (await shouldCancel?.()) {
        throw new Error(COMFYUI_EXECUTION_CANCELLED_MESSAGE)
      }
      try {
        if (isArtifactWorkflow) {
          const savedArtifact = await moveFileIntoWorkflowArtifacts({
            workflow: artifactWorkflow,
            sourcePath: output.tempPath,
            originalFileName: path.basename(output.filename || output.tempPath),
            originalRelativePath: output.subfolder ? path.join(output.subfolder, output.filename || path.basename(output.tempPath)) : output.filename,
            promptId,
            runStartedAt: artifactRunStartedAt,
          })
          savedArtifacts.push(savedArtifact)
          console.log(`✅ ComfyUI artifact saved: ${savedArtifact.relativePath}`)
        } else {
          const processedPaths = await APIImageProcessor.processGeneratedFile(output.tempPath, 'comfyui', {
            ...imageSaveOptions,
            sourcePathForMetadata: output.tempPath,
            sourceMimeType: output.format,
            originalFileName: path.basename(output.filename || output.tempPath),
          })

          savedImageCount += 1
          if (!representativeImage) {
            representativeImage = {
              originalPath: processedPaths.originalPath,
              fileSize: processedPaths.fileSize,
              compositeHash: processedPaths.compositeHash,
            }
          }

          console.log(`✅ ComfyUI output saved: ${processedPaths.originalPath}`)
        }
      } catch (error) {
        console.error(`❌ Failed to save ComfyUI output ${output.tempPath}:`, error)
      } finally {
        pendingTempPaths.delete(output.tempPath)
        if (!isArtifactWorkflow) {
          try {
            await fs.promises.unlink(output.tempPath)
          } catch (cleanupError) {
            console.warn(`⚠️ Failed to remove temp ComfyUI output ${output.tempPath}:`, cleanupError)
          }
        }
      }
    }
  } finally {
    for (const tempPath of pendingTempPaths) {
      try {
        await fs.promises.unlink(tempPath)
      } catch {
        // Ignore best-effort cleanup for already-removed temp files.
      }
    }
  }

  return {
    promptId,
    attemptedImageCount: isArtifactWorkflow ? 0 : collectedOutputs.length,
    savedImageCount,
    attemptedArtifactCount: isArtifactWorkflow ? collectedOutputs.length : 0,
    savedArtifactCount: savedArtifacts.length,
    savedArtifacts,
    representativeImage,
  }
}
