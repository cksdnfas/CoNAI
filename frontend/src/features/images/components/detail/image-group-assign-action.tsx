import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { GroupAssignModal } from '@/features/groups/components/group-assign-modal'
import { addImageToGroup, getGroupsHierarchyAll } from '@/lib/api'
import type { ImageRecord } from '@/types/image'

interface ImageGroupAssignActionProps {
  image?: ImageRecord
}

/** Render a reusable single-image group assignment action for detail views. */
export function ImageGroupAssignAction({ image }: ImageGroupAssignActionProps) {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const compositeHash = image?.composite_hash ?? null

  const groupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', 'custom'],
    queryFn: getGroupsHierarchyAll,
    enabled: Boolean(compositeHash),
  })

  const assignMutation = useMutation({
    mutationFn: (groupId: number) => addImageToGroup(groupId, compositeHash as string),
    onSuccess: async (result) => {
      setIsModalOpen(false)
      showSnackbar({ message: result.message, tone: 'info' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['group-detail', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['group-images', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['image-detail', compositeHash] }),
      ])
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '이미지를 그룹에 추가하지 못했어.', tone: 'error' })
    },
  })

  if (!compositeHash) {
    return null
  }

  const handleOpenModal = () => {
    if (groupsQuery.isPending) {
      showSnackbar({ message: '커스텀 그룹 목록을 불러오는 중이야.', tone: 'info' })
      return
    }

    if (groupsQuery.isError) {
      showSnackbar({ message: groupsQuery.error instanceof Error ? groupsQuery.error.message : '그룹 목록을 불러오지 못했어.', tone: 'error' })
      return
    }

    if ((groupsQuery.data?.length ?? 0) === 0) {
      showSnackbar({ message: '먼저 커스텀 그룹을 하나 만들어줘.', tone: 'error' })
      return
    }

    setIsModalOpen(true)
  }

  return (
    <>
      <Button size="icon-sm" variant="outline" onClick={handleOpenModal} disabled={assignMutation.isPending} aria-label="그룹에 추가" title="그룹에 추가">
        <FolderPlus className="h-4 w-4" />
      </Button>

      <GroupAssignModal
        open={isModalOpen}
        groups={groupsQuery.data ?? []}
        selectedCount={1}
        isSubmitting={assignMutation.isPending}
        onClose={() => setIsModalOpen(false)}
        onSubmit={async (groupId) => {
          await assignMutation.mutateAsync(groupId)
        }}
      />
    </>
  )
}
