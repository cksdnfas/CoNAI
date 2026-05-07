import { useState } from 'react'
import { Square, SquareCheckBig, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useImageListSelection } from '@/features/images/components/image-list/use-image-list-selection'
import { useI18n } from '@/i18n'
import type { GraphExecutionArtifactRecord, GraphExecutionRecord } from '@/lib/api-module-graph'
import { buildArtifactTextPreview } from '../module-graph-shared'

/** Render non-media and intermediate workflow artifacts for cleanup-oriented management. */
export function ModuleWorkflowArtifactRecordsTab({
  artifacts,
  totalArtifactCount,
  page,
  totalPages,
  selectedArtifactIds,
  allVisibleSelected,
  workflowNameById,
  executionById,
  artifactSearchTerm,
  artifactTypeFilter,
  artifactTypeOptions,
  isDeletingArtifacts,
  canDeleteArtifacts,
  onPageChange,
  onClearAll,
  onArtifactSearchTermChange,
  onArtifactTypeFilterChange,
  onToggleVisibleSelection,
  onToggleArtifactSelection,
  onSetSelectedArtifactIds,
  onDeleteSingle,
}: {
  artifacts: GraphExecutionArtifactRecord[]
  totalArtifactCount: number
  page: number
  totalPages: number
  selectedArtifactIds: number[]
  allVisibleSelected: boolean
  workflowNameById: Map<number, string>
  executionById: Map<number, GraphExecutionRecord>
  artifactSearchTerm: string
  artifactTypeFilter: string
  artifactTypeOptions: string[]
  isDeletingArtifacts: boolean
  canDeleteArtifacts: boolean
  onPageChange: (page: number) => void
  onClearAll: () => void
  onArtifactSearchTermChange: (value: string) => void
  onArtifactTypeFilterChange: (value: string) => void
  onToggleVisibleSelection: () => void
  onToggleArtifactSelection: (artifactId: number) => void
  onSetSelectedArtifactIds: (artifactIds: number[]) => void
  onDeleteSingle: (artifactId: number) => void
}) {
  const { t, formatDateTime } = useI18n()
  const [artifactSelectionContainer, setArtifactSelectionContainer] = useState<HTMLDivElement | null>(null)
  const { shouldSuppressClick } = useImageListSelection({
    containerElement: artifactSelectionContainer,
    selectable: true,
    selectedIds: selectedArtifactIds.map((artifactId) => String(artifactId)),
    onSelectedIdsChange: (nextIds) => onSetSelectedArtifactIds(nextIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))),
  })

  return (
    <Card>
      <CardHeader className="space-y-4 border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="min-w-0 flex-1 text-base">{t('module-graph.components.module.workflow.artifact.records.tab.text.and.intermediate.artifacts')}</CardTitle>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="outline">{totalArtifactCount}</Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onToggleVisibleSelection}
              disabled={artifacts.length === 0}
              title={allVisibleSelected ? 'Clear visible artifacts' : 'Select visible artifacts'}
              aria-label={allVisibleSelected ? 'Clear visible artifacts' : 'Select visible artifacts'}
              data-no-select-drag="true"
            >
              {allVisibleSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              {allVisibleSelected ? t('module-graph.components.module.workflow.artifact.records.tab.clear.page') : t('module-graph.components.module.workflow.artifact.records.tab.select.page')}
            </Button>
            {canDeleteArtifacts ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={onClearAll}
                disabled={isDeletingArtifacts || totalArtifactCount === 0}
                data-no-select-drag="true"
              >
                <Trash2 className="h-4 w-4" />
                {t({ ko: '전체 비우기', en: 'Clear all' })}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <Input
            value={artifactSearchTerm}
            onChange={(event) => onArtifactSearchTermChange(event.target.value)}
            placeholder={t('module-graph.components.module.workflow.artifact.records.tab.search.by.workflow.port.path.or.content')}
          />
          <Select value={artifactTypeFilter} onChange={(event) => onArtifactTypeFilterChange(event.target.value)}>
            <option value="all">{t('module-graph.components.module.workflow.artifact.records.tab.all.types')}</option>
            {artifactTypeOptions.map((artifactType) => (
              <option key={artifactType} value={artifactType}>{artifactType}</option>
            ))}
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {artifacts.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
            {t({ ko: '검색/필터 조건에 맞는 텍스트 또는 중간 산출물이 없어.', en: 'No text or intermediate artifacts match the search/filter.' })}
          </div>
        ) : (
          <div ref={setArtifactSelectionContainer} className="space-y-3">
            <WorkflowArtifactPagination page={page} totalPages={totalPages} totalCount={totalArtifactCount} onPageChange={onPageChange} />
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
                      {canDeleteArtifacts ? (
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
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
            <WorkflowArtifactPagination page={page} totalPages={totalPages} totalCount={totalArtifactCount} onPageChange={onPageChange} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function WorkflowArtifactPagination({
  page,
  totalPages,
  totalCount,
  onPageChange,
}: {
  page: number
  totalPages: number
  totalCount: number
  onPageChange: (page: number) => void
}) {
  const { t, formatNumber } = useI18n()

  if (totalPages <= 1) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-surface-low px-3 py-2 text-xs text-muted-foreground">
      <span>{t({ ko: '페이지 {page} / {totalPages} · 전체 {totalCount} · 페이지당 50개', en: 'page {page} / {totalPages} · total {totalCount} · 50 per page' }, { page: formatNumber(page), totalPages: formatNumber(totalPages), totalCount: formatNumber(totalCount) })}</span>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
          {t({ ko: '이전', en: 'Previous' })}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          {t({ ko: '다음', en: 'Next' })}
        </Button>
      </div>
    </div>
  )
}
