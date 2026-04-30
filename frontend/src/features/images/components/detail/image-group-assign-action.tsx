import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
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
  const { t } = useI18n()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const compositeHash = image?.composite_hash ?? null

  const groupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', 'custom'],
    queryFn: getGroupsHierarchyAll,
    enabled: false,
    staleTime: 60_000,
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
      showSnackbar({ message: error instanceof Error ? error.message : t('images.components.detail.image.group.assign.action.failed.to.add.the.image.to.the'), tone: 'error' })
    },
  })

  if (!compositeHash) {
    return null
  }

  const handleOpenModal = async () => {
    if (!compositeHash) {
      return
    }

    if (groupsQuery.isFetching) {
      showSnackbar({ message: t('images.components.detail.image.group.assign.action.loading.custom.groups'), tone: 'info' })
      return
    }

    let groups = groupsQuery.data ?? null
    if (!groups) {
      showSnackbar({ message: t('images.components.detail.image.group.assign.action.loading.custom.groups'), tone: 'info' })
      const result = await groupsQuery.refetch()

      if (result.error) {
        showSnackbar({ message: result.error instanceof Error ? result.error.message : t('images.components.detail.image.group.assign.action.failed.to.load.groups'), tone: 'error' })
        return
      }

      groups = result.data ?? []
    }

    if (groups.length === 0) {
      showSnackbar({ message: t('images.components.detail.image.group.assign.action.create.a.custom.group.first'), tone: 'error' })
      return
    }

    setIsModalOpen(true)
  }

  return (
    <>
      <Button size="icon-sm" variant="outline" onClick={() => void handleOpenModal()} disabled={assignMutation.isPending || groupsQuery.isFetching} aria-label={t('images.components.detail.image.group.assign.action.add.to.group')} title={t('images.components.detail.image.group.assign.action.add.to.group')}>
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
