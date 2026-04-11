import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CopyPlus, Trash2, XCircle } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import type {
  GraphExecutionRecord,
  GraphWorkflowBrowseContentRecord,
  GraphWorkflowFolderRecord,
  GraphWorkflowRecord,
} from '@/lib/api'
import { triggerBrowserDownload } from '@/lib/api-client'
import {
  cleanupGraphWorkflowEmptyExecutions,
  copyGraphWorkflowArtifactsToFolder,
  deleteGraphWorkflowArtifacts,
} from '@/lib/api-module-graph'
import { getWatchedFolders } from '@/lib/api-folders'
import { cancelGraphExecution } from '@/lib/api'
import {
  buildModuleWorkflowOutputCollections,
  filterModuleWorkflowTechnicalArtifacts,
  listModuleWorkflowArtifactTypes,
  type ModuleWorkflowGeneratedOutputItem,
} from './module-workflow-output-management-panel-helpers'
import { ModuleWorkflowGeneratedOutputsTab } from './module-workflow-generated-outputs-tab'
import { ModuleWorkflowArtifactRecordsTab } from './module-workflow-artifact-records-tab'
import { ModuleWorkflowEmptyRunsTab } from './module-workflow-empty-runs-tab'

type BrowseTab = 'outputs' | 'artifacts' | 'queue'

const BROWSE_TAB_ITEMS = [
  { value: 'outputs', label: '생성 결과' },
  { value: 'artifacts', label: '텍스트 · 중간 산출물' },
  { value: 'queue', label: '대기열 · 빈 실행' },
]

