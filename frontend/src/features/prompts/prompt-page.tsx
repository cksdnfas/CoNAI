import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/common/page-header'
import {
  assignPromptToGroup,
  batchAssignPromptsToGroup,
  collectPrompts,
  createPromptGroup,
  deletePrompt,
  deletePromptGroup,
  exportPromptGroups,
  getPromptGroupStatistics,
  getPromptGroups,
  getPromptStatistics,
  getTopPrompts,
  importPromptGroups,
  reorderPromptGroups,
  searchPromptCollection,
  updatePromptGroup,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type { PromptCollectionItem, PromptGroupExportData, PromptGroupRecord, PromptSortBy, PromptSortOrder, PromptStatistics, PromptTypeFilter } from '@/types/prompt'
import { PromptCollectModal } from './components/prompt-collect-modal'
import { PromptGroupAssignModal } from './components/prompt-group-assign-modal'
import { PromptGroupEditorModal } from './components/prompt-group-editor-modal'
import { PromptListItem } from './components/prompt-list-item'
import { PromptSelectionBar } from './components/prompt-selection-bar'
import { PromptSidebar } from './components/prompt-sidebar'
import { PromptSummaryModal } from './components/prompt-summary-modal'
import { PromptToolbar } from './components/prompt-toolbar'
import { usePromptListSelection } from './components/use-prompt-list-selection'

type AssignModalState =
  | { mode: 'single'; item: PromptCollectionItem }
  | { mode: 'multi' }
  | null

type GroupEditorState =
  | { mode: 'create'; defaultParentId?: number | null }
  | { mode: 'edit'; group: PromptGroupRecord }
  | null

const PROMPT_TYPE_TABS: Array<{ value: PromptTypeFilter; label: string }> = [
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'auto', label: 'Auto' },
]

function getSortedSiblingGroups(groups: PromptGroupRecord[], group: PromptGroupRecord | null) {
  if (!group) {
    return []
  }

  return groups
    .filter((item) => item.id !== 0 && item.parent_id === group.parent_id)
    .sort((left, right) => left.display_order - right.display_order || left.group_name.localeCompare(right.group_name))
}

function isLockedPromptGroup(group?: PromptGroupRecord | null) {
  return group?.group_name?.trim().toLowerCase() === 'lora'
}

function isLockedPromptItem(item: PromptCollectionItem) {
  return item.group_info?.group_name?.trim().toLowerCase() === 'lora'
}

function getPromptTypeTotal(promptType: PromptTypeFilter, statistics?: PromptStatistics) {
  if (!statistics) {
    return 0
  }

  if (promptType === 'positive') {
    return statistics.total_prompts
  }
  if (promptType === 'negative') {
    return statistics.total_negative_prompts
  }
  return statistics.total_auto_prompts
}

