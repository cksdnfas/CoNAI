import fs from 'fs'
import path from 'path'
import { APIImageProcessor } from './APIImageProcessor'
import { ComfyUIService } from './comfyuiService'
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
}

export interface ExecuteComfyGenerationResult {
  promptId: string
  attemptedImageCount: number
  savedImageCount: number
  representativeImage: ComfyGenerationRepresentativeImage | null
}

/**
 * Submit one ComfyUI workflow, wait for completion, then save downloaded outputs
 * into the main generated-media pipeline.
 */
export async function executeComfyGeneration(
  input: ExecuteComfyGenerationInput,
): Promise<ExecuteComfyGenerationResult> {
  const { comfyService, workflow, imageSaveOptions, onPromptSubmitted } = input

  const promptId = await comfyService.submitPrompt(workflow)
  await onPromptSubmitted?.(promptId)

  const collectedOutputs = await comfyService.collectGeneratedOutputs(promptId)

  let savedImageCount = 0
  let representativeImage: ComfyGenerationRepresentativeImage | null = null

  for (const output of collectedOutputs) {
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
      try {
        await fs.promises.unlink(output.tempPath)
      } catch (cleanupError) {
        console.warn(`⚠️ Failed to remove temp ComfyUI output ${output.tempPath}:`, cleanupError)
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
