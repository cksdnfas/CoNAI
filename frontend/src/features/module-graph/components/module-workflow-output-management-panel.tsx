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
import {
  cleanupGraphWorkflowEmptyExecutions,
  copyGraphWorkflowArtifactsToFolder,
  deleteGraphWorkflowArtifacts,
} from '@/lib/api-module-graph'
import { getWatchedFolders } from '@/lib/api-folders'
import { cancelGraphExecution } from '@/lib/api'
import type { ImageRecord } from '@/types/image'
import { buildArtifactTextPreview, getArtifactPreviewUrl, parseMetadataValue } from '../module-graph-shared'
import {
  ModuleWorkflowGeneratedOutputsTab,
  type ModuleWorkflowGeneratedOutputItem,
} from './module-workflow-generated-outputs-tab'
import { ModuleWorkflowArtifactRecordsTab } from './module-workflow-artifact-records-tab'
import { ModuleWorkflowEmptyRunsTab } from './module-workflow-empty-runs-tab'

type BrowseTab = 'outputs' | 'artifacts' | 'queue'

type ArtifactLike = {
  artifact_type: string
  storage_path?: string | null
  metadata?: string | null
}

type FinalResultLike = {
  artifact_type: string
  source_storage_path?: string | null
  source_metadata?: string | null
}

const BROWSE_TAB_ITEMS = [
  { value: 'outputs', label: 'Generated Outputs' },
  { value: 'artifacts', label: 'Text & Intermediate' },
  { value: 'queue', label: 'Queue & Empty Runs' },
]

const IMAGE_EXTENSION_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
}

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

function parseArtifactMetadataValue(value?: string | null) {
  const metadata = parseMetadataValue(value)
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : null
}

function getArtifactLabel(artifact: GraphExecutionArtifactRecord | GraphExecutionFinalResultRecord) {
  const rawMetadata = 'source_metadata' in artifact
    ? artifact.source_metadata
    : ('metadata' in artifact ? artifact.metadata : null)
  const metadata = parseArtifactMetadataValue(rawMetadata)
  if (metadata) {
    const candidate = metadata.label ?? metadata.kind ?? metadata.mimeType
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate
    }
  }

  return artifact.artifact_type
}

function inferMimeTypeFromPath(path?: string | null) {
  if (!path) {
    return null
  }

  const normalized = path.replace(/\\/g, '/').toLowerCase()
  const lastDotIndex = normalized.lastIndexOf('.')
  if (lastDotIndex === -1) {
    return null
  }

  return IMAGE_EXTENSION_MIME_MAP[normalized.slice(lastDotIndex)] ?? null
}

function resolveArtifactMimeType(artifact: ArtifactLike | FinalResultLike) {
  const metadataKey = 'source_metadata' in artifact ? artifact.source_metadata : ('metadata' in artifact ? artifact.metadata : null)
  const storagePath = 'source_storage_path' in artifact ? artifact.source_storage_path : ('storage_path' in artifact ? artifact.storage_path : null)
  const metadata = parseArtifactMetadataValue(metadataKey)
  const metadataMimeType = metadata?.mimeType
  if (typeof metadataMimeType === 'string' && metadataMimeType.trim().length > 0) {
    return metadataMimeType
  }

  if (artifact.artifact_type === 'image') {
    return inferMimeTypeFromPath(storagePath) ?? 'image/png'
  }

  return inferMimeTypeFromPath(storagePath)
}

function isVisualArtifact(artifact: ArtifactLike | FinalResultLike) {
  const mimeType = resolveArtifactMimeType(artifact)
  if (mimeType?.startsWith('image/') || mimeType?.startsWith('video/')) {
    return true
  }

  return artifact.artifact_type === 'image'
}

