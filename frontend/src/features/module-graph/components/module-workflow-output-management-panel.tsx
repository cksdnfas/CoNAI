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
  GraphExecutionArtifactRecord,
  GraphExecutionFinalResultRecord,
  GraphExecutionRecord,
  GraphWorkflowBrowseContentRecord,
  GraphWorkflowFolderRecord,
  GraphWorkflowRecord,
} from '@/lib/api'
import { buildApiUrl, triggerBrowserDownload } from '@/lib/api-client'
import { cleanupGraphWorkflowEmptyExecutions, copyGraphWorkflowArtifactsToFolder } from '@/lib/api-module-graph'
import { getWatchedFolders } from '@/lib/api-folders'
import { cancelGraphExecution } from '@/lib/api'
import { getArtifactPreviewUrl, parseMetadataValue } from '../module-graph-shared'
import {
  ModuleWorkflowGeneratedOutputsTab,
  type ModuleWorkflowGeneratedOutputItem,
} from './module-workflow-generated-outputs-tab'
import { ModuleWorkflowEmptyRunsTab } from './module-workflow-empty-runs-tab'

type BrowseTab = 'outputs' | 'queue'


const BROWSE_TAB_ITEMS = [
  { value: 'outputs', label: 'Generated Outputs' },
  { value: 'queue', label: 'Queue & Empty Runs' },
]

function buildSourcePreviewUrl(path?: string | null) {
  if (!path) {
    return null
  }

  const normalized = path.replace(/\\/g, '/')
  const marker = '/graph-executions/'
  const markerIndex = normalized.lastIndexOf(marker)
  if (markerIndex === -1) {
    return null
  }

  return buildApiUrl(`/temp${normalized.slice(markerIndex)}`)
}

function buildDownloadName(path: string | null | undefined, fallbackLabel: string, executionId: number) {
  if (path) {
    const normalized = path.replace(/\\/g, '/')
    const baseName = normalized.split('/').pop()
    if (baseName && baseName.trim().length > 0) {
      return baseName
    }
  }

  const sanitizedLabel = fallbackLabel.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact'
  return `execution-${executionId}-${sanitizedLabel}`
}

