import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { PageHeader } from '@/components/common/page-header'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { exportPromptGroups } from '@/lib/api'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import type { PromptCollectionItem, PromptGroupExportData, PromptGroupRecord, PromptSortBy, PromptSortOrder, PromptTypeFilter } from '@/types/prompt'
import { PromptCollectModal } from './components/prompt-collect-modal'
import { PromptGroupAssignModal } from './components/prompt-group-assign-modal'
import { PromptGroupEditorModal } from './components/prompt-group-editor-modal'
import { PromptDanbooruGroupingModal } from './components/prompt-danbooru-grouping-modal'
import { PromptListPanel } from './components/prompt-list-panel'
import { PromptSelectionBar } from './components/prompt-selection-bar'
import { PromptSidebar } from './components/prompt-sidebar'
import { PromptSummaryModal } from './components/prompt-summary-modal'
import { PromptToolbar } from './components/prompt-toolbar'
import { usePromptListSelection } from './components/use-prompt-list-selection'
import { canDeletePromptItem, isDanbooruPromptGroup, isLockedPromptGroup, isLockedPromptItem, isProtectedLoRAPromptGroup } from './prompt-page-utils'
import { usePromptPageMutations } from './use-prompt-page-mutations'
import { usePromptPageQueries } from './use-prompt-page-queries'
import { useI18n } from '@/i18n'

type AssignModalState =
  | { mode: 'single'; item: PromptCollectionItem }
  | { mode: 'multi' }
  | null

type GroupEditorState =
  | { mode: 'create'; defaultParentId?: number | null }
  | { mode: 'edit'; group: PromptGroupRecord }
  | null

type PromptPageTopTab = PromptTypeFilter | 'wildcards' | 'presets' | 'danbooru'

const WildcardGenerationPanelLazy = lazy(async () => {
  const module = await import('@/features/image-generation/components/wildcard-generation-panel')
  return { default: module.WildcardGenerationPanel }
})

const PromptPresetPanelLazy = lazy(async () => {
  const module = await import('./components/prompt-preset-panel')
  return { default: module.PromptPresetPanel }
})

const PromptDanbooruBrowserPanelLazy = lazy(async () => {
  const module = await import('./components/prompt-danbooru-browser-panel')
  return { default: module.PromptDanbooruBrowserPanel }
})

function PanelFallback() {
  return <div className="min-h-[16rem] rounded-sm border border-border bg-surface-low animate-pulse" />
}