function buildOutputImageRecord(item: ModuleWorkflowGeneratedOutputItem): ImageRecord {
  const mimeType = item.mimeType
  const fileType = mimeType?.startsWith('video/')
    ? 'video'
    : mimeType === 'image/gif'
      ? 'animated'
      : 'image'

  return {
    id: item.id,
    composite_hash: item.id,
    original_file_path: item.storagePath ?? item.downloadName,
    thumbnail_url: item.previewUrl,
    image_url: item.downloadUrl,
    mime_type: mimeType,
    file_type: fileType,
  }
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

  const outputCollections = useMemo(() => {
    const visualFinalResults = browseContent.final_results.filter((result) => isVisualArtifact(result))
    const executionIdsWithVisualFinalResults = new Set(visualFinalResults.map((result) => result.execution_id))
    const fallbackVisualArtifacts = browseContent.artifacts.filter((artifact) => (
      isVisualArtifact(artifact) && !executionIdsWithVisualFinalResults.has(artifact.execution_id)
    ))

    const outputItems: ModuleWorkflowGeneratedOutputItem[] = [
      ...visualFinalResults.map((result) => {
        const execution = executionById.get(result.execution_id)
        const downloadUrl = buildSourcePreviewUrl(result.source_storage_path)
        const label = getArtifactLabel(result)
        return {
          id: `final-${result.id}`,
          type: result.artifact_type,
          mimeType: resolveArtifactMimeType(result),
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
      }),
      ...fallbackVisualArtifacts.map((artifact) => {
        const execution = executionById.get(artifact.execution_id)
        const downloadUrl = getArtifactPreviewUrl(artifact)
        const label = getArtifactLabel(artifact)
        return {
          id: `artifact-${artifact.id}`,
          type: artifact.artifact_type,
          mimeType: resolveArtifactMimeType(artifact),
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
      }),
    ].sort((left, right) => new Date(right.createdDate).getTime() - new Date(left.createdDate).getTime())

    const representedArtifactIds = new Set<number>([
      ...visualFinalResults.map((result) => result.source_artifact_id),
      ...fallbackVisualArtifacts.map((artifact) => artifact.id),
    ])

    const technicalArtifacts = [...browseContent.artifacts]
      .filter((artifact) => !representedArtifactIds.has(artifact.id))
      .sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime())

    return {
      outputItems,
      outputImageItems: outputItems.map(buildOutputImageRecord),
      technicalArtifacts,
    }
  }, [browseContent.artifacts, browseContent.final_results, executionById, workflowNameById])

  const artifactTypeOptions = useMemo(
    () => Array.from(new Set(outputCollections.technicalArtifacts.map((artifact) => artifact.artifact_type))).sort((left, right) => left.localeCompare(right, 'en')),
    [outputCollections.technicalArtifacts],
  )

  const filteredTechnicalArtifacts = useMemo(() => {
    const normalizedSearch = artifactSearchTerm.trim().toLowerCase()

    return outputCollections.technicalArtifacts.filter((artifact) => {
      if (artifactTypeFilter !== 'all' && artifact.artifact_type !== artifactTypeFilter) {
        return false
      }

      if (!normalizedSearch) {
        return true
      }

      const execution = executionById.get(artifact.execution_id)
      const workflowName = execution ? (workflowNameById.get(execution.graph_workflow_id) ?? `Workflow #${execution.graph_workflow_id}`) : 'Unknown workflow'
      const previewText = buildArtifactTextPreview(artifact, 220) ?? ''
      const haystack = [
        workflowName,
        artifact.artifact_type,
        artifact.port_key,
        previewText,
        artifact.storage_path ?? '',
      ].join(' ').toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [artifactSearchTerm, artifactTypeFilter, executionById, outputCollections.technicalArtifacts, workflowNameById])

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
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">
            {selectedFolderRecord ? `${selectedFolderRecord.name} · Generated Workflow Content` : 'Module Workflow Output Inbox'}
          </CardTitle>
          <div className="text-sm text-muted-foreground">
            {selectedFolderRecord
              ? 'Browse generated outputs and cleanup targets produced by workflows in this folder subtree.'
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
            ? `${downloadableSelectedItems.length.toLocaleString('ko-KR')}개 생성물을 바로 다운로드할 수 있어`
            : '현재 선택에서 다운로드 가능한 생성물이 없어'}
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
          description="텍스트 결과물, 메타데이터, 중간 산출물을 DB 기준으로 정리해."
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