function getArtifactLabel(artifact: GraphExecutionArtifactRecord | GraphExecutionFinalResultRecord) {
  const rawMetadata = 'source_metadata' in artifact
    ? artifact.source_metadata
    : (artifact as GraphExecutionArtifactRecord).metadata
  const metadata = parseMetadataValue(rawMetadata)
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const candidate = metadata.label ?? metadata.kind ?? metadata.mimeType
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate
    }
  }

  return artifact.artifact_type
}

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
  const [selectedQueueExecutionIds, setSelectedQueueExecutionIds] = useState<number[]>([])
  const [isDownloading, setIsDownloading] = useState(false)
  const [isCopyPanelOpen, setIsCopyPanelOpen] = useState(false)
  const [copyTargetFolderId, setCopyTargetFolderId] = useState('')
  const [isCopying, setIsCopying] = useState(false)
  const [isCleaningQueue, setIsCleaningQueue] = useState(false)

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

  const outputItems = useMemo<ModuleWorkflowGeneratedOutputItem[]>(() => {
    if (browseContent.final_results.length > 0) {
      return browseContent.final_results.map((result) => {
        const execution = executionById.get(result.execution_id)
        const downloadUrl = buildSourcePreviewUrl(result.source_storage_path)
        const label = getArtifactLabel(result)
        return {
          id: `final-${result.id}`,
          type: result.artifact_type,
          previewUrl: downloadUrl,
          downloadUrl,
          downloadName: buildDownloadName(result.source_storage_path, label, result.execution_id),
          createdDate: result.created_date,
          workflowName: execution ? (workflowNameById.get(execution.graph_workflow_id) ?? `Workflow #${execution.graph_workflow_id}`) : 'Unknown workflow',
          executionId: result.execution_id,
          storagePath: result.source_storage_path ?? null,
          label,
          status: execution?.status,
        }
      })
    }

    return browseContent.artifacts.map((artifact) => {
      const execution = executionById.get(artifact.execution_id)
      const downloadUrl = getArtifactPreviewUrl(artifact)
      const label = getArtifactLabel(artifact)
      return {
        id: `artifact-${artifact.id}`,
        type: artifact.artifact_type,
        previewUrl: downloadUrl,
        downloadUrl,
        downloadName: buildDownloadName(artifact.storage_path, label, artifact.execution_id),
        createdDate: artifact.created_date,
        workflowName: execution ? (workflowNameById.get(execution.graph_workflow_id) ?? `Workflow #${execution.graph_workflow_id}`) : 'Unknown workflow',
        executionId: artifact.execution_id,
        storagePath: artifact.storage_path ?? null,
        label,
        status: execution?.status,
      }
    })
  }, [browseContent.artifacts, browseContent.final_results, executionById, workflowNameById])

  const queueExecutions = useMemo(
    () => browseContent.empty_executions,
    [browseContent.empty_executions],
  )

  const selectedOutputItems = useMemo(
    () => outputItems.filter((item) => selectedOutputIds.includes(item.id)),
    [outputItems, selectedOutputIds],
  )
  const downloadableSelectedItems = useMemo(
    () => selectedOutputItems.filter((item) => Boolean(item.downloadUrl)),
    [selectedOutputItems],
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
    setSelectedOutputIds((current) => current.filter((id) => outputItems.some((item) => item.id === id)))
  }, [outputItems])

  useEffect(() => {
    setSelectedQueueExecutionIds((current) => current.filter((id) => queueExecutions.some((execution) => execution.id === id)))
  }, [queueExecutions])

  useEffect(() => {
    if (activeTab !== 'outputs') {
      setSelectedOutputIds([])
      setIsCopyPanelOpen(false)
    }
  }, [activeTab])

  const handleToggleOutputSelection = (outputId: string) => {
    setSelectedOutputIds((current) => (
      current.includes(outputId)
        ? current.filter((id) => id !== outputId)
        : [...current, outputId]
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

  const allVisibleSelected = outputItems.length > 0 && selectedOutputIds.length === outputItems.length
  const allQueueSelected = queueExecutions.length > 0 && selectedQueueExecutionIds.length === queueExecutions.length

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">
            {selectedFolderRecord ? `${selectedFolderRecord.name} · Generated Workflow Content` : 'Module Workflow Output Inbox'}
          </CardTitle>
          <div className="text-sm text-muted-foreground">
            {selectedFolderRecord
              ? 'Browse generated outputs and empty runs produced by workflows in this folder subtree.'
              : 'Browse recent generated outputs and cleanup targets across all workflow folders.'}
          </div>
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
            <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Final Results</div>
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
          outputItems={outputItems}
          selectedOutputIds={selectedOutputIds}
          allVisibleSelected={allVisibleSelected}
          isCopyPanelOpen={isCopyPanelOpen}
          copyTargetFolderId={copyTargetFolderId}
          isCopying={isCopying}
          isDownloading={isDownloading}
          watchedFolders={watchedFoldersQuery.data ?? []}
          watchedFoldersLoading={watchedFoldersQuery.isLoading}
          onToggleVisibleSelection={() => setSelectedOutputIds(allVisibleSelected ? [] : outputItems.map((item) => item.id))}
          onToggleOutputSelection={handleToggleOutputSelection}
          onCopyTargetFolderChange={setCopyTargetFolderId}
          onCloseCopyPanel={() => setIsCopyPanelOpen(false)}
          onCopySelected={() => void handleCopySelectedToFolder()}
          onDownloadItems={handleDownloadItems}
        />
      ) : (
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
      )}

      <ImageSelectionBar
        selectedCount={selectedOutputItems.length}
        downloadableCount={downloadableSelectedItems.length}
        isDownloading={isDownloading}
        showDownloadAction
        statusText={downloadableSelectedItems.length > 0
          ? `${downloadableSelectedItems.length.toLocaleString('ko-KR')} generated output(s) ready to download`
          : 'No downloadable generated outputs in the current selection'}
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
