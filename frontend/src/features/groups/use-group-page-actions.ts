import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { downloadAutoFolderGroupArchive, rebuildAutoFolderGroups } from '@/lib/api-auto-folder-groups'
import {
  addImagesToGroup,
  createGroup,
  deleteGroups,
  downloadGroupArchive,
  moveGroups,
  removeImagesFromGroup,
  runAllGroupsAutoCollect,
  runGroupAutoCollect,
  updateGroup,
} from '@/lib/api-groups'
import { withChatMediaDeleteWarning } from '@/features/images/chat-media-delete-warning'
import { deleteImagesBulk } from '@/lib/api-images'
import type { GroupDownloadType, GroupMutationInput, GroupRecord, GroupWithHierarchy } from '@/types/group'
import type { GroupEditorState, GroupSourceDefinition } from './group-page-shared'
import { useI18n } from '@/i18n'
import { formatGroupBulkAddNotice, formatGroupBulkRemoveNotice } from './group-bulk-result-messages'
import { collectGroupSubtreeIds } from './group-option-utils'
import { useConfirm } from '@/components/ui/confirm-dialog'

/** The open group delete / move confirmation and the groups it acts on. */
export type GroupBulkDialogState = { kind: 'delete' | 'move'; ids: number[] }

/** Own mutation wiring and user-triggered action handlers for the group page. */
export function useGroupPageActions({
  navigate,
  showSnackbar,
  selectedSource,
  isCustomSource,
  selectedGroupId,
  selectedGroup,
  allGroups,
  selectedGroupCompositeHashes,
  assignableCustomGroupsState,
  editorState,
  setEditorState,
  setSelectedGroupImageIds,
  setManagedGroupIds,
  setIsAssignModalOpen,
  setDownloadScope,
  refreshCustomGroupQueries,
  refreshFolderGroupQueries,
}: {
  navigate: (path: string) => void
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
  selectedSource: GroupSourceDefinition
  isCustomSource: boolean
  selectedGroupId: number | undefined
  selectedGroup: GroupRecord | undefined
  /** The whole custom group tree, to tell which groups a cascade delete removes. */
  allGroups: GroupWithHierarchy[]
  selectedGroupCompositeHashes: string[]
  assignableCustomGroupsState: {
    isPending: boolean
    isError: boolean
    error: unknown
    count: number
  }
  editorState: GroupEditorState | null
  setEditorState: (state: GroupEditorState | null) => void
  setSelectedGroupImageIds: (ids: string[]) => void
  /** Groups checked in the management list. */
  setManagedGroupIds: (ids: number[]) => void
  setIsAssignModalOpen: (open: boolean) => void
  setDownloadScope: (scope: 'group' | 'selection' | null) => void
  refreshCustomGroupQueries: (options?: { skipGroupIds?: ReadonlySet<number> }) => Promise<unknown>
  refreshFolderGroupQueries: () => Promise<unknown>
}) {
  const { t, formatNumber } = useI18n()
  const confirm = useConfirm()
  const { canDeleteImages } = useImagePermissions()
  const [groupDialog, setGroupDialog] = useState<GroupBulkDialogState | null>(null)

  const createGroupMutation = useMutation({
    mutationFn: createGroup,
    onSuccess: async (result) => {
      setEditorState(null)
      showSnackbar({ message: t('groups.use.group.page.actions.custom.group.created'), tone: 'info' })
      await refreshCustomGroupQueries()
      navigate(`/groups/${result.id}?tab=custom`)
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('groups.use.group.page.actions.failed.to.create.the.custom.group'), tone: 'error' })
    },
  })

  const updateGroupMutation = useMutation({
    mutationFn: ({ groupId: targetGroupId, input }: { groupId: number; input: GroupMutationInput }) => updateGroup(targetGroupId, input),
    onSuccess: async () => {
      setEditorState(null)
      showSnackbar({ message: t('groups.use.group.page.actions.custom.group.settings.saved'), tone: 'info' })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('groups.use.group.page.actions.custom.groups.save.failed'), tone: 'error' })
    },
  })

  const deleteGroupsMutation = useMutation({
    mutationFn: ({ ids, cascade }: { ids: number[]; cascade: boolean }) => deleteGroups(ids, { cascade }),
    onSuccess: async (result, variables) => {
      const removedIds = variables.cascade ? collectGroupSubtreeIds(allGroups, variables.ids) : new Set(variables.ids)
      setGroupDialog(null)
      setManagedGroupIds([])
      if (editorState?.mode === 'edit' && removedIds.has(editorState.group.id)) {
        setEditorState(null)
      }
      showSnackbar({
        message: variables.ids.length === 1 && result.deleted === 1
          ? t('groups.use.group.page.actions.custom.group.deleted')
          : t({ ko: '그룹 {count}개를 삭제했어.', en: '{count} groups deleted.' }, { count: formatNumber(result.deleted) }),
        tone: 'info',
      })
      if (selectedGroupId && removedIds.has(selectedGroupId)) {
        navigate('/groups?tab=custom')
      }
      // The deleted group's page stays mounted until the route change lands; refreshing its queries would refetch it (404).
      await refreshCustomGroupQueries({ skipGroupIds: removedIds })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('groups.use.group.page.actions.failed.to.delete.the.custom.group'), tone: 'error' })
    },
  })

  const moveGroupsMutation = useMutation({
    mutationFn: ({ ids, parentId }: { ids: number[]; parentId: number | null }) => moveGroups(ids, parentId),
    onSuccess: async (result) => {
      setGroupDialog(null)
      setManagedGroupIds([])
      showSnackbar({ message: t({ ko: '그룹 {count}개를 옮겼어.', en: '{count} groups moved.' }, { count: formatNumber(result.moved) }), tone: 'info' })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '그룹을 옮기지 못했어.', en: 'Failed to move the groups.' }), tone: 'error' })
    },
  })

  const autoCollectMutation = useMutation({
    mutationFn: runGroupAutoCollect,
    onSuccess: async (result) => {
      showSnackbar({
        message: t({ ko: '자동수집 실행 완료: {added}개 추가, {removed}개 정리', en: 'Auto-collect complete: {added} added, {removed} removed' }, { added: formatNumber(result.images_added), removed: formatNumber(result.images_removed) }),
        tone: 'info',
      })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('groups.use.group.page.actions.auto.collect.failed'), tone: 'error' })
    },
  })

  const autoCollectAllMutation = useMutation({
    mutationFn: runAllGroupsAutoCollect,
    onSuccess: async (result) => {
      showSnackbar({
        message: t({ ko: '전체 자동수집 완료: {groups}개 그룹, {added}개 추가, {removed}개 정리', en: 'All auto-collect jobs complete: {groups} groups, {added} added, {removed} removed' }, { groups: formatNumber(result.total_groups), added: formatNumber(result.total_images_added), removed: formatNumber(result.total_images_removed) }),
        tone: 'info',
      })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('groups.use.group.page.actions.failed.to.run.auto.collect.for.all'), tone: 'error' })
    },
  })

  const rebuildAutoFolderGroupsMutation = useMutation({
    mutationFn: rebuildAutoFolderGroups,
    onSuccess: async () => {
      showSnackbar({ message: t('groups.use.group.page.actions.watched.folder.groups.were.rebuilt'), tone: 'info' })
      await refreshFolderGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('groups.use.group.page.actions.failed.to.rebuild.watched.folder.groups'), tone: 'error' })
    },
  })

  const downloadGroupArchiveMutation = useMutation({
    mutationFn: async ({ type, scope }: { type: GroupDownloadType; scope: 'group' | 'selection' }) => {
      if (!selectedGroupId) {
        throw new Error(t('groups.use.group.page.actions.no.group.selected.for.download'))
      }

      if (scope === 'selection' && selectedGroupCompositeHashes.length === 0) {
        throw new Error(t('groups.use.group.page.actions.select.images.to.download.first'))
      }

      const compositeHashes = scope === 'selection' ? selectedGroupCompositeHashes : undefined

      if (isCustomSource) {
        return downloadGroupArchive(selectedGroupId, { type, compositeHashes, includeChildren: true })
      }

      return downloadAutoFolderGroupArchive(selectedGroupId, { type, compositeHashes, includeChildren: true })
    },
    onSuccess: (_, variables) => {
      setDownloadScope(null)
      showSnackbar({
        message: variables.scope === 'selection' ? t('groups.use.group.page.actions.preparing.selected.image.download') : t('groups.use.group.page.actions.preparing.current.group.download'),
        tone: 'info',
      })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('groups.use.group.page.actions.group.download.failed'), tone: 'error' })
    },
  })

  const deleteSelectedImagesMutation = useMutation({
    mutationFn: (compositeHashes: string[]) => deleteImagesBulk(compositeHashes),
    onSuccess: async (result) => {
      setSelectedGroupImageIds([])
      showSnackbar({
        message: result.details.failed > 0
          ? t({ ko: '{deleted}개 삭제, {failed}개 실패했어.', en: '{deleted} deleted, {failed} failed.' }, { deleted: formatNumber(result.details.deleted), failed: formatNumber(result.details.failed) })
          : t({ ko: '{deleted}개를 RecycleBin으로 보냈어.', en: '{deleted} sent to the Recycle Bin.' }, { deleted: formatNumber(result.details.deleted) }),
        tone: result.details.failed > 0 ? 'error' : 'info',
      })
      await Promise.all([
        refreshCustomGroupQueries(),
        refreshFolderGroupQueries(),
      ])
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('groups.use.group.page.actions.failed.to.delete.selected.items'), tone: 'error' })
    },
  })

  const assignToGroupMutation = useMutation({
    mutationFn: ({ groupId: targetGroupId, compositeHashes }: { groupId: number; compositeHashes: string[] }) => addImagesToGroup(targetGroupId, compositeHashes),
    onSuccess: async (result) => {
      setIsAssignModalOpen(false)
      setSelectedGroupImageIds([])
      showSnackbar(formatGroupBulkAddNotice(result, t, formatNumber))
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('groups.use.group.page.actions.failed.to.add.to.group'), tone: 'error' })
    },
  })

  // Drag-and-drop onto a tree row: same bulk add, but the selection and any open modal stay as they are.
  const dropImagesToGroupMutation = useMutation({
    mutationFn: ({ groupId: targetGroupId, compositeHashes }: { groupId: number; groupName: string; compositeHashes: string[] }) => addImagesToGroup(targetGroupId, compositeHashes),
    onSuccess: async (result, variables) => {
      const notice = formatGroupBulkAddNotice(result, t, formatNumber)
      showSnackbar({ ...notice, message: `${variables.groupName} · ${notice.message}` })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('groups.use.group.page.actions.failed.to.add.to.group'), tone: 'error' })
    },
  })

  const removeGroupImagesMutation = useMutation({
    mutationFn: ({ groupId: targetGroupId, compositeHashes }: { groupId: number; compositeHashes: string[] }) => removeImagesFromGroup(targetGroupId, compositeHashes),
    onSuccess: async (result) => {
      setSelectedGroupImageIds([])
      showSnackbar(formatGroupBulkRemoveNotice(result, t, formatNumber))
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('groups.use.group.page.actions.failed.to.remove.group.images'), tone: 'error' })
    },
  })

  const handleOpenGroup = (nextGroupId: number) => {
    navigate(`/groups/${nextGroupId}?tab=${selectedSource.key}`)
  }

  const handleOpenRoot = () => {
    navigate(`/groups?tab=${selectedSource.key}`)
  }

  const handleSelectSource = (nextSource: 'custom' | 'folders') => {
    setEditorState(null)
    navigate(`/groups?tab=${nextSource}`)
  }

  const handleOpenCreateModal = () => {
    setEditorState({
      mode: 'create',
      defaultParentId: isCustomSource ? (selectedGroupId ?? null) : null,
    })
  }

  const openCreateSubgroup = (parentId: number) => {
    setEditorState({ mode: 'create', defaultParentId: parentId })
  }

  const openEditGroup = (group: GroupRecord) => {
    setEditorState({ mode: 'edit', group })
  }

  const handleOpenEditModal = () => {
    if (!selectedGroup || !isCustomSource) {
      return
    }

    openEditGroup(selectedGroup)
  }

  const openGroupDialog = (kind: GroupBulkDialogState['kind'], ids: number[]) => {
    if (ids.length === 0) return
    // A group made elsewhere (another tab, an assistant) may be missing from the cached tree; the dialog opens once it loads.
    if (ids.some((id) => !allGroups.some((group) => group.id === id))) {
      void refreshCustomGroupQueries()
    }
    setGroupDialog({ kind, ids })
  }

  const openDeleteGroups = (ids: number[]) => openGroupDialog('delete', ids)

  const openMoveGroups = (ids: number[]) => openGroupDialog('move', ids)

  const closeGroupDialog = () => setGroupDialog(null)

  const handleConfirmDeleteGroups = (cascade: boolean) => {
    if (groupDialog?.kind !== 'delete' || deleteGroupsMutation.isPending) return
    deleteGroupsMutation.mutate({ ids: groupDialog.ids, cascade })
  }

  const handleConfirmMoveGroups = (parentId: number | null) => {
    if (groupDialog?.kind !== 'move' || moveGroupsMutation.isPending) return
    moveGroupsMutation.mutate({ ids: groupDialog.ids, parentId })
  }

  const handleSubmitGroup = async (input: GroupMutationInput) => {
    if (!editorState) {
      return
    }

    if (editorState.mode === 'create') {
      await createGroupMutation.mutateAsync(input)
      return
    }

    await updateGroupMutation.mutateAsync({
      groupId: editorState.group.id,
      input,
    })
  }

  const handleRunAutoCollect = async () => {
    if (!selectedGroupId || !isCustomSource) {
      return
    }

    await autoCollectMutation.mutateAsync(selectedGroupId)
  }

  const handleRunAutoCollectAll = async () => {
    const confirmed = await confirm({
      title: t({ ko: '전체 자동수집', en: 'Auto-collect all' }),
      description: t('groups.use.group.page.actions.run.auto.collect.once.for.all.custom'),
      confirmLabel: t({ ko: '실행', en: 'Run' }),
    })
    if (!confirmed) {
      return
    }

    await autoCollectAllMutation.mutateAsync()
  }

  const handleRebuildAutoFolderGroups = async () => {
    const confirmed = await confirm({
      title: t({ ko: '감시폴더 그룹 재구축', en: 'Rebuild watched folder groups' }),
      description: t('groups.use.group.page.actions.reload.and.rebuild.the.watched.folder.group'),
      confirmLabel: t({ ko: '재구축', en: 'Rebuild' }),
    })
    if (!confirmed) {
      return
    }

    await rebuildAutoFolderGroupsMutation.mutateAsync()
  }

  const handleOpenGroupDownloadModal = () => {
    if (!selectedGroupId) {
      return
    }

    setDownloadScope('group')
  }

  const handleOpenSelectionDownloadModal = () => {
    if (selectedGroupCompositeHashes.length === 0) {
      return
    }

    setDownloadScope('selection')
  }

  const handleDownloadArchive = async (type: GroupDownloadType, downloadScope: 'group' | 'selection' | null) => {
    if (!downloadScope) {
      return
    }

    await downloadGroupArchiveMutation.mutateAsync({ type, scope: downloadScope })
  }

  const handleDeleteSelectedImages = async () => {
    if (!canDeleteImages) {
      showSnackbar({ message: t('groups.use.group.page.actions.only.administrators.can.delete.items'), tone: 'error' })
      return
    }

    if (selectedGroupCompositeHashes.length === 0 || deleteSelectedImagesMutation.isPending) {
      return
    }

    const confirmed = await confirm({
      title: t({ ko: '휴지통으로 보내기', en: 'Move to Recycle Bin' }),
      description: await withChatMediaDeleteWarning(t({ ko: '선택한 {count}개 항목을 휴지통으로 보낼까?', en: 'Send {count} selected items to the Recycle Bin?' }, { count: formatNumber(selectedGroupCompositeHashes.length) }), selectedGroupCompositeHashes, t),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    await deleteSelectedImagesMutation.mutateAsync(selectedGroupCompositeHashes)
  }

  const handleOpenAssignModal = () => {
    if (selectedGroupCompositeHashes.length === 0) {
      return
    }

    if (assignableCustomGroupsState.isPending) {
      showSnackbar({ message: t('groups.use.group.page.actions.loading.custom.groups'), tone: 'info' })
      return
    }

    if (assignableCustomGroupsState.isError) {
      showSnackbar({ message: assignableCustomGroupsState.error instanceof Error ? assignableCustomGroupsState.error.message : t('groups.use.group.page.actions.failed.to.load.groups'), tone: 'error' })
      return
    }

    if (assignableCustomGroupsState.count === 0) {
      showSnackbar({ message: t('groups.use.group.page.actions.create.a.custom.group.first'), tone: 'error' })
      return
    }

    setIsAssignModalOpen(true)
  }

  const handleAssignSelectedImages = async (targetGroupId: number) => {
    await assignToGroupMutation.mutateAsync({
      groupId: targetGroupId,
      compositeHashes: selectedGroupCompositeHashes,
    })
  }

  const handleDropImagesToGroup = (targetGroupId: number, groupName: string, compositeHashes: string[]) => {
    if (compositeHashes.length === 0 || dropImagesToGroupMutation.isPending) {
      return
    }

    dropImagesToGroupMutation.mutate({ groupId: targetGroupId, groupName, compositeHashes })
  }

  const handleRemoveSelectedImages = async () => {
    if (!selectedGroupId || !isCustomSource || selectedGroupCompositeHashes.length === 0) {
      return
    }

    const confirmed = await confirm({
      title: t({ ko: '그룹에서 제거', en: 'Remove from group' }),
      description: t({ ko: '선택한 {count}개 이미지를 현재 그룹에서 제거할까?', en: 'Remove {count} selected images from the current group?' }, { count: formatNumber(selectedGroupCompositeHashes.length) }),
      confirmLabel: t({ ko: '제거', en: 'Remove' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    await removeGroupImagesMutation.mutateAsync({
      groupId: selectedGroupId,
      compositeHashes: selectedGroupCompositeHashes,
    })
  }

  return {
    createGroupMutation,
    updateGroupMutation,
    deleteGroupsMutation,
    moveGroupsMutation,
    autoCollectMutation,
    autoCollectAllMutation,
    rebuildAutoFolderGroupsMutation,
    downloadGroupArchiveMutation,
    assignToGroupMutation,
    dropImagesToGroupMutation,
    removeGroupImagesMutation,
    deleteSelectedImagesMutation,
    canDeleteImages,
    handleOpenGroup,
    handleOpenRoot,
    handleSelectSource,
    handleOpenCreateModal,
    handleOpenEditModal,
    handleSubmitGroup,
    openCreateSubgroup,
    openEditGroup,
    groupDialog,
    openDeleteGroups,
    openMoveGroups,
    closeGroupDialog,
    handleConfirmDeleteGroups,
    handleConfirmMoveGroups,
    handleRunAutoCollect,
    handleRunAutoCollectAll,
    handleRebuildAutoFolderGroups,
    handleOpenGroupDownloadModal,
    handleOpenSelectionDownloadModal,
    handleDownloadArchive,
    handleDeleteSelectedImages,
    handleOpenAssignModal,
    handleAssignSelectedImages,
    handleDropImagesToGroup,
    handleRemoveSelectedImages,
  }
}
