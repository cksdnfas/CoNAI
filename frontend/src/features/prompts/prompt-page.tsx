import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { PageHeader } from '@/components/common/page-header'
import { SegmentedControl } from '@/components/common/segmented-control'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { exportPromptGroups } from '@/lib/api'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import type { PromptCollectionItem, PromptGraphMode, PromptGroupExportData, PromptGroupRecord, PromptSortBy, PromptSortOrder, PromptTaxonomyInferredType, PromptTaxonomyRelationKind, PromptTypeFilter } from '@/types/prompt'
import { PromptCollectModal } from './components/prompt-collect-modal'
import { PromptGroupAssignModal } from './components/prompt-group-assign-modal'
import { PromptGraphPanel } from './components/prompt-graph-panel'
import { PromptGroupEditorModal } from './components/prompt-group-editor-modal'
import { PromptListPanel } from './components/prompt-list-panel'
import { PromptRelatedPanel } from './components/prompt-related-panel'
import { PromptTaxonomyGraphPanel } from './components/prompt-taxonomy-graph-panel'
import { PromptTaxonomyRelatedPanel } from './components/prompt-taxonomy-related-panel'
import { PromptSelectionBar } from './components/prompt-selection-bar'
import { PromptSidebar } from './components/prompt-sidebar'
import { PromptSummaryModal } from './components/prompt-summary-modal'
import { PromptToolbar } from './components/prompt-toolbar'
import { usePromptListSelection } from './components/use-prompt-list-selection'
import { canDeletePromptItem, isLockedPromptGroup, isLockedPromptItem } from './prompt-page-utils'
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

type PromptPageTopTab = PromptTypeFilter | 'graph'

const PROMPT_PAGE_TABS: Array<{ value: PromptPageTopTab; label: string }> = [
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'auto', label: 'Auto' },
  { value: 'graph', label: 'Graph' },
]

const PROMPT_GRAPH_MODE_ITEMS: Array<{ value: PromptGraphMode; label: string }> = [
  { value: 'usage', label: 'Usage' },
  { value: 'taxonomy', label: 'Taxonomy' },
]

