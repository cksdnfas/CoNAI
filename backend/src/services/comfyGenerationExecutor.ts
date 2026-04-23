import fs from 'fs'
import path from 'path'
import { APIImageProcessor } from './APIImageProcessor'
import { COMFYUI_EXECUTION_CANCELLED_MESSAGE, ComfyUIService } from './comfyuiService'
import type { GeneratedImageSaveOptions } from '../utils/fileSaver'

export interface ComfyGenerationRepresentativeImage {
  originalPath: string
  fileSize: number
  compositeHash: string
}

export interface ExecuteComfyGenerationInput {
  comfyService: ComfyUIService
  workflow: Record<string, any>
  imageSaveOptions?: GeneratedImageSaveOptions
  onPromptSubmitted?: (promptId: string) => void | Promise<void>
  shouldCancel?: () => boolean | Promise<boolean>
  onCancelRequested?: (promptId: string) => void | Promise<void>
}

export interface ExecuteComfyGenerationResult {
  promptId: string
  attemptedImageCount: number
  savedImageCount: number
  representativeImage: ComfyGenerationRepresentativeImage | null
}

export function isComfyGenerationCancelledError(error: unknown) {
  return error instanceof Error && error.message === COMFYUI_EXECUTION_CANCELLED_MESSAGE
}

/**
 * Submit one ComfyUI workflow, wait for completion, then save downloaded outputs
 * into the main generated-media pipeline.
 */
export async function executeComfyGeneration(
  input: ExecuteComfyGenerationInput,
): Promise<ExecuteComfyGenerationResult> {
  const { comfyService, workflow, imageSaveOptions, onPromptSubmitted, shouldCancel, onCancelRequested } = input

  const promptId = await comfyService.submitPrompt(workflow)
  await onPromptSubmitted?.(promptId)

  if (await shouldCancel?.()) {
    await onCancelRequested?.(promptId)
    throw new Error(COMFYUI_EXECUTION_CANCELLED_MESSAGE)
  }

  const collectedOutputs = await comfyService.collectGeneratedOutputs(promptId, {
    shouldCancel,
    onCancelRequested,
  })

  if (await shouldCancel?.()) {
    throw new Error(COMFYUI_EXECUTION_CANCELLED_MESSAGE)
  }

  let savedImageCount = 0
  let representativeImage: ComfyGenerationRepresentativeImage | null = null
  const pendingTempPaths = new Set(collectedOutputs.map((output) => output.tempPath))

  try {
    for (const output of collectedOutputs) {
      if (await shouldCancel?.()) {
        throw new Error(COMFYUI_EXECUTION_CANCELLED_MESSAGE)
      }
      try {
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
      } catch (error) {
        console.error(`❌ Failed to save ComfyUI output ${output.tempPath}:`, error)
      } finally {
        pendingTempPaths.delete(output.tempPath)
        try {
          await fs.promises.unlink(output.tempPath)
        } catch (cleanupError) {
          console.warn(`⚠️ Failed to remove temp ComfyUI output ${output.tempPath}:`, cleanupError)
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
    attemptedImageCount: collectedOutputs.length,
    savedImageCount,
    representativeImage,
  }
}
