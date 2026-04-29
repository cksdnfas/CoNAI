import fs from 'fs'
import path from 'path'
import { resolveUploadsPath } from '../../config/runtimePaths'
import { createComfyUIService } from '../comfyuiService'
import { FileDiscoveryService } from '../folderScan/fileDiscoveryService'
import { prepareComfyPromptData } from '../prepareComfyPromptData'
import { reconcileComfyModelSelectionValues } from '../comfyModelSelectionResolver'
import { resolveWorkflowPromptValues } from '../workflowPromptValueResolver'
import { settingsService } from '../settingsService'
import { WorkflowModel } from '../../models/Workflow'
import { ComfyUIServerModel, WorkflowServerModel } from '../../models/ComfyUIServer'
import { GenerationHistoryModel } from '../../models/GenerationHistory'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { normalizeGenerationQueueRoutingTag } from '../generationQueueRouting'
import { GenerationQueueService } from '../generationQueueService'
import { ImageUploadService } from '../imageUploadService'
import { saveArtifactBuffer, saveArtifactFileReference, saveMetadataArtifact, shouldMaterializeRuntimeArtifactValue } from './artifacts'
import {
  bufferToDataUrl,
  normalizeOptionalString,
  parsePositiveIntegerish,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'
import { type GenerationQueueJobRecord } from '../../types/generationQueue'
import { type GraphWorkflowNode } from '../../types/moduleGraph'

const GRAPH_EXECUTION_CANCELLED_MESSAGE = '__GRAPH_EXECUTION_CANCELLED__'
const GRAPH_COMFY_TARGET_MODE_KEY = 'execution_target_mode'
const GRAPH_COMFY_TARGET_TAG_KEY = 'execution_target_tag'
const GRAPH_COMFY_TARGET_SERVER_ID_KEY = 'execution_target_server_id'
const QUEUE_POLL_INTERVAL_MS = 1500
const QUEUE_TERMINAL_WAIT_TIMEOUT_MS = 15000

function resolveComfyOutputMimeType(output: { format?: string; filename: string; tempPath: string }) {
  const normalizedFormat = typeof output.format === 'string' ? output.format.trim().toLowerCase() : ''
  if (normalizedFormat.includes('/')) {
    return normalizedFormat
  }

  return FileDiscoveryService.getMimeType(output.filename || output.tempPath)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseStoredQueuePayload(record: { request_payload: string }) {
  try {
    const parsed = JSON.parse(record.request_payload) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

type GraphComfyExecutionTarget = {
  mode: 'auto' | 'tag' | 'server'
  requestedServerId: number | null
  requestedServerTag: string | null
}

function resolveGraphComfyExecutionTarget(node: GraphWorkflowNode): GraphComfyExecutionTarget {
  const inputValues = node.input_values ?? {}
  const rawMode = normalizeOptionalString(inputValues[GRAPH_COMFY_TARGET_MODE_KEY])?.toLowerCase()
  const mode = rawMode === 'tag' || rawMode === 'server' ? rawMode : 'auto'

  if (mode === 'server') {
    const requestedServerId = parsePositiveIntegerish(inputValues[GRAPH_COMFY_TARGET_SERVER_ID_KEY])
    if (requestedServerId === null) {
      throw new Error('ComfyUI node server target is invalid or missing')
    }

    return {
      mode,
      requestedServerId,
      requestedServerTag: null,
    }
  }

  if (mode === 'tag') {
    const requestedServerTag = normalizeOptionalString(inputValues[GRAPH_COMFY_TARGET_TAG_KEY])
    if (!requestedServerTag) {
      throw new Error('ComfyUI node routing tag is invalid or missing')
    }

    return {
      mode,
      requestedServerId: null,
      requestedServerTag: normalizeGenerationQueueRoutingTag(requestedServerTag),
    }
  }

  return {
    mode: 'auto',
    requestedServerId: null,
    requestedServerTag: null,
  }
}

function resolveSourceWorkflowId(moduleDefinition: ParsedModuleDefinition) {
  const explicitSourceWorkflowId = parsePositiveIntegerish(moduleDefinition.source_workflow_id)
  if (explicitSourceWorkflowId !== null) {
    return explicitSourceWorkflowId
  }

  return parsePositiveIntegerish(moduleDefinition.template_defaults?.workflow_id)
}

function buildQueuePayload(promptData: Record<string, unknown>) {
  const imageSaveSettings = settingsService.loadSettings().imageSave
  const payload: Record<string, unknown> = {
    prompt_data: promptData,
  }

  if (imageSaveSettings.applyToWorkflowOutputs) {
    payload.imageSaveOptions = {
      format: imageSaveSettings.defaultFormat,
      quality: imageSaveSettings.quality,
      resizeEnabled: imageSaveSettings.resizeEnabled,
      maxWidth: imageSaveSettings.maxWidth,
      maxHeight: imageSaveSettings.maxHeight,
    }
  }

  return payload
}

function buildQueuePromptData(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  workflow: { marked_fields?: string | null },
  resolvedInputs: Record<string, any>,
) {
  const markedFields = workflow.marked_fields ? JSON.parse(workflow.marked_fields) as Array<{ id?: unknown }> : []
  const explicitInputs = node.input_values ?? {}
  const connectedInputKeys = new Set(
    context.workflow.graph.edges
      .filter((edge) => edge.target_node_id === node.id)
      .map((edge) => edge.target_port_key),
  )
  const promptData: Record<string, any> = {}

  for (const field of markedFields) {
    if (typeof field.id !== 'string') {
      continue
    }

    const hasExplicitValue = Object.prototype.hasOwnProperty.call(explicitInputs, field.id)
    const hasIncomingValue = connectedInputKeys.has(field.id)
    if ((hasExplicitValue || hasIncomingValue) && resolvedInputs[field.id] !== undefined) {
      promptData[field.id] = resolvedInputs[field.id]
    }
  }

  return promptData
}

function validateQueueTarget(workflowId: number, target: GraphComfyExecutionTarget) {
  const workflow = WorkflowModel.findById(workflowId)
  if (!workflow) {
    throw new Error(`ComfyUI module workflow ${workflowId} not found`)
  }

  if (!workflow.is_active) {
    throw new Error(`ComfyUI module workflow ${workflowId} is inactive`)
  }

  const workflowHasServerLinks = WorkflowServerModel.findServersByWorkflow(workflowId, false).length > 0
  const workflowLinkedServers = WorkflowServerModel.findServersByWorkflow(workflowId, true)
  if (workflowHasServerLinks && workflowLinkedServers.length === 0) {
    throw new Error('This ComfyUI workflow has no active linked servers')
  }

  if (target.requestedServerId !== null) {
    const server = ComfyUIServerModel.findById(target.requestedServerId)
    if (!server || !server.is_active) {
      throw new Error('Requested ComfyUI server was not found or is inactive')
    }

    if (workflowHasServerLinks && !workflowLinkedServers.some((linkedServer) => Number(linkedServer.id) === target.requestedServerId)) {
      throw new Error('Requested ComfyUI server is not linked to this workflow')
    }
  }

  if (target.requestedServerTag) {
    const candidateServers = workflowHasServerLinks ? workflowLinkedServers : ComfyUIServerModel.findActiveServers()
    const hasMatchingTag = candidateServers.some((server) => (server.routing_tags ?? []).some((tag: string) => normalizeGenerationQueueRoutingTag(tag) === target.requestedServerTag))
    if (!hasMatchingTag) {
      throw new Error(workflowHasServerLinks
        ? 'Requested routing tag does not match any linked workflow server'
        : 'Requested routing tag does not match any active ComfyUI server')
    }
  }

  return workflow
}

async function requestQueueCancellation(jobId: number) {
  const latest = GenerationQueueModel.findById(jobId)
  if (!latest || latest.status === 'completed' || latest.status === 'failed' || latest.status === 'cancelled') {
    return
  }

  await GenerationQueueService.requestCancellation(jobId)
}

async function waitForQueueCompletion(context: ExecutionContext, nodeId: string, jobId: number) {
  let terminalWait: Promise<GenerationQueueJobRecord | null> | null = null

  while (true) {
    if (context.shouldCancel?.()) {
      await requestQueueCancellation(jobId)
      writeExecutionLog({
        executionId: context.executionId,
        nodeId,
        level: 'warn',
        eventType: 'node_queue_cancel_requested',
        message: `Queue cancellation requested for graph node job ${jobId}`,
      })
      throw new Error(GRAPH_EXECUTION_CANCELLED_MESSAGE)
    }

    terminalWait ??= GenerationQueueService.waitForTerminalJob(jobId, { timeoutMs: QUEUE_TERMINAL_WAIT_TIMEOUT_MS })
    const job = await Promise.race([
      terminalWait,
      sleep(QUEUE_POLL_INTERVAL_MS).then(() => undefined),
    ])

    if (job === undefined) {
      continue
    }

    terminalWait = null
    if (!job) {
      continue
    }

    if (job.status === 'completed') {
      return job
    }

    if (job.status === 'failed') {
      throw new Error(job.failure_message || `Queue job ${jobId} failed`)
    }

    if (job.status === 'cancelled') {
      throw new Error(GRAPH_EXECUTION_CANCELLED_MESSAGE)
    }
  }
}

async function resolveQueueBackedOutput(params: {
  context: ExecutionContext
  node: GraphWorkflowNode
  moduleDefinition: ParsedModuleDefinition
  outputPortKey: string
  completedJobId: number
  target: GraphComfyExecutionTarget
}) {
  const completedJob = GenerationQueueModel.findById(params.completedJobId)
  if (!completedJob) {
    throw new Error(`Completed queue job ${params.completedJobId} is no longer available`)
  }

  const storedPayload = parseStoredQueuePayload(completedJob)
  const debug = storedPayload._debug && typeof storedPayload._debug === 'object' && !Array.isArray(storedPayload._debug)
    ? storedPayload._debug as Record<string, unknown>
    : {}

  const historyId = parsePositiveIntegerish(debug.history_id)
  const compositeHash = normalizeOptionalString(debug.result_composite_hash)
    ?? (historyId ? normalizeOptionalString(GenerationHistoryModel.findById(historyId)?.composite_hash) : null)
  const fallbackOriginalPath = normalizeOptionalString(debug.result_original_path)
  const originalPath = fallbackOriginalPath
    ?? (compositeHash ? ImageUploadService.getActiveFilePath(compositeHash) : null)

  if (!originalPath) {
    throw new Error(`Queue job ${completedJob.id} completed but graph output path could not be resolved`)
  }

  const absoluteOriginalPath = path.isAbsolute(originalPath) ? originalPath : resolveUploadsPath(originalPath)
  const resolvedMimeType = normalizeOptionalString(debug.result_mime_type)
    ?? FileDiscoveryService.getMimeType(absoluteOriginalPath)
  const artifactType: 'file' | 'image' = resolvedMimeType.startsWith('video/') ? 'file' : 'image'
  const originalFileName = path.basename(absoluteOriginalPath)
  const shouldMaterializeValue = shouldMaterializeRuntimeArtifactValue(params.context, params.node.id, params.outputPortKey, artifactType)

  let outputValue: unknown = {
    storagePath: absoluteOriginalPath,
    mimeType: resolvedMimeType,
    fileName: originalFileName,
    compositeHash,
  }
  let storagePath: string
  let artifactRecordId: number

  if (shouldMaterializeValue) {
    const outputBuffer = await fs.promises.readFile(absoluteOriginalPath)
    outputValue = bufferToDataUrl(outputBuffer, resolvedMimeType)
    const savedArtifact = await saveArtifactBuffer(
      params.context.executionId,
      params.node.id,
      params.outputPortKey,
      artifactType,
      outputBuffer,
      {
        mimeType: resolvedMimeType,
        sourcePathForMetadata: absoluteOriginalPath,
        originalFileName,
      },
    )
    storagePath = savedArtifact.storagePath
    artifactRecordId = savedArtifact.artifactRecordId
  } else {
    const referencedArtifact = await saveArtifactFileReference(
      params.context.executionId,
      params.node.id,
      params.outputPortKey,
      artifactType,
      absoluteOriginalPath,
      {
        mimeType: resolvedMimeType,
        metadata: {
          module: params.moduleDefinition.name,
          outputKind: artifactType === 'file' ? 'video' : 'image',
          originalFileName,
          queueJobId: completedJob.id,
          historyId,
          compositeHash,
        },
      },
    )
    storagePath = referencedArtifact.storagePath
    artifactRecordId = referencedArtifact.artifactRecordId
  }

  const metadataValue = {
    workflow_id: params.moduleDefinition.template_defaults?.workflow_id ?? params.moduleDefinition.source_workflow_id ?? null,
    workflow_name: params.moduleDefinition.template_defaults?.workflow_name ?? params.moduleDefinition.name,
    queue_job_id: completedJob.id,
    history_id: historyId,
    provider_job_id: completedJob.provider_job_id ?? null,
    requested_server_id: completedJob.requested_server_id ?? null,
    requested_server_tag: completedJob.requested_server_tag ?? null,
    assigned_server_id: completedJob.assigned_server_id ?? null,
    execution_target_mode: params.target.mode,
    composite_hash: compositeHash,
    output_mime_type: resolvedMimeType,
    output_file_name: originalFileName,
    output_kind: artifactType === 'file' ? 'video' : 'image',
  }

  const nodeArtifacts: Record<string, RuntimeArtifact> = {
    [params.outputPortKey]: {
      type: artifactType,
      value: outputValue,
      storagePath,
      artifactRecordId,
      metadata: {
        module: params.moduleDefinition.name,
        mimeType: resolvedMimeType,
        outputKind: artifactType === 'file' ? 'video' : 'image',
        originalFileName,
        queueJobId: completedJob.id,
        historyId,
        compositeHash,
      },
    },
    metadata: {
      type: 'json' as const,
      value: metadataValue,
      metadata: {
        kind: 'comfyui-queue-metadata',
      },
    },
  }

  saveMetadataArtifact(params.context.executionId, params.node.id, metadataValue)
  params.context.artifactsByNode.set(params.node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: params.context.executionId,
    nodeId: params.node.id,
    eventType: 'node_queue_complete',
    message: `Queue-backed ComfyUI module completed: ${params.moduleDefinition.name}`,
    details: {
      queueJobId: completedJob.id,
      historyId,
      providerJobId: completedJob.provider_job_id ?? null,
      assignedServerId: completedJob.assigned_server_id ?? null,
      requestedServerId: completedJob.requested_server_id ?? null,
      requestedServerTag: completedJob.requested_server_tag ?? null,
      compositeHash,
      storagePath,
    },
  })
}

async function executeQueueBackedComfyModule(context: ExecutionContext, node: GraphWorkflowNode, moduleDefinition: ParsedModuleDefinition, resolvedInputs: Record<string, any>) {
  const sourceWorkflowId = resolveSourceWorkflowId(moduleDefinition)
  if (!sourceWorkflowId) {
    throw new Error(`ComfyUI module ${moduleDefinition.name} is missing source workflow binding`)
  }

  const target = resolveGraphComfyExecutionTarget(node)
  const workflow = validateQueueTarget(sourceWorkflowId, target)
  const queuePromptData = buildQueuePromptData(context, node, workflow, resolvedInputs)
  const queuePayload = buildQueuePayload(queuePromptData)
  const primaryOutputPort = moduleDefinition.output_ports.find((port) => port.key !== 'metadata') ?? {
    key: 'image',
    data_type: 'image' as const,
  }

  const jobId = GenerationQueueModel.create({
    service_type: 'comfyui',
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    requested_server_id: target.requestedServerId,
    requested_server_tag: target.requestedServerTag,
    request_payload: queuePayload,
    request_summary: `${context.workflow.name} · ${node.label || moduleDefinition.name}`,
  })

  GenerationQueueService.requestDispatch()

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_queue_registered',
    message: `Queue-backed ComfyUI module registered: ${moduleDefinition.name}`,
    details: {
      queueJobId: jobId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      requestedServerId: target.requestedServerId,
      requestedServerTag: target.requestedServerTag,
      executionTargetMode: target.mode,
    },
  })

  const completedJob = await waitForQueueCompletion(context, node.id, jobId)
  await resolveQueueBackedOutput({
    context,
    node,
    moduleDefinition,
    outputPortKey: primaryOutputPort.key,
    completedJobId: completedJob.id,
    target,
  })
}

async function executeDirectComfyModule(context: ExecutionContext, node: GraphWorkflowNode, moduleDefinition: ParsedModuleDefinition, resolvedInputs: Record<string, any>) {
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

  const parsedPromptData = resolveWorkflowPromptValues(markedFields, preparedPromptData, 'comfyui')
  const resolvedPromptData = await reconcileComfyModelSelectionValues(JSON.stringify(workflowJson), markedFields, parsedPromptData, comfyService, { strict: true })
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
  const shouldMaterializeValue = shouldMaterializeRuntimeArtifactValue(context, node.id, primaryOutputPort.key, artifactType)
  const outputValue = shouldMaterializeValue
    ? bufferToDataUrl(outputBuffer, mimeType)
    : {
      storagePath,
      mimeType: FileDiscoveryService.getMimeType(storagePath),
      fileName: path.basename(storagePath),
      originalFileName,
    }

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
      value: outputValue,
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
      executionPath: 'direct',
    },
  })
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

  if (resolveSourceWorkflowId(moduleDefinition)) {
    await executeQueueBackedComfyModule(context, node, moduleDefinition, resolvedInputs)
    return
  }

  await executeDirectComfyModule(context, node, moduleDefinition, resolvedInputs)
}
