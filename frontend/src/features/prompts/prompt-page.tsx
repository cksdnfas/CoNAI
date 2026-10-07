import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { exportPromptGroups } from '@/lib/api-prompts'
import { copyTextToClipboard } from '@/lib/clipboard'
import type { PromptCollectionItem, PromptGroupExportData, PromptGroupRecord, PromptSortBy, PromptSortOrder, PromptTypeFilter } from '@/types/prompt'
import { PromptCollectModal } from './components/prompt-collect-modal'
import { PromptGroupAssignModal } from './components/prompt-group-assign-modal'
import { PromptGroupEditorModal } from './components/prompt-group-editor-modal'
import { PromptDanbooruGroupingModal } from './components/prompt-danbooru-grouping-modal'
import { PromptListPanel } from './components/prompt-list-panel'
import { PromptSelectionBar } from './components/prompt-selection-bar'
import { PromptPageToolbar, type PromptPageToolbarBaseProps } from './components/prompt-page-toolbar'
import { PromptGroupActions, PromptSidebar } from './components/prompt-sidebar'
import { PromptSummaryModal } from './components/prompt-summary-modal'
import { PromptSortMenu } from './components/prompt-toolbar'
import { ToolbarSearchField } from './components/toolbar-search-field'
import { usePromptListSelection } from './components/use-prompt-list-selection'
import { isPromptTypeView, parsePromptPageView, type PromptPageView } from './prompt-page-view'
import { canDeletePromptItem, isDanbooruPromptGroup, isLockedPromptGroup, isLockedPromptItem, isProtectedLoRAPromptGroup } from './prompt-page-utils'
import { usePromptPageMutations } from './use-prompt-page-mutations'
import { usePromptPageQueries } from './use-prompt-page-queries'
import { useI18n } from '@/i18n'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useConfirm } from '@/components/ui/confirm-dialog'

type AssignModalState =
  | { mode: 'single'; item: PromptCollectionItem }
  | { mode: 'multi' }
  | null

type GroupEditorState =
  | { mode: 'create'; defaultParentId?: number | null }
  | { mode: 'edit'; group: PromptGroupRecord }
  | null

const PromptPresetPanelLazy = lazy(async () => {
  const module = await import('./components/prompt-preset-panel')
  return { default: module.PromptPresetPanel }
})

const PromptDanbooruBrowserPanelLazy = lazy(async () => {
  const module = await import('./components/prompt-danbooru-browser-panel')
  return { default: module.PromptDanbooruBrowserPanel }
})

function PanelFallback({ toolbarProps }: { toolbarProps: PromptPageToolbarBaseProps }) {
  return (
    <div>
      <PromptPageToolbar {...toolbarProps} />
      <div className="min-h-64 animate-pulse rounded-sm bg-fill" />
    </div>
  )
}

/** /prompts. The old `?tab=wildcards` view was the same panel as /wildcards, so that link now goes there. */
export function PromptPage() {
  const [searchParams] = useSearchParams()
  if (searchParams.get('tab') === 'wildcards') {
    return <Navigate to="/wildcards" replace />
  }

  return <PromptPageContent />
}