/** Render folder/root-scoped workflow output management content inside browse mode. */
export function ModuleWorkflowOutputManagementPanel({
  selectedFolderRecord,
  browseContent,
  onRefresh,
}: {
  selectedFolderRecord: GraphWorkflowFolderRecord | null
  browseContent: GraphWorkflowBrowseContentRecord
  onRefresh?: () => Promise<unknown> | unknown
}) {
  const { showSnackbar } = useSnackbar()
  const [activeTab, setActiveTab] = useState<BrowseTab>('outputs')
  const [selectedOutputIds, setSelectedOutputIds] = useState<string[]>([])
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<number[]>([])
  const [selectedQueueExecutionIds, setSelectedQueueExecutionIds] = useState<number[]>([])
  const [artifactSearchTerm, setArtifactSearchTerm] = useState('')
  const [artifactTypeFilter, setArtifactTypeFilter] = useState('all')
  const [isDownloading, setIsDownloading] = useState(false)
  const [isCopyPanelOpen, setIsCopyPanelOpen] = useState(false)
  const [copyTargetFolderId, setCopyTargetFolderId] = useState('')
  const [isCopying, setIsCopying] = useState(false)
  const [isCleaningQueue, setIsCleaningQueue] = useState(false)
  const [isDeletingArtifacts, setIsDeletingArtifacts] = useState(false)

  const watchedFoldersQuery = useQuery({
    queryKey: ['watched-folders', 'output-copy-targets'],
    queryFn: () => getWatchedFolders(true),
    staleTime: 30_000,
  })

  const workflowNameById = useMemo(
    () => new Map<number, string>(browseContent.workflows.map((workflow: GraphWorkflowRecord) => [workflow.id, workflow.name])),
    [browseContent.workflows],
  )
  const executionById = useMemo(
    () => new Map<number, GraphExecutionRecord>(browseContent.executions.map((execution) => [execution.id, execution])),
    [browseContent.executions],
  )

  const outputCollections = useMemo(() => buildModuleWorkflowOutputCollections({
    browseContent,
    executionById,
    workflowNameById,
  }), [browseContent, executionById, workflowNameById])

  const artifactTypeOptions = useMemo(
    () => listModuleWorkflowArtifactTypes(outputCollections.technicalArtifacts),
    [outputCollections.technicalArtifacts],
  )

  const filteredTechnicalArtifacts = useMemo(() => filterModuleWorkflowTechnicalArtifacts({
    artifacts: outputCollections.technicalArtifacts,
    artifactSearchTerm,
    artifactTypeFilter,
    executionById,
    workflowNameById,
  }), [artifactSearchTerm, artifactTypeFilter, executionById, outputCollections.technicalArtifacts, workflowNameById])

  const queueExecutions = useMemo(
    () => browseContent.empty_executions,
    [browseContent.empty_executions],
  )

  const selectedOutputItems = useMemo(
    () => outputCollections.outputItems.filter((item) => selectedOutputIds.includes(item.id)),
    [outputCollections.outputItems, selectedOutputIds],
  )
  const downloadableSelectedItems = useMemo(
    () => selectedOutputItems.filter((item) => Boolean(item.downloadUrl)),
    [selectedOutputItems],
  )
  const selectedArtifacts = useMemo(
    () => filteredTechnicalArtifacts.filter((artifact) => selectedArtifactIds.includes(artifact.id)),
    [filteredTechnicalArtifacts, selectedArtifactIds],
  )
  const selectedQueueExecutions = useMemo(
    () => queueExecutions.filter((execution) => selectedQueueExecutionIds.includes(execution.id)),
    [queueExecutions, selectedQueueExecutionIds],
  )
  const cancelableQueueExecutions = useMemo(
    () => selectedQueueExecutions.filter((execution) => execution.status === 'queued' || execution.status === 'running'),
    [selectedQueueExecutions],
  )
  const deletableQueueExecutions = useMemo(
    () => selectedQueueExecutions.filter((execution) => execution.status !== 'queued' && execution.status !== 'running'),
    [selectedQueueExecutions],
  )

  useEffect(() => {
    setSelectedOutputIds((current) => current.filter((id) => outputCollections.outputItems.some((item) => item.id === id)))
  }, [outputCollections.outputItems])

  useEffect(() => {
    setSelectedArtifactIds((current) => current.filter((id) => filteredTechnicalArtifacts.some((artifact) => artifact.id === id)))
  }, [filteredTechnicalArtifacts])

  useEffect(() => {
    setSelectedQueueExecutionIds((current) => current.filter((id) => queueExecutions.some((execution) => execution.id === id)))
  }, [queueExecutions])

  useEffect(() => {
    if (activeTab !== 'outputs') {
      setSelectedOutputIds([])
      setIsCopyPanelOpen(false)
    }

    if (activeTab !== 'artifacts') {
      setSelectedArtifactIds([])
    }
  }, [activeTab])

  const handleToggleArtifactSelection = (artifactId: number) => {
    setSelectedArtifactIds((current) => (
      current.includes(artifactId)
        ? current.filter((id) => id !== artifactId)
        : [...current, artifactId]
    ))
  }

  const handleToggleQueueSelection = (executionId: number) => {
    setSelectedQueueExecutionIds((current) => (
      current.includes(executionId)
        ? current.filter((id) => id !== executionId)
        : [...current, executionId]
    ))
  }

  const handleDownloadItems = (items: ModuleWorkflowGeneratedOutputItem[]) => {
    const downloadableItems = items.filter((item) => item.downloadUrl)
    if (downloadableItems.length === 0) {
      return
    }

    setIsDownloading(true)
    downloadableItems.forEach((item, index) => {
      window.setTimeout(() => {
        if (item.downloadUrl) {
          triggerBrowserDownload(item.downloadUrl, item.downloadName)
        }
      }, index * 180)
    })

    window.setTimeout(() => {
      setIsDownloading(false)
    }, downloadableItems.length * 180 + 300)
  }

  const handleCopySelectedToFolder = async () => {
    const targetFolderId = Number(copyTargetFolderId)
    const sourcePaths = selectedOutputItems
      .map((item) => item.storagePath)
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)

    if (!Number.isFinite(targetFolderId)) {
      showSnackbar({ message: '복사할 대상 폴더를 먼저 골라줘.', tone: 'error' })
      return
    }

    if (sourcePaths.length === 0) {
      showSnackbar({ message: '복사 가능한 원본 경로가 있는 생성물을 먼저 선택해줘.', tone: 'error' })
      return
    }

    try {
      setIsCopying(true)
      const result = await copyGraphWorkflowArtifactsToFolder({
        folder_id: targetFolderId,
        source_paths: sourcePaths,
      })
      setIsCopyPanelOpen(false)
      setSelectedOutputIds([])
      showSnackbar({
        message: `복사 완료. ${result.copied_count}개 복사, ${result.skipped_count}개 건너뜀.`,
        tone: result.skipped_count > 0 ? 'error' : 'info',
      })
      await onRefresh?.()
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : '생성물 복사에 실패했어.',
        tone: 'error',
      })
    } finally {
      setIsCopying(false)
    }
  }

  const handleDeleteSelectedArtifacts = async (artifactIds?: number[]) => {
    const targetArtifactIds = artifactIds ?? selectedArtifacts.map((artifact) => artifact.id)
    if (targetArtifactIds.length === 0) {
      return
    }

    const confirmMessage = targetArtifactIds.length === 1
      ? '선택한 아티팩트를 정말 삭제할까? 이건 DB 정리용 삭제야.'
      : `선택한 ${targetArtifactIds.length.toLocaleString('ko-KR')}개 아티팩트를 정말 삭제할까? 이건 DB 정리용 삭제야.`

    if (!window.confirm(confirmMessage)) {
      return
    }

    try {
      setIsDeletingArtifacts(true)
      const result = await deleteGraphWorkflowArtifacts({ artifact_ids: targetArtifactIds })
      setSelectedArtifactIds([])
      showSnackbar({
        message: `아티팩트 정리 완료. ${result.deleted_count}개 삭제, ${result.missing.length}개 누락.`,
        tone: result.missing.length > 0 || result.skipped_files.length > 0 ? 'error' : 'info',
      })
      await onRefresh?.()
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : '아티팩트 삭제에 실패했어.',
        tone: 'error',
      })
    } finally {
      setIsDeletingArtifacts(false)
    }
  }

  const handleCancelSelectedQueueExecutions = async (executionIds?: number[]) => {
    const cancelTargets = executionIds
      ? queueExecutions.filter((execution) => executionIds.includes(execution.id) && (execution.status === 'queued' || execution.status === 'running'))
      : cancelableQueueExecutions

    if (cancelTargets.length === 0) {
      return
    }

    try {
      setIsCleaningQueue(true)
      const results = await Promise.allSettled(cancelTargets.map((execution) => cancelGraphExecution(execution.id)))
      const successCount = results.filter((result) => result.status === 'fulfilled').length
      showSnackbar({
        message: successCount === cancelTargets.length
          ? `${successCount}개 실행 취소 요청 완료.`
          : `${successCount}개 실행 취소 요청 완료, 일부는 실패했어.`,
        tone: successCount === cancelTargets.length ? 'info' : 'error',
      })
      setSelectedQueueExecutionIds([])
      await onRefresh?.()
    } finally {
      setIsCleaningQueue(false)
    }
  }

  const handleCleanupSelectedEmptyRuns = async (executionIds?: number[]) => {
    const cleanupTargets = executionIds
      ? queueExecutions.filter((execution) => executionIds.includes(execution.id) && execution.status !== 'queued' && execution.status !== 'running')
      : deletableQueueExecutions

    if (cleanupTargets.length === 0) {
      return
    }

    try {
      setIsCleaningQueue(true)
      const result = await cleanupGraphWorkflowEmptyExecutions({
        execution_ids: cleanupTargets.map((execution) => execution.id),
      })
      showSnackbar({
        message: `정리 완료. ${result.deleted_count}개 삭제, ${result.skipped.length}개 건너뜀.`,
        tone: result.skipped.length > 0 ? 'error' : 'info',
      })
      setSelectedQueueExecutionIds([])
      await onRefresh?.()
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : '빈 실행 정리에 실패했어.',
        tone: 'error',
      })
    } finally {
      setIsCleaningQueue(false)
    }
  }

  const allVisibleSelected = outputCollections.outputItems.length > 0 && selectedOutputIds.length === outputCollections.outputItems.length
  const allArtifactSelected = filteredTechnicalArtifacts.length > 0 && selectedArtifactIds.length === filteredTechnicalArtifacts.length
  const allQueueSelected = queueExecutions.length > 0 && selectedQueueExecutionIds.length === queueExecutions.length

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {selectedFolderRecord ? `${selectedFolderRecord.name} · 워크플로우 생성물` : '워크플로우 생성물'}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-sm border border-border bg-surface-low px-3 py-2">
            <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Workflows</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{browseContent.scope.workflow_count}</div>
          </div>
          <div className="rounded-sm border border-border bg-surface-low px-3 py-2">
            <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Executions</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{browseContent.scope.execution_count}</div>
          </div>
          <div className="rounded-sm border border-border bg-surface-low px-3 py-2">
            <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Artifacts</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{browseContent.scope.artifact_count}</div>
          </div>
          <div className="rounded-sm border border-border bg-surface-low px-3 py-2">
            <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">최종 결과</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{browseContent.scope.final_result_count}</div>
          </div>
          <div className="rounded-sm border border-border bg-surface-low px-3 py-2">
            <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Empty Runs</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{browseContent.scope.empty_execution_count}</div>
          </div>
        </CardContent>
      </Card>

      <SegmentedTabBar value={activeTab} items={BROWSE_TAB_ITEMS} onChange={(next) => setActiveTab(next as BrowseTab)} />

      {activeTab === 'outputs' ? (
        <ModuleWorkflowGeneratedOutputsTab
          outputItems={outputCollections.outputItems}
          imageItems={outputCollections.outputImageItems}
          selectedOutputIds={selectedOutputIds}
          allVisibleSelected={allVisibleSelected}
          isCopyPanelOpen={isCopyPanelOpen}
          copyTargetFolderId={copyTargetFolderId}
          isCopying={isCopying}
          isDownloading={isDownloading}
          watchedFolders={watchedFoldersQuery.data ?? []}
          watchedFoldersLoading={watchedFoldersQuery.isLoading}
          onToggleVisibleSelection={() => setSelectedOutputIds(allVisibleSelected ? [] : outputCollections.outputItems.map((item) => item.id))}
          onSelectedOutputIdsChange={setSelectedOutputIds}
          onCopyTargetFolderChange={setCopyTargetFolderId}
          onCloseCopyPanel={() => setIsCopyPanelOpen(false)}
          onCopySelected={() => void handleCopySelectedToFolder()}
          onDownloadItems={handleDownloadItems}
        />
      ) : null}

      {activeTab === 'artifacts' ? (
        <ModuleWorkflowArtifactRecordsTab
          artifacts={filteredTechnicalArtifacts}
          selectedArtifactIds={selectedArtifactIds}
          allVisibleSelected={allArtifactSelected}
          workflowNameById={workflowNameById}
          executionById={executionById}
          artifactSearchTerm={artifactSearchTerm}
          artifactTypeFilter={artifactTypeFilter}
          artifactTypeOptions={artifactTypeOptions}
          isDeletingArtifacts={isDeletingArtifacts}
          onArtifactSearchTermChange={setArtifactSearchTerm}
          onArtifactTypeFilterChange={setArtifactTypeFilter}
          onToggleVisibleSelection={() => setSelectedArtifactIds(allArtifactSelected ? [] : filteredTechnicalArtifacts.map((artifact) => artifact.id))}
          onToggleArtifactSelection={handleToggleArtifactSelection}
          onSetSelectedArtifactIds={setSelectedArtifactIds}
          onDeleteSingle={(artifactId) => {
            setSelectedArtifactIds([artifactId])
            void handleDeleteSelectedArtifacts([artifactId])
          }}
        />
      ) : null}

      {activeTab === 'queue' ? (
        <ModuleWorkflowEmptyRunsTab
          queueExecutions={queueExecutions}
          selectedQueueExecutionIds={selectedQueueExecutionIds}
          allQueueSelected={allQueueSelected}
          workflowNameById={workflowNameById}
          isCleaningQueue={isCleaningQueue}
          onToggleVisibleSelection={() => setSelectedQueueExecutionIds(allQueueSelected ? [] : queueExecutions.map((execution) => execution.id))}
          onToggleQueueSelection={handleToggleQueueSelection}
          onCancelSingle={(executionId) => {
            setSelectedQueueExecutionIds([executionId])
            void handleCancelSelectedQueueExecutions([executionId])
          }}
          onDeleteSingle={(executionId) => {
            setSelectedQueueExecutionIds([executionId])
            void handleCleanupSelectedEmptyRuns([executionId])
          }}
        />
      ) : null}

      {activeTab === 'outputs' ? (
        <ImageSelectionBar
          selectedCount={selectedOutputItems.length}
          downloadableCount={downloadableSelectedItems.length}
          isDownloading={isDownloading}
          showDownloadAction
          statusText={downloadableSelectedItems.length > 0
            ? `${downloadableSelectedItems.length.toLocaleString('ko-KR')}개 다운로드 가능`
            : '다운로드 가능 항목 없음'}
          extraActions={(
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsCopyPanelOpen((current) => !current)}
              data-no-select-drag="true"
            >
              <CopyPlus className="h-4 w-4" />
              Copy to Folder
            </Button>
          )}
          onDownload={() => handleDownloadItems(downloadableSelectedItems)}
          onClear={() => setSelectedOutputIds([])}
        />
      ) : null}

      {activeTab === 'artifacts' ? (
        <SelectionActionBar
          selectedCount={selectedArtifacts.length}
          summary={`${selectedArtifacts.length.toLocaleString('ko-KR')}개 아티팩트 선택됨`}
          onClear={() => setSelectedArtifactIds([])}
          actions={(
            <Button
              size="icon-sm"
              variant="destructive"
              onClick={() => void handleDeleteSelectedArtifacts()}
              disabled={isDeletingArtifacts || selectedArtifacts.length === 0}
              title={`Delete selected artifacts (${selectedArtifacts.length})`}
              aria-label={`Delete selected artifacts (${selectedArtifacts.length})`}
              data-no-select-drag="true"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        />
      ) : null}

      {activeTab === 'queue' ? (
        <SelectionActionBar
          selectedCount={selectedQueueExecutions.length}
          summary={`${selectedQueueExecutions.length.toLocaleString('ko-KR')}개 실행 선택됨`}
          description={`${cancelableQueueExecutions.length.toLocaleString('ko-KR')}개 취소 가능 · ${deletableQueueExecutions.length.toLocaleString('ko-KR')}개 삭제 가능`}
          onClear={() => setSelectedQueueExecutionIds([])}
          actions={(
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleCancelSelectedQueueExecutions()}
                disabled={isCleaningQueue || cancelableQueueExecutions.length === 0}
                data-no-select-drag="true"
              >
                <XCircle className="h-4 w-4" />
                Cancel Active ({cancelableQueueExecutions.length})
              </Button>
              <Button
                size="sm"
                onClick={() => void handleCleanupSelectedEmptyRuns()}
                disabled={isCleaningQueue || deletableQueueExecutions.length === 0}
                data-no-select-drag="true"
              >
                <Trash2 className="h-4 w-4" />
                Delete Empty ({deletableQueueExecutions.length})
              </Button>
            </>
          )}
        />
      ) : null}
    </div>
  )
}
