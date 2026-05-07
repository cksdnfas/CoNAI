import { useMutation } from '@tanstack/react-query'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { downloadAutoFolderGroupArchive, rebuildAutoFolderGroups } from '@/lib/api-auto-folder-groups'
import {
  addImagesToGroup,
  createGroup,
  deleteGroup,
  downloadGroupArchive,
  removeImagesFromGroup,
  runAllGroupsAutoCollect,
  runGroupAutoCollect,
  updateGroup,
} from '@/lib/api-groups'
import { deleteImagesBulk } from '@/lib/api-images'
import type { GroupDownloadType, GroupMutationInput, GroupRecord } from '@/types/group'
import type { GroupEditorState, GroupSourceDefinition } from './group-page-shared'
import { useI18n } from '@/i18n'

/** Own mutation wiring and user-triggered action handlers for the group page. */
export function useGroupPageActions({
  navigate,
  showSnackbar,
  selectedSource,
  isCustomSource,
  selectedGroupId,
  selectedGroup,
  selectedGroupHierarchy,
  selectedGroupCompositeHashes,
  assignableCustomGroupsState,
  editorState,
  setEditorState,
  setSelectedGroupImageIds,
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
  selectedGroupHierarchy: { has_children?: boolean | null } | null
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
  setIsAssignModalOpen: (open: boolean) => void
  setDownloadScope: (scope: 'group' | 'selection' | null) => void
  refreshCustomGroupQueries: () => Promise<unknown>
  refreshFolderGroupQueries: () => Promise<unknown>
}) {
  const authStatusQuery = useAuthStatusQuery()
  const { t, formatNumber } = useI18n()
  const canDeleteImages = authStatusQuery.data?.isAdmin === true

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

  const deleteGroupMutation = useMutation({
    mutationFn: ({ groupId: targetGroupId, cascade }: { groupId: number; cascade: boolean }) => deleteGroup(targetGroupId, { cascade }),
    onSuccess: async () => {
      showSnackbar({ message: t('groups.use.group.page.actions.custom.group.deleted'), tone: 'info' })
      await refreshCustomGroupQueries()
      navigate('/groups?tab=custom')
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('groups.use.group.page.actions.failed.to.delete.the.custom.group'), tone: 'error' })
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
        return downloadGroupArchive(selectedGroupId, { type, compositeHashes })
      }

      return downloadAutoFolderGroupArchive(selectedGroupId, { type, compositeHashes })
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
      showSnackbar({ message: result.message, tone: 'info' })
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
      showSnackbar({ message: result.message, tone: 'info' })
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

  const handleOpenEditModal = () => {
    if (!selectedGroup || !isCustomSource) {
      return
    }

    setEditorState({
      mode: 'edit',
      group: selectedGroup,
    })
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

  const handleDeleteSelectedGroup = async () => {
    if (!selectedGroup || !selectedGroupId || !isCustomSource) {
      return
    }

    const hasChildren = Boolean(selectedGroupHierarchy?.has_children)
    const confirmed = window.confirm(
      hasChildren
        ? t({ ko: '정말 {groupName} 그룹을 삭제할까? 하위 그룹은 기본적으로 루트로 올라가.', en: 'Delete the {groupName} group? Child groups will move to the root by default.' }, { groupName: selectedGroup.name })
        : t({ ko: '정말 {groupName} 그룹을 삭제할까?', en: 'Delete the {groupName} group?' }, { groupName: selectedGroup.name }),
    )
    if (!confirmed) {
      return
    }

    const cascade = hasChildren
      ? window.confirm(t('groups.use.group.page.actions.delete.all.child.groups.too.nok.delete'))
      : false

    await deleteGroupMutation.mutateAsync({
      groupId: selectedGroupId,
      cascade,
    })
  }

  const handleRunAutoCollect = async () => {
    if (!selectedGroupId || !isCustomSource) {
      return
    }

    await autoCollectMutation.mutateAsync(selectedGroupId)
  }

  const handleRunAutoCollectAll = async () => {
    const confirmed = window.confirm(t('groups.use.group.page.actions.run.auto.collect.once.for.all.custom'))
    if (!confirmed) {
      return
    }

    await autoCollectAllMutation.mutateAsync()
  }

  const handleRebuildAutoFolderGroups = async () => {
    const confirmed = window.confirm(t('groups.use.group.page.actions.reload.and.rebuild.the.watched.folder.group'))
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

    const confirmed = window.confirm(t({ ko: '선택한 {count}개 항목을 휴지통으로 보낼까?', en: 'Send {count} selected items to the Recycle Bin?' }, { count: formatNumber(selectedGroupCompositeHashes.length) }))
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

  const handleRemoveSelectedImages = async () => {
    if (!selectedGroupId || !isCustomSource || selectedGroupCompositeHashes.length === 0) {
      return
    }

    const confirmed = window.confirm(t({ ko: '선택한 {count}개 이미지를 현재 그룹에서 제거할까?', en: 'Remove {count} selected images from the current group?' }, { count: formatNumber(selectedGroupCompositeHashes.length) }))
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
    deleteGroupMutation,
    autoCollectMutation,
    autoCollectAllMutation,
    rebuildAutoFolderGroupsMutation,
    downloadGroupArchiveMutation,
    assignToGroupMutation,
    removeGroupImagesMutation,
    deleteSelectedImagesMutation,
    canDeleteImages,
    handleOpenGroup,
    handleOpenRoot,
    handleSelectSource,
    handleOpenCreateModal,
    handleOpenEditModal,
    handleSubmitGroup,
    handleDeleteSelectedGroup,
    handleRunAutoCollect,
    handleRunAutoCollectAll,
    handleRebuildAutoFolderGroups,
    handleOpenGroupDownloadModal,
    handleOpenSelectionDownloadModal,
    handleDownloadArchive,
    handleDeleteSelectedImages,
    handleOpenAssignModal,
    handleAssignSelectedImages,
    handleRemoveSelectedImages,
  }
}