function PromptPageContent() {
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const confirm = useConfirm()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const promptListRef = useRef<HTMLDivElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const view = parsePromptPageView(searchParams.get('tab'))
  const authStatusQuery = useAuthStatusQuery()
  const permissionKeys = authStatusQuery.data?.permissionKeys ?? []
  const canViewWildcards = hasAuthPermission(permissionKeys, 'page.wildcards.view')

  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false)
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false)
  const [isDanbooruGroupingModalOpen, setIsDanbooruGroupingModalOpen] = useState(false)
  const [promptType, setPromptType] = useState<PromptTypeFilter>(isPromptTypeView(view) ? view : 'positive')
  const [selectedGroupId, setSelectedGroupId] = useState<number | null | undefined>(undefined)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<PromptSortBy>('usage_count')
  const [sortOrder, setSortOrder] = useState<PromptSortOrder>('DESC')
  const [page, setPage] = useState(1)
  const [previousView, setPreviousView] = useState(view)
  // The view lives in the URL (back/forward, deep links): follow it during render instead of in an effect.
  if (previousView !== view) {
    setPreviousView(view)
    setSelectedGroupId(undefined)
    setPage(1)
    if (isPromptTypeView(view)) {
      setPromptType(view)
    }
  }
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

  const promptGroups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])
  const promptGroupById = useMemo(() => new Map(promptGroups.map((group) => [group.id, group] as const)), [promptGroups])
  const isSelectedGroupProtected = isProtectedLoRAPromptGroup(selectedGroup)
  const isSelectedGroupDanbooru = isDanbooruPromptGroup(selectedGroup, promptGroupById)
  const isSelectedGroupLocked = isSelectedGroupProtected || isSelectedGroupDanbooru
  const selectedGroupSiblingIndex = siblingGroups.findIndex((group) => group.id === selectedGroup?.id)
  const canMoveGroupUp = !isSelectedGroupLocked && selectedGroupSiblingIndex > 0
  const canMoveGroupDown = !isSelectedGroupLocked && selectedGroupSiblingIndex >= 0 && selectedGroupSiblingIndex < siblingGroups.length - 1

  const items = useMemo(() => promptSearchQuery.data?.items ?? [], [promptSearchQuery.data?.items])
  const pagination = promptSearchQuery.data?.pagination
  const selectedPromptIdSet = useMemo(() => new Set(selectedPromptIds), [selectedPromptIds])
  const selectedPromptItems = useMemo(
    () => items.filter((item) => selectedPromptIdSet.has(item.id)),
    [items, selectedPromptIdSet],
  )
  const selectedLockedPromptCount = useMemo(
    () => selectedPromptItems.filter((item) => isLockedPromptItem(item, promptGroupById)).length,
    [promptGroupById, selectedPromptItems],
  )
  const editablePromptGroups = useMemo(
    () => promptGroups.filter((group) => group.id !== 0 && !isLockedPromptGroup(group, promptGroupById)),
    [promptGroupById, promptGroups],
  )
  const assignableGroups = editablePromptGroups
  const editableParentGroups = editablePromptGroups
  const isSearching = searchQuery.trim().length > 0
  const currentSectionCount = pagination?.total ?? 0
  // While searching, the list total is the match count, not the library total the sidebar labels "All prompts".
  const sidebarTotalCount = selectedGroupId == null && !isSearching && currentSectionCount > 0 ? currentSectionCount : totalCount

  const {
    assignSinglePromptMutation,
    batchAssignPromptsMutation,
    createPromptGroupMutation,
    updatePromptGroupMutation,
    deletePromptGroupMutation,
    reorderPromptGroupsMutation,
    importPromptGroupsMutation,
    deletePromptMutation,
    deletePromptsMutation,
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
    setSelectedPromptIds([])
    setAssignModalState(null)
  }, [view, promptType, selectedGroupId, searchQuery, page, sortBy, sortOrder])

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

  useChatPageRegistration(isPromptTypeView(view) ? {
    kind: 'prompt_search', title: t({ ko: '프롬프트 목록 · {type}', en: 'Prompt list · {type}' }, { type: promptType }),
    resourceId: `${promptType}:${selectedGroupId === undefined ? 'all' : selectedGroupId === null ? 'ungrouped' : selectedGroupId}`,
    fields: [
      { id: 'searchInput', label: t({ ko: '검색어 입력 (Enter로 검색 실행)', en: 'Search draft (press Enter to search)' }), type: 'text', value: searchInput },
      { id: 'sortBy', label: t({ ko: '정렬 기준 (usage_count: 사용량, created_at: 생성일, prompt: 이름)', en: 'Sort field (usage_count, created_at, prompt)' }), type: 'select', value: sortBy, options: ['usage_count', 'created_at', 'prompt'] },
      { id: 'sortOrder', label: t({ ko: '정렬 방향 (ASC: 오름차순, DESC: 내림차순)', en: 'Sort direction (ASC or DESC)' }), type: 'select', value: sortOrder, options: ['ASC', 'DESC'] },
      { id: 'appliedSearch', label: t({ ko: '현재 검색 결과의 검색어', en: 'Currently applied search' }), type: 'text', value: searchQuery, editable: false },
      { id: 'selectedGroup', label: t({ ko: '선택한 프롬프트 그룹', en: 'Selected prompt group' }), type: 'text', value: selectedGroup?.group_name ?? (selectedGroupId === null ? t({ ko: '미분류', en: 'Ungrouped' }) : t({ ko: '전체', en: 'All' })), editable: false },
    ],
    apply: (patch) => {
      if (patch.searchInput !== undefined) setSearchInput(String(patch.searchInput))
      if (patch.sortBy !== undefined) setSortBy(patch.sortBy as PromptSortBy)
      if (patch.sortOrder !== undefined) setSortOrder(patch.sortOrder as PromptSortOrder)
      if (patch.sortBy !== undefined || patch.sortOrder !== undefined) setPage(1)
    },
  } : null)

  const handleClearSearch = () => {
    setSearchInput('')
    setSearchQuery('')
    setPage(1)
  }

  const handleChangeView = (nextView: PromptPageView) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (nextView === 'positive') {
        next.delete('tab')
      } else {
        next.set('tab', nextView)
      }
      return next
    }, { replace: true })
  }

  const toolbarProps: PromptPageToolbarBaseProps = {
    view,
    promptType,
    canViewWildcards,
    onChangeView: handleChangeView,
  }

  const getPromptGroupName = (item: PromptCollectionItem) => {
    const groupId = item.group_info?.id ?? item.group_id
    if (groupId == null || groupId === 0 || groupId === selectedGroupId) {
      return null
    }
    return item.group_info?.group_name ?? promptGroupById.get(groupId)?.group_name ?? null
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

    const confirmed = await confirm({
      title: t({ ko: '그룹 삭제', en: 'Delete group' }),
      description: t({ ko: '정말 {groupName} 그룹을 삭제할까? 하위 그룹까지 삭제되고 포함된 프롬프트는 Unclassified로 이동해.', en: 'Delete the {groupName} group? Child groups will also be deleted, and included prompts will move to Unclassified.' }, { groupName: selectedGroup.group_name }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
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
    if (isLockedPromptItem(item, promptGroupById)) {
      showSnackbar({ message: t({ ko: '보호된 자동 그룹 항목은 직접 삭제할 수 없어.', en: 'Protected auto-group items cannot be deleted manually.' }), tone: 'error' })
      return
    }

    if (!canDeletePromptItem(item, promptGroupById)) {
      showSnackbar({ message: t('prompts.prompt.page.you.can.delete.it.only.when.image'), tone: 'error' })
      return
    }

    const confirmed = await confirm({
      title: t({ ko: '프롬프트 삭제', en: 'Delete prompt' }),
      description: t({ ko: '정말 이 프롬프트를 삭제할까?\n\n{prompt}', en: 'Delete this prompt?\n\n{prompt}' }, { prompt: item.prompt }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
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
    if (selectedPromptItems.some((item) => !canDeletePromptItem(item, promptGroupById))) {
      showSnackbar({ message: t('prompts.prompt.page.prompts.with.remaining.usage.cannot.be.deleted'), tone: 'error' })
      return
    }

    const confirmed = await confirm({
      title: t({ ko: '프롬프트 삭제', en: 'Delete prompts' }),
      description: t({ ko: '선택한 {count}개 프롬프트를 삭제할까?', en: 'Delete {count} selected prompts?' }, { count: formatNumber(selectedPromptItems.length) }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    await deletePromptsMutation.mutateAsync(selectedPromptItems.map((item) => item.id))
    setSelectedPromptIds([])
  }

  if (view === 'presets') {
    return (
      <Suspense fallback={<PanelFallback toolbarProps={toolbarProps} />}>
        <PromptPresetPanelLazy toolbarProps={toolbarProps} />
      </Suspense>
    )
  }

  if (view === 'danbooru') {
    return (
      <Suspense fallback={<PanelFallback toolbarProps={toolbarProps} />}>
        <PromptDanbooruBrowserPanelLazy toolbarProps={toolbarProps} />
      </Suspense>
    )
  }

  return (
    <>
      <PageWithSidebar
        storageKey="prompts"
        sidebarLabel={t({ ko: '그룹', en: 'Groups' })}
        sidebar={(
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
            onExportGroups={() => void handleExportGroups()}
            onImportGroups={() => importInputRef.current?.click()}
            onOpenSummary={() => setIsSummaryModalOpen(true)}
            onOpenCollect={() => setIsCollectModalOpen(true)}
            onOpenDanbooruGrouping={() => setIsDanbooruGroupingModalOpen(true)}
          />
        )}
        sidebarFooter={(
          <PromptGroupActions
            onEditGroup={selectedGroup && selectedGroup.id !== 0 && !isSelectedGroupLocked ? () => setGroupEditorState({ mode: 'edit', group: selectedGroup }) : undefined}
            onDeleteGroup={selectedGroup && selectedGroup.id !== 0 && !isSelectedGroupProtected ? () => void handleDeleteSelectedGroup() : undefined}
            onMoveGroupUp={canMoveGroupUp ? () => void handleMoveSelectedGroup('up') : undefined}
            onMoveGroupDown={canMoveGroupDown ? () => void handleMoveSelectedGroup('down') : undefined}
          />
        )}
        toolbar={(
          <PromptPageToolbar
            {...toolbarProps}
            actions={(
              <PromptSortMenu
                sortBy={sortBy}
                sortOrder={sortOrder}
                onChangeSortBy={(value) => {
                  setSortBy(value)
                  setPage(1)
                }}
                onChangeSortOrder={(value) => {
                  setSortOrder(value)
                  setPage(1)
                }}
              />
            )}
          >
            <ToolbarSearchField
              value={searchInput}
              placeholder={t('prompts.components.prompt.toolbar.search.prompts')}
              onChange={setSearchInput}
              onSubmit={handleApplySearch}
              onClear={handleClearSearch}
            />
          </PromptPageToolbar>
        )}
      >
        <PromptListPanel
          items={items}
          selectedPromptIdSet={selectedPromptIdSet}
          activePrompt={activePrompt}
          isLoading={promptSearchQuery.isLoading}
          isError={promptSearchQuery.isError}
          errorMessage={promptSearchQuery.error instanceof Error ? promptSearchQuery.error.message : null}
          isDraggingSelection={isDraggingSelection}
          totalPages={pagination?.totalPages ?? 0}
          page={pagination?.page ?? 1}
          limit={pagination?.limit ?? 40}
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
          isLockedPromptItem={(item) => isLockedPromptItem(item, promptGroupById)}
          canDeletePromptItem={(item) => canDeletePromptItem(item, promptGroupById)}
          getGroupName={getPromptGroupName}
        />
      </PageWithSidebar>

      <PromptSelectionBar
        selectedCount={selectedPromptItems.length}
        isSubmitting={batchAssignPromptsMutation.isPending}
        isDeleting={deletePromptMutation.isPending || deletePromptsMutation.isPending}
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
  )
}
