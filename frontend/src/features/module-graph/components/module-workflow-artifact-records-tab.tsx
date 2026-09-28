import { useMemo, useState } from 'react'
import { FileSearch, Square, SquareCheckBig, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Panel } from '@/components/ui/panel'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useImageListSelection } from '@/features/images/components/image-list/use-image-list-selection'
import { useI18n } from '@/i18n'
import type { GraphExecutionArtifactRecord, GraphExecutionRecord } from '@/lib/api-module-graph'
import { ModuleWorkflowPagedResultsSection } from './module-workflow-paged-results-section'
import { buildArtifactTextPreview } from '../module-graph-shared'
import { EmptyState } from '@/components/ui/empty-state'

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
  const selectedArtifactIdSet = useMemo(
    () => new Set(selectedArtifactIds),
    [selectedArtifactIds],
  )

  return (
    <ModuleWorkflowPagedResultsSection
      heading={t('module-graph.components.module.workflow.artifact.records.tab.text.and.intermediate.artifacts')}
      page={page}
      totalPages={totalPages}
      visibleCount={artifacts.length}
      totalCount={totalArtifactCount}
      allVisibleSelected={allVisibleSelected}
      selectPageLabel={t('module-graph.components.module.workflow.artifact.records.tab.select.page')}
      clearPageLabel={t('module-graph.components.module.workflow.artifact.records.tab.clear.page')}
      canClearAll={canDeleteArtifacts}
      isClearing={isDeletingArtifacts}
      onPageChange={onPageChange}
      onToggleVisibleSelection={onToggleVisibleSelection}
      onClearAll={onClearAll}
      toolbar={(
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
      )}
      isEmpty={artifacts.length === 0}
      empty={<EmptyState icon={FileSearch} title={t({ ko: '검색/필터 조건에 맞는 텍스트 또는 중간 산출물이 없어.', en: 'No text or intermediate artifacts match the search/filter.' })} />}
      listContainerRef={setArtifactSelectionContainer}
    >
      {artifacts.map((artifact) => {
        const execution = executionById.get(artifact.execution_id)
        const workflowName = execution
          ? (workflowNameById.get(execution.graph_workflow_id) ?? `Workflow #${execution.graph_workflow_id}`)
          : 'Unknown workflow'
        const isSelected = selectedArtifactIdSet.has(artifact.id)
        const previewText = buildArtifactTextPreview(artifact, 220)

        return (
          <Panel
            key={artifact.id}
            tone="lowest"
            interactive
            data-selected={isSelected}
            data-image-id={String(artifact.id)}
            className="image-list-selectable"
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
                  {execution?.status ? <Badge variant="outline">{execution.status}</Badge> : null}
                </div>

                <div className="text-xs text-muted-foreground">
                  Execution #{artifact.execution_id} · {formatDateTime(artifact.created_date)}
                </div>

                {previewText ? (
                  <div className="overflow-hidden text-sm text-foreground whitespace-pre-wrap break-all">{previewText}</div>
                ) : null}

                {artifact.storage_path ? (
                  <div className="overflow-hidden text-2xs text-muted-foreground break-all">{artifact.storage_path}</div>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <IconButton
                  size="icon-sm"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleArtifactSelection(artifact.id)
                  }}
                  label={isSelected ? 'Deselect artifact' : 'Select artifact'}
                  data-no-select-drag="true"
                >
                  {isSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                </IconButton>
                {canDeleteArtifacts ? (
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteSingle(artifact.id)
                    }}
                    disabled={isDeletingArtifacts}
                    label={t({ ko: '결과물 삭제', en: 'Delete artifact' })}
                    data-no-select-drag="true"
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                ) : null}
              </div>
            </div>
          </Panel>
        )
      })}
    </ModuleWorkflowPagedResultsSection>
  )
}
