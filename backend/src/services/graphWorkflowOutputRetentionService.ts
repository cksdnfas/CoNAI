import { deleteRetiredGraphWorkflowArtifacts } from './graphWorkflowRetentionDeleter'
import { findGraphWorkflowRetentionOverflowArtifactIds as findRetentionOverflowArtifactIds } from './graphWorkflowRetentionScanner'

export const DEFAULT_GRAPH_WORKFLOW_OUTPUT_RETENTION_LIMIT = 200
const RETENTION_PRUNE_DEBOUNCE_MS = 1_500

const pendingRetentionPrunes = new Map<number, number>()
let retentionPruneTimer: ReturnType<typeof setTimeout> | null = null

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function parseRetentionLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed)
  }

  return fallback
}

/** Resolve how many generated outputs and technical artifacts each graph workflow should retain. */
export function getGraphWorkflowOutputRetentionLimit() {
  return parseRetentionLimit(process.env.CONAI_GRAPH_WORKFLOW_OUTPUT_RETENTION_LIMIT, DEFAULT_GRAPH_WORKFLOW_OUTPUT_RETENTION_LIMIT)
}

/** Find graph workflow output/artifact rows outside the retained recent windows. */
export function findGraphWorkflowRetentionOverflowArtifactIds(workflowId: number, retentionLimit = getGraphWorkflowOutputRetentionLimit()) {
  return findRetentionOverflowArtifactIds(workflowId, retentionLimit)
}

/** Prune old graph workflow generated outputs and technical/text artifact rows. */
export async function pruneGraphWorkflowOutputRetention(workflowId: number, retentionLimit = getGraphWorkflowOutputRetentionLimit()) {
  const overflow = findGraphWorkflowRetentionOverflowArtifactIds(workflowId, retentionLimit)
  const targetArtifactIds = Array.from(new Set([
    ...overflow.generated_output_artifact_ids,
    ...overflow.technical_artifact_ids,
  ]))
  const deletion = await deleteRetiredGraphWorkflowArtifacts(targetArtifactIds)

  return {
    ...overflow,
    requested_count: targetArtifactIds.length,
    ...deletion,
  }
}

async function flushPendingRetentionPrunes() {
  const entries = Array.from(pendingRetentionPrunes.entries())
  pendingRetentionPrunes.clear()

  for (const [workflowId, retentionLimit] of entries) {
    try {
      await pruneGraphWorkflowOutputRetention(workflowId, retentionLimit)
    } catch (error) {
      console.warn('[GraphWorkflowOutputRetention] Failed to prune graph workflow outputs:', error instanceof Error ? error.message : error)
    }

    await yieldToEventLoop()
  }
}

/** Debounce retention work so execution completion does not run workflow-wide cleanup inline. */
export function requestGraphWorkflowOutputRetentionPrune(workflowId: number, retentionLimit = getGraphWorkflowOutputRetentionLimit()) {
  pendingRetentionPrunes.set(workflowId, retentionLimit)
  if (retentionPruneTimer) {
    return
  }

  retentionPruneTimer = setTimeout(() => {
    retentionPruneTimer = null
    void flushPendingRetentionPrunes()
  }, RETENTION_PRUNE_DEBOUNCE_MS)
}
