import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CopyPlus, Download, Square, SquareCheckBig, Trash2, XCircle } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
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
import { formatDateTime, getArtifactPreviewUrl, parseMetadataValue } from '../module-graph-shared'

type BrowseTab = 'outputs' | 'queue'

type OutputListItem = {
  id: string
  type: GraphExecutionArtifactRecord['artifact_type']
  previewUrl: string | null
  downloadUrl: string | null
  downloadName: string
  createdDate: string
  workflowName: string
  executionId: number
  storagePath: string | null
  label: string
  status?: GraphExecutionRecord['status']
}

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

  const outputItems = useMemo<OutputListItem[]>(() => {
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

  const handleDownloadItems = (items: OutputListItem[]) => {
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

  const handleCancelSelectedQueueExecutions = async () => {
    if (cancelableQueueExecutions.length === 0) {
      return
    }

    try {
      setIsCleaningQueue(true)
      const results = await Promise.allSettled(cancelableQueueExecutions.map((execution) => cancelGraphExecution(execution.id)))
      const successCount = results.filter((result) => result.status === 'fulfilled').length
      showSnackbar({
        message: successCount === cancelableQueueExecutions.length
          ? `${successCount}개 실행 취소 요청 완료.`
          : `${successCount}개 실행 취소 요청 완료, 일부는 실패했어.`,
        tone: successCount === cancelableQueueExecutions.length ? 'info' : 'error',
      })
      setSelectedQueueExecutionIds([])
      await onRefresh?.()
    } finally {
      setIsCleaningQueue(false)
    }
  }

  const handleCleanupSelectedEmptyRuns = async () => {
    if (deletableQueueExecutions.length === 0) {
      return
    }

    try {
      setIsCleaningQueue(true)
      const result = await cleanupGraphWorkflowEmptyExecutions({
        execution_ids: deletableQueueExecutions.map((execution) => execution.id),
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">Generated Outputs</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{outputItems.length}</Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSelectedOutputIds(allVisibleSelected ? [] : outputItems.map((item) => item.id))}
                disabled={outputItems.length === 0}
              >
                {allVisibleSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {allVisibleSelected ? 'Clear Visible' : 'Select Visible'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isCopyPanelOpen ? (
              <div className="rounded-sm border border-border bg-surface-low px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">Copy selected outputs to watched folder</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      선택한 생성물을 watched folder로 복사한 뒤, 기존 스캐너 흐름에 맡겨 관리 라이브러리에 편입시켜.
                    </div>
                  </div>
                  <Badge variant="outline">{selectedOutputItems.length}</Badge>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Target folder</div>
                    <Select value={copyTargetFolderId} onChange={(event) => setCopyTargetFolderId(event.target.value)}>
                      <option value="">폴더 선택</option>
                      {(watchedFoldersQuery.data ?? []).map((folder) => (
                        <option key={folder.id} value={String(folder.id)}>
                          {folder.folder_name}
                        </option>
                      ))}
                    </Select>
                    {copyTargetFolderId ? (
                      <div className="text-xs text-muted-foreground">
                        {(watchedFoldersQuery.data ?? []).find((folder) => String(folder.id) === copyTargetFolderId)?.folder_path}
                      </div>
                    ) : null}
                  </div>

                  <Button type="button" variant="ghost" onClick={() => setIsCopyPanelOpen(false)} disabled={isCopying}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={() => void handleCopySelectedToFolder()} disabled={isCopying || watchedFoldersQuery.isLoading || !copyTargetFolderId}>
                    <CopyPlus className="h-4 w-4" />
                    {isCopying ? 'Copying…' : 'Copy Selected'}
                  </Button>
                </div>
              </div>
            ) : null}

            {outputItems.length === 0 ? (
              <div className="rounded-sm border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
                No generated outputs were found in this scope yet.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {outputItems.map((item) => {
                  const isSelected = selectedOutputIds.includes(item.id)

                  return (
                    <div
                      key={item.id}
                      className={`overflow-hidden rounded-sm border bg-surface-low transition ${isSelected ? 'border-primary shadow-sm ring-1 ring-primary/30' : 'border-border'}`}
                    >
                      <button
                        type="button"
                        className="block w-full text-left"
                        onClick={() => handleToggleOutputSelection(item.id)}
                        title={isSelected ? 'Deselect output' : 'Select output'}
                      >
                        {item.previewUrl ? (
                          <div className="relative aspect-[4/3] border-b border-border bg-black/10">
                            <img src={item.previewUrl} alt={item.label} className="h-full w-full object-contain" />
                            <div className="absolute right-2 top-2">
                              <Badge variant={isSelected ? 'secondary' : 'outline'}>{isSelected ? 'Selected' : 'Select'}</Badge>
                            </div>
                          </div>
                        ) : (
                          <div className="relative flex aspect-[4/3] items-center justify-center border-b border-border bg-surface-high text-xs uppercase tracking-[0.12em] text-muted-foreground">
                            {item.type}
                            <div className="absolute right-2 top-2">
                              <Badge variant={isSelected ? 'secondary' : 'outline'}>{isSelected ? 'Selected' : 'Select'}</Badge>
                            </div>
                          </div>
                        )}
                      </button>

                      <div className="space-y-2 px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-medium text-foreground">{item.workflowName}</div>
                          {item.status ? <Badge variant="outline">{item.status}</Badge> : null}
                        </div>
                        <div className="text-xs text-muted-foreground">{item.label}</div>
                        <div className="text-xs text-muted-foreground">Execution #{item.executionId} · {formatDateTime(item.createdDate)}</div>
                        {item.storagePath ? (
                          <div className="truncate text-[11px] text-muted-foreground">{item.storagePath}</div>
                        ) : null}

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <Button type="button" size="sm" variant="outline" onClick={() => handleToggleOutputSelection(item.id)}>
                            {isSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                            {isSelected ? 'Selected' : 'Select'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleDownloadItems([item])}
                            disabled={!item.downloadUrl || isDownloading}
                          >
                            <Download className="h-4 w-4" />
                            Download
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
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">Queue & Empty Runs</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{queueExecutions.length}</Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSelectedQueueExecutionIds(allQueueSelected ? [] : queueExecutions.map((execution) => execution.id))}
                disabled={queueExecutions.length === 0}
              >
                {allQueueSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {allQueueSelected ? 'Clear Visible' : 'Select Visible'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {queueExecutions.length === 0 ? (
              <div className="rounded-sm border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
                No empty or output-less executions were found in this scope.
              </div>
            ) : (
              <div className="space-y-3">
                {queueExecutions.map((execution) => {
                  const isSelected = selectedQueueExecutionIds.includes(execution.id)
                  const isCancelable = execution.status === 'queued' || execution.status === 'running'

                  return (
                    <div key={execution.id} className={`rounded-sm border px-4 py-3 ${isSelected ? 'border-primary bg-primary/5' : 'border-border bg-surface-low'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button type="button" className="text-sm font-medium text-foreground" onClick={() => handleToggleQueueSelection(execution.id)}>
                              {workflowNameById.get(execution.graph_workflow_id) ?? `Workflow #${execution.graph_workflow_id}`}
                            </button>
                            <Badge variant={isSelected ? 'secondary' : 'outline'}>{isSelected ? 'Selected' : 'Select'}</Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Execution #{execution.id} · created {formatDateTime(execution.created_date)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={execution.status === 'failed' ? 'destructive' : 'outline'}>{execution.status}</Badge>
                          {execution.queue_position !== null && execution.queue_position !== undefined ? <Badge variant="outline">Queue {execution.queue_position}</Badge> : null}
                          <Button type="button" size="sm" variant="ghost" onClick={() => handleToggleQueueSelection(execution.id)}>
                            {isSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                          </Button>
                          {isCancelable ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => { setSelectedQueueExecutionIds([execution.id]); void handleCancelSelectedQueueExecutions() }} disabled={isCleaningQueue}>
                              <XCircle className="h-4 w-4" />
                              Cancel
                            </Button>
                          ) : (
                            <Button type="button" size="sm" onClick={() => { setSelectedQueueExecutionIds([execution.id]); void handleCleanupSelectedEmptyRuns() }} disabled={isCleaningQueue}>
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </div>
                      {execution.error_message ? (
                        <div className="mt-3 rounded-sm border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground">
                          {execution.error_message}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
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
