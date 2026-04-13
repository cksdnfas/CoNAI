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
 * Submit one ComfyUI workflow, wait for completion, then save downloaded images
 * into the main generated-image pipeline.
 */
export async function executeComfyGeneration(
  input: ExecuteComfyGenerationInput,
): Promise<ExecuteComfyGenerationResult> {
  const { comfyService, workflow, imageSaveOptions, onPromptSubmitted } = input

  const promptId = await comfyService.submitPrompt(workflow)
  await onPromptSubmitted?.(promptId)

  const tempFilePaths = await comfyService.collectGeneratedImages(promptId)

  let savedImageCount = 0
  let representativeImage: ComfyGenerationRepresentativeImage | null = null

  for (const tempPath of tempFilePaths) {
    try {
      const imageBuffer = await fs.promises.readFile(tempPath)
      const processedPaths = await APIImageProcessor.processGeneratedImage(imageBuffer, 'comfyui', {
        ...imageSaveOptions,
        sourcePathForMetadata: tempPath,
        originalFileName: path.basename(tempPath),
      })

      savedImageCount += 1
      if (!representativeImage) {
        representativeImage = {
          originalPath: processedPaths.originalPath,
          fileSize: processedPaths.fileSize,
          compositeHash: processedPaths.compositeHash,
        }
      }

      console.log(`✅ ComfyUI image saved: ${processedPaths.originalPath}`)
    } catch (error) {
      console.error(`❌ Failed to save ComfyUI image ${tempPath}:`, error)
    } finally {
      try {
        await fs.promises.unlink(tempPath)
      } catch (cleanupError) {
        console.warn(`⚠️ Failed to remove temp ComfyUI image ${tempPath}:`, cleanupError)
      }
    }
  }

  return {
    promptId,
    attemptedImageCount: tempFilePaths.length,
    savedImageCount,
    representativeImage,
  }
}
