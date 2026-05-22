import { useCallback, useMemo } from 'react'
import { Download, Square, SquareCheckBig, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { ImageList } from '@/features/images/components/image-list/image-list'
import type { WatchedFolder } from '@/types/folder'
import type { ImageRecord } from '@/types/image'
import { resolveModuleWorkflowOutputProgress } from '../module-workflow-output-progress'
import type { ModuleWorkflowGeneratedOutputItem } from './module-workflow-output-management-panel-helpers'

/** Render the generated-output tab using the shared CoNAI image list surface. */
export function ModuleWorkflowGeneratedOutputsTab({
  outputItems,
  imageItems,
  totalOutputCount,
  page,
  totalPages,
  selectedOutputIds,
  allVisibleSelected,
  isCopyPanelOpen,
  copyTargetFolderId,
  isCopying,
  isDownloading,
  watchedFolders,
  watchedFoldersLoading,
  canDeleteOutputs,
  isDeletingOutputs,
  onPageChange,
  onClearAll,
  onToggleVisibleSelection,
  onSelectedOutputIdsChange,
  onCopyTargetFolderChange,
  onCloseCopyPanel,
  onCopySelected,
  onDownloadItems,
}: {
  outputItems: ModuleWorkflowGeneratedOutputItem[]
  imageItems: ImageRecord[]
  totalOutputCount: number
  page: number
  totalPages: number
  selectedOutputIds: string[]
  allVisibleSelected: boolean
  isCopyPanelOpen: boolean
  copyTargetFolderId: string
  isCopying: boolean
  isDownloading: boolean
  watchedFolders: WatchedFolder[]
  watchedFoldersLoading: boolean
  canDeleteOutputs: boolean
  isDeletingOutputs: boolean
  onPageChange: (page: number) => void
  onClearAll: () => void
  onToggleVisibleSelection: () => void
  onSelectedOutputIdsChange: (outputIds: string[]) => void
  onCopyTargetFolderChange: (value: string) => void
  onCloseCopyPanel: () => void
  onCopySelected: () => void
  onDownloadItems: (items: ModuleWorkflowGeneratedOutputItem[]) => void
}) {
  const { t, formatNumber } = useI18n()
  const outputProgress = resolveModuleWorkflowOutputProgress({
    page,
    pageSize: 50,
    visibleCount: outputItems.length,
    totalCount: totalOutputCount,
  })
  const outputProgressLabel = outputProgress.visibleCount > 0
    ? t(
      { ko: '표시 {start}-{end} / 전체 {total}', en: 'showing {start}-{end} / total {total}' },
      {
        start: formatNumber(outputProgress.start),
        end: formatNumber(outputProgress.end),
        total: formatNumber(outputProgress.totalCount),
      },
    )
    : formatNumber(outputProgress.totalCount)
  const outputItemById = useMemo(
    () => new Map(outputItems.map((item) => [item.id, item])),
    [outputItems],
  )
  const selectedCopyTargetFolder = useMemo(
    () => watchedFolders.find((folder) => String(folder.id) === copyTargetFolderId) ?? null,
    [copyTargetFolderId, watchedFolders],
  )
  const getGeneratedOutputImageId = useCallback((image: ImageRecord) => String(image.id), [])
  const renderGeneratedOutputOverlay = useCallback((image: ImageRecord) => {
    const item = outputItemById.get(String(image.id))
    if (!item?.downloadUrl) {
      return null
    }

    return (
      <Button
        type="button"
        size="icon"
        variant="secondary"
        className="h-8 w-8"
        title={t('module-graph.components.module.workflow.generated.outputs.tab.download.value', { label: item.label })}
        aria-label={t('module-graph.components.module.workflow.generated.outputs.tab.download.value', { label: item.label })}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onDownloadItems([item])
        }}
        disabled={isDownloading}
      >
        <Download className="h-4 w-4" />
      </Button>
    )
  }, [isDownloading, onDownloadItems, outputItemById, t])

  return (
    <Card>
      <CardHeader className="space-y-0 border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="min-w-0 flex-1 text-base">{t('module-graph.components.module.workflow.generated.outputs.tab.generated.outputs')}</CardTitle>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="outline">{outputProgressLabel}</Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onToggleVisibleSelection}
              disabled={outputItems.length === 0}
            >
              {allVisibleSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              {allVisibleSelected ? t('module-graph.components.module.workflow.generated.outputs.tab.clear.page') : t('module-graph.components.module.workflow.generated.outputs.tab.select.page')}
            </Button>
            {canDeleteOutputs ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={onClearAll}
                disabled={isDeletingOutputs || totalOutputCount === 0}
              >
                <Trash2 className="h-4 w-4" />
                {t({ ko: '전체 비우기', en: 'Clear all' })}
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isCopyPanelOpen ? (
          <div className="rounded-sm border border-border bg-surface-low px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-medium text-foreground">{t({ ko: '선택한 생성 결과를 감시 폴더로 복사', en: 'Copy selected outputs to watched folder' })}</div>
              <Badge variant="outline">{selectedOutputIds.length}</Badge>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t({ ko: '대상 폴더', en: 'Target folder' })}</div>
                <Select value={copyTargetFolderId} onChange={(event) => onCopyTargetFolderChange(event.target.value)}>
                  <option value="">{t('module-graph.components.module.workflow.generated.outputs.tab.select.folder')}</option>
                  {watchedFolders.map((folder) => (
                    <option key={folder.id} value={String(folder.id)}>
                      {folder.folder_name}
                    </option>
                  ))}
                </Select>
                {copyTargetFolderId ? (
                  <div className="text-xs text-muted-foreground">
                    {selectedCopyTargetFolder?.folder_path}
                  </div>
                ) : null}
              </div>

              <Button type="button" variant="ghost" onClick={onCloseCopyPanel} disabled={isCopying}>
                {t({ ko: '취소', en: 'Cancel' })}
              </Button>
              <Button type="button" onClick={onCopySelected} disabled={isCopying || watchedFoldersLoading || !copyTargetFolderId}>
                {isCopying ? t({ ko: '복사 중…', en: 'Copying…' }) : t({ ko: '선택 항목 복사', en: 'Copy Selected' })}
              </Button>
            </div>
          </div>
        ) : null}

        {outputItems.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
            {t({ ko: '이 범위에는 정리할 이미지/영상 생성물이 아직 없어.', en: 'No image/video outputs to manage in this scope yet.' })}
          </div>
        ) : (
          <div className="space-y-3">
            <WorkflowOutputPagination page={page} totalPages={totalPages} visibleCount={outputItems.length} totalCount={totalOutputCount} onPageChange={onPageChange} />
            <ImageList
              items={imageItems}
              layout="grid"
              selectable
              forceSelectionMode
              selectedIds={selectedOutputIds}
              onSelectedIdsChange={onSelectedOutputIdsChange}
              getItemId={getGeneratedOutputImageId}
              minColumnWidth={260}
              gridItemHeight={320}
              columnGap={20}
              rowGap={20}
              renderItemOverlay={renderGeneratedOutputOverlay}
            />
            <WorkflowOutputPagination page={page} totalPages={totalPages} visibleCount={outputItems.length} totalCount={totalOutputCount} onPageChange={onPageChange} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function WorkflowOutputPagination({
  page,
  totalPages,
  visibleCount,
  totalCount,
  onPageChange,
}: {
  page: number
  totalPages: number
  visibleCount: number
  totalCount: number
  onPageChange: (page: number) => void
}) {
  const { t, formatNumber } = useI18n()
  const progress = resolveModuleWorkflowOutputProgress({ page, pageSize: 50, visibleCount, totalCount })
  const progressLabel = progress.visibleCount > 0
    ? t(
      { ko: '표시 {start}-{end} / 전체 {total}', en: 'showing {start}-{end} / total {total}' },
      {
        start: formatNumber(progress.start),
        end: formatNumber(progress.end),
        total: formatNumber(progress.totalCount),
      },
    )
    : t({ ko: '전체 {total}', en: 'total {total}' }, { total: formatNumber(progress.totalCount) })

  if (totalPages <= 1) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-surface-low px-3 py-2 text-xs text-muted-foreground">
      <span>{t({ ko: '페이지 {page} / {totalPages} · {progress} · 페이지당 50개', en: 'page {page} / {totalPages} · {progress} · 50 per page' }, { page: formatNumber(page), totalPages: formatNumber(totalPages), progress: progressLabel })}</span>
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