export function PromptPage() {
  const { showSnackbar } = useSnackbar()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const promptListRef = useRef<HTMLDivElement | null>(null)
  const isDesktopPageLayout = useDesktopPageLayout()

  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false)
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false)
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
  const [graphMode, setGraphMode] = useState<PromptGraphMode>('usage')
  const [graphDraftFilters, setGraphDraftFilters] = useState({ type: 'positive' as PromptTypeFilter, minScore: 55, minSharedCount: 3, minUsageCount: 2, limit: 180 })
  const [graphFilters, setGraphFilters] = useState({ type: 'positive' as PromptTypeFilter, minScore: 55, minSharedCount: 3, minUsageCount: 2, limit: 180 })
  const [taxonomyGraphDraftFilters, setTaxonomyGraphDraftFilters] = useState({ type: 'positive' as PromptTypeFilter, inferredType: 'all' as PromptTaxonomyInferredType | 'all', relationKind: 'all' as PromptTaxonomyRelationKind | 'all', minScore: 0.58, limit: 180 })
  const [taxonomyGraphFilters, setTaxonomyGraphFilters] = useState({ type: 'positive' as PromptTypeFilter, inferredType: 'all' as PromptTaxonomyInferredType | 'all', relationKind: 'all' as PromptTaxonomyRelationKind | 'all', minScore: 0.58, limit: 180 })
  const [assignModalState, setAssignModalState] = useState<AssignModalState>(null)
  const [groupEditorState, setGroupEditorState] = useState<GroupEditorState>(null)

  const {
    groupsQuery,
    statisticsQuery,
    topPromptsQuery,
    groupStatisticsQuery,
    promptSearchQuery,
    relatedPromptsQuery,
    promptTaxonomyRelatedQuery,
    promptGraphQuery,
    promptTaxonomyGraphQuery,
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
    activePrompt,
    graphEnabled: activeTopTab === 'graph' && graphMode === 'usage',
    graphFilters,
    taxonomyGraphEnabled: activeTopTab === 'graph' && graphMode === 'taxonomy',
    taxonomyGraphFilters,
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
    rebuildPromptRelationsMutation,
    rebuildPromptTaxonomyMutation,
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
      showSnackbar({ message: '복사했어.', tone: 'info' })
    } catch {
      showSnackbar({ message: '복사에 실패했어.', tone: 'error' })
    }
  }

  const handleApplySearch = () => {
    setSearchQuery(searchInput)
    setPage(1)
  }

  const handleSelectActivePrompt = (prompt: string, type: PromptTypeFilter = promptType) => {
    setActivePrompt({ prompt, type })
    setSearchInput(prompt)
    setSearchQuery(prompt)
    setSelectedGroupId(undefined)
    setPage(1)
  }

  const handleChangeTopTab = (nextTab: PromptPageTopTab) => {
    setActiveTopTab(nextTab)

    if (nextTab === 'graph') {
      setGraphDraftFilters((current) => ({ ...current, type: promptType }))
      setGraphFilters((current) => ({ ...current, type: promptType }))
      setTaxonomyGraphDraftFilters((current) => ({ ...current, type: promptType }))
      setTaxonomyGraphFilters((current) => ({ ...current, type: promptType }))
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

  const handleApplyGraphFilters = () => {
    setGraphFilters(graphDraftFilters)
  }

  const handleApplyTaxonomyGraphFilters = () => {
    setTaxonomyGraphFilters(taxonomyGraphDraftFilters)
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
        value={activeTopTab}
        items={PROMPT_PAGE_TABS}
        onChange={(nextTab) => handleChangeTopTab(nextTab as PromptPageTopTab)}
      />

      {activeTopTab === 'graph' ? (
        <div className="space-y-4">
          <SegmentedControl
            value={graphMode}
            items={PROMPT_GRAPH_MODE_ITEMS}
            onChange={(value) => setGraphMode(value as PromptGraphMode)}
          />

          {graphMode === 'usage' ? (
            <PromptGraphPanel
              data={promptGraphQuery.data}
              draftFilters={graphDraftFilters}
              isLoading={promptGraphQuery.isLoading}
              isFetching={promptGraphQuery.isFetching}
              isError={promptGraphQuery.isError}
              errorMessage={promptGraphQuery.error instanceof Error ? promptGraphQuery.error.message : null}
              isRebuilding={rebuildPromptRelationsMutation.isPending}
              onDraftFiltersChange={(patch) => setGraphDraftFilters((current) => ({ ...current, ...patch }))}
              onApplyFilters={handleApplyGraphFilters}
              onRebuild={() => {
                void rebuildPromptRelationsMutation.mutateAsync()
                  .then(() => {
                    void promptGraphQuery.refetch()
                  })
                  .catch(() => undefined)
              }}
            />
          ) : (
            <PromptTaxonomyGraphPanel
              data={promptTaxonomyGraphQuery.data}
              draftFilters={taxonomyGraphDraftFilters}
              isLoading={promptTaxonomyGraphQuery.isLoading}
              isFetching={promptTaxonomyGraphQuery.isFetching}
              isError={promptTaxonomyGraphQuery.isError}
              errorMessage={promptTaxonomyGraphQuery.error instanceof Error ? promptTaxonomyGraphQuery.error.message : null}
              isRebuilding={rebuildPromptTaxonomyMutation.isPending}
              onDraftFiltersChange={(patch) => setTaxonomyGraphDraftFilters((current) => ({ ...current, ...patch }))}
              onApplyFilters={handleApplyTaxonomyGraphFilters}
              onRebuild={() => {
                void rebuildPromptTaxonomyMutation.mutateAsync()
                  .then(() => {
                    void promptTaxonomyGraphQuery.refetch()
                  })
                  .catch(() => undefined)
              }}
            />
          )}
        </div>
      ) : (
        <>
          <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[260px_minmax(0,1fr)]' : 'grid-cols-1')}>
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
              <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold tracking-tight text-foreground">{currentSectionTitle}</h2>
                  <div className="mt-1 text-sm text-muted-foreground">{currentSectionCount.toLocaleString('ko-KR')}개 표시됨</div>
                </div>

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

              <PromptRelatedPanel
                activePrompt={activePrompt}
                items={relatedPromptsQuery.data?.items ?? []}
                isLoading={relatedPromptsQuery.isLoading}
                isError={relatedPromptsQuery.isError}
                errorMessage={relatedPromptsQuery.error instanceof Error ? relatedPromptsQuery.error.message : null}
                isRebuilding={rebuildPromptRelationsMutation.isPending}
                onRebuild={() => {
                  void rebuildPromptRelationsMutation.mutateAsync()
                    .then(() => {
                      if (activePrompt?.prompt) {
                        void relatedPromptsQuery.refetch()
                      }
                    })
                    .catch(() => undefined)
                }}
                onSelectPrompt={(prompt) => handleSelectActivePrompt(prompt, activePrompt?.type ?? promptType)}
                onCopyPrompt={(prompt) => {
                  void handleCopyPrompt(prompt)
                }}
              />

              <PromptTaxonomyRelatedPanel
                activePrompt={activePrompt}
                data={promptTaxonomyRelatedQuery.data}
                isLoading={promptTaxonomyRelatedQuery.isLoading}
                isError={promptTaxonomyRelatedQuery.isError}
                errorMessage={promptTaxonomyRelatedQuery.error instanceof Error ? promptTaxonomyRelatedQuery.error.message : null}
                onSelectPrompt={(prompt) => handleSelectActivePrompt(prompt, activePrompt?.type ?? promptType)}
                onCopyPrompt={(prompt) => {
                  void handleCopyPrompt(prompt)
                }}
              />

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
        </>
      )}

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
