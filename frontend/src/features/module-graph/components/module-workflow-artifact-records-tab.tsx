import { useState } from 'react'
import { Square, SquareCheckBig, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useImageListSelection } from '@/features/images/components/image-list/use-image-list-selection'
import type { GraphExecutionArtifactRecord, GraphExecutionRecord } from '@/lib/api'
import { buildArtifactTextPreview, formatDateTime } from '../module-graph-shared'

/** Render non-media and intermediate workflow artifacts for cleanup-oriented management. */
export function ModuleWorkflowArtifactRecordsTab({
  artifacts,
  selectedArtifactIds,
  allVisibleSelected,
  workflowNameById,
  executionById,
  artifactSearchTerm,
  artifactTypeFilter,
  artifactTypeOptions,
  isDeletingArtifacts,
  onArtifactSearchTermChange,
  onArtifactTypeFilterChange,
  onToggleVisibleSelection,
  onToggleArtifactSelection,
  onSetSelectedArtifactIds,
  onDeleteSingle,
}: {
  artifacts: GraphExecutionArtifactRecord[]
  selectedArtifactIds: number[]
  allVisibleSelected: boolean
  workflowNameById: Map<number, string>
  executionById: Map<number, GraphExecutionRecord>
  artifactSearchTerm: string
  artifactTypeFilter: string
  artifactTypeOptions: string[]
  isDeletingArtifacts: boolean
  onArtifactSearchTermChange: (value: string) => void
  onArtifactTypeFilterChange: (value: string) => void
  onToggleVisibleSelection: () => void
  onToggleArtifactSelection: (artifactId: number) => void
  onSetSelectedArtifactIds: (artifactIds: number[]) => void
  onDeleteSingle: (artifactId: number) => void
}) {
  const [artifactSelectionContainer, setArtifactSelectionContainer] = useState<HTMLDivElement | null>(null)
  const { shouldSuppressClick } = useImageListSelection({
    containerElement: artifactSelectionContainer,
    selectable: true,
    selectedIds: selectedArtifactIds.map((artifactId) => String(artifactId)),
    onSelectedIdsChange: (nextIds) => onSetSelectedArtifactIds(nextIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))),
  })

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">Text & Intermediate Artifacts</CardTitle>
            <div className="text-sm text-muted-foreground">
              메타데이터, JSON, 텍스트 결과물, 그리고 최종 목록에 노출되지 않는 중간 산출물을 DB 기준으로 정리하는 영역이야.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{artifacts.length}</Badge>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={onToggleVisibleSelection}
              disabled={artifacts.length === 0}
              title={allVisibleSelected ? 'Clear visible artifacts' : 'Select visible artifacts'}
              aria-label={allVisibleSelected ? 'Clear visible artifacts' : 'Select visible artifacts'}
              data-no-select-drag="true"
            >
              {allVisibleSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <Input
            value={artifactSearchTerm}
            onChange={(event) => onArtifactSearchTermChange(event.target.value)}
            placeholder="워크플로우, 포트, 경로, 내용으로 검색"
          />
          <Select value={artifactTypeFilter} onChange={(event) => onArtifactTypeFilterChange(event.target.value)}>
            <option value="all">모든 타입</option>
            {artifactTypeOptions.map((artifactType) => (
              <option key={artifactType} value={artifactType}>{artifactType}</option>
            ))}
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {artifacts.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
            검색/필터 조건에 맞는 텍스트 또는 중간 산출물이 없어.
          </div>
        ) : (
          <div ref={setArtifactSelectionContainer} className="space-y-3">
            {artifacts.map((artifact) => {
              const execution = executionById.get(artifact.execution_id)
              const workflowName = execution
                ? (workflowNameById.get(execution.graph_workflow_id) ?? `Workflow #${execution.graph_workflow_id}`)
                : 'Unknown workflow'
              const isSelected = selectedArtifactIds.includes(artifact.id)
              const previewText = buildArtifactTextPreview(artifact, 220)

              return (
                <div
                  key={artifact.id}
                  data-image-id={String(artifact.id)}
                  className={`image-list-selectable rounded-sm border px-4 py-3 transition ${isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border bg-surface-low'}`}
                  onClick={() => {
                    if (shouldSuppressClick()) {
                      return
                    }
                    onToggleArtifactSelection(artifact.id)
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-foreground">{workflowName}</div>
                        <Badge variant="outline">{artifact.artifact_type}</Badge>
                        <Badge variant="outline">{artifact.port_key}</Badge>
                        {execution?.status ? <Badge variant="outline">{execution.status}</Badge> : null}
                      </div>

                      <div className="text-xs text-muted-foreground">
                        Execution #{artifact.execution_id} · {formatDateTime(artifact.created_date)}
                      </div>

                      {previewText ? (
                        <div className="overflow-hidden text-sm text-foreground whitespace-pre-wrap break-all">{previewText}</div>
                      ) : null}

                      {artifact.storage_path ? (
                        <div className="overflow-hidden text-[11px] text-muted-foreground break-all">{artifact.storage_path}</div>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation()
                          onToggleArtifactSelection(artifact.id)
                        }}
                        title={isSelected ? 'Deselect artifact' : 'Select artifact'}
                        aria-label={isSelected ? 'Deselect artifact' : 'Select artifact'}
                        data-no-select-drag="true"
                      >
                        {isSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="destructive"
                        onClick={(event) => {
                          event.stopPropagation()
                          onDeleteSingle(artifact.id)
                        }}
                        disabled={isDeletingArtifacts}
                        title="Delete artifact"
                        aria-label="Delete artifact"
                        data-no-select-drag="true"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
