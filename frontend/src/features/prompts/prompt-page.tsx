import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { PageHeader } from '@/components/common/page-header'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { exportPromptGroups } from '@/lib/api'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import type { PromptCollectionItem, PromptGroupExportData, PromptGroupRecord, PromptSortBy, PromptSortOrder, PromptTypeFilter } from '@/types/prompt'
import { PromptCollectModal } from './components/prompt-collect-modal'
import { PromptGroupAssignModal } from './components/prompt-group-assign-modal'
import { PromptGroupEditorModal } from './components/prompt-group-editor-modal'
import { PromptListPanel } from './components/prompt-list-panel'
import { PromptSelectionBar } from './components/prompt-selection-bar'
import { PromptSidebar } from './components/prompt-sidebar'
import { PromptSummaryModal } from './components/prompt-summary-modal'
import { PromptToolbar } from './components/prompt-toolbar'
import { usePromptListSelection } from './components/use-prompt-list-selection'
import { PROMPT_TYPE_TABS, canDeletePromptItem, isLockedPromptGroup, isLockedPromptItem } from './prompt-page-utils'
import { usePromptPageMutations } from './use-prompt-page-mutations'
import { usePromptPageQueries } from './use-prompt-page-queries'

type AssignModalState =
  | { mode: 'single'; item: PromptCollectionItem }
  | { mode: 'multi' }
  | null

type GroupEditorState =
  | { mode: 'create'; defaultParentId?: number | null }
  | { mode: 'edit'; group: PromptGroupRecord }
  | null

