import axios from 'axios'
// @ts-ignore - no types available
import AdmZip from 'adm-zip'
import { getToken } from '../../utils/nai/auth'
import { preprocessMetadata, type NAIMetadataInputParams } from '../../utils/nai/metadata'
import { buildNaiRequestBody } from '../../utils/nai/requestBuilder'
import { saveArtifactBuffer, saveMetadataArtifact } from './artifacts'
import {
  bufferToDataUrl,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'
import { type GraphWorkflowNode } from '../../types/moduleGraph'

/** Execute a NovelAI-backed module node and persist its outputs. */
export async function executeNaiModule(context: ExecutionContext, node: GraphWorkflowNode, moduleDefinition: ParsedModuleDefinition, resolvedInputs: Record<string, any>) {
  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_start',
    message: `NAI module start: ${moduleDefinition.name}`,
    details: {
      engine: 'nai',
      model: resolvedInputs.model,
      action: resolvedInputs.action,
    },
  })

  const token = getToken()
  if (!token) {
    throw new Error('NovelAI token is required before executing NAI modules')
  }

  const metadata = preprocessMetadata(resolvedInputs as NAIMetadataInputParams)
  const requestBody = await buildNaiRequestBody(metadata)

  const response = await axios.post('https://image.novelai.net/ai/generate-image', requestBody, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://novelai.net',
      Referer: 'https://novelai.net',
    },
    responseType: 'arraybuffer',
    timeout: 120000,
  })

  const zip = new AdmZip(Buffer.from(response.data))
  const firstEntry = zip.getEntries()[0]
  if (!firstEntry) {
    throw new Error('NAI module execution returned no images')
  }

  const imageBuffer = firstEntry.getData()
  const imageDataUrl = bufferToDataUrl(imageBuffer)
  const { storagePath, artifactRecordId } = await saveArtifactBuffer(context.executionId, node.id, 'image', 'image', imageBuffer, {
    mimeType: 'image/png',
    originalFileName: firstEntry.entryName,
  })

  const metadataValue = {
    prompt: metadata.prompt,
    negative_prompt: metadata.negative_prompt,
    characters: metadata.characters,
    vibes: metadata.vibes,
    character_refs: metadata.character_refs,
    model: requestBody.model,
    action: metadata.action,
    width: metadata.width,
    height: metadata.height,
    sampler: metadata.sampler,
    scheduler: metadata.noise_schedule,
  }

  const nodeArtifacts = {
    image: {
      type: 'image' as const,
      value: imageDataUrl,
      storagePath,
      artifactRecordId,
      metadata: {
        model: requestBody.model,
        action: metadata.action,
      },
    },
    metadata: {
      type: 'json' as const,
      value: metadataValue,
      metadata: {
        kind: 'nai-metadata',
      },
    },
  }

  saveMetadataArtifact(context.executionId, node.id, metadataValue)
  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `NAI module completed: ${moduleDefinition.name}`,
    details: {
      artifact_ports: Object.keys(nodeArtifacts),
      storagePath,
    },
  })
}