export function PromptPage() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const promptListRef = useRef<HTMLDivElement | null>(null)
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

  const groupsQuery = useQuery({
    queryKey: ['prompt-groups', promptType],
    queryFn: () => getPromptGroups(promptType),
  })

  const statisticsQuery = useQuery({
    queryKey: ['prompt-statistics'],
    queryFn: getPromptStatistics,
  })

  const topPromptsQuery = useQuery({
    queryKey: ['prompt-top', promptType],
    queryFn: () => getTopPrompts({ type: promptType, limit: 9 }),
  })

  const groupStatisticsQuery = useQuery({
    queryKey: ['prompt-group-statistics', promptType],
    queryFn: () => getPromptGroupStatistics(promptType),
  })

  const promptSearchQuery = useQuery({
    queryKey: ['prompt-search', promptType, selectedGroupId, searchQuery, page, sortBy, sortOrder],
    queryFn: () =>
      searchPromptCollection({
        query: searchQuery,
        type: promptType,
        page,
        limit: 40,
        sortBy,
        sortOrder,
        groupId: selectedGroupId ?? undefined,
      }),
  })

  const selectedGroup = useMemo(
    () => (groupsQuery.data ?? []).find((group) => group.id === selectedGroupId) ?? null,
    [groupsQuery.data, selectedGroupId],
  )
  const isSelectedGroupLocked = isLockedPromptGroup(selectedGroup)
  const siblingGroups = useMemo(() => getSortedSiblingGroups(groupsQuery.data ?? [], selectedGroup), [groupsQuery.data, selectedGroup])
  const selectedGroupSiblingIndex = siblingGroups.findIndex((group) => group.id === selectedGroup?.id)
  const canMoveGroupUp = !isSelectedGroupLocked && selectedGroupSiblingIndex > 0
  const canMoveGroupDown = !isSelectedGroupLocked && selectedGroupSiblingIndex >= 0 && selectedGroupSiblingIndex < siblingGroups.length - 1

  const refreshPromptQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['prompt-groups', promptType] }),
      queryClient.invalidateQueries({ queryKey: ['prompt-group-statistics', promptType] }),
      queryClient.invalidateQueries({ queryKey: ['prompt-top', promptType] }),
      queryClient.invalidateQueries({ queryKey: ['prompt-search', promptType] }),
      queryClient.invalidateQueries({ queryKey: ['prompt-statistics'] }),
    ])
  }

  const assignSinglePromptMutation = useMutation({
    mutationFn: ({ promptId, groupId }: { promptId: number; groupId: number | null }) => assignPromptToGroup(promptId, groupId, promptType),
    onSuccess: async (result) => {
      setAssignModalState(null)
      showSnackbar({ message: result.message, tone: 'info' })
      await refreshPromptQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '프롬프트 그룹 지정에 실패했어.', tone: 'error' })
    },
  })

  const batchAssignPromptsMutation = useMutation({
    mutationFn: ({ prompts, groupId }: { prompts: string[]; groupId: number | null }) => batchAssignPromptsToGroup(prompts, groupId, promptType),
    onSuccess: async (result) => {
      setAssignModalState(null)
      setSelectedPromptIds([])
      showSnackbar({ message: result.message, tone: 'info' })
      await refreshPromptQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '프롬프트 일괄 그룹 지정에 실패했어.', tone: 'error' })
    },
  })

  const createPromptGroupMutation = useMutation({
    mutationFn: (input: { group_name: string; parent_id?: number | null; is_visible?: boolean }) => createPromptGroup(input, promptType),
    onSuccess: async (result) => {
      setGroupEditorState(null)
      showSnackbar({ message: result.message, tone: 'info' })
      await refreshPromptQueries()
      setSelectedGroupId(result.id)
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '프롬프트 그룹 생성에 실패했어.', tone: 'error' })
    },
  })

  const updatePromptGroupMutation = useMutation({
    mutationFn: ({ groupId, input }: { groupId: number; input: { group_name?: string; is_visible?: boolean } }) => updatePromptGroup(groupId, input, promptType),
    onSuccess: async (result) => {
      setGroupEditorState(null)
      showSnackbar({ message: result.message, tone: 'info' })
      await refreshPromptQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '프롬프트 그룹 수정에 실패했어.', tone: 'error' })
    },
  })

  const deletePromptGroupMutation = useMutation({
    mutationFn: (groupId: number) => deletePromptGroup(groupId, promptType),
    onSuccess: async (result) => {
      showSnackbar({ message: result.message, tone: 'info' })
      await refreshPromptQueries()
      setSelectedGroupId(undefined)
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '프롬프트 그룹 삭제에 실패했어.', tone: 'error' })
    },
  })

  const reorderPromptGroupsMutation = useMutation({
    mutationFn: (groupOrders: Array<{ id: number; display_order: number }>) => reorderPromptGroups(groupOrders, promptType),
    onSuccess: async (result) => {
      showSnackbar({ message: result.message, tone: 'info' })
      await refreshPromptQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '프롬프트 그룹 순서 변경에 실패했어.', tone: 'error' })
    },
  })

  const importPromptGroupsMutation = useMutation({
    mutationFn: (payload: PromptGroupExportData) => importPromptGroups(payload, promptType),
    onSuccess: async (result) => {
      showSnackbar({ message: result.message, tone: 'info' })
      await refreshPromptQueries()
      setSelectedGroupId(undefined)
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '프롬프트 그룹 import에 실패했어.', tone: 'error' })
    },
  })

  const deletePromptMutation = useMutation({
    mutationFn: (promptId: number) => deletePrompt(promptId, promptType),
    onSuccess: async (result, promptId) => {
      showSnackbar({ message: result.message, tone: 'info' })
      setSelectedPromptIds((current) => current.filter((id) => id !== promptId))
      await refreshPromptQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '프롬프트 삭제에 실패했어.', tone: 'error' })
    },
  })

  const collectPromptsMutation = useMutation({
    mutationFn: collectPrompts,
    onSuccess: async (result) => {
      setIsCollectModalOpen(false)
      showSnackbar({ message: result.message, tone: 'info' })
      await refreshPromptQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '프롬프트 수동 수집에 실패했어.', tone: 'error' })
    },
  })

  const items = useMemo(() => promptSearchQuery.data?.items ?? [], [promptSearchQuery.data?.items])
  const pagination = promptSearchQuery.data?.pagination
  const totalCount = getPromptTypeTotal(promptType, statisticsQuery.data)
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
      await navigator.clipboard.writeText(text)
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
    setSelectedPromptIds((current) => {
      if (checked) {
        return current.includes(promptId) ? current : [...current, promptId]
      }
      return current.filter((id) => id !== promptId)
    })
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
      await assignSinglePromptMutation.mutateAsync({
        promptId: assignModalState.item.id,
        groupId,
      })
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

    await updatePromptGroupMutation.mutateAsync({
      groupId: groupEditorState.group.id,
      input,
    })
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

  const handleImportGroups = () => {
    importInputRef.current?.click()
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
      <PageHeader
        title={selectedGroup?.group_name ?? 'Prompt'}
        actions={
          <Button type="button" variant="outline" onClick={() => setIsSummaryModalOpen(true)}>
            상태
          </Button>
        }
      />

      <div className="rounded-sm bg-surface-lowest p-2">
        <div className="flex flex-wrap gap-2">
          {PROMPT_TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => handleChangeType(tab.value)}
              className={cn(
                'rounded-sm px-4 py-2 text-sm font-semibold transition-colors',
                promptType === tab.value ? 'bg-surface-container text-primary' : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-8 min-[800px]:grid-cols-[260px_minmax(0,1fr)]">
        <PromptSidebar
          groups={groupsQuery.data ?? []}
          selectedGroupId={selectedGroupId}
          totalCount={totalCount}
          groupsLoading={groupsQuery.isLoading}
          groupsError={groupsQuery.error instanceof Error ? groupsQuery.error.message : groupsQuery.isError ? '알 수 없는 오류가 발생했어.' : null}
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
          onImportGroups={handleImportGroups}
          canMoveGroupUp={canMoveGroupUp}
          canMoveGroupDown={canMoveGroupDown}
        />

        <section className="space-y-6">
          <PromptToolbar
            searchInput={searchInput}
            sortBy={sortBy}
            sortOrder={sortOrder}
            canCollect={promptType !== 'auto'}
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
            onOpenCollect={() => setIsCollectModalOpen(true)}
          />

          {promptSearchQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>프롬프트 목록을 불러오지 못했어</AlertTitle>
              <AlertDescription>
                {promptSearchQuery.error instanceof Error ? promptSearchQuery.error.message : '알 수 없는 오류가 발생했어.'}
              </AlertDescription>
            </Alert>
          ) : null}

          {!promptSearchQuery.isLoading && items.length === 0 ? (
            <Card className="bg-surface-container">
              <CardContent className="p-6 text-sm text-muted-foreground">항목 없음</CardContent>
            </Card>
          ) : null}

          <div ref={promptListRef} className={isDraggingSelection ? 'select-none' : undefined}>
            <div className="space-y-1">
              <div className="grid grid-cols-[32px_minmax(0,1fr)_120px_116px] border-b border-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                <span />
                <span>Prompt</span>
                <span className="text-right">Usage</span>
                <span />
              </div>

              {promptSearchQuery.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 10 }).map((_, index) => (
                    <Skeleton key={index} className="h-12 w-full rounded-sm" />
                  ))}
                </div>
              ) : null}

              {!promptSearchQuery.isLoading && items.length > 0
                ? items.map((item) => {
                    const isLocked = isLockedPromptItem(item)
                    return (
                      <PromptListItem
                        key={`${item.type}-${item.id}`}
                        item={item}
                        selected={selectedPromptIds.includes(item.id)}
                        canAssign={!isLocked}
                        canDelete={!isLocked}
                        onCopy={handleCopyPrompt}
                        onToggleSelect={(checked) => handleTogglePromptSelection(item.id, checked)}
                        onAssignGroup={() => setAssignModalState({ mode: 'single', item })}
                        onDelete={() => void handleDeleteSinglePrompt(item)}
                        onActivate={() => {
                          if (shouldSuppressClick()) {
                            return
                          }
                          void handleCopyPrompt(item.prompt)
                        }}
                      />
                    )
                  })
                : null}
            </div>
          </div>

          {pagination ? (
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                page {pagination.page} / {pagination.totalPages} · total {pagination.total.toLocaleString('ko-KR')}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  이전
                </Button>
                <Button size="sm" variant="outline" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>
                  다음
                </Button>
              </div>
            </div>
          ) : null}
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