export function PromptPage() {
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const promptListRef = useRef<HTMLDivElement | null>(null)
  const isDesktopPageLayout = useDesktopPageLayout()
  const authStatusQuery = useAuthStatusQuery()
  const permissionKeys = authStatusQuery.data?.permissionKeys ?? []
  const canViewWildcards = hasAuthPermission(permissionKeys, 'page.wildcards.view')
  const promptPageTabs = useMemo<Array<{ value: PromptPageTopTab; label: string }>>(() => [
    { value: 'positive', label: t({ ko: '긍정', en: 'Positive' }) },
    { value: 'negative', label: t({ ko: '부정', en: 'Negative' }) },
    { value: 'auto', label: t({ ko: '자동', en: 'Auto' }) },
    { value: 'danbooru', label: t({ ko: '단부루', en: 'Danbooru' }) },
    ...(canViewWildcards ? [{ value: 'wildcards' as const, label: t({ ko: '와일드카드', en: 'Wildcard' }) }] : []),
    { value: 'presets', label: t({ ko: '프리셋', en: 'Preset' }) },
  ], [canViewWildcards, t])

  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false)
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false)
  const [isDanbooruGroupingModalOpen, setIsDanbooruGroupingModalOpen] = useState(false)
  const [activeTopTab, setActiveTopTab] = useState<PromptPageTopTab>('positive')
  const [promptType, setPromptType] = useState<PromptTypeFilter>('positive')
  const [selectedGroupId, setSelectedGroupId] = useState<number | null | undefined>(undefined)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<PromptSortBy>('usage_count')
  const [sortOrder, setSortOrder] = useState<PromptSortOrder>('DESC')
  const [page, setPage] = useState(1)
  const [selectedPromptIds, setSelectedPromptIds] = useState<number[]>([])
  const [activePrompt, setActivePrompt] = useState<{ prompt: string; type: PromptTypeFilter } | null>(null)
  const [assignModalState, setAssignModalState] = useState<AssignModalState>(null)
  const [groupEditorState, setGroupEditorState] = useState<GroupEditorState>(null)

  const {
    groupsQuery,
    statisticsQuery,
    topPromptsQuery,
    groupStatisticsQuery,
    promptSearchQuery,
    selectedGroup,
    siblingGroups,
    totalCount,
  } = usePromptPageQueries({
    promptType,
    selectedGroupId,
    searchQuery,
    page,
    sortBy,
    sortOrder,
  })

  const promptGroups = groupsQuery.data ?? []
  const isSelectedGroupProtected = isProtectedLoRAPromptGroup(selectedGroup)
  const isSelectedGroupDanbooru = isDanbooruPromptGroup(selectedGroup, promptGroups)
  const isSelectedGroupLocked = isSelectedGroupProtected || isSelectedGroupDanbooru
  const selectedGroupSiblingIndex = siblingGroups.findIndex((group) => group.id === selectedGroup?.id)
  const canMoveGroupUp = !isSelectedGroupLocked && selectedGroupSiblingIndex > 0
  const canMoveGroupDown = !isSelectedGroupLocked && selectedGroupSiblingIndex >= 0 && selectedGroupSiblingIndex < siblingGroups.length - 1

  const items = useMemo(() => promptSearchQuery.data?.items ?? [], [promptSearchQuery.data?.items])
  const pagination = promptSearchQuery.data?.pagination
  const selectedPromptItems = useMemo(
    () => items.filter((item) => selectedPromptIds.includes(item.id)),
    [items, selectedPromptIds],
  )
  const selectedLockedPromptCount = selectedPromptItems.filter((item) => isLockedPromptItem(item, promptGroups)).length
  const assignableGroups = useMemo(
    () => promptGroups.filter((group) => group.id !== 0 && !isLockedPromptGroup(group, promptGroups)),
    [promptGroups],
  )
  const editableParentGroups = useMemo(
    () => promptGroups.filter((group) => group.id !== 0 && !isLockedPromptGroup(group, promptGroups)),
    [promptGroups],
  )
  const currentSectionTitle = selectedGroup?.group_name ?? 'All prompts'
  const currentSectionCount = pagination?.total ?? 0
  const sidebarTotalCount = selectedGroupId == null && currentSectionCount > 0 ? currentSectionCount : totalCount

  const {
    assignSinglePromptMutation,
    batchAssignPromptsMutation,
    createPromptGroupMutation,
    updatePromptGroupMutation,
    deletePromptGroupMutation,
    reorderPromptGroupsMutation,
    importPromptGroupsMutation,
    deletePromptMutation,
    collectPromptsMutation,
  } = usePromptPageMutations({
    promptType,
    onInfo: (message) => showSnackbar({ message, tone: 'info' }),
    onError: (message) => showSnackbar({ message, tone: 'error' }),
    onAfterSingleAssign: () => setAssignModalState(null),
    onAfterBatchAssign: () => {
      setAssignModalState(null)
      setSelectedPromptIds([])
    },
    onAfterCreateGroup: (groupId) => {
      setGroupEditorState(null)
      setSelectedGroupId(groupId)
    },
    onAfterUpdateGroup: () => setGroupEditorState(null),
    onAfterDeleteGroup: () => setSelectedGroupId(undefined),
    onAfterCollect: () => setIsCollectModalOpen(false),
    onAfterImport: () => setSelectedGroupId(undefined),
    onAfterDeletePrompt: (promptId) => {
      setSelectedPromptIds((current) => current.filter((id) => id !== promptId))
      const deletedItem = items.find((item) => item.id === promptId)
      if (deletedItem && activePrompt?.type === deletedItem.type && activePrompt.prompt === deletedItem.prompt) {
        setActivePrompt(null)
      }
    },
  })

  const { shouldSuppressClick } = usePromptListSelection({
    containerElement: promptListRef.current,
    selectable: true,
    selectedIds: selectedPromptIds,
    onSelectedIdsChange: setSelectedPromptIds,
    onDragStateChange: setIsDraggingSelection,
  })

  useEffect(() => {
    if (activeTopTab === 'wildcards' && !canViewWildcards) {
      setActiveTopTab(promptType)
    }
  }, [activeTopTab, canViewWildcards, promptType])

  useEffect(() => {
    setSelectedPromptIds([])
    setAssignModalState(null)
  }, [activeTopTab, promptType, selectedGroupId, searchQuery, page, sortBy, sortOrder])

  useEffect(() => {
    if (!activePrompt) {
      return
    }

    if (activePrompt.type !== promptType) {
      setActivePrompt(null)
    }
  }, [activePrompt, promptType])

  const handleCopyPrompt = async (text: string) => {
    try {
      await copyTextToClipboard(text)
      showSnackbar({ message: t('prompts.prompt.page.copied'), tone: 'info' })
    } catch {
      showSnackbar({ message: t('prompts.prompt.page.copy.failed'), tone: 'error' })
    }
  }

  const handleApplySearch = () => {
    setSearchQuery(searchInput)
    setPage(1)
  }

  const handleClearSearch = () => {
    setSearchInput('')
    setSearchQuery('')
    setPage(1)
  }

  const handleChangeTopTab = (nextTab: PromptPageTopTab) => {
    setActiveTopTab(nextTab)

    if (nextTab === 'wildcards' || nextTab === 'presets' || nextTab === 'danbooru') {
      setSelectedGroupId(undefined)
      setPage(1)
      return
    }

    setPromptType(nextTab)
    setSelectedGroupId(undefined)
    setPage(1)
  }

  const handleActivatePrompt = async (prompt: string, type: PromptTypeFilter = promptType) => {
    setActivePrompt({ prompt, type })
    await handleCopyPrompt(prompt)
  }

  const handleTogglePromptSelection = (promptId: number, checked: boolean) => {
    setSelectedPromptIds((current) => (checked ? (current.includes(promptId) ? current : [...current, promptId]) : current.filter((id) => id !== promptId)))
  }

  const handleOpenMultiAssignModal = () => {
    if (selectedPromptItems.length === 0) {
      return
    }
    if (selectedLockedPromptCount > 0) {
      showSnackbar({ message: t({ ko: '보호된 자동 그룹 항목은 직접 변경할 수 없어.', en: 'Protected auto-group items cannot be changed manually.' }), tone: 'error' })
      return
    }
    setAssignModalState({ mode: 'multi' })
  }

  const handleSubmitAssign = async (groupId: number | null) => {
    if (!assignModalState) {
      return
    }

    if (assignModalState.mode === 'single') {
      await assignSinglePromptMutation.mutateAsync({ promptId: assignModalState.item.id, groupId })
      return
    }

    await batchAssignPromptsMutation.mutateAsync({
      prompts: selectedPromptItems.map((item) => item.prompt),
      groupId,
    })
  }

  const handleSubmitGroupEditor = async (input: { group_name: string; parent_id?: number | null; is_visible?: boolean }) => {
    if (!groupEditorState) {
      return
    }

    if (groupEditorState.mode === 'create') {
      await createPromptGroupMutation.mutateAsync(input)
      return
    }

    await updatePromptGroupMutation.mutateAsync({ groupId: groupEditorState.group.id, input })
  }

  const handleDeleteSelectedGroup = async () => {
    if (!selectedGroup || selectedGroup.id === 0 || isSelectedGroupProtected) {
      return
    }

    const confirmed = window.confirm(t({ ko: '정말 {groupName} 그룹을 삭제할까? 하위 그룹까지 삭제되고 포함된 프롬프트는 Unclassified로 이동해.', en: 'Delete the {groupName} group? Child groups will also be deleted, and included prompts will move to Unclassified.' }, { groupName: selectedGroup.group_name }))
    if (!confirmed) {
      return
    }

    await deletePromptGroupMutation.mutateAsync(selectedGroup.id)
  }

  const handleMoveSelectedGroup = async (direction: 'up' | 'down') => {
    if (!selectedGroup || selectedGroup.id === 0 || isSelectedGroupLocked) {
      return
    }

    const currentIndex = siblingGroups.findIndex((group) => group.id === selectedGroup.id)
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    const targetGroup = siblingGroups[targetIndex]
    if (currentIndex < 0 || !targetGroup) {
      return
    }

    await reorderPromptGroupsMutation.mutateAsync([
      { id: selectedGroup.id, display_order: targetGroup.display_order },
      { id: targetGroup.id, display_order: selectedGroup.display_order },
    ])
  }

  const handleExportGroups = async () => {
    try {
      await exportPromptGroups(promptType)
      showSnackbar({ message: t('prompts.prompt.page.exported'), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t('prompts.prompt.page.failed.to.export.prompt.groups'), tone: 'error' })
    }
  }

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.currentTarget.value = ''
    if (!file) {
      return
    }

    try {
      const raw = JSON.parse(await file.text()) as PromptGroupExportData
      await importPromptGroupsMutation.mutateAsync(raw)
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t('prompts.prompt.page.failed.to.read.the.prompt.group.import'), tone: 'error' })
    }
  }

  const handleDeleteSinglePrompt = async (item: PromptCollectionItem) => {
    if (isLockedPromptItem(item, promptGroups)) {
      showSnackbar({ message: t({ ko: '보호된 자동 그룹 항목은 직접 삭제할 수 없어.', en: 'Protected auto-group items cannot be deleted manually.' }), tone: 'error' })
      return
    }

    if (!canDeletePromptItem(item, promptGroups)) {
      showSnackbar({ message: t('prompts.prompt.page.you.can.delete.it.only.when.image'), tone: 'error' })
      return
    }

    const confirmed = window.confirm(t({ ko: '정말 이 프롬프트를 삭제할까?\n\n{prompt}', en: 'Delete this prompt?\n\n{prompt}' }, { prompt: item.prompt }))
    if (!confirmed) {
      return
    }

    await deletePromptMutation.mutateAsync(item.id)
  }

  const handleDeleteSelectedPrompts = async () => {
    if (selectedPromptItems.length === 0) {
      return
    }
    if (selectedLockedPromptCount > 0) {
      showSnackbar({ message: t({ ko: '보호된 자동 그룹 항목은 직접 삭제할 수 없어.', en: 'Protected auto-group items cannot be deleted manually.' }), tone: 'error' })
      return
    }
    if (selectedPromptItems.some((item) => !canDeletePromptItem(item, promptGroups))) {
      showSnackbar({ message: t('prompts.prompt.page.prompts.with.remaining.usage.cannot.be.deleted'), tone: 'error' })
      return
    }

    const confirmed = window.confirm(t({ ko: '선택한 {count}개 프롬프트를 삭제할까?', en: 'Delete {count} selected prompts?' }, { count: formatNumber(selectedPromptItems.length) }))
    if (!confirmed) {
      return
    }

    for (const item of selectedPromptItems) {
      await deletePromptMutation.mutateAsync(item.id)
    }
    setSelectedPromptIds([])
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t({ ko: '프롬프트', en: 'Prompts' })} />

      <SegmentedTabBar
        value={activeTopTab}
        items={promptPageTabs}
        onChange={(nextTab) => handleChangeTopTab(nextTab as PromptPageTopTab)}
      />

      {activeTopTab === 'wildcards' ? (
        <Suspense fallback={<PanelFallback />}>
          <WildcardGenerationPanelLazy refreshNonce={0} />
        </Suspense>
      ) : activeTopTab === 'presets' ? (
        <Suspense fallback={<PanelFallback />}>
          <PromptPresetPanelLazy />
        </Suspense>
      ) : activeTopTab === 'danbooru' ? (
        <Suspense fallback={<PanelFallback />}>
          <PromptDanbooruBrowserPanelLazy />
        </Suspense>
      ) : (
        <>
          <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[260px_minmax(0,1fr)]' : 'grid-cols-1')}>
            <PromptSidebar
              groups={groupsQuery.data ?? []}
              selectedGroupId={selectedGroupId}
              totalCount={sidebarTotalCount}
              groupsLoading={groupsQuery.isLoading}
              groupsError={groupsQuery.error instanceof Error ? groupsQuery.error.message : groupsQuery.isError ? t('prompts.prompt.page.an.unknown.error.occurred') : null}
              canCollect={promptType !== 'auto'}
              onSelectGroup={(groupId) => {
                setSelectedGroupId(groupId)
                setPage(1)
              }}
              onCreateGroup={() => setGroupEditorState({ mode: 'create', defaultParentId: isSelectedGroupLocked ? null : (selectedGroupId ?? null) })}
              onEditGroup={selectedGroup && selectedGroup.id !== 0 && !isSelectedGroupLocked ? () => setGroupEditorState({ mode: 'edit', group: selectedGroup }) : undefined}
              onDeleteGroup={selectedGroup && selectedGroup.id !== 0 && !isSelectedGroupProtected ? () => void handleDeleteSelectedGroup() : undefined}
              onMoveGroupUp={canMoveGroupUp ? () => void handleMoveSelectedGroup('up') : undefined}
              onMoveGroupDown={canMoveGroupDown ? () => void handleMoveSelectedGroup('down') : undefined}
              onExportGroups={() => void handleExportGroups()}
              onImportGroups={() => importInputRef.current?.click()}
              onOpenSummary={() => setIsSummaryModalOpen(true)}
              onOpenCollect={() => setIsCollectModalOpen(true)}
              onOpenDanbooruGrouping={() => setIsDanbooruGroupingModalOpen(true)}
              canMoveGroupUp={canMoveGroupUp}
              canMoveGroupDown={canMoveGroupDown}
            />

            <section className="relative z-0 space-y-4">
              <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold tracking-tight text-foreground">{currentSectionTitle}</h2>
                  <div className="mt-1 text-sm text-muted-foreground">{t({ ko: '{count}개 표시됨', en: '{count} shown' }, { count: formatNumber(currentSectionCount) })}</div>
                </div>

                <PromptToolbar
                  searchInput={searchInput}
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSearchInputChange={setSearchInput}
                  onApplySearch={handleApplySearch}
                  onClearSearch={handleClearSearch}
                  onChangeSortBy={(value) => {
                    setSortBy(value)
                    setPage(1)
                  }}
                  onChangeSortOrder={(value) => {
                    setSortOrder(value)
                    setPage(1)
                  }}
                />
              </div>

              <PromptListPanel
                items={items}
                selectedPromptIds={selectedPromptIds}
                activePrompt={activePrompt}
                isLoading={promptSearchQuery.isLoading}
                isError={promptSearchQuery.isError}
                errorMessage={promptSearchQuery.error instanceof Error ? promptSearchQuery.error.message : null}
                isDraggingSelection={isDraggingSelection}
                totalPages={pagination?.totalPages ?? 0}
                page={pagination?.page ?? 1}
                total={pagination?.total ?? 0}
                promptListRef={promptListRef}
                onPageChange={setPage}
                onTogglePromptSelection={handleTogglePromptSelection}
                onAssignPrompt={(item) => setAssignModalState({ mode: 'single', item })}
                onDeletePrompt={(item) => void handleDeleteSinglePrompt(item)}
                onActivatePrompt={(item) => {
                  if (shouldSuppressClick()) {
                    return
                  }
                  void handleActivatePrompt(item.prompt, item.type)
                }}
                isLockedPromptItem={(item) => isLockedPromptItem(item, promptGroups)}
                canDeletePromptItem={(item) => canDeletePromptItem(item, promptGroups)}
              />
            </section>
          </div>

          <PromptSelectionBar
            selectedCount={selectedPromptItems.length}
            isSubmitting={batchAssignPromptsMutation.isPending}
            isDeleting={deletePromptMutation.isPending}
            onAssignGroup={selectedLockedPromptCount > 0 ? () => showSnackbar({ message: t({ ko: '보호된 자동 그룹 항목은 직접 변경할 수 없어.', en: 'Protected auto-group items cannot be changed manually.' }), tone: 'error' }) : handleOpenMultiAssignModal}
            onDeleteSelected={selectedLockedPromptCount > 0 ? () => showSnackbar({ message: t({ ko: '보호된 자동 그룹 항목은 직접 삭제할 수 없어.', en: 'Protected auto-group items cannot be deleted manually.' }), tone: 'error' }) : () => void handleDeleteSelectedPrompts()}
            onClear={() => setSelectedPromptIds([])}
          />

          <PromptGroupAssignModal
            open={assignModalState !== null}
            groups={assignableGroups}
            selectedCount={assignModalState?.mode === 'single' ? 1 : selectedPromptItems.length}
            isSubmitting={assignSinglePromptMutation.isPending || batchAssignPromptsMutation.isPending}
            onClose={() => setAssignModalState(null)}
            onSubmit={handleSubmitAssign}
          />

          <PromptGroupEditorModal
            open={groupEditorState !== null}
            mode={groupEditorState?.mode ?? 'create'}
            promptType={promptType}
            groups={editableParentGroups}
            group={groupEditorState?.mode === 'edit' ? groupEditorState.group : null}
            defaultParentId={groupEditorState?.mode === 'create' ? groupEditorState.defaultParentId : null}
            isSubmitting={createPromptGroupMutation.isPending || updatePromptGroupMutation.isPending}
            onClose={() => setGroupEditorState(null)}
            onSubmit={handleSubmitGroupEditor}
          />

          <PromptCollectModal
            open={isCollectModalOpen}
            isSubmitting={collectPromptsMutation.isPending}
            onClose={() => setIsCollectModalOpen(false)}
            onSubmit={async (input) => {
              await collectPromptsMutation.mutateAsync(input)
            }}
          />

          <PromptDanbooruGroupingModal
            open={isDanbooruGroupingModalOpen}
            onClose={() => setIsDanbooruGroupingModalOpen(false)}
            onInfo={(message) => showSnackbar({ message, tone: 'info' })}
            onError={(message) => showSnackbar({ message, tone: 'error' })}
          />

          <PromptSummaryModal
            open={isSummaryModalOpen}
            promptType={promptType}
            statistics={statisticsQuery.data}
            topPrompts={topPromptsQuery.data ?? []}
            groupStatistics={groupStatisticsQuery.data ?? []}
            onClose={() => setIsSummaryModalOpen(false)}
          />

          <input ref={importInputRef} type="file" accept="application/json" className="hidden" onChange={(event) => void handleImportFileChange(event)} />
        </>
      )}
    </div>
  )
}
