import fs from 'fs'
import { createComfyUIService } from '../comfyuiService'
import { saveArtifactBuffer, saveMetadataArtifact } from './artifacts'
import {
  bufferToDataUrl,
  normalizeBase64ImageData,
  sanitizeFileSegment,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'
import { type GraphWorkflowNode } from '../../types/moduleGraph'

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
  const preparedPromptData = { ...resolvedInputs }

  for (const field of markedFields as Array<{ id: string; type: string }>) {
    if (field.type !== 'image') {
      continue
    }

    const value = preparedPromptData[field.id]
    if (!value || typeof value !== 'string') {
      continue
    }

    const base64 = normalizeBase64ImageData(value)
    if (!base64) {
      continue
    }

    const uploadName = `${sanitizeFileSegment(node.id)}_${sanitizeFileSegment(field.id)}_${Date.now()}.png`
    const uploadedName = await comfyService.uploadInputImage(uploadName, Buffer.from(base64, 'base64'))
    preparedPromptData[field.id] = uploadedName
  }

  const substitutedWorkflow = comfyService.substitutePromptData(
    JSON.stringify(workflowJson),
    markedFields,
    preparedPromptData,
  )

  const { imagePaths } = await comfyService.generateImages({} as any, substitutedWorkflow)
  const firstPath = imagePaths[0]
  if (!firstPath) {
    throw new Error('ComfyUI module execution returned no images')
  }

  const imageBuffer = await fs.promises.readFile(firstPath)
  const imageDataUrl = bufferToDataUrl(imageBuffer)
  const storagePath = await saveArtifactBuffer(context.executionId, node.id, 'image', 'image', imageBuffer, {
    mimeType: 'image/png',
    sourcePathForMetadata: firstPath,
    originalFileName: firstPath.split(/[/\\]/).pop(),
  })

  const metadataValue = {
    workflow_id: templateDefaults.workflow_id,
    workflow_name: templateDefaults.workflow_name,
    api_endpoint: apiEndpoint,
  }

  const nodeArtifacts = {
    image: {
      type: 'image' as const,
      value: imageDataUrl,
      storagePath,
      metadata: {
        module: moduleDefinition.name,
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
      storagePath,
    },
  })
}
