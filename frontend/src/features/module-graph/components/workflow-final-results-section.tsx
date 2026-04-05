import { Badge } from '@/components/ui/badge'
import type { GraphExecutionArtifactRecord, GraphExecutionFinalResultRecord, GraphWorkflowRecord } from '@/lib/api'
import { ExecutionArtifactCard } from './execution-artifact-card'
import { getNodeDisplayLabel } from './graph-execution-panel-helpers'

function getFinalResultOverlayLabel(nodeLabel: string) {
  const normalizedLabel = nodeLabel.trim().toLowerCase()
  if (!normalizedLabel || normalizedLabel === 'final' || normalizedLabel === 'final result') {
    return undefined
  }

  return nodeLabel
}

function buildFallbackArtifact(finalResult: GraphExecutionFinalResultRecord): GraphExecutionArtifactRecord {
  return {
    id: finalResult.source_artifact_id,
    execution_id: finalResult.source_execution_id ?? finalResult.execution_id,
    node_id: finalResult.source_node_id,
    port_key: finalResult.source_port_key,
    artifact_type: finalResult.artifact_type,
    storage_path: finalResult.source_storage_path,
    metadata: finalResult.source_metadata,
    created_date: finalResult.created_date,
  }
}

/** Render one shared explicit-final-results surface for workflow runner and execution panels. */
export function WorkflowFinalResultsSection({
  finalResults,
  artifacts,
  selectedGraph,
  emptyLabel = 'Final Result 노드를 추가하고 원하는 출력에 연결해줘.',
}: {
  finalResults: GraphExecutionFinalResultRecord[]
  artifacts: GraphExecutionArtifactRecord[]
  selectedGraph?: GraphWorkflowRecord | null
  emptyLabel?: string
}) {
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  const resolvedEntries = finalResults.map((finalResult) => ({
    finalResult,
    artifact: artifactsById.get(finalResult.source_artifact_id) ?? buildFallbackArtifact(finalResult),
  }))

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span>결과물</span>
        <Badge variant="outline">{resolvedEntries.length}</Badge>
      </div>

      {resolvedEntries.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          <div>{emptyLabel}</div>
          {selectedGraph ? <div className="mt-1 text-xs text-muted-foreground/90">시스템 모듈의 Final Result를 추가한 뒤, 최종으로 확정할 출력 포트에 연결해줘.</div> : null}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {resolvedEntries.map(({ finalResult, artifact }) => {
            const finalNodeLabel = getNodeDisplayLabel(selectedGraph, finalResult.final_node_id)

            return (
              <ExecutionArtifactCard
                key={finalResult.id}
                artifact={artifact}
                compact
                hideTitle
                overlayLabel={getFinalResultOverlayLabel(finalNodeLabel)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
