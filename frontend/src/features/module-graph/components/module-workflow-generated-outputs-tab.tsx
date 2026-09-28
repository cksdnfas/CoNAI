import { useCallback, useMemo } from 'react'
import { Download, ImageOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Panel } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { ImageList } from '@/features/images/components/image-list/image-list'
import type { WatchedFolder } from '@/types/folder'
import type { ImageRecord } from '@/types/image'
import { ModuleWorkflowPagedResultsSection } from './module-workflow-paged-results-section'
import type { ModuleWorkflowGeneratedOutputItem } from './module-workflow-output-management-panel-helpers'
import { EmptyState } from '@/components/ui/empty-state'

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
  const { t } = useI18n()
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
      <IconButton
        size="icon-sm"
        variant="secondary"
        label={t('module-graph.components.module.workflow.generated.outputs.tab.download.value', { label: item.label })}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onDownloadItems([item])
        }}
        disabled={isDownloading}
      >
        <Download className="h-4 w-4" />
      </IconButton>
    )
  }, [isDownloading, onDownloadItems, outputItemById, t])

  return (
    <ModuleWorkflowPagedResultsSection
      heading={t('module-graph.components.module.workflow.generated.outputs.tab.generated.outputs')}
      page={page}
      totalPages={totalPages}
      visibleCount={outputItems.length}
      totalCount={totalOutputCount}
      allVisibleSelected={allVisibleSelected}
      selectPageLabel={t('module-graph.components.module.workflow.generated.outputs.tab.select.page')}
      clearPageLabel={t('module-graph.components.module.workflow.generated.outputs.tab.clear.page')}
      canClearAll={canDeleteOutputs}
      isClearing={isDeletingOutputs}
      onPageChange={onPageChange}
      onToggleVisibleSelection={onToggleVisibleSelection}
      onClearAll={onClearAll}
      toolbar={isCopyPanelOpen ? (
        <Panel tone="lowest">
          <Text variant="label">{t({ ko: '선택한 생성 결과를 감시 폴더로 복사', en: 'Copy selected outputs to watched folder' })}</Text>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
            <div className="space-y-2">
              <Text as="div" variant="overline" className="font-medium">{t({ ko: '대상 폴더', en: 'Target folder' })}</Text>
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
        </Panel>
      ) : null}
      isEmpty={outputItems.length === 0}
      empty={<EmptyState icon={ImageOff} title={t({ ko: '이 범위에는 정리할 이미지/영상 생성물이 아직 없어.', en: 'No image/video outputs to manage in this scope yet.' })} />}
    >
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
    </ModuleWorkflowPagedResultsSection>
  )
}
