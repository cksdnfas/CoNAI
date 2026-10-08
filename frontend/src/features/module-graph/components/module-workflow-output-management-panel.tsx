import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { CopyPlus, Folder, Trash2, X } from 'lucide-react'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { TextTabs } from '@/components/common/text-tabs'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import type {
  GraphExecutionRecord,
  GraphWorkflowBrowseContentRecord,
  GraphWorkflowFolderRecord,
  GraphWorkflowSummaryRecord,
} from '@/lib/api-module-graph'
import { triggerBrowserDownload } from '@/lib/api-client'
import {
  copyGraphWorkflowArtifactsToFolder,
  deleteGraphWorkflowArtifacts,
  deleteGraphWorkflowArtifactsInScope,
} from '@/lib/api-module-graph'
import { getWatchedFolders } from '@/lib/api-folders'
import {
  buildModuleWorkflowOutputCollections,
  filterModuleWorkflowTechnicalArtifacts,
  listModuleWorkflowArtifactTypes,
  type ModuleWorkflowGeneratedOutputItem,
} from './module-workflow-output-management-panel-helpers'
import { ModuleWorkflowGeneratedOutputsTab } from './module-workflow-generated-outputs-tab'
import { ModuleWorkflowArtifactRecordsTab } from './module-workflow-artifact-records-tab'

type BrowseTab = 'outputs' | 'artifacts'

const WORKFLOW_OUTPUT_PAGE_SIZE = 50

