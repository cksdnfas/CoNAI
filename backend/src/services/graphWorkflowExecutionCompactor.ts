import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../config/runtimePaths'
import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import { GraphExecutionNodeIoModel } from '../models/GraphExecutionNodeIo'
import { deleteFile as recycleBinDeleteFile } from '../utils/recycleBin'
import { settingsService } from './settingsService'
import type { ExecutionContext, RuntimeArtifact } from './graph-workflow-executor/shared'

function isPathInsideRoot(rootPath: string, candidatePath: string) {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function compactString(value: string, maxLength = 300) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function hashString(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function stringifyStable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyStable(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stringifyStable(entryValue)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

function summarizeRuntimeValue(value: unknown) {
  if (typeof value === 'string') {
    const isDataUrl = value.startsWith('data:')
    return {
      valueKind: isDataUrl ? 'data-url' : 'string',
      size: value.length,
      hash: hashString(value),
      preview: isDataUrl ? value.slice(0, value.indexOf(',') + 1 || 64) : compactString(value),
    }
  }

  if (value === null || value === undefined) {
    return { valueKind: value === null ? 'null' : 'undefined' }
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return { valueKind: typeof value, value }
  }

  const stableJson = stringifyStable(value)
  return {
    valueKind: Array.isArray(value) ? 'array' : typeof value,
    size: stableJson.length,
    hash: hashString(stableJson),
    keys: value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>).slice(0, 20)
      : undefined,
  }
}

function resolveArtifactReference(artifact: RuntimeArtifact) {
  const metadata = artifact.metadata ?? {}
  const compositeHash = typeof metadata.actualCompositeHash === 'string'
    ? metadata.actualCompositeHash
    : typeof metadata.compositeHash === 'string'
      ? metadata.compositeHash
      : typeof artifact.value?.compositeHash === 'string'
        ? artifact.value.compositeHash
        : typeof artifact.value?.composite_hash === 'string'
          ? artifact.value.composite_hash
          : null

  if (compositeHash) {
    return {
      refKind: 'canonical_media_hash',
      refValue: compositeHash,
    }
  }

  if (artifact.storagePath) {
    return {
      refKind: 'file_path',
      refValue: artifact.storagePath,
    }
  }

  const valueSummary = summarizeRuntimeValue(artifact.value)
  return {
    refKind: `${valueSummary.valueKind}_hash`,
    refValue: typeof valueSummary.hash === 'string' ? valueSummary.hash : null,
  }
}

function buildOutputSummary(artifact: RuntimeArtifact) {
  const metadata = artifact.metadata ?? {}
  return JSON.stringify({
    artifactRecordId: artifact.artifactRecordId ?? null,
    metadataKind: typeof metadata.kind === 'string' ? metadata.kind : null,
    mimeType: typeof metadata.mimeType === 'string' ? metadata.mimeType : typeof artifact.value?.mimeType === 'string' ? artifact.value.mimeType : null,
    fileName: typeof metadata.originalFileName === 'string' ? metadata.originalFileName : typeof artifact.value?.fileName === 'string' ? artifact.value.fileName : null,
    queueJobId: typeof metadata.queueJobId === 'number' ? metadata.queueJobId : null,
    historyId: typeof metadata.historyId === 'number' ? metadata.historyId : null,
    value: summarizeRuntimeValue(artifact.value),
  })
}

/** Persist compact ComfyUI-style input/output references for one execution. */
export function persistCompactGraphExecutionNodeIo(context: ExecutionContext) {
  const rows: Parameters<typeof GraphExecutionNodeIoModel.replaceForExecution>[1] = []

  for (const edge of context.workflow.graph.edges) {
    const sourceArtifact = context.artifactsByNode.get(edge.source_node_id)?.[edge.source_port_key]
    if (!sourceArtifact) {
      continue
    }

    const sourceReference = resolveArtifactReference(sourceArtifact)
    rows.push({
      node_id: edge.target_node_id,
      direction: 'input',
      port_key: edge.target_port_key,
      source_node_id: edge.source_node_id,
      source_port_key: edge.source_port_key,
      output_index: 1,
      artifact_type: sourceArtifact.type,
      ref_kind: 'node_output',
      ref_value: `${edge.source_node_id}.${edge.source_port_key}#1`,
      summary: JSON.stringify({
        sourceArtifactId: sourceArtifact.artifactRecordId ?? null,
        sourceRefKind: sourceReference.refKind,
        sourceRefValue: sourceReference.refValue,
      }),
    })
  }

  for (const [nodeId, artifactsByPort] of context.artifactsByNode.entries()) {
    for (const [portKey, artifact] of Object.entries(artifactsByPort)) {
      if (portKey === 'metadata') {
        continue
      }

      const reference = resolveArtifactReference(artifact)
      rows.push({
        node_id: nodeId,
        direction: 'output',
        port_key: portKey,
        output_index: 1,
        artifact_type: artifact.type,
        ref_kind: reference.refKind,
        ref_value: reference.refValue,
        summary: buildOutputSummary(artifact),
      })
    }
  }

  GraphExecutionNodeIoModel.replaceForExecution(context.executionId, rows)
}

/** Delete non-final, non-debug graph artifact rows and temp files after compact ledger persistence. */
export async function compactCompletedGraphExecutionArtifacts(context: ExecutionContext) {
  if (context.debugMode) {
    return { deleted_count: 0, deleted_file_count: 0, skipped_reason: 'debug_mode' as const }
  }

  const artifacts = GraphExecutionArtifactModel.findByExecution(context.executionId)
  if (artifacts.length === 0) {
    return { deleted_count: 0, deleted_file_count: 0 }
  }

  const finalSourceArtifactIds = new Set(
    GraphExecutionFinalResultModel.findByExecution(context.executionId)
      .map((result) => result.source_artifact_id),
  )
  const deletableArtifacts = artifacts.filter((artifact) => !finalSourceArtifactIds.has(artifact.id))
  const graphExecutionTempRoot = path.resolve(runtimePaths.tempDir, 'graph-executions')
  const useRecycleBin = settingsService.loadSettings().general.deleteProtection.enabled
  let deletedFileCount = 0

  for (const artifact of deletableArtifacts) {
    if (!artifact.storage_path) {
      continue
    }

    const resolvedPath = path.resolve(artifact.storage_path)
    if (!isPathInsideRoot(graphExecutionTempRoot, resolvedPath)) {
      continue
    }

    try {
      await fs.promises.access(resolvedPath, fs.constants.F_OK)
      await recycleBinDeleteFile(resolvedPath, useRecycleBin)
      deletedFileCount += 1
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        console.warn('[GraphWorkflowExecutionCompactor] Failed to delete transient artifact file:', artifact.storage_path)
      }
    }
  }

  const deletedCount = GraphExecutionArtifactModel.deleteByIds(deletableArtifacts.map((artifact) => artifact.id))
  return {
    deleted_count: deletedCount,
    deleted_file_count: deletedFileCount,
  }
}