export function PromptPage() {
  const { showSnackbar } = useSnackbar()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const promptListRef = useRef<HTMLDivElement | null>(null)
  const isDesktopPageLayout = useDesktopPageLayout()

  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false)
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false)
  const [promptType, setPromptType] = useState<PromptTypeFilter>('positive')
  const [selectedGroupId, setSelectedGroupId] = useState<number | null | undefined>(undefined)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<PromptSortBy>('usage_count')
  const [sortOrder, setSortOrder] = useState<PromptSortOrder>('DESC')
  const [page, setPage] = useState(1)
  const [selectedPromptIds, setSelectedPromptIds] = useState<number[]>([])
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

  const isSelectedGroupLocked = isLockedPromptGroup(selectedGroup)
  const selectedGroupSiblingIndex = siblingGroups.findIndex((group) => group.id === selectedGroup?.id)
  const canMoveGroupUp = !isSelectedGroupLocked && selectedGroupSiblingIndex > 0
  const canMoveGroupDown = !isSelectedGroupLocked && selectedGroupSiblingIndex >= 0 && selectedGroupSiblingIndex < siblingGroups.length - 1

  const items = useMemo(() => promptSearchQuery.data?.items ?? [], [promptSearchQuery.data?.items])
  const pagination = promptSearchQuery.data?.pagination
  const selectedPromptItems = useMemo(
    () => items.filter((item) => selectedPromptIds.includes(item.id)),
    [items, selectedPromptIds],
  )
  const selectedLockedPromptCount = selectedPromptItems.filter((item) => isLockedPromptItem(item)).length
  const assignableGroups = useMemo(
    () => (groupsQuery.data ?? []).filter((group) => group.id !== 0 && !isLockedPromptGroup(group)),
    [groupsQuery.data],
  )
  const editableParentGroups = useMemo(
    () => (groupsQuery.data ?? []).filter((group) => group.id !== 0 && !isLockedPromptGroup(group)),
    [groupsQuery.data],
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
  }, [promptType, selectedGroupId, searchQuery, page, sortBy, sortOrder])

  const handleCopyPrompt = async (text: string) => {
    try {
      await copyTextToClipboard(text)
      showSnackbar({ message: '복사했어.', tone: 'info' })
    } catch {
      showSnackbar({ message: '복사에 실패했어.', tone: 'error' })
    }
  }

  const handleApplySearch = () => {
    setSearchQuery(searchInput)
    setPage(1)
  }

  const handleChangeType = (nextType: PromptTypeFilter) => {
    setPromptType(nextType)
    setSelectedGroupId(undefined)
    setPage(1)
  }

  const handleTogglePromptSelection = (promptId: number, checked: boolean) => {
    setSelectedPromptIds((current) => (checked ? (current.includes(promptId) ? current : [...current, promptId]) : current.filter((id) => id !== promptId)))
  }

  const handleOpenMultiAssignModal = () => {
    if (selectedPromptItems.length === 0) {
      return
    }
    if (selectedLockedPromptCount > 0) {
      showSnackbar({ message: 'LoRA 항목은 변경할 수 없어.', tone: 'error' })
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
    if (!selectedGroup || selectedGroup.id === 0 || isSelectedGroupLocked) {
      return
    }

    const confirmed = window.confirm(`정말 ${selectedGroup.group_name} 그룹을 삭제할까? 포함된 프롬프트는 Unclassified로 이동해.`)
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
      showSnackbar({ message: '내보냈어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '프롬프트 그룹 export에 실패했어.', tone: 'error' })
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
      showSnackbar({ message: error instanceof Error ? error.message : '프롬프트 그룹 import 파일을 읽지 못했어.', tone: 'error' })
    }
  }

  const handleDeleteSinglePrompt = async (item: PromptCollectionItem) => {
    if (isLockedPromptItem(item)) {
      showSnackbar({ message: 'LoRA 항목은 삭제할 수 없어.', tone: 'error' })
      return
    }

    if (!canDeletePromptItem(item)) {
      showSnackbar({ message: '이미지 사용량이 0일 때만 삭제할 수 있어.', tone: 'error' })
      return
    }

    const confirmed = window.confirm(`정말 이 프롬프트를 삭제할까?\n\n${item.prompt}`)
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
      showSnackbar({ message: 'LoRA 항목은 삭제할 수 없어.', tone: 'error' })
      return
    }
    if (selectedPromptItems.some((item) => !canDeletePromptItem(item))) {
      showSnackbar({ message: '사용량이 남아있는 프롬프트는 삭제할 수 없어.', tone: 'error' })
      return
    }

    const confirmed = window.confirm(`선택한 ${selectedPromptItems.length.toLocaleString('ko-KR')}개 프롬프트를 삭제할까?`)
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
      <PageHeader title="Prompts" />

      <SegmentedTabBar
        value={promptType}
        items={PROMPT_TYPE_TABS}
        onChange={(nextType) => handleChangeType(nextType as PromptTypeFilter)}
      />

      <div className={cn('grid gap-8', isDesktopPageLayout ? 'grid-cols-[260px_minmax(0,1fr)]' : 'grid-cols-1')}>
        <PromptSidebar
          groups={groupsQuery.data ?? []}
          selectedGroupId={selectedGroupId}
          totalCount={sidebarTotalCount}
          groupsLoading={groupsQuery.isLoading}
          groupsError={groupsQuery.error instanceof Error ? groupsQuery.error.message : groupsQuery.isError ? '알 수 없는 오류가 발생했어.' : null}
          canCollect={promptType !== 'auto'}
          onSelectGroup={(groupId) => {
            setSelectedGroupId(groupId)
            setPage(1)
          }}
          onCreateGroup={() => setGroupEditorState({ mode: 'create', defaultParentId: isSelectedGroupLocked ? null : (selectedGroupId ?? null) })}
          onEditGroup={selectedGroup && selectedGroup.id !== 0 && !isSelectedGroupLocked ? () => setGroupEditorState({ mode: 'edit', group: selectedGroup }) : undefined}
          onDeleteGroup={selectedGroup && selectedGroup.id !== 0 && !isSelectedGroupLocked ? () => void handleDeleteSelectedGroup() : undefined}
          onMoveGroupUp={canMoveGroupUp ? () => void handleMoveSelectedGroup('up') : undefined}
          onMoveGroupDown={canMoveGroupDown ? () => void handleMoveSelectedGroup('down') : undefined}
          onExportGroups={() => void handleExportGroups()}
          onImportGroups={() => importInputRef.current?.click()}
          onOpenSummary={() => setIsSummaryModalOpen(true)}
          onOpenCollect={() => setIsCollectModalOpen(true)}
          canMoveGroupUp={canMoveGroupUp}
          canMoveGroupDown={canMoveGroupDown}
        />

        <section className="relative z-0 space-y-4">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{currentSectionTitle}</h2>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">{currentSectionCount.toLocaleString('ko-KR')}개 표시됨</p>
              <PromptToolbar
                searchInput={searchInput}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSearchInputChange={setSearchInput}
                onApplySearch={handleApplySearch}
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
          </div>

          <PromptListPanel
            items={items}
            selectedPromptIds={selectedPromptIds}
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
              void handleCopyPrompt(item.prompt)
            }}
            isLockedPromptItem={isLockedPromptItem}
            canDeletePromptItem={canDeletePromptItem}
          />
        </section>
      </div>

      <PromptSelectionBar
        selectedCount={selectedPromptItems.length}
        isSubmitting={batchAssignPromptsMutation.isPending}
        isDeleting={deletePromptMutation.isPending}
        onAssignGroup={selectedLockedPromptCount > 0 ? () => showSnackbar({ message: 'LoRA 항목은 변경할 수 없어.', tone: 'error' }) : handleOpenMultiAssignModal}
        onDeleteSelected={selectedLockedPromptCount > 0 ? () => showSnackbar({ message: 'LoRA 항목은 삭제할 수 없어.', tone: 'error' }) : () => void handleDeleteSelectedPrompts()}
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

      <PromptSummaryModal
        open={isSummaryModalOpen}
        promptType={promptType}
        statistics={statisticsQuery.data}
        topPrompts={topPromptsQuery.data ?? []}
        groupStatistics={groupStatisticsQuery.data ?? []}
        onClose={() => setIsSummaryModalOpen(false)}
      />

      <input ref={importInputRef} type="file" accept="application/json" className="hidden" onChange={(event) => void handleImportFileChange(event)} />
    </div>
  )
}
