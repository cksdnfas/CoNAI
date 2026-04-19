import fs from 'fs'
import path from 'path'
import { createComfyUIService } from '../comfyuiService'
import { FileDiscoveryService } from '../folderScan/fileDiscoveryService'
import { prepareComfyPromptData } from '../prepareComfyPromptData'
import { resolveWorkflowPromptValues } from '../workflowPromptValueResolver'
import { saveArtifactBuffer, saveMetadataArtifact } from './artifacts'
import {
  bufferToDataUrl,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'
import { type GraphWorkflowNode } from '../../types/moduleGraph'

function resolveComfyOutputMimeType(output: { format?: string; filename: string; tempPath: string }) {
  const normalizedFormat = typeof output.format === 'string' ? output.format.trim().toLowerCase() : ''
  if (normalizedFormat.includes('/')) {
    return normalizedFormat
  }

  return FileDiscoveryService.getMimeType(output.filename || output.tempPath)
}

/** Execute a ComfyUI-backed module node and persist its outputs. */
export async function executeComfyModule(context: ExecutionContext, node: GraphWorkflowNode, moduleDefinition: ParsedModuleDefinition, resolvedInputs: Record<string, any>) {
  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_start',
    message: `ComfyUI module start: ${moduleDefinition.name}`,
    details: {
      engine: 'comfyui',
      workflow_id: moduleDefinition.source_workflow_id,
    },
  })

  const templateDefaults = moduleDefinition.template_defaults || {}
  const workflowJson = templateDefaults.workflow_json
  const markedFields = templateDefaults.marked_fields || []
  const apiEndpoint = templateDefaults.api_endpoint

  if (!workflowJson || !apiEndpoint) {
    throw new Error(`ComfyUI module ${moduleDefinition.name} is missing workflow_json or api_endpoint`)
  }

  const comfyService = createComfyUIService(apiEndpoint)
  const preparedPromptData = await prepareComfyPromptData(comfyService, markedFields, resolvedInputs, {
    uploadNameBase: node.id,
  })

  const resolvedPromptData = resolveWorkflowPromptValues(markedFields, preparedPromptData, 'comfyui')
  const substitutedWorkflow = comfyService.substitutePromptData(
    JSON.stringify(workflowJson),
    markedFields,
    resolvedPromptData,
  )

  const promptId = await comfyService.submitPrompt(substitutedWorkflow)
  const collectedOutputs = await comfyService.collectGeneratedOutputs(promptId)
  const primaryOutput = collectedOutputs[0]
  if (!primaryOutput) {
    throw new Error('ComfyUI module execution returned no outputs')
  }

  const primaryOutputPort = moduleDefinition.output_ports.find((port) => port.key !== 'metadata') ?? {
    key: 'image',
    data_type: 'image' as const,
  }
  const artifactType: 'file' | 'image' = primaryOutput.kind === 'video' ? 'file' : 'image'
  const mimeType = resolveComfyOutputMimeType(primaryOutput)
  const outputBuffer = await fs.promises.readFile(primaryOutput.tempPath)
  const outputDataUrl = bufferToDataUrl(outputBuffer, mimeType)
  const originalFileName = path.basename(primaryOutput.filename || primaryOutput.tempPath)
  const { storagePath, artifactRecordId } = await saveArtifactBuffer(
    context.executionId,
    node.id,
    primaryOutputPort.key,
    artifactType,
    outputBuffer,
    {
      mimeType,
      sourcePathForMetadata: primaryOutput.tempPath,
      originalFileName,
    },
  )

  for (const output of collectedOutputs) {
    try {
      await fs.promises.unlink(output.tempPath)
    } catch (cleanupError) {
      console.warn(`⚠️ Failed to remove temp ComfyUI output ${output.tempPath}:`, cleanupError)
    }
  }

  const metadataValue = {
    workflow_id: templateDefaults.workflow_id,
    workflow_name: templateDefaults.workflow_name,
    api_endpoint: apiEndpoint,
    prompt_id: promptId,
    output_kind: primaryOutput.kind,
    output_mime_type: mimeType,
    output_file_name: originalFileName,
  }

  const nodeArtifacts: Record<string, RuntimeArtifact> = {
    [primaryOutputPort.key]: {
      type: artifactType,
      value: outputDataUrl,
      storagePath,
      artifactRecordId,
      metadata: {
        module: moduleDefinition.name,
        mimeType,
        outputKind: primaryOutput.kind,
        originalFileName,
      },
    },
    metadata: {
      type: 'json' as const,
      value: metadataValue,
      metadata: {
        kind: 'comfyui-metadata',
      },
    },
  }

  saveMetadataArtifact(context.executionId, node.id, metadataValue)
  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `ComfyUI module completed: ${moduleDefinition.name}`,
    details: {
      artifact_ports: Object.keys(nodeArtifacts),
      artifactType,
      outputKind: primaryOutput.kind,
      mimeType,
      storagePath,
    },
  })
}
