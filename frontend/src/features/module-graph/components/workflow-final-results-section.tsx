import { Badge } from '@/components/ui/badge'
import type { GraphExecutionArtifactRecord, GraphExecutionFinalResultRecord, GraphWorkflowRecord } from '@/lib/api'
import { ExecutionArtifactCard } from './execution-artifact-card'
import { getNodeDisplayLabel } from './graph-execution-panel-helpers'

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
  emptyLabel = '최종 결과 없음',
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
        <span>최종 결과</span>
        <Badge variant="outline">{resolvedEntries.length}</Badge>
      </div>

      {resolvedEntries.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {resolvedEntries.map(({ finalResult, artifact }) => {
            const finalNodeLabel = getNodeDisplayLabel(selectedGraph, finalResult.final_node_id)

            return (
              <div key={finalResult.id} className="space-y-2 rounded-sm border border-border bg-background/40 p-2.5">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Badge variant="secondary">final</Badge>
                  <Badge variant="outline">{finalNodeLabel}</Badge>
                </div>
                <ExecutionArtifactCard artifact={artifact} compact />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
