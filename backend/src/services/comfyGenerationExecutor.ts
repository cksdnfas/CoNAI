import fs from 'fs'
import path from 'path'
import { APIImageProcessor } from './APIImageProcessor'
import { COMFYUI_EXECUTION_CANCELLED_MESSAGE, ComfyUIService } from './comfyuiService'
import { moveFileIntoWorkflowArtifacts, writeWorkflowArtifactDirectoryThumbnail } from './workflowArtifactService'
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
  /** 디버그 스냅샷/히스토리 갱신 전용. 상태 전이 책임은 onPromptAccepted 가 가진다. */
  onPromptSubmitted?: (promptId: string) => void | Promise<void>
  /** PJ-1: POST 직전에 "제출 의사"를 durable 하게 커밋한다. */
  onUpstreamSubmitting?: () => void | Promise<void>
  /** PJ-2: 응답 파싱과 같은 tick 에서 핸들을 지속시킨다(동기 콜백이어야 한다). */
  onPromptAccepted?: (promptId: string) => void
  shouldCancel?: () => boolean | Promise<boolean>
  onCancelRequested?: (promptId: string) => void | Promise<void>
  /** PJ-3: `/queue` 역매칭용 CoNAI 잡 마커 */
  queueJobId?: number | null
  signal?: AbortSignal
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

function parseComfyNodeOrder(nodeId: string) {
  const match = nodeId.match(/^\d+/)
  return match ? Number(match[0]) : -1
}

function isImageOutput(output: { kind?: string }) {
  return output.kind === 'image' || output.kind === 'animated'
}

function isComfyImageSaveNode(workflow: Record<string, any>, nodeId: string) {
  const node = workflow[nodeId]
  return Boolean(node && typeof node === 'object' && node.class_type === 'SaveImage')
}

type SavedArtifactOutput = {
  artifact: ComfyGenerationSavedArtifact
  isImageOutput: boolean
  fromImageSaveNode: boolean
  nodeOrder: number
  index: number
}

function sortByComfyNodeOrder(left: SavedArtifactOutput, right: SavedArtifactOutput) {
  return (right.nodeOrder - left.nodeOrder) || (left.index - right.index)
}

function pickArtifactThumbnailTarget(outputs: SavedArtifactOutput[]) {
  const imageOutputs = outputs.filter((output) => output.isImageOutput)
  return imageOutputs.filter((output) => output.fromImageSaveNode).sort(sortByComfyNodeOrder)[0]
    ?? imageOutputs.sort(sortByComfyNodeOrder)[0]
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
  const {
    comfyService,
    workflow,
    imageSaveOptions,
    artifactWorkflow,
    onPromptSubmitted,
    onUpstreamSubmitting,
    onPromptAccepted,
    shouldCancel,
    onCancelRequested,
    queueJobId,
    signal,
  } = input
  const normalizedWorkflow = normalizeCoNaiArtifactFileOutputNodes(workflow)

  const isArtifactWorkflow = artifactWorkflow?.result_view_mode === 'artifact_explorer'

  // PJ-1: 제출 의사를 먼저 커밋해야 프로세스가 죽어도 orphan 복구 근거가 남는다.
  await onUpstreamSubmitting?.()

  let promptId: string
  if (comfyService.isModalBackend()) {
    // modal 핸들은 클라이언트가 만들기 때문에 POST 전에 곧바로 지속시킬 수 있다(PJ-4).
    promptId = comfyService.createProviderJobId()
    onPromptAccepted?.(promptId)
  } else {
    promptId = await comfyService.submitPrompt(normalizedWorkflow, {
      signal,
      queueJobId,
      onAccepted: onPromptAccepted,
    })
  }

  await onPromptSubmitted?.(promptId)

  if (await shouldCancel?.()) {
    await onCancelRequested?.(promptId)
    throw new Error(COMFYUI_EXECUTION_CANCELLED_MESSAGE)
  }

  const collectedOutputs = comfyService.isModalBackend()
    ? await comfyService.runModalWorkflowAndCollectOutputs(normalizedWorkflow, promptId, {
      shouldCancel,
      onCancelRequested,
      signal,
      onlyFinalOutput: !isArtifactWorkflow,
    })
    : await comfyService.collectGeneratedOutputs(promptId, {
      shouldCancel,
      onCancelRequested,
      signal,
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
  const savedArtifactOutputs: SavedArtifactOutput[] = []

  try {
    for (const [index, output] of collectedOutputs.entries()) {
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
          savedArtifactOutputs.push({
            artifact: savedArtifact,
            isImageOutput: isImageOutput(output),
            fromImageSaveNode: isComfyImageSaveNode(normalizedWorkflow, output.nodeId),
            nodeOrder: parseComfyNodeOrder(output.nodeId),
            index,
          })
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

  if (isArtifactWorkflow && savedArtifactOutputs.length > 0) {
    const thumbnailTarget = pickArtifactThumbnailTarget(savedArtifactOutputs)

    if (thumbnailTarget) {
      try {
        const thumbnail = await writeWorkflowArtifactDirectoryThumbnail({
          workflow: artifactWorkflow,
          directoryRelativePath: thumbnailTarget.artifact.directoryRelativePath,
          sourcePath: thumbnailTarget.artifact.absolutePath,
        })
        console.log(`✅ ComfyUI artifact thumbnail saved: ${thumbnail.relativePath}`)
      } catch (thumbnailError) {
        console.warn('⚠️ Failed to create ComfyUI artifact directory thumbnail:', thumbnailError)
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