/** Folder-scoped (or all) workflow outputs on the workflows tab's first screen: generated outputs and text/intermediate artifacts. */
export function ModuleWorkflowOutputManagementPanel({
  selectedFolderRecord,
  browseContent,
  onRefresh,
  onClearFolder,
}: {
  selectedFolderRecord: GraphWorkflowFolderRecord | null
  browseContent: GraphWorkflowBrowseContentRecord
  onRefresh?: () => Promise<unknown> | unknown
  /** Shows the folder scope as a removable chip next to the tabs. */
  onClearFolder?: () => void
}) {
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const confirm = useConfirm()
  const authStatusQuery = useAuthStatusQuery()
  const canDeleteArtifacts = authStatusQuery.data?.isAdmin === true
  const [activeTab, setActiveTab] = useState<BrowseTab>('outputs')
  const [selectedOutputIds, setSelectedOutputIds] = useState<string[]>([])
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<number[]>([])
  const [artifactSearchTerm, setArtifactSearchTerm] = useState('')
  const [artifactTypeFilter, setArtifactTypeFilter] = useState('all')
  const [isDownloading, setIsDownloading] = useState(false)
  const [isCopyPanelOpen, setIsCopyPanelOpen] = useState(false)
  const [copyTargetFolderId, setCopyTargetFolderId] = useState('')
  const [isCopying, setIsCopying] = useState(false)
  const [isDeletingOutputs, setIsDeletingOutputs] = useState(false)
  const [isDeletingArtifacts, setIsDeletingArtifacts] = useState(false)
  const [outputsPage, setOutputsPage] = useState(1)
  const [artifactsPage, setArtifactsPage] = useState(1)

  const watchedFoldersQuery = useQuery({
    queryKey: ['watched-folders', 'output-copy-targets'],
    queryFn: () => getWatchedFolders(true),
    staleTime: 30_000,
  })

  const workflowNameById = useMemo(
    () => new Map<number, string>(browseContent.workflows.map((workflow: GraphWorkflowSummaryRecord) => [workflow.id, workflow.name])),
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
  const outputItemIdSet = useMemo(
    () => new Set(outputCollections.outputItems.map((item) => item.id)),
    [outputCollections.outputItems],
  )

  const artifactTypeOptions = useMemo(
    () => listModuleWorkflowArtifactTypes(outputCollections.technicalArtifacts),
    [outputCollections.technicalArtifacts],
  )
  const selectedOutputIdSet = useMemo(
    () => new Set(selectedOutputIds),
    [selectedOutputIds],
  )
  const selectedArtifactIdSet = useMemo(
    () => new Set(selectedArtifactIds),
    [selectedArtifactIds],
  )

  const filteredTechnicalArtifacts = useMemo(() => filterModuleWorkflowTechnicalArtifacts({
    artifacts: outputCollections.technicalArtifacts,
    artifactSearchTerm,
    artifactTypeFilter,
    executionById,
    workflowNameById,
  }), [artifactSearchTerm, artifactTypeFilter, executionById, outputCollections.technicalArtifacts, workflowNameById])
  const filteredArtifactIdSet = useMemo(
    () => new Set(filteredTechnicalArtifacts.map((artifact) => artifact.id)),
    [filteredTechnicalArtifacts],
  )

  const selectedOutputItems = useMemo(
    () => outputCollections.outputItems.filter((item) => selectedOutputIdSet.has(item.id)),
    [outputCollections.outputItems, selectedOutputIdSet],
  )
  const downloadableSelectedItems = useMemo(
    () => selectedOutputItems.filter((item) => Boolean(item.downloadUrl)),
    [selectedOutputItems],
  )
  const selectedArtifacts = useMemo(
    () => filteredTechnicalArtifacts.filter((artifact) => selectedArtifactIdSet.has(artifact.id)),
    [filteredTechnicalArtifacts, selectedArtifactIdSet],
  )

  const outputTotalPages = outputCollections.outputItems.length > 0
    ? Math.ceil(outputCollections.outputItems.length / WORKFLOW_OUTPUT_PAGE_SIZE)
    : 0
  const artifactTotalPages = filteredTechnicalArtifacts.length > 0
    ? Math.ceil(filteredTechnicalArtifacts.length / WORKFLOW_OUTPUT_PAGE_SIZE)
    : 0
  const safeOutputsPage = outputTotalPages > 0 ? Math.min(outputsPage, outputTotalPages) : 1
  const safeArtifactsPage = artifactTotalPages > 0 ? Math.min(artifactsPage, artifactTotalPages) : 1
  const pagedOutputItems = useMemo(() => {
    const startIndex = (safeOutputsPage - 1) * WORKFLOW_OUTPUT_PAGE_SIZE
    return outputCollections.outputItems.slice(startIndex, startIndex + WORKFLOW_OUTPUT_PAGE_SIZE)
  }, [outputCollections.outputItems, safeOutputsPage])
  const pagedOutputIdSet = useMemo(
    () => new Set(pagedOutputItems.map((item) => item.id)),
    [pagedOutputItems],
  )
  const pagedOutputImageItems = useMemo(() => {
    return outputCollections.outputImageItems.filter((item) => pagedOutputIdSet.has(String(item.id)))
  }, [outputCollections.outputImageItems, pagedOutputIdSet])
  const pagedTechnicalArtifacts = useMemo(() => {
    const startIndex = (safeArtifactsPage - 1) * WORKFLOW_OUTPUT_PAGE_SIZE
    return filteredTechnicalArtifacts.slice(startIndex, startIndex + WORKFLOW_OUTPUT_PAGE_SIZE)
  }, [filteredTechnicalArtifacts, safeArtifactsPage])
  const pagedArtifactIdSet = useMemo(
    () => new Set(pagedTechnicalArtifacts.map((artifact) => artifact.id)),
    [pagedTechnicalArtifacts],
  )

  useEffect(() => {
    setSelectedOutputIds((current) => {
      const next = current.filter((id) => outputItemIdSet.has(id))
      return next.length === current.length ? current : next
    })
  }, [outputItemIdSet])

  useEffect(() => {
    setSelectedArtifactIds((current) => {
      const next = current.filter((id) => filteredArtifactIdSet.has(id))
      return next.length === current.length ? current : next
    })
  }, [filteredArtifactIdSet])

  useEffect(() => {
    setOutputsPage(1)
  }, [outputCollections.outputItems])

  useEffect(() => {
    setArtifactsPage(1)
  }, [artifactSearchTerm, artifactTypeFilter])

  useEffect(() => {
    if (outputTotalPages === 0 && outputsPage !== 1) {
      setOutputsPage(1)
      return
    }

    if (outputTotalPages > 0 && outputsPage > outputTotalPages) {
      setOutputsPage(outputTotalPages)
    }
  }, [outputsPage, outputTotalPages])

  useEffect(() => {
    if (artifactTotalPages === 0 && artifactsPage !== 1) {
      setArtifactsPage(1)
      return
    }

    if (artifactTotalPages > 0 && artifactsPage > artifactTotalPages) {
      setArtifactsPage(artifactTotalPages)
    }
  }, [artifactsPage, artifactTotalPages])

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

  const handleDownloadItems = useCallback((items: ModuleWorkflowGeneratedOutputItem[]) => {
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
  }, [])

  const handleCopySelectedToFolder = async () => {
    const targetFolderId = Number(copyTargetFolderId)
    const sourcePaths = selectedOutputItems
      .map((item) => item.storagePath)
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)

    if (!Number.isFinite(targetFolderId)) {
      showSnackbar({ message: t('module-graph.components.module.workflow.output.management.panel.choose.a.destination.folder.first'), tone: 'error' })
      return
    }

    if (sourcePaths.length === 0) {
      showSnackbar({ message: t('module-graph.components.module.workflow.output.management.panel.select.generated.outputs.with.copyable.source.paths'), tone: 'error' })
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
        message: t('module-graph.components.module.workflow.output.management.panel.copy.complete.value.copied.value.skipped', {
          copied: formatNumber(result.copied_count),
          skipped: formatNumber(result.skipped_count),
        }),
        tone: result.skipped_count > 0 ? 'error' : 'info',
      })
      await onRefresh?.()
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : t('module-graph.components.module.workflow.output.management.panel.failed.to.copy.generated.outputs'),
        tone: 'error',
      })
    } finally {
      setIsCopying(false)
    }
  }

  const handleDeleteSelectedOutputs = async (artifactIds?: number[], options?: { clearAll?: boolean }) => {
    if (!canDeleteArtifacts) {
      showSnackbar({ message: t('module-graph.components.module.workflow.output.management.panel.only.administrator.accounts.can.delete.items'), tone: 'error' })
      return
    }

    const targetArtifactIds = Array.from(new Set((artifactIds ?? selectedOutputItems.map((item) => item.sourceArtifactId)).filter((value) => Number.isFinite(value))))
    if (targetArtifactIds.length === 0) {
      return
    }

    const confirmMessage = options?.clearAll
      ? t('module-graph.components.module.workflow.output.management.panel.delete.all.value.generated.outputs.in.the', { count: formatNumber(targetArtifactIds.length) })
      : targetArtifactIds.length === 1
        ? t('module-graph.components.module.workflow.output.management.panel.delete.the.selected.generated.output.files.will')
        : t('module-graph.components.module.workflow.output.management.panel.delete.the.selected.value.generated.outputs.files', { count: formatNumber(targetArtifactIds.length) })

    const confirmed = await confirm({
      title: t({ ko: '생성 결과 삭제', en: 'Delete outputs' }),
      description: confirmMessage,
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    try {
      setIsDeletingOutputs(true)
      const result = await deleteGraphWorkflowArtifacts({ artifact_ids: targetArtifactIds })
      setSelectedOutputIds([])
      const cleanedExecutions = result.execution_cleanup?.deleted_count ?? 0
      showSnackbar({
        message: cleanedExecutions > 0
          ? t('module-graph.components.module.workflow.output.management.panel.deleted.value.generated.output.s.and.cleaned', {
            deleted: formatNumber(result.deleted_count),
            cleaned: formatNumber(cleanedExecutions),
          })
          : t('module-graph.components.module.workflow.output.management.panel.deleted.value.generated.output.s', { deleted: formatNumber(result.deleted_count) }),
        tone: result.missing.length > 0 || result.skipped_files.length > 0 ? 'error' : 'info',
      })
      await onRefresh?.()
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : t('module-graph.components.module.workflow.output.management.panel.failed.to.delete.generated.outputs'),
        tone: 'error',
      })
    } finally {
      setIsDeletingOutputs(false)
    }
  }

  const handleDeleteSelectedArtifacts = async (artifactIds?: number[], options?: { clearAll?: boolean }) => {
    if (!canDeleteArtifacts) {
      showSnackbar({ message: t('module-graph.components.module.workflow.output.management.panel.only.administrator.accounts.can.delete.items'), tone: 'error' })
      return
    }

    const targetArtifactIds = Array.from(new Set(artifactIds ?? selectedArtifacts.map((artifact) => artifact.id)))
    if (targetArtifactIds.length === 0) {
      return
    }

    const confirmMessage = options?.clearAll
      ? t('module-graph.components.module.workflow.output.management.panel.delete.all.value.text.and.intermediate.artifacts', { count: formatNumber(targetArtifactIds.length) })
      : targetArtifactIds.length === 1
        ? t('module-graph.components.module.workflow.output.management.panel.delete.the.selected.artifact.this.only.cleans')
        : t('module-graph.components.module.workflow.output.management.panel.delete.the.selected.value.artifacts.this.only', { count: formatNumber(targetArtifactIds.length) })

    const confirmed = await confirm({
      title: t({ ko: '아티팩트 삭제', en: 'Delete artifacts' }),
      description: confirmMessage,
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    try {
      setIsDeletingArtifacts(true)
      const result = await deleteGraphWorkflowArtifacts({ artifact_ids: targetArtifactIds })
      setSelectedArtifactIds([])
      showSnackbar({
        message: t('module-graph.components.module.workflow.output.management.panel.artifact.cleanup.complete.value.deleted.value.missing', {
          deleted: formatNumber(result.deleted_count),
          missing: formatNumber(result.missing.length),
        }),
        tone: result.missing.length > 0 || result.skipped_files.length > 0 ? 'error' : 'info',
      })
      await onRefresh?.()
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : t('module-graph.components.module.workflow.output.management.panel.failed.to.delete.artifacts'),
        tone: 'error',
      })
    } finally {
      setIsDeletingArtifacts(false)
    }
  }

  const handleClearAllOutputs = async () => {
    if (!canDeleteArtifacts) {
      showSnackbar({ message: t('module-graph.components.module.workflow.output.management.panel.only.administrator.accounts.can.delete.items'), tone: 'error' })
      return
    }

    if (outputCollections.outputItems.length === 0) {
      return
    }

    const confirmed = await confirm({
      title: t({ ko: '생성 결과 삭제', en: 'Delete outputs' }),
      description: t('module-graph.components.module.workflow.output.management.panel.delete.all.generated.outputs.in.the.current'),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    try {
      setIsDeletingOutputs(true)
      const result = await deleteGraphWorkflowArtifactsInScope({
        folder_id: browseContent.scope.folder_id,
        kind: 'outputs',
      })
      setSelectedOutputIds([])
      const cleanedExecutions = result.execution_cleanup?.deleted_count ?? 0
      showSnackbar({
        message: cleanedExecutions > 0
          ? t('module-graph.components.module.workflow.output.management.panel.deleted.value.generated.output.s.and.cleaned', {
            deleted: formatNumber(result.deleted_count),
            cleaned: formatNumber(cleanedExecutions),
          })
          : t('module-graph.components.module.workflow.output.management.panel.deleted.value.generated.output.s', { deleted: formatNumber(result.deleted_count) }),
        tone: result.missing.length > 0 || result.skipped_files.length > 0 ? 'error' : 'info',
      })
      await onRefresh?.()
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : t('module-graph.components.module.workflow.output.management.panel.failed.to.delete.generated.outputs'),
        tone: 'error',
      })
    } finally {
      setIsDeletingOutputs(false)
    }
  }

  const handleClearAllArtifacts = async () => {
    if (!canDeleteArtifacts) {
      showSnackbar({ message: t('module-graph.components.module.workflow.output.management.panel.only.administrator.accounts.can.delete.items'), tone: 'error' })
      return
    }

    if (filteredTechnicalArtifacts.length === 0) {
      return
    }

    const hasFilter = artifactSearchTerm.trim().length > 0 || artifactTypeFilter !== 'all'
    const confirmMessage = hasFilter
      ? t('module-graph.components.module.workflow.output.management.panel.delete.all.text.and.intermediate.artifacts.in')
      : t('module-graph.components.module.workflow.output.management.panel.delete.all.text.and.intermediate.artifacts.in.43cfb8cc')

    const confirmed = await confirm({
      title: t({ ko: '아티팩트 삭제', en: 'Delete artifacts' }),
      description: confirmMessage,
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    try {
      setIsDeletingArtifacts(true)
      const result = await deleteGraphWorkflowArtifactsInScope({
        folder_id: browseContent.scope.folder_id,
        kind: 'artifacts',
        artifact_type: artifactTypeFilter,
        search: artifactSearchTerm,
      })
      setSelectedArtifactIds([])
      showSnackbar({
        message: t('module-graph.components.module.workflow.output.management.panel.artifact.cleanup.complete.value.deleted.value.missing', {
          deleted: formatNumber(result.deleted_count),
          missing: formatNumber(result.missing.length),
        }),
        tone: result.missing.length > 0 || result.skipped_files.length > 0 ? 'error' : 'info',
      })
      await onRefresh?.()
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : t('module-graph.components.module.workflow.output.management.panel.failed.to.delete.artifacts'),
        tone: 'error',
      })
    } finally {
      setIsDeletingArtifacts(false)
    }
  }

  const allVisibleSelected = pagedOutputItems.length > 0 && pagedOutputItems.every((item) => selectedOutputIdSet.has(item.id))
  const allArtifactSelected = pagedTechnicalArtifacts.length > 0 && pagedTechnicalArtifacts.every((artifact) => selectedArtifactIdSet.has(artifact.id))

  return (
    <div className="space-y-4">
      <TextTabs
        value={activeTab}
        onChange={setActiveTab}
        ariaLabel={t({ ko: '워크플로 생성물', en: 'Workflow outputs' })}
        items={[
          { value: 'outputs', label: t('module-graph.components.module.workflow.output.management.panel.generated.outputs'), count: formatNumber(outputCollections.outputItems.length) },
          { value: 'artifacts', label: t('module-graph.components.module.workflow.output.management.panel.text.and.intermediate.artifacts'), count: formatNumber(filteredTechnicalArtifacts.length) },
        ]}
        actions={selectedFolderRecord && onClearFolder ? (
          <span className="inline-flex h-6 max-w-48 items-center gap-1 rounded-sm bg-fill pr-0.5 pl-1.5 text-xs text-muted-foreground">
            <Folder className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{selectedFolderRecord.name}</span>
            <IconButton size="icon-xs" variant="ghost" className="size-5" onClick={onClearFolder} label={t({ ko: '전체 보기', en: 'Show all' })}>
              <X />
            </IconButton>
          </span>
        ) : null}
      />

      {activeTab === 'outputs' ? (
        <ModuleWorkflowGeneratedOutputsTab
          outputItems={pagedOutputItems}
          imageItems={pagedOutputImageItems}
          totalOutputCount={outputCollections.outputItems.length}
          page={safeOutputsPage}
          totalPages={outputTotalPages}
          selectedOutputIds={selectedOutputIds}
          allVisibleSelected={allVisibleSelected}
          isCopyPanelOpen={isCopyPanelOpen}
          copyTargetFolderId={copyTargetFolderId}
          isCopying={isCopying}
          isDownloading={isDownloading}
          watchedFolders={watchedFoldersQuery.data ?? []}
          watchedFoldersLoading={watchedFoldersQuery.isLoading}
          canDeleteOutputs={canDeleteArtifacts}
          isDeletingOutputs={isDeletingOutputs}
          onPageChange={setOutputsPage}
          onClearAll={handleClearAllOutputs}
          onToggleVisibleSelection={() => setSelectedOutputIds((current) => (
            allVisibleSelected
              ? current.filter((id) => !pagedOutputIdSet.has(id))
              : Array.from(new Set([...current, ...pagedOutputItems.map((item) => item.id)]))
          ))}
          onSelectedOutputIdsChange={setSelectedOutputIds}
          onCopyTargetFolderChange={setCopyTargetFolderId}
          onCloseCopyPanel={() => setIsCopyPanelOpen(false)}
          onCopySelected={() => void handleCopySelectedToFolder()}
          onDownloadItems={handleDownloadItems}
        />
      ) : null}

      {activeTab === 'artifacts' ? (
        <ModuleWorkflowArtifactRecordsTab
          artifacts={pagedTechnicalArtifacts}
          totalArtifactCount={filteredTechnicalArtifacts.length}
          page={safeArtifactsPage}
          totalPages={artifactTotalPages}
          selectedArtifactIds={selectedArtifactIds}
          allVisibleSelected={allArtifactSelected}
          workflowNameById={workflowNameById}
          executionById={executionById}
          artifactSearchTerm={artifactSearchTerm}
          artifactTypeFilter={artifactTypeFilter}
          artifactTypeOptions={artifactTypeOptions}
          isDeletingArtifacts={isDeletingArtifacts}
          canDeleteArtifacts={canDeleteArtifacts}
          onPageChange={setArtifactsPage}
          onClearAll={handleClearAllArtifacts}
          onArtifactSearchTermChange={setArtifactSearchTerm}
          onArtifactTypeFilterChange={setArtifactTypeFilter}
          onToggleVisibleSelection={() => setSelectedArtifactIds((current) => (
            allArtifactSelected
              ? current.filter((id) => !pagedArtifactIdSet.has(id))
              : Array.from(new Set([...current, ...pagedTechnicalArtifacts.map((artifact) => artifact.id)]))
          ))}
          onToggleArtifactSelection={handleToggleArtifactSelection}
          onSetSelectedArtifactIds={setSelectedArtifactIds}
          onDeleteSingle={(artifactId) => {
            setSelectedArtifactIds([artifactId])
            void handleDeleteSelectedArtifacts([artifactId])
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
            ? t('module-graph.components.module.workflow.output.management.panel.value.downloadable', { count: formatNumber(downloadableSelectedItems.length) })
            : t('module-graph.components.module.workflow.output.management.panel.no.downloadable.items')}
          extraActions={(
            <IconButton
              size="icon-sm"
              variant="secondary"
              onClick={() => setIsCopyPanelOpen((current) => !current)}
              label={t('module-graph.components.module.workflow.output.management.panel.copy.to.folder')}
              data-no-select-drag="true"
            >
              <CopyPlus className="h-4 w-4" />
            </IconButton>
          )}
          trailingActions={canDeleteArtifacts ? (
            <IconButton
              size="icon-sm"
              variant="destructive"
              onClick={() => void handleDeleteSelectedOutputs()}
              disabled={isDeletingOutputs || selectedOutputItems.length === 0}
              label={isDeletingOutputs ? t('module-graph.components.module.workflow.output.management.panel.deleting') : t('module-graph.components.module.workflow.output.management.panel.delete.selected')}
              data-no-select-drag="true"
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          ) : undefined}
          onDownload={() => handleDownloadItems(downloadableSelectedItems)}
          onClear={() => setSelectedOutputIds([])}
        />
      ) : null}

      {activeTab === 'artifacts' ? (
        <SelectionActionBar
          selectedCount={selectedArtifacts.length}
          summary={t('module-graph.components.module.workflow.output.management.panel.value.artifacts.selected', { count: formatNumber(selectedArtifacts.length) })}
          onClear={() => setSelectedArtifactIds([])}
          actions={canDeleteArtifacts ? (
            <IconButton
              size="icon-sm"
              variant="destructive"
              onClick={() => void handleDeleteSelectedArtifacts()}
              disabled={isDeletingArtifacts || selectedArtifacts.length === 0}
              label={t({ ko: '선택한 결과물 삭제 ({count}개)', en: 'Delete selected artifacts ({count})' }, { count: selectedArtifacts.length })}
              data-no-select-drag="true"
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          ) : undefined}
        />
      ) : null}

    </div>
  )
}
