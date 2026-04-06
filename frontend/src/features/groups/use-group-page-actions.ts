import { useMutation } from '@tanstack/react-query'
import {
  addImagesToGroup,
  createGroup,
  deleteGroup,
  downloadAutoFolderGroupArchive,
  downloadGroupArchive,
  rebuildAutoFolderGroups,
  removeImagesFromGroup,
  runAllGroupsAutoCollect,
  runGroupAutoCollect,
  updateGroup,
} from '@/lib/api'
import type { GroupDownloadType, GroupMutationInput, GroupRecord } from '@/types/group'
import type { GroupEditorState, GroupSourceDefinition } from './group-page-shared'

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
  const createGroupMutation = useMutation({
    mutationFn: createGroup,
    onSuccess: async (result) => {
      setEditorState(null)
      showSnackbar({ message: '커스텀 그룹을 만들었어.', tone: 'info' })
      await refreshCustomGroupQueries()
      navigate(`/groups/${result.id}?tab=custom`)
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '커스텀 그룹 생성에 실패했어.', tone: 'error' })
    },
  })

  const updateGroupMutation = useMutation({
    mutationFn: ({ groupId: targetGroupId, input }: { groupId: number; input: GroupMutationInput }) => updateGroup(targetGroupId, input),
    onSuccess: async () => {
      setEditorState(null)
      showSnackbar({ message: '커스텀 그룹 설정을 저장했어.', tone: 'info' })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '커스텀 그룹 저장에 실패했어.', tone: 'error' })
    },
  })

  const deleteGroupMutation = useMutation({
    mutationFn: ({ groupId: targetGroupId, cascade }: { groupId: number; cascade: boolean }) => deleteGroup(targetGroupId, { cascade }),
    onSuccess: async () => {
      showSnackbar({ message: '커스텀 그룹을 삭제했어.', tone: 'info' })
      await refreshCustomGroupQueries()
      navigate('/groups?tab=custom')
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '커스텀 그룹 삭제에 실패했어.', tone: 'error' })
    },
  })

  const autoCollectMutation = useMutation({
    mutationFn: runGroupAutoCollect,
    onSuccess: async (result) => {
      showSnackbar({
        message: `자동수집 실행 완료: ${result.images_added.toLocaleString('ko-KR')}개 추가, ${result.images_removed.toLocaleString('ko-KR')}개 정리`,
        tone: 'info',
      })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '자동수집 실행에 실패했어.', tone: 'error' })
    },
  })

  const autoCollectAllMutation = useMutation({
    mutationFn: runAllGroupsAutoCollect,
    onSuccess: async (result) => {
      showSnackbar({
        message: `전체 자동수집 완료: ${result.total_groups.toLocaleString('ko-KR')}개 그룹, ${result.total_images_added.toLocaleString('ko-KR')}개 추가, ${result.total_images_removed.toLocaleString('ko-KR')}개 정리`,
        tone: 'info',
      })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '전체 자동수집 실행에 실패했어.', tone: 'error' })
    },
  })

  const rebuildAutoFolderGroupsMutation = useMutation({
    mutationFn: rebuildAutoFolderGroups,
    onSuccess: async () => {
      showSnackbar({ message: '감시폴더 그룹을 다시 읽어왔어.', tone: 'info' })
      await refreshFolderGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '감시폴더 그룹 재구축에 실패했어.', tone: 'error' })
    },
  })

  const downloadGroupArchiveMutation = useMutation({
    mutationFn: async ({ type, scope }: { type: GroupDownloadType; scope: 'group' | 'selection' }) => {
      if (!selectedGroupId) {
        throw new Error('다운로드할 그룹이 선택되지 않았어.')
      }

      if (scope === 'selection' && selectedGroupCompositeHashes.length === 0) {
        throw new Error('다운로드할 이미지를 먼저 선택해줘.')
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
        message: variables.scope === 'selection' ? '선택한 이미지 다운로드를 준비했어.' : '현재 그룹 다운로드를 준비했어.',
        tone: 'info',
      })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '그룹 다운로드에 실패했어.', tone: 'error' })
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
      showSnackbar({ message: error instanceof Error ? error.message : '그룹 추가에 실패했어.', tone: 'error' })
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
      showSnackbar({ message: error instanceof Error ? error.message : '그룹 이미지 제거에 실패했어.', tone: 'error' })
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
        ? `정말 ${selectedGroup.name} 그룹을 삭제할까? 하위 그룹은 기본적으로 루트로 올라가.`
        : `정말 ${selectedGroup.name} 그룹을 삭제할까?`,
    )
    if (!confirmed) {
      return
    }

    const cascade = hasChildren
      ? window.confirm('하위 그룹까지 전부 같이 삭제할까?\n확인 = 하위 그룹도 함께 삭제\n취소 = 현재 그룹만 삭제하고 하위 그룹은 유지')
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
    const confirmed = window.confirm('현재 커스텀 그룹 전체에 자동수집을 한 번 돌릴까?')
    if (!confirmed) {
      return
    }

    await autoCollectAllMutation.mutateAsync()
  }

  const handleRebuildAutoFolderGroups = async () => {
    const confirmed = window.confirm('감시폴더 그룹 구조를 다시 읽어와서 재구축할까?')
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

  const handleOpenAssignModal = () => {
    if (selectedGroupCompositeHashes.length === 0) {
      return
    }

    if (assignableCustomGroupsState.isPending) {
      showSnackbar({ message: '커스텀 그룹 목록을 불러오는 중이야.', tone: 'info' })
      return
    }

    if (assignableCustomGroupsState.isError) {
      showSnackbar({ message: assignableCustomGroupsState.error instanceof Error ? assignableCustomGroupsState.error.message : '그룹 목록을 불러오지 못했어.', tone: 'error' })
      return
    }

    if (assignableCustomGroupsState.count === 0) {
      showSnackbar({ message: '먼저 커스텀 그룹을 하나 만들어줘.', tone: 'error' })
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

    const confirmed = window.confirm(`선택한 ${selectedGroupCompositeHashes.length.toLocaleString('ko-KR')}개 이미지를 현재 그룹에서 제거할까?`)
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
    handleOpenAssignModal,
    handleAssignSelectedImages,
    handleRemoveSelectedImages,
  }
}
